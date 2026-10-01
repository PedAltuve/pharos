import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { FsBeaconStore } from "../../../src/adapters/fs-beacon-store/fs-beacon-store.js";
import { BeaconStoreCorruptionError } from "../../../src/adapters/fs-beacon-store/corruption.js";
import { JcsSha256Hasher } from "../../../src/adapters/hashing/jcs-sha256-hasher.js";
import { project } from "../../../src/domain/semantics/index.js";

const hasher = new JcsSha256Hasher();
const content = { purpose: "original", actor: { type: "user" }, entryPoint: { path: "/" }, actions: [], readinessIntent: { sideEffectClass: "stateless" as const } };
let root: string;
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });

async function setup() {
  root = await mkdtemp(join(tmpdir(), "pharos-snapshot-"));
  const store = new FsBeaconStore({ projectRoot: root, hasher });
  await store.createDraft("bcn_1", { beaconTitle: "Beacon", draftId: "draft_1", label: "Draft", origin: { branchedFromVersion: null, branchedFromHash: null, forkedFromDraft: null }, content }, "create");
  const hash = hasher.hash(project(content));
  await store.approveDraft("bcn_1", { draftId: "draft_1", expectedRevision: 1, versionId: "ver_1", reviewedHash: hash, approvedAt: "2026-01-01T00:00:00Z", actor: null, staleOriginAcknowledged: false }, "approve");
  return { store, hash, dir: join(root, "beacons", "bcn_1"), semantics: join(root, "beacons", "bcn_1", "versions", "ver_1", "semantics.json") };
}

it("reads committed artifact rather than mutable draft, without acquiring the lock", async () => {
  const { store, hash, dir } = await setup();
  const draftPath = join(dir, "drafts", "draft_1", "draft.json");
  const draft = JSON.parse(await readFile(draftPath, "utf8"));
  draft.status = "open"; // Interrupted close: mutable draft is not semantic authority.
  draft.content.purpose = "tampered";
  await writeFile(draftPath, JSON.stringify(draft));
  await writeFile(join(root, "lock"), JSON.stringify({ pid: process.pid, hostname: "remote-host-not-us", nonce: "held" }));
  expect(await store.getActiveSemanticSnapshot("bcn_1")).toEqual({ ok: true, value: { versionId: "ver_1", semanticHash: hash, semantics: project(content) } });
});

it("returns null without an active pointer", async () => {
  const { store, dir } = await setup();
  await rm(join(dir, "active.json"));
  expect(await store.getActiveSemanticSnapshot("bcn_1")).toEqual({ ok: true, value: null });
});

it("rejects missing, extra, incomplete, and hash-mismatched semantics", async () => {
  const { store, semantics } = await setup();
  const original = await readFile(semantics, "utf8");
  for (const mutation of [
    (v: Record<string, unknown>) => { v.extra = true; },
    (v: Record<string, unknown>) => { delete v.actor; },
    (v: Record<string, unknown>) => { v.purpose = "changed"; },
    (v: Record<string, unknown>) => { v.actions = [{ action: "x", target: null, value: { kind: "variable", variable: 12 } }]; },
  ]) {
    const value = JSON.parse(original);
    mutation(value);
    await writeFile(semantics, JSON.stringify(value));
    await expect(store.getActiveSemanticSnapshot("bcn_1")).rejects.toThrow(BeaconStoreCorruptionError);
  }
  await rm(semantics);
  await expect(store.getActiveSemanticSnapshot("bcn_1")).rejects.toThrow(BeaconStoreCorruptionError);
});

it("rejects conflicting closed draft provenance", async () => {
  const { store, dir } = await setup();
  const path = join(dir, "drafts", "draft_1", "draft.json");
  const draft = JSON.parse(await readFile(path, "utf8"));
  draft.revision = 2;
  await writeFile(path, JSON.stringify(draft));
  await expect(store.getActiveSemanticSnapshot("bcn_1")).rejects.toThrow(BeaconStoreCorruptionError);
});
