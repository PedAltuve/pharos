import { access, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DraftOrigin } from "../../../src/domain/beacon/index.js";
import type { SemanticSource } from "../../../src/domain/semantics/index.js";
import { project } from "../../../src/domain/semantics/index.js";
import type { AtomicWriter } from "../../../src/adapters/fs-beacon-store/atomic-writer.js";
import { FsAtomicWriter } from "../../../src/adapters/fs-beacon-store/atomic-writer.js";
import { BeaconStoreCorruptionError } from "../../../src/adapters/fs-beacon-store/corruption.js";
import { FsBeaconStore } from "../../../src/adapters/fs-beacon-store/fs-beacon-store.js";
import { keyHash } from "../../../src/adapters/fs-beacon-store/journal.js";
import {
  applyPendingProjectDraftReplays,
  scanBeacon,
} from "../../../src/adapters/fs-beacon-store/reconcile.js";
import { JcsSha256Hasher } from "../../../src/adapters/hashing/jcs-sha256-hasher.js";

let projectDir: string;
const hasher = new JcsSha256Hasher();
const origin: DraftOrigin = {
  branchedFromVersion: null,
  branchedFromHash: null,
  forkedFromDraft: null,
};

function content(purpose: string): SemanticSource {
  return {
    purpose,
    actor: { type: "user" },
    entryPoint: { path: "/" },
    actions: [],
    readinessIntent: { sideEffectClass: "stateless" },
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function approveCmd(overrides: Partial<{
  draftId: string;
  versionId: string;
  reviewedHash: string;
  approvedAt: string;
  actor: string | null;
  staleOriginAcknowledged: boolean;
}> = {}) {
  return {
    draftId: "draft_1",
    versionId: "ver_1",
    reviewedHash: hasher.hash(project(content("reviewed"))),
    approvedAt: "2026-09-03T00:00:00.000Z",
    actor: "operator",
    staleOriginAcknowledged: false,
    ...overrides,
  };
}

async function seedOpenDraft(store: FsBeaconStore, draftId = "draft_1"): Promise<void> {
  await store.createDraft("bcn_1", {
    draftId,
    label: "Draft",
    beaconTitle: "Beacon",
    origin,
    content: content("reviewed"),
  }, `create-${draftId}`);
}

class InjectedCrash extends Error {}

class RecordingWriter implements AtomicWriter {
  readonly leakedTempPolicy = "sweep-on-recover" as const;
  readonly calls: string[] = [];
  private readonly inner = new FsAtomicWriter();

  constructor(private readonly onActiveWrite?: () => Promise<void>) {}

  async writeAtomic(path: string, bytes: string): Promise<void> {
    this.calls.push(path);
    await this.inner.writeAtomic(path, bytes);
    if (path.endsWith("active.json")) await this.onActiveWrite?.();
  }

  async createExclusive(path: string, bytes: string): Promise<"created" | "exists"> {
    this.calls.push(path);
    return this.inner.createExclusive(path, bytes);
  }

  async removeAtomic(path: string): Promise<void> {
    this.calls.push(path);
    await this.inner.removeAtomic(path);
  }
}

class CrashAfterPathWriter implements AtomicWriter {
  readonly leakedTempPolicy = "sweep-on-recover" as const;
  private readonly inner = new FsAtomicWriter();
  private seen = 0;

  constructor(
    private readonly suffix: string,
    private readonly occurrence = 1,
  ) {}

  async writeAtomic(path: string, bytes: string): Promise<void> {
    await this.inner.writeAtomic(path, bytes);
    this.crashIfMatched(path);
  }

  async createExclusive(path: string, bytes: string): Promise<"created" | "exists"> {
    const result = await this.inner.createExclusive(path, bytes);
    if (result === "created") this.crashIfMatched(path);
    return result;
  }

  async removeAtomic(path: string): Promise<void> {
    await this.inner.removeAtomic(path);
  }

  private crashIfMatched(path: string): void {
    if (path.endsWith(this.suffix) && ++this.seen === this.occurrence) {
      throw new InjectedCrash(path);
    }
  }
}

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "pharos-approval-"));
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe("FsBeaconStore.approveDraft — hash re-verification (fs-beacon-store R5 S1)", () => {
  it("refuses a stale reviewed hash before creating semantics.json or manifest.json", async () => {
    const store = new FsBeaconStore({ projectRoot: projectDir, hasher });
    const reviewedContent = content("reviewed");
    await store.createDraft("bcn_1", {
      draftId: "draft_1",
      label: "Draft",
      beaconTitle: "Beacon",
      origin,
      content: reviewedContent,
    }, "create-key");
    await store.updateDraft("bcn_1", {
      draftId: "draft_1",
      expectedRevision: 1,
      content: content("changed"),
    }, "update-key");

    const result = await store.approveDraft("bcn_1", {
      draftId: "draft_1",
      versionId: "ver_1",
      reviewedHash: hasher.hash(project(reviewedContent)),
      approvedAt: "2026-09-03T00:00:00.000Z",
      actor: "operator",
      staleOriginAcknowledged: false,
    }, "approve-key");

    expect(result).toMatchObject({ ok: false, error: { rule: "reviewed-hash-mismatch" } });
    const versionDir = join(projectDir, "beacons", "bcn_1", "versions", "ver_1");
    expect(await exists(join(versionDir, "semantics.json"))).toBe(false);
    expect(await exists(join(versionDir, "manifest.json"))).toBe(false);
  });
});

describe("FsBeaconStore.approveDraft — crash before active swap (fs-beacon-store R5 S2)", () => {
  it("leaves an aborted orphan that is neither active nor closed", async () => {
    const store = new FsBeaconStore({
      projectRoot: projectDir,
      hasher,
      writer: new CrashAfterPathWriter("manifest.json"),
    });
    await seedOpenDraft(store);

    await expect(store.approveDraft("bcn_1", approveCmd(), "approve-key"))
      .rejects.toBeInstanceOf(InjectedCrash);

    const versionDir = join(projectDir, "beacons", "bcn_1", "versions", "ver_1");
    expect(await exists(join(versionDir, "semantics.json"))).toBe(true);
    expect(await exists(join(versionDir, "manifest.json"))).toBe(true);
    expect(await exists(join(projectDir, "beacons", "bcn_1", "active.json"))).toBe(false);

    const scan = await scanBeacon(projectDir, "bcn_1");
    expect(scan.orphanVersionIds).toEqual(["ver_1"]);
    expect(scan.beacon.activeVersionId).toBeNull();
    expect(scan.beacon.drafts.draft_1).toMatchObject({ status: "open" });
  });

  it("does not resurrect an orphan when a later approval commits a different version", async () => {
    const crashingStore = new FsBeaconStore({
      projectRoot: projectDir,
      hasher,
      writer: new CrashAfterPathWriter("manifest.json"),
    });
    await seedOpenDraft(crashingStore, "draft_1");
    await seedOpenDraft(crashingStore, "draft_2");
    await expect(crashingStore.approveDraft("bcn_1", approveCmd(), "orphan-key"))
      .rejects.toBeInstanceOf(InjectedCrash);

    const store = new FsBeaconStore({ projectRoot: projectDir, hasher });
    const result = await store.approveDraft("bcn_1", approveCmd({
      draftId: "draft_2",
      versionId: "ver_2",
    }), "committed-key");

    expect(result).toMatchObject({ ok: true, value: { activeVersionId: "ver_2" } });
    const scan = await scanBeacon(projectDir, "bcn_1");
    expect(scan.orphanVersionIds).toEqual(["ver_1"]);
    expect(scan.beacon.versions).not.toHaveProperty("ver_1");
    expect(scan.beacon.versions.ver_2).toMatchObject({ status: "active" });
  });
});

describe("approval replay after active swap (beacon-store-recovery R3)", () => {
  it("closes the draft and writes one journal entry without creating a second version", async () => {
    const crashingStore = new FsBeaconStore({
      projectRoot: projectDir,
      hasher,
      writer: new CrashAfterPathWriter("active.json"),
    });
    await seedOpenDraft(crashingStore);
    await expect(crashingStore.approveDraft("bcn_1", approveCmd(), "approve-key"))
      .rejects.toBeInstanceOf(InjectedCrash);

    await applyPendingProjectDraftReplays(projectDir, new FsAtomicWriter());
    const firstReplay = await scanBeacon(projectDir, "bcn_1");
    expect(firstReplay.beacon.drafts.draft_1).toMatchObject({
      status: "closed",
      approvedVersionId: "ver_1",
    });
    const journalDir = join(projectDir, "journal", "idempotency");
    expect(await exists(join(journalDir, `${keyHash("approve-key")}.json`))).toBe(true);
    expect(await readdir(journalDir)).toHaveLength(2);
    expect(await readdir(join(projectDir, "beacons", "bcn_1", "versions"))).toEqual(["ver_1"]);

    await applyPendingProjectDraftReplays(projectDir, new FsAtomicWriter());
    const secondReplay = await scanBeacon(projectDir, "bcn_1");
    expect(secondReplay.beacon.drafts.draft_1).toMatchObject({ status: "closed" });
    expect(await readdir(journalDir)).toHaveLength(2);
  });

  it("writes only the missing journal entry when the draft was closed before the crash", async () => {
    const crashingStore = new FsBeaconStore({
      projectRoot: projectDir,
      hasher,
      writer: new CrashAfterPathWriter("draft.json", 2),
    });
    await seedOpenDraft(crashingStore);
    await expect(crashingStore.approveDraft("bcn_1", approveCmd(), "approve-key"))
      .rejects.toBeInstanceOf(InjectedCrash);

    await applyPendingProjectDraftReplays(projectDir, new FsAtomicWriter());
    const replayed = await scanBeacon(projectDir, "bcn_1");
    expect(replayed.beacon.drafts.draft_1).toMatchObject({
      status: "closed",
      approvedVersionId: "ver_1",
    });
    const journalDir = join(projectDir, "journal", "idempotency");
    expect(await exists(join(journalDir, `${keyHash("approve-key")}.json`))).toBe(true);
    expect(await readdir(journalDir)).toHaveLength(2);
    expect(await readdir(join(projectDir, "beacons", "bcn_1", "versions"))).toEqual(["ver_1"]);
  });
});

describe("FsBeaconStore.approveDraft — commit point (fs-beacon-store R5 S3)", () => {
  it("writes version artifacts before active.json, which is observable before closing and journaling", async () => {
    let activeDuringWrite: unknown;
    const writer = new RecordingWriter(async () => {
      activeDuringWrite = await store.getActiveVersion("bcn_1");
    });
    const store = new FsBeaconStore({ projectRoot: projectDir, hasher, writer });
    await seedOpenDraft(store);
    writer.calls.length = 0;
    const semantics = join(projectDir, "beacons", "bcn_1", "versions", "ver_1", "semantics.json");
    const manifest = join(projectDir, "beacons", "bcn_1", "versions", "ver_1", "manifest.json");
    const active = join(projectDir, "beacons", "bcn_1", "active.json");
    const draft = join(projectDir, "beacons", "bcn_1", "drafts", "draft_1", "draft.json");
    const journal = join(projectDir, "journal", "idempotency");

    const result = await store.approveDraft("bcn_1", approveCmd(), "approve-key");

    expect(result).toMatchObject({ ok: true, value: { activeVersionId: "ver_1" } });
    expect(activeDuringWrite).toMatchObject({ ok: true, value: { versionId: "ver_1", status: "active" } });
    expect(writer.calls).toEqual([semantics, manifest, active, draft, expect.stringContaining(journal)]);
  });
});

describe("FsBeaconStore.approveDraft — D6b adoption probe", () => {
  async function crashAfterManifest(
    draftId = "draft_1",
    versionId = "ver_1",
    key = "approve-key",
    staleOriginAcknowledged = false,
  ): Promise<void> {
    const store = new FsBeaconStore({
      projectRoot: projectDir,
      hasher,
      writer: new CrashAfterPathWriter("manifest.json"),
    });
    await seedOpenDraft(store, draftId);
    await expect(store.approveDraft("bcn_1", approveCmd({
      draftId, versionId, staleOriginAcknowledged,
    }), key))
      .rejects.toBeInstanceOf(InjectedCrash);
  }

  it("refuses a stale interrupted attempt after an unrelated approval, then permits a fresh version", async () => {
    await crashAfterManifest("draft_1", "ver_1", "approve-key", true);
    const store = new FsBeaconStore({ projectRoot: projectDir, hasher });
    await seedOpenDraft(store, "draft_2");
    await expect(store.approveDraft("bcn_1", approveCmd({
      draftId: "draft_2", versionId: "ver_2",
    }), "other-key")).resolves.toMatchObject({ ok: true });

    await expect(store.approveDraft("bcn_1", approveCmd({ staleOriginAcknowledged: true }), "approve-key"))
      .resolves.toMatchObject({
        ok: false,
        error: { rule: "stale-attempt-artifact", artifact: "manifest", ownerId: "ver_1" },
      });
    await expect(store.approveDraft("bcn_1", approveCmd({
      versionId: "ver_3", staleOriginAcknowledged: true,
    }), "fresh-key"))
      .resolves.toMatchObject({ ok: true, value: { activeVersionId: "ver_3" } });
  });

  it("treats approved_revision as aggregate-derived when a same-content update intervenes", async () => {
    const store = new FsBeaconStore({ projectRoot: projectDir, hasher });
    await seedOpenDraft(store);
    await store.updateDraft("bcn_1", { draftId: "draft_1", expectedRevision: 1, content: content("reviewed") }, "update-2");
    await store.updateDraft("bcn_1", { draftId: "draft_1", expectedRevision: 2, content: content("reviewed") }, "update-3");
    const crashingStore = new FsBeaconStore({
      projectRoot: projectDir, hasher, writer: new CrashAfterPathWriter("manifest.json"),
    });
    await expect(crashingStore.approveDraft("bcn_1", approveCmd(), "approve-key"))
      .rejects.toBeInstanceOf(InjectedCrash);
    await expect(readFile(join(
      projectDir, "beacons", "bcn_1", "versions", "ver_1", "manifest.json"), "utf8",
    )).resolves.toContain('"approved_revision": 3');
    await store.updateDraft("bcn_1", { draftId: "draft_1", expectedRevision: 3, content: content("reviewed") }, "update-4");

    await expect(store.approveDraft("bcn_1", approveCmd(), "approve-key"))
      .resolves.toMatchObject({ ok: false, error: { rule: "stale-attempt-artifact" } });
  });

  it("adopts identical interrupted artifacts and completes the original approval exactly once", async () => {
    await crashAfterManifest();
    const store = new FsBeaconStore({ projectRoot: projectDir, hasher });

    await expect(store.approveDraft("bcn_1", approveCmd(), "approve-key"))
      .resolves.toMatchObject({ ok: true, value: { activeVersionId: "ver_1" } });
    expect(await readdir(join(projectDir, "beacons", "bcn_1", "versions"))).toEqual(["ver_1"]);
    await expect(scanBeacon(projectDir, "bcn_1")).resolves.toMatchObject({
      beacon: { drafts: { draft_1: { status: "closed" } } },
    });
  });

  it("distinguishes same-key input conflicts from a corrupt input-determined manifest field", async () => {
    await crashAfterManifest();
    const store = new FsBeaconStore({ projectRoot: projectDir, hasher });
    await expect(store.approveDraft("bcn_1", approveCmd({ actor: "other" }), "approve-key"))
      .resolves.toMatchObject({ ok: false, error: { rule: "idempotency-key-conflict" } });

    const manifest = join(projectDir, "beacons", "bcn_1", "versions", "ver_1", "manifest.json");
    await writeFile(manifest, (await readFile(manifest, "utf8")).replace('"actor": "operator"', '"actor": "tampered"'));
    await expect(store.approveDraft("bcn_1", approveCmd(), "approve-key"))
      .rejects.toBeInstanceOf(BeaconStoreCorruptionError);
  });

  it("refuses a different key's genuine second manifest write without changing its bytes", async () => {
    await crashAfterManifest();
    const manifest = join(projectDir, "beacons", "bcn_1", "versions", "ver_1", "manifest.json");
    const semantics = join(projectDir, "beacons", "bcn_1", "versions", "ver_1", "semantics.json");
    const original = await readFile(manifest, "utf8");
    await rm(semantics);
    const store = new FsBeaconStore({ projectRoot: projectDir, hasher });

    await expect(store.approveDraft("bcn_1", approveCmd(), "other-key"))
      .resolves.toMatchObject({
        ok: false,
        error: { rule: "immutable-file-exists", artifact: "manifest", ownerId: "ver_1" },
      });
    await expect(readFile(manifest, "utf8")).resolves.toBe(original);
  });
});
