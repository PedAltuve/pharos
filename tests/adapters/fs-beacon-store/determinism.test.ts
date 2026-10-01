import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DraftOrigin, Beacon } from "../../../src/domain/beacon/index.js";
import type { SemanticSource } from "../../../src/domain/semantics/index.js";
import { project } from "../../../src/domain/semantics/index.js";
import { FsBeaconStore } from "../../../src/adapters/fs-beacon-store/fs-beacon-store.js";
import { scanVersions } from "../../../src/adapters/fs-beacon-store/reconcile.js";
import { JcsSha256Hasher } from "../../../src/adapters/hashing/jcs-sha256-hasher.js";
import { staleComparisonDigest } from "../../../src/adapters/host-consent-verifier/index.js";

let root: string;
const hasher = new JcsSha256Hasher();
const origin: DraftOrigin = { branchedFromVersion: null, branchedFromHash: null, forkedFromDraft: null };
const content = (purpose: string): SemanticSource => ({ purpose, actor: { type: "user" }, entryPoint: { path: "/" }, actions: [], readinessIntent: { sideEffectClass: "stateless" } });
const create = (draftId: string, source = content(draftId)) => ({ draftId, label: draftId, beaconTitle: "Beacon", origin, content: source });
const value = <T>(result: { readonly ok: boolean; readonly value?: T }): T => { if (!result.ok) throw new Error("expected BeaconStore success"); return result.value as T; };

async function lifecycle(path: string): Promise<Beacon> {
  const store = new FsBeaconStore({ projectRoot: path, hasher });
  const first = content("first");
  value(await store.createDraft("bcn_1", create("draft_1", first), "create-1"));
  value(await store.updateDraft("bcn_1", { draftId: "draft_1", expectedRevision: 1, content: content("updated") }, "update-1"));
  value(await store.forkDraft("bcn_1", { sourceDraftId: "draft_1", draftId: "draft_2", label: "Fork" }, "fork-1"));
  value(await store.abandonDraft("bcn_1", { draftId: "draft_2", reason: "done", abandonedAt: "2026-01-01T00:00:00.000Z" }, "abandon-1"));
  value(await store.abandonDraft("bcn_1", { draftId: "draft_1", reason: "approval setup", abandonedAt: "2026-01-01T00:00:01.000Z" }, "abandon-approval-source"));
  const approvalSource = content("approval");
  value(await store.createDraft("bcn_1", create("draft_3", approvalSource), "create-3"));
  value(await store.approveDraft("bcn_1", { draftId: "draft_3", expectedRevision: 1, versionId: "ver_1", reviewedHash: hasher.hash(project(approvalSource)), approvedAt: "2026-01-02T00:00:00.000Z", actor: null, staleOriginAcknowledged: false }, "approve-1"));
  return value(await store.revokeVersion("bcn_1", { versionId: "ver_1", reason: "done", actor: null, revokedAt: "2026-01-03T00:00:00.000Z" }, "revoke-1"));
}

async function bytes(base: string, path = base): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : 1)) {
    const full = join(path, entry.name);
    if (entry.isDirectory()) Object.assign(out, await bytes(base, full));
    else out[relative(base, full)] = await readFile(full, "utf8");
  }
  return out;
}

beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "pharos-determinism-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("FsBeaconStore determinism", () => {
  it("uses UTF-16 code-unit ordering for listings and committed roots", async () => {
    const store = new FsBeaconStore({ projectRoot: root, hasher });
    await store.createDraft("bcn_a", create("draft_a"), "a");
    await store.createDraft("bcn_Z", create("draft_Z"), "Z");
    await expect(store.listBeacons()).resolves.toMatchObject({ ok: true, value: [{ beaconId: "bcn_Z" }, { beaconId: "bcn_a" }] });
    const source = content("root");
    await store.createDraft("bcn_root", create("draft_Z", source), "root-create-Z");
    await store.approveDraft("bcn_root", { draftId: "draft_Z", expectedRevision: 1, versionId: "ver_Z", reviewedHash: hasher.hash(project(source)), approvedAt: "2026-01-01T00:00:00.000Z", actor: null, staleOriginAcknowledged: false }, "root-approve-Z");
    await store.createDraft("bcn_root", create("draft_a", source), "root-create-a");
    const snapshot = await store.getActiveSemanticSnapshot("bcn_root");
    if (!snapshot.ok || !snapshot.value) throw new Error("missing active snapshot");
    const reviewedHash = hasher.hash(project(source));
    await store.approveDraft("bcn_root", { draftId: "draft_a", expectedRevision: 1, versionId: "ver_a", reviewedHash, approvedAt: "2026-01-02T00:00:00.000Z", actor: null, staleOriginAcknowledged: true,
      reviewedActiveVersionId: snapshot.value.versionId, reviewedActiveSemanticHash: snapshot.value.semanticHash,
      comparisonDigest: staleComparisonDigest(reviewedHash, snapshot.value.versionId, snapshot.value.semanticHash) }, "root-approve-a");
    await store.revokeVersion("bcn_root", { versionId: "ver_Z", reason: "done", actor: null, revokedAt: "2026-01-03T00:00:00.000Z" }, "root-revoke-Z");
    expect(Object.keys((await scanVersions(root, "bcn_root")).versions)).toEqual(["ver_Z", "ver_a"]);
  });

  it("serializes independent lifecycles byte-identically and round-trips every mutation", async () => {
    const other = await mkdtemp(join(tmpdir(), "pharos-determinism-other-"));
    try {
      const expected = await lifecycle(root);
      await lifecycle(other);
      expect(await new FsBeaconStore({ projectRoot: root, hasher }).getBeacon("bcn_1")).toEqual({ ok: true, value: expected });
      const left = await bytes(root);
      expect(await bytes(other)).toEqual(left);
    } finally { await rm(other, { recursive: true, force: true }); }
  });

  it("leaves project.json byte-identical across all nine port methods", async () => {
    const projectJson = join(root, "project.json");
    await writeFile(projectJson, '{"projectId":"p"}');
    const expected = await lifecycle(root);
    const store = new FsBeaconStore({ projectRoot: root, hasher });
    await store.getBeacon("bcn_1"); await store.listBeacons(); await store.getActiveVersion("bcn_1");
    expect(expected.activeVersionId).toBeNull();
    expect(await readFile(projectJson, "utf8")).toBe('{"projectId":"p"}');
  });
});
