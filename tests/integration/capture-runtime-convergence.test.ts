import { lstat, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FsCaptureStore } from "../../src/adapters/fs-capture-store/index.js";
import { RecordCapture, type RecordCaptureDependencies } from "../../src/application/record-capture.js";
import type { CaptureId, RequestId } from "../../src/domain/capture/index.js";
import type { ProjectId } from "../../src/domain/project/index.js";
import { err, ok } from "../../src/shared/result.js";

const projectId = "proj_018f47de-7a00-7cc0-8000-000000000001" as ProjectId;
const captureId = "cap_018f47de-7a00-7cc0-8000-000000000001" as CaptureId;
const requestId = "req_018f47de-7a00-7cc0-8000-000000000001" as RequestId;
const timestamp = "2026-03-04T00:00:00.000Z";
let root: string;

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("capture runtime convergence", () => {
  it("serializes immediate exit with a late real-store evidence write and releases the project lock", async () => {
    root = await mkdtemp(join(tmpdir(), "pharos-capture-runtime-"));
    const store = new FsCaptureStore({ projectRoot: root });
    const originalRecordStarted = store.recordRecorderStarted.bind(store);
    let releaseEvidence!: () => void;
    const evidenceGate = new Promise<void>((resolve) => { releaseEvidence = resolve; });
    let evidenceFinished!: () => void;
    const evidenceFinishedPromise = new Promise<void>((resolve) => { evidenceFinished = resolve; });
    store.recordRecorderStarted = async (...args) => {
      await evidenceGate;
      const result = await originalRecordStarted(...args);
      evidenceFinished();
      return result;
    };
    let contained = 0;
    const dependencies: RecordCaptureDependencies = {
      clock: { now: () => new Date(timestamp) },
      ids: { next: () => captureId },
      hasher: { hash: () => "references-only-hash" },
      store,
      resolver: { async resolve() { throw new Error("no secret resolution expected"); } },
      recorder: {
        async start() {
          return {
            evidence: { pid: 4242, identity: "a".repeat(64) },
            async waitForCompletion() { return { kind: "exited" as const, exitCode: 0 }; },
            contain() { contained += 1; },
          };
        },
        async probeProcess() { return "absent"; },
      },
      scanner: { async scan() { return err({ category: "incomplete", count: 0 }); } },
    };

    await expect(new RecordCapture(dependencies).execute({
      projectId,
      contextRevision: 1,
      url: "http://localhost:3000/",
      requestId,
      secretSourceReferences: [],
      noSecretSources: true,
      terminalMode: "human",
      signal: { aborted: false, onAbort: () => () => {} },
    })).resolves.toEqual(ok({
      captureId,
      status: "rejected",
      nextAction: "rerun-capture",
    }));
    await expect(lstat(join(root, "lock"))).rejects.toMatchObject({ code: "ENOENT" });

    releaseEvidence();
    await evidenceFinishedPromise;
    await Promise.resolve();
    expect(contained).toBe(1);
    await expect(lstat(join(root, "lock"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("permits at most one recorder start when two requests finish recovery before launch", async () => {
    root = await mkdtemp(join(tmpdir(), "pharos-capture-runtime-"));
    const store = new FsCaptureStore({ projectRoot: root });
    const recoverProject = store.recoverProject.bind(store);
    let recovered = 0;
    let releaseRecovery!: () => void;
    const recoveryBarrier = new Promise<void>((resolve) => { releaseRecovery = resolve; });
    store.recoverProject = async (...args) => {
      const result = await recoverProject(...args);
      if (++recovered === 2) releaseRecovery();
      await recoveryBarrier;
      return result;
    };
    const secondCaptureId = "cap_018f47de-7a00-7cc0-8000-000000000002" as CaptureId;
    const secondRequestId = "req_018f47de-7a00-7cc0-8000-000000000002" as RequestId;
    let allocated = 0;
    const starts: CaptureId[] = [];
    const dependencies: RecordCaptureDependencies = {
      clock: { now: () => new Date(timestamp) },
      ids: { next: () => ++allocated === 1 ? captureId : secondCaptureId },
      hasher: { hash: () => "references-only-hash" },
      store,
      resolver: { async resolve() { throw new Error("no secret resolution expected"); } },
      recorder: {
        async start(command) {
          starts.push(command.captureId);
          return {
            evidence: undefined,
            async waitForCompletion() { return { kind: "process-still-active" as const }; },
            contain() {},
          };
        },
        async probeProcess() { return "same"; },
      },
      scanner: { async scan() { return err({ category: "incomplete", count: 0 }); } },
    };
    const first = new RecordCapture(dependencies).execute({
      projectId,
      contextRevision: 1,
      url: "http://localhost:3000/one",
      requestId,
      secretSourceReferences: [],
      noSecretSources: true,
      terminalMode: "human",
      signal: { aborted: false, onAbort: () => () => {} },
    });
    const second = new RecordCapture(dependencies).execute({
      projectId,
      contextRevision: 1,
      url: "http://localhost:3000/two",
      requestId: secondRequestId,
      secretSourceReferences: [],
      noSecretSources: true,
      terminalMode: "human",
      signal: { aborted: false, onAbort: () => () => {} },
    });
    const results = await Promise.all([first, second]);
    expect(starts).toHaveLength(1);
    const active = results.filter((result) => !result.ok);
    expect(active).toHaveLength(2);
    expect(active).toContainEqual({
      ok: false,
      error: { rule: "capture-process-still-active", captureId: starts[0] },
    });
  });
});
