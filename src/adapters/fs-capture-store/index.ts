import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, open, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import type {
  BeaconId,
  CaptureBeaconAssociation,
  CaptureId,
  CaptureRefusal,
  CaptureResolution,
  CaptureSession,
  PromotedCaptureArtifact,
  RequestId,
} from "../../domain/capture/index.js";
import type { CaptureSessionCommon, RecorderProcessEvidence } from "../../domain/capture/types.js";
import type { ProjectId } from "../../domain/project/index.js";
import { CAPTURE_SESSION_CONTRACT, isCaptureId } from "../../domain/capture/index.js";
import { isProjectId } from "../../domain/project/index.js";
import type { BeginCaptureCommand, BeginLaunchRefusal, CaptureResolutionDecision, CaptureStore } from "../../domain/ports/capture-store.js";
import { err, ok, type Result } from "../../shared/result.js";
import { ensurePrivateDirectory, isErrno, readJson, writePrivateJson } from "../fs-project/filesystem.js";
import { ProjectLock } from "../fs-project/project-lock.js";

const STAGED_RECORDING = "recording.spec.ts";
const PROMOTED_RECORDING = "recording.spec.ts";
const SHA256 = /^[a-f0-9]{64}$/;
const LEGACY_CAPTURE_SESSION_CONTRACT = "pharos.capture-session/1";

type TerminalCaptureStatus = "promoted" | "rejected" | "failed" | "interrupted";
type StoredRequest = BeginCaptureCommand & {
  readonly completion?: { readonly status: TerminalCaptureStatus; readonly captureId: CaptureId };
};
type ResolvingDetails = {
  readonly resolution: CaptureResolution;
  readonly artifact?: PromotedCaptureArtifact;
  readonly detectionCount?: number;
  readonly reason?: "sensitive-content" | "scan-incomplete" | "unsafe-artifact" | "recorder-exit" | "recorder-prerequisite-or-process-failure" | "operator-cancelled" | "signal";
};
type StoredResolving = Extract<CaptureSession, { status: "resolving" }> & ResolvingDetails;

export type CaptureStoreStage =
  | "before-session-write"
  | "session-written"
  | "pending-written"
  | "resolution-decision-recorded"
  | "promoted-materialized"
  | "stage-unlinked"
  | "journal-completed"
  | "association-capture-written"
  | "association-beacon-written";

export interface CaptureStoreObserver {
  onStage(stage: CaptureStoreStage, captureId: CaptureId): void | Promise<void>;
}

export interface FsCaptureStoreOptions {
  readonly projectRoot: string;
  readonly lock?: ProjectLock;
  readonly observer?: CaptureStoreObserver;
}

function requestHash(requestId: RequestId): string {
  return createHash("sha256").update(requestId).digest("hex");
}

function sameRequest(left: StoredRequest, right: BeginCaptureCommand): boolean {
  return left.projectId === right.projectId
    && left.requestId === right.requestId
    && left.inputHash === right.inputHash
    && sameSecretReferences(left.secretSourceReferences, right.secretSourceReferences);
}

/** Generated capture identity and creation time belong to the initial plan, not replay identity. */
function sameSecretReferences(left: readonly string[], right: readonly string[]): boolean {
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.length === sortedRight.length && sortedLeft.every((value, index) => value === sortedRight[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function captureRefusal(captureId: CaptureId): Result<never, CaptureRefusal> {
  return err({ rule: "capture-store-corruption", captureId });
}

const UUID_V7 = "[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const requestIdPattern = new RegExp(`^req_${UUID_V7}$`);
const secretReferencePattern = /^env:[A-Za-z_][A-Za-z0-9_]*$/;

function hasOnlyKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(record).length === keys.length && Object.keys(record).every((key) => keys.includes(key));
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const date = new Date(value);
  return !Number.isNaN(date.valueOf()) && date.toISOString() === value;
}

function isRequestId(value: unknown): value is RequestId {
  return typeof value === "string" && requestIdPattern.test(value);
}

function isSafeSecretReference(value: unknown): value is string {
  return typeof value === "string" && secretReferencePattern.test(value);
}

function isSafeSecretReferences(value: unknown): value is readonly string[] {
  if (!Array.isArray(value)) return false;
  const references: string[] = [];
  for (const item of value) {
    if (!isSafeSecretReference(item)) return false;
    references.push(item);
  }
  return new Set(references).size === references.length;
}

function isTerminalStatus(value: unknown): value is TerminalCaptureStatus {
  return value === "promoted" || value === "rejected" || value === "failed" || value === "interrupted";
}

function isRecorderProcessEvidence(value: unknown): value is RecorderProcessEvidence {
  return isRecord(value)
    && hasOnlyKeys(value, ["pid", "identity"])
    && typeof value.pid === "number"
    && Number.isSafeInteger(value.pid)
    && value.pid > 0
    && typeof value.identity === "string"
    && /^[a-f0-9]{64}$/.test(value.identity);
}

function isLegacyRecorderPidEvidence(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, ["pid"])
    && typeof value.pid === "number"
    && Number.isSafeInteger(value.pid)
    && value.pid > 0;
}

function requestFrom(value: unknown, expectedCaptureId?: CaptureId, requestId?: RequestId): StoredRequest | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, value.completion === undefined
    ? ["projectId", "captureId", "requestId", "inputHash", "secretSourceReferences", "createdAt"]
    : ["projectId", "captureId", "requestId", "inputHash", "secretSourceReferences", "createdAt", "completion"])
    || typeof value.captureId !== "string" || !isCaptureId(value.captureId) || (expectedCaptureId !== undefined && value.captureId !== expectedCaptureId)
    || typeof value.projectId !== "string" || !isProjectId(value.projectId)
    || !isRequestId(value.requestId) || (requestId !== undefined && value.requestId !== requestId)
    || typeof value.inputHash !== "string" || value.inputHash.trim().length === 0
    || !isSafeSecretReferences(value.secretSourceReferences)
    || !isCanonicalTimestamp(value.createdAt)) return undefined;
  const request: BeginCaptureCommand = {
    projectId: value.projectId,
    captureId: value.captureId,
    requestId: value.requestId,
    inputHash: value.inputHash,
    secretSourceReferences: value.secretSourceReferences,
    createdAt: value.createdAt,
  };
  if (value.completion === undefined) return request;
  if (!isRecord(value.completion)
    || !hasOnlyKeys(value.completion, ["status", "captureId"])
    || !isTerminalStatus(value.completion.status)
    || value.completion.captureId !== value.captureId) return undefined;
  return { ...request, completion: { status: value.completion.status, captureId: value.captureId } };
}

function isSafeArtifact(value: unknown, captureId: CaptureId): value is PromotedCaptureArtifact {
  return isRecord(value)
    && hasOnlyKeys(value, ["reference", "byteSize", "sha256"])
    && value.reference === `captures/${captureId}/${PROMOTED_RECORDING}`
    && typeof value.byteSize === "number"
    && Number.isSafeInteger(value.byteSize)
    && value.byteSize >= 0
    && typeof value.sha256 === "string"
    && SHA256.test(value.sha256);
}

function commonFrom(value: Record<string, unknown>, captureId: CaptureId): CaptureSessionCommon | undefined {
  if (
    (value.contract !== CAPTURE_SESSION_CONTRACT && value.contract !== LEGACY_CAPTURE_SESSION_CONTRACT)
    || value.captureId !== captureId
    || typeof value.projectId !== "string" || !isProjectId(value.projectId)
    || !isRequestId(value.requestId)
    || typeof value.inputHash !== "string" || value.inputHash.length === 0
    || !isSafeSecretReferences(value.secretSourceReferences)
    || !isCanonicalTimestamp(value.createdAt)
  ) return undefined;
  return {
    contract: CAPTURE_SESSION_CONTRACT,
    projectId: value.projectId,
    captureId,
    requestId: value.requestId,
    inputHash: value.inputHash,
    secretSourceReferences: value.secretSourceReferences,
    createdAt: value.createdAt,
  };
}

function sessionFrom(value: unknown, captureId: CaptureId): Result<CaptureSession, CaptureRefusal> {
  if (!isRecord(value) || typeof value.status !== "string") return captureRefusal(captureId);
  const common = commonFrom(value, captureId);
  if (common === undefined) return captureRefusal(captureId);
  const commonKeys = ["contract", "projectId", "captureId", "requestId", "inputHash", "secretSourceReferences", "createdAt", "status"];
  if (value.status === "running" && value.contract === LEGACY_CAPTURE_SESSION_CONTRACT) {
    // Legacy PID evidence is observational only and is never adopted as owned.
    if (hasOnlyKeys(value, commonKeys) || (hasOnlyKeys(value, [...commonKeys, "recorder"]) && isLegacyRecorderPidEvidence(value.recorder))) {
      return ok({ ...common, status: "launching" });
    }
  }
  if (value.contract === CAPTURE_SESSION_CONTRACT && value.status === "pending" && hasOnlyKeys(value, commonKeys)) return ok({ ...common, status: "pending" });
  if (value.contract === CAPTURE_SESSION_CONTRACT && value.status === "launching" && hasOnlyKeys(value, commonKeys)) return ok({ ...common, status: "launching" });
  if (value.contract === CAPTURE_SESSION_CONTRACT && value.status === "recording" && hasOnlyKeys(value, [...commonKeys, "recorder"]) && isRecorderProcessEvidence(value.recorder)) {
    return ok({ ...common, status: "recording", recorder: value.recorder });
  }
  if (value.status === "post_exit" && hasOnlyKeys(value, [...commonKeys, "recorderExitedAt"]) && isCanonicalTimestamp(value.recorderExitedAt)) {
    return ok({ ...common, status: "post_exit", recorderExitedAt: value.recorderExitedAt });
  }
  if (value.status === "resolving") {
    if (value.resolution === "promote" && hasOnlyKeys(value, [...commonKeys, "resolution", "artifact"]) && isSafeArtifact(value.artifact, captureId)) {
      return ok({ ...common, status: "resolving", resolution: "promote", artifact: value.artifact });
    }
    if (value.resolution === "reject" && hasOnlyKeys(value, [...commonKeys, "resolution", "reason", "detectionCount"])
      && (value.reason === "sensitive-content" || value.reason === "scan-incomplete" || value.reason === "unsafe-artifact")
      && typeof value.detectionCount === "number" && Number.isSafeInteger(value.detectionCount) && value.detectionCount >= 0) {
      return ok({ ...common, status: "resolving", resolution: "reject", reason: value.reason, detectionCount: value.detectionCount });
    }
    if (value.resolution === "fail" && hasOnlyKeys(value, [...commonKeys, "resolution", "reason"])
      && (value.reason === "recorder-exit" || value.reason === "recorder-prerequisite-or-process-failure")) {
      return ok({ ...common, status: "resolving", resolution: "fail", reason: value.reason });
    }
    if (value.resolution === "interrupt" && hasOnlyKeys(value, [...commonKeys, "resolution", "reason"])
      && (value.reason === "operator-cancelled" || value.reason === "signal")) {
      return ok({ ...common, status: "resolving", resolution: "interrupt", reason: value.reason });
    }
  }
  if (value.status === "promoted" && hasOnlyKeys(value, [...commonKeys, "artifact", "completedAt"])
    && isSafeArtifact(value.artifact, captureId) && isCanonicalTimestamp(value.completedAt)) {
    return ok({ ...common, status: "promoted", artifact: value.artifact, completedAt: value.completedAt });
  }
  if (value.status === "rejected" && hasOnlyKeys(value, [...commonKeys, "reason", "detectionCount", "completedAt"])
    && (value.reason === "sensitive-content" || value.reason === "scan-incomplete" || value.reason === "unsafe-artifact")
    && typeof value.detectionCount === "number" && Number.isSafeInteger(value.detectionCount) && value.detectionCount >= 0 && isCanonicalTimestamp(value.completedAt)) {
    return ok({ ...common, status: "rejected", reason: value.reason, detectionCount: value.detectionCount, completedAt: value.completedAt });
  }
  if (value.status === "failed" && hasOnlyKeys(value, [...commonKeys, "reason", "completedAt"])
    && (value.reason === "recorder-exit" || value.reason === "recorder-prerequisite-or-process-failure") && isCanonicalTimestamp(value.completedAt)) {
    return ok({ ...common, status: "failed", reason: value.reason, completedAt: value.completedAt });
  }
  if (value.status === "interrupted" && hasOnlyKeys(value, [...commonKeys, "reason", "completedAt"])
    && (value.reason === "operator-cancelled" || value.reason === "signal") && isCanonicalTimestamp(value.completedAt)) {
    return ok({ ...common, status: "interrupted", reason: value.reason, completedAt: value.completedAt });
  }
  return captureRefusal(captureId);
}

function commonOf(session: CaptureSession): CaptureSessionCommon {
  return {
    contract: session.contract,
    projectId: session.projectId,
    captureId: session.captureId,
    requestId: session.requestId,
    inputHash: session.inputHash,
    secretSourceReferences: session.secretSourceReferences,
    createdAt: session.createdAt,
  };
}

function transitionRefusal(captureId: CaptureId, from: CaptureSession["status"], to: "launching" | "recording" | "post_exit" | "resolving" | "terminal"): Result<never, CaptureRefusal> {
  return err({ rule: "capture-illegal-transition", captureId, from, to });
}

function detailFor(record: CaptureResolutionDecision, captureId: CaptureId): Result<ResolvingDetails, CaptureRefusal> {
  if (record.resolution === "promote") {
    if (record.artifact === undefined || !isSafeArtifact(record.artifact, captureId)) return captureRefusal(captureId);
    return ok({ resolution: "promote", artifact: record.artifact });
  }
  if (record.resolution === "reject") {
    const reason = record.reason ?? "sensitive-content";
    if (!(reason === "sensitive-content" || reason === "scan-incomplete" || reason === "unsafe-artifact")
      || !Number.isSafeInteger(record.detectionCount ?? 0) || (record.detectionCount ?? 0) < 0) return captureRefusal(captureId);
    return ok({ resolution: "reject", detectionCount: record.detectionCount ?? 0, reason });
  }
  if (record.resolution === "fail") {
    const reason = record.reason ?? "recorder-prerequisite-or-process-failure";
    return reason === "recorder-exit" || reason === "recorder-prerequisite-or-process-failure"
      ? ok({ resolution: "fail", reason }) : captureRefusal(captureId);
  }
  const reason = record.reason ?? "operator-cancelled";
  return reason === "operator-cancelled" || reason === "signal"
    ? ok({ resolution: "interrupt", reason }) : captureRefusal(captureId);
}

function sameResolution(details: ResolvingDetails, session: CaptureSession): boolean {
  if (session.status === "resolving") {
    return session.resolution === details.resolution
      && session.reason === details.reason
      && session.detectionCount === details.detectionCount
      && session.artifact?.reference === details.artifact?.reference
      && session.artifact?.byteSize === details.artifact?.byteSize
      && session.artifact?.sha256 === details.artifact?.sha256;
  }
  if (details.resolution === "promote") return session.status === "promoted"
    && session.artifact.reference === details.artifact?.reference
    && session.artifact.byteSize === details.artifact?.byteSize
    && session.artifact.sha256 === details.artifact?.sha256;
  if (details.resolution === "reject") return session.status === "rejected"
    && session.reason === details.reason && session.detectionCount === details.detectionCount;
  if (details.resolution === "fail") return session.status === "failed" && session.reason === details.reason;
  return session.status === "interrupted" && session.reason === details.reason;
}

const beaconIdPattern = new RegExp(`^bcn_${UUID_V7}$`);
const draftIdPattern = new RegExp(`^drf_${UUID_V7}$`);

function isBeaconId(value: unknown): value is BeaconId {
  return typeof value === "string" && beaconIdPattern.test(value);
}

function isDraftId(value: unknown): value is `drf_${string}` {
  return typeof value === "string" && draftIdPattern.test(value);
}

function associationCaptureId(value: unknown, expectedCaptureId?: CaptureId): CaptureId {
  return expectedCaptureId ?? (typeof value === "string" && isCaptureId(value) ? value : "cap_invalid" as CaptureId);
}

function associationFrom(value: unknown, expectedCaptureId?: CaptureId, expectedBeaconId?: BeaconId): Result<CaptureBeaconAssociation, CaptureRefusal> {
  const rawCaptureId = isRecord(value) ? value.captureId : undefined;
  const refusal = () => captureRefusal(associationCaptureId(rawCaptureId, expectedCaptureId));
  if (!isRecord(value)
    || value.contract !== "pharos.capture-beacon-association/1"
    || (value.state !== "pending" && value.state !== "committed")
    || typeof value.projectId !== "string" || !isProjectId(value.projectId)
    || typeof value.captureId !== "string" || !isCaptureId(value.captureId) || (expectedCaptureId !== undefined && value.captureId !== expectedCaptureId)
    || !isRequestId(value.requestId)
    || typeof value.inputHash !== "string" || value.inputHash.trim().length === 0
    || !isBeaconId(value.beaconId) || (expectedBeaconId !== undefined && value.beaconId !== expectedBeaconId)
    || !isDraftId(value.draftId)
    || value.revision !== 1
    || !isCanonicalTimestamp(value.createdAt)) return refusal();
  if (value.state === "pending") {
    if (!hasOnlyKeys(value, ["contract", "state", "projectId", "captureId", "requestId", "inputHash", "beaconId", "draftId", "revision", "createdAt"])) return refusal();
    return ok({ contract: "pharos.capture-beacon-association/1", state: "pending", projectId: value.projectId, captureId: value.captureId, requestId: value.requestId, inputHash: value.inputHash, beaconId: value.beaconId, draftId: value.draftId, revision: 1, createdAt: value.createdAt });
  }
  if (!hasOnlyKeys(value, ["contract", "state", "projectId", "captureId", "requestId", "inputHash", "beaconId", "draftId", "revision", "semanticHash", "createdAt", "committedAt"])
    || typeof value.semanticHash !== "string" || value.semanticHash.trim().length === 0
    || !isCanonicalTimestamp(value.committedAt)) return refusal();
  return ok({ contract: "pharos.capture-beacon-association/1", state: "committed", projectId: value.projectId, captureId: value.captureId, requestId: value.requestId, inputHash: value.inputHash, beaconId: value.beaconId, draftId: value.draftId, revision: 1, semanticHash: value.semanticHash, createdAt: value.createdAt, committedAt: value.committedAt });
}

function sameAssociationClaim(left: CaptureBeaconAssociation, right: CaptureBeaconAssociation): boolean {
  return left.contract === right.contract
    && left.projectId === right.projectId
    && left.captureId === right.captureId
    && left.requestId === right.requestId
    && left.inputHash === right.inputHash
    && left.beaconId === right.beaconId
    && left.draftId === right.draftId
    && left.revision === right.revision
    && left.createdAt === right.createdAt;
}

function sameAssociation(left: CaptureBeaconAssociation, right: CaptureBeaconAssociation): boolean {
  return sameAssociationClaim(left, right)
    && left.state === right.state
    && left.semanticHash === right.semanticHash
    && left.committedAt === right.committedAt;
}

/** Replay identity deliberately excludes generated IDs and timestamps. */
function sameAnnotationRequest(left: CaptureBeaconAssociation, right: CaptureBeaconAssociation): boolean {
  return left.projectId === right.projectId
    && left.captureId === right.captureId
    && left.requestId === right.requestId
    && left.inputHash === right.inputHash;
}

/** Filesystem owner for non-authoritative capture state. It never reads or writes BeaconStore data. */
export class FsCaptureStore implements CaptureStore {
  private readonly projectRoot: string;
  private readonly lock: ProjectLock;
  private readonly observer?: CaptureStoreObserver;

  constructor(options: FsCaptureStoreOptions) {
    this.projectRoot = options.projectRoot;
    this.lock = options.lock ?? new ProjectLock(options.projectRoot);
    this.observer = options.observer;
  }

  async beginLaunch(command: BeginCaptureCommand): Promise<Result<{ readonly session: CaptureSession; readonly claimed: boolean }, BeginLaunchRefusal>> {
    if (!isCaptureId(command.captureId)) return err({ rule: "capture-not-found", captureId: command.captureId });
    return this.withLease(() => this.beginUnlocked(command));
  }

  private async beginUnlocked(command: BeginCaptureCommand): Promise<Result<{ readonly session: CaptureSession; readonly claimed: boolean }, BeginLaunchRefusal>> {
    const requested = requestFrom(command, command.captureId, command.requestId);
    if (requested === undefined) return captureRefusal(command.captureId);
    const requestPath = this.requestPath(command.requestId);
    const existingRequest = await this.readRequest(requestPath, null, command.requestId);
    if (!existingRequest.ok) return captureRefusal(command.captureId);
    const plan = existingRequest.value ?? requested;
    let session: CaptureSession;
    if (existingRequest.value !== null) {
      if (!sameRequest(existingRequest.value, command)) {
        return err({ rule: "capture-request-conflict", requestId: command.requestId });
      }
      const stored = await this.getSessionUnlocked(plan.captureId);
      if (stored.ok) {
        if (plan.completion !== undefined && plan.completion.status !== stored.value.status) return captureRefusal(plan.captureId);
        if (stored.value.status !== "pending") return ok({ session: stored.value, claimed: false });
        const active = await this.activeProjectSession(command.projectId, stored.value.captureId);
        if (!active.ok) return active;
        if (active.value !== null) return err({ rule: "capture-process-still-active", captureId: active.value.captureId });
        session = stored.value;
      } else {
        if (stored.error.rule !== "capture-not-found") return stored;
        if (plan.completion !== undefined) return captureRefusal(plan.captureId);
        const active = await this.activeProjectSession(command.projectId, plan.captureId);
        if (!active.ok) return active;
        if (active.value !== null) return err({ rule: "capture-process-still-active", captureId: active.value.captureId });
        await ensurePrivateDirectory(this.stageDirectory(plan.captureId));
        session = { ...plan, contract: CAPTURE_SESSION_CONTRACT, status: "pending" };
        await this.writeSession(session);
        await this.notify("pending-written", session.captureId);
      }
    } else {
      const active = await this.activeProjectSession(command.projectId, plan.captureId);
      if (!active.ok) return active;
      if (active.value !== null) return err({ rule: "capture-process-still-active", captureId: active.value.captureId });
      await writePrivateJson(requestPath, requested);
      await ensurePrivateDirectory(this.stageDirectory(plan.captureId));
      session = { ...plan, contract: CAPTURE_SESSION_CONTRACT, status: "pending" };
      await this.writeSession(session);
      await this.notify("pending-written", session.captureId);
    }
    const launching: Extract<CaptureSession, { status: "launching" }> = { ...commonOf(session), status: "launching" };
    await this.writeSession(launching);
    return ok({ session: launching, claimed: true });
  }

  private async activeProjectSession(
    projectId: ProjectId,
    exceptCaptureId: CaptureId,
  ): Promise<Result<CaptureSession | null, CaptureRefusal>> {
    for (const captureId of await this.captureIds()) {
      if (captureId === exceptCaptureId) continue;
      const read = await this.getSessionUnlocked(captureId);
      if (!read.ok) return read;
      if (read.value.projectId === projectId && !isTerminalStatus(read.value.status)) return ok(read.value);
    }
    return ok(null);
  }

  async recordRecorderStarted(projectId: ProjectId, captureId: CaptureId, evidence: RecorderProcessEvidence): Promise<Result<CaptureSession, CaptureRefusal>> {
    return this.mutate(captureId, async (session) => {
      if (session.projectId !== projectId || !isRecorderProcessEvidence(evidence)) return captureRefusal(captureId);
      if (session.status === "recording") {
        return session.recorder.pid === evidence.pid && session.recorder.identity === evidence.identity
          ? ok(session)
          : captureRefusal(captureId);
      }
      if (session.status !== "launching") return transitionRefusal(captureId, session.status, "recording");
      const next: CaptureSession = { ...commonOf(session), status: "recording", recorder: evidence };
      await this.writeSession(next);
      return ok(next);
    });
  }

  async markPostExit(projectId: ProjectId, captureId: CaptureId, exitedAt: string): Promise<Result<CaptureSession, CaptureRefusal>> {
    return this.mutate(captureId, async (session) => {
      if (session.projectId !== projectId) return captureRefusal(captureId);
      if (session.status !== "launching" && session.status !== "recording") return transitionRefusal(captureId, session.status, "post_exit");
      const next: CaptureSession = { ...commonOf(session), status: "post_exit", recorderExitedAt: exitedAt };
      await this.writeSession(next);
      return ok(next);
    });
  }

  async resolve(projectId: ProjectId, captureId: CaptureId, decision: CaptureResolutionDecision, completedAt: string): Promise<Result<CaptureSession, CaptureRefusal>> {
    if (!isCanonicalTimestamp(completedAt)) return captureRefusal(captureId);
    return this.mutate(captureId, async (session) => {
      if (session.projectId !== projectId) return captureRefusal(captureId);
      return this.resolveUnlocked(
        session,
        decision,
        completedAt,
        (status, resolution) => (resolution === "promote" || resolution === "reject")
          ? status === "post_exit"
          : status === "launching" || status === "recording",
      );
    });
  }

  async recoverProject(projectId: ProjectId, recoveredAt: string): Promise<Result<{
    readonly recovered: readonly Extract<CaptureSession, { status: "promoted" | "rejected" | "failed" | "interrupted" }>[];
    readonly blocked: readonly Extract<CaptureSession, { status: "launching" | "recording" }>[];
  }, CaptureRefusal>> {
    if (!isCanonicalTimestamp(recoveredAt)) return captureRefusal("cap_invalid" as CaptureId);
    return this.withLease(async () => {
      await this.sweepStaleTemps();
      const recovered: Extract<CaptureSession, { status: "promoted" | "rejected" | "failed" | "interrupted" }>[] = [];
      const blocked: Extract<CaptureSession, { status: "launching" | "recording" }>[] = [];
      for (const captureId of await this.captureIds()) {
        const read = await this.getSessionUnlocked(captureId);
        if (!read.ok) return read;
        const session = read.value;
        if (session.projectId !== projectId) continue;
        if (session.status === "launching" || session.status === "recording") {
          blocked.push(session);
          continue;
        }
        if (isTerminalStatus(session.status)) continue;
        let finished: Result<CaptureSession, CaptureRefusal>;
        if (session.status === "pending") {
          finished = await this.resolveUnlocked(
            session,
            { resolution: "fail", reason: "recorder-prerequisite-or-process-failure" },
            recoveredAt,
            (status) => status === "pending",
          );
        } else if (session.status === "post_exit") {
          finished = await this.resolveUnlocked(
            session,
            { resolution: "reject", reason: "scan-incomplete", detectionCount: 0 },
            recoveredAt,
            (status) => status === "post_exit",
          );
        } else if (session.status === "resolving") {
          finished = await this.completeStoredResolutionUnlocked(session, recoveredAt);
        } else {
          return captureRefusal(session.captureId);
        }
        if (!finished.ok) return finished;
        recovered.push(finished.value as Extract<CaptureSession, { status: "promoted" | "rejected" | "failed" | "interrupted" }>);
      }
      return ok({ recovered, blocked });
    });
  }

  async getSession(projectId: ProjectId, captureId: CaptureId): Promise<Result<CaptureSession, CaptureRefusal>> {
    const session = await this.getSessionUnlocked(captureId);
    if (!session.ok || session.value.projectId === projectId) return session;
    return captureRefusal(captureId);
  }

  async claimAnnotation(association: CaptureBeaconAssociation): Promise<Result<CaptureBeaconAssociation, CaptureRefusal>> {
    return this.writeAssociation(association, "pending");
  }

  async commitAssociation(association: CaptureBeaconAssociation): Promise<Result<CaptureBeaconAssociation, CaptureRefusal>> {
    return this.writeAssociation({ ...association, state: "committed" }, "committed");
  }

  async getAssociationByCapture(projectId: ProjectId, captureId: CaptureId): Promise<Result<CaptureBeaconAssociation | null, CaptureRefusal>> {
    const forward = await this.readAssociationFile(this.captureAssociationPath(captureId), projectId, captureId);
    if (!forward.ok || forward.value === null) return forward;
    const reverse = await this.readAssociationFile(this.beaconAssociationPath(forward.value.beaconId), projectId, captureId, forward.value.beaconId);
    if (!reverse.ok || reverse.value === null || !sameAssociation(forward.value, reverse.value)) return captureRefusal(captureId);
    return forward;
  }

  async getAssociationByBeacon(projectId: ProjectId, beaconId: BeaconId): Promise<Result<CaptureBeaconAssociation | null, CaptureRefusal>> {
    const reverse = await this.readAssociationFile(this.beaconAssociationPath(beaconId), projectId, undefined, beaconId);
    if (!reverse.ok || reverse.value === null) return reverse;
    const forward = await this.readAssociationFile(this.captureAssociationPath(reverse.value.captureId), projectId, reverse.value.captureId, beaconId);
    if (!forward.ok || forward.value === null || !sameAssociation(reverse.value, forward.value)) return captureRefusal(reverse.value.captureId);
    return reverse;
  }

  private async resolveUnlocked(
    session: CaptureSession,
    decision: CaptureResolutionDecision,
    completedAt: string,
    mayResolve: (status: CaptureSession["status"], resolution: CaptureResolution) => boolean,
  ): Promise<Result<CaptureSession, CaptureRefusal>> {
    const details = detailFor(decision, session.captureId);
    if (!details.ok) return details;
    if (isTerminalStatus(session.status)) {
      if (!sameResolution(details.value, session)) {
        return err({ rule: "capture-resolution-conflict", captureId: session.captureId });
      }
      const completion = await this.writeRequestCompletion(session);
      return completion.ok ? ok(session) : completion;
    }
    let resolving: StoredResolving;
    if (session.status === "resolving") {
      if (!sameResolution(details.value, session)) {
        return err({ rule: "capture-resolution-conflict", captureId: session.captureId });
      }
      resolving = session;
    } else {
      if (!mayResolve(session.status, decision.resolution)) {
        return transitionRefusal(session.captureId, session.status, "resolving");
      }
      resolving = { ...commonOf(session), status: "resolving", ...details.value };
      await this.writeSession(resolving);
      await this.notify("resolution-decision-recorded", session.captureId);
    }
    return this.completeStoredResolutionUnlocked(resolving, completedAt);
  }

  private async completeStoredResolutionUnlocked(
    resolving: StoredResolving,
    completedAt: string,
  ): Promise<Result<CaptureSession, CaptureRefusal>> {
    const next = await this.completeResolution(resolving, completedAt);
    if (!next.ok) return next;
    await this.writeSession(next.value);
    const completion = await this.writeRequestCompletion(next.value);
    return completion.ok ? next : completion;
  }

  private async completeResolution(session: StoredResolving, completedAt: string): Promise<Result<CaptureSession, CaptureRefusal>> {
    if (session.resolution === "promote") {
      if (session.artifact === undefined) return captureRefusal(session.captureId);
      const promotion = await this.promote(session.captureId, session.artifact);
      if (!promotion.ok) return promotion;
      return ok({ ...commonOf(session), status: "promoted", artifact: session.artifact, completedAt });
    }
    await this.removeStage(session.captureId);
    if (session.resolution === "reject") return ok({ ...commonOf(session), status: "rejected", reason: session.reason as "sensitive-content" | "scan-incomplete" | "unsafe-artifact", detectionCount: session.detectionCount as number, completedAt });
    if (session.resolution === "fail") return ok({ ...commonOf(session), status: "failed", reason: session.reason as "recorder-exit" | "recorder-prerequisite-or-process-failure", completedAt });
    return ok({ ...commonOf(session), status: "interrupted", reason: session.reason as "operator-cancelled" | "signal", completedAt });
  }

  private async promote(captureId: CaptureId, artifact: PromotedCaptureArtifact): Promise<Result<void, CaptureRefusal>> {
    const staged = join(this.stageDirectory(captureId), STAGED_RECORDING);
    const destination = join(this.captureDirectory(captureId), PROMOTED_RECORDING);
    try {
      await lstat(staged);
    } catch (error) {
      if (!isErrno(error, "ENOENT")) throw error;
      return this.verifyDestination(destination, artifact, captureId);
    }
    const stageInfo = await this.regularFile(staged, captureId);
    if (!stageInfo.ok) return stageInfo;
    const digest = await this.digest(staged);
    if (digest.sha256 !== artifact.sha256 || digest.byteSize !== artifact.byteSize) return captureRefusal(captureId);
    let linked = false;
    try {
      await link(staged, destination);
      linked = true;
      await this.notify("promoted-materialized", captureId);
    } catch (error) {
      if (!isErrno(error, "EEXIST")) throw error;
    }
    const verified = await this.verifyDestination(destination, artifact, captureId);
    if (!verified.ok) {
      if (linked) await unlink(destination);
      return verified;
    }
    await this.removeStage(captureId);
    return ok(undefined);
  }

  private async verifyDestination(destination: string, artifact: PromotedCaptureArtifact, captureId: CaptureId): Promise<Result<void, CaptureRefusal>> {
    const existing = await this.regularFile(destination, captureId);
    if (!existing.ok) return existing;
    const existingDigest = await this.digest(destination);
    return existingDigest.sha256 === artifact.sha256 && existingDigest.byteSize === artifact.byteSize
      ? ok(undefined)
      : captureRefusal(captureId);
  }

  private async removeStage(captureId: CaptureId): Promise<void> {
    const path = join(this.stageDirectory(captureId), STAGED_RECORDING);
    try {
      await unlink(path);
      await this.notify("stage-unlinked", captureId);
    } catch (error) { if (!isErrno(error, "ENOENT")) throw error; }
    const directory = await open(this.stageDirectory(captureId), "r");
    try { await directory.sync(); } finally { await directory.close(); }
  }

  private async regularFile(path: string, captureId: CaptureId): Promise<Result<void, CaptureRefusal>> {
    try {
      const stat = await lstat(path);
      if (stat.isSymbolicLink() || !stat.isFile()) return captureRefusal(captureId);
      const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try { if (!(await handle.stat()).isFile()) return captureRefusal(captureId); } finally { await handle.close(); }
      return ok(undefined);
    } catch { return captureRefusal(captureId); }
  }

  private async digest(path: string): Promise<{ sha256: string; byteSize: number }> {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const bytes = await handle.readFile();
      return { sha256: createHash("sha256").update(bytes).digest("hex"), byteSize: bytes.byteLength };
    } finally { await handle.close(); }
  }

  private async withLease<T>(operation: () => Promise<T>): Promise<T> {
    await this.prepare();
    const acquired = await this.lock.acquire();
    if (!acquired.ok) throw new Error("capture project lock is unavailable");
    const lease = acquired.value;
    try {
      return await operation();
    } finally { await lease.release(); }
  }

  private async mutate(captureId: CaptureId, operation: (session: CaptureSession) => Promise<Result<CaptureSession, CaptureRefusal>>): Promise<Result<CaptureSession, CaptureRefusal>> {
    return this.withLease(async () => {
      const session = await this.getSessionUnlocked(captureId);
      return session.ok ? operation(session.value) : session;
    });
  }

  private async prepare(): Promise<void> {
    await ensurePrivateDirectory(this.projectRoot);
    await ensurePrivateDirectory(join(this.projectRoot, "capture-journal"));
    await ensurePrivateDirectory(join(this.projectRoot, "capture-journal", "requests"));
    await ensurePrivateDirectory(join(this.projectRoot, "capture-staging"));
    await ensurePrivateDirectory(join(this.projectRoot, "captures"));
    await ensurePrivateDirectory(join(this.projectRoot, "capture-associations"));
    await ensurePrivateDirectory(join(this.projectRoot, "capture-associations", "by-capture"));
    await ensurePrivateDirectory(join(this.projectRoot, "capture-associations", "by-beacon"));
  }

  private requestPath(requestId: RequestId): string { return join(this.projectRoot, "capture-journal", "requests", `${requestHash(requestId)}.json`); }
  private captureDirectory(captureId: CaptureId): string { return join(this.projectRoot, "captures", captureId); }
  private stageDirectory(captureId: CaptureId): string { return join(this.projectRoot, "capture-staging", captureId); }
  private sessionPath(captureId: CaptureId): string { return join(this.captureDirectory(captureId), "session.json"); }
  private captureAssociationPath(captureId: CaptureId): string { return join(this.projectRoot, "capture-associations", "by-capture", `${captureId}.json`); }
  private beaconAssociationPath(beaconId: BeaconId): string { return join(this.projectRoot, "capture-associations", "by-beacon", `${beaconId}.json`); }

  private async writeSession(session: CaptureSession): Promise<void> {
    await ensurePrivateDirectory(this.captureDirectory(session.captureId));
    await this.notify("before-session-write", session.captureId);
    await writePrivateJson(this.sessionPath(session.captureId), session);
    await this.notify("session-written", session.captureId);
  }

  private async getSessionUnlocked(captureId: CaptureId): Promise<Result<CaptureSession, CaptureRefusal>> {
    if (!isCaptureId(captureId)) return err({ rule: "capture-not-found", captureId });
    try { return sessionFrom(await readJson(this.sessionPath(captureId)), captureId); }
    catch (error) { return isErrno(error, "ENOENT") ? err({ rule: "capture-not-found", captureId }) : captureRefusal(captureId); }
  }

  private async readRequest(path: string, expectedCaptureId: CaptureId | null, requestId: RequestId): Promise<Result<StoredRequest | null, CaptureRefusal>> {
    const refusalCaptureId = expectedCaptureId ?? "cap_invalid" as CaptureId;
    try {
      const parsed = requestFrom(await readJson(path), expectedCaptureId ?? undefined, requestId);
      return parsed === undefined ? captureRefusal(refusalCaptureId) : ok(parsed);
    } catch (error) {
      return isErrno(error, "ENOENT") ? ok(null) : captureRefusal(refusalCaptureId);
    }
  }

  private async writeRequestCompletion(session: CaptureSession): Promise<Result<void, CaptureRefusal>> {
    const path = this.requestPath(session.requestId);
    const request = await this.readRequest(path, session.captureId, session.requestId);
    if (!request.ok || request.value === null || !isTerminalStatus(session.status)) return captureRefusal(session.captureId);
    if (request.value.completion !== undefined && request.value.completion.status !== session.status) return captureRefusal(session.captureId);
    await writePrivateJson(path, { ...request.value, completion: { status: session.status, captureId: session.captureId } });
    await this.notify("journal-completed", session.captureId);
    return ok(undefined);
  }

  private async captureIds(): Promise<CaptureId[]> {
    const entries = await readdir(join(this.projectRoot, "captures"), { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory() && isCaptureId(entry.name)).map((entry) => entry.name as CaptureId).sort();
  }

  /** Sweep only old regular sibling temporaries while holding the project lock. */
  private async sweepStaleTemps(): Promise<void> {
    const roots = [
      join(this.projectRoot, "capture-journal"),
      join(this.projectRoot, "capture-staging"),
      join(this.projectRoot, "captures"),
      join(this.projectRoot, "capture-associations"),
    ];
    for (const root of roots) await this.sweepDirectory(root);
  }

  private async sweepDirectory(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const stat = await lstat(path);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        await this.sweepDirectory(path);
      } else if (stat.isFile() && entry.name.includes(".tmp.") && Date.now() - stat.mtimeMs >= this.lock.staleAfterMs) {
        await unlink(path);
      }
    }
  }

  private async writeAssociation(association: CaptureBeaconAssociation, expectedState: "pending" | "committed"): Promise<Result<CaptureBeaconAssociation, CaptureRefusal>> {
    await this.prepare();
    const requested = associationFrom(association, association.captureId, association.beaconId);
    if (!requested.ok || requested.value.state !== expectedState) return captureRefusal(association.captureId);
    const acquired = await this.lock.acquire();
    if (!acquired.ok) throw new Error("capture project lock is unavailable");
    const lease = acquired.value;
    try {
      // The capture-side claim is authoritative for replay identity. Do not
      // reject a retry merely because its newly generated IDs differ.
      const forward = await this.readAssociationFile(this.captureAssociationPath(association.captureId), association.projectId, association.captureId);
      if (!forward.ok) return forward;
      const replayBeaconId = forward.value?.beaconId ?? association.beaconId;
      const reverse = await this.readAssociationFile(this.beaconAssociationPath(replayBeaconId), association.projectId, undefined, replayBeaconId);
      if (!reverse.ok) return reverse;
      if (forward.value !== null && reverse.value !== null && forward.value.state === reverse.value.state && !sameAssociation(forward.value, reverse.value)) {
        return err({ rule: "capture-association-conflict", captureId: association.captureId });
      }
      const existing = [forward.value, reverse.value].filter((value): value is CaptureBeaconAssociation => value !== null);
      for (const stored of existing) {
        if (!sameAnnotationRequest(stored, requested.value)) {
          return err({ rule: "capture-association-conflict", captureId: association.captureId });
        }
      }
      const committed = existing.find((value) => value.state === "committed");
      if (committed !== undefined && expectedState === "committed"
        && (committed.semanticHash !== requested.value.semanticHash || !sameAssociationClaim(committed, requested.value))) {
        return err({ rule: "capture-association-conflict", captureId: association.captureId });
      }
      const target = committed ?? existing[0] ?? requested.value;
      if (expectedState === "committed" && target.state !== "committed") {
        if (!sameAssociationClaim(target, requested.value)) return err({ rule: "capture-association-conflict", captureId: association.captureId });
      }
      const completed = expectedState === "committed" && target.state !== "committed"
        ? requested.value
        : target;
      if (forward.value === null || !sameAssociation(forward.value, completed)) {
        await writePrivateJson(this.captureAssociationPath(completed.captureId), completed);
        await this.notify("association-capture-written", completed.captureId);
      }
      if (reverse.value === null || !sameAssociation(reverse.value, completed)) {
        await writePrivateJson(this.beaconAssociationPath(completed.beaconId), completed);
        await this.notify("association-beacon-written", completed.captureId);
      }
      return ok(completed);
    } finally { await lease.release(); }
  }

  private async notify(stage: CaptureStoreStage, captureId: CaptureId): Promise<void> {
    await this.observer?.onStage(stage, captureId);
  }

  private async readAssociationFile(path: string, projectId: ProjectId, captureId?: CaptureId, beaconId?: BeaconId): Promise<Result<CaptureBeaconAssociation | null, CaptureRefusal>> {
    try {
      const parsed = associationFrom(await readJson(path), captureId, beaconId);
      if (!parsed.ok || parsed.value.projectId !== projectId) return captureRefusal(captureId ?? (parsed.ok ? parsed.value.captureId : "cap_invalid" as CaptureId));
      return parsed;
    } catch (error) {
      return isErrno(error, "ENOENT") ? ok(null) : captureRefusal(captureId ?? "cap_invalid" as CaptureId);
    }
  }
}
