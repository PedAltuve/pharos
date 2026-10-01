import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FsProjectContextStore } from "../../src/adapters/fs-project-context-store/index.js";
import { FsConsentStore } from "../../src/adapters/fs-consent-store/index.js";
import { FsBeaconStore } from "../../src/adapters/fs-beacon-store/index.js";
import { FsAtomicWriter } from "../../src/adapters/fs-beacon-store/atomic-writer.js";
import type { AtomicWriter } from "../../src/adapters/fs-beacon-store/atomic-writer.js";
import { JcsSha256Hasher } from "../../src/adapters/hashing/index.js";
import { project } from "../../src/domain/semantics/index.js";
import { canonicalConsentGrantPayload, canonicalConsentGrantPayloadV2, staleComparisonDigest } from "../../src/adapters/host-consent-verifier/index.js";
import type { ConsentRequestV2 } from "../../src/domain/ports/operator-consent.js";
import type { ConsentGrant, ConsentRequest } from "../../src/domain/ports/operator-consent.js";
import { createHostConsentRuntime } from "../../src/host-consent/index.js";

const projectId = "proj_018f47de-7a00-7cc0-8000-000000000001" as const;
const otherId = "proj_018f47de-7a00-7cc0-8000-000000000002" as const;
const requestId = "req_018f47de-7a00-7cc0-8000-000000000002" as const;
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "pharos-host-runtime-"));
  roots.push(root);
  const home = join(root, "home");
  const cwd = join(root, "associated");
  const unassociated = join(root, "unassociated");
  await mkdir(cwd);
  await mkdir(unassociated);
  const contexts = new FsProjectContextStore({ home });
  expect(await contexts.initialize({ context: { contract: "pharos.project-context/1", projectId, revision: 1, name: "Checkout", mode: "external", environment: "staging", baseUrl: "https://staging.example.test/", createdAt: "2026-03-01T00:00:00.000Z" }, associationPath: cwd, requestId: "req_init", inputHash: "init" })).toMatchObject({ ok: true });
  const runtime = createHostConsentRuntime({ home, cwd, projectId });
  const keys = generateKeyPairSync("ed25519");
  const publicKey = keys.publicKey.export({ format: "der", type: "spki" }).toString("base64");
  const request: ConsentRequest = { contract: "pharos.operator-consent-request/1", binding: { action: "revoke", projectId, beaconId: "bcn_018f47de-7a00-7cc0-8000-000000000001", expectedActiveVersion: "ver_018f47de-7a00-7cc0-8000-000000000001", reason: "withdrawn", requestId }, challengeId: "challenge_1", expiresAtEpochMs: Date.now() + 60_000 };
  const unsigned = { ...request, contract: "pharos.operator-consent-grant/1", decision: "granted", hostId: "host_1", keyId: "key_1", algorithm: "ed25519" } as const;
  const grant: ConsentGrant = { ...unsigned, signature: sign(null, canonicalConsentGrantPayload(unsigned)!, keys.privateKey).toString("base64url") };
  return { home, cwd, unassociated, runtime, publicKey, request, grant, projectRoot: join(home, "store", projectId) };
}

async function seedApproval(f: Awaited<ReturnType<typeof fixture>>) {
  const beaconId = "bcn_018f47de-7a00-7cc0-8000-000000000001" as const;
  const draftId = "drf_018f47de-7a00-7cc0-8000-000000000001" as const;
  const beacon = new FsBeaconStore({ projectRoot: f.projectRoot, hasher: new JcsSha256Hasher() });
  const content = { purpose: "Renew", actor: { type: "user" }, entryPoint: { path: "/checkout" }, actions: [], readinessIntent: { sideEffectClass: "stateless" } } as const;
  expect(await beacon.createDraft(beaconId, { draftId, label: "Renew", beaconTitle: "Renew", origin: { branchedFromVersion: null, branchedFromHash: null, forkedFromDraft: null }, content }, "seed-draft")).toMatchObject({ ok: true });
  const request: ConsentRequest = { ...f.request, binding: { action: "approve", projectId, beaconId, draftId, expectedRevision: 1, semanticHash: new JcsSha256Hasher().hash(project(content)), requestId } };
  const keys = generateKeyPairSync("ed25519");
  const publicKey = keys.publicKey.export({ format: "der", type: "spki" }).toString("base64");
  const unsigned = { ...request, contract: "pharos.operator-consent-grant/1", decision: "granted", hostId: "host_1", keyId: "key_1", algorithm: "ed25519" } as const;
  const grant: ConsentGrant = { ...unsigned, signature: sign(null, canonicalConsentGrantPayload(unsigned)!, keys.privateKey).toString("base64url") };
  const store = new FsConsentStore({ projectRoot: f.projectRoot, activeHostKey: async () => Buffer.from(publicKey, "base64") });
  const hash = store.actionHash(request);
  const command = { versionId: "ver_018f47de-7a00-7cc0-8000-000000000003", approvedAt: new Date().toISOString(), actor: null, bindingHash: hash };
  return { beacon, beaconId, request, grant, store, hash, command, publicKey };
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

async function staleClaim() {
  const f = await fixture();
  const hasher = new JcsSha256Hasher();
  const beacon = new FsBeaconStore({ projectRoot: f.projectRoot, hasher });
  const beaconId = "bcn_018f47de-7a00-7cc0-8000-000000000001" as const;
  const predecessorId = "ver_018f47de-7a00-7cc0-8000-000000000010";
  const predecessorDraft = "drf_018f47de-7a00-7cc0-8000-000000000010";
  const predecessorContent = { purpose: "Original active", actor: { type: "user" }, entryPoint: { path: "/original" }, actions: [], readinessIntent: { sideEffectClass: "stateless" } } as const;
  const predecessorHash = hasher.hash(project(predecessorContent));
  expect(await beacon.createDraft(beaconId, { draftId: predecessorDraft, label: "Original", beaconTitle: "Renew", origin: { branchedFromVersion: null, branchedFromHash: null, forkedFromDraft: null }, content: predecessorContent }, "predecessor-draft")).toMatchObject({ ok: true });
  expect(await beacon.approveDraft(beaconId, { draftId: predecessorDraft, expectedRevision: 1, reviewedHash: predecessorHash, versionId: predecessorId, approvedAt: new Date().toISOString(), actor: null, staleOriginAcknowledged: false }, "predecessor-approve")).toMatchObject({ ok: true });
  const a = await seedApproval(f);
  if (a.request.binding.action !== "approve") throw new Error("expected approval fixture");
  const reviewed = { activeVersionId: predecessorId, activeSemanticHash: predecessorHash, comparisonDigest: staleComparisonDigest(a.request.binding.semanticHash, predecessorId, predecessorHash)! };
  const binding = { ...a.request.binding, staleOriginAcknowledged: true as const, reviewed };
  const request: ConsentRequestV2 = { contract: "pharos.operator-consent-request/2", binding, challengeId: a.request.challengeId, expiresAtEpochMs: a.request.expiresAtEpochMs };
  const keys = generateKeyPairSync("ed25519");
  const publicKey = keys.publicKey.export({ format: "der", type: "spki" }).toString("base64");
  expect(await f.runtime.register("host_1", "key_1", publicKey)).toMatchObject({ ok: true });
  const unsigned = { ...request, contract: "pharos.operator-consent-grant/2" as const, decision: "granted" as const, hostId: "host_1", keyId: "key_1", algorithm: "ed25519" as const };
  const grant = { ...unsigned, signature: sign(null, canonicalConsentGrantPayloadV2(unsigned)!, keys.privateKey).toString("base64url") };
  expect(await a.store.createChallenge(request, Date.now())).toMatchObject({ ok: true });
  const command = { ...a.command, bindingHash: a.store.actionHash(request), reviewed };
  const signingStore = new FsConsentStore({ projectRoot: f.projectRoot, activeHostKey: async () => Buffer.from(publicKey, "base64") });
  expect(await signingStore.beginVerifiedApproval(requestId, command.bindingHash, grant, command, Date.now())).toMatchObject({ ok: true, value: { status: "claimed" } });
  const versions = () => readdir(join(f.projectRoot, "beacons", a.beaconId, "versions"));
  const comparison = { activeVersionId: predecessorId, activeSemanticHash: predecessorHash, active: { purpose: "Original active" }, draft: { purpose: "Renew" } };
  return { f, a, request, grant, command, predecessorId, predecessorHash, versions, comparison };
}

describe("host consent runtime", () => {
  it("marks persisted sensitive-only differences without exposing their values", async () => {
    const f = await fixture();
    const beacon = new FsBeaconStore({ projectRoot: f.projectRoot, hasher: new JcsSha256Hasher() });
    const beaconId = "bcn_018f47de-7a00-7cc0-8000-000000000001" as const;
    const content = { purpose: "Same", actor: { type: "user", identityRef: "private-actor-old" }, entryPoint: { path: "/checkout" }, actions: [], readinessIntent: { sideEffectClass: "stateless" }, variables: { token: { name: "token", classification: "test_data", secretReferenceId: "private-secret-old", nonSensitiveExample: "private-example-old" } } } as const;
    const draftId = "drf_018f47de-7a00-7cc0-8000-000000000010" as const;
    expect(await beacon.createDraft(beaconId, { draftId, label: "Same", beaconTitle: "Same", origin: { branchedFromVersion: null, branchedFromHash: null, forkedFromDraft: null }, content }, "original-draft")).toMatchObject({ ok: true });
    const hash = new JcsSha256Hasher().hash(project(content));
    const versionId = "ver_018f47de-7a00-7cc0-8000-000000000010";
    expect(await beacon.approveDraft(beaconId, { draftId, expectedRevision: 1, reviewedHash: hash, versionId, approvedAt: new Date().toISOString(), actor: null, staleOriginAcknowledged: false }, "original-approval")).toMatchObject({ ok: true });
    const nextId = "drf_018f47de-7a00-7cc0-8000-000000000011" as const;
    const changed = { ...content, actor: { ...content.actor, identityRef: "private-actor-new" }, variables: { token: { ...content.variables.token, secretReferenceId: "private-secret-new", nonSensitiveExample: null } } };
    expect(await beacon.createDraft(beaconId, { draftId: nextId, label: "Same", beaconTitle: "Same", origin: { branchedFromVersion: versionId, branchedFromHash: hash, forkedFromDraft: null }, content: changed }, "next-draft")).toMatchObject({ ok: true });
    const nextHash = new JcsSha256Hasher().hash(project(changed));
    const binding = { action: "approve" as const, projectId, beaconId, draftId: nextId, expectedRevision: 1, semanticHash: nextHash, requestId, staleOriginAcknowledged: true as const, reviewed: { activeVersionId: versionId, activeSemanticHash: hash, comparisonDigest: staleComparisonDigest(nextHash, versionId, hash)! } };
    const store = new FsConsentStore({ projectRoot: f.projectRoot, activeHostKey: async () => undefined });
    expect(await store.createChallenge({ contract: "pharos.operator-consent-request/2", binding, challengeId: "challenge_sensitive", expiresAtEpochMs: Date.now() + 60_000 }, Date.now())).toMatchObject({ ok: true });
    const result = await f.runtime.reviewComparison(requestId);
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true, value: { equal: false, draft: { actor: { identityRef: "[redacted; changed]" }, variables: { token: { secretReferenceId: "[redacted; changed]", nonSensitiveExample: null } } }, active: { actor: { identityRef: "[redacted; changed]" }, variables: { token: { secretReferenceId: "[redacted; changed]", nonSensitiveExample: "[redacted; changed]" } } } } });
    for (const secret of ["private-actor-old", "private-actor-new", "private-secret-old", "private-secret-new", "private-example-old"]) expect(JSON.stringify(result)).not.toContain(secret);
  });
  it("reviews the original persisted active projection before mutation and resumes the same V2 claim", async () => {
    const s = await staleClaim();
    const before = await s.versions();
    expect(await s.f.runtime.reviewComparison(requestId)).toMatchObject({ ok: true, value: { ...s.comparison, alreadyCommitted: false } });
    expect(await s.a.beacon.getCommittedSemanticSnapshot(s.a.beaconId, s.predecessorId)).toMatchObject({ ok: true, value: { versionId: s.predecessorId, semanticHash: s.predecessorHash, semantics: { purpose: "Original active" } } });
    expect(await createHostConsentRuntime({ home: s.f.home, cwd: s.f.cwd, projectId }).resumeClaim(requestId)).toMatchObject({ ok: true, value: { versionId: s.command.versionId } });
    expect((await s.versions()).length).toBe(before.length + 1);
    expect(await s.a.store.getChallenge(requestId, Date.now())).toMatchObject({ ok: true, value: { status: "consumed" } });
  });

  it("reviews the signed predecessor after Beacon completes but before consent consumption", async () => {
    const s = await staleClaim();
    expect(await s.a.beacon.approveDraft(s.a.beaconId, {
      draftId: s.request.binding.draftId, expectedRevision: s.request.binding.expectedRevision, reviewedHash: s.request.binding.semanticHash,
      versionId: s.command.versionId, approvedAt: s.command.approvedAt, actor: null, staleOriginAcknowledged: true,
      reviewedActiveVersionId: s.predecessorId, reviewedActiveSemanticHash: s.predecessorHash, comparisonDigest: s.request.binding.reviewed.comparisonDigest,
    }, `beacon-approve:${projectId}:${s.a.beaconId}:${requestId}`)).toMatchObject({ ok: true });
    expect(await s.a.beacon.getBeacon(s.a.beaconId)).toMatchObject({ ok: true, value: { drafts: { [s.request.binding.draftId]: { status: "closed" } } } });
    expect(await s.a.store.getChallenge(requestId, Date.now())).toMatchObject({ ok: true, value: { status: "claimed" } });
    const before = await s.versions();
    expect(await s.f.runtime.reviewComparison(requestId)).toMatchObject({ ok: true, value: { ...s.comparison, alreadyCommitted: true } });
    expect(await createHostConsentRuntime({ home: s.f.home, cwd: s.f.cwd, projectId }).resumeClaim(requestId)).toMatchObject({ ok: true, value: { versionId: s.command.versionId } });
    expect(await s.versions()).toEqual(before);
    expect(await s.a.store.getChallenge(requestId, Date.now())).toMatchObject({ ok: true, value: { status: "consumed" } });
  });

  it("refuses a stale claim when the predecessor is revoked before mutation", async () => {
    const s = await staleClaim();
    expect(await s.a.beacon.revokeActiveVersion(s.a.beaconId, { expectedActiveVersionId: s.predecessorId, reason: "replaced", revokedAt: new Date().toISOString(), actor: null }, "third-party-revoke")).toMatchObject({ ok: true });
    expect(await s.a.beacon.getBeacon(s.a.beaconId)).toMatchObject({ ok: true, value: { drafts: { [s.request.binding.draftId]: { status: "open" } } } });
    const before = await s.versions();
    expect(await s.f.runtime.reviewComparison(requestId)).toMatchObject({ ok: false });
    expect(await createHostConsentRuntime({ home: s.f.home, cwd: s.f.cwd, projectId }).resumeClaim(requestId)).toMatchObject({ ok: false });
    expect(await s.versions()).toEqual(before);
    expect(await s.a.beacon.getActiveVersion(s.a.beaconId)).toMatchObject({ ok: true, value: null });
  });

  it("reviews the committed predecessor after an active-pointer crash and resumes without another version", async () => {
    const s = await staleClaim();
    const crashStore = new FsBeaconStore({ projectRoot: s.f.projectRoot, hasher: new JcsSha256Hasher(), writer: new CrashAfterActiveWriter() });
    await expect(crashStore.approveDraft(s.a.beaconId, {
      draftId: s.request.binding.draftId, expectedRevision: s.request.binding.expectedRevision, reviewedHash: s.request.binding.semanticHash,
      versionId: s.command.versionId, approvedAt: s.command.approvedAt, actor: null, staleOriginAcknowledged: true,
      reviewedActiveVersionId: s.predecessorId, reviewedActiveSemanticHash: s.predecessorHash, comparisonDigest: s.request.binding.reviewed.comparisonDigest,
    }, `beacon-approve:${projectId}:${s.a.beaconId}:${requestId}`)).rejects.toThrow("crash after active swap");
    expect(await s.a.beacon.getActiveVersion(s.a.beaconId)).toMatchObject({ ok: true, value: { versionId: s.command.versionId } });
    expect(await s.a.beacon.getBeacon(s.a.beaconId)).toMatchObject({ ok: true, value: { drafts: { [s.request.binding.draftId]: { status: "open" } }, versions: { [s.predecessorId]: { status: "superseded" } } } });
    const before = await s.versions();
    expect(await s.f.runtime.reviewComparison(requestId)).toMatchObject({ ok: true, value: { ...s.comparison, alreadyCommitted: true } });
    expect(await s.a.beacon.getCommittedSemanticSnapshot(s.a.beaconId, s.predecessorId)).toMatchObject({ ok: true, value: { semanticHash: s.predecessorHash, semantics: { purpose: "Original active" } } });
    expect(await createHostConsentRuntime({ home: s.f.home, cwd: s.f.cwd, projectId }).resumeClaim(requestId)).toMatchObject({ ok: true, value: { versionId: s.command.versionId } });
    expect(await s.versions()).toEqual(before);
    expect(await s.a.store.getChallenge(requestId, Date.now())).toMatchObject({ ok: true, value: { status: "consumed" } });
  });
  it("reviews a persisted v2 no-active projection and refuses missing comparison material", async () => {
    const f = await fixture();
    const a = await seedApproval(f);
    if (a.request.binding.action !== "approve") throw new Error("expected approval fixture");
    const binding = { ...a.request.binding, staleOriginAcknowledged: true, reviewed: { activeVersionId: null, activeSemanticHash: null, comparisonDigest: staleComparisonDigest(a.request.binding.semanticHash, null, null)! } } as const;
    const request: ConsentRequestV2 = { contract: "pharos.operator-consent-request/2", binding, challengeId: a.request.challengeId, expiresAtEpochMs: a.request.expiresAtEpochMs };
    expect(await a.store.createChallenge(request, Date.now())).toMatchObject({ ok: true });
    expect(await f.runtime.reviewComparison(requestId)).toMatchObject({ ok: true, value: { active: null, activeVersionId: null, draft: { purpose: "Renew" } } });
    const invalidId = "req_018f47de-7a00-7cc0-8000-000000000099";
    expect(await f.runtime.reviewComparison(invalidId)).toMatchObject({ ok: false });
    const keys = generateKeyPairSync("ed25519");
    const unsigned = { contract: "pharos.operator-consent-grant/2" as const, binding, decision: "granted" as const, challengeId: request.challengeId, expiresAtEpochMs: request.expiresAtEpochMs, hostId: "host_1", keyId: "key_1", algorithm: "ed25519" as const };
    expect(canonicalConsentGrantPayloadV2(unsigned)).not.toEqual(canonicalConsentGrantPayload(unsigned as never));
    expect(sign(null, canonicalConsentGrantPayloadV2(unsigned)!, keys.privateKey)).toHaveLength(64);
  });

  it("refuses pending, declined, legacy and generic verified claims through both recovery APIs", async () => {
    for (const state of ["pending", "declined", "legacy", "generic"] as const) {
      const f = await fixture();
      const a = await seedApproval(f);
      expect(await a.store.createChallenge(a.request, Date.now())).toMatchObject({ ok: true });
      if (state === "declined") expect(await a.store.decline(requestId, "no", Date.now())).toMatchObject({ ok: true });
      if (state === "legacy") expect(await a.store.beginConsumption(requestId, a.hash, Date.now())).toMatchObject({ ok: true });
      if (state === "generic") expect(await a.store.beginVerifiedConsumption(requestId, a.hash, a.grant, Date.now())).toMatchObject({ ok: true });
      const restarted = createHostConsentRuntime({ home: f.home, cwd: f.cwd, projectId });
      for (const result of [await restarted.inspectRecovery(requestId), await restarted.resumeClaim(requestId)]) {
        expect(result).toEqual({ ok: false, error: { rule: "consent-not-claimed" } });
        expect(JSON.stringify(result)).not.toContain(a.grant.signature);
      }
      expect(await a.beacon.getActiveVersion(a.beaconId)).toMatchObject({ ok: true, value: null });
    }
  });

  it("resumes a durable verified approval once after restart and replays without signed material", async () => {
    const f = await fixture();
    const a = await seedApproval(f);
    expect(await f.runtime.register("host_1", "key_1", a.publicKey)).toMatchObject({ ok: true });
    expect(await a.store.createChallenge(a.request, Date.now())).toMatchObject({ ok: true });
    expect(await a.store.beginVerifiedApproval(requestId, a.hash, a.grant, a.command, Date.now())).toMatchObject({ ok: true, value: { status: "claimed" } });
    const restarted = createHostConsentRuntime({ home: f.home, cwd: f.cwd, projectId });
    expect(await restarted.inspectRecovery(requestId)).toEqual({ ok: true, value: { request: a.request, auditId: `consent:${requestId}` } });
    const first = await restarted.resumeClaim(requestId);
    expect(first).toMatchObject({ ok: true, value: { status: "active", versionId: a.command.versionId } });
    expect(await createHostConsentRuntime({ home: f.home, cwd: f.cwd, projectId }).resumeClaim(requestId)).toEqual(first);
    expect(await a.beacon.getActiveVersion(a.beaconId)).toMatchObject({ ok: true, value: { versionId: a.command.versionId } });
    expect(await a.store.getChallenge(requestId, Date.now())).toMatchObject({ ok: true, value: { status: "consumed" } });
    for (const result of [first, await restarted.inspectRecovery(requestId), await a.store.getChallenge(requestId, Date.now())]) {
      expect(JSON.stringify(result)).not.toContain(a.grant.signature);
      expect(JSON.stringify(result)).not.toContain('"grant"');
    }
  });

  it("recovers an already verified approval after rotating away its signer", async () => {
    const f = await fixture();
    const a = await seedApproval(f);
    await f.runtime.register("host_1", "key_1", a.publicKey);
    await a.store.createChallenge(a.request, Date.now());
    expect(await a.store.beginVerifiedApproval(requestId, a.hash, a.grant, a.command, Date.now())).toMatchObject({ ok: true });
    const replacement = generateKeyPairSync("ed25519").publicKey.export({ format: "der", type: "spki" }).toString("base64");
    expect(await f.runtime.rotate({ hostId: "host_1", expectedKeyId: "key_1", expectedRevision: 0, nextKeyId: "key_2", nextPublicKey: replacement })).toMatchObject({ ok: true });
    expect(await f.runtime.trustState("host_1")).toMatchObject({ ok: true, value: { activeKeyId: "key_2", retiredKeyIds: ["key_1"] } });
    const restarted = createHostConsentRuntime({ home: f.home, cwd: f.cwd, projectId });
    expect(await restarted.resumeClaim(requestId)).toMatchObject({ ok: true, value: { status: "active", versionId: a.command.versionId } });
    expect(JSON.stringify(await restarted.resumeClaim(requestId))).not.toContain(a.grant.signature);
  });

  it("refuses a corrupted durable approval claim without mutating authority", async () => {
    const f = await fixture();
    const a = await seedApproval(f);
    await a.store.createChallenge(a.request, Date.now());
    await a.store.beginVerifiedApproval(requestId, a.hash, a.grant, a.command, Date.now());
    const path = join(f.projectRoot, "consent", "claims", `${requestId}.json`);
    const record = JSON.parse(await readFile(path, "utf8")) as { actionHash: string };
    await writeFile(path, JSON.stringify({ ...record, actionHash: "sha256:conflict" }), { mode: 0o600 });
    const restarted = createHostConsentRuntime({ home: f.home, cwd: f.cwd, projectId });
    expect(await restarted.inspectRecovery(requestId)).toEqual({ ok: false, error: { rule: "consent-refused" } });
    expect(await restarted.resumeClaim(requestId)).toEqual({ ok: false, error: { rule: "consent-refused" } });
    expect(await a.beacon.getActiveVersion(a.beaconId)).toMatchObject({ ok: true, value: null });
  });
  it("requires cwd association even with an explicit valid project ID, before registration or inspection", async () => {
    const { home, unassociated, publicKey } = await fixture();
    const runtime = createHostConsentRuntime({ home, cwd: unassociated, projectId });
    expect(await runtime.register("host_1", "key_1", publicKey)).toEqual({ ok: false, error: { rule: "project-unavailable" } });
    expect(await runtime.inspect(requestId)).toEqual({ ok: false, error: { rule: "project-unavailable" } });
    expect(await runtime.complete(requestId, {} as ConsentGrant)).toEqual({ ok: false, error: { rule: "project-unavailable" } });
  });
  it("rejects a different explicit project before trust registration", async () => {
    const { home, cwd, publicKey } = await fixture();
    const runtime = createHostConsentRuntime({ home, cwd, projectId: otherId });
    expect(await runtime.register("host_1", "key_1", publicKey)).toEqual({ ok: false, error: { rule: "project-unavailable" } });
  });
  it("routes a signed claimed revocation after restart and refuses altered grant bindings", async () => {
    const { home, cwd, runtime, publicKey, request, grant, projectRoot } = await fixture();
    expect(await runtime.register("host_1", "key_1", publicKey)).toMatchObject({ ok: true });
    const beacon = new FsBeaconStore({ projectRoot, hasher: new JcsSha256Hasher() });
    const beaconId = "bcn_018f47de-7a00-7cc0-8000-000000000001" as const;
    const draftId = "drf_018f47de-7a00-7cc0-8000-000000000001" as const;
    const content = { purpose: "Renew", actor: { type: "user" }, entryPoint: { path: "/checkout" }, actions: [], readinessIntent: { sideEffectClass: "stateless" } } as const;
    expect(await beacon.createDraft(beaconId, { draftId, label: "Renew", beaconTitle: "Renew", origin: { branchedFromVersion: null, branchedFromHash: null, forkedFromDraft: null }, content }, "seed-draft")).toMatchObject({ ok: true });
    expect(await beacon.approveDraft(beaconId, { draftId, expectedRevision: 1, reviewedHash: new JcsSha256Hasher().hash(project(content)), versionId: request.binding.action === "revoke" ? request.binding.expectedActiveVersion : "", approvedAt: new Date().toISOString(), actor: "operator", staleOriginAcknowledged: false }, "seed-approval")).toMatchObject({ ok: true });
    const store = new FsConsentStore({ projectRoot });
    expect(await store.createChallenge(request, Date.now())).toMatchObject({ ok: true });
    const restarted = createHostConsentRuntime({ home, cwd, projectId });
    const actionHash = store.actionHash(request);
    const command = { expectedActiveVersionId: request.binding.action === "revoke" ? request.binding.expectedActiveVersion : "", reason: "withdrawn", revokedAt: new Date().toISOString(), actor: null, bindingHash: actionHash };
    const trusted = new FsConsentStore({ projectRoot, activeHostKey: async () => Buffer.from(publicKey, "base64") });
    expect(await trusted.beginVerifiedRevocation(requestId, actionHash, grant, command, Date.now())).toMatchObject({ ok: true, value: { status: "claimed" } });
    expect(await restarted.inspectRecovery(requestId)).toEqual({ ok: true, value: { request, auditId: `consent:${requestId}` } });
    expect(JSON.stringify(await restarted.inspectRecovery(requestId))).not.toContain(grant.signature);
    const resumed = await restarted.resumeClaim(requestId);
    expect(resumed).toMatchObject({ ok: true, value: { status: "revoked" } });
    expect(JSON.stringify(resumed)).not.toContain(grant.signature);
    expect(await restarted.resumeClaim(requestId)).toEqual(resumed);
    expect(await createHostConsentRuntime({ home, cwd: join(home, "missing"), projectId }).resumeClaim(requestId)).toEqual({ ok: false, error: { rule: "project-unavailable" } });
    for (const altered of [{ ...grant, binding: { ...grant.binding, requestId: "req_other" } }, { ...grant, binding: { ...grant.binding, projectId: otherId } }, { ...grant, binding: { ...grant.binding, action: "approve" } }]) {
      expect(await restarted.complete(requestId, altered as ConsentGrant)).toMatchObject({ ok: false });
    }
    expect(await beacon.getActiveVersion(beaconId)).toMatchObject({ ok: true, value: null });
    const first = await restarted.complete(requestId, grant);
    expect(first).toMatchObject({ ok: true, value: { status: "revoked" } });
    expect(await beacon.getActiveVersion(beaconId)).toMatchObject({ ok: true, value: null });
    expect(await createHostConsentRuntime({ home, cwd, projectId }).complete(requestId, grant)).toEqual(first);
    expect(await store.getChallenge(requestId, Date.now())).toMatchObject({ ok: true, value: { status: "consumed" } });
  });
  it("contains exceptions while resolving project scope with a fixed refusal", async () => {
    const runtime = createHostConsentRuntime({ home: {} as string });
    const result = await runtime.inspect("req_missing");
    expect(result).toEqual({ ok: false, error: { rule: "project-unavailable" } });
    expect(JSON.stringify(result)).not.toContain("TypeError");
  });
  it("refuses a missing canonical project rather than accepting a caller verdict", async () => {
    const runtime = createHostConsentRuntime({ home: "/nonexistent-pharos-home", cwd: "/nonexistent-project" });
    expect(await runtime.inspect("req_missing")).toEqual({ ok: false, error: { rule: "project-unavailable" } });
  });
});
