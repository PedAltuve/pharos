import { describe, expect, it } from "vitest";
import type { ConsentGrant, ConsentStoreRecord, OperatorConsentStore, VerifiedRevokeCommand } from "../../src/domain/ports/operator-consent.js";
import { RevokeActiveBeacon } from "../../src/application/revoke-active-beacon.js";
import type { ActiveVersion, Beacon } from "../../src/domain/beacon/index.js";
import type { JsonValue } from "../../src/domain/ports/json-value.js";
import type { BeaconStore } from "../../src/domain/ports/index.js";
import { err, ok } from "../../src/shared/result.js";

const beaconId = "bcn_018f47de-7a00-7cc0-8000-000000000001" as const;
const versionId = "ver_018f47de-7a00-7cc0-8000-000000000001";
const timestamp = "2026-03-06T00:00:00.000Z";

const active: ActiveVersion = {
  status: "active",
  versionId,
  localNumber: 1,
  approval: {
    approvedAt: "2026-03-05T00:00:00.000Z",
    reviewedHash: "sha256:semantic",
    staleOriginAcknowledged: false,
    assurance: "operator_confirmed",
    actor: "operator_1",
  },
  provenance: {
    approvedDraftId: "drf_018f47de-7a00-7cc0-8000-000000000001",
    approvedRevision: 1,
    branchedFromVersion: null,
    branchedFromHash: null,
  },
};

function dependencies() {
  let revocations = 0;
  const commands: unknown[] = [];
  let replay: Beacon | undefined;
  const store: BeaconStore & {
    readonly revokeActiveVersion: NonNullable<BeaconStore["revokeActiveVersion"]>;
  } = {
    async getBeacon() { throw new Error("not applicable"); },
    async listBeacons() { return ok([]); },
    async getActiveVersion() { throw new Error("active state must be prepared before this use case"); },
    async createDraft() { throw new Error("not applicable"); },
    async updateDraft() { throw new Error("not applicable"); },
    async forkDraft() { throw new Error("not applicable"); },
    async abandonDraft() { throw new Error("not applicable"); },
    async approveDraft() { throw new Error("not applicable"); },
    async revokeVersion() { throw new Error("active-only revocation is required"); },
    async revokeActiveVersion(_beaconId, proposed) {
      revocations += 1;
      commands.push(proposed);
      if (proposed.expectedActiveVersionId === null) {
        return err({ rule: "active-version-not-found", beaconId });
      }
      if (replay !== undefined) return ok(replay);
      replay = {
        beaconId,
        title: "Renew checkout",
        drafts: {},
        activeVersionId: null,
        versions: {
          [proposed.expectedActiveVersionId]: {
            ...active,
            status: "revoked",
            previousStatus: "active",
            revocation: {
              revokedAt: proposed.revokedAt,
              reason: proposed.reason,
              actor: proposed.actor,
            },
          },
        },
      };
      return ok(replay);
    },
  };
  return {
    store,
    useCase: new RevokeActiveBeacon({
      clock: { now: () => new Date(timestamp) },
      beaconStore: store,
    }),
    revocations: () => revocations,
    commands: () => commands,
  };
}

const request = {
  beaconId,
  requestId: "req_018f47de-7a00-7cc0-8000-000000000002" as const,
  expectedActiveVersionId: versionId,
  reason: "  Recalled by operator  ",
  actor: "operator_1",
};

describe("RevokeActiveBeacon", () => {
  it("accepts reordered signed binding but refuses changed binding before mutation", async () => {
    const configured = dependencies();
    const binding = { action: "revoke" as const, projectId: "proj_1", beaconId, expectedActiveVersion: versionId, reason: "Recalled", requestId: request.requestId };
    const grant: ConsentGrant = { contract: "pharos.operator-consent-grant/1", decision: "granted", binding: { requestId: binding.requestId, reason: binding.reason, expectedActiveVersion: binding.expectedActiveVersion, beaconId: binding.beaconId, projectId: binding.projectId, action: binding.action }, challengeId: "challenge", expiresAtEpochMs: Date.parse(timestamp) + 60000, hostId: "host", keyId: "key", algorithm: "ed25519", signature: "signed" };
    const persisted = { contract: "pharos.operator-consent-request/1" as const, binding, challengeId: grant.challengeId, expiresAtEpochMs: grant.expiresAtEpochMs };
    let begins = 0;
    const consentStore = { actionHash: (value: typeof persisted) => JSON.stringify(Object.entries(value.binding).sort()), getChallenge: async () => ok({ status: "pending" as const, request: persisted, auditId: "audit" }), beginVerifiedRevocation: async () => { begins++; return err({ rule: "consent-consumption-conflict" as const, requestId: request.requestId }); } } as unknown as OperatorConsentStore;
    const useCase = new RevokeActiveBeacon({ clock: { now: () => new Date(timestamp) }, beaconStore: configured.store, consentStore, canonicalProjectId: "proj_1" });
    expect(await useCase.completeConsent({ requestId: request.requestId, grant })).toMatchObject({ ok: false });
    expect(begins).toBe(1);
    expect(await useCase.completeConsent({ requestId: request.requestId, grant: { ...grant, binding: { ...binding, reason: "Changed" } } })).toMatchObject({ ok: false, error: { rule: "consent-consumption-conflict" } });
    expect(begins).toBe(1);
    expect(configured.revocations()).toBe(0);
  });
  it("requires a verified claim and completes its immutable revocation command", async () => {
    const configured = dependencies();
    const binding = { action: "revoke" as const, projectId: "proj_1", beaconId, expectedActiveVersion: versionId, reason: "Recalled", requestId: request.requestId };
    const grant: ConsentGrant = { contract: "pharos.operator-consent-grant/1", decision: "granted", binding, challengeId: "challenge", expiresAtEpochMs: Date.parse(timestamp) + 60000, hostId: "host", keyId: "key", algorithm: "ed25519", signature: "signed" };
    const signedRequest = { contract: "pharos.operator-consent-request/1" as const, binding, challengeId: grant.challengeId, expiresAtEpochMs: grant.expiresAtEpochMs };
    let record: ConsentStoreRecord = { status: "pending", request: signedRequest, auditId: "audit" };
    let begins = 0;
    const consentStore = {
      actionHash: () => "hash",
      getChallenge: async () => ok(record),
      beginVerifiedRevocation: async (_id: string, hash: string, _grant: ConsentGrant, command: VerifiedRevokeCommand) => {
        begins++;
        if (hash !== "hash" || JSON.stringify(_grant) !== JSON.stringify(grant)) return err({ rule: "consent-consumption-conflict", requestId: request.requestId });
        if (record.status === "consumed") return ok(record);
        record = { status: "claimed", provenance: "verified", actionHash: hash, revokeCommand: command, requestId: request.requestId, auditId: "audit" };
        return ok(record);
      },
      completeVerifiedConsumption: async (_id: string, _hash: string, result: JsonValue) => {
        record = { status: "consumed", provenance: "verified", requestId: request.requestId, auditId: "audit", actionHash: "hash", revokeCommand: record.status === "claimed" ? record.revokeCommand : undefined, result };
        return ok(record);
      },
    } as unknown as OperatorConsentStore;
    const useCase = new RevokeActiveBeacon({ clock: { now: () => new Date(timestamp) }, beaconStore: configured.store, consentStore, canonicalProjectId: "proj_1" });
    expect(await useCase.completeConsent({ requestId: request.requestId, grant })).toEqual({ ok: true, value: { beaconId, versionId, status: "revoked", reason: "Recalled" } });
    expect(configured.commands()).toEqual([{ expectedActiveVersionId: versionId, reason: "Recalled", actor: null, revokedAt: timestamp }]);
    expect(await useCase.completeConsent({ requestId: request.requestId, grant })).toEqual({ ok: true, value: { beaconId, versionId, status: "revoked", reason: "Recalled" } });
    expect(begins).toBe(2);
    expect(configured.revocations()).toBe(1);
    expect(await useCase.completeConsent({ requestId: request.requestId, grant: { ...grant, binding: { ...binding, reason: "Changed" } } })).toEqual({ ok: false, error: { rule: "consent-consumption-conflict", requestId: request.requestId } });
    expect(configured.revocations()).toBe(1);
  });
  it("prepares a canonical active-version request and replays it without rotating the issuer", async () => {
    const configured = dependencies();
    let issued = 0;
    let saved: import("../../src/domain/ports/operator-consent.js").ConsentRequest | undefined;
    const consentStore = {
      getChallenge: async () => ok(saved ? { status: "pending" as const, request: saved, auditId: "audit" } : undefined),
      createChallenge: async (value: typeof saved) => {
        saved = value;
        return ok({ status: "pending" as const, request: value!, auditId: "audit" });
      },
    } as unknown as OperatorConsentStore;
    const useCase = new RevokeActiveBeacon({
      clock: { now: () => new Date(timestamp) },
      beaconStore: { ...configured.store, getActiveVersion: async () => ok(active) },
      consentStore,
      canonicalProjectId: "proj_018f47de-7a00-7cc0-8000-000000000001",
      issueChallenge: () => ({ challengeId: `challenge-${++issued}`, expiresAtEpochMs: Date.parse(timestamp) + 60000 }),
    });
    const input = { projectId: "proj_018f47de-7a00-7cc0-8000-000000000001" as const, beaconId, requestId: request.requestId, reason: "  Recalled by operator  " };
    const first = await useCase.prepareConsent(input);
    expect(first).toEqual({ ok: true, value: { request: { contract: "pharos.operator-consent-request/1", binding: { action: "revoke", projectId: "proj_018f47de-7a00-7cc0-8000-000000000001", beaconId, expectedActiveVersion: versionId, reason: "Recalled by operator", requestId: request.requestId }, challengeId: "challenge-1", expiresAtEpochMs: Date.parse(timestamp) + 60000 }, auditId: "audit" } });
    expect(await useCase.prepareConsent(input)).toEqual(first);
    expect(issued).toBe(1);
    expect(configured.revocations()).toBe(0);
    expect(await useCase.prepareConsent({ ...input, reason: "Changed" })).toEqual({ ok: false, error: { rule: "consent-request-conflict", requestId: request.requestId } });
  });
  it("uses the prepared active snapshot without a mutable active read", async () => {
    const configured = dependencies();

    await expect(configured.useCase.execute(request)).resolves.toEqual({
      ok: true,
      value: { beaconId, versionId, status: "revoked", reason: "Recalled by operator" },
    });
    expect(configured.commands()).toEqual([expect.objectContaining({
      expectedActiveVersionId: versionId,
      reason: "Recalled by operator",
      actor: "operator_1",
      revokedAt: timestamp,
    })]);
  });

  it("replays the same prepared request after active state disappears", async () => {
    const configured = dependencies();

    const first = await configured.useCase.execute(request);
    const replay = await configured.useCase.execute(request);

    expect(first).toEqual(replay);
    expect(replay).toEqual({
      ok: true,
      value: { beaconId, versionId, status: "revoked", reason: "Recalled by operator" },
    });
    expect(configured.revocations()).toBe(2);
  });

  it.each(["", "   ", "\n\t"])("refuses an empty reason %j without mutating lifecycle state", async (reason) => {
    const configured = dependencies();

    await expect(configured.useCase.execute({ ...request, reason })).resolves.toEqual({
      ok: false,
      error: { rule: "invalid-revocation-reason" },
    });
    expect(configured.revocations()).toBe(0);
  });

  it("delegates a prepared null snapshot to locked active-only validation", async () => {
    const configured = dependencies();

    await expect(configured.useCase.execute({ ...request, expectedActiveVersionId: null })).resolves.toEqual({
      ok: false,
      error: { rule: "active-version-not-found", beaconId },
    });
    expect(configured.revocations()).toBe(1);
  });
});
