import { isTerminalCaptureStatus } from "../domain/capture/index.js";
import type { CaptureId, CaptureRefusal, CaptureSession, RequestId } from "../domain/capture/index.js";
import type { ProjectId } from "../domain/project/index.js";
import type {
  CancellationSignal,
  CaptureStore,
  Clock,
  Hasher,
  IdGenerator,
  Recorder,
  RecorderResult,
  RecorderTerminalMode,
  SecretResolutionRefusal,
  SecretResolver,
  SensitivityScanner,
} from "../domain/ports/index.js";
import type { CaptureResolutionDecision } from "../domain/ports/capture-store.js";
import type { RecorderRun } from "../domain/ports/recorder.js";
import { err, ok, type Result } from "../shared/result.js";

export interface RecordCaptureRequest {
  readonly projectId: ProjectId;
  readonly contextRevision: 1;
  readonly url: string;
  readonly requestId: RequestId;
  readonly secretSourceReferences: readonly string[];
  /** The caller must acknowledge that the empty declaration is intentional. */
  readonly noSecretSources: boolean;
  readonly terminalMode: RecorderTerminalMode;
  readonly signal: CancellationSignal;
}

export interface RecordCaptureDependencies {
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly hasher: Hasher;
  readonly store: CaptureStore;
  readonly resolver: SecretResolver;
  readonly recorder: Recorder;
  readonly scanner: SensitivityScanner;
}

export interface SecretSourcesDeclarationRequired {
  readonly rule: "secret-sources-declaration-required";
}
/** A retry found the original owned recorder still active; it is never duplicated or killed automatically. */
export interface CaptureProcessStillActive {
  readonly rule: "capture-process-still-active";
  readonly captureId: CaptureId;
}
export type RecordCaptureRefusal = CaptureRefusal | SecretResolutionRefusal | SecretSourcesDeclarationRequired | CaptureProcessStillActive;
export type RecordCaptureStatus = "promoted" | "rejected" | "failed" | "interrupted";
export interface RecordedCapture {
  readonly captureId: CaptureId;
  readonly status: RecordCaptureStatus;
  readonly nextAction: "capture-annotate" | "rerun-capture" | "resolve-recorder-prerequisite";
}

function terminalResult(session: CaptureSession): Result<RecordedCapture, CaptureRefusal> {
  if (session.status === "promoted") return ok({ captureId: session.captureId, status: "promoted", nextAction: "capture-annotate" });
  if (session.status === "rejected") return ok({ captureId: session.captureId, status: "rejected", nextAction: "rerun-capture" });
  if (session.status === "failed") {
    return ok({
      captureId: session.captureId,
      status: "failed",
      nextAction: session.reason === "recorder-prerequisite-or-process-failure" ? "resolve-recorder-prerequisite" : "rerun-capture",
    });
  }
  if (session.status === "interrupted") return ok({ captureId: session.captureId, status: "interrupted", nextAction: "rerun-capture" });
  return err({ rule: "capture-illegal-transition", captureId: session.captureId, from: session.status, to: "terminal" });
}

/**
 * Coordinates the supporting capture lifecycle. It neither reads nor writes a
 * BeaconStore: raw capture data remains non-authoritative until Slice 5.
 */
export class RecordCapture {
  constructor(private readonly dependencies: RecordCaptureDependencies) {}

  async execute(request: RecordCaptureRequest): Promise<Result<RecordedCapture, RecordCaptureRefusal>> {
    if (!this.hasExplicitSecretDeclaration(request)) {
      return err({ rule: "secret-sources-declaration-required" });
    }

    // Values are resolved before any capture ID allocation, recovery mutation, or process spawn.
    const resolved = request.secretSourceReferences.length === 0
      ? { ok: true as const, value: { values: new Map<string, string>(), dispose: () => {} } }
      : await this.dependencies.resolver.resolve(request.secretSourceReferences);
    if (!resolved.ok) return resolved;
    const { values: resolvedSecrets, dispose } = resolved.value;

    try {
      const recovery = await this.dependencies.store.recoverProject(request.projectId, this.now());
      if (!recovery.ok) return recovery;
      for (const session of recovery.value.blocked) {
        const blocked = await this.convergeBlockedSession(request.projectId, session);
        if (blocked !== undefined) return err(blocked);
      }

      const proposedCaptureId = this.dependencies.ids.next("capture") as CaptureId;
      const createdAt = this.now();
      const inputHash = this.dependencies.hasher.hash({
        contextRevision: request.contextRevision,
        projectId: request.projectId,
        secretSourceReferences: [...request.secretSourceReferences].sort(),
        terminalMode: request.terminalMode,
        url: request.url,
      });
      const begun = await this.dependencies.store.beginLaunch({
        projectId: request.projectId,
        captureId: proposedCaptureId,
        requestId: request.requestId,
        inputHash,
        secretSourceReferences: request.secretSourceReferences,
        createdAt,
      });
      if (!begun.ok) return begun;
      if (!begun.value.claimed) {
        return await this.routeUnclaimedSession(request, begun.value.session, resolvedSecrets);
      }

      const session = begun.value.session;
      const run = await this.dependencies.recorder.start({
        projectId: request.projectId,
        captureId: session.captureId,
        url: request.url,
        terminalMode: request.terminalMode,
        signal: request.signal,
      });
      const completion = run.waitForCompletion();
      const persistence = { failed: false };
      if (run.evidence !== undefined) this.persistRecorderEvidence(request.projectId, session.captureId, run, persistence);
      return await this.completeRecorder(session.captureId, request.projectId, completion, resolvedSecrets, request.signal, persistence);
    } finally {
      dispose();
    }
  }

  private hasExplicitSecretDeclaration(request: RecordCaptureRequest): boolean {
    return (request.noSecretSources && request.secretSourceReferences.length === 0)
      || (!request.noSecretSources && request.secretSourceReferences.length > 0);
  }

  private async convergeBlockedSession(
    projectId: ProjectId,
    session: Extract<CaptureSession, { status: "launching" | "recording" }>,
  ): Promise<RecordCaptureRefusal | undefined> {
    if (session.status === "launching") {
      return { rule: "capture-process-still-active", captureId: session.captureId };
    }
    // Recovery never signals the observed PID. Reuse is handled as absence of the original child.
    const probe = await this.dependencies.recorder.probeProcess(session.recorder);
    if (probe === "same" || probe === "unknown") {
      return { rule: "capture-process-still-active", captureId: session.captureId };
    }
    const terminal = await this.terminalize(projectId, session.captureId, "interrupt", "signal");
    return terminal.ok ? undefined : terminal.error;
  }

  private async routeUnclaimedSession(
    request: RecordCaptureRequest,
    session: CaptureSession,
    resolvedSecrets: ReadonlyMap<string, string>,
  ): Promise<Result<RecordedCapture, RecordCaptureRefusal>> {
    if (isTerminalCaptureStatus(session.status)) {
      return terminalResult(session);
    }
    if (session.status === "resolving") {
      const terminal = await this.dependencies.store.resolve(request.projectId, session.captureId, this.resolutionFrom(session), this.now());
      return terminal.ok ? terminalResult(terminal.value) : terminal;
    }
    if (session.status === "post_exit") {
      return session.secretSourceReferences.length === 0
        ? await this.scanAndTerminalize(request.projectId, session.captureId, resolvedSecrets)
        : await this.terminalize(request.projectId, session.captureId, "reject", "scan-incomplete", undefined, 0);
    }
    if (session.status === "recording") {
      const probe = await this.dependencies.recorder.probeProcess(session.recorder);
      if (probe === "same" || probe === "unknown") {
        return err({ rule: "capture-process-still-active", captureId: session.captureId });
      }
      return await this.terminalize(request.projectId, session.captureId, "interrupt", "signal");
    }
    if (session.status === "launching") {
      return err({ rule: "capture-process-still-active", captureId: session.captureId });
    }
    return err({ rule: "capture-illegal-transition", captureId: session.captureId, from: "pending", to: "launching" });
  }

  private persistRecorderEvidence(
    projectId: ProjectId,
    captureId: CaptureId,
    run: RecorderRun,
    persistence: { failed: boolean },
  ): void {
    if (run.evidence === undefined) return;
    void this.dependencies.store.recordRecorderStarted(projectId, captureId, run.evidence).then(
      (started) => {
        if (!started.ok) {
          persistence.failed = true;
          run.contain();
        }
      },
      () => {
        persistence.failed = true;
        run.contain();
      },
    );
  }

  private async completeRecorder(
    captureId: CaptureId,
    projectId: ProjectId,
    completion: Promise<RecorderResult>,
    resolvedSecrets: ReadonlyMap<string, string>,
    signal: CancellationSignal,
    persistence: { readonly failed: boolean },
  ): Promise<Result<RecordedCapture, RecordCaptureRefusal>> {
    const recorder = await completion;
    if (recorder.kind === "process-still-active") {
      return err({ rule: "capture-process-still-active", captureId });
    }
    if (recorder.kind === "operator-cancelled") {
      return persistence.failed && !signal.aborted
        ? await this.terminalize(projectId, captureId, "fail", "recorder-prerequisite-or-process-failure")
        : await this.terminalize(projectId, captureId, "interrupt", "operator-cancelled");
    }
    if (recorder.kind === "signalled") return await this.terminalize(projectId, captureId, "interrupt", "signal");
    if (recorder.kind === "prerequisite-or-process-failure") {
      return await this.terminalize(projectId, captureId, "fail", "recorder-prerequisite-or-process-failure");
    }
    if (recorder.exitCode !== 0) return await this.terminalize(projectId, captureId, "fail", "recorder-exit");
    const postExit = await this.dependencies.store.markPostExit(projectId, captureId, this.now());
    if (!postExit.ok) return postExit;
    return await this.scanAndTerminalize(projectId, captureId, resolvedSecrets);
  }

  private async scanAndTerminalize(
    projectId: ProjectId,
    captureId: CaptureId,
    resolvedSecrets: ReadonlyMap<string, string>,
  ): Promise<Result<RecordedCapture, CaptureRefusal>> {
    const scan = await this.dependencies.scanner.scan({ projectId, captureId, resolvedSecrets });
    if (scan.ok) return await this.terminalize(projectId, captureId, "promote", undefined, scan.value);
    if ("category" in scan.error) {
      const reason = scan.error.category === "detected" ? "sensitive-content" : "scan-incomplete";
      return await this.terminalize(projectId, captureId, "reject", reason, undefined, scan.error.count);
    }
    return await this.terminalize(projectId, captureId, "reject", scan.error.rule, undefined, 0);
  }

  private async terminalize(
    projectId: ProjectId,
    captureId: CaptureId,
    resolution: "promote" | "reject" | "fail" | "interrupt",
    reason?: "sensitive-content" | "scan-incomplete" | "unsafe-artifact" | "recorder-exit" | "recorder-prerequisite-or-process-failure" | "operator-cancelled" | "signal",
    artifact?: { readonly reference: string; readonly byteSize: number; readonly sha256: string },
    detectionCount?: number,
  ): Promise<Result<RecordedCapture, CaptureRefusal>> {
    const terminal = await this.dependencies.store.resolve(projectId, captureId, {
      resolution,
      reason,
      artifact,
      detectionCount,
    }, this.now());
    return terminal.ok ? terminalResult(terminal.value) : terminal;
  }

  private resolutionFrom(session: Extract<CaptureSession, { status: "resolving" }>): CaptureResolutionDecision {
    return {
      resolution: session.resolution,
      reason: session.reason,
      artifact: session.artifact,
      detectionCount: session.detectionCount,
    };
  }

  private now(): string {
    return this.dependencies.clock.now().toISOString();
  }
}
