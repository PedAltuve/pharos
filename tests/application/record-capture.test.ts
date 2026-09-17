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

const request = (overrides: Partial<RecordCaptureRequest> = {}): RecordCaptureRequest => ({
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

function completedRun(result: RecorderResult, evidence: { readonly pid: number } | undefined = { pid: 4242 }): RecorderRun {
  return { evidence, async waitForCompletion() { return result; }, stop() {} };
}

function running() {
  return {
    contract: "pharos.capture-session/1" as const,
    projectId,
    captureId,
    requestId,
    inputHash: "references-only-hash",
    secretSourceReferences: ["env:CAPTURE_TOKEN"],
    createdAt: timestamp,
    status: "running" as const,
  };
}

function dependencies(events: string[] = []): RecordCaptureDependencies & {
  readonly store: CaptureStore;
  readonly recorder: Recorder;
  readonly resolver: SecretResolver;
} {
  const store: CaptureStore = {
    async recover() { events.push("recover"); return ok([]); },
    async begin(command) { events.push(`begin:${command.inputHash}`); return ok({ ...running(), ...command }); },
    async recordRecorderStarted(_project, _capture, evidence) { events.push(`started:${evidence.pid}`); return ok({ ...running(), recorder: evidence }); },
    async markPostExit(_project, _capture, exitedAt) { events.push("post-exit"); return ok({ ...running(), status: "post_exit", recorderExitedAt: exitedAt }); },
    async recordResolution(_project, _capture, resolution) {
      events.push(`decision:${resolution.resolution}`);
      return ok({ ...running(), status: "resolving", ...resolution });
    },
    async finishResolution(_project, _capture, completedAt) {
      events.push("finish");
      return ok({ ...running(), status: "promoted", artifact: { reference: `captures/${captureId}/recording.spec.ts`, byteSize: 2, sha256: "a".repeat(64) }, completedAt });
    },
    async getSession() { return err({ rule: "capture-not-found", captureId }); },
    async claimAnnotation() { return err({ rule: "capture-not-found", captureId }); },
    async commitAssociation() { return err({ rule: "capture-not-found", captureId }); },
    async getAssociationByCapture() { return ok(null); },
    async getAssociationByBeacon() { return ok(null); },
  };
  let disposed = false;
  const resolver: SecretResolver = {
    async resolve(references) {
      events.push(`resolve:${references.join(",")}`);
      return ok({ values: new Map([["env:CAPTURE_TOKEN", canary]]), dispose: () => { disposed = true; events.push("dispose"); } });
    },
  };
  const recorder: Recorder = {
    async start(command) {
      events.push(`record:${command.captureId}`);
      expect(disposed).toBe(false);
      return completedRun({ kind: "exited", exitCode: 0 });
    },
    async isProcessActive() { return true; },
  };
  const scanner: SensitivityScanner = {
    async scan(command) {
      events.push(`scan:${command.resolvedSecrets.size}`);
      if (command.resolvedSecrets.size > 0) {
        expect(command.resolvedSecrets.get("env:CAPTURE_TOKEN")).toBe(canary);
      }
      return ok({ reference: `captures/${captureId}/recording.spec.ts`, byteSize: 2, sha256: "a".repeat(64) });
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

describe("RecordCapture", () => {
  it("refuses an omitted secret declaration before resolution, allocation, recovery, or spawn", async () => {
    const events: string[] = [];
    const useCase = new RecordCapture(dependencies(events));

    await expect(useCase.execute(request({ secretSourceReferences: [], noSecretSources: false }))).resolves.toEqual({
      ok: false,
      error: { rule: "secret-sources-declaration-required" },
    });
    expect(events).toEqual([]);
  });

  it("accepts only explicit --no-secret-sources for an empty declaration", async () => {
    const events: string[] = [];
    const useCase = new RecordCapture(dependencies(events));

    await expect(useCase.execute(request({ secretSourceReferences: [], noSecretSources: true }))).resolves.toMatchObject({
      ok: true,
      value: { captureId, status: "promoted" },
    });
    expect(events).toEqual(["recover", "begin:hash:{\"contextRevision\":1,\"projectId\":\"proj_018f47de-7a00-7cc0-8000-000000000001\",\"secretSourceReferences\":[],\"terminalMode\":\"human\",\"url\":\"http://localhost:3000/\"}", `record:${captureId}`, "started:4242", "post-exit", "scan:0", "decision:promote", "finish"]);
  });

  it("resolves declared values before allocation or spawn, hashes references not values, and disposes after terminalization", async () => {
    const events: string[] = [];
    const useCase = new RecordCapture(dependencies(events));

    await expect(useCase.execute(request())).resolves.toEqual({
      ok: true,
      value: { captureId, status: "promoted", nextAction: "capture-annotate" },
    });
    expect(events).toEqual([
      "resolve:env:CAPTURE_TOKEN",
      "recover",
      "begin:hash:{\"contextRevision\":1,\"projectId\":\"proj_018f47de-7a00-7cc0-8000-000000000001\",\"secretSourceReferences\":[\"env:CAPTURE_TOKEN\"],\"terminalMode\":\"human\",\"url\":\"http://localhost:3000/\"}",
      `record:${captureId}`,
      "started:4242",
      "post-exit",
      "scan:1",
      "decision:promote",
      "finish",
      "dispose",
    ]);
    expect(events.join("\n")).not.toContain(canary);
  });

  it("persists running before an unavailable recorder prerequisite, then terminalizes safely", async () => {
    const events: string[] = [];
    const configured = dependencies(events);
    configured.recorder.start = async () => {
      events.push("record-prerequisite-failure");
      return completedRun({ kind: "prerequisite-or-process-failure" }, undefined);
    };
    configured.store.finishResolution = async () => {
      events.push("finish-failed");
      return ok({ ...running(), status: "failed", reason: "recorder-prerequisite-or-process-failure", completedAt: timestamp });
    };

    await expect(new RecordCapture(configured).execute(request())).resolves.toEqual({
      ok: true,
      value: { captureId, status: "failed", nextAction: "resolve-recorder-prerequisite" },
    });
    expect(events).toEqual(expect.arrayContaining(["begin:hash:{\"contextRevision\":1,\"projectId\":\"proj_018f47de-7a00-7cc0-8000-000000000001\",\"secretSourceReferences\":[\"env:CAPTURE_TOKEN\"],\"terminalMode\":\"human\",\"url\":\"http://localhost:3000/\"}", "record-prerequisite-failure", "decision:fail", "finish-failed", "dispose"]));
    expect(events.indexOf("begin:hash:{\"contextRevision\":1,\"projectId\":\"proj_018f47de-7a00-7cc0-8000-000000000001\",\"secretSourceReferences\":[\"env:CAPTURE_TOKEN\"],\"terminalMode\":\"human\",\"url\":\"http://localhost:3000/\"}")).toBeLessThan(events.indexOf("record-prerequisite-failure"));
  });

  it.each([
    ["interruption", { kind: "operator-cancelled" as const }, "interrupt", "operator-cancelled", "interrupted", "rerun-capture"],
    ["non-zero exit", { kind: "exited" as const, exitCode: 12 }, "fail", "recorder-exit", "failed", "rerun-capture"],
  ])("records one terminal %s without a Beacon dependency", async (_name, recorderResult, resolution, reason, status, nextAction) => {
    const events: string[] = [];
    const configured = dependencies(events);
    configured.recorder.start = async () => completedRun(recorderResult);
    configured.store.recordResolution = async (_project, _capture, record) => {
      events.push(`decision:${record.resolution}:${record.reason}`);
      return ok({ ...running(), status: "resolving", ...record });
    };
    configured.store.finishResolution = async () => {
      events.push(`finish:${status}`);
      return status === "interrupted"
        ? ok({ ...running(), status: "interrupted", reason: "operator-cancelled", completedAt: timestamp })
        : ok({ ...running(), status: "failed", reason: "recorder-exit", completedAt: timestamp });
    };

    await expect(new RecordCapture(configured).execute(request())).resolves.toEqual({
      ok: true,
      value: { captureId, status, nextAction },
    });
    expect(events.filter((event) => event.startsWith("decision:"))).toEqual([`decision:${resolution}:${reason}`]);
    expect(events.filter((event) => event.startsWith("finish:"))).toEqual([`finish:${status}`]);
  });

  it("replays a terminal request with its original identity while IDs and clocks advance", async () => {
    const events: string[] = [];
    const configured = dependencies(events);
    let idCalls = 0;
    let clockCalls = 0;
    let beginCalls = 0;
    Object.assign(configured, {
      ids: { next: () => ++idCalls === 1 ? captureId : "cap_018f47de-7a00-7cc0-8000-000000000002" } as IdGenerator,
      clock: { now: () => new Date(++clockCalls === 1 ? timestamp : "2026-03-05T00:00:00.000Z") } as Clock,
    });
    configured.store.begin = async (command) => {
      events.push(`begin:${command.captureId}`);
      return ++beginCalls === 1
        ? ok({ ...running(), ...command })
        : ok({ ...running(), status: "promoted", artifact: { reference: `captures/${captureId}/recording.spec.ts`, byteSize: 2, sha256: "a".repeat(64) }, completedAt: timestamp });
    };

    const useCase = new RecordCapture(configured);
    const first = await useCase.execute(request());
    const second = await useCase.execute(request());

    expect(second).toEqual(first);
    expect(events.filter((event) => event.startsWith("record:"))).toEqual([`record:${captureId}`]);
    expect(events.filter((event) => event.startsWith("scan:"))).toEqual(["scan:1"]);
    expect(events.filter((event) => event === "post-exit" || event.startsWith("decision:") || event === "finish")).toEqual(["post-exit", "decision:promote", "finish"]);
  });

  it("does not start another recorder for a persisted active session", async () => {
    const events: string[] = [];
    const configured = dependencies(events);
    Object.assign(configured, { ids: { next: () => "cap_018f47de-7a00-7cc0-8000-000000000002" } as IdGenerator });
    configured.store.begin = async () => ok(running());

    await expect(new RecordCapture(configured).execute(request())).resolves.toEqual({
      ok: false,
      error: { rule: "capture-process-still-active", captureId },
    });
    expect(events.filter((event) => event.startsWith("record:") || event.startsWith("scan:") || event === "post-exit" || event.startsWith("decision:") || event === "finish")).toEqual([]);
  });

  it("refuses a same-request replay when its persisted recorder PID still appears live", async () => {
    const events: string[] = [];
    const configured = dependencies(events);
    configured.store.begin = async () => ok({ ...running(), recorder: { pid: 4242 } });
    (configured.recorder as Recorder & { isProcessActive: (evidence: { readonly pid: number }) => Promise<boolean> }).isProcessActive = async (evidence) => {
      events.push(`probe:${evidence.pid}`);
      return true;
    };

    await expect(new RecordCapture(configured).execute(request())).resolves.toEqual({
      ok: false,
      error: { rule: "capture-process-still-active", captureId },
    });
    expect(events).toContain("probe:4242");
    expect(events.filter((event) => event.startsWith("record:") || event.startsWith("decision:") || event === "finish")).toEqual([]);
  });

  it("terminalizes a persisted running capture whose recorded child is absent and converges on replay", async () => {
    const events: string[] = [];
    const configured = dependencies(events);
    let session: CaptureSession = { ...running(), recorder: { pid: 4242 } };
    configured.store.begin = async () => ok(session);
    configured.store.recordResolution = async (_project, _capture, resolution) => {
      events.push(`decision:${resolution.resolution}:${resolution.reason}`);
      session = { ...running(), status: "resolving", ...resolution };
      return ok(session);
    };
    configured.store.finishResolution = async () => {
      events.push("finish:interrupted");
      session = { ...running(), status: "interrupted", reason: "signal", completedAt: timestamp };
      return ok(session);
    };
    (configured.recorder as Recorder & { isProcessActive: (evidence: { readonly pid: number }) => Promise<boolean> }).isProcessActive = async (evidence) => {
      events.push(`probe:${evidence.pid}`);
      return false;
    };

    const useCase = new RecordCapture(configured);
    await expect(useCase.execute(request())).resolves.toEqual({
      ok: true,
      value: { captureId, status: "interrupted", nextAction: "rerun-capture" },
    });
    await expect(useCase.execute(request())).resolves.toEqual({
      ok: true,
      value: { captureId, status: "interrupted", nextAction: "rerun-capture" },
    });
    expect(events.filter((event) => event === "probe:4242")).toEqual(["probe:4242"]);
    expect(events.filter((event) => event.startsWith("decision:") || event === "finish:interrupted")).toEqual(["decision:interrupt:signal", "finish:interrupted"]);
    expect(events.filter((event) => event.startsWith("record:"))).toEqual([]);
  });

  it("fails closed instead of promoting an old secret artifact after post-exit replay", async () => {
    const events: string[] = [];
    const originalSecret = "original-rotatable-secret";
    const rotatedSecret = "rotated-rotatable-secret";
    const configured = dependencies(events);
    Object.assign(configured, { ids: { next: () => "cap_018f47de-7a00-7cc0-8000-000000000002" } as IdGenerator });
    configured.resolver.resolve = async () => ok({
      values: new Map([["env:CAPTURE_TOKEN", rotatedSecret]]),
      dispose: () => { events.push("dispose"); },
    });
    configured.store.begin = async () => ok({ ...running(), status: "post_exit", recorderExitedAt: timestamp });
    configured.scanner.scan = async (command) => {
      events.push("scanner-ran");
      return command.resolvedSecrets.get("env:CAPTURE_TOKEN") === originalSecret
        ? err({ category: "detected", count: 1 })
        : ok({ reference: `captures/${captureId}/recording.spec.ts`, byteSize: 2, sha256: "a".repeat(64) });
    };
    configured.store.recordResolution = async (_project, _capture, resolution) => {
      events.push(`decision:${resolution.resolution}:${resolution.reason}`);
      return ok({ ...running(), status: "resolving", ...resolution });
    };
    configured.store.finishResolution = async () => ok({
      ...running(),
      status: "rejected",
      reason: "scan-incomplete",
      detectionCount: 0,
      completedAt: timestamp,
    });

    await expect(new RecordCapture(configured).execute(request())).resolves.toEqual({
      ok: true,
      value: { captureId, status: "rejected", nextAction: "rerun-capture" },
    });
    expect(events).toContain("decision:reject:scan-incomplete");
    expect(events).not.toContain("scanner-ran");
    expect(events.join("\n")).not.toContain(originalSecret);
    expect(events.join("\n")).not.toContain(rotatedSecret);
  });

  it("resumes no-secret post-exit scanning without repeating the recorder", async () => {
    const events: string[] = [];
    const configured = dependencies(events);
    Object.assign(configured, { ids: { next: () => "cap_018f47de-7a00-7cc0-8000-000000000002" } as IdGenerator });
    configured.store.begin = async () => ok({ ...running(), status: "post_exit", recorderExitedAt: timestamp, secretSourceReferences: [] });

    await expect(new RecordCapture(configured).execute(request({ secretSourceReferences: [], noSecretSources: true }))).resolves.toEqual({
      ok: true,
      value: { captureId, status: "promoted", nextAction: "capture-annotate" },
    });
    expect(events.filter((event) => event.startsWith("record:") || event === "post-exit")).toEqual([]);
    expect(events.filter((event) => event.startsWith("scan:") || event.startsWith("decision:") || event === "finish")).toEqual(["scan:0", "decision:promote", "finish"]);
  });

  it("finishes a persisted resolution without recorder or scanner side effects", async () => {
    const events: string[] = [];
    const configured = dependencies(events);
    Object.assign(configured, { ids: { next: () => "cap_018f47de-7a00-7cc0-8000-000000000002" } as IdGenerator });
    configured.store.begin = async () => ok({
      ...running(),
      status: "resolving",
      resolution: "promote",
      artifact: { reference: `captures/${captureId}/recording.spec.ts`, byteSize: 2, sha256: "a".repeat(64) },
    });

    await expect(new RecordCapture(configured).execute(request())).resolves.toEqual({
      ok: true,
      value: { captureId, status: "promoted", nextAction: "capture-annotate" },
    });
    expect(events.filter((event) => event.startsWith("record:") || event.startsWith("scan:") || event === "post-exit" || event.startsWith("decision:"))).toEqual([]);
    expect(events.filter((event) => event === "finish")).toEqual(["finish"]);
  });

  it("records an incomplete scan as its own durable safe rejection category", async () => {
    const events: string[] = [];
    const configured = dependencies(events);
    configured.scanner.scan = async () => err({ category: "incomplete", count: 0 });
    configured.store.recordResolution = async (_project, _capture, resolution) => {
      events.push(`decision:${resolution.reason}`);
      return ok({ ...running(), status: "resolving", ...resolution });
    };
    configured.store.finishResolution = async () => {
      events.push("finish-rejected");
      return ok({ ...running(), status: "rejected", reason: "scan-incomplete", detectionCount: 0, completedAt: timestamp });
    };

    await expect(new RecordCapture(configured).execute(request())).resolves.toEqual({
      ok: true,
      value: { captureId, status: "rejected", nextAction: "rerun-capture" },
    });
    expect(events).toContain("decision:scan-incomplete");
    expect(events.join("\n")).not.toContain(canary);
  });

  it("leaves the durable session running when cancellation escalation cannot prove the owned child exited", async () => {
    const events: string[] = [];
    const configured = dependencies(events);
    configured.recorder.start = async () => {
      events.push("record:still-active");
      return completedRun({ kind: "process-still-active" });
    };

    await expect(new RecordCapture(configured).execute(request())).resolves.toEqual({
      ok: false,
      error: { rule: "capture-process-still-active", captureId },
    });
    expect(events).toContain("record:still-active");
    expect(events.filter((event) => event === "post-exit" || event.startsWith("decision:") || event === "finish")).toEqual([]);
  });

  it("waits for PID persistence before refusing a still-active recorder", async () => {
    let resolve!: () => void;
    const persistence = new Promise<void>((done) => { resolve = done; });
    const configured = dependencies();
    configured.store.recordRecorderStarted = async () => {
      await persistence;
      return ok({ ...running(), recorder: { pid: 4242 } });
    };
    configured.recorder.start = async () => completedRun({ kind: "process-still-active" });

    let observed: unknown;
    const execution = new RecordCapture(configured).execute(request());
    void execution.then((result) => { observed = result; });
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
    expect(observed).toBeUndefined();
    resolve();
    await expect(execution).resolves.toEqual({ ok: false, error: { rule: "capture-process-still-active", captureId } });
  });

  it.each([
    ["operator-cancelled", "operator-cancelled"],
    ["signalled", "signal"],
  ] as const)("persists %s recorder provenance as the safe %s reason", async (kind, reason) => {
    const events: string[] = [];
    const configured = dependencies(events);
    configured.recorder.start = async () => completedRun({ kind });
    configured.store.recordResolution = async (_project, _capture, resolution) => {
      events.push(`decision:${resolution.resolution}:${resolution.reason}`);
      return ok({ ...running(), status: "resolving", ...resolution });
    };
    configured.store.finishResolution = async () => ok({
      ...running(),
      status: "interrupted",
      reason,
      completedAt: timestamp,
    });

    await expect(new RecordCapture(configured).execute(request())).resolves.toEqual({
      ok: true,
      value: { captureId, status: "interrupted", nextAction: "rerun-capture" },
    });
    expect(events).toContain(`decision:interrupt:${reason}`);
  });

  it.each([
    ["missing", { rule: "secret-source-unavailable", reference: "env:CAPTURE_TOKEN" }],
    ["empty", { rule: "secret-source-empty", reference: "env:CAPTURE_TOKEN" }],
  ])("does not leak a %s source in the safe refusal or side effects", async (_kind, refusal) => {
    const events: string[] = [];
    const configured = dependencies(events);
    configured.resolver.resolve = async () => err(refusal as SecretResolutionRefusal);

    const result = await new RecordCapture(configured).execute(request());

    expect(result).toEqual({ ok: false, error: refusal });
    expect(JSON.stringify(result)).not.toContain(canary);
    expect(events).toEqual([]);
  });

  it("terminalizes confirmed operator cancellation when abort wins while PID persistence never resolves", async () => {
    let aborted = false;
    const abortListeners = new Set<() => void>();
    let complete!: (result: { readonly kind: "operator-cancelled" }) => void;
    const configured = dependencies();
    configured.store.recordRecorderStarted = async () => new Promise(() => {});
    configured.store.finishResolution = async () => ok({ ...running(), status: "interrupted", reason: "operator-cancelled", completedAt: timestamp });
    (configured.recorder as unknown as {
      start(input: { readonly signal: { onAbort(listener: () => void): () => void } }): Promise<unknown>;
    }).start = async (input) => ({
      evidence: { pid: 4242 },
      waitForCompletion: () => new Promise((resolve) => {
        complete = resolve;
        input.signal.onAbort(() => complete({ kind: "operator-cancelled" }));
      }),
      stop: () => {},
    });

    const execution = new RecordCapture(configured).execute(request({
      signal: {
        get aborted() { return aborted; },
        onAbort(listener) { abortListeners.add(listener); return () => { abortListeners.delete(listener); }; },
      },
    }));
    for (let index = 0; index < 5; index += 1) await Promise.resolve();
    aborted = true;
    for (const listener of abortListeners) listener();

    await expect(execution).resolves.toEqual({
      ok: true,
      value: { captureId, status: "interrupted", nextAction: "rerun-capture" },
    });
  });

  it("observes an abort that occurred before local persistence coordination while persistence never resolves", async () => {
    let aborted = false;
    let stopCalls = 0;
    const abortListeners = new Set<() => void>();
    let complete!: (result: RecorderResult) => void;
    const configured = dependencies();
    configured.store.recordRecorderStarted = async () => new Promise(() => {});
    configured.store.recordResolution = async (_project, _capture, resolution) => {
      expect(resolution).toMatchObject({ resolution: "interrupt", reason: "operator-cancelled" });
      return ok({ ...running(), status: "resolving", ...resolution });
    };
    configured.store.finishResolution = async () => ok({ ...running(), status: "interrupted", reason: "operator-cancelled", completedAt: timestamp });
    configured.recorder.start = async () => {
      aborted = true;
      return {
        evidence: { pid: 4242 },
        waitForCompletion: () => new Promise((resolve) => { complete = resolve; }),
        stop() { stopCalls += 1; complete({ kind: "operator-cancelled" }); },
      };
    };

    let observed: unknown;
    void new RecordCapture(configured).execute(request({
      signal: {
        get aborted() { return aborted; },
        onAbort(listener) { abortListeners.add(listener); return () => { abortListeners.delete(listener); }; },
      },
    })).then((result) => { observed = result; });
    for (let index = 0; index < 20; index += 1) await Promise.resolve();

    expect(observed).toEqual({
      ok: true,
      value: { captureId, status: "interrupted", nextAction: "rerun-capture" },
    });
    expect(stopCalls).toBe(1);
    expect(abortListeners).toEqual(new Set());
  });

  it.each([
    ["external signal", { kind: "signalled" } as const, "interrupted" as const, "signal" as const],
    ["normal exit", { kind: "exited", exitCode: 0 } as const, "promoted" as const, undefined],
  ])("does not strand a fast %s completion while PID persistence never resolves", async (_name, recorderResult, status, reason) => {
    const configured = dependencies();
    configured.store.recordRecorderStarted = async () => new Promise(() => {});
    configured.recorder.start = async () => completedRun(recorderResult);
    if (status === "interrupted") {
      configured.store.finishResolution = async () => ok({ ...running(), status, reason, completedAt: timestamp });
    }

    let observed: unknown;
    void new RecordCapture(configured).execute(request()).then((result) => { observed = result; });
    for (let index = 0; index < 20; index += 1) await Promise.resolve();

    expect(observed).toEqual({
      ok: true,
      value: {
        captureId,
        status,
        nextAction: status === "interrupted" ? "rerun-capture" : "capture-annotate",
      },
    });
  });

  it.each([
    ["terminal", { kind: "operator-cancelled" } as const, true],
    ["still-active", { kind: "process-still-active" } as const, false],
  ])("handles failed PID persistence with a %s recorder", async (_name, result, terminal) => {
    let stopped = false;
    let finish!: (result: RecorderResult) => void;
    const configured = dependencies();
    configured.store.recordRecorderStarted = async () => err({ rule: "capture-not-found", captureId });
    configured.store.finishResolution = async () => ok({ ...running(), status: "interrupted", reason: "operator-cancelled", completedAt: timestamp });
    configured.recorder.start = async () => ({
      evidence: { pid: 4242 }, waitForCompletion: () => new Promise((resolve) => { finish = resolve; }),
      stop() { stopped = true; finish(result); },
    });
    let observed: unknown;
    const execution = new RecordCapture(configured).execute(request());
    void execution.then((value) => { observed = value; });
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
    expect(stopped).toBe(true);
    if (terminal) await expect(execution).resolves.toMatchObject({ ok: true, value: { status: "interrupted" } });
    else expect(observed).toBeUndefined();
  });
});
