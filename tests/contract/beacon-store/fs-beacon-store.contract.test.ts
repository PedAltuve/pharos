import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DraftOrigin } from "../../../src/domain/beacon/index.js";
import type { BeaconStore, StoreCreateDraftCommand } from "../../../src/domain/ports/beacon-store.js";
import type { SemanticSource } from "../../../src/domain/semantics/index.js";
import { project } from "../../../src/domain/semantics/index.js";
import { FsBeaconStore } from "../../../src/adapters/fs-beacon-store/fs-beacon-store.js";
import { JcsSha256Hasher } from "../../../src/adapters/hashing/jcs-sha256-hasher.js";

export type BeaconStoreFactory = () => Promise<BeaconStore>;

const origin: DraftOrigin = { branchedFromVersion: null, branchedFromHash: null, forkedFromDraft: null };
const content = (purpose: string): SemanticSource => ({
  purpose, actor: { type: "user" }, entryPoint: { path: "/" }, actions: [], readinessIntent: { sideEffectClass: "stateless" },
});
const create = (draftId: string, source: SemanticSource = content(draftId)): StoreCreateDraftCommand => ({
  draftId, label: draftId, beaconTitle: "Beacon", origin, content: source,
});

export async function exerciseBeaconStore(factory: BeaconStoreFactory): Promise<void> {
  const store = await factory();
  await expect(store.getBeacon("missing")).resolves.toMatchObject({ ok: false, error: { rule: "beacon-not-found" } });
  await expect(store.listBeacons()).resolves.toEqual({ ok: true, value: [] });
  await expect(store.getActiveVersion("missing")).resolves.toMatchObject({ ok: false, error: { rule: "beacon-not-found" } });

  const replay = async (call: () => Promise<unknown>, conflict: () => Promise<unknown>): Promise<void> => {
    const first = await call();
    expect(first).toMatchObject({ ok: true });
    await expect(call()).resolves.toEqual(first);
    await expect(conflict()).resolves.toMatchObject({ ok: false, error: { rule: "idempotency-key-conflict" } });
  };
  await replay(
    () => store.createDraft("bcn_1", create("draft_1"), "create"),
    () => store.createDraft("bcn_1", create("other", content("changed")), "create"),
  );
  await replay(
    () => store.updateDraft("bcn_1", { draftId: "draft_1", expectedRevision: 1, content: content("updated") }, "update"),
    () => store.updateDraft("bcn_1", { draftId: "draft_1", expectedRevision: 1, content: content("changed") }, "update"),
  );
  await expect(store.updateDraft("bcn_1", { draftId: "draft_1", expectedRevision: 1, content: content("stale") }, "stale"))
    .resolves.toMatchObject({ ok: false, error: { rule: "stale-draft-revision" } });
  await replay(
    () => store.forkDraft("bcn_1", { sourceDraftId: "draft_1", draftId: "draft_2", label: "Fork" }, "fork"),
    () => store.forkDraft("bcn_1", { sourceDraftId: "draft_1", draftId: "other", label: "Changed" }, "fork"),
  );
  await replay(
    () => store.abandonDraft("bcn_1", { draftId: "draft_2", reason: "done", abandonedAt: "2026-01-01T00:00:00.000Z" }, "abandon"),
    () => store.abandonDraft("bcn_1", { draftId: "draft_2", reason: "changed", abandonedAt: "2026-01-01T00:00:00.000Z" }, "abandon"),
  );
  await expect(store.abandonDraft("bcn_1", { draftId: "draft_2", reason: "done", abandonedAt: "2026-01-01T00:00:00.000Z" }, "fresh-abandon"))
    .resolves.toMatchObject({ ok: false, error: { rule: "draft-not-open" } });
  await expect(store.abandonDraft("bcn_1", {
    draftId: "draft_1", reason: "approval contract setup", abandonedAt: "2026-01-01T00:00:00.000Z",
  }, "abandon-approval-source")).resolves.toMatchObject({ ok: true });
  await expect(store.createDraft("bcn_1", create("draft_3"), "create-3")).resolves.toMatchObject({ ok: true });
  const approval = { draftId: "draft_3", expectedRevision: 1, versionId: "ver_1", reviewedHash: new JcsSha256Hasher().hash(project(content("draft_3"))), approvedAt: "2026-01-01T00:00:00.000Z", actor: null, staleOriginAcknowledged: false };
  await replay(
    () => store.approveDraft("bcn_1", approval, "approve"),
    () => store.approveDraft("bcn_1", { ...approval, actor: "changed" }, "approve"),
  );
  const duplicateSource = content("draft_4");
  await expect(store.createDraft("bcn_1", create("draft_4", duplicateSource), "create-4")).resolves.toMatchObject({ ok: true });
  await expect(store.approveDraft("bcn_1", { ...approval, draftId: "draft_4", expectedRevision: 1, reviewedHash: new JcsSha256Hasher().hash(project(duplicateSource)) }, "fresh-approve"))
    .resolves.toMatchObject({ ok: false, error: { rule: "duplicate-version-id", versionId: "ver_1" } });
  await replay(
    () => store.revokeVersion("bcn_1", { versionId: "ver_1", reason: "done", actor: null, revokedAt: "2026-01-02T00:00:00.000Z" }, "revoke"),
    () => store.revokeVersion("bcn_1", { versionId: "ver_1", reason: "changed", actor: null, revokedAt: "2026-01-02T00:00:00.000Z" }, "revoke"),
  );
}

describe("BeaconStore shared contract", () => {
  it("rejects a wrong-shaped stub, proving the suite is load-bearing", async () => {
    const wrong = { getBeacon: async () => ({ ok: true, value: null }) } as unknown as BeaconStore;
    await expect(exerciseBeaconStore(async () => wrong)).rejects.toThrow();
  });

  it("passes for FsBeaconStore using a fresh project", async () => {
    const root = await mkdtemp(join(tmpdir(), "pharos-contract-"));
    try {
      await exerciseBeaconStore(async () => new FsBeaconStore({ projectRoot: root, hasher: new JcsSha256Hasher() }));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
