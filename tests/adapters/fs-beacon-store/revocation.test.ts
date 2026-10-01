import { access, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DraftOrigin } from "../../../src/domain/beacon/index.js";
import type { SemanticSource } from "../../../src/domain/semantics/index.js";
import { project } from "../../../src/domain/semantics/index.js";
import type { AtomicWriter } from "../../../src/adapters/fs-beacon-store/atomic-writer.js";
import { FsAtomicWriter } from "../../../src/adapters/fs-beacon-store/atomic-writer.js";
import { FsBeaconStore } from "../../../src/adapters/fs-beacon-store/fs-beacon-store.js";
import { keyHash } from "../../../src/adapters/fs-beacon-store/journal.js";
import { JcsSha256Hasher } from "../../../src/adapters/hashing/jcs-sha256-hasher.js";
import { staleComparisonDigest } from "../../../src/adapters/host-consent-verifier/index.js";

let projectDir: string;
const hasher = new JcsSha256Hasher();
const origin: DraftOrigin = { branchedFromVersion: null, branchedFromHash: null, forkedFromDraft: null };

function content(purpose: string): SemanticSource {
  return { purpose, actor: { type: "user" }, entryPoint: { path: "/" }, actions: [], readinessIntent: { sideEffectClass: "stateless" } };
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

async function approve(store: FsBeaconStore, draftId: string, versionId: string): Promise<void> {
  const source = content(draftId);
  await expect(store.createDraft("bcn_1", {
    draftId, label: draftId, beaconTitle: "Beacon", origin, content: source,
  }, `create-${draftId}`)).resolves.toMatchObject({ ok: true });
  const snapshot = await store.getActiveSemanticSnapshot("bcn_1");
  if (!snapshot.ok) throw new Error("active snapshot lookup failed");
  const reviewedHash = hasher.hash(project(source));
  await expect(store.approveDraft("bcn_1", {
    draftId, expectedRevision: 1, versionId, reviewedHash, approvedAt: "2026-09-03T00:00:00.000Z", actor: "operator", staleOriginAcknowledged: versionId !== "ver_1",
    reviewedActiveVersionId: snapshot.value?.versionId ?? null,
    reviewedActiveSemanticHash: snapshot.value?.semanticHash ?? null,
    comparisonDigest: staleComparisonDigest(reviewedHash, snapshot.value?.versionId ?? null, snapshot.value?.semanticHash ?? null),
  }, `approve-${draftId}`)).resolves.toMatchObject({ ok: true, value: { activeVersionId: versionId } });
}

class RecordingWriter implements AtomicWriter {
  readonly leakedTempPolicy = "sweep-on-recover" as const;
  readonly calls: string[] = [];
  private readonly inner = new FsAtomicWriter();
  async writeAtomic(path: string, bytes: string): Promise<void> { this.calls.push(`write:${path}`); await this.inner.writeAtomic(path, bytes); }
  async createExclusive(path: string, bytes: string): Promise<"created" | "exists"> { this.calls.push(`create:${path}`); return this.inner.createExclusive(path, bytes); }
  async removeAtomic(path: string): Promise<void> { this.calls.push(`remove:${path}`); await this.inner.removeAtomic(path); }
}

class InjectedCrash extends Error {}
class CrashAfterPathWriter implements AtomicWriter {
  readonly leakedTempPolicy = "sweep-on-recover" as const;
  private readonly inner = new FsAtomicWriter();
  constructor(private readonly suffix: string) {}
  async writeAtomic(path: string, bytes: string): Promise<void> { await this.inner.writeAtomic(path, bytes); this.crash(path); }
  async createExclusive(path: string, bytes: string): Promise<"created" | "exists"> { const result = await this.inner.createExclusive(path, bytes); if (result === "created") this.crash(path); return result; }
  async removeAtomic(path: string): Promise<void> { await this.inner.removeAtomic(path); this.crash(path); }
  private crash(path: string): void { if (path.endsWith(this.suffix)) throw new InjectedCrash(path); }
}

function revokeCmd() {
  return { versionId: "ver_1", reason: "withdrawn", actor: "operator", revokedAt: "2026-09-04T00:00:00.000Z" };
}

beforeEach(async () => { projectDir = await mkdtemp(join(tmpdir(), "pharos-revoke-")); });
afterEach(async () => { await rm(projectDir, { recursive: true, force: true }); });

describe("FsBeaconStore.revokeVersion", () => {
  it("commits active-version revocation before clearing the active pointer and journaling", async () => {
    const writer = new RecordingWriter();
    const store = new FsBeaconStore({ projectRoot: projectDir, hasher, writer });
    await approve(store, "draft_1", "ver_1");
    writer.calls.length = 0;

    await expect(store.revokeVersion("bcn_1", {
      versionId: "ver_1", reason: "withdrawn", actor: "operator", revokedAt: "2026-09-04T00:00:00.000Z",
    }, "revoke-key")).resolves.toMatchObject({
      ok: true, value: { activeVersionId: null, versions: { ver_1: { status: "revoked", previousStatus: "active" } } },
    });

    const base = join(projectDir, "beacons", "bcn_1");
    expect(writer.calls).toEqual([
      `create:${join(base, "versions", "ver_1", "revocation.json")}`,
      `remove:${join(base, "active.json")}`,
      expect.stringContaining("journal/idempotency"),
    ]);
    expect(await exists(join(base, "active.json"))).toBe(false);
  });

  it("revokes a superseded version without changing the active pointer", async () => {
    const store = new FsBeaconStore({ projectRoot: projectDir, hasher });
    await approve(store, "draft_1", "ver_1");
    await approve(store, "draft_2", "ver_2");

    await expect(store.revokeVersion("bcn_1", {
      versionId: "ver_1", reason: "withdrawn", actor: null, revokedAt: "2026-09-04T00:00:00.000Z",
    }, "revoke-key")).resolves.toMatchObject({
      ok: true, value: { activeVersionId: "ver_2", versions: { ver_1: { status: "revoked", previousStatus: "superseded" } } },
    });
    expect(await exists(join(projectDir, "beacons", "bcn_1", "active.json"))).toBe(true);
    expect(await readdir(join(projectDir, "beacons", "bcn_1", "versions", "ver_1"))).toContain("revocation.json");
  });
});

describe("FsBeaconStore.revokeActiveVersion", () => {
  it("replays a stable active-only request despite a regenerated timestamp", async () => {
    const store = new FsBeaconStore({ projectRoot: projectDir, hasher });
    await approve(store, "draft_1", "ver_1");
    const first = await store.revokeActiveVersion("bcn_1", {
      expectedActiveVersionId: "ver_1", reason: " withdrawn ", actor: "operator", revokedAt: "first",
    }, "active-revoke-key");
    const replay = await store.revokeActiveVersion("bcn_1", {
      expectedActiveVersionId: null, reason: "withdrawn", actor: "operator", revokedAt: "retry",
    }, "active-revoke-key");

    expect(replay).toEqual(first);
    expect(first).toMatchObject({
      ok: true,
      value: {
        activeVersionId: null,
        versions: {
          ver_1: {
            versionId: "ver_1",
            status: "revoked",
            revocation: {
              revokedAt: "first",
              reason: "withdrawn",
            },
          },
        },
      },
    });
    const canonical = await store.getBeacon("bcn_1");
    expect(canonical).toMatchObject({
      ok: true,
      value: {
        activeVersionId: null,
        versions: {
          ver_1: {
            versionId: "ver_1",
            status: "revoked",
            revocation: {
              revokedAt: "first",
              reason: "withdrawn",
            },
          },
        },
      },
    });
  });

  it("returns a locked no-active refusal only when both snapshots are null", async () => {
    const store = new FsBeaconStore({ projectRoot: projectDir, hasher });
    await expect(store.createDraft("bcn_1", {
      draftId: "draft_1", label: "Draft", beaconTitle: "Beacon", origin, content: content("draft_1"),
    }, "create-draft")).resolves.toMatchObject({ ok: true });

    await expect(store.revokeActiveVersion("bcn_1", {
      expectedActiveVersionId: null, reason: "withdrawn", actor: "operator", revokedAt: "now",
    }, "fresh-no-active-key")).resolves.toEqual({
      ok: false,
      error: { rule: "active-version-not-found", beaconId: "bcn_1" },
    });
  });

  it("refuses an expected null snapshot while a version is active", async () => {
    const store = new FsBeaconStore({ projectRoot: projectDir, hasher });
    await approve(store, "draft_1", "ver_1");

    await expect(store.revokeActiveVersion("bcn_1", {
      expectedActiveVersionId: null, reason: "withdrawn", actor: "operator", revokedAt: "now",
    }, "fresh-null-current-key")).resolves.toEqual({
      ok: false,
      error: {
        rule: "active-version-mismatch",
        expectedActiveVersionId: null,
        currentActiveVersionId: "ver_1",
      },
    });
  });

  it("refuses when a replacement became active before the active-only revoke entered the lock", async () => {
    const store = new FsBeaconStore({ projectRoot: projectDir, hasher });
    await approve(store, "draft_1", "ver_1");
    await approve(store, "draft_2", "ver_2");

    await expect(store.revokeActiveVersion("bcn_1", {
      expectedActiveVersionId: "ver_1", reason: "withdrawn", actor: "operator", revokedAt: "now",
    }, "active-revoke-key")).resolves.toEqual({
      ok: false,
      error: { rule: "active-version-mismatch", expectedActiveVersionId: "ver_1", currentActiveVersionId: "ver_2" },
    });
  });
});

describe("FsBeaconStore.revokeVersion — D1c crash windows", () => {
  it("leaves no artifact before the revocation commit point", async () => {
    const store = new FsBeaconStore({ projectRoot: projectDir, hasher });
    await approve(store, "draft_1", "ver_1");
    const base = join(projectDir, "beacons", "bcn_1");

    expect(await exists(join(base, "versions", "ver_1", "revocation.json"))).toBe(false);
    await expect(store.getActiveVersion("bcn_1")).resolves.toMatchObject({ ok: true, value: { versionId: "ver_1" } });
  });

  it("replays active-pointer removal and journaling after revocation commits", async () => {
    const setup = new FsBeaconStore({ projectRoot: projectDir, hasher });
    await approve(setup, "draft_1", "ver_1");
    const crashed = new FsBeaconStore({ projectRoot: projectDir, hasher, writer: new CrashAfterPathWriter("revocation.json") });
    await expect(crashed.revokeVersion("bcn_1", revokeCmd(), "revoke-key")).rejects.toBeInstanceOf(InjectedCrash);

    await expect(crashed.getActiveVersion("bcn_1")).resolves.toMatchObject({ ok: true, value: null });
    const writer = new RecordingWriter();
    await expect(new FsBeaconStore({ projectRoot: projectDir, hasher, writer }).revokeVersion("bcn_1", revokeCmd(), "revoke-key"))
      .resolves.toMatchObject({ ok: true, value: { activeVersionId: null } });
    expect(writer.calls).toEqual([
      `remove:${join(projectDir, "beacons", "bcn_1", "active.json")}`,
      expect.stringContaining("journal/idempotency"),
    ]);
  });

  it("replays only journaling after the active pointer is removed", async () => {
    const setup = new FsBeaconStore({ projectRoot: projectDir, hasher });
    await approve(setup, "draft_1", "ver_1");
    const crashed = new FsBeaconStore({ projectRoot: projectDir, hasher, writer: new CrashAfterPathWriter("active.json") });
    await expect(crashed.revokeVersion("bcn_1", revokeCmd(), "revoke-key")).rejects.toBeInstanceOf(InjectedCrash);

    const writer = new RecordingWriter();
    await expect(new FsBeaconStore({ projectRoot: projectDir, hasher, writer }).revokeVersion("bcn_1", revokeCmd(), "revoke-key"))
      .resolves.toMatchObject({ ok: true, value: { activeVersionId: null } });
    expect(writer.calls).toEqual([expect.stringContaining("journal/idempotency")]);
  });

  it("does no replay write after revocation and its journal both complete", async () => {
    const setup = new FsBeaconStore({ projectRoot: projectDir, hasher });
    await approve(setup, "draft_1", "ver_1");
    const crashed = new FsBeaconStore({
      projectRoot: projectDir, hasher, writer: new CrashAfterPathWriter(`${keyHash("revoke-key")}.json`),
    });
    await expect(crashed.revokeVersion("bcn_1", revokeCmd(), "revoke-key")).rejects.toBeInstanceOf(InjectedCrash);

    const writer = new RecordingWriter();
    await expect(new FsBeaconStore({ projectRoot: projectDir, hasher, writer }).revokeVersion("bcn_1", revokeCmd(), "revoke-key"))
      .resolves.toMatchObject({ ok: true, value: { activeVersionId: null } });
    expect(writer.calls).toEqual([]);
  });
});
