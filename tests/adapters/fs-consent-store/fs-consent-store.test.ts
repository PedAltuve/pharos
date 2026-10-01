import { access, chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { consentActionHash, FsConsentStore } from "../../../src/adapters/fs-consent-store/index.js";
import type { ConsentGrant, ConsentRequest, ConsentGrantV2, ConsentRequestV2 } from "../../../src/domain/ports/operator-consent.js";
import { canonicalConsentGrantPayloadV2, staleComparisonDigest, canonicalConsentGrantPayload } from "../../../src/adapters/host-consent-verifier/index.js";
import { generateKeyPairSync, sign } from "node:crypto";

let projectRoot: string;
const binding = { action: "approve" as const, projectId: "proj_1", beaconId: "bcn_1", draftId: "drf_1", expectedRevision: 1, semanticHash: "sha256:x", requestId: "req_1" };
const request: ConsentRequest = { contract: "pharos.operator-consent-request/1", binding, challengeId: "chal_1", expiresAtEpochMs: 1_893_456_000_000 };
const now = 1_893_455_999_999;

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

beforeEach(async () => { projectRoot = await mkdtemp(join(tmpdir(), "pharos-consent-")); });
afterEach(async () => { await rm(projectRoot, { recursive: true, force: true }); });

describe("FsConsentStore", () => {
  it("provides the canonical action identity through its instance port", () => {
    const store = new FsConsentStore({ projectRoot });
    expect(store.actionHash(request)).toBe(consentActionHash(request));
    expect(store.actionHash({ ...request, binding: { ...binding, semanticHash: "sha256:other" } })).not.toBe(store.actionHash(request));
  });

  it("persists one immutable approval command before mutation and returns it after restart", async () => {
    const keys = generateKeyPairSync("ed25519");
    const unsigned = { contract: "pharos.operator-consent-grant/1", decision: "granted", binding, challengeId: request.challengeId, expiresAtEpochMs: request.expiresAtEpochMs, hostId: "host_1", keyId: "key_1", algorithm: "ed25519" } as const;
    const grant: ConsentGrant = { ...unsigned, signature: sign(null, canonicalConsentGrantPayload(unsigned)!, keys.privateKey).toString("base64url") };
    const options = { projectRoot, activeHostKey: async () => keys.publicKey.export({ format: "der" as const, type: "spki" as const }) };
    const store = new FsConsentStore(options);
    const hash = store.actionHash(request);
    const command = { versionId: "ver_1", approvedAt: "2030-01-01T00:00:00.000Z", actor: "operator", bindingHash: hash };
    await store.createChallenge(request, now);
    for (const malformed of [
      Object.defineProperty({ ...grant }, "privateKey", { value: "hidden" }),
      { ...grant, binding: Object.defineProperty({ ...binding }, "privateKey", { value: "hidden" }) },
      Object.defineProperty({ ...grant }, Symbol("secret"), { value: "hidden" }),
      Object.defineProperty({ ...grant }, "signature", { get: () => grant.signature, enumerable: true, configurable: true }),
    ]) {
      await expect(store.beginVerifiedApproval("req_1", hash, malformed as ConsentGrant, command, now)).resolves.toMatchObject({ ok: false });
    }
    expect(await exists(join(projectRoot, "consent", "claims", "req_1.json"))).toBe(false);
    const first = await store.beginVerifiedApproval("req_1", hash, grant, command, now);
    expect(first).toMatchObject({ ok: true, value: { status: "claimed", provenance: "verified", approvalCommand: command } });
    expect(JSON.stringify(first)).not.toContain(grant.signature);
    const restarted = new FsConsentStore(options);
    await expect(restarted.beginVerifiedApproval("req_1", hash, grant, command, request.expiresAtEpochMs + 1)).resolves.toEqual(first);
    await expect(restarted.beginVerifiedApproval("req_1", hash, grant, { ...command, versionId: "ver_2" }, now)).resolves.toMatchObject({ ok: false, error: { rule: "consent-consumption-conflict" } });
    await expect(restarted.beginVerifiedApproval("req_1", hash, { ...grant, signature: "changed" }, command, now)).resolves.toMatchObject({ ok: false });
    await expect(restarted.beginVerifiedApproval("req_1", hash, grant, { ...command, bindingHash: "other" }, now)).resolves.toMatchObject({ ok: false });
    await expect(restarted.getChallenge("req_1", now)).resolves.toEqual(first);
  });

  it("rejects hidden approval fields and signed material before /3 terminal persistence and replay", async () => {
    const keys = generateKeyPairSync("ed25519");
    const unsigned = { contract: "pharos.operator-consent-grant/1", decision: "granted", binding, challengeId: request.challengeId, expiresAtEpochMs: request.expiresAtEpochMs, hostId: "host_1", keyId: "key_1", algorithm: "ed25519" } as const;
    const grant: ConsentGrant = { ...unsigned, signature: sign(null, canonicalConsentGrantPayload(unsigned)!, keys.privateKey).toString("base64url") };
    const store = new FsConsentStore({ projectRoot, activeHostKey: async () => keys.publicKey.export({ format: "der", type: "spki" }) });
    const hash = store.actionHash(request);
    const command = { versionId: "ver_1", approvedAt: "2030-01-01T00:00:00.000Z", actor: null, bindingHash: hash };
    await store.createChallenge(request, now);
    const hidden = { ...command };
    Object.defineProperty(hidden, "privateKey", { value: "hidden", enumerable: false });
    await expect(store.beginVerifiedApproval("req_1", hash, grant, hidden, now)).resolves.toMatchObject({ ok: false });
    expect(await exists(join(projectRoot, "consent", "claims", "req_1.json"))).toBe(false);
    await store.beginVerifiedApproval("req_1", hash, grant, command, now);
    for (const result of [{ detail: grant.signature }, { detail: canonicalConsentGrantPayload(grant) }]) {
      await expect(store.completeVerifiedConsumption("req_1", hash, result as never, now)).resolves.toMatchObject({ ok: false });
      expect(await exists(join(projectRoot, "consent", "terminals", "req_1.json"))).toBe(false);
    }
    const first = await store.getChallenge("req_1", now);
    expect(first).toMatchObject({ ok: true, value: { approvalCommand: command } });
    const completed = await store.completeVerifiedConsumption("req_1", hash, { outcome: "done" }, now);
    expect(completed).toMatchObject({ ok: true, value: { status: "consumed", provenance: "verified", approvalCommand: command } });
    expect(JSON.stringify(completed)).not.toContain(grant.signature);
    const replay = await new FsConsentStore({ projectRoot, activeHostKey: async () => undefined }).beginVerifiedApproval("req_1", hash, grant, command, request.expiresAtEpochMs + 1);
    expect(replay).toEqual(completed);
    const creationReplay = await new FsConsentStore({ projectRoot, activeHostKey: async () => undefined }).createChallenge(request, request.expiresAtEpochMs + 1);
    expect(creationReplay).toEqual(completed);
    expect(JSON.stringify(creationReplay)).not.toContain(grant.signature);
    expect(JSON.stringify(creationReplay)).not.toContain('"grant"');
    await expect(store.completeVerifiedConsumption("req_1", hash, { detail: grant.signature }, now)).resolves.toMatchObject({ ok: false });
    await expect(store.completeVerifiedConsumption("req_1", hash, { outcome: "retry" }, now)).resolves.toMatchObject({ ok: true, value: { result: { outcome: "done" } } });
    await expect(store.getChallenge("req_1", now)).resolves.toMatchObject({ ok: true, value: { approvalCommand: command } });
    const path = join(projectRoot, "consent", "terminals", "req_1.json");
    const persisted = JSON.parse(await readFile(path, "utf8")) as { result: unknown };
    persisted.result = { detail: grant.signature };
    await writeFile(path, JSON.stringify(persisted));
    await expect(store.getChallenge("req_1", now)).rejects.toThrow(/Invalid consent terminal record/);
  });

  it("authenticates a guarded claim, resumes after expiry and rotation, and never upgrades a legacy claim", async () => {
    const keys = generateKeyPairSync("ed25519");
    const publicKey = keys.publicKey.export({ format: "der", type: "spki" });
    let active = true;
    const lookup = async () => active ? publicKey : undefined;
    const unsigned = { contract: "pharos.operator-consent-grant/1", decision: "granted", binding, challengeId: request.challengeId, expiresAtEpochMs: request.expiresAtEpochMs, hostId: "host_1", keyId: "key_1", algorithm: "ed25519" } as const;
    const grant: ConsentGrant = { ...unsigned, signature: sign(null, canonicalConsentGrantPayload(unsigned)!, keys.privateKey).toString("base64url") };
    const store = new FsConsentStore({ projectRoot, activeHostKey: lookup });
    const actionHash = consentActionHash(request);
    await store.createChallenge(request, now);
    await expect(store.beginVerifiedConsumption("req_1", actionHash, grant, now)).resolves.toMatchObject({ ok: true, value: { status: "claimed", provenance: "verified" } });
    const claimPath = join(projectRoot, "consent", "claims", "req_1.json");
    const originalClaim = await readFile(claimPath, "utf8");
    for (const change of [
      { requestHash: "bad" },
      { grant: { ...grant, challengeId: "other" } },
      { verifiedAtEpochMs: request.expiresAtEpochMs },
    ]) {
      await writeFile(claimPath, JSON.stringify({ ...JSON.parse(originalClaim), ...change }));
      await expect(store.getChallenge("req_1", now)).rejects.toThrow(/Invalid consent claim record/);
    }
    await writeFile(claimPath, originalClaim);
    active = false;
    await expect(new FsConsentStore({ projectRoot, activeHostKey: lookup }).beginVerifiedConsumption("req_1", actionHash, grant, request.expiresAtEpochMs + 1)).resolves.toMatchObject({ ok: true, value: { status: "claimed" } });
    await expect(store.beginVerifiedConsumption("req_1", "action:2", grant, now)).resolves.toMatchObject({ ok: false, error: { rule: "consent-consumption-conflict" } });
    expect(consentActionHash({ ...request, binding: { ...binding, semanticHash: "sha256:other" } })).not.toBe(actionHash);
    for (const leaked of [grant.signature, { outcome: grant.signature }, { nested: [{ detail: grant.signature }] }, { detail: grant }]) {
      await expect(store.completeVerifiedConsumption("req_1", actionHash, leaked as never, now)).resolves.toEqual({ ok: false, error: { rule: "invalid-consent-request", requestId: "req_1" } });
      expect(await exists(join(projectRoot, "consent", "terminals", "req_1.json"))).toBe(false);
    }
    await expect(store.completeVerifiedConsumption("req_1", actionHash, { nested: [{ signature: grant.signature }] } as never, now)).resolves.toMatchObject({ ok: false });
    await expect(store.completeVerifiedConsumption("req_1", actionHash, { nested: { grant } } as never, now)).resolves.toMatchObject({ ok: false });
    await expect(store.completeVerifiedConsumption("req_1", actionHash, { nested: { signature: "reusable" } } as never, now)).resolves.toMatchObject({ ok: false });
    await expect(store.completeConsumption("req_1", actionHash, { outcome: "done" }, now)).resolves.toMatchObject({ ok: false });
    const generic = await store.completeVerifiedConsumption("req_1", actionHash, { outcome: "done" }, now);
    expect(generic.ok && Object.hasOwn(generic.value, "approvalCommand")).toBe(false);
    const genericReplay = await new FsConsentStore({ projectRoot }).createChallenge(request, request.expiresAtEpochMs + 1);
    expect(genericReplay.ok && Object.hasOwn(genericReplay.value, "approvalCommand")).toBe(false);
    await expect(store.completeConsumption("req_1", actionHash, { outcome: "done" }, now)).resolves.toMatchObject({ ok: false });
    await expect(store.beginVerifiedConsumption("req_1", actionHash, grant, request.expiresAtEpochMs + 1)).resolves.toMatchObject({ ok: true, value: { status: "consumed", provenance: "verified" } });
    const path = join(projectRoot, "consent", "terminals", "req_1.json");
    const persisted = JSON.parse(await readFile(path, "utf8")) as { result: unknown };
    persisted.result = { innocent: [{ detail: grant.signature }] };
    await writeFile(path, JSON.stringify(persisted));
    await expect(new FsConsentStore({ projectRoot, activeHostKey: lookup }).completeVerifiedConsumption("req_1", actionHash, { outcome: "retry" }, now)).rejects.toThrow(/Invalid consent terminal record/);
    await expect(store.createChallenge(request, now)).rejects.toThrow(/Invalid consent terminal record/);
  });
});

describe("FsConsentStore stale v2 approval", () => {
  it("durably binds reviewed state to a verified signed grant and exact recovery command", async () => {
    const keys = generateKeyPairSync("ed25519");
    const reviewed = { activeVersionId: "ver_old", activeSemanticHash: "sha256:old", comparisonDigest: staleComparisonDigest(binding.semanticHash, "ver_old", "sha256:old")! };
    const v2: ConsentRequestV2 = { ...request, contract: "pharos.operator-consent-request/2", binding: { ...binding, staleOriginAcknowledged: true, reviewed } };
    const unsigned = { contract: "pharos.operator-consent-grant/2", decision: "granted", binding: v2.binding, challengeId: v2.challengeId, expiresAtEpochMs: v2.expiresAtEpochMs, hostId: "host_1", keyId: "key_1", algorithm: "ed25519" } as const;
    const grant: ConsentGrantV2 = { ...unsigned, signature: sign(null, canonicalConsentGrantPayloadV2(unsigned)!, keys.privateKey).toString("base64url") };
    const store = new FsConsentStore({ projectRoot, activeHostKey: async () => keys.publicKey.export({ format: "der", type: "spki" }) });
    const hash = store.actionHash(v2);
    const command = { versionId: "ver_new", approvedAt: "2030-01-01", actor: null, bindingHash: hash, reviewed };
    expect(hash).not.toBe(store.actionHash({ ...v2, binding: { ...v2.binding, reviewed: { ...reviewed, activeVersionId: "ver_other" } } }));
    await expect(store.createChallenge(v2, now)).resolves.toMatchObject({ ok: true, value: { status: "pending" } });
    await expect(store.createChallenge({ ...v2, binding: { ...v2.binding, reviewed: { ...reviewed, comparisonDigest: "other" } } }, now)).resolves.toMatchObject({ ok: false, error: { rule: "consent-request-conflict" } });
    for (const malformed of [{ ...grant, signature: "invalid" }, { ...grant, binding: { ...v2.binding, reviewed: { ...reviewed, extra: true } } }, { ...grant, binding: { ...v2.binding, reviewed: Object.defineProperty({ ...reviewed }, "comparisonDigest", { get: () => reviewed.comparisonDigest }) } }]) {
      await expect(store.beginVerifiedApproval("req_1", hash, malformed as ConsentGrantV2, command, now)).resolves.toMatchObject({ ok: false });
    }
    await expect(store.beginVerifiedApproval("req_1", hash, { ...grant, contract: "pharos.operator-consent-grant/1" } as unknown as ConsentGrant, command, now)).resolves.toMatchObject({ ok: false });
    expect(await exists(join(projectRoot, "consent", "claims", "req_1.json"))).toBe(false);
    await expect(store.beginVerifiedApproval("req_1", hash, grant, { ...command, reviewed: { ...reviewed, comparisonDigest: "other" } }, now)).resolves.toMatchObject({ ok: false });
    const first = await store.beginVerifiedApproval("req_1", hash, grant, command, now);
    expect(first).toMatchObject({ ok: true, value: { status: "claimed", approvalCommand: command } });
    const restarted = new FsConsentStore({ projectRoot, activeHostKey: async () => undefined });
    expect(await restarted.recoveryClaim("req_1")).toEqual({ request: v2, auditId: "consent:req_1", grant });
    await expect(restarted.beginVerifiedApproval("req_1", hash, grant, command, v2.expiresAtEpochMs + 1)).resolves.toEqual(first);
    await expect(restarted.beginVerifiedApproval("req_1", hash, grant, { ...command, reviewed: { ...reviewed, activeSemanticHash: "other" } }, now)).resolves.toMatchObject({ ok: false });
  });
});

describe("FsConsentStore verified revocation", () => {
  it("persists an exact immutable revoke command and replays it without signed material", async () => {
    const revokeBinding = { action: "revoke" as const, projectId: "proj_1", beaconId: "bcn_1", expectedActiveVersion: "ver_1", reason: "retire", requestId: "req_1" };
    const revokeRequest: ConsentRequest = { ...request, binding: revokeBinding };
    const keys = generateKeyPairSync("ed25519");
    const unsigned = { contract: "pharos.operator-consent-grant/1", decision: "granted", binding: revokeBinding, challengeId: request.challengeId, expiresAtEpochMs: request.expiresAtEpochMs, hostId: "host_1", keyId: "key_1", algorithm: "ed25519" } as const;
    const grant: ConsentGrant = { ...unsigned, signature: sign(null, canonicalConsentGrantPayload(unsigned)!, keys.privateKey).toString("base64url") };
    const options = { projectRoot, activeHostKey: async () => keys.publicKey.export({ format: "der" as const, type: "spki" as const }) };
    const store = new FsConsentStore(options);
    const hash = store.actionHash(revokeRequest);
    const command = { expectedActiveVersionId: "ver_1", reason: "retire", revokedAt: "2030-01-01T00:00:00.000Z", actor: null, bindingHash: hash };
    await store.createChallenge(revokeRequest, now);
    for (const invalid of [{ ...command, reason: "changed" }, { ...command, expectedActiveVersionId: "ver_2" }, Object.defineProperty({ ...command }, "hidden", { value: "secret" })]) {
      await expect(store.beginVerifiedRevocation("req_1", hash, grant, invalid, now)).resolves.toMatchObject({ ok: false });
    }
    expect(await exists(join(projectRoot, "consent", "claims", "req_1.json"))).toBe(false);
    const first = await store.beginVerifiedRevocation("req_1", hash, grant, command, now);
    expect(first).toMatchObject({ ok: true, value: { status: "claimed", revokeCommand: command } });
    const restarted = new FsConsentStore({ projectRoot, activeHostKey: async () => undefined });
    await expect(restarted.beginVerifiedRevocation("req_1", hash, grant, command, request.expiresAtEpochMs + 1)).resolves.toEqual(first);
    for (const changed of [{ ...command, reason: "other" }, { ...command, expectedActiveVersionId: "ver_2" }, { ...command, revokedAt: "other" }]) {
      await expect(restarted.beginVerifiedRevocation("req_1", hash, grant, changed, now)).resolves.toMatchObject({ ok: false });
    }
    await expect(restarted.beginVerifiedRevocation("req_1", hash, { ...grant, signature: "changed" }, command, now)).resolves.toMatchObject({ ok: false });
    await expect(restarted.beginVerifiedConsumption("req_1", hash, grant, now)).resolves.toMatchObject({ ok: false });
    await expect(restarted.beginVerifiedApproval("req_1", hash, grant, { versionId: "ver_2", approvedAt: command.revokedAt, actor: null, bindingHash: hash }, now)).resolves.toMatchObject({ ok: false });
    await expect(store.completeVerifiedConsumption("req_1", hash, { detail: grant.signature }, now)).resolves.toMatchObject({ ok: false });
    const terminal = await store.completeVerifiedConsumption("req_1", hash, { outcome: "revoked" }, now);
    expect(terminal).toMatchObject({ ok: true, value: { revokeCommand: command } });
    expect(JSON.stringify(terminal)).not.toContain(grant.signature);
    await expect(restarted.getChallenge("req_1", now)).resolves.toEqual(terminal);
    await expect(restarted.createChallenge(revokeRequest, now)).resolves.toEqual(terminal);
  });
});

describe("FsConsentStore trusted expiry", () => {
  it("refuses stale caller time for lookup, creation and replay without creating an expired request", async () => {
    let trusted = now;
    const store = new FsConsentStore({ projectRoot, clock: () => trusted });
    await expect(store.createChallenge(request, now)).resolves.toMatchObject({ ok: true });
    trusted = request.expiresAtEpochMs;
    const expired = { ok: false, error: { rule: "consent-expired", requestId: "req_1" } };
    await expect(store.getChallenge("req_1", now)).resolves.toEqual(expired);
    await expect(store.createChallenge(request, now)).resolves.toEqual(expired);
    await mkdir(join(projectRoot, "fresh"));
    await expect(new FsConsentStore({ projectRoot: join(projectRoot, "fresh"), clock: () => trusted }).createChallenge(request, now)).resolves.toEqual(expired);
    expect(await exists(join(projectRoot, "fresh", "consent", "requests", "req_1.json"))).toBe(false);
  });

  it("rejects an initial verified claim if the trusted clock expires during verification", async () => {
    const keys = generateKeyPairSync("ed25519");
    let trusted = now;
    const unsigned = { contract: "pharos.operator-consent-grant/1", decision: "granted", binding, challengeId: request.challengeId, expiresAtEpochMs: request.expiresAtEpochMs, hostId: "host_1", keyId: "key_1", algorithm: "ed25519" } as const;
    const grant: ConsentGrant = { ...unsigned, signature: sign(null, canonicalConsentGrantPayload(unsigned)!, keys.privateKey).toString("base64url") };
    const store = new FsConsentStore({ projectRoot, clock: () => trusted, activeHostKey: async () => {
      trusted = request.expiresAtEpochMs;
      return keys.publicKey.export({ format: "der", type: "spki" });
    } });
    await store.createChallenge(request, now);
    await expect(store.beginVerifiedConsumption("req_1", consentActionHash(request), grant, now)).resolves.toEqual({ ok: false, error: { rule: "consent-expired", requestId: "req_1" } });
    expect(await exists(join(projectRoot, "consent", "claims", "req_1.json"))).toBe(false);
  });
});

describe("FsConsentStore legacy isolation", () => {
  it("fails closed when replaying an old legacy terminal with a prohibited result key", async () => {
    const store = new FsConsentStore({ projectRoot });
    await store.createChallenge(request, now);
    await store.beginConsumption("req_1", "action:1", now);
    await store.completeConsumption("req_1", "action:1", { outcome: "safe" }, now);
    const path = join(projectRoot, "consent", "terminals", "req_1.json");
    const oldRecord = JSON.parse(await readFile(path, "utf8")) as { result: unknown };
    oldRecord.result = { capability: "old-value" };
    await writeFile(path, JSON.stringify(oldRecord));
    await expect(new FsConsentStore({ projectRoot }).completeConsumption("req_1", "action:1", { outcome: "retry" }, now)).rejects.toThrow(/Invalid consent terminal record/);
  });
  it("does not promote an unsigned legacy claim to a guarded claim", async () => {
    const store = new FsConsentStore({ projectRoot });
    await store.createChallenge(request, now);
    await store.beginConsumption("req_1", "action:1", now);
    await expect(store.completeVerifiedConsumption("req_1", "action:1", { outcome: "forged" }, now)).resolves.toMatchObject({ ok: false });
    await expect(store.beginVerifiedConsumption("req_1", consentActionHash(request), {} as ConsentGrant, request.expiresAtEpochMs + 1)).resolves.toMatchObject({ ok: false });
  });
});

describe("FsConsentStore", () => {
  it("creates private pending challenges and replays the same request identity", async () => {
    const store = new FsConsentStore({ projectRoot });

    await expect(store.createChallenge(request, now)).resolves.toEqual({ ok: true, value: { status: "pending", request, auditId: "consent:req_1" } });
    await expect(store.createChallenge(request, now)).resolves.toEqual({ ok: true, value: { status: "pending", request, auditId: "consent:req_1" } });
    await expect(store.createChallenge({ ...request, binding: { ...binding, semanticHash: "sha256:changed" } }, now)).resolves.toEqual({ ok: false, error: { rule: "consent-request-conflict", requestId: "req_1" } });

    const file = join(projectRoot, "consent", "requests", "req_1.json");
    expect(await exists(file)).toBe(true);
    expect((await stat(join(projectRoot, "consent"))).mode & 0o777).toBe(0o700);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it("refuses expired challenge creation and invalid clocks without durable state", async () => {
    const store = new FsConsentStore({ projectRoot });

    await expect(store.createChallenge(request, request.expiresAtEpochMs)).resolves.toEqual({ ok: false, error: { rule: "consent-expired", requestId: "req_1" } });
    await expect(store.createChallenge(request, Number.NaN)).resolves.toEqual({ ok: false, error: { rule: "invalid-consent-request", requestId: "req_1" } });
    await expect(store.createChallenge(request, -1)).resolves.toEqual({ ok: false, error: { rule: "invalid-consent-request", requestId: "req_1" } });
    expect(await exists(join(projectRoot, "consent"))).toBe(false);
  });

  it("rejects non-closed and unstable request shapes before writing them", async () => {
    const store = new FsConsentStore({ projectRoot });
    const withSecret = { ...request, privateKey: "not-public" } as unknown as ConsentRequest;
    const bindingWithSecret = { ...request, binding: { ...binding, privateKey: "not-public" } } as unknown as ConsentRequest;
    let revisionReads = 0;
    const unstableBinding = { ...binding } as typeof binding;
    Object.defineProperty(unstableBinding, "expectedRevision", { enumerable: true, get: () => revisionReads++ === 0 ? 1 : 0 });
    const unstable = { ...request, binding: unstableBinding } as ConsentRequest;

    await expect(store.createChallenge(withSecret, now)).resolves.toEqual({ ok: false, error: { rule: "invalid-consent-request", requestId: "req_1" } });
    await expect(store.createChallenge(bindingWithSecret, now)).resolves.toEqual({ ok: false, error: { rule: "invalid-consent-request", requestId: "req_1" } });
    await expect(store.createChallenge(unstable, now)).resolves.toEqual({ ok: false, error: { rule: "invalid-consent-request", requestId: "req_1" } });
    await expect(store.createChallenge(null as never, now)).resolves.toEqual({ ok: false, error: { rule: "invalid-consent-request", requestId: "" } });
    const throwing = {} as ConsentRequest;
    Object.defineProperty(throwing, "binding", { enumerable: true, get: () => { throw new Error("boom"); } });
    await expect(store.createChallenge(throwing, now)).resolves.toEqual({ ok: false, error: { rule: "invalid-consent-request", requestId: "" } });
    const inheritedAction = Object.create({ get action() { throw new Error("boom"); } }) as typeof binding;
    Object.assign(inheritedAction, { projectId: "proj_1", beaconId: "bcn_1", draftId: "drf_1", expectedRevision: 1, semanticHash: "sha256:x", requestId: "req_1" });
    await expect(store.createChallenge({ ...request, binding: inheritedAction }, now)).resolves.toEqual({ ok: false, error: { rule: "invalid-consent-request", requestId: "req_1" } });
    expect(await exists(join(projectRoot, "consent"))).toBe(false);
  });

  it("replays reordered but semantically identical requests", async () => {
    const store = new FsConsentStore({ projectRoot });
    const reordered = { expiresAtEpochMs: request.expiresAtEpochMs, challengeId: request.challengeId, binding: { requestId: "req_1", semanticHash: "sha256:x", expectedRevision: 1, draftId: "drf_1", beaconId: "bcn_1", projectId: "proj_1", action: "approve" as const }, contract: "pharos.operator-consent-request/1" as const };

    await expect(store.createChallenge(request, now)).resolves.toMatchObject({ ok: true });
    await expect(store.createChallenge(reordered, now)).resolves.toMatchObject({ ok: true });
  });

  it("persists the validated request snapshot instead of serialization hooks", async () => {
    const store = new FsConsentStore({ projectRoot });
    const hooked = { ...request } as ConsentRequest & { toJSON?: () => unknown };
    Object.defineProperty(hooked, "toJSON", { value: () => ({ ...request, challengeId: "changed" }), enumerable: false });

    await expect(store.createChallenge(hooked, now)).resolves.toEqual({ ok: true, value: { status: "pending", request, auditId: "consent:req_1" } });
    await expect(new FsConsentStore({ projectRoot }).createChallenge(request, now)).resolves.toEqual({ ok: true, value: { status: "pending", request, auditId: "consent:req_1" } });
  });

  it("records decline as terminal and never consumes it", async () => {
    const store = new FsConsentStore({ projectRoot });
    await store.createChallenge(request, now);

    await expect(store.decline("req_1", "operator declined", now)).resolves.toEqual({ ok: true, value: { status: "declined", requestId: "req_1", reason: "operator declined", auditId: "consent:req_1" } });
    await expect(store.decline("req_1", "operator declined", now)).resolves.toEqual({ ok: true, value: { status: "declined", requestId: "req_1", reason: "operator declined", auditId: "consent:req_1" } });
    await expect(store.decline("req_1", "different reason", now)).resolves.toEqual({ ok: false, error: { rule: "consent-consumption-conflict", requestId: "req_1" } });
    await expect(store.createChallenge(request, request.expiresAtEpochMs + 1)).resolves.toEqual({ ok: true, value: { status: "declined", requestId: "req_1", reason: "operator declined", auditId: "consent:req_1" } });
    await expect(store.createChallenge({ ...request, binding: { ...binding, semanticHash: "sha256:changed" } }, now)).resolves.toEqual({ ok: false, error: { rule: "consent-request-conflict", requestId: "req_1" } });
    await expect(store.beginConsumption("req_1", "action:1", now)).resolves.toEqual({ ok: false, error: { rule: "consent-already-declined", requestId: "req_1" } });
  });

  it("refuses decline after a consumption claim exists", async () => {
    const store = new FsConsentStore({ projectRoot });
    await store.createChallenge(request, now);
    await store.beginConsumption("req_1", "action:1", now);

    await expect(store.decline("req_1", "too late", now)).resolves.toEqual({ ok: false, error: { rule: "consent-consumption-conflict", requestId: "req_1" } });
    await expect(store.completeConsumption("req_1", "action:1", { outcome: "mutated" }, now)).resolves.toMatchObject({ ok: true, value: { status: "consumed" } });
  });

  it("claims before mutation, completes once, replays the same action, and rejects changed input", async () => {
    const store = new FsConsentStore({ projectRoot });
    await store.createChallenge(request, now);

    await expect(store.completeConsumption("req_1", "action:1", { outcome: "mutated" }, now)).resolves.toEqual({ ok: false, error: { rule: "consent-not-claimed", requestId: "req_1" } });
    await expect(store.beginConsumption("req_1", "action:1", now)).resolves.toMatchObject({ ok: true, value: { status: "claimed", provenance: "unauthenticated" } });
    await expect(store.createChallenge(request, now)).resolves.toMatchObject({ ok: true, value: { status: "claimed", provenance: "unauthenticated" } });
    await expect(store.beginConsumption("req_1", "action:1", now)).resolves.toMatchObject({ ok: true, value: { status: "claimed", provenance: "unauthenticated" } });
    await expect(store.beginConsumption("req_1", "action:2", now)).resolves.toEqual({ ok: false, error: { rule: "consent-consumption-conflict", requestId: "req_1" } });
    await expect(store.beginConsumption("req_1", "action:1", request.expiresAtEpochMs + 1)).resolves.toMatchObject({ ok: true, value: { status: "claimed", provenance: "unauthenticated" } });
    const consumed = await store.completeConsumption("req_1", "action:1", { outcome: "mutated", versionId: "ver_1" }, request.expiresAtEpochMs + 1);
    expect(consumed).toEqual({ ok: true, value: { status: "consumed", provenance: "unauthenticated", requestId: "req_1", actionHash: "action:1", result: { outcome: "mutated", versionId: "ver_1" }, auditId: "consent:req_1" } });
    await expect(store.completeConsumption("req_1", "action:1", { outcome: "mutated", versionId: "ver_retry" }, request.expiresAtEpochMs + 1)).resolves.toEqual(consumed);
    await expect(store.createChallenge(request, request.expiresAtEpochMs + 1)).resolves.toEqual(consumed);
    await expect(store.createChallenge({ ...request, binding: { ...binding, semanticHash: "sha256:changed" } }, now)).resolves.toEqual({ ok: false, error: { rule: "consent-request-conflict", requestId: "req_1" } });
    await expect(store.completeConsumption("req_1", "action:2", { outcome: "mutated" }, now)).resolves.toEqual({ ok: false, error: { rule: "consent-consumption-conflict", requestId: "req_1" } });
  });

  it("rejects invalid clocks, empty action hashes, and non-JSON results", async () => {
    const store = new FsConsentStore({ projectRoot });
    await store.createChallenge(request, now);
    await expect(store.beginConsumption("req_1", "", now)).resolves.toEqual({ ok: false, error: { rule: "invalid-consent-request", requestId: "req_1" } });
    await expect(store.beginConsumption("req_1", ["not-a-string"] as never, now)).resolves.toEqual({ ok: false, error: { rule: "invalid-consent-request", requestId: "req_1" } });
    await expect(store.decline("req_1", undefined as never, now)).resolves.toEqual({ ok: false, error: { rule: "invalid-consent-request", requestId: "req_1" } });
    await store.beginConsumption("req_1", "action:1", now);
    await expect(store.beginConsumption("req_1", "action:1", Number.NaN)).resolves.toEqual({ ok: false, error: { rule: "invalid-consent-request", requestId: "req_1" } });
    await expect(store.completeConsumption("req_1", "action:1", { outcome: "mutated" }, -1)).resolves.toEqual({ ok: false, error: { rule: "invalid-consent-request", requestId: "req_1" } });
    await expect(store.completeConsumption("req_1", "action:1", Number.NaN as never, now)).resolves.toEqual({ ok: false, error: { rule: "invalid-consent-request", requestId: "req_1" } });
    await expect(store.completeConsumption("req_1", "action:1", { privateKey: "secret" } as never, now)).resolves.toEqual({ ok: false, error: { rule: "invalid-consent-request", requestId: "req_1" } });
    await expect(store.completeConsumption("req_1", "action:1", { capability: "reuse-me" } as never, now)).resolves.toEqual({ ok: false, error: { rule: "invalid-consent-request", requestId: "req_1" } });
    await expect(store.completeConsumption("req_1", "action:1", new Date("2026-01-01T00:00:00.000Z") as never, now)).resolves.toEqual({ ok: false, error: { rule: "invalid-consent-request", requestId: "req_1" } });
    const cycle: { self?: unknown } = {};
    cycle.self = cycle;
    await expect(store.completeConsumption("req_1", "action:1", cycle as never, now)).resolves.toEqual({ ok: false, error: { rule: "invalid-consent-request", requestId: "req_1" } });
    const accessorObject = { outcome: "mutated" } as Record<string, unknown>;
    Object.defineProperty(accessorObject, "computed", { enumerable: true, get: () => "unstable" });
    await expect(store.completeConsumption("req_1", "action:1", accessorObject as never, now)).resolves.toEqual({ ok: false, error: { rule: "invalid-consent-request", requestId: "req_1" } });
    const accessorArray = ["value"] as unknown[];
    Object.defineProperty(accessorArray, "0", { enumerable: true, get: () => "unstable" });
    await expect(store.completeConsumption("req_1", "action:1", accessorArray as never, now)).resolves.toEqual({ ok: false, error: { rule: "invalid-consent-request", requestId: "req_1" } });
    const hooked = { outcome: "mutated" } as { outcome: string; toJSON?: () => unknown };
    Object.defineProperty(hooked, "toJSON", { value: () => ({ outcome: "changed" }), enumerable: false });
    await expect(store.completeConsumption("req_1", "action:1", hooked as never, now)).resolves.toEqual({ ok: false, error: { rule: "invalid-consent-request", requestId: "req_1" } });
    const arrayPrototype = Array.prototype as unknown as { toJSON?: unknown };
    const originalArrayToJson = arrayPrototype.toJSON;
    arrayPrototype.toJSON = () => ["changed"];
    try {
      await expect(store.completeConsumption("req_1", "action:1", ["value"] as never, now)).resolves.toEqual({ ok: false, error: { rule: "invalid-consent-request", requestId: "req_1" } });
    } finally {
      if (originalArrayToJson === undefined) {
        delete arrayPrototype.toJSON;
      } else {
        arrayPrototype.toJSON = originalArrayToJson;
      }
    }
    const inheritedThrowingToJson = ["value"];
    Object.setPrototypeOf(inheritedThrowingToJson, Object.create(Array.prototype, { toJSON: { get: () => { throw new Error("getter invoked"); } } }));
    await expect(store.completeConsumption("req_1", "action:1", inheritedThrowingToJson as never, now)).resolves.toEqual({ ok: false, error: { rule: "invalid-consent-request", requestId: "req_1" } });
    const sparse = [] as unknown[];
    sparse[1] = "hole";
    await expect(store.completeConsumption("req_1", "action:1", sparse as never, now)).resolves.toEqual({ ok: false, error: { rule: "invalid-consent-request", requestId: "req_1" } });
    const namedArray = ["value"] as unknown[] & { extra?: string };
    namedArray.extra = "lost";
    await expect(store.completeConsumption("req_1", "action:1", namedArray as never, now)).resolves.toEqual({ ok: false, error: { rule: "invalid-consent-request", requestId: "req_1" } });
    const nonEnumerableArray = ["value"] as unknown[];
    Object.defineProperty(nonEnumerableArray, "hidden", { value: "lost", enumerable: false });
    await expect(store.completeConsumption("req_1", "action:1", nonEnumerableArray as never, now)).resolves.toEqual({ ok: false, error: { rule: "invalid-consent-request", requestId: "req_1" } });
    await store.completeConsumption("req_1", "action:1", { outcome: "mutated" }, now);
    await expect(store.completeConsumption("req_1", "action:1", { outcome: "mutated" }, Number.NaN)).resolves.toEqual({ ok: false, error: { rule: "invalid-consent-request", requestId: "req_1" } });
    await expect(store.decline("req_1", "operator declined", -1)).resolves.toEqual({ ok: false, error: { rule: "invalid-consent-request", requestId: "req_1" } });
  });

  it("preserves own enumerable __proto__ result keys without prototype mutation", async () => {
    const store = new FsConsentStore({ projectRoot });
    await store.createChallenge(request, now);
    await store.beginConsumption("req_1", "action:1", now);
    const withProto = JSON.parse('{"__proto__":{"polluted":true},"outcome":"mutated"}') as { readonly __proto__: { readonly polluted: boolean }; readonly outcome: string };

    const protoResult = await store.completeConsumption("req_1", "action:1", withProto as never, now);

    expect(protoResult).toEqual({ ok: true, value: { status: "consumed", provenance: "unauthenticated", requestId: "req_1", actionHash: "action:1", result: withProto, auditId: "consent:req_1" } });
    expect(protoResult.ok && protoResult.value.status === "consumed" && Object.hasOwn(protoResult.value.result as Record<string, unknown>, "__proto__")).toBe(true);
    await expect(new FsConsentStore({ projectRoot }).completeConsumption("req_1", "action:1", { outcome: "retry" }, now)).resolves.toEqual(protoResult);
  });

  it("serializes concurrent consumers through the project lock", async () => {
    const store = new FsConsentStore({ projectRoot });
    await store.createChallenge(request, now);

    const [first, second] = await Promise.all([
      store.beginConsumption("req_1", "action:1", now),
      store.beginConsumption("req_1", "action:2", now),
    ]);
    const results = [first, second];
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([expect.objectContaining({ error: { rule: "consent-consumption-conflict", requestId: "req_1" } })]);
  });

  it("enforces private request, claim, and terminal directories", async () => {
    await mkdir(join(projectRoot, "consent", "requests"), { recursive: true, mode: 0o755 });
    await mkdir(join(projectRoot, "consent", "claims"), { recursive: true, mode: 0o755 });
    await mkdir(join(projectRoot, "consent", "terminals"), { recursive: true, mode: 0o755 });
    const store = new FsConsentStore({ projectRoot });

    await expect(store.createChallenge(request, now)).resolves.toMatchObject({ ok: true });

    expect((await stat(join(projectRoot, "consent", "requests"))).mode & 0o777).toBe(0o700);
    expect((await stat(join(projectRoot, "consent", "claims"))).mode & 0o777).toBe(0o700);
    expect((await stat(join(projectRoot, "consent", "terminals"))).mode & 0o777).toBe(0o700);
  });

  it("refuses symlinked consent subdirectories", async () => {
    const outside = join(projectRoot, "outside");
    await mkdir(outside);
    await mkdir(join(projectRoot, "consent"), { recursive: true });
    await symlink(outside, join(projectRoot, "consent", "requests"));

    await expect(new FsConsentStore({ projectRoot }).createChallenge(request, now)).rejects.toThrow(/symlinked private directory/);
  });

  it("revalidates private directories on replay and terminal writes", async () => {
    const store = new FsConsentStore({ projectRoot });
    await store.createChallenge(request, now);
    const outside = join(projectRoot, "outside-terminal");
    await mkdir(outside);
    await rm(join(projectRoot, "consent", "terminals"), { recursive: true, force: true });
    await symlink(outside, join(projectRoot, "consent", "terminals"));

    await expect(store.createChallenge(request, now)).rejects.toThrow(/symlinked private directory/);
    await expect(store.decline("req_1", "operator declined", now)).rejects.toThrow(/symlinked private directory/);
  });

  it("repairs permissive record files before replay", async () => {
    const store = new FsConsentStore({ projectRoot });
    await store.createChallenge(request, now);
    await store.beginConsumption("req_1", "action:1", now);
    const requestPath = join(projectRoot, "consent", "requests", "req_1.json");
    const claimPath = join(projectRoot, "consent", "claims", "req_1.json");
    await chmod(requestPath, 0o644);
    await chmod(claimPath, 0o644);

    await expect(new FsConsentStore({ projectRoot }).createChallenge(request, now)).resolves.toMatchObject({ ok: true, value: { status: "claimed" } });

    expect((await stat(requestPath)).mode & 0o777).toBe(0o600);
    expect((await stat(claimPath)).mode & 0o777).toBe(0o600);

    await store.completeConsumption("req_1", "action:1", { outcome: "mutated" }, now);
    const terminalPath = join(projectRoot, "consent", "terminals", "req_1.json");
    await chmod(terminalPath, 0o644);
    await expect(new FsConsentStore({ projectRoot }).completeConsumption("req_1", "action:1", { outcome: "retry" }, now)).resolves.toMatchObject({ ok: true, value: { status: "consumed" } });
    expect((await stat(terminalPath)).mode & 0o777).toBe(0o600);
  });

  it("recovers deterministically from a terminal record after process restart", async () => {
    await new FsConsentStore({ projectRoot }).createChallenge(request, now);
    await new FsConsentStore({ projectRoot }).beginConsumption("req_1", "action:1", now);
    await new FsConsentStore({ projectRoot }).completeConsumption("req_1", "action:1", { outcome: "mutated", versionId: "ver_1" }, now);

    const restarted = new FsConsentStore({ projectRoot });
    await expect(restarted.completeConsumption("req_1", "action:1", { outcome: "mutated", versionId: "ver_retry" }, request.expiresAtEpochMs + 1)).resolves.toEqual({ ok: true, value: { status: "consumed", provenance: "unauthenticated", requestId: "req_1", actionHash: "action:1", result: { outcome: "mutated", versionId: "ver_1" }, auditId: "consent:req_1" } });
    expect(await readFile(join(projectRoot, "consent", "terminals", "req_1.json"), "utf8")).toContain("ver_1");
  });
});
