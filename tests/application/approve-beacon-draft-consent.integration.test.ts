import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApproveBeaconDraft } from "../../src/application/approve-beacon-draft.js";
import { FsBeaconStore } from "../../src/adapters/fs-beacon-store/fs-beacon-store.js";
import { FsAtomicWriter } from "../../src/adapters/fs-beacon-store/atomic-writer.js";
import type { AtomicWriter } from "../../src/adapters/fs-beacon-store/atomic-writer.js";
import { FsConsentStore } from "../../src/adapters/fs-consent-store/index.js";
import { canonicalConsentGrantPayload, canonicalConsentGrantPayloadV2, staleComparisonDigest } from "../../src/adapters/host-consent-verifier/index.js";
import { JcsSha256Hasher } from "../../src/adapters/hashing/jcs-sha256-hasher.js";
import { project } from "../../src/domain/semantics/index.js";
import type { CaptureStore } from "../../src/domain/ports/index.js";
import type { AnyConsentGrant, ConsentGrant } from "../../src/domain/ports/operator-consent.js";
import { err, ok } from "../../src/shared/result.js";

const projectId = "proj_018f47de-7a00-7cc0-8000-000000000001" as const;
const beaconId = "bcn_018f47de-7a00-7cc0-8000-000000000001" as const;
const draftId = "drf_018f47de-7a00-7cc0-8000-000000000001" as const;
const captureId = "cap_018f47de-7a00-7cc0-8000-000000000001" as const;
const requestId = "req_018f47de-7a00-7cc0-8000-000000000002" as const;
const timestamp = "2026-03-05T00:00:00.000Z";
const content = { purpose: "Renew", actor: { type: "user" }, entryPoint: { path: "/checkout" }, actions: [], readinessIntent: { sideEffectClass: "stateless" } } as const;
const hasher = new JcsSha256Hasher();
let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "pharos-consent-approval-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

async function fixture(mode: "fresh" | "stale" | "revoked" = "fresh") {
  const keys = generateKeyPairSync("ed25519");
  const publicKey = keys.publicKey.export({ format: "der", type: "spki" });
  let now = Date.parse(timestamp);
  const options = { projectRoot: root, activeHostKey: async (host: string, key: string) => host === "host_1" && key === "key_1" ? publicKey : undefined, clock: () => now };
  const consent = new FsConsentStore(options);
  const beacon = new FsBeaconStore({ projectRoot: root, hasher });
  const oldContent = { ...content, purpose: "Old origin" };
  const currentContent = { ...content, purpose: "Different current active semantics" };
  const oldHash = hasher.hash(project(oldContent));
  const currentHash = hasher.hash(project(currentContent));
  const oldVersion = "ver_018f47de-7a00-7cc0-8000-000000000010";
  const activeVersion = "ver_018f47de-7a00-7cc0-8000-000000000011";
  if (mode !== "fresh") {
    const oldDraft = "drf_018f47de-7a00-7cc0-8000-000000000010";
    const currentDraft = "drf_018f47de-7a00-7cc0-8000-000000000011";
    expect(await beacon.createDraft(beaconId, { draftId: oldDraft, label: "Old", beaconTitle: "Renew", origin: { branchedFromVersion: null, branchedFromHash: null, forkedFromDraft: null }, content: oldContent }, "old-draft")).toMatchObject({ ok: true });
    expect(await beacon.approveDraft(beaconId, { draftId: oldDraft, expectedRevision: 1, reviewedHash: oldHash, versionId: oldVersion, approvedAt: timestamp, actor: null, staleOriginAcknowledged: false }, "old-approve")).toMatchObject({ ok: true });
    expect(await beacon.createDraft(beaconId, { draftId: currentDraft, label: "Current", beaconTitle: "Renew", origin: { branchedFromVersion: oldVersion, branchedFromHash: oldHash, forkedFromDraft: null }, content: currentContent }, "current-draft")).toMatchObject({ ok: true });
    expect(await beacon.approveDraft(beaconId, { draftId: currentDraft, expectedRevision: 1, reviewedHash: currentHash, versionId: activeVersion, approvedAt: timestamp, actor: null, staleOriginAcknowledged: false }, "current-approve")).toMatchObject({ ok: true });
    if (mode === "revoked") expect(await beacon.revokeActiveVersion(beaconId, { expectedActiveVersionId: activeVersion, revokedAt: timestamp, actor: null, reason: "test" }, "revoke-current")).toMatchObject({ ok: true });
  }
  expect(await beacon.createDraft(beaconId, { draftId, label: "Renew", beaconTitle: "Renew", origin: { branchedFromVersion: mode === "fresh" ? null : oldVersion, branchedFromHash: mode === "fresh" ? null : oldHash, forkedFromDraft: null }, content }, "seed-draft")).toMatchObject({ ok: true });
  const semanticHash = hasher.hash(project(content));
  // Capture is a fixture port: committed canonical association and promoted session,
  // with the same revision/hash as the real persisted draft.
  const capture: CaptureStore = {
    async getAssociationByBeacon() { return ok({ contract: "pharos.capture-beacon-association/1", state: "committed", projectId, captureId, requestId: "req_018f47de-7a00-7cc0-8000-000000000001", inputHash: "input", beaconId, draftId, revision: 1, semanticHash, createdAt: timestamp, committedAt: timestamp }); },
    async getSession() { return ok({ contract: "pharos.capture-session/2", projectId, captureId, requestId: "req_018f47de-7a00-7cc0-8000-000000000001", inputHash: "capture", secretSourceReferences: [], createdAt: timestamp, status: "promoted", artifact: { reference: "captures/recording.spec.ts", byteSize: 1, sha256: "a".repeat(64) }, completedAt: timestamp }); },
    async beginLaunch() { return err({ rule: "capture-not-found", captureId }); }, async recordRecorderStarted() { return err({ rule: "capture-not-found", captureId }); }, async markPostExit() { return err({ rule: "capture-not-found", captureId }); }, async resolve() { return err({ rule: "capture-not-found", captureId }); }, async recoverProject() { return ok({ recovered: [], blocked: [] }); }, async claimAnnotation() { return err({ rule: "capture-not-found", captureId }); }, async commitAssociation() { return err({ rule: "capture-not-found", captureId }); }, async getAssociationByCapture() { return ok(null); },
  };
  const make = (store = consent, beaconStore = beacon) => new ApproveBeaconDraft({ clock: { now: () => new Date(now) }, ids: { next: () => "ver_018f47de-7a00-7cc0-8000-000000000001" }, hasher, captureStore: capture, beaconStore, consentStore: store, issueChallenge: () => ({ challengeId: "challenge_1", expiresAtEpochMs: Date.parse(timestamp) + 60_000 }) });
  const prepared = await make().prepareConsent({ projectId, beaconId, requestId });
  expect(prepared).toMatchObject({ ok: true, value: { request: { binding: { projectId, beaconId, draftId, expectedRevision: 1, semanticHash, requestId } } } });
  if (!prepared.ok) throw new Error("preparation failed");
  const unsigned = { ...prepared.value.request, contract: mode === "fresh" ? "pharos.operator-consent-grant/1" : "pharos.operator-consent-grant/2", decision: "granted", hostId: "host_1", keyId: "key_1", algorithm: "ed25519" } as const;
  const grant = { ...unsigned, signature: sign(null, (mode === "fresh" ? canonicalConsentGrantPayload(unsigned as ConsentGrant) : canonicalConsentGrantPayloadV2(unsigned as import("../../src/domain/ports/operator-consent.js").ConsentGrantV2))!, keys.privateKey).toString("base64url") } as AnyConsentGrant;
  return { make, beacon, consent, options, grant, semanticHash, oldHash, currentHash, activeVersion, prepared: prepared.value, advanceClock: (epochMs: number) => { now = epochMs; }, signV2: (unsignedGrant: import("../../src/domain/ports/operator-consent.js").ConsentGrantV2) => ({ ...unsignedGrant, signature: sign(null, canonicalConsentGrantPayloadV2(unsignedGrant)!, keys.privateKey).toString("base64url") }) };
}

async function versionHistory(): Promise<string[]> {
  return readdir(join(root, "beacons", beaconId, "versions")).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
}

class CrashAfterActiveWriter implements AtomicWriter {
  readonly leakedTempPolicy = "sweep-on-recover" as const;
  private readonly inner = new FsAtomicWriter();
  async writeAtomic(path: string, bytes: string): Promise<void> {
    await this.inner.writeAtomic(path, bytes);
    if (path.endsWith("active.json")) throw new Error("crash after active swap");
  }
  createExclusive(path: string, bytes: string) { return this.inner.createExclusive(path, bytes); }
  removeAtomic(path: string) { return this.inner.removeAtomic(path); }
}

describe("signed consent through real filesystem authority stores", () => {
  it("recovers the same signed V2 claim after active swap without duplicating the version", async () => {
    const { make, consent, options, grant, prepared, beacon, signV2 } = await fixture("stale");
    const actionHash = consent.actionHash(prepared.request);
    const command = { versionId: "ver_018f47de-7a00-7cc0-8000-000000000099", approvedAt: timestamp, actor: null, bindingHash: actionHash,
      reviewed: grant.binding.action === "approve" && "reviewed" in grant.binding ? grant.binding.reviewed : undefined };
    expect(command.reviewed).toBeDefined();
    expect(await consent.beginVerifiedApproval(requestId, actionHash, grant, command, Date.parse(timestamp))).toMatchObject({ ok: true, value: { status: "claimed" } });
    const crashStore = new FsBeaconStore({ projectRoot: root, hasher, writer: new CrashAfterActiveWriter() });
    await expect(make(new FsConsentStore(options), crashStore).completeConsent({ requestId, grant })).rejects.toThrow("crash after active swap");
    expect(await beacon.getActiveVersion(beaconId)).toMatchObject({ ok: true, value: { versionId: command.versionId } });
    const historyAfterCrash = await versionHistory();
    expect(historyAfterCrash).toHaveLength(3);
    const restarted = make(new FsConsentStore(options), new FsBeaconStore({ projectRoot: root, hasher }));
    const result = await restarted.completeConsent({ requestId, grant });
    expect(result).toMatchObject({ ok: true, value: { versionId: command.versionId } });
    expect(await restarted.completeConsent({ requestId, grant })).toEqual(result);
    expect(await new FsConsentStore(options).getChallenge(requestId, Date.parse(timestamp))).toMatchObject({ ok: true, value: { status: "consumed", provenance: "verified", approvalCommand: command } });
    expect(await versionHistory()).toEqual(historyAfterCrash);
    expect(await beacon.getActiveVersion(beaconId)).toMatchObject({ ok: true, value: { versionId: command.versionId } });
    if (grant.contract !== "pharos.operator-consent-grant/2") throw new Error("expected V2 grant");
    const changed = signV2({ ...grant, binding: { ...grant.binding, reviewed: { ...grant.binding.reviewed, comparisonDigest: "sha256:altered" } } });
    expect(await restarted.completeConsent({ requestId, grant: changed })).toMatchObject({ ok: false });
    expect(await versionHistory()).toEqual(historyAfterCrash);
  });

  it("refuses a prepared active snapshot revoked to null before version artifacts", async () => {
    const { make, beacon, grant, activeVersion } = await fixture("stale");
    expect(await beacon.revokeActiveVersion(beaconId, { expectedActiveVersionId: activeVersion, revokedAt: timestamp, actor: null, reason: "changed" }, "revoke-after-prepare")).toMatchObject({ ok: true });
    const before = await versionHistory();
    expect(await make().completeConsent({ requestId, grant })).toMatchObject({ ok: false });
    expect(await versionHistory()).toEqual(before);
    expect(await beacon.getActiveVersion(beaconId)).toMatchObject({ ok: true, value: null });
  });
  it.each(["stale", "revoked"] as const)("binds %s review to the current active snapshot and recovers its signed command", async (mode) => {
    const { make, consent, beacon, options, grant, prepared, semanticHash, oldHash, currentHash, activeVersion } = await fixture(mode);
    const reviewed = { activeVersionId: mode === "stale" ? activeVersion : null, activeSemanticHash: mode === "stale" ? currentHash : null, comparisonDigest: staleComparisonDigest(semanticHash, mode === "stale" ? activeVersion : null, mode === "stale" ? currentHash : null)! };
    expect(prepared.request).toMatchObject({ contract: "pharos.operator-consent-request/2", binding: { staleOriginAcknowledged: true, reviewed } });
    expect(reviewed.activeSemanticHash).not.toBe(oldHash);
    expect(grant).toMatchObject({ contract: "pharos.operator-consent-grant/2", binding: { reviewed } });
    const actionHash = consent.actionHash(prepared.request);
    const command = { versionId: "ver_018f47de-7a00-7cc0-8000-000000000099", approvedAt: timestamp, actor: null, bindingHash: actionHash, reviewed };
    expect(await consent.beginVerifiedApproval(requestId, actionHash, grant, command, Date.parse(timestamp))).toMatchObject({ ok: true, value: { status: "claimed", approvalCommand: command } });
    const restarted = make(new FsConsentStore(options), new FsBeaconStore({ projectRoot: root, hasher }));
    const result = await restarted.completeConsent({ requestId, grant });
    expect(result).toMatchObject({ ok: true, value: { versionId: command.versionId } });
    expect(await restarted.completeConsent({ requestId, grant })).toEqual(result);
    expect(await beacon.getActiveVersion(beaconId)).toMatchObject({ ok: true, value: { versionId: command.versionId, approval: { reviewedHash: semanticHash } } });
    expect(await versionHistory()).toHaveLength(3);
  });

  it("retains v1 for nonstale preparation", async () => {
    const { prepared, grant } = await fixture();
    expect(prepared.request.contract).toBe("pharos.operator-consent-request/1");
    expect(grant.contract).toBe("pharos.operator-consent-grant/1");
  });

  it("refuses an unsigned or mismatched v1 grant against a stale v2 challenge", async () => {
    const { make, beacon, grant } = await fixture("stale");
    const legacy = { ...grant, contract: "pharos.operator-consent-grant/1" } as AnyConsentGrant;
    for (const invalid of [legacy, { ...legacy, signature: "" }]) {
      expect((await make().completeConsent({ requestId, grant: invalid })).ok).toBe(false);
    }
    expect((await beacon.getBeacon(beaconId)).ok).toBe(true);
    expect(await versionHistory()).toHaveLength(2);
  });

  it("conflicts when repeat preparation sees a changed active pointer", async () => {
    const { make, beacon } = await fixture("stale");
    expect(await beacon.revokeActiveVersion(beaconId, { expectedActiveVersionId: "ver_018f47de-7a00-7cc0-8000-000000000011", revokedAt: timestamp, actor: null, reason: "changed" }, "later-revoke")).toMatchObject({ ok: true });
    expect(await make().prepareConsent({ projectId, beaconId, requestId })).toMatchObject({ ok: false, error: { rule: "consent-request-conflict" } });
  });

  it("refuses changed active identity even when semantics match before writing a version", async () => {
    const { make, beacon, grant, currentHash, activeVersion } = await fixture("stale");
    expect(await beacon.revokeActiveVersion(beaconId, { expectedActiveVersionId: activeVersion, revokedAt: timestamp, actor: null, reason: "changed" }, "swap-revoke")).toMatchObject({ ok: true });
    expect(currentHash).toBeTruthy();
    expect((await make().completeConsent({ requestId, grant })).ok).toBe(false);
    expect(await versionHistory()).toHaveLength(2);
  });
  async function claimedFixture() {
    const setup = await fixture();
    const { consent, grant } = setup;
    const request = { contract: "pharos.operator-consent-request/1" as const, binding: grant.binding, challengeId: grant.challengeId, expiresAtEpochMs: grant.expiresAtEpochMs };
    const actionHash = consent.actionHash(request);
    const command = { versionId: "ver_018f47de-7a00-7cc0-8000-000000000099", approvedAt: "2026-03-05T00:00:01.000Z", actor: "operator", bindingHash: actionHash };
    expect(await consent.beginVerifiedApproval(requestId, actionHash, grant, command, Date.parse(timestamp))).toMatchObject({ ok: true, value: { status: "claimed", approvalCommand: command } });
    return { ...setup, actionHash, command };
  }

  it("recovers a durable claim after both stores restart before Beacon mutation", async () => {
    const { make, options, grant, command } = await claimedFixture();
    const restartedBeacon = new FsBeaconStore({ projectRoot: root, hasher });
    const result = await make(new FsConsentStore(options), restartedBeacon).completeConsent({ requestId, grant });
    expect(result).toMatchObject({ ok: true, value: { versionId: command.versionId, status: "active" } });
    expect(await restartedBeacon.getActiveVersion(beaconId)).toMatchObject({ ok: true, value: { versionId: command.versionId, approval: { approvedAt: command.approvedAt, actor: command.actor } } });
    expect(await readdir(join(root, "beacons", beaconId, "versions"))).toEqual([command.versionId]);
  });

  it("recovers a Beacon mutation after both stores restart before terminal consumption", async () => {
    const { make, beacon, options, grant, command } = await claimedFixture();
    expect(await beacon.approveDraft(beaconId, {
      draftId, expectedRevision: grant.binding.action === "approve" ? grant.binding.expectedRevision : 1,
      reviewedHash: grant.binding.action === "approve" ? grant.binding.semanticHash : "",
      versionId: command.versionId, approvedAt: command.approvedAt, actor: command.actor,
      staleOriginAcknowledged: false,
    }, `beacon-approve:${projectId}:${beaconId}:${requestId}`)).toMatchObject({ ok: true });
    const restartedBeacon = new FsBeaconStore({ projectRoot: root, hasher });
    const result = await make(new FsConsentStore(options), restartedBeacon).completeConsent({ requestId, grant });
    expect(result).toMatchObject({ ok: true, value: { versionId: command.versionId } });
    expect(await make(new FsConsentStore(options), new FsBeaconStore({ projectRoot: root, hasher })).completeConsent({ requestId, grant })).toEqual(result);
    expect(await readdir(join(root, "beacons", beaconId, "versions"))).toEqual([command.versionId]);
  });

  it("refuses an unchanged signed grant after trusted time passes expiry before the claim", async () => {
    const { make, beacon, grant, advanceClock } = await fixture();
    advanceClock(grant.expiresAtEpochMs + 1);
    expect((await make().completeConsent({ requestId, grant })).ok).toBe(false);
    expect(await beacon.getActiveVersion(beaconId)).toMatchObject({ ok: true, value: null });
    expect(await versionHistory()).toEqual([]);
  });
  it("commits one active version and replays the exact persisted result after consent-store restart", async () => {
    const { make, beacon, options, grant } = await fixture();
    const first = await make().completeConsent({ requestId, grant });
    expect(first).toMatchObject({ ok: true, value: { status: "active", assurance: "operator_confirmed" } });
    expect(await make(new FsConsentStore(options)).completeConsent({ requestId, grant })).toEqual(first);
    expect(await beacon.getActiveVersion(beaconId)).toMatchObject({ ok: true, value: { versionId: first.ok ? first.value.versionId : "", status: "active" } });
    expect(await readdir(join(root, "beacons", beaconId, "versions"))).toEqual([first.ok ? first.value.versionId : ""]);
  });

  it("refuses forged, expired and changed bindings without an active version", async () => {
    const { make, beacon, grant } = await fixture();
    for (const invalid of [
      { ...grant, signature: "A".repeat(86) },
      { ...grant, expiresAtEpochMs: Date.parse(timestamp) - 1 },
      { ...grant, binding: { ...grant.binding, projectId: "proj_other" } },
      { ...grant, binding: { ...grant.binding, semanticHash: "sha256:other" } },
      { ...grant, binding: { ...grant.binding, expectedRevision: 2 } },
      { ...grant, binding: { ...grant.binding, beaconId: "bcn_other" } },
    ] as ConsentGrant[]) {
      expect((await make().completeConsent({ requestId, grant: invalid })).ok).toBe(false);
      expect(await beacon.getActiveVersion(beaconId)).toMatchObject({ ok: true, value: null });
      expect(await versionHistory()).toEqual([]);
    }
    expect(await make().completeConsent({ requestId, grant })).toMatchObject({ ok: true });
  });
});
