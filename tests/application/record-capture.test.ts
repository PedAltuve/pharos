import { describe, expect, it } from "vitest";
import {
  RecordCapture,
  type RecordCaptureDependencies,
  type RecordCaptureRequest,
} from "../../src/application/record-capture.js";
import type {
  CaptureStore,
  Clock,
  Hasher,
  IdGenerator,
  Recorder,
  SecretResolver,
  SecretResolutionRefusal,
  SensitivityScanner,
} from "../../src/domain/ports/index.js";
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
  signal: { aborted: false },
  ...overrides,
});

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
    async record(command) {
      events.push(`record:${command.captureId}`);
      expect(disposed).toBe(false);
      return { kind: "exited", exitCode: 0 };
    },
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
    expect(events).toEqual(["recover", "begin:hash:{\"contextRevision\":1,\"projectId\":\"proj_018f47de-7a00-7cc0-8000-000000000001\",\"secretSourceReferences\":[],\"terminalMode\":\"human\",\"url\":\"http://localhost:3000/\"}", `record:${captureId}`, "post-exit", "scan:0", "decision:promote", "finish"]);
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
    configured.recorder.record = async () => {
      events.push("record-prerequisite-failure");
      return { kind: "prerequisite-or-process-failure" };
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
    ["interruption", { kind: "interrupted" as const }, "interrupt", "operator-cancelled", "interrupted", "rerun-capture"],
    ["non-zero exit", { kind: "exited" as const, exitCode: 12 }, "fail", "recorder-exit", "failed", "rerun-capture"],
  ])("records one terminal %s without a Beacon dependency", async (_name, recorderResult, resolution, reason, status, nextAction) => {
    const events: string[] = [];
    const configured = dependencies(events);
    configured.recorder.record = async () => recorderResult;
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
});
