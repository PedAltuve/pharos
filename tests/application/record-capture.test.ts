import { describe, expect, it } from "vitest";
import {
  RecordCapture,
  type RecordCaptureDependencies,
  type RecordCaptureRequest,
} from "../../src/application/record-capture.js";
import type { CaptureSession } from "../../src/domain/capture/index.js";
import type {
  CaptureStore,
  Clock,
  Hasher,
  IdGenerator,
  Recorder,
  RecorderResult,
  SecretResolver,
  SecretResolutionRefusal,
  SensitivityScanner,
} from "../../src/domain/ports/index.js";
import type { RecorderRun } from "../../src/domain/ports/recorder.js";
import { err, ok } from "../../src/shared/result.js";

const projectId = "proj_018f47de-7a00-7cc0-8000-000000000001" as const;
const captureId = "cap_018f47de-7a00-7cc0-8000-000000000001" as const;
const requestId = "req_018f47de-7a00-7cc0-8000-000000000001" as const;
const timestamp = "2026-03-04T00:00:00.000Z";
const canary = "do-not-persist-or-return-this-secret";
const artifact = {
  reference: `captures/${captureId}/recording.spec.ts`,
  byteSize: 2,
  sha256: "a".repeat(64),
};
const recorderEvidence = { pid: 4242, identity: "a".repeat(64) };

const request = (
  overrides: Partial<RecordCaptureRequest> = {},
): RecordCaptureRequest => ({
  projectId,
  contextRevision: 1,
  url: "http://localhost:3000/",
  requestId,
  secretSourceReferences: ["env:CAPTURE_TOKEN"],
  noSecretSources: false,
  terminalMode: "human",
  signal: { aborted: false, onAbort: () => () => {} },
  ...overrides,
});

function pending(): Extract<CaptureSession, { status: "pending" }> {
  return {
    contract: "pharos.capture-session/2",
    projectId,
    captureId,
    requestId,
    inputHash: "references-only-hash",
    secretSourceReferences: ["env:CAPTURE_TOKEN"],
    createdAt: timestamp,
    status: "pending",
  };
}
function completedRun(
  result: RecorderResult,
  evidence: { readonly pid: number; readonly identity: string } | undefined = { pid: 4242, identity: "a".repeat(64) },
): RecorderRun {
  return {
    evidence,
    async waitForCompletion() {
      return result;
    },
    contain() {},
  };
}
function terminal(
  decision: {
    readonly resolution: string;
    readonly reason?: string;
    readonly detectionCount?: number;
    readonly artifact?: typeof artifact;
  },
  completedAt: string,
): CaptureSession {
  if (decision.resolution === "promote")
    return {
      ...pending(),
      status: "promoted",
      artifact: decision.artifact ?? artifact,
      completedAt,
    };
  if (decision.resolution === "reject")
    return {
      ...pending(),
      status: "rejected",
      reason: (decision.reason ?? "scan-incomplete") as "scan-incomplete",
      detectionCount: decision.detectionCount ?? 0,
      completedAt,
    };
  if (decision.resolution === "fail")
    return {
      ...pending(),
      status: "failed",
      reason: (decision.reason ?? "recorder-exit") as "recorder-exit",
      completedAt,
    };
  return {
    ...pending(),
    status: "interrupted",
    reason: (decision.reason ?? "signal") as "signal",
    completedAt,
  };
}
function dependencies(
  events: string[] = [],
): RecordCaptureDependencies & {
  store: CaptureStore;
  recorder: Recorder;
  resolver: SecretResolver;
  scanner: SensitivityScanner;
} {
  const store: CaptureStore = {
    async recoverProject() {
      events.push("recover-project");
      return ok({ recovered: [], blocked: [] });
    },
    async beginLaunch(command) {
      events.push(`begin-launch:${command.inputHash}`);
      return ok({
        session: { ...pending(), ...command, status: "launching" },
        claimed: true,
      });
    },
    async recordRecorderStarted(_project, _capture, evidence) {
      events.push(`started:${evidence.pid}`);
      return ok({ ...pending(), status: "recording", recorder: evidence });
    },
    async markPostExit(_project, _capture, exitedAt) {
      events.push("post-exit");
      return ok({
        ...pending(),
        status: "post_exit",
        recorderExitedAt: exitedAt,
      });
    },
    async resolve(_project, _capture, decision, completedAt) {
      events.push(`resolve:${decision.resolution}:${decision.reason ?? ""}`);
      return ok(terminal(decision, completedAt));
    },
    async getSession() {
      return err({ rule: "capture-not-found", captureId });
    },
    async claimAnnotation() {
      return err({ rule: "capture-not-found", captureId });
    },
    async commitAssociation() {
      return err({ rule: "capture-not-found", captureId });
    },
    async getAssociationByCapture() {
      return ok(null);
    },
    async getAssociationByBeacon() {
      return ok(null);
    },
  };
  let disposed = false;
  const resolver: SecretResolver = {
    async resolve(references) {
      events.push(`secrets:${references.join(",")}`);
      return ok({
        values: new Map([["env:CAPTURE_TOKEN", canary]]),
        dispose: () => {
          disposed = true;
          events.push("dispose");
        },
      });
    },
  };
  const recorder: Recorder = {
    async start(command) {
      events.push(`record:${command.captureId}`);
      expect(disposed).toBe(false);
      return completedRun({ kind: "exited", exitCode: 0 });
    },
    async probeProcess() {
      return "same";
    },
  };
  const scanner: SensitivityScanner = {
    async scan(command) {
      events.push(`scan:${command.resolvedSecrets.size}`);
      return ok(artifact);
    },
  };
  return {
    clock: { now: () => new Date(timestamp) } as Clock,
    ids: { next: () => captureId } as IdGenerator,
    hasher: { hash: (value) => `hash:${JSON.stringify(value)}` } as Hasher,
    store,
    resolver,
    recorder,
    scanner,
  };
}

describe("RecordCapture v2 lifecycle", () => {
  it("refuses an omitted secret declaration before resolution, allocation, recovery, or spawn", async () => {
    const events: string[] = [];
    await expect(
      new RecordCapture(dependencies(events)).execute(
        request({ secretSourceReferences: [], noSecretSources: false }),
      ),
    ).resolves.toEqual({
      ok: false,
      error: { rule: "secret-sources-declaration-required" },
    });
    expect(events).toEqual([]);
  });

  it("accepts only explicit no-secret-sources and claims pending before spawning", async () => {
    const events: string[] = [];
    await expect(
      new RecordCapture(dependencies(events)).execute(
        request({ secretSourceReferences: [], noSecretSources: true }),
      ),
    ).resolves.toMatchObject({ ok: true, value: { status: "promoted" } });
    expect(events).toEqual(
      expect.arrayContaining([
        "recover-project",
        `begin-launch:hash:${JSON.stringify({ contextRevision: 1, projectId, secretSourceReferences: [], terminalMode: "human", url: "http://localhost:3000/" })}`,
        `record:${captureId}`,
        "started:4242",
        "post-exit",
        "scan:0",
        "resolve:promote:",
      ]),
    );
  });

  it("resolves declared values before allocation, hashes references, and disposes after terminalization", async () => {
    const events: string[] = [];
    await expect(
      new RecordCapture(dependencies(events)).execute(request()),
    ).resolves.toEqual({
      ok: true,
      value: { captureId, status: "promoted", nextAction: "capture-annotate" },
    });
    expect(events).toEqual(
      expect.arrayContaining([
        "secrets:env:CAPTURE_TOKEN",
        "recover-project",
        `begin-launch:hash:${JSON.stringify({ contextRevision: 1, projectId, secretSourceReferences: ["env:CAPTURE_TOKEN"], terminalMode: "human", url: "http://localhost:3000/" })}`,
        "scan:1",
        "resolve:promote:",
        "dispose",
      ]),
    );
    expect(events.indexOf("secrets:env:CAPTURE_TOKEN")).toBeLessThan(
      events.indexOf("recover-project"),
    );
    expect(events.join("\n")).not.toContain(canary);
  });

  it("persists launch before an unavailable recorder prerequisite and terminalizes safely", async () => {
    const events: string[] = [];
    const configured = dependencies(events);
    configured.recorder.start = async () =>
      completedRun({ kind: "prerequisite-or-process-failure" }, undefined);
    await expect(
      new RecordCapture(configured).execute(request()),
    ).resolves.toEqual({
      ok: true,
      value: {
        captureId,
        status: "failed",
        nextAction: "resolve-recorder-prerequisite",
      },
    });
    expect(events).toEqual(
      expect.arrayContaining([
        `begin-launch:hash:${JSON.stringify({ contextRevision: 1, projectId, secretSourceReferences: ["env:CAPTURE_TOKEN"], terminalMode: "human", url: "http://localhost:3000/" })}`,
        "resolve:fail:recorder-prerequisite-or-process-failure",
        "dispose",
      ]),
    );
  });

  it.each([
    [
      "operator cancellation",
      { kind: "operator-cancelled" as const },
      "interrupt",
      "operator-cancelled",
      "interrupted",
      "rerun-capture",
    ],
    [
      "non-zero exit",
      { kind: "exited" as const, exitCode: 12 },
      "fail",
      "recorder-exit",
      "failed",
      "rerun-capture",
    ],
  ] as const)(
    "records %s as one atomic terminal decision",
    async (_name, result, resolution, reason, status, nextAction) => {
      const events: string[] = [];
      const configured = dependencies(events);
      configured.recorder.start = async () => completedRun(result);
      await expect(
        new RecordCapture(configured).execute(request()),
      ).resolves.toEqual({
        ok: true,
        value: { captureId, status, nextAction },
      });
      expect(events.filter((event) => event.startsWith("resolve:"))).toEqual([
        `resolve:${resolution}:${reason}`,
      ]);
    },
  );

  it("replays a terminal request with its original identity while IDs and clocks advance", async () => {
    const events: string[] = [];
    const configured = dependencies(events);
    let calls = 0;
    Object.assign(configured, {
      ids: {
        next: () =>
          ++calls === 1
            ? captureId
            : ("cap_018f47de-7a00-7cc0-8000-000000000002" as const),
      } as IdGenerator,
    });
    configured.store.beginLaunch = async (command) =>
      calls === 1
        ? ok({ session: { ...pending(), ...command, status: "launching" }, claimed: true })
        : ok({
            session: {
              ...pending(),
              status: "promoted",
              artifact,
              completedAt: timestamp,
            },
            claimed: false,
          });
    const useCase = new RecordCapture(configured);
    expect(await useCase.execute(request())).toMatchObject({ ok: true });
    expect(await useCase.execute(request())).toMatchObject({
      ok: true,
      value: { status: "promoted" },
    });
    expect(events.filter((event) => event.startsWith("record:"))).toHaveLength(
      1,
    );
  });

  it("blocks a persisted launching replay without spawning another recorder", async () => {
    const events: string[] = [];
    const configured = dependencies(events);
    configured.store.beginLaunch = async () =>
      ok({ session: { ...pending(), status: "launching" }, claimed: false });
    await expect(
      new RecordCapture(configured).execute(request()),
    ).resolves.toEqual({
      ok: false,
      error: { rule: "capture-process-still-active", captureId },
    });
    expect(events).not.toContain(`record:${captureId}`);
  });

  it.each(["same", "unknown"] as const)("blocks a %s recording replay without spawning or signalling", async (probe) => {
    const events: string[] = [];
    const configured = dependencies(events);
    configured.store.beginLaunch = async () =>
      ok({ session: { ...pending(), status: "recording", recorder: { pid: 4242, identity: "a".repeat(64) } }, claimed: false });
    configured.recorder.probeProcess = async () => {
      events.push("probe");
      return probe;
    };
    await expect(
      new RecordCapture(configured).execute(request()),
    ).resolves.toEqual({
      ok: false,
      error: { rule: "capture-process-still-active", captureId },
    });
    expect(events).toContain("probe");
    expect(events).not.toContain(`record:${captureId}`);
  });

  it.each(["absent", "reused"] as const)("terminalizes a %s original recording without touching the observed PID", async (probe) => {
    const events: string[] = [];
    const configured = dependencies(events);
    let session: CaptureSession = {
      ...pending(),
      status: "recording",
      recorder: { pid: 4242, identity: "a".repeat(64) },
    };
    configured.store.beginLaunch = async () => ok({ session, claimed: false });
    configured.store.resolve = async (_p, _c, decision, completedAt) => {
      events.push(`resolve:${decision.resolution}`);
      session = terminal(decision, completedAt);
      return ok(session);
    };
    configured.recorder.probeProcess = async () => probe;
    const useCase = new RecordCapture(configured);
    await expect(useCase.execute(request())).resolves.toMatchObject({
      ok: true,
      value: { status: "interrupted" },
    });
    await expect(useCase.execute(request())).resolves.toMatchObject({
      ok: true,
      value: { status: "interrupted" },
    });
    expect(
      events.filter((event) => event === "resolve:interrupt"),
    ).toHaveLength(1);
  });

  it("fails closed instead of scanning a post-exit session whose secrets may have rotated", async () => {
    const events: string[] = [];
    const configured = dependencies(events);
    configured.store.beginLaunch = async () =>
      ok({ session: { ...pending(), status: "post_exit", recorderExitedAt: timestamp }, claimed: false });
    configured.scanner.scan = async () => {
      events.push("scan");
      return ok(artifact);
    };
    await expect(
      new RecordCapture(configured).execute(request()),
    ).resolves.toMatchObject({ ok: true, value: { status: "rejected" } });
    expect(events).toContain("resolve:reject:scan-incomplete");
    expect(events).not.toContain("scan");
  });

  it("resumes no-secret post-exit scanning without repeating the recorder", async () => {
    const events: string[] = [];
    const configured = dependencies(events);
    configured.store.beginLaunch = async () =>
      ok({
        session: {
          ...pending(),
          status: "post_exit",
          recorderExitedAt: timestamp,
          secretSourceReferences: [],
        },
        claimed: false,
      });
    await expect(
      new RecordCapture(configured).execute(
        request({ secretSourceReferences: [], noSecretSources: true }),
      ),
    ).resolves.toMatchObject({ ok: true, value: { status: "promoted" } });
    expect(events).toEqual(
      expect.arrayContaining(["scan:0", "resolve:promote:"]),
    );
    expect(events).not.toContain(`record:${captureId}`);
  });

  it("finishes a persisted resolving decision without recorder or scanner side effects", async () => {
    const events: string[] = [];
    const configured = dependencies(events);
    configured.store.beginLaunch = async () =>
      ok({
        session: {
          ...pending(),
          status: "resolving",
          resolution: "promote",
          artifact,
        },
        claimed: false,
      });
    await expect(
      new RecordCapture(configured).execute(request()),
    ).resolves.toMatchObject({ ok: true, value: { status: "promoted" } });
    expect(events).toContain("resolve:promote:");
    expect(events).not.toContain(`record:${captureId}`);
    expect(events.filter((event) => event.startsWith("scan:"))).toEqual([]);
  });

  it("records incomplete scans as the durable safe rejection category", async () => {
    const events: string[] = [];
    const configured = dependencies(events);
    configured.scanner.scan = async () =>
      err({ category: "incomplete", count: 0 });
    await expect(
      new RecordCapture(configured).execute(request()),
    ).resolves.toMatchObject({ ok: true, value: { status: "rejected" } });
    expect(events).toContain("resolve:reject:scan-incomplete");
    expect(events.join("\n")).not.toContain(canary);
  });

  it("leaves the session nonterminal when cancellation escalation cannot prove the child exited", async () => {
    const events: string[] = [];
    const configured = dependencies(events);
    configured.recorder.start = async () =>
      completedRun({ kind: "process-still-active" });
    await expect(
      new RecordCapture(configured).execute(request()),
    ).resolves.toEqual({
      ok: false,
      error: { rule: "capture-process-still-active", captureId },
    });
    expect(events.filter((event) => event.startsWith("resolve:"))).toEqual([]);
  });

  it("returns an explicit active refusal without awaiting stalled evidence persistence", async () => {
    let release!: () => void;
    const persisted = new Promise<void>((resolve) => {
      release = resolve;
    });
    const configured = dependencies();
    configured.store.recordRecorderStarted = async () => {
      await persisted;
      return ok({ ...pending(), status: "recording", recorder: { pid: 4242, identity: "a".repeat(64) } });
    };
    configured.recorder.start = async () =>
      completedRun({ kind: "process-still-active" });
    await expect(new RecordCapture(configured).execute(request())).resolves.toEqual({
      ok: false,
      error: { rule: "capture-process-still-active", captureId },
    });
    release();
  });

  it("recovers an absent earlier recorder before allocating and spawning a new request", async () => {
    const events: string[] = [];
    const configured = dependencies(events);
    configured.store.recoverProject = async () =>
      ok({
        recovered: [],
        blocked: [{ ...pending(), status: "recording", recorder: recorderEvidence }],
      });
    configured.recorder.probeProcess = async () => {
      events.push("probe:absent");
      return "absent";
    };
    Object.assign(configured, { ids: { next: () => {
      events.push("allocate");
      return captureId;
    } } as IdGenerator });
    await expect(new RecordCapture(configured).execute(request())).resolves.toMatchObject({
      ok: true,
      value: { status: "promoted" },
    });
    expect(events.indexOf("probe:absent")).toBeLessThan(events.indexOf("allocate"));
    expect(events).toContain("resolve:interrupt:signal");
  });

  it.each(["same", "unknown"] as const)("blocks a recovered %s recorder without spawning", async (probe) => {
    const events: string[] = [];
    const configured = dependencies(events);
    configured.store.recoverProject = async () =>
      ok({
        recovered: [],
        blocked: [{ ...pending(), status: "recording", recorder: recorderEvidence }],
      });
    configured.recorder.probeProcess = async () => probe;
    await expect(new RecordCapture(configured).execute(request())).resolves.toEqual({
      ok: false,
      error: { rule: "capture-process-still-active", captureId },
    });
    expect(events).not.toContain(`record:${captureId}`);
    expect(events.filter((event) => event.startsWith("resolve:"))).toEqual([]);
  });

  it("converges a recovered reused identity as interrupted without signalling the observed PID", async () => {
    const events: string[] = [];
    const configured = dependencies(events);
    configured.store.recoverProject = async () =>
      ok({
        recovered: [],
        blocked: [{ ...pending(), status: "recording", recorder: recorderEvidence }],
      });
    configured.recorder.probeProcess = async () => "reused";
    await expect(new RecordCapture(configured).execute(request())).resolves.toMatchObject({
      ok: true,
      value: { status: "promoted" },
    });
    expect(events).toContain("resolve:interrupt:signal");
    expect(events).toContain(`record:${captureId}`);
  });

  it.each([
    ["terminal", { ...pending(), status: "interrupted", reason: "signal", completedAt: timestamp }],
    ["resolving", { ...pending(), status: "resolving", resolution: "interrupt", reason: "signal" }],
    ["post-exit", { ...pending(), status: "post_exit", recorderExitedAt: timestamp }],
  ] as const)("routes a claimed-false %s session without spawning", async (_name, session) => {
    const events: string[] = [];
    const configured = dependencies(events);
    configured.store.beginLaunch = async () => ok({ session, claimed: false });
    await expect(new RecordCapture(configured).execute(request())).resolves.toMatchObject({ ok: true });
    expect(events).not.toContain(`record:${captureId}`);
  });

  it.each(["pending", "post_exit", "resolving"] as const)("uses project recovery for %s durable state before launching", async (status) => {
    const events: string[] = [];
    const configured = dependencies(events);
    configured.store.recoverProject = async () => {
      events.push(`recover-project:${status}`);
      return ok({
        recovered: [terminal({ resolution: "fail", reason: "recorder-prerequisite-or-process-failure" }, timestamp) as Extract<CaptureSession, { status: "failed" }>],
        blocked: [],
      });
    };
    await expect(new RecordCapture(configured).execute(request())).resolves.toMatchObject({
      ok: true,
      value: { status: "promoted" },
    });
    expect(events.indexOf(`recover-project:${status}`)).toBeLessThan(events.indexOf(`record:${captureId}`));
  });

  it.each([
    ["operator-cancelled", "operator-cancelled"],
    ["signalled", "signal"],
  ] as const)("persists %s provenance as %s", async (kind, reason) => {
    const events: string[] = [];
    const configured = dependencies(events);
    configured.recorder.start = async () => completedRun({ kind });
    await expect(
      new RecordCapture(configured).execute(request()),
    ).resolves.toMatchObject({ ok: true, value: { status: "interrupted" } });
    expect(events).toContain(`resolve:interrupt:${reason}`);
  });

  it.each([
    [
      "missing",
      { rule: "secret-source-unavailable", reference: "env:CAPTURE_TOKEN" },
    ],
    ["empty", { rule: "secret-source-empty", reference: "env:CAPTURE_TOKEN" }],
  ] as const)(
    "does not leak a %s source in safe refusal or effects",
    async (_name, refusal) => {
      const events: string[] = [];
      const configured = dependencies(events);
      configured.resolver.resolve = async () =>
        err(refusal as SecretResolutionRefusal);
      const result = await new RecordCapture(configured).execute(request());
      expect(result).toEqual({ ok: false, error: refusal });
      expect(JSON.stringify(result)).not.toContain(canary);
      expect(events).toEqual([]);
    },
  );

  it("terminalizes a confirmed recorder cancellation even when PID persistence never resolves", async () => {
    const configured = dependencies();
    configured.store.recordRecorderStarted = async () => new Promise(() => {});
    configured.recorder.start = async () => completedRun({ kind: "operator-cancelled" });
    await expect(new RecordCapture(configured).execute(request())).resolves.toMatchObject({
      ok: true,
      value: { status: "interrupted" },
    });
  });

  it.each([
    ["signal", { kind: "signalled" as const }, "interrupted"],
    ["normal exit", { kind: "exited" as const, exitCode: 0 }, "promoted"],
  ] as const)(
    "does not strand a fast %s completion when evidence persistence never resolves",
    async (_name, result, status) => {
      const configured = dependencies();
      configured.store.recordRecorderStarted = async () =>
        new Promise(() => {});
      configured.recorder.start = async () => completedRun(result);
      await expect(
        new RecordCapture(configured).execute(request()),
      ).resolves.toMatchObject({ ok: true, value: { status } });
    },
  );

  it("contains a failed evidence persistence attempt and terminalizes a confirmed internal failure", async () => {
    let contained = false;
    let complete!: (result: RecorderResult) => void;
    const configured = dependencies();
    configured.store.recordRecorderStarted = async () =>
      err({ rule: "capture-not-found", captureId });
    configured.recorder.start = async () => ({
      evidence: { pid: 4242, identity: "a".repeat(64) },
      waitForCompletion: () =>
        new Promise<RecorderResult>((resolve) => {
          complete = resolve;
        }),
      contain: () => {
        contained = true;
        complete({ kind: "prerequisite-or-process-failure" });
      },
    } as RecorderRun);
    await expect(
      new RecordCapture(configured).execute(request()),
    ).resolves.toMatchObject({ ok: true, value: { status: "failed" } });
    expect(contained).toBe(true);
  });

  it("leaves launching when failed persistence containment cannot prove exit", async () => {
    const configured = dependencies();
    configured.store.recordRecorderStarted = async () =>
      err({ rule: "capture-not-found", captureId });
    configured.recorder.start = async () => ({
      evidence: { pid: 4242, identity: "a".repeat(64) },
      async waitForCompletion() { return { kind: "process-still-active" as const }; },
      contain() {},
    });
    await expect(new RecordCapture(configured).execute(request())).resolves.toEqual({
      ok: false,
      error: { rule: "capture-process-still-active", captureId },
    });
  });

  it("contains a persistence failure without inventing operator cancellation or hanging", async () => {
    let contained = 0;
    let complete!: (result: RecorderResult) => void;
    const configured = dependencies();
    configured.store.recordRecorderStarted = async () =>
      err({ rule: "capture-not-found", captureId });
    configured.recorder.start = async () => ({
      evidence: { pid: 4242, identity: "a".repeat(64) },
      waitForCompletion: () => new Promise<RecorderResult>((resolve) => { complete = resolve; }),
      contain: () => {
        contained += 1;
        complete({ kind: "prerequisite-or-process-failure" });
      },
    } as unknown as RecorderRun);

    await expect(new RecordCapture(configured).execute(request())).resolves.toMatchObject({
      ok: true,
      value: { status: "failed", nextAction: "resolve-recorder-prerequisite" },
    });
    expect(contained).toBe(1);
  });

  it("maps containment-caused cancellation after evidence persistence failure to failed", async () => {
    let complete!: (result: RecorderResult) => void;
    const configured = dependencies();
    configured.store.recordRecorderStarted = async () =>
      err({ rule: "capture-not-found", captureId });
    configured.recorder.start = async () => ({
      evidence: recorderEvidence,
      waitForCompletion: () => new Promise<RecorderResult>((resolve) => { complete = resolve; }),
      contain: () => complete({ kind: "operator-cancelled" }),
    } as RecorderRun);
    await expect(new RecordCapture(configured).execute(request())).resolves.toMatchObject({
      ok: true,
      value: { status: "failed", nextAction: "resolve-recorder-prerequisite" },
    });
  });

  it("does not subscribe to abort after delegating cancellation ownership to the recorder", async () => {
    const configured = dependencies();
    configured.recorder.start = async () => completedRun({ kind: "exited", exitCode: 0 });
    await expect(new RecordCapture(configured).execute(request({
      signal: {
        aborted: false,
        onAbort() { throw new Error("application must not subscribe"); },
      },
    }))).resolves.toMatchObject({ ok: true, value: { status: "promoted" } });
  });

  it("refuses an unclaimed launching session without spawning a duplicate recorder", async () => {
    const events: string[] = [];
    const configured = dependencies(events);
    configured.store.beginLaunch = async () =>
      ok({ session: { ...pending(), status: "launching" }, claimed: false });
    await expect(
      new RecordCapture(configured).execute(request()),
    ).resolves.toEqual({
      ok: false,
      error: { rule: "capture-process-still-active", captureId },
    });
    expect(events).not.toContain(`record:${captureId}`);
  });
});
