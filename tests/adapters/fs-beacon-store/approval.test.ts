import { access, mkdtemp, rm } from "node:fs/promises";
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
