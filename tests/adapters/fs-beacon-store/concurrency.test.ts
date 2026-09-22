import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DraftOrigin } from "../../../src/domain/beacon/index.js";
import { project } from "../../../src/domain/semantics/index.js";
import type { AtomicWriter } from "../../../src/adapters/fs-beacon-store/atomic-writer.js";
import { FsAtomicWriter } from "../../../src/adapters/fs-beacon-store/atomic-writer.js";
import { FsBeaconStore } from "../../../src/adapters/fs-beacon-store/fs-beacon-store.js";
import { JcsSha256Hasher } from "../../../src/adapters/hashing/jcs-sha256-hasher.js";

let root: string;
const origin: DraftOrigin = { branchedFromVersion: null, branchedFromHash: null, forkedFromDraft: null };
const command = (draftId: string) => ({
  draftId, label: draftId, beaconTitle: "Beacon", origin,
  content: { purpose: draftId, actor: { type: "user" as const }, entryPoint: { path: "/" }, actions: [], readinessIntent: { sideEffectClass: "stateless" as const } },
});

async function seed(store: FsBeaconStore, draftId: string): Promise<void> {
  await expect(store.createDraft("bcn_1", command(draftId), `create-${draftId}`)).resolves.toMatchObject({ ok: true });
}

function approval(draftId: string, versionId: string, approvedAt: string) {
  return {
    draftId,
    expectedRevision: 1,
    versionId,
    reviewedHash: new JcsSha256Hasher().hash(project(command(draftId).content)),
    approvedAt,
    actor: "operator",
    staleOriginAcknowledged: true,
  };
}

async function waitFor(writer: GateWriter, fragment: string): Promise<void> {
  for (let attempt = 0; !writer.events.some((event) => event.includes(fragment)); attempt += 1) {
    if (attempt === 100) throw new Error(`mutation never reached ${fragment}`);
    await new Promise<void>((resolve) => { setTimeout(resolve, 1); });
  }
}

class GateWriter implements AtomicWriter {
  readonly leakedTempPolicy = "sweep-on-recover" as const;
  readonly events: string[] = [];
  private readonly inner = new FsAtomicWriter();
  private releaseGate!: () => void;
  readonly blocked = new Promise<void>((resolve) => { this.releaseGate = resolve; });

  constructor(private readonly gates = (path: string) => path.endsWith("draft_1/draft.json")) {}
  async writeAtomic(path: string, bytes: string): Promise<void> { await this.write("write", path, () => this.inner.writeAtomic(path, bytes)); }
  async createExclusive(path: string, bytes: string): Promise<"created" | "exists"> { return this.write("create", path, () => this.inner.createExclusive(path, bytes)); }
  async removeAtomic(path: string): Promise<void> { await this.write("remove", path, () => this.inner.removeAtomic(path)); }
  release(): void { this.releaseGate(); }
  private async write<T>(kind: string, path: string, action: () => Promise<T>): Promise<T> {
    this.events.push(`start:${kind}:${path}`);
    if (this.gates(path)) await this.blocked;
    const value = await action();
    this.events.push(`end:${kind}:${path}`);
    return value;
  }
}

beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "pharos-concurrency-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("FsBeaconStore mutation serialization", () => {
  it("shows the assertion fails for a naive unlocked mutation stub", async () => {
    const events: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const naive = async (id: string): Promise<void> => { events.push(`start:${id}`); if (id === "one") await gate; events.push(`end:${id}`); };
    const first = naive("one");
    await Promise.resolve();
    const second = naive("two");
    await Promise.resolve();
    release();
    await Promise.all([first, second]);
    expect(events.indexOf("start:two") > events.indexOf("end:one")).toBe(false);
  });

  it("completes one full write sequence before the concurrent mutation begins", async () => {
    const writer = new GateWriter();
    const store = new FsBeaconStore({ projectRoot: root, hasher: new JcsSha256Hasher(), writer });
    const first = store.createDraft("bcn_1", command("draft_1"), "first");
    for (let attempt = 0; !writer.events.some((event) => event.includes("draft_1/draft.json")); attempt += 1) {
      if (attempt === 100) throw new Error("first mutation never reached its gated draft write");
      await new Promise<void>((resolve) => { setTimeout(resolve, 1); });
    }
    const second = store.createDraft("bcn_1", command("draft_2"), "second");
    await new Promise<void>((resolve) => { setTimeout(resolve, 5); });
    expect(writer.events.some((event) => event.includes("draft_2/draft.json"))).toBe(false);
    writer.release();
    await expect(Promise.all([first, second])).resolves.toEqual([expect.objectContaining({ ok: true }), expect.objectContaining({ ok: true })]);
    const firstJournal = writer.events.findIndex((event) => event.startsWith("end:create:") && event.includes("journal/idempotency"));
    const secondStart = writer.events.findIndex((event) => event.includes("draft_2/draft.json"));
    expect(firstJournal).toBeGreaterThanOrEqual(0);
    expect(secondStart).toBeGreaterThan(firstJournal);
  });

  it("replays the first canonical approval for same-key concurrent output regeneration", async () => {
    const writer = new GateWriter((path) => path.endsWith("active.json"));
    const store = new FsBeaconStore({ projectRoot: root, hasher: new JcsSha256Hasher(), writer });
    await seed(store, "draft_1");
    const first = store.approveDraft("bcn_1", approval("draft_1", "ver_first", "first"), "approve-key");
    await waitFor(writer, "active.json");
    const replay = store.approveDraft("bcn_1", approval("draft_1", "ver_retry", "retry"), "approve-key");
    await new Promise<void>((resolve) => { setTimeout(resolve, 5); });
    expect(writer.events.filter((event) => event.includes("active.json"))).toHaveLength(1);
    writer.release();
    const [firstResult, replayResult] = await Promise.all([first, replay]);
    expect(firstResult).toMatchObject({ ok: true, value: { activeVersionId: "ver_first" } });
    expect(replayResult).toEqual(firstResult);
  });

  it("replays the first canonical active revocation for same-key concurrent timestamp regeneration", async () => {
    const setup = new FsBeaconStore({ projectRoot: root, hasher: new JcsSha256Hasher() });
    await seed(setup, "draft_1");
    await expect(setup.approveDraft("bcn_1", approval("draft_1", "ver_1", "approval"), "approve")).resolves.toMatchObject({ ok: true });
    const writer = new GateWriter((path) => path.endsWith("revocation.json"));
    const store = new FsBeaconStore({ projectRoot: root, hasher: new JcsSha256Hasher(), writer });
    const first = store.revokeActiveVersion("bcn_1", { expectedActiveVersionId: "ver_1", reason: "withdrawn", actor: "operator", revokedAt: "first" }, "revoke-key");
    await waitFor(writer, "revocation.json");
    const replay = store.revokeActiveVersion("bcn_1", { expectedActiveVersionId: "ver_1", reason: "withdrawn", actor: "operator", revokedAt: "retry" }, "revoke-key");
    writer.release();
    const [firstResult, replayResult] = await Promise.all([first, replay]);
    expect(firstResult).toMatchObject({ ok: true, value: { activeVersionId: null, versions: { ver_1: { status: "revoked" } } } });
    expect(replayResult).toEqual(firstResult);
  });

  it("refuses a revoke whose replacement approval commits before it acquires the lock", async () => {
    const setup = new FsBeaconStore({ projectRoot: root, hasher: new JcsSha256Hasher() });
    await seed(setup, "draft_1");
    await expect(setup.approveDraft("bcn_1", approval("draft_1", "ver_1", "first"), "approve-1")).resolves.toMatchObject({ ok: true });
    await seed(setup, "draft_2");
    const writer = new GateWriter((path) => path.endsWith("active.json"));
    const store = new FsBeaconStore({ projectRoot: root, hasher: new JcsSha256Hasher(), writer });
    const replacement = store.approveDraft("bcn_1", approval("draft_2", "ver_2", "replacement"), "approve-2");
    await waitFor(writer, "active.json");
    const revoke = store.revokeActiveVersion("bcn_1", { expectedActiveVersionId: "ver_1", reason: "withdrawn", actor: "operator", revokedAt: "revoke" }, "revoke");
    writer.release();
    await expect(replacement).resolves.toMatchObject({ ok: true, value: { activeVersionId: "ver_2" } });
    await expect(revoke).resolves.toMatchObject({ ok: false, error: { rule: "active-version-mismatch", currentActiveVersionId: "ver_2" } });
  });

  it("permits replacement approval after a revoke commits before it acquires the lock", async () => {
    const setup = new FsBeaconStore({ projectRoot: root, hasher: new JcsSha256Hasher() });
    await seed(setup, "draft_1");
    await expect(setup.approveDraft("bcn_1", approval("draft_1", "ver_1", "first"), "approve-1")).resolves.toMatchObject({ ok: true });
    await seed(setup, "draft_2");
    const writer = new GateWriter((path) => path.endsWith("revocation.json"));
    const store = new FsBeaconStore({ projectRoot: root, hasher: new JcsSha256Hasher(), writer });
    const revoke = store.revokeActiveVersion("bcn_1", { expectedActiveVersionId: "ver_1", reason: "withdrawn", actor: "operator", revokedAt: "revoke" }, "revoke");
    await waitFor(writer, "revocation.json");
    const replacement = store.approveDraft("bcn_1", approval("draft_2", "ver_2", "replacement"), "approve-2");
    writer.release();
    await expect(revoke).resolves.toMatchObject({ ok: true, value: { activeVersionId: null } });
    await expect(replacement).resolves.toMatchObject({ ok: true, value: { activeVersionId: "ver_2" } });
  });
});
