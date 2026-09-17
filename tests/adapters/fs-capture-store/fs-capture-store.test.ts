import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BeaconId, CaptureBeaconAssociation, CaptureId, RequestId } from "../../../src/domain/capture/index.js";
import type { ProjectId } from "../../../src/domain/project/index.js";
import { annotationEligibility } from "../../../src/domain/capture/index.js";
import { FsCaptureStore, type CaptureStoreStage } from "../../../src/adapters/fs-capture-store/index.js";

let root: string;
const projectId = "proj_018f47de-7a00-7cc0-8000-000000000001" as ProjectId;
const captureId = "cap_018f47de-7a00-7cc0-8000-000000000001" as CaptureId;
const requestId = "req_018f47de-7a00-7cc0-8000-000000000001" as RequestId;

const begin = () => ({
  projectId,
  captureId,
  requestId,
  inputHash: "sha256:request",
  secretSourceReferences: ["env:CAPTURE_TOKEN"],
  createdAt: "2026-03-01T00:00:00.000Z",
});

beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "pharos-capture-store-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("FsCaptureStore lifecycle", () => {
  it("permits only post-exit promotion and keeps promoted state annotatable", async () => {
    const store = new FsCaptureStore({ projectRoot: root });
    await expect(store.begin(begin())).resolves.toMatchObject({ ok: true, value: { status: "running" } });
    await expect(store.markPostExit(projectId, captureId, "2026-03-01T00:01:00.000Z")).resolves.toMatchObject({ ok: true, value: { status: "post_exit" } });
    const stage = join(root, "capture-staging", captureId);
    await mkdir(stage, { recursive: true });
    await writeFile(join(stage, "recording.spec.ts"), "", { mode: 0o600 });
    await expect(store.recordResolution(projectId, captureId, {
      resolution: "promote", recordedAt: "2026-03-01T00:02:00.000Z",
      artifact: { reference: `captures/${captureId}/recording.spec.ts`, byteSize: 0, sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" },
    })).resolves.toMatchObject({ ok: true, value: { status: "resolving", resolution: "promote" } });
    const result = await store.finishResolution(projectId, captureId, "2026-03-01T00:03:00.000Z");
    expect(result).toMatchObject({ ok: true, value: { status: "promoted", completedAt: "2026-03-01T00:03:00.000Z" } });
    if (!result.ok) throw new Error("expected promoted session");
    expect(annotationEligibility(result.value)).toEqual({ ok: true, value: result.value });
  });

  it.each([
    ["running", "promote"],
    ["post_exit", "fail"],
    ["running", "reject"],
  ] as const)("refuses illegal %s → resolving(%s) transitions", async (start, resolution) => {
    const store = new FsCaptureStore({ projectRoot: root });
    await store.begin(begin());
    if (start === "post_exit") await store.markPostExit(projectId, captureId, "2026-03-01T00:01:00.000Z");
    const result = await store.recordResolution(projectId, captureId, { resolution, recordedAt: "2026-03-01T00:02:00.000Z" });
    expect(result).toEqual({ ok: false, error: { rule: "capture-illegal-transition", captureId, from: start, to: "resolving" } });
  });

  it("replays a write-once request plan after a crash before its first session write", async () => {
    const crashing = new FsCaptureStore({ projectRoot: root, observer: { onStage: (stage: CaptureStoreStage) => {
      if (stage === "before-session-write") throw new Error("injected pre-session crash");
    } } });
    await expect(crashing.begin(begin())).rejects.toThrow("injected pre-session crash");
    const replay = await new FsCaptureStore({ projectRoot: root }).begin(begin());
    expect(replay).toMatchObject({ ok: true, value: { status: "running", captureId } });
  });

  it("persists sessions and request plans as private state", async () => {
    const store = new FsCaptureStore({ projectRoot: root });
    await store.begin(begin());
    const sessionPath = join(root, "captures", captureId, "session.json");
    const journalPath = join(root, "capture-journal", "requests");
    expect((await lstat(sessionPath)).mode & 0o777).toBe(0o600);
    expect((await lstat(join(root, "captures", captureId))).mode & 0o777).toBe(0o700);
    expect((await lstat(journalPath)).mode & 0o777).toBe(0o700);
    expect(await readFile(sessionPath, "utf8")).toContain('"status":"running"');
  });

  it("persists only a safe recorder PID for a running capture", async () => {
    const store = new FsCaptureStore({ projectRoot: root });
    await store.begin(begin());

    await expect((store as typeof store & {
      recordRecorderStarted(project: typeof projectId, capture: typeof captureId, evidence: { readonly pid: number }): Promise<unknown>;
    }).recordRecorderStarted(projectId, captureId, { pid: 4242 })).resolves.toMatchObject({
      ok: true,
      value: { status: "running", recorder: { pid: 4242 } },
    });
    const persisted = await readFile(join(root, "captures", captureId, "session.json"), "utf8");
    expect(persisted).toContain('"recorder":{"pid":4242}');
    expect(persisted).not.toContain("recording.spec.ts");
  });

  it.each([
    ["fail", "failed"],
    ["interrupt", "interrupted"],
  ] as const)("terminalizes running sessions through resolving(%s) → %s and deletes staging", async (resolution, terminal) => {
    const store = new FsCaptureStore({ projectRoot: root });
    await store.begin(begin());
    const stage = join(root, "capture-staging", captureId, "recording.spec.ts");
    await writeFile(stage, "private bytes", { mode: 0o600 });
    await store.recordResolution(projectId, captureId, { resolution, recordedAt: "2026-03-01T00:01:00.000Z" });
    const finished = await store.finishResolution(projectId, captureId, "2026-03-01T00:02:00.000Z");
    expect(finished).toMatchObject({ ok: true, value: { status: terminal } });
    await expect(lstat(stage)).rejects.toMatchObject({ code: "ENOENT" });
    if (!finished.ok) throw new Error("expected terminal session");
    expect(annotationEligibility(finished.value)).toEqual({ ok: false, error: { rule: "capture-not-promoted", captureId, status: terminal } });
  });

  it("rejects bytes safely and refuses conflicting request reuse", async () => {
    const store = new FsCaptureStore({ projectRoot: root });
    await store.begin(begin());
    await writeFile(join(root, "capture-staging", captureId, "recording.spec.ts"), "CANARY-SECRET", { mode: 0o600 });
    await store.markPostExit(projectId, captureId, "2026-03-01T00:01:00.000Z");
    await store.recordResolution(projectId, captureId, { resolution: "reject", recordedAt: "2026-03-01T00:02:00.000Z", detectionCount: 1 });
    const rejected = await store.finishResolution(projectId, captureId, "2026-03-01T00:03:00.000Z");
    expect(rejected).toMatchObject({ ok: true, value: { status: "rejected", detectionCount: 1 } });
    const stored = await readFile(join(root, "captures", captureId, "session.json"), "utf8");
    expect(stored).not.toContain("CANARY-SECRET");
    await expect(store.begin({ ...begin(), inputHash: "sha256:other" })).resolves.toEqual({ ok: false, error: { rule: "capture-request-conflict", requestId } });
  });

  it("converges an original finish after recovery completes its durable decision", async () => {
    let releaseDecisionRecorded!: () => void;
    const decisionRecorded = new Promise<void>((resolve) => { releaseDecisionRecorded = resolve; });
    const original = new FsCaptureStore({ projectRoot: root, observer: { onStage(stage) {
      if (stage === "resolution-decision-recorded") releaseDecisionRecorded();
    } } });
    const recovery = new FsCaptureStore({ projectRoot: root });
    await original.begin(begin());
    await original.recordResolution(projectId, captureId, {
      resolution: "interrupt",
      recordedAt: "2026-03-01T00:01:00.000Z",
      reason: "signal",
    });
    await decisionRecorded;
    const recovered = await recovery.recover(projectId);
    if (!recovered.ok) throw new Error("expected recovery to terminalize the durable decision");
    expect(recovered.value).toMatchObject([expect.objectContaining({ status: "interrupted" })]);
    const originalFinish = await original.finishResolution(projectId, captureId, "2026-03-01T00:02:00.000Z");
    expect(originalFinish).toEqual({ ok: true, value: recovered.value[0] });
  });

  it("repairs request completion when a terminal session was written before the journal", async () => {
    let crashAfterTerminalWrite = false;
    const crashing = new FsCaptureStore({ projectRoot: root, observer: { onStage(stage) {
      if (crashAfterTerminalWrite && stage === "session-written") throw new Error("injected terminal journal crash");
    } } });
    await crashing.begin(begin());
    await crashing.recordResolution(projectId, captureId, {
      resolution: "interrupt",
      recordedAt: "2026-03-01T00:01:00.000Z",
      reason: "signal",
    });
    crashAfterTerminalWrite = true;
    await expect(crashing.finishResolution(projectId, captureId, "2026-03-01T00:02:00.000Z")).rejects.toThrow("injected terminal journal crash");
    crashAfterTerminalWrite = false;

    await expect(new FsCaptureStore({ projectRoot: root }).finishResolution(projectId, captureId, "2026-03-01T00:03:00.000Z"))
      .resolves.toMatchObject({ ok: true, value: { status: "interrupted", completedAt: "2026-03-01T00:02:00.000Z" } });
    const journalPath = join(root, "capture-journal", "requests", `${createHash("sha256").update(requestId).digest("hex")}.json`);
    expect(await readFile(journalPath, "utf8")).toContain('"completion":{"status":"interrupted"');
  });

  it("continues to reject a conflicting resolution after a durable decision", async () => {
    const store = new FsCaptureStore({ projectRoot: root });
    await store.begin(begin());
    await store.recordResolution(projectId, captureId, {
      resolution: "interrupt",
      recordedAt: "2026-03-01T00:01:00.000Z",
      reason: "signal",
    });

    await expect(store.recordResolution(projectId, captureId, {
      resolution: "fail",
      recordedAt: "2026-03-01T00:02:00.000Z",
      reason: "recorder-exit",
    })).resolves.toEqual({
      ok: false,
      error: { rule: "capture-illegal-transition", captureId, from: "resolving", to: "resolving" },
    });
  });

  it("replays the persisted identity when generated capture ID and creation time advance", async () => {
    const store = new FsCaptureStore({ projectRoot: root });
    const original = await store.begin(begin());
    const nextCaptureId = "cap_018f47de-7a00-7cc0-8000-000000000002" as CaptureId;

    const replay = await store.begin({
      ...begin(),
      captureId: nextCaptureId,
      createdAt: "2026-03-01T00:01:00.000Z",
    });

    expect(replay).toEqual(original);
    await expect(store.getSession(projectId, nextCaptureId)).resolves.toEqual({
      ok: false,
      error: { rule: "capture-not-found", captureId: nextCaptureId },
    });
  });

  it("uses canonical secret-reference order for replay but still rejects changed input", async () => {
    const store = new FsCaptureStore({ projectRoot: root });
    const original = await store.begin({ ...begin(), secretSourceReferences: ["env:ALPHA", "env:BETA"] });
    const nextCaptureId = "cap_018f47de-7a00-7cc0-8000-000000000002" as CaptureId;

    await expect(store.begin({
      ...begin(),
      captureId: nextCaptureId,
      createdAt: "2026-03-01T00:01:00.000Z",
      secretSourceReferences: ["env:BETA", "env:ALPHA"],
    })).resolves.toEqual(original);
    await expect(store.begin({
      ...begin(),
      captureId: "cap_018f47de-7a00-7cc0-8000-000000000003" as CaptureId,
      createdAt: "2026-03-01T00:02:00.000Z",
      inputHash: "sha256:changed-canonical-input",
      secretSourceReferences: ["env:BETA", "env:ALPHA"],
    })).resolves.toEqual({ ok: false, error: { rule: "capture-request-conflict", requestId } });
  });

  it("recovers only a durable promotion decision without overwriting an existing destination", async () => {
    let crash = true;
    const store = new FsCaptureStore({ projectRoot: root, observer: { onStage: (stage: CaptureStoreStage) => {
      if (crash && stage === "promoted-materialized") throw new Error("injected promotion crash");
    } } });
    await store.begin(begin());
    await store.markPostExit(projectId, captureId, "2026-03-01T00:01:00.000Z");
    const bytes = "safe artifact";
    await writeFile(join(root, "capture-staging", captureId, "recording.spec.ts"), bytes, { mode: 0o600 });
    const sha256 = "795c94b7d38f479d6bdaf17b185f3b8e235a41de64798148c7ef42805a902870";
    await store.recordResolution(projectId, captureId, { resolution: "promote", recordedAt: "2026-03-01T00:02:00.000Z", artifact: { reference: `captures/${captureId}/recording.spec.ts`, byteSize: Buffer.byteLength(bytes), sha256 } });
    await expect(store.finishResolution(projectId, captureId, "2026-03-01T00:03:00.000Z")).rejects.toThrow("injected promotion crash");
    crash = false;
    await expect(store.recover(projectId)).resolves.toMatchObject({ ok: true, value: [expect.objectContaining({ status: "promoted" })] });
    const destination = join(root, "captures", captureId, "recording.spec.ts");
    expect(await readFile(destination, "utf8")).toBe(bytes);
    await expect(store.recover(projectId)).resolves.toEqual({ ok: true, value: [] });
  });

  it("sweeps only stale regular temporary files and leaves young files untouched", async () => {
    const store = new FsCaptureStore({ projectRoot: root });
    await store.begin(begin());
    const stage = join(root, "capture-staging", captureId);
    const oldTemp = join(stage, "recording.spec.ts.tmp.old");
    const youngTemp = join(stage, "recording.spec.ts.tmp.young");
    await writeFile(oldTemp, "stale");
    await writeFile(youngTemp, "live");
    const old = new Date(Date.now() - 3_000);
    await utimes(oldTemp, old, old);
    await expect(store.recover(projectId)).resolves.toEqual({ ok: true, value: [] });
    await expect(lstat(oldTemp)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(youngTemp, "utf8")).toBe("live");
  });

  it.each([
    "session-written",
    "resolution-decision-recorded",
    "promoted-materialized",
    "stage-unlinked",
    "journal-completed",
  ] as const)("converges a durable promotion after an injected %s crash", async (crashStage) => {
    const setup = new FsCaptureStore({ projectRoot: root });
    await setup.begin(begin());
    await setup.markPostExit(projectId, captureId, "2026-03-01T00:01:00.000Z");
    const bytes = "safe artifact";
    await writeFile(join(root, "capture-staging", captureId, "recording.spec.ts"), bytes, { mode: 0o600 });
    let armed = true;
    const crashing = new FsCaptureStore({ projectRoot: root, observer: { onStage: (stage) => {
      if (armed && stage === crashStage) throw new Error(`injected ${stage} crash`);
    } } });
    const resolution = { resolution: "promote" as const, recordedAt: "2026-03-01T00:02:00.000Z", artifact: { reference: `captures/${captureId}/recording.spec.ts`, byteSize: Buffer.byteLength(bytes), sha256: "795c94b7d38f479d6bdaf17b185f3b8e235a41de64798148c7ef42805a902870" } };
    if (crashStage === "session-written" || crashStage === "resolution-decision-recorded") {
      await expect(crashing.recordResolution(projectId, captureId, resolution)).rejects.toThrow(`injected ${crashStage} crash`);
    } else {
      await crashing.recordResolution(projectId, captureId, resolution);
      await expect(crashing.finishResolution(projectId, captureId, "2026-03-01T00:03:00.000Z")).rejects.toThrow(`injected ${crashStage} crash`);
    }
    armed = false;
    await expect(new FsCaptureStore({ projectRoot: root }).recover(projectId)).resolves.toMatchObject({ ok: true });
    await expect(new FsCaptureStore({ projectRoot: root }).getSession(projectId, captureId)).resolves.toMatchObject({ ok: true, value: { status: "promoted" } });
  });

  it("owns matching forward and reverse supporting associations outside BeaconStore", async () => {
    const store = new FsCaptureStore({ projectRoot: root });
    const association = {
      contract: "pharos.capture-beacon-association/1" as const,
      state: "pending" as const,
      projectId,
      captureId,
      requestId,
      inputHash: "sha256:annotation",
      beaconId: "bcn_018f47de-7a00-7cc0-8000-000000000003" as const,
      draftId: "drf_018f47de-7a00-7cc0-8000-000000000004" as const,
      revision: 1 as const,
      createdAt: "2026-03-01T00:00:00.000Z",
    };
    await expect(store.claimAnnotation(association)).resolves.toEqual({ ok: true, value: association });
    const committed = { ...association, state: "committed" as const, semanticHash: "sha256:semantic", committedAt: "2026-03-01T00:02:00.000Z" };
    await expect(store.commitAssociation(committed)).resolves.toEqual({ ok: true, value: committed });
    await expect(store.getAssociationByCapture(projectId, captureId)).resolves.toEqual({ ok: true, value: committed });
    await expect(store.getAssociationByBeacon(projectId, association.beaconId)).resolves.toEqual({ ok: true, value: committed });
  });

  it("refuses a substituted staging symlink without promoting its target", async () => {
    const secondCapture = "cap_018f47de-7a00-7cc0-8000-000000000002" as CaptureId;
    const secondRequest = "req_018f47de-7a00-7cc0-8000-000000000002" as RequestId;
    const store = new FsCaptureStore({ projectRoot: root });
    await store.begin({ ...begin(), captureId: secondCapture, requestId: secondRequest });
    await store.markPostExit(projectId, secondCapture, "2026-03-01T00:01:00.000Z");
    const outside = join(root, "outside-secret.spec.ts");
    await writeFile(outside, "outside bytes");
    await symlink(outside, join(root, "capture-staging", secondCapture, "recording.spec.ts"));
    await store.recordResolution(projectId, secondCapture, { resolution: "promote", recordedAt: "2026-03-01T00:02:00.000Z", artifact: { reference: `captures/${secondCapture}/recording.spec.ts`, byteSize: 13, sha256: "a".repeat(64) } });
    await expect(store.finishResolution(projectId, secondCapture, "2026-03-01T00:03:00.000Z")).resolves.toEqual({ ok: false, error: { rule: "capture-store-corruption", captureId: secondCapture } });
    await expect(lstat(join(root, "captures", secondCapture, "recording.spec.ts"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not terminally promote bytes mutated through the hard-linked staging name", async () => {
    const staged = join(root, "capture-staging", captureId, "recording.spec.ts");
    const destination = join(root, "captures", captureId, "recording.spec.ts");
    const bytes = "validated artifact";
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const store = new FsCaptureStore({ projectRoot: root, observer: { async onStage(stage) {
      if (stage === "promoted-materialized") await writeFile(staged, "mutated after validation");
    } } });
    await store.begin(begin());
    await store.markPostExit(projectId, captureId, "2026-03-01T00:01:00.000Z");
    await writeFile(staged, bytes, { mode: 0o600 });
    await store.recordResolution(projectId, captureId, { resolution: "promote", recordedAt: "2026-03-01T00:02:00.000Z", artifact: { reference: `captures/${captureId}/recording.spec.ts`, byteSize: Buffer.byteLength(bytes), sha256 } });

    await expect(store.finishResolution(projectId, captureId, "2026-03-01T00:03:00.000Z")).resolves.toEqual({ ok: false, error: { rule: "capture-store-corruption", captureId } });
    await expect(store.getSession(projectId, captureId)).resolves.toMatchObject({ ok: true, value: { status: "resolving", resolution: "promote" } });
    expect(await readFile(staged, "utf8")).toBe("mutated after validation");
    await expect(lstat(destination)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each([
    ["promotion", "promote", "not-a-time"],
    ["promotion", "promote", "2026-03-01T00:03:00Z"],
    ["destructive rejection", "reject", "not-a-time"],
    ["destructive rejection", "reject", "2026-03-01T00:03:00Z"],
  ] as const)("refuses %s resolution with invalid completion time before mutating state", async (_kind, resolution, completedAt) => {
    const staged = join(root, "capture-staging", captureId, "recording.spec.ts");
    const destination = join(root, "captures", captureId, "recording.spec.ts");
    const bytes = "still staged";
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const store = new FsCaptureStore({ projectRoot: root });
    await store.begin(begin());
    await store.markPostExit(projectId, captureId, "2026-03-01T00:01:00.000Z");
    await writeFile(staged, bytes, { mode: 0o600 });
    await store.recordResolution(projectId, captureId, resolution === "promote"
      ? { resolution, recordedAt: "2026-03-01T00:02:00.000Z", artifact: { reference: `captures/${captureId}/recording.spec.ts`, byteSize: Buffer.byteLength(bytes), sha256 } }
      : { resolution, recordedAt: "2026-03-01T00:02:00.000Z", detectionCount: 1 });

    await expect(store.finishResolution(projectId, captureId, completedAt)).resolves.toEqual({ ok: false, error: { rule: "capture-store-corruption", captureId } });
    await expect(store.getSession(projectId, captureId)).resolves.toMatchObject({ ok: true, value: { status: "resolving", resolution } });
    expect(await readFile(staged, "utf8")).toBe(bytes);
    await expect(lstat(destination)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each([
    ["unknown status", { status: "totally-invalid" }],
    ["noncanonical timestamp", { createdAt: "2026-03-01T00:00:00Z" }],
    ["invalid timestamp", { createdAt: "not-a-time" }],
    ["invalid project identifier", { projectId: "proj_invalid" }],
    ["invalid capture identifier", { captureId: "cap_invalid" }],
    ["invalid request identifier", { requestId: "req_invalid" }],
    ["wrong contract", { contract: "pharos.capture-session/2" }],
    ["unsafe secret reference", { secretSourceReferences: ["env:../../CAPTURE_TOKEN"] }],
    ["running-only forbidden field", { recorderExitedAt: "2026-03-01T00:01:00.000Z" }],
    ["post-exit missing timestamp", { status: "post_exit" }],
    ["promoted malformed artifact", { status: "promoted", artifact: { reference: `captures/${captureId}/../../outside`, byteSize: 1.5, sha256: "A".repeat(64) }, completedAt: "2026-03-01T00:01:00.000Z" }],
    ["rejected missing detection count", { status: "rejected", reason: "sensitive-content", completedAt: "2026-03-01T00:01:00.000Z" }],
    ["failed forbidden detection count", { status: "failed", reason: "recorder-exit", detectionCount: 1, completedAt: "2026-03-01T00:01:00.000Z" }],
    ["interrupted invalid reason", { status: "interrupted", reason: "recorder-exit", completedAt: "2026-03-01T00:01:00.000Z" }],
    ["resolving promote missing artifact", { status: "resolving", resolution: "promote" }],
    ["resolving reject with artifact", { status: "resolving", resolution: "reject", detectionCount: 1, reason: "sensitive-content", artifact: { reference: `captures/${captureId}/recording.spec.ts`, byteSize: 0, sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" } }],
  ])("reports persisted %s as corruption for the requested capture", async (_caseName, override) => {
    const store = new FsCaptureStore({ projectRoot: root });
    await store.begin(begin());
    const persisted = { ...begin(), contract: "pharos.capture-session/1", status: "running", ...override };
    await writeFile(join(root, "captures", captureId, "session.json"), JSON.stringify(persisted));

    await expect(store.getSession(projectId, captureId)).resolves.toEqual({
      ok: false,
      error: { rule: "capture-store-corruption", captureId },
    });
  });

  it.each([
    ["running", {}],
    ["post_exit", { status: "post_exit", recorderExitedAt: "2026-03-01T00:01:00.000Z" }],
    ["resolving promote", { status: "resolving", resolution: "promote", artifact: { reference: `captures/${captureId}/recording.spec.ts`, byteSize: 0, sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" } }],
    ["resolving reject", { status: "resolving", resolution: "reject", reason: "sensitive-content", detectionCount: 1 }],
    ["resolving fail", { status: "resolving", resolution: "fail", reason: "recorder-exit" }],
    ["resolving interrupt", { status: "resolving", resolution: "interrupt", reason: "signal" }],
    ["promoted", { status: "promoted", artifact: { reference: `captures/${captureId}/recording.spec.ts`, byteSize: 0, sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" }, completedAt: "2026-03-01T00:01:00.000Z" }],
    ["rejected", { status: "rejected", reason: "scan-incomplete", detectionCount: 0, completedAt: "2026-03-01T00:01:00.000Z" }],
    ["failed", { status: "failed", reason: "recorder-prerequisite-or-process-failure", completedAt: "2026-03-01T00:01:00.000Z" }],
    ["interrupted", { status: "interrupted", reason: "operator-cancelled", completedAt: "2026-03-01T00:01:00.000Z" }],
  ])("accepts the complete valid persisted %s shape", async (_caseName, override) => {
    const store = new FsCaptureStore({ projectRoot: root });
    await store.begin(begin());
    const persisted = { ...begin(), contract: "pharos.capture-session/1", status: "running", ...override };
    await writeFile(join(root, "captures", captureId, "session.json"), JSON.stringify(persisted));

    await expect(store.getSession(projectId, captureId)).resolves.toMatchObject({ ok: true, value: { status: persisted.status } });
  });

  it.each([
    `captures/${captureId}/../../outside`,
    `/captures/${captureId}/recording.spec.ts`,
    `captures\\${captureId}\\recording.spec.ts`,
    `captures/%2e%2e/${captureId}/recording.spec.ts`,
    `captures/cap_018f47de-7a00-7cc0-8000-000000000002/recording.spec.ts`,
    `captures/${captureId}/other.spec.ts`,
  ])("refuses unsafe promoted artifact reference %s for its actual capture", async (reference) => {
    const store = new FsCaptureStore({ projectRoot: root });
    await store.begin(begin());
    await store.markPostExit(projectId, captureId, "2026-03-01T00:01:00.000Z");

    await expect(store.recordResolution(projectId, captureId, {
      resolution: "promote",
      recordedAt: "2026-03-01T00:02:00.000Z",
      artifact: { reference, byteSize: 0, sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" },
    })).resolves.toEqual({
      ok: false,
      error: { rule: "capture-store-corruption", captureId },
    });
  });

  it.each([
    ["missing secret references", (value: Record<string, unknown>) => { delete value.secretSourceReferences; }],
    ["mismatched request identity", (value: Record<string, unknown>) => { value.requestId = "req_018f47de-7a00-7cc0-8000-000000000099"; }],
    ["nonterminal completion", (value: Record<string, unknown>) => { value.completion = { status: "running", captureId }; }],
    ["mismatched completion capture", (value: Record<string, unknown>) => { value.completion = { status: "promoted", captureId: "cap_018f47de-7a00-7cc0-8000-000000000099" }; }],
    ["terminal completion inconsistent with the persisted session", (value: Record<string, unknown>) => { value.completion = { status: "promoted", captureId }; }],
  ] as const)("fails closed for persisted request journal with %s", async (_caseName, mutate) => {
    const store = new FsCaptureStore({ projectRoot: root });
    await store.begin(begin());
    const journalPath = join(root, "capture-journal", "requests", `${createHash("sha256").update(requestId).digest("hex")}.json`);
    const journal = { ...begin() } as Record<string, unknown>;
    mutate(journal);
    await writeFile(journalPath, JSON.stringify(journal));

    await expect(store.begin(begin())).resolves.toEqual({
      ok: false,
      error: { rule: "capture-store-corruption", captureId },
    });
  });

  it("fails closed for a non-regular persisted request journal rather than throwing", async () => {
    const store = new FsCaptureStore({ projectRoot: root });
    await store.begin(begin());
    const journalPath = join(root, "capture-journal", "requests", `${createHash("sha256").update(requestId).digest("hex")}.json`);
    await rm(journalPath);
    await mkdir(journalPath);

    await expect(store.begin(begin())).resolves.toEqual({
      ok: false,
      error: { rule: "capture-store-corruption", captureId },
    });
  });

  it("fails closed for a symlinked persisted session state path", async () => {
    const store = new FsCaptureStore({ projectRoot: root });
    await store.begin(begin());
    const sessionPath = join(root, "captures", captureId, "session.json");
    const outside = join(root, "outside-session.json");
    await writeFile(outside, JSON.stringify({ ...begin(), contract: "pharos.capture-session/1", status: "running" }));
    await rm(sessionPath);
    await symlink(outside, sessionPath);

    await expect(store.getSession(projectId, captureId)).resolves.toEqual({
      ok: false,
      error: { rule: "capture-store-corruption", captureId },
    });
  });

  it("rejects a partial invented association instead of trusting its matching scalar fields", async () => {
    const store = new FsCaptureStore({ projectRoot: root });
    const path = join(root, "capture-associations", "by-capture", `${captureId}.json`);
    await mkdir(join(root, "capture-associations", "by-capture"), { recursive: true });
    await writeFile(path, JSON.stringify({ projectId, captureId, state: "invented" }));

    await expect(store.getAssociationByCapture(projectId, captureId)).resolves.toEqual({
      ok: false,
      error: { rule: "capture-store-corruption", captureId },
    });
  });

  it("repairs a one-sided pending association only on matching retry and refuses reads until agreement", async () => {
    const association = pendingAssociation();
    const capturePath = join(root, "capture-associations", "by-capture", `${captureId}.json`);
    await mkdir(join(root, "capture-associations", "by-capture"), { recursive: true });
    await writeFile(capturePath, JSON.stringify(association));
    const store = new FsCaptureStore({ projectRoot: root });

    await expect(store.getAssociationByCapture(projectId, captureId)).resolves.toEqual({
      ok: false,
      error: { rule: "capture-store-corruption", captureId },
    });
    await expect(store.claimAnnotation(association)).resolves.toEqual({ ok: true, value: association });
    await expect(store.getAssociationByBeacon(projectId, association.beaconId)).resolves.toEqual({ ok: true, value: association });
  });

  it("never overwrites a conflicting reverse association", async () => {
    const association = pendingAssociation();
    const conflicting = { ...pendingAssociation(), captureId: "cap_018f47de-7a00-7cc0-8000-000000000002" as CaptureId, requestId: "req_018f47de-7a00-7cc0-8000-000000000002" as RequestId };
    const capturePath = join(root, "capture-associations", "by-capture", `${captureId}.json`);
    const beaconPath = join(root, "capture-associations", "by-beacon", `${association.beaconId}.json`);
    await mkdir(join(root, "capture-associations", "by-capture"), { recursive: true });
    await mkdir(join(root, "capture-associations", "by-beacon"), { recursive: true });
    await writeFile(capturePath, JSON.stringify(association));
    await writeFile(beaconPath, JSON.stringify(conflicting));
    const before = await readFile(beaconPath, "utf8");

    await expect(new FsCaptureStore({ projectRoot: root }).claimAnnotation(association)).resolves.toEqual({
      ok: false,
      error: { rule: "capture-association-conflict", captureId },
    });
    expect(await readFile(beaconPath, "utf8")).toBe(before);
  });

  it.each(["association-capture-written", "association-beacon-written"] as const)("repairs a pending association after a %s crash and keeps commit idempotent", async (crashStage) => {
    const pending = pendingAssociation();
    let armed = true;
    const crashing = new FsCaptureStore({ projectRoot: root, observer: { onStage(stage) {
      if (armed && stage === crashStage) throw new Error(`injected ${stage} crash`);
    } } });
    await expect(crashing.claimAnnotation(pending)).rejects.toThrow(`injected ${crashStage} crash`);
    armed = false;
    const retry = new FsCaptureStore({ projectRoot: root });
    await expect(retry.claimAnnotation(pending)).resolves.toEqual({ ok: true, value: pending });
    const committed = committedAssociation(pending);
    await expect(retry.commitAssociation(committed)).resolves.toEqual({ ok: true, value: committed });
    await expect(retry.commitAssociation(committed)).resolves.toEqual({ ok: true, value: committed });
    await expect(retry.getAssociationByCapture(projectId, captureId)).resolves.toEqual({ ok: true, value: committed });
  });

  it.each(["association-capture-written", "association-beacon-written"] as const)("recovers a pending-to-committed transition after a %s crash", async (crashStage) => {
    const pending = pendingAssociation();
    const setup = new FsCaptureStore({ projectRoot: root });
    await setup.claimAnnotation(pending);
    const committed = committedAssociation(pending);
    let armed = true;
    const crashing = new FsCaptureStore({ projectRoot: root, observer: { onStage(stage) {
      if (armed && stage === crashStage) throw new Error(`injected ${stage} crash`);
    } } });
    await expect(crashing.commitAssociation(committed)).rejects.toThrow(`injected ${crashStage} crash`);
    armed = false;

    const retry = new FsCaptureStore({ projectRoot: root });
    await expect(retry.commitAssociation(committed)).resolves.toEqual({ ok: true, value: committed });
    await expect(retry.getAssociationByBeacon(projectId, pending.beaconId)).resolves.toEqual({ ok: true, value: committed });
  });

  it.each([
    ["wrong contract", { contract: "pharos.capture-beacon-association/2" }],
    ["extra field", { extra: true }],
    ["empty input identity", { inputHash: " " }],
    ["invalid beacon identity", { beaconId: "bcn_invalid" }],
    ["invalid draft identity", { draftId: "drf_invalid" }],
    ["wrong revision", { revision: 2 }],
    ["noncanonical creation timestamp", { createdAt: "2026-03-01T00:00:00Z" }],
    ["pending completion fields", { semanticHash: "sha256:semantic", committedAt: "2026-03-01T00:02:00.000Z" }],
  ] as const)("refuses closed association records with %s", async (_caseName, override) => {
    const association = { ...pendingAssociation(), ...override };
    const path = join(root, "capture-associations", "by-capture", `${captureId}.json`);
    await mkdir(join(root, "capture-associations", "by-capture"), { recursive: true });
    await writeFile(path, JSON.stringify(association));

    await expect(new FsCaptureStore({ projectRoot: root }).getAssociationByCapture(projectId, captureId)).resolves.toEqual({
      ok: false,
      error: { rule: "capture-store-corruption", captureId },
    });
  });
});

function pendingAssociation(): CaptureBeaconAssociation {
  return {
    contract: "pharos.capture-beacon-association/1",
    state: "pending",
    projectId,
    captureId,
    requestId,
    inputHash: "sha256:annotation",
    beaconId: "bcn_018f47de-7a00-7cc0-8000-000000000003" as BeaconId,
    draftId: "drf_018f47de-7a00-7cc0-8000-000000000004",
    revision: 1,
    createdAt: "2026-03-01T00:00:00.000Z",
  };
}

function committedAssociation(pending: CaptureBeaconAssociation): CaptureBeaconAssociation {
  return {
    ...pending,
    state: "committed",
    semanticHash: "sha256:semantic",
    committedAt: "2026-03-01T00:02:00.000Z",
  };
}
