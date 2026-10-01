import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RevokeActiveBeacon } from "../../src/application/revoke-active-beacon.js";
import { FsBeaconStore } from "../../src/adapters/fs-beacon-store/fs-beacon-store.js";
import { FsConsentStore } from "../../src/adapters/fs-consent-store/index.js";
import { canonicalConsentGrantPayload } from "../../src/adapters/host-consent-verifier/index.js";
import { JcsSha256Hasher } from "../../src/adapters/hashing/jcs-sha256-hasher.js";
import type { ConsentGrant } from "../../src/domain/ports/operator-consent.js";

const projectId = "proj_018f47de-7a00-7cc0-8000-000000000001" as const;
const beaconId = "bcn_018f47de-7a00-7cc0-8000-000000000001" as const;
const draftId = "drf_018f47de-7a00-7cc0-8000-000000000001" as const;
const versionId = "ver_018f47de-7a00-7cc0-8000-000000000001";
const requestId = "req_018f47de-7a00-7cc0-8000-000000000002" as const;
const timestamp = "2026-03-05T00:00:00.000Z";
const hasher = new JcsSha256Hasher();
let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "pharos-consent-revoke-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

async function fixture() {
  const keys = generateKeyPairSync("ed25519");
  const publicKey = keys.publicKey.export({ format: "der", type: "spki" });
  let now = Date.parse(timestamp);
  const options = { projectRoot: root, activeHostKey: async (host: string, key: string) => host === "host_1" && key === "key_1" ? publicKey : undefined, clock: () => now };
  const consent = new FsConsentStore(options);
  const beacon = new FsBeaconStore({ projectRoot: root, hasher });
  const content = { purpose: "Renew", actor: { type: "user" }, entryPoint: { path: "/checkout" }, actions: [], readinessIntent: { sideEffectClass: "stateless" } } as const;
  expect(await beacon.createDraft(beaconId, { draftId, label: "Renew", beaconTitle: "Renew", origin: { branchedFromVersion: null, branchedFromHash: null, forkedFromDraft: null }, content }, "seed-draft")).toMatchObject({ ok: true });
  expect(await beacon.approveDraft(beaconId, { draftId, expectedRevision: 1, reviewedHash: hasher.hash((await import("../../src/domain/semantics/index.js")).project(content)), versionId, approvedAt: timestamp, actor: "operator", staleOriginAcknowledged: false }, "seed-approval")).toMatchObject({ ok: true });
  const make = (store = consent, authority = beacon, trustedProject: typeof projectId | null = projectId) => new RevokeActiveBeacon({ beaconStore: authority, consentStore: store, canonicalProjectId: trustedProject ?? undefined, clock: { now: () => new Date(now) }, issueChallenge: () => ({ challengeId: "challenge_revoke", expiresAtEpochMs: Date.parse(timestamp) + 60_000 }) });
  const prepared = await make().prepareConsent({ projectId, beaconId, requestId, reason: "  withdrawn  " });
  expect(prepared).toMatchObject({ ok: true, value: { request: { binding: { action: "revoke", projectId, beaconId, expectedActiveVersion: versionId, reason: "withdrawn", requestId } } } });
  if (!prepared.ok) throw new Error("preparation failed");
  const unsigned = { ...prepared.value.request, contract: "pharos.operator-consent-grant/1", decision: "granted", hostId: "host_1", keyId: "key_1", algorithm: "ed25519" } as const;
  const signGrant = (value: typeof unsigned): ConsentGrant => ({ ...value, signature: sign(null, canonicalConsentGrantPayload(value)!, keys.privateKey).toString("base64url") });
  return { beacon, consent, options, make, grant: signGrant(unsigned), signGrant, unsigned, advance: (value: number) => { now = value; } };
}

async function history() { return readdir(join(root, "beacons", beaconId, "versions")); }
async function revocationHistory() {
  const directory = join(root, "beacons", beaconId, "versions", versionId);
  return { entries: await readdir(directory), content: await readFile(join(directory, "revocation.json"), "utf8") };
}

async function claimedFixture() {
  const setup = await fixture();
  const { grant, consent } = setup;
  const request = { contract: "pharos.operator-consent-request/1" as const, binding: grant.binding, challengeId: grant.challengeId, expiresAtEpochMs: grant.expiresAtEpochMs };
  const actionHash = consent.actionHash(request);
  const command = { expectedActiveVersionId: versionId, reason: "withdrawn", revokedAt: "2026-03-05T00:00:01.000Z", actor: null, bindingHash: actionHash };
  expect(await consent.beginVerifiedRevocation(requestId, actionHash, grant, command, Date.parse(timestamp))).toMatchObject({ ok: true, value: { status: "claimed", revokeCommand: command } });
  return { ...setup, command };
}

describe("signed revocation through real filesystem stores", () => {
  it("rejects absent or wrong trusted project during preparation and completion without claiming", async () => {
    const { make, grant, consent, beacon } = await fixture();
    const wrong = "proj_other" as typeof projectId;
    for (const trusted of [null, wrong]) {
      expect(await make(consent, beacon, trusted).prepareConsent({ projectId, beaconId, requestId: "req_other" as typeof requestId, reason: "withdrawn" })).toMatchObject({ ok: false });
      expect(await make(consent, beacon, trusted).completeConsent({ requestId, grant })).toMatchObject({ ok: false });
      expect(await consent.getChallenge(requestId, Date.parse(timestamp))).toMatchObject({ ok: true, value: { status: "pending" } });
      expect(await beacon.getActiveVersion(beaconId)).toMatchObject({ ok: true, value: { versionId } });
      expect(await history()).toEqual([versionId]);
    }
    expect(await make().prepareConsent({ projectId: wrong, beaconId, requestId: "req_other" as typeof requestId, reason: "withdrawn" })).toMatchObject({ ok: false });
  });
  it("revokes the historical version and replays the original result after both stores restart", async () => {
    const { make, options, grant } = await fixture();
    const first = await make().completeConsent({ requestId, grant });
    expect(first).toEqual({ ok: true, value: { beaconId, versionId, status: "revoked", reason: "withdrawn" } });
    const restartedBeacon = new FsBeaconStore({ projectRoot: root, hasher });
    expect(await make(new FsConsentStore(options), restartedBeacon).completeConsent({ requestId, grant })).toEqual(first);
    expect(await restartedBeacon.getActiveVersion(beaconId)).toMatchObject({ ok: true, value: null });
    expect(await restartedBeacon.getBeacon(beaconId)).toMatchObject({ ok: true, value: { activeVersionId: null, versions: { [versionId]: { status: "revoked", previousStatus: "active" } } } });
    expect(await history()).toEqual([versionId]);
    const record = await revocationHistory();
    expect(record.entries.filter((entry) => entry === "revocation.json")).toHaveLength(1);
    expect(JSON.parse(record.content)).toMatchObject({ contract: "pharos.version-revocation/1", previous_status: "active", revocation: { reason: "withdrawn", actor: null } });
    expect(await make(new FsConsentStore(options), restartedBeacon).completeConsent({ requestId, grant })).toEqual(first);
    expect(await revocationHistory()).toEqual(record);
    expect(await restartedBeacon.getActiveVersion(beaconId)).toMatchObject({ ok: true, value: null });
  });

  it("declining the pending request makes even its valid signed grant powerless", async () => {
    const { make, consent, grant, beacon } = await fixture();
    expect(await consent.decline(requestId, "operator declined", Date.parse(timestamp))).toMatchObject({ ok: true });
    expect((await make().completeConsent({ requestId, grant })).ok).toBe(false);
    expect(await beacon.getActiveVersion(beaconId)).toMatchObject({ ok: true, value: { versionId } });
    expect(await history()).toEqual([versionId]);
  });

  it("recovers a durable claim after restart before Beacon mutation", async () => {
    const { make, options, grant } = await claimedFixture();
    const authority = new FsBeaconStore({ projectRoot: root, hasher });
    expect(await make(new FsConsentStore(options), authority).completeConsent({ requestId, grant })).toMatchObject({ ok: true, value: { versionId, status: "revoked" } });
    expect(await authority.getActiveVersion(beaconId)).toMatchObject({ ok: true, value: null });
    expect(await history()).toEqual([versionId]);
  });

  it("recovers a Beacon mutation after restart before terminal completion", async () => {
    const { make, beacon, options, grant, command } = await claimedFixture();
    expect(await beacon.revokeActiveVersion(beaconId, command, `beacon-revoke:${projectId}:${beaconId}:${requestId}`)).toMatchObject({ ok: true });
    const first = await make(new FsConsentStore(options), new FsBeaconStore({ projectRoot: root, hasher })).completeConsent({ requestId, grant });
    expect(first).toMatchObject({ ok: true, value: { versionId, status: "revoked" } });
    expect(await make(new FsConsentStore(options), new FsBeaconStore({ projectRoot: root, hasher })).completeConsent({ requestId, grant })).toEqual(first);
    expect(await history()).toEqual([versionId]);
  });

  it("accepts a real signature over reordered binding keys", async () => {
    const { make, unsigned, signGrant } = await fixture();
    const b = unsigned.binding;
    if (b.action !== "revoke") throw new Error("unexpected action");
    const reordered = { requestId: b.requestId, reason: b.reason, expectedActiveVersion: b.expectedActiveVersion, beaconId: b.beaconId, projectId: b.projectId, action: b.action };
    expect(await make().completeConsent({ requestId, grant: signGrant({ ...unsigned, binding: reordered }) })).toMatchObject({ ok: true, value: { versionId } });
    expect(await history()).toEqual([versionId]);
  });

  it("refuses altered signed bindings, wrong signer and expiry without a second mutation", async () => {
    const { make, beacon, grant, advance } = await fixture();
    const binding = grant.binding;
    if (binding.action !== "revoke") throw new Error("unexpected action");
    const invalid: ConsentGrant[] = [
      { ...grant, signature: "A".repeat(86) },
      { ...grant, hostId: "other_host" },
      { ...grant, binding: { ...binding, reason: "different" } },
      { ...grant, binding: { ...binding, expectedActiveVersion: "ver_other" } },
      { ...grant, binding: { ...binding, projectId: "proj_other" } },
      { ...grant, binding: { ...binding, beaconId: "bcn_other" } },
    ];
    for (const altered of invalid) {
      expect((await make().completeConsent({ requestId, grant: altered })).ok).toBe(false);
      expect(await beacon.getActiveVersion(beaconId)).toMatchObject({ ok: true, value: { versionId } });
      expect(await history()).toEqual([versionId]);
    }
    advance(grant.expiresAtEpochMs + 1);
    expect((await make().completeConsent({ requestId, grant })).ok).toBe(false);
    expect(await history()).toEqual([versionId]);
    expect(await beacon.getActiveVersion(beaconId)).toMatchObject({ ok: true, value: { versionId } });
  });

  it("conflicts on changed signed inputs after consumption without rewriting history", async () => {
    const { make, grant, unsigned, signGrant, beacon } = await fixture();
    const first = await make().completeConsent({ requestId, grant });
    expect(first.ok).toBe(true);
    const before = await revocationHistory();
    const binding = unsigned.binding;
    if (binding.action !== "revoke") throw new Error("unexpected action");
    for (const changed of [
      { ...binding, reason: "changed" },
      { ...binding, expectedActiveVersion: "ver_other" },
      { ...binding, requestId: "req_other" },
      { ...binding, action: "approve" as const },
    ]) {
      const altered = signGrant({ ...unsigned, binding: changed as typeof binding });
      expect((await make().completeConsent({ requestId, grant: altered })).ok).toBe(false);
      expect(await revocationHistory()).toEqual(before);
      expect(await beacon.getActiveVersion(beaconId)).toMatchObject({ ok: true, value: null });
    }
  });
});
