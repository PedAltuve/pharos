import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  BeaconId,
  CaptureBeaconAssociation,
  CaptureId,
  RequestId,
} from "../../../src/domain/capture/index.js";
import type { ProjectId } from "../../../src/domain/project/index.js";
import { annotationEligibility } from "../../../src/domain/capture/index.js";
import {
  FsCaptureStore,
  type CaptureStoreStage,
} from "../../../src/adapters/fs-capture-store/index.js";

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
const emptySha =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const artifact = {
  reference: `captures/${captureId}/recording.spec.ts`,
  byteSize: 0,
  sha256: emptySha,
};
const time = "2026-03-01T00:02:00.000Z";
const recorderEvidence = { pid: 4242, identity: "a".repeat(64) };

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "pharos-capture-store-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
async function recording(store: FsCaptureStore): Promise<void> {
  await expect(store.beginLaunch(begin())).resolves.toMatchObject({
    ok: true,
    value: { claimed: true, session: { status: "launching" } },
  });
  await expect(
    store.recordRecorderStarted(projectId, captureId, recorderEvidence),
  ).resolves.toMatchObject({
    ok: true,
    value: { status: "recording", recorder: recorderEvidence },
  });
}
async function postExit(store: FsCaptureStore): Promise<void> {
  await recording(store);
  await expect(
    store.markPostExit(projectId, captureId, "2026-03-01T00:01:00.000Z"),
  ).resolves.toMatchObject({ ok: true, value: { status: "post_exit" } });
}
async function staged(
  bytes = "",
): Promise<{
  readonly bytes: string;
  readonly artifact: {
    readonly reference: string;
    readonly byteSize: number;
    readonly sha256: string;
  };
}> {
  await writeFile(
    join(root, "capture-staging", captureId, "recording.spec.ts"),
    bytes,
    { mode: 0o600 },
  );
  return {
    bytes,
    artifact: {
      reference: artifact.reference,
      byteSize: Buffer.byteLength(bytes),
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
  };
}
function commandFor(suffix: string) {
  return {
    ...begin(),
    captureId: `cap_018f47de-7a00-7cc0-8000-000000000${suffix}` as CaptureId,
    requestId: `req_018f47de-7a00-7cc0-8000-000000000${suffix}` as RequestId,
  };
}
function sessionPath(id: CaptureId): string {
  return join(root, "captures", id, "session.json");
}
function requestPath(id: RequestId): string {
  return join(
    root,
    "capture-journal",
    "requests",
    `${createHash("sha256").update(id).digest("hex")}.json`,
  );
}

describe("FsCaptureStore v2 lifecycle", () => {
  it("initializes and claims launch exactly once before recorder evidence", async () => {
    const store = new FsCaptureStore({ projectRoot: root });
    await expect(store.beginLaunch(begin())).resolves.toMatchObject({
      ok: true,
      value: { claimed: true, session: { contract: "pharos.capture-session/2", status: "launching" } },
    });
    await expect(store.beginLaunch(begin())).resolves.toMatchObject({
      ok: true,
      value: { claimed: false, session: { status: "launching" } },
    });
  });
  it("allows one project-wide launch claim after concurrent empty-project recovery", async () => {
    const first = commandFor("002");
    const second = commandFor("003");
    const firstStore = new FsCaptureStore({ projectRoot: root });
    const secondStore = new FsCaptureStore({ projectRoot: root });
    await Promise.all([
      firstStore.recoverProject(projectId, time),
      secondStore.recoverProject(projectId, time),
    ]);

    const [firstLaunch, secondLaunch] = await Promise.all([
      firstStore.beginLaunch(first),
      secondStore.beginLaunch(second),
    ]);
    const claimed = [firstLaunch, secondLaunch].filter((result) => result.ok && result.value.claimed);
    const refused = [firstLaunch, secondLaunch].filter((result) => !result.ok);
    expect(claimed).toHaveLength(1);
    expect(refused).toHaveLength(1);
    const claimedResult = claimed[0];
    const refusedResult = refused[0];
    if (claimedResult === undefined || !claimedResult.ok || refusedResult === undefined || refusedResult.ok) {
      throw new Error("expected one claim and one refusal");
    }
    expect(refusedResult.error).toEqual({
      rule: "capture-process-still-active",
      captureId: claimedResult.value.session.captureId,
    });
  });

  it("accepts recorder evidence from an atomically claimed launch and reports recording as the target", async () => {
    const store = new FsCaptureStore({ projectRoot: root });
    await store.beginLaunch(begin());
    await expect(
      store.recordRecorderStarted(projectId, captureId, { pid: 1, identity: "a".repeat(64) }),
    ).resolves.toMatchObject({ ok: true, value: { status: "recording" } });
  });
  it("requires a bounded lowercase fingerprint and compares both recorder evidence fields idempotently", async () => {
    const store = new FsCaptureStore({ projectRoot: root });
    await store.beginLaunch(begin());
    const evidence = { pid: 4242, identity: "a".repeat(64) };
    await expect(store.recordRecorderStarted(projectId, captureId, evidence)).resolves.toMatchObject({
      ok: true,
      value: { status: "recording", recorder: evidence },
    });
    await expect(store.recordRecorderStarted(projectId, captureId, { ...evidence, identity: "b".repeat(64) })).resolves.toEqual({
      ok: false,
      error: { rule: "capture-store-corruption", captureId },
    });
  });

  it("maps legacy v1 running sessions to blocked launching without adopting PID ownership", async () => {
    const store = new FsCaptureStore({ projectRoot: root });
    await store.beginLaunch(begin());
    await writeFile(
      join(root, "captures", captureId, "session.json"),
      JSON.stringify({
        ...begin(),
        contract: "pharos.capture-session/1",
        status: "running",
        recorder: { pid: 99 },
      }),
    );
    await expect(store.getSession(projectId, captureId)).resolves.toEqual({
      ok: true,
      value: expect.objectContaining({
        contract: "pharos.capture-session/2",
        status: "launching",
      }),
    });
    await expect(store.beginLaunch(begin())).resolves.toMatchObject({
      ok: true,
      value: { claimed: false },
    });
  });
  it("preserves valid legacy post-exit, resolving, and terminal session data", async () => {
    const variants = [
      { status: "post_exit", recorderExitedAt: time },
      { status: "resolving", resolution: "interrupt", reason: "signal" },
      { status: "interrupted", reason: "signal", completedAt: time },
    ] as const;
    for (const value of variants) {
      const store = new FsCaptureStore({ projectRoot: root });
      await store.beginLaunch(begin());
      await writeFile(
        join(root, "captures", captureId, "session.json"),
        JSON.stringify({
          ...begin(),
          contract: "pharos.capture-session/1",
          ...value,
        }),
      );
      await expect(
        store.getSession(projectId, captureId),
      ).resolves.toMatchObject({
        ok: true,
        value: { contract: "pharos.capture-session/2", status: value.status },
      });
    }
  });
  it("permits only post-exit promotion and keeps promoted state annotatable", async () => {
    const store = new FsCaptureStore({ projectRoot: root });
    await postExit(store);
    const material = await staged();
    const result = await store.resolve(
      projectId,
      captureId,
      { resolution: "promote", artifact: material.artifact },
      time,
    );
    expect(result).toMatchObject({ ok: true, value: { status: "promoted" } });
    if (!result.ok) throw new Error("expected promotion");
    expect(annotationEligibility(result.value)).toEqual({
      ok: true,
      value: result.value,
    });
  });
  it.each([
    ["launching", "promote"],
    ["post_exit", "fail"],
    ["launching", "reject"],
  ] as const)("refuses illegal %s resolution %s", async (start, resolution) => {
    const store = new FsCaptureStore({ projectRoot: root });
    if (start === "post_exit") await postExit(store);
    else await store.beginLaunch(begin());
    const decision =
      resolution === "promote" ? { resolution, artifact } : { resolution };
    await expect(
      store.resolve(projectId, captureId, decision, time),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        rule: "capture-illegal-transition",
        captureId,
        from: start,
        to: "resolving",
      },
    });
  });
  it("replays a write-once request plan after a crash before its pending session write", async () => {
    const crashing = new FsCaptureStore({
      projectRoot: root,
      observer: {
        onStage(stage: CaptureStoreStage) {
          if (stage === "before-session-write")
            throw new Error("pre-session crash");
        },
      },
    });
    await expect(crashing.beginLaunch(begin())).rejects.toThrow("pre-session crash");
    await expect(
      new FsCaptureStore({ projectRoot: root }).beginLaunch(begin()),
    ).resolves.toMatchObject({
      ok: true,
      value: { session: { status: "launching", captureId }, claimed: true },
    });
  });
  it("persists sessions and request plans as private state", async () => {
    const store = new FsCaptureStore({ projectRoot: root });
    await store.beginLaunch(begin());
    const sessionPath = join(root, "captures", captureId, "session.json");
    expect((await lstat(sessionPath)).mode & 0o777).toBe(0o600);
    expect((await lstat(join(root, "captures", captureId))).mode & 0o777).toBe(
      0o700,
    );
    expect(
      (await lstat(join(root, "capture-journal", "requests"))).mode & 0o777,
    ).toBe(0o700);
    expect(await readFile(sessionPath, "utf8")).toContain('"status":"launching"');
  });
  it("persists only safe recorder PID evidence", async () => {
    const store = new FsCaptureStore({ projectRoot: root });
    await recording(store);
    const persisted = await readFile(
      join(root, "captures", captureId, "session.json"),
      "utf8",
    );
    expect(persisted).toContain(`"recorder":{"pid":4242,"identity":"${recorderEvidence.identity}"}`);
    expect(persisted).not.toContain("recording.spec.ts");
  });
  it.each([
    ["fail", "failed"],
    ["interrupt", "interrupted"],
  ] as const)(
    "terminalizes recording through atomic %s and deletes staging",
    async (resolution, status) => {
      const store = new FsCaptureStore({ projectRoot: root });
      await recording(store);
      const stage = join(
        root,
        "capture-staging",
        captureId,
        "recording.spec.ts",
      );
      await writeFile(stage, "private bytes", { mode: 0o600 });
      const result = await store.resolve(
        projectId,
        captureId,
        {
          resolution,
          reason: resolution === "fail" ? "recorder-exit" : "signal",
        },
        time,
      );
      expect(result).toMatchObject({ ok: true, value: { status } });
      await expect(lstat(stage)).rejects.toMatchObject({ code: "ENOENT" });
    },
  );
  it("rejects bytes safely and refuses conflicting request reuse", async () => {
    const store = new FsCaptureStore({ projectRoot: root });
    await postExit(store);
    await staged("CANARY-SECRET");
    await expect(
      store.resolve(
        projectId,
        captureId,
        {
          resolution: "reject",
          reason: "sensitive-content",
          detectionCount: 1,
        },
        time,
      ),
    ).resolves.toMatchObject({
      ok: true,
      value: { status: "rejected", detectionCount: 1 },
    });
    expect(
      await readFile(join(root, "captures", captureId, "session.json"), "utf8"),
    ).not.toContain("CANARY-SECRET");
    await expect(
      store.beginLaunch({ ...begin(), inputHash: "sha256:other" }),
    ).resolves.toEqual({
      ok: false,
      error: { rule: "capture-request-conflict", requestId },
    });
  });
  it("converges a same terminal decision without replacing its original completion time", async () => {
    const store = new FsCaptureStore({ projectRoot: root });
    await recording(store);
    const decision = {
      resolution: "interrupt" as const,
      reason: "signal" as const,
    };
    await expect(
      store.resolve(projectId, captureId, decision, time),
    ).resolves.toMatchObject({ ok: true, value: { completedAt: time } });
    await expect(
      store.resolve(projectId, captureId, decision, "2026-03-01T00:03:00.000Z"),
    ).resolves.toMatchObject({ ok: true, value: { completedAt: time } });
  });
  it("refuses a conflicting terminal decision after atomic resolution", async () => {
    const store = new FsCaptureStore({ projectRoot: root });
    await recording(store);
    await store.resolve(
      projectId,
      captureId,
      { resolution: "interrupt", reason: "signal" },
      time,
    );
    await expect(
      store.resolve(
        projectId,
        captureId,
        { resolution: "fail", reason: "recorder-exit" },
        "2026-03-01T00:03:00.000Z",
      ),
    ).resolves.toEqual({
      ok: false,
      error: { rule: "capture-resolution-conflict", captureId },
    });
  });
  it("recovers a durable resolving decision after a decision-recorded crash", async () => {
    let armed = true;
    const crashing = new FsCaptureStore({
      projectRoot: root,
      observer: {
        onStage(stage) {
          if (armed && stage === "resolution-decision-recorded")
            throw new Error("decision crash");
        },
      },
    });
    await recording(crashing);
    await expect(
      crashing.resolve(
        projectId,
        captureId,
        { resolution: "interrupt", reason: "signal" },
        time,
      ),
    ).rejects.toThrow("decision crash");
    armed = false;
    await expect(
      new FsCaptureStore({ projectRoot: root }).recoverProject(projectId, time),
    ).resolves.toMatchObject({
      ok: true,
      value: { recovered: [expect.objectContaining({ status: "interrupted" })] },
    });
  });
  it("repairs request completion after terminal state writes before the journal", async () => {
    let armed = false;
    let writes = 0;
    const crashing = new FsCaptureStore({
      projectRoot: root,
      observer: {
        onStage(stage) {
          if (armed && stage === "session-written" && ++writes === 2)
            throw new Error("journal crash");
        },
      },
    });
    await recording(crashing);
    armed = true;
    await expect(
      crashing.resolve(
        projectId,
        captureId,
        { resolution: "interrupt", reason: "signal" },
        time,
      ),
    ).rejects.toThrow("journal crash");
    armed = false;
    await expect(
      new FsCaptureStore({ projectRoot: root }).resolve(
        projectId,
        captureId,
        { resolution: "interrupt", reason: "signal" },
        "2026-03-01T00:03:00.000Z",
      ),
    ).resolves.toMatchObject({ ok: true, value: { completedAt: time } });
    const journal = join(
      root,
      "capture-journal",
      "requests",
      `${createHash("sha256").update(requestId).digest("hex")}.json`,
    );
    expect(await readFile(journal, "utf8")).toContain(
      '"completion":{"status":"interrupted"',
    );
  });
  it("replays persisted identity when generated capture ID and creation time advance", async () => {
    const store = new FsCaptureStore({ projectRoot: root });
    const original = await store.beginLaunch(begin());
    await expect(
      store.beginLaunch({
        ...begin(),
        captureId: "cap_018f47de-7a00-7cc0-8000-000000000002" as CaptureId,
        createdAt: time,
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: { claimed: false, session: original.ok ? original.value.session : undefined },
    });
  });
  it("uses canonical secret reference order but rejects changed input identity", async () => {
    const store = new FsCaptureStore({ projectRoot: root });
    const original = await store.beginLaunch({
      ...begin(),
      secretSourceReferences: ["env:ALPHA", "env:BETA"],
    });
    await expect(
      store.beginLaunch({
        ...begin(),
        captureId: "cap_018f47de-7a00-7cc0-8000-000000000002" as CaptureId,
        createdAt: time,
        secretSourceReferences: ["env:BETA", "env:ALPHA"],
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: { claimed: false, session: original.ok ? original.value.session : undefined },
    });
    await expect(
      store.beginLaunch({
        ...begin(),
        inputHash: "sha256:changed",
        secretSourceReferences: ["env:BETA", "env:ALPHA"],
      }),
    ).resolves.toEqual({
      ok: false,
      error: { rule: "capture-request-conflict", requestId },
    });
  });
  it("recovers a promotion without overwriting an already materialized destination", async () => {
    let crash = true;
    const store = new FsCaptureStore({
      projectRoot: root,
      observer: {
        onStage(stage) {
          if (crash && stage === "promoted-materialized")
            throw new Error("promotion crash");
        },
      },
    });
    await postExit(store);
    const material = await staged("safe artifact");
    await expect(
      store.resolve(
        projectId,
        captureId,
        { resolution: "promote", artifact: material.artifact },
        time,
      ),
    ).rejects.toThrow("promotion crash");
    crash = false;
    await expect(store.recoverProject(projectId, time)).resolves.toMatchObject({
      ok: true,
      value: { recovered: [expect.objectContaining({ status: "promoted" })] },
    });
    expect(
      await readFile(
        join(root, "captures", captureId, "recording.spec.ts"),
        "utf8",
      ),
    ).toBe("safe artifact");
  });
  it("sweeps only stale regular temporary files", async () => {
    const store = new FsCaptureStore({ projectRoot: root });
    await store.beginLaunch(begin());
    const stage = join(root, "capture-staging", captureId);
    const old = join(stage, "recording.spec.ts.tmp.old");
    const young = join(stage, "recording.spec.ts.tmp.young");
    await writeFile(old, "stale");
    await writeFile(young, "live");
    const then = new Date(Date.now() - 3_000);
    await utimes(old, then, then);
    await store.recoverProject(projectId, time);
    await expect(lstat(old)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(young, "utf8")).toBe("live");
  });
  it.each([
    "session-written",
    "resolution-decision-recorded",
    "promoted-materialized",
    "stage-unlinked",
    "journal-completed",
  ] as const)(
    "converges a durable promotion after a %s crash",
    async (crashStage) => {
      const setup = new FsCaptureStore({ projectRoot: root });
      await postExit(setup);
      const material = await staged("safe artifact");
      let armed = true;
      const crashing = new FsCaptureStore({
        projectRoot: root,
        observer: {
          onStage(stage) {
            if (armed && stage === crashStage)
              throw new Error(`injected ${stage}`);
          },
        },
      });
      await expect(
        crashing.resolve(
          projectId,
          captureId,
          { resolution: "promote", artifact: material.artifact },
          time,
        ),
      ).rejects.toThrow(`injected ${crashStage}`);
      armed = false;
      await expect(
        new FsCaptureStore({ projectRoot: root }).recoverProject(projectId, time),
      ).resolves.toMatchObject({ ok: true });
      await expect(
        new FsCaptureStore({ projectRoot: root }).getSession(
          projectId,
          captureId,
        ),
      ).resolves.toMatchObject({ ok: true, value: { status: "promoted" } });
    },
  );
  it("refuses a substituted staging symlink without promoting its target", async () => {
    const store = new FsCaptureStore({ projectRoot: root });
    await postExit(store);
    const outside = join(root, "outside-secret.spec.ts");
    await writeFile(outside, "outside bytes");
    await symlink(
      outside,
      join(root, "capture-staging", captureId, "recording.spec.ts"),
    );
    await expect(
      store.resolve(
        projectId,
        captureId,
        {
          resolution: "promote",
          artifact: { ...artifact, byteSize: 13, sha256: "a".repeat(64) },
        },
        time,
      ),
    ).resolves.toEqual({
      ok: false,
      error: { rule: "capture-store-corruption", captureId },
    });
  });
  it("does not terminally promote bytes mutated after validation", async () => {
    const stagedPath = join(
      root,
      "capture-staging",
      captureId,
      "recording.spec.ts",
    );
    const bytes = "validated artifact";
    const store = new FsCaptureStore({
      projectRoot: root,
      observer: {
        async onStage(stage) {
          if (stage === "promoted-materialized")
            await writeFile(stagedPath, "mutated after validation");
        },
      },
    });
    await postExit(store);
    const material = await staged(bytes);
    await expect(
      store.resolve(
        projectId,
        captureId,
        { resolution: "promote", artifact: material.artifact },
        time,
      ),
    ).resolves.toEqual({
      ok: false,
      error: { rule: "capture-store-corruption", captureId },
    });
    await expect(store.getSession(projectId, captureId)).resolves.toMatchObject(
      { ok: true, value: { status: "resolving" } },
    );
  });
  it.each([
    ["promote", "not-a-time"],
    ["promote", "2026-03-01T00:03:00Z"],
    ["reject", "not-a-time"],
    ["reject", "2026-03-01T00:03:00Z"],
  ] as const)(
    "refuses %s with invalid completion time before mutation",
    async (resolution, completedAt) => {
      const store = new FsCaptureStore({ projectRoot: root });
      await postExit(store);
      const material = await staged("still staged");
      const decision =
        resolution === "promote"
          ? { resolution, artifact: material.artifact }
          : {
              resolution,
              reason: "sensitive-content" as const,
              detectionCount: 1,
            };
      await expect(
        store.resolve(projectId, captureId, decision, completedAt),
      ).resolves.toEqual({
        ok: false,
        error: { rule: "capture-store-corruption", captureId },
      });
      await expect(
        store.getSession(projectId, captureId),
      ).resolves.toMatchObject({ ok: true, value: { status: "post_exit" } });
    },
  );
  it.each([
    { status: "totally-invalid" },
    { createdAt: "not-a-time" },
    { projectId: "proj_invalid" },
    { requestId: "req_invalid" },
    { secretSourceReferences: ["env:../../TOKEN"] },
  ] as const)(
    "fails closed for malformed persisted session data",
    async (override) => {
      const store = new FsCaptureStore({ projectRoot: root });
      await store.beginLaunch(begin());
      await writeFile(
        join(root, "captures", captureId, "session.json"),
        JSON.stringify({
          ...begin(),
          contract: "pharos.capture-session/2",
          status: "pending",
          ...override,
        }),
      );
      await expect(store.getSession(projectId, captureId)).resolves.toEqual({
        ok: false,
        error: { rule: "capture-store-corruption", captureId },
      });
    },
  );
  it.each([
    `captures/${captureId}/../../outside`,
    `/captures/${captureId}/recording.spec.ts`,
    `captures\\${captureId}\\recording.spec.ts`,
    `captures/%2e%2e/${captureId}/recording.spec.ts`,
    `captures/cap_018f47de-7a00-7cc0-8000-000000000002/recording.spec.ts`,
    `captures/${captureId}/other.spec.ts`,
  ])("refuses unsafe promoted artifact reference %s", async (reference) => {
    const store = new FsCaptureStore({ projectRoot: root });
    await postExit(store);
    await expect(
      store.resolve(
        projectId,
        captureId,
        { resolution: "promote", artifact: { ...artifact, reference } },
        time,
      ),
    ).resolves.toEqual({
      ok: false,
      error: { rule: "capture-store-corruption", captureId },
    });
  });
  it.each([
    "missing secret references",
    "mismatched request identity",
    "nonterminal completion",
  ] as const)(
    "fails closed for a corrupt request journal: %s",
    async (caseName) => {
      const store = new FsCaptureStore({ projectRoot: root });
      await store.beginLaunch(begin());
      const path = join(
        root,
        "capture-journal",
        "requests",
        `${createHash("sha256").update(requestId).digest("hex")}.json`,
      );
      const journal: Record<string, unknown> = { ...begin() };
      if (caseName === "missing secret references")
        delete journal.secretSourceReferences;
      if (caseName === "mismatched request identity")
        journal.requestId = "req_018f47de-7a00-7cc0-8000-000000000099";
      if (caseName === "nonterminal completion")
        journal.completion = { status: "pending", captureId };
      await writeFile(path, JSON.stringify(journal));
      await expect(store.beginLaunch(begin())).resolves.toEqual({
        ok: false,
        error: { rule: "capture-store-corruption", captureId },
      });
    },
  );
  it("fails closed for a non-regular persisted request journal", async () => {
    const store = new FsCaptureStore({ projectRoot: root });
    await store.beginLaunch(begin());
    const path = join(
      root,
      "capture-journal",
      "requests",
      `${createHash("sha256").update(requestId).digest("hex")}.json`,
    );
    await rm(path);
    await mkdir(path);
    await expect(store.beginLaunch(begin())).resolves.toEqual({
      ok: false,
      error: { rule: "capture-store-corruption", captureId },
    });
  });
  it("fails closed for a symlinked persisted session path", async () => {
    const store = new FsCaptureStore({ projectRoot: root });
    await store.beginLaunch(begin());
    const path = join(root, "captures", captureId, "session.json");
    const outside = join(root, "outside-session.json");
    await writeFile(
      outside,
      JSON.stringify({
        ...begin(),
        contract: "pharos.capture-session/2",
        status: "pending",
      }),
    );
    await rm(path);
    await symlink(outside, path);
    await expect(store.getSession(projectId, captureId)).resolves.toEqual({
      ok: false,
      error: { rule: "capture-store-corruption", captureId },
    });
  });
  it("owns matching forward and reverse supporting associations outside BeaconStore", async () => {
    const store = new FsCaptureStore({ projectRoot: root });
    const association = pendingAssociation();
    await expect(store.claimAnnotation(association)).resolves.toEqual({
      ok: true,
      value: association,
    });
    const committed = committedAssociation(association);
    await expect(store.commitAssociation(committed)).resolves.toEqual({
      ok: true,
      value: committed,
    });
    await expect(
      store.getAssociationByCapture(projectId, captureId),
    ).resolves.toEqual({ ok: true, value: committed });
    await expect(
      store.getAssociationByBeacon(projectId, association.beaconId),
    ).resolves.toEqual({ ok: true, value: committed });
  });
  it("rejects a partial invented association instead of trusting scalar fields", async () => {
    const store = new FsCaptureStore({ projectRoot: root });
    const path = join(
      root,
      "capture-associations",
      "by-capture",
      `${captureId}.json`,
    );
    await mkdir(join(root, "capture-associations", "by-capture"), {
      recursive: true,
    });
    await writeFile(
      path,
      JSON.stringify({ projectId, captureId, state: "invented" }),
    );
    await expect(
      store.getAssociationByCapture(projectId, captureId),
    ).resolves.toEqual({
      ok: false,
      error: { rule: "capture-store-corruption", captureId },
    });
  });
  it("repairs a one-sided pending association only on matching retry", async () => {
    const association = pendingAssociation();
    const path = join(
      root,
      "capture-associations",
      "by-capture",
      `${captureId}.json`,
    );
    await mkdir(join(root, "capture-associations", "by-capture"), {
      recursive: true,
    });
    await writeFile(path, JSON.stringify(association));
    const store = new FsCaptureStore({ projectRoot: root });
    await expect(
      store.getAssociationByCapture(projectId, captureId),
    ).resolves.toMatchObject({ ok: false });
    await expect(store.claimAnnotation(association)).resolves.toEqual({
      ok: true,
      value: association,
    });
  });
  it("never overwrites a conflicting reverse association", async () => {
    const association = pendingAssociation();
    const conflict = {
      ...association,
      captureId: "cap_018f47de-7a00-7cc0-8000-000000000002" as CaptureId,
      requestId: "req_018f47de-7a00-7cc0-8000-000000000002" as RequestId,
    };
    const path = join(
      root,
      "capture-associations",
      "by-beacon",
      `${association.beaconId}.json`,
    );
    await mkdir(join(root, "capture-associations", "by-beacon"), {
      recursive: true,
    });
    await writeFile(path, JSON.stringify(conflict));
    const before = await readFile(path, "utf8");
    await expect(
      new FsCaptureStore({ projectRoot: root }).claimAnnotation(association),
    ).resolves.toEqual({
      ok: false,
      error: { rule: "capture-association-conflict", captureId },
    });
    expect(await readFile(path, "utf8")).toBe(before);
  });
  it.each([
    "association-capture-written",
    "association-beacon-written",
  ] as const)(
    "repairs a pending association after %s crash and keeps commit idempotent",
    async (stage) => {
      const association = pendingAssociation();
      let armed = true;
      const crashing = new FsCaptureStore({
        projectRoot: root,
        observer: {
          onStage(actual) {
            if (armed && actual === stage) throw new Error("association crash");
          },
        },
      });
      await expect(crashing.claimAnnotation(association)).rejects.toThrow(
        "association crash",
      );
      armed = false;
      const retry = new FsCaptureStore({ projectRoot: root });
      await expect(retry.claimAnnotation(association)).resolves.toEqual({
        ok: true,
        value: association,
      });
      const committed = committedAssociation(association);
      await expect(retry.commitAssociation(committed)).resolves.toEqual({
        ok: true,
        value: committed,
      });
      await expect(retry.commitAssociation(committed)).resolves.toEqual({
        ok: true,
        value: committed,
      });
    },
  );
  it.each([
    "association-capture-written",
    "association-beacon-written",
  ] as const)(
    "recovers a pending-to-committed association after %s crash",
    async (stage) => {
      const association = pendingAssociation();
      const setup = new FsCaptureStore({ projectRoot: root });
      await setup.claimAnnotation(association);
      const committed = committedAssociation(association);
      let armed = true;
      const crashing = new FsCaptureStore({
        projectRoot: root,
        observer: {
          onStage(actual) {
            if (armed && actual === stage) throw new Error("commit crash");
          },
        },
      });
      await expect(crashing.commitAssociation(committed)).rejects.toThrow(
        "commit crash",
      );
      armed = false;
      await expect(
        new FsCaptureStore({ projectRoot: root }).commitAssociation(committed),
      ).resolves.toEqual({ ok: true, value: committed });
    },
  );
  it.each([
    { status: "pending" },
    { status: "launching" },
    { status: "recording", recorder: recorderEvidence },
    { status: "post_exit", recorderExitedAt: time },
    { status: "resolving", resolution: "promote", artifact },
    {
      status: "resolving",
      resolution: "reject",
      reason: "sensitive-content",
      detectionCount: 1,
    },
    { status: "resolving", resolution: "fail", reason: "recorder-exit" },
    { status: "resolving", resolution: "interrupt", reason: "signal" },
    { status: "promoted", artifact, completedAt: time },
    {
      status: "rejected",
      reason: "scan-incomplete",
      detectionCount: 0,
      completedAt: time,
    },
    {
      status: "failed",
      reason: "recorder-prerequisite-or-process-failure",
      completedAt: time,
    },
    { status: "interrupted", reason: "operator-cancelled", completedAt: time },
  ] as const)(
    "accepts each complete valid persisted v2 session shape",
    async (override) => {
      const store = new FsCaptureStore({ projectRoot: root });
      await store.beginLaunch(begin());
      await writeFile(
        join(root, "captures", captureId, "session.json"),
        JSON.stringify({
          ...begin(),
          contract: "pharos.capture-session/2",
          ...override,
        }),
      );
      await expect(
        store.getSession(projectId, captureId),
      ).resolves.toMatchObject({
        ok: true,
        value: { status: override.status },
      });
    },
  );
  it.each([
    { status: "totally-invalid" },
    { createdAt: "2026-03-01T00:00:00Z" },
    { captureId: "cap_invalid" },
    { contract: "pharos.capture-session/1" },
    { secretSourceReferences: ["env:../../CAPTURE_TOKEN"] },
    { recorderExitedAt: time },
    { status: "post_exit" },
    {
      status: "promoted",
      artifact: {
        reference: `captures/${captureId}/../../outside`,
        byteSize: 1.5,
        sha256: "A".repeat(64),
      },
      completedAt: time,
    },
    { status: "rejected", reason: "sensitive-content", completedAt: time },
    {
      status: "failed",
      reason: "recorder-exit",
      detectionCount: 1,
      completedAt: time,
    },
    { status: "interrupted", reason: "recorder-exit", completedAt: time },
    { status: "resolving", resolution: "promote" },
    {
      status: "resolving",
      resolution: "reject",
      reason: "sensitive-content",
      detectionCount: 1,
      artifact,
    },
  ] as const)(
    "fails closed for every malformed persisted v2 session shape",
    async (override) => {
      const store = new FsCaptureStore({ projectRoot: root });
      await store.beginLaunch(begin());
      await writeFile(
        join(root, "captures", captureId, "session.json"),
        JSON.stringify({
          ...begin(),
          contract: "pharos.capture-session/2",
          status: "pending",
          ...override,
        }),
      );
      await expect(store.getSession(projectId, captureId)).resolves.toEqual({
        ok: false,
        error: { rule: "capture-store-corruption", captureId },
      });
    },
  );
  it.each([
    "mismatched completion capture",
    "terminal completion inconsistent with session",
  ] as const)(
    "fails closed for corrupt request journal completion: %s",
    async (caseName) => {
      const store = new FsCaptureStore({ projectRoot: root });
      await store.beginLaunch(begin());
      const path = join(
        root,
        "capture-journal",
        "requests",
        `${createHash("sha256").update(requestId).digest("hex")}.json`,
      );
      const journal: Record<string, unknown> = {
        ...begin(),
        completion:
          caseName === "mismatched completion capture"
            ? {
                status: "promoted",
                captureId: "cap_018f47de-7a00-7cc0-8000-000000000099",
              }
            : { status: "promoted", captureId },
      };
      await writeFile(path, JSON.stringify(journal));
      await expect(store.beginLaunch(begin())).resolves.toEqual({
        ok: false,
        error: { rule: "capture-store-corruption", captureId },
      });
    },
  );
  it.each([
    { contract: "pharos.capture-beacon-association/2" },
    { extra: true },
    { inputHash: " " },
    { beaconId: "bcn_invalid" },
    { draftId: "drf_invalid" },
    { revision: 2 },
    { createdAt: "2026-03-01T00:00:00Z" },
    { semanticHash: "sha256:semantic", committedAt: time },
  ] as const)(
    "refuses every malformed persisted association shape",
    async (override) => {
      const path = join(
        root,
        "capture-associations",
        "by-capture",
        `${captureId}.json`,
      );
      await mkdir(join(root, "capture-associations", "by-capture"), {
        recursive: true,
      });
      await writeFile(
        path,
        JSON.stringify({ ...pendingAssociation(), ...override }),
      );
      await expect(
        new FsCaptureStore({ projectRoot: root }).getAssociationByCapture(
          projectId,
          captureId,
        ),
      ).resolves.toEqual({
        ok: false,
        error: { rule: "capture-store-corruption", captureId },
      });
    },
  );
  it("converges concurrent terminalization of the same normalized decision", async () => {
    const first = new FsCaptureStore({ projectRoot: root });
    const second = new FsCaptureStore({ projectRoot: root });
    await recording(first);
    const decision = {
      resolution: "interrupt" as const,
      reason: "signal" as const,
    };
    const [left, right] = await Promise.all([
      first.resolve(projectId, captureId, decision, time),
      second.resolve(projectId, captureId, decision, time),
    ]);
    expect(left).toEqual(right);
    expect(left).toMatchObject({
      ok: true,
      value: { status: "interrupted", completedAt: time },
    });
  });

  it("begins and claims launch atomically, then replays every durable state without a claim", async () => {
    const store = new FsCaptureStore({ projectRoot: root });
    await expect(store.beginLaunch(begin())).resolves.toMatchObject({
      ok: true,
      value: { claimed: true, session: { status: "launching" } },
    });
    await expect(store.beginLaunch(begin())).resolves.toMatchObject({
      ok: true,
      value: { claimed: false, session: { status: "launching" } },
    });
    await store.resolve(
      projectId,
      captureId,
      { resolution: "interrupt", reason: "signal" },
      time,
    );
    await expect(store.beginLaunch(begin())).resolves.toMatchObject({
      ok: true,
      value: { claimed: false, session: { status: "interrupted" } },
    });
  });

  it.each([
    { status: "recording", recorder: recorderEvidence },
    { status: "post_exit", recorderExitedAt: time },
    { status: "resolving", resolution: "interrupt", reason: "signal" },
    { status: "interrupted", reason: "signal", completedAt: time },
  ] as const)("replays existing %s state without a second launch claim", async (state) => {
    const store = new FsCaptureStore({ projectRoot: root });
    await store.beginLaunch(begin());
    await writeFile(sessionPath(captureId), JSON.stringify({
      ...begin(),
      contract: "pharos.capture-session/2",
      ...state,
    }));
    await expect(store.beginLaunch(begin())).resolves.toMatchObject({
      ok: true,
      value: { claimed: false, session: { status: state.status } },
    });
  });

  it("recovers a pending write left by a beginLaunch crash before launching", async () => {
    let armed = true;
    const crashing = new FsCaptureStore({
      projectRoot: root,
      observer: {
        onStage(stage) {
          if (armed && stage === "pending-written")
            throw new Error("pending launch crash");
        },
      },
    });
    await expect(crashing.beginLaunch(begin())).rejects.toThrow(
      "pending launch crash",
    );
    armed = false;
    await expect(
      new FsCaptureStore({ projectRoot: root }).recoverProject(projectId, time),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        recovered: [expect.objectContaining({ status: "failed", captureId })],
        blocked: [],
      },
    });
  });

  it("recovers the full project state table deterministically without scanning stale post-exit bytes", async () => {
    const store = new FsCaptureStore({ projectRoot: root });
    const pendingCommand = commandFor("002");
    const postExitCommand = commandFor("003");
    const resolvingCommand = commandFor("004");
    const launchingCommand = commandFor("005");
    const recordingCommand = commandFor("006");
    for (const command of [
      pendingCommand,
      postExitCommand,
      resolvingCommand,
      launchingCommand,
      recordingCommand,
    ]) {
      await mkdir(join(root, "captures", command.captureId), { recursive: true });
      await mkdir(join(root, "capture-staging", command.captureId), { recursive: true });
      await mkdir(join(root, "capture-journal", "requests"), { recursive: true });
      await writeFile(requestPath(command.requestId), JSON.stringify(command));
    }
    await writeFile(sessionPath(pendingCommand.captureId), JSON.stringify({
      ...pendingCommand,
      contract: "pharos.capture-session/2",
      status: "pending",
    }));
    await writeFile(sessionPath(postExitCommand.captureId), JSON.stringify({
      ...postExitCommand,
      contract: "pharos.capture-session/2",
      status: "post_exit",
      recorderExitedAt: time,
    }));
    await writeFile(sessionPath(resolvingCommand.captureId), JSON.stringify({
      ...resolvingCommand,
      contract: "pharos.capture-session/2",
      status: "resolving",
      resolution: "interrupt",
      reason: "signal",
    }));
    await writeFile(sessionPath(launchingCommand.captureId), JSON.stringify({
      ...launchingCommand,
      contract: "pharos.capture-session/2",
      status: "launching",
    }));
    await writeFile(sessionPath(recordingCommand.captureId), JSON.stringify({
      ...recordingCommand,
      contract: "pharos.capture-session/2",
      status: "recording",
      recorder: recorderEvidence,
    }));
    const stale = join(root, "capture-staging", postExitCommand.captureId, "recording.spec.ts");
    await writeFile(stale, "never scan or promote this");

    await expect(store.recoverProject(projectId, time)).resolves.toMatchObject({
      ok: true,
      value: {
        recovered: [
          expect.objectContaining({ captureId: pendingCommand.captureId, status: "failed" }),
          expect.objectContaining({ captureId: postExitCommand.captureId, status: "rejected", reason: "scan-incomplete", detectionCount: 0 }),
          expect.objectContaining({ captureId: resolvingCommand.captureId, status: "interrupted" }),
        ],
        blocked: [
          expect.objectContaining({ captureId: launchingCommand.captureId, status: "launching" }),
          expect.objectContaining({ captureId: recordingCommand.captureId, status: "recording" }),
        ],
      },
    });
    await expect(lstat(stale)).rejects.toMatchObject({ code: "ENOENT" });
    for (const command of [pendingCommand, postExitCommand, resolvingCommand]) {
      expect(await readFile(requestPath(command.requestId), "utf8")).toContain(
        '"completion"',
      );
    }
  });

  it("reports a legacy running session as a blocked launching recovery", async () => {
    const command = commandFor("007");
    const store = new FsCaptureStore({ projectRoot: root });
    await store.beginLaunch(command);
    await writeFile(sessionPath(command.captureId), JSON.stringify({
      ...command,
      contract: "pharos.capture-session/1",
      status: "running",
      recorder: { pid: 99 },
    }));
    await expect(store.recoverProject(projectId, time)).resolves.toMatchObject({
      ok: true,
      value: {
        recovered: [],
        blocked: [expect.objectContaining({ captureId: command.captureId, status: "launching" })],
      },
    });
  });

  it("refuses a non-canonical recovery time before mutating the project", async () => {
    const store = new FsCaptureStore({ projectRoot: root });
    await store.beginLaunch(begin());
    await expect(
      store.recoverProject(projectId, "2026-03-01T00:02:00Z"),
    ).resolves.toMatchObject({ ok: false });
    await expect(store.getSession(projectId, captureId)).resolves.toMatchObject({
      ok: true,
      value: { status: "launching" },
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
function committedAssociation(
  pending: CaptureBeaconAssociation,
): CaptureBeaconAssociation {
  return {
    ...pending,
    state: "committed",
    semanticHash: "sha256:semantic",
    committedAt: time,
  };
}
