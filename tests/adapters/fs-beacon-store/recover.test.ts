import { lstat, mkdir, mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DraftOrigin } from "../../../src/domain/beacon/index.js";
import type { SemanticSource } from "../../../src/domain/semantics/index.js";
import { project } from "../../../src/domain/semantics/index.js";
import type { AtomicWriter } from "../../../src/adapters/fs-beacon-store/atomic-writer.js";
import { FsAtomicWriter } from "../../../src/adapters/fs-beacon-store/atomic-writer.js";
import { FsBeaconStore } from "../../../src/adapters/fs-beacon-store/fs-beacon-store.js";
import { JcsSha256Hasher } from "../../../src/adapters/hashing/jcs-sha256-hasher.js";

let projectDir: string;
const hasher = new JcsSha256Hasher();
const origin: DraftOrigin = { branchedFromVersion: null, branchedFromHash: null, forkedFromDraft: null };

function content(purpose: string): SemanticSource {
  return { purpose, actor: { type: "user" }, entryPoint: { path: "/" }, actions: [], readinessIntent: { sideEffectClass: "stateless" } };
}

async function snapshot(root: string): Promise<readonly string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const result: string[] = [];
  for (const entry of entries.sort((left, right) => left.name < right.name ? -1 : 1)) {
    const path = join(root, entry.name);
    const stat = await lstat(path);
    result.push(`${path}:${stat.ino}:${stat.size}:${stat.mtimeMs}`);
    if (entry.isDirectory()) result.push(...await snapshot(path));
  }
  return result;
}

class InjectedCrash extends Error {}
class CrashBeforeWriter implements AtomicWriter {
  readonly leakedTempPolicy = "sweep-on-recover" as const;
  private readonly inner = new FsAtomicWriter();
  constructor(private readonly fragment: string) {}
  async writeAtomic(path: string, bytes: string): Promise<void> { await this.inner.writeAtomic(path, bytes); }
  async createExclusive(path: string, bytes: string): Promise<"created" | "exists"> {
    if (path.includes(this.fragment)) throw new InjectedCrash(path);
    return this.inner.createExclusive(path, bytes);
  }
  async removeAtomic(path: string): Promise<void> { await this.inner.removeAtomic(path); }
}

class CrashAfterWriter implements AtomicWriter {
  readonly leakedTempPolicy = "sweep-on-recover" as const;
  private readonly inner = new FsAtomicWriter();
  constructor(private readonly suffix: string) {}
  async writeAtomic(path: string, bytes: string): Promise<void> { await this.inner.writeAtomic(path, bytes); this.crash(path); }
  async createExclusive(path: string, bytes: string): Promise<"created" | "exists"> { const result = await this.inner.createExclusive(path, bytes); if (result === "created") this.crash(path); return result; }
  async removeAtomic(path: string): Promise<void> { await this.inner.removeAtomic(path); this.crash(path); }
  private crash(path: string): void { if (path.includes(this.suffix)) throw new InjectedCrash(path); }
}

async function createOpenDraft(root: string, beaconId: string, draftId: string): Promise<void> {
  const store = new FsBeaconStore({ projectRoot: root, hasher });
  await expect(store.createDraft(beaconId, {
    draftId, label: draftId, beaconTitle: beaconId, origin, content: content(draftId),
  }, `create-${beaconId}`)).resolves.toMatchObject({ ok: true });
}

async function approve(root: string, beaconId: string, draftId: string, versionId: string): Promise<void> {
  const source = content(draftId);
  const store = new FsBeaconStore({ projectRoot: root, hasher });
  await expect(store.createDraft(beaconId, {
    draftId, label: draftId, beaconTitle: beaconId, origin, content: source,
  }, `create-${beaconId}`)).resolves.toMatchObject({ ok: true });
  await expect(store.approveDraft(beaconId, {
    draftId, versionId, reviewedHash: hasher.hash(project(source)), approvedAt: "2026-09-03T00:00:00.000Z", actor: "operator", staleOriginAcknowledged: false,
  }, `approve-${beaconId}`)).resolves.toMatchObject({ ok: true });
}

beforeEach(async () => { projectDir = await mkdtemp(join(tmpdir(), "pharos-recover-")); });
afterEach(async () => { await rm(projectDir, { recursive: true, force: true }); });

describe("FsBeaconStore.recoverProject", () => {
  it("is a repeatable clean-project no-op that never creates a lock or probe", async () => {
    const store = new FsBeaconStore({ projectRoot: projectDir, hasher });
    const before = await snapshot(projectDir);

    await expect(store.recoverProject()).resolves.toEqual({ ok: true, value: { artifacts: [], actions: [] } });
    await expect(store.recoverProject()).resolves.toEqual({ ok: true, value: { artifacts: [], actions: [] } });

    expect(await snapshot(projectDir)).toEqual(before);
  });

  it("converges each committed U6-U9 replay window in one recovery call", async () => {
    const recover = async (root: string, action: string): Promise<void> => {
      const store = new FsBeaconStore({ projectRoot: root, hasher });
      const first = await store.recoverProject();
      expect(first).toMatchObject({ ok: true, value: { actions: expect.arrayContaining([expect.objectContaining({ action })]) } });
      const second = await store.recoverProject();
      expect(second).toMatchObject({ ok: true, value: { actions: [] } });
      expect(second.ok && first.ok && second.value.artifacts).toEqual(first.ok ? first.value.artifacts : []);
    };

    const createRoot = join(projectDir, "create");
    await mkdir(createRoot);
    const createCrash = new FsBeaconStore({ projectRoot: createRoot, hasher, writer: new CrashBeforeWriter("journal/idempotency") });
    await expect(createCrash.createDraft("bcn_1", { draftId: "draft_1", label: "draft", beaconTitle: "Create", origin, content: content("create") }, "create-crash")).rejects.toBeInstanceOf(InjectedCrash);
    await recover(createRoot, "wrote-journal-entry");

    const abandonRoot = join(projectDir, "abandon");
    await mkdir(abandonRoot);
    await createOpenDraft(abandonRoot, "bcn_1", "draft_1");
    await expect(new FsBeaconStore({ projectRoot: abandonRoot, hasher, writer: new CrashAfterWriter("tombstone.json") }).abandonDraft("bcn_1", { draftId: "draft_1", reason: "unused", abandonedAt: "2026-09-03T00:00:00.000Z" }, "abandon-crash")).rejects.toBeInstanceOf(InjectedCrash);
    await recover(abandonRoot, "removed-abandoned-draft-file");

    const approvalRoot = join(projectDir, "approval");
    await mkdir(approvalRoot);
    await createOpenDraft(approvalRoot, "bcn_1", "draft_1");
    const approvalSource = content("draft_1");
    await expect(new FsBeaconStore({ projectRoot: approvalRoot, hasher, writer: new CrashAfterWriter("active.json") }).approveDraft("bcn_1", { draftId: "draft_1", versionId: "ver_1", reviewedHash: hasher.hash(project(approvalSource)), approvedAt: "2026-09-03T00:00:00.000Z", actor: "operator", staleOriginAcknowledged: false }, "approval-crash")).rejects.toBeInstanceOf(InjectedCrash);
    await recover(approvalRoot, "closed-draft");

    const revokeRoot = join(projectDir, "revoke");
    await mkdir(revokeRoot);
    await approve(revokeRoot, "bcn_1", "draft_1", "ver_1");
    await expect(new FsBeaconStore({ projectRoot: revokeRoot, hasher, writer: new CrashAfterWriter("revocation.json") }).revokeVersion("bcn_1", { versionId: "ver_1", reason: "withdrawn", actor: "operator", revokedAt: "2026-09-04T00:00:00.000Z" }, "revoke-crash")).rejects.toBeInstanceOf(InjectedCrash);
    await recover(revokeRoot, "removed-revoked-active-pointer");
  });

  it("keeps a young leaked temp while proposing its sweep again on a later call", async () => {
    const temp = join(projectDir, "fresh.tmp.uuid");
    await writeFile(temp, "in-flight", "utf8");
    const store = new FsBeaconStore({ projectRoot: projectDir, hasher });

    const first = await store.recoverProject();
    const second = await store.recoverProject();

    expect(first).toMatchObject({ ok: true, value: { actions: expect.arrayContaining([
      expect.objectContaining({ action: "swept-leaked-temp" }),
    ]) } });
    expect(second).toMatchObject({ ok: true, value: { actions: expect.arrayContaining([
      expect.objectContaining({ action: "swept-leaked-temp" }),
    ]) } });
    expect((await snapshot(projectDir)).some((entry) => entry.includes("fresh.tmp.uuid"))).toBe(true);
  });

  it("reports unclassified state without throwing and sweeps only an aged leaked temp", async () => {
    await mkdir(join(projectDir, "beacons", "bcn_unclassified", "drafts", "draft_1"), { recursive: true });
    const temp = join(projectDir, "stranded.tmp.uuid");
    await writeFile(temp, "orphan", "utf8");
    const old = new Date(Date.now() - 3_000);
    await utimes(temp, old, old);

    const report = await new FsBeaconStore({ projectRoot: projectDir, hasher }).recoverProject();
    expect(report).toMatchObject({ ok: true, value: { artifacts: expect.arrayContaining([
      expect.objectContaining({ classification: "unclassified", ref: { scope: "beacon", beaconId: "bcn_unclassified" } }),
    ]), actions: expect.arrayContaining([expect.objectContaining({ action: "swept-leaked-temp" })]) } });
    expect(report.ok && (await snapshot(projectDir)).some((entry) => entry.includes("stranded.tmp.uuid"))).toBe(false);
  });
});
