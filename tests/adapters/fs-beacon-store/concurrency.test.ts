import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DraftOrigin } from "../../../src/domain/beacon/index.js";
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

class GateWriter implements AtomicWriter {
  readonly leakedTempPolicy = "sweep-on-recover" as const;
  readonly events: string[] = [];
  private readonly inner = new FsAtomicWriter();
  private releaseGate!: () => void;
  readonly blocked = new Promise<void>((resolve) => { this.releaseGate = resolve; });
  async writeAtomic(path: string, bytes: string): Promise<void> { await this.write("write", path, () => this.inner.writeAtomic(path, bytes)); }
  async createExclusive(path: string, bytes: string): Promise<"created" | "exists"> { return this.write("create", path, () => this.inner.createExclusive(path, bytes)); }
  async removeAtomic(path: string): Promise<void> { await this.write("remove", path, () => this.inner.removeAtomic(path)); }
  release(): void { this.releaseGate(); }
  private async write<T>(kind: string, path: string, action: () => Promise<T>): Promise<T> {
    this.events.push(`start:${kind}:${path}`);
    if (path.endsWith("draft_1/draft.json")) await this.blocked;
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
});
