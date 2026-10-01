import { describe, expect, it } from "vitest";
import { ApproveBeaconDraft } from "../../src/application/approve-beacon-draft.js";
import type { Beacon } from "../../src/domain/beacon/index.js";
import type { CaptureBeaconAssociation, CaptureSession } from "../../src/domain/capture/index.js";
import type { BeaconStore, CaptureStore, Hasher, IdGenerator } from "../../src/domain/ports/index.js";
import type { ConsentRequest, OperatorConsentStore } from "../../src/domain/ports/operator-consent.js";
import { err, ok } from "../../src/shared/result.js";

const projectId = "proj_018f47de-7a00-7cc0-8000-000000000001" as const;
const captureId = "cap_018f47de-7a00-7cc0-8000-000000000001" as const;
const beaconId = "bcn_018f47de-7a00-7cc0-8000-000000000001" as const;
const draftId = "drf_018f47de-7a00-7cc0-8000-000000000001" as const;
const versionId = "ver_018f47de-7a00-7cc0-8000-000000000001";
const semanticHash = "sha256:semantic";
const timestamp = "2026-03-05T00:00:00.000Z";
const content = { purpose: "Renew", actor: { type: "guest", identityRef: null }, entryPoint: { path: "/checkout", query: null, fragment: null }, actions: [{ action: "continue_checkout", target: null, value: null }], checkpoints: { ordered: true, entries: [{ id: "checkout_open", afterAction: null, expectations: { visible: true } }] }, variables: [], outcomes: [{ id: "renewed", description: null }], allowedVariation: [], prohibitedRegressions: [{ id: "no_double_charge", description: null }], readinessIntent: { sideEffectClass: "stateless", isolation: null } } as const;

function association(overrides: Partial<CaptureBeaconAssociation> = {}): CaptureBeaconAssociation {
  return { contract: "pharos.capture-beacon-association/1", state: "committed", projectId, captureId, requestId: "req_018f47de-7a00-7cc0-8000-000000000001", inputHash: "input", beaconId, draftId, revision: 1, semanticHash, createdAt: timestamp, committedAt: timestamp, ...overrides };
}

function openDraft(id: `drf_${string}` = draftId) {
  return { status: "open" as const, draftId: id, label: "Renew checkout", revision: 1, origin: { branchedFromVersion: null, branchedFromHash: null, forkedFromDraft: null }, content };
}

function beacon(drafts: Beacon["drafts"] = { [draftId]: openDraft() }): Beacon {
  return { beaconId, title: "Renew checkout", drafts, versions: {}, activeVersionId: null };
}

function dependencies(options: { readonly association?: CaptureBeaconAssociation | null; readonly aggregate?: Beacon; readonly hash?: string; readonly replayKey?: string } = {}) {
  let approvals = 0;
  let command: unknown;
  let key: string | undefined;
  const captureStore: CaptureStore = {
    async getAssociationByBeacon() { return ok(options.association === undefined ? association() : options.association); },
    async getSession() { return ok({ contract: "pharos.capture-session/2", projectId, captureId, requestId: "req_018f47de-7a00-7cc0-8000-000000000001", inputHash: "capture", secretSourceReferences: [], createdAt: timestamp, status: "promoted", artifact: { reference: "captures/recording.spec.ts", byteSize: 1, sha256: "a".repeat(64) }, completedAt: timestamp } as CaptureSession); },
    async beginLaunch() { return err({ rule: "capture-not-found", captureId }); }, async recordRecorderStarted() { return err({ rule: "capture-not-found", captureId }); }, async markPostExit() { return err({ rule: "capture-not-found", captureId }); }, async resolve() { return err({ rule: "capture-not-found", captureId }); }, async recoverProject() { return ok({ recovered: [], blocked: [] }); }, async claimAnnotation() { return err({ rule: "capture-not-found", captureId }); }, async commitAssociation() { return err({ rule: "capture-not-found", captureId }); }, async getAssociationByCapture() { return ok(null); },
  };
  const beaconStore: BeaconStore = {
    async getBeacon() { return ok(options.aggregate ?? beacon()); }, async listBeacons() { return ok([]); }, async getActiveVersion() { return ok(null); },
    async createDraft() { return err({ rule: "beacon-not-found", beaconId }); }, async updateDraft() { return err({ rule: "beacon-not-found", beaconId }); }, async forkDraft() { return err({ rule: "beacon-not-found", beaconId }); }, async abandonDraft() { return err({ rule: "beacon-not-found", beaconId }); },
    async approveDraft(_beaconId, proposed, requestKey) {
      approvals += 1;
      command = proposed;
      key = requestKey;
      const current = options.aggregate ?? beacon();
      const draft = current.drafts[proposed.draftId];
      if (draft?.status === "closed") {
        if (requestKey === options.replayKey) return ok(current);
        return err({ rule: "draft-not-open", draftId: proposed.draftId, status: "closed" });
      }
      if (draft === undefined || draft.status !== "open") return err({ rule: "draft-not-found", draftId: proposed.draftId });
      if (Object.values(current.drafts).filter((candidate) => candidate.status === "open").length !== 1) {
        return err({ rule: "ambiguous-open-drafts", beaconId });
      }
      return ok({ ...current, drafts: { ...current.drafts, [draft.draftId]: { ...draft, status: "closed" as const, approvedVersionId: proposed.versionId, closedAt: proposed.approvedAt } }, versions: { ...current.versions, [proposed.versionId]: { status: "active" as const, versionId: proposed.versionId, localNumber: 1, approval: { approvedAt: proposed.approvedAt, reviewedHash: proposed.reviewedHash, staleOriginAcknowledged: proposed.staleOriginAcknowledged, assurance: "operator_confirmed" as const, actor: proposed.actor }, provenance: { approvedDraftId: proposed.draftId, approvedRevision: draft.revision, branchedFromVersion: null, branchedFromHash: null } } }, activeVersionId: proposed.versionId });
    },
    async revokeVersion() { return err({ rule: "beacon-not-found", beaconId }); },
  };
  return { captureStore, beaconStore, useCase: new ApproveBeaconDraft({ clock: { now: () => new Date(timestamp) }, ids: { next: () => versionId } as IdGenerator, hasher: { hash: () => options.hash ?? semanticHash } as Hasher, captureStore, beaconStore }), approvals: () => approvals, command: () => command, key: () => key };
}

const request = { projectId, beaconId, requestId: "req_018f47de-7a00-7cc0-8000-000000000002" as const, reviewedHash: semanticHash, operatorConfirmed: true, actor: "operator_1" };

describe("ApproveBeaconDraft", () => {
  it("accepts reordered signed approval binding but refuses changed binding before mutation", async () => {
    const configured = dependencies();
    const binding = { action: "approve" as const, projectId, beaconId, draftId, expectedRevision: 1, semanticHash, requestId: request.requestId };
    const grant = { contract: "pharos.operator-consent-grant/1" as const, decision: "granted" as const, binding: { requestId: binding.requestId, semanticHash, expectedRevision: 1, draftId, beaconId, projectId, action: binding.action }, challengeId: "host", expiresAtEpochMs: Date.parse(timestamp) + 60000, hostId: "host", keyId: "key", algorithm: "ed25519" as const, signature: "signed" };
    const persisted = { contract: "pharos.operator-consent-request/1" as const, binding, challengeId: grant.challengeId, expiresAtEpochMs: grant.expiresAtEpochMs };
    let begins = 0;
    const store = { actionHash: (value: typeof persisted) => JSON.stringify(Object.entries(value.binding).sort()), async getChallenge() { return ok({ status: "pending" as const, request: persisted, auditId: "audit" }); }, async beginVerifiedApproval() { begins++; return err({ rule: "consent-consumption-conflict" as const, requestId: request.requestId }); } } as unknown as OperatorConsentStore;
    const useCase = new ApproveBeaconDraft({ clock: { now: () => new Date(timestamp) }, ids: { next: () => versionId }, hasher: { hash: () => semanticHash }, captureStore: configured.captureStore, beaconStore: configured.beaconStore, consentStore: store });
    expect(await useCase.completeConsent({ requestId: request.requestId, grant })).toMatchObject({ ok: false });
    expect(begins).toBe(1);
    expect(await useCase.completeConsent({ requestId: request.requestId, grant: { ...grant, binding: { ...grant.binding, semanticHash: "changed" } } })).toMatchObject({ ok: false, error: { rule: "consent-consumption-conflict" } });
    expect(begins).toBe(1);
    expect(configured.approvals()).toBe(0);
  });
  it("prepares only the canonical approval binding and persists a host-fresh challenge", async () => {
    const configured = dependencies();
    let stored: ConsentRequest | undefined;
    const consentStore = {
      async getChallenge() { return ok(undefined); },
      async createChallenge(value: ConsentRequest) {
        stored = value;
        return ok({ status: "pending" as const, request: value, auditId: "audit" });
      },
    } as unknown as OperatorConsentStore;
    const preparation = new ApproveBeaconDraft({
      clock: { now: () => new Date(timestamp) }, ids: { next: () => versionId },
      hasher: { hash: () => semanticHash },
      captureStore: configured.captureStore,
      beaconStore: configured.beaconStore,
      consentStore,
      issueChallenge: () => ({ challengeId: "host-challenge", expiresAtEpochMs: Date.parse(timestamp) + 60_000 }),
    });
    const result = await preparation.prepareConsent({ projectId, beaconId, requestId: request.requestId });
    expect(result).toMatchObject({ ok: true, value: { request: { binding: { action: "approve", projectId, beaconId, draftId, expectedRevision: 1, semanticHash, requestId: request.requestId }, challengeId: "host-challenge" } } });
    expect(stored).toMatchObject({ binding: { semanticHash, draftId } });
    expect(configured.approvals()).toBe(0);
  });
  it("resolves concurrent missed lookups to the original pending challenge", async () => {
    const configured = dependencies();
    let stored: ConsentRequest | undefined;
    let arrivals = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const consentStore = {
      async getChallenge() {
        if (++arrivals <= 2) {
          if (arrivals === 2) release();
          await barrier;
          return ok(undefined);
        }
        return ok(stored === undefined ? undefined : { status: "pending" as const, request: stored, auditId: "original-audit" });
      },
      async createChallenge(value: ConsentRequest) {
        if (stored !== undefined) return err({ rule: "consent-request-conflict" as const, requestId: request.requestId });
        stored = value;
        return ok({ status: "pending" as const, request: value, auditId: "original-audit" });
      },
    } as unknown as OperatorConsentStore;
    let issued = 0;
    const preparation = new ApproveBeaconDraft({
      clock: { now: () => new Date(timestamp) }, ids: { next: () => versionId }, hasher: { hash: () => semanticHash },
      captureStore: configured.captureStore, beaconStore: configured.beaconStore, consentStore,
      issueChallenge: () => ({ challengeId: `distinct-${++issued}`, expiresAtEpochMs: Date.parse(timestamp) + 60_000 }),
    });
    const input = { projectId, beaconId, requestId: request.requestId };
    const [first, second] = await Promise.all([preparation.prepareConsent(input), preparation.prepareConsent(input)]);
    expect(issued).toBe(2);
    expect(first).toMatchObject({ ok: true, value: { auditId: "original-audit" } });
    expect(second).toEqual(first);
    expect(configured.approvals()).toBe(0);
  });
  it("replays a pending challenge despite issuer rotation, but conflicts on changed binding", async () => {
    const configured = dependencies();
    let stored: ConsentRequest | undefined;
    let issued = 0;
    let changed = false;
    const consentStore = {
      async getChallenge() { return ok(stored === undefined ? undefined : { status: "pending" as const, request: stored, auditId: "audit" }); },
      async createChallenge(value: ConsentRequest) { stored = value; return ok({ status: "pending" as const, request: value, auditId: "audit" }); },
    } as unknown as OperatorConsentStore;
    const preparation = new ApproveBeaconDraft({
      clock: { now: () => new Date(timestamp) }, ids: { next: () => versionId }, hasher: { hash: () => semanticHash },
      captureStore: configured.captureStore,
      beaconStore: { ...configured.beaconStore, async getBeacon(id) {
        const result = await configured.beaconStore.getBeacon(id);
        if (result.ok && changed) return ok({ ...result.value, drafts: { ...result.value.drafts, [draftId]: { ...result.value.drafts[draftId]!, revision: 2 } } });
        return result;
      } },
      consentStore,
      issueChallenge: () => ({ challengeId: `rotated-${++issued}`, expiresAtEpochMs: Date.parse(timestamp) + 60_000 }),
    });
    const input = { projectId, beaconId, requestId: request.requestId };
    const first = await preparation.prepareConsent(input);
    expect(first).toMatchObject({ ok: true, value: { request: { challengeId: "rotated-1" } } });
    expect(await preparation.prepareConsent(input)).toEqual(first);
    expect(issued).toBe(1);
    changed = true;
    expect(await preparation.prepareConsent(input)).toMatchObject({ ok: false });
    expect(issued).toBe(1);
  });
  it("refuses a challenge that expires during canonical reads without persisting or approving", async () => {
    const configured = dependencies();
    let reads = 0;
    let writes = 0;
    const preparation = new ApproveBeaconDraft({
      clock: { now: () => new Date(Date.parse(timestamp) + (reads > 0 ? 61_000 : 0)) },
      ids: { next: () => versionId }, hasher: { hash: () => semanticHash },
      captureStore: { ...configured.captureStore, async getAssociationByBeacon(...args) { reads++; return configured.captureStore.getAssociationByBeacon(...args); } },
      beaconStore: configured.beaconStore,
      issueChallenge: () => ({ challengeId: "host-challenge", expiresAtEpochMs: Date.parse(timestamp) + 60_000 }),
      consentStore: { async getChallenge() { return ok(undefined); }, async createChallenge() { writes++; throw new Error("must not persist"); } } as unknown as OperatorConsentStore,
    });
    await expect(preparation.prepareConsent({ projectId, beaconId, requestId: request.requestId })).resolves.toMatchObject({ ok: false, error: { rule: "invalid-consent-request" } });
    expect(writes).toBe(0);
    expect(configured.approvals()).toBe(0);
  });
  it("refuses changed canonical semantic content before persisting consent", async () => {
    const configured = dependencies({ hash: "sha256:changed" });
    let writes = 0;
    const preparation = new ApproveBeaconDraft({
      clock: { now: () => new Date(timestamp) }, ids: { next: () => versionId },
      hasher: { hash: () => "sha256:changed" }, captureStore: configured.captureStore, beaconStore: configured.beaconStore,
      issueChallenge: () => ({ challengeId: "host-challenge", expiresAtEpochMs: Date.parse(timestamp) + 60_000 }),
      consentStore: { async createChallenge() { writes++; throw new Error("must not persist"); } } as unknown as OperatorConsentStore,
    });
    await expect(preparation.prepareConsent({ projectId, beaconId, requestId: request.requestId })).resolves.toEqual({ ok: false, error: { rule: "draft-association-mismatch" } });
    expect(writes).toBe(0);
  });

  it("completes a verified approval using the durable immutable command", async () => {
    const configured = dependencies();
    const binding = { action: "approve" as const, projectId, beaconId, draftId, expectedRevision: 1, semanticHash, requestId: request.requestId };
    const grant = { binding, challengeId: "host", contract: "pharos.operator-consent-grant/1" as const, decision: "granted" as const, expiresAtEpochMs: Date.parse(timestamp) + 60000, hostId: "host", keyId: "key", algorithm: "ed25519" as const, signature: "signed" };
    const persisted = { contract: "pharos.operator-consent-request/1" as const, binding, challengeId: "host", expiresAtEpochMs: grant.expiresAtEpochMs };
    const immutable = { versionId, approvedAt: timestamp, actor: null, bindingHash: "hash" };
    let status: "pending" | "claimed" | "consumed" = "pending";
    const store = {
      actionHash(value: ConsentRequest) { expect(value).toEqual(persisted); return "hash"; },
      async getChallenge() { return ok(status === "pending" ? { status, request: persisted, auditId: "audit" } : status === "claimed" ? { status, provenance: "verified", requestId: request.requestId, actionHash: "hash", approvalCommand: immutable, auditId: "audit" } : { status, provenance: "verified", requestId: request.requestId, actionHash: "hash", approvalCommand: immutable, result: { beaconId, versionId, status: "active", semanticHash, assurance: "operator_confirmed" }, auditId: "audit" }); },
      async beginVerifiedApproval(_id: string, hash: string, signed: unknown, command: unknown) { expect(hash).toBe("hash"); expect(signed).toBe(grant); if (status !== "pending") expect(command).toEqual(immutable); status = "claimed"; return ok({ status: "claimed" as const, provenance: "verified" as const, requestId: request.requestId, actionHash: "hash", approvalCommand: immutable, auditId: "audit" }); },
      async completeVerifiedConsumption(_id: string, _hash: string, result: unknown) { status = "consumed"; return ok({ status: "consumed" as const, provenance: "verified" as const, requestId: request.requestId, actionHash: "hash", approvalCommand: immutable, result, auditId: "audit" }); },
    } as unknown as OperatorConsentStore;
    const useCase = new ApproveBeaconDraft({ clock: { now: () => new Date(timestamp) }, ids: { next: () => versionId }, hasher: { hash: () => semanticHash }, captureStore: configured.captureStore, beaconStore: configured.beaconStore, consentStore: store });
    expect(await useCase.completeConsent({ requestId: request.requestId, grant })).toMatchObject({ ok: true, value: { versionId, assurance: "operator_confirmed" } });
    expect(configured.command()).toMatchObject({ versionId, approvedAt: timestamp, actor: null });
    expect(configured.approvals()).toBe(1);
  });

  it.each(["terminal replay", "fresh completion"]) ("rejects a %s whose result version differs from the immutable command", async (scenario) => {
    const configured = dependencies();
    const binding = { action: "approve" as const, projectId, beaconId, draftId, expectedRevision: 1, semanticHash, requestId: request.requestId };
    const grant = { binding, challengeId: "host", contract: "pharos.operator-consent-grant/1" as const, decision: "granted" as const, expiresAtEpochMs: Date.parse(timestamp) + 60000, hostId: "host", keyId: "key", algorithm: "ed25519" as const, signature: "signed" };
    const immutable = { versionId, approvedAt: timestamp, actor: null, bindingHash: "hash" };
    const terminal = { status: "consumed" as const, provenance: "verified" as const, requestId: request.requestId, actionHash: "hash", approvalCommand: immutable, result: { beaconId, versionId: "ver_other", status: "active", semanticHash, assurance: "operator_confirmed" }, auditId: "audit" };
    const store = { actionHash: () => "hash", async getChallenge() { return ok(scenario === "terminal replay" ? terminal : { status: "pending", request: { contract: "pharos.operator-consent-request/1", binding, challengeId: "host", expiresAtEpochMs: grant.expiresAtEpochMs }, auditId: "audit" }); }, async beginVerifiedApproval() { return ok(scenario === "terminal replay" ? terminal : { ...terminal, status: "claimed" }); }, async completeVerifiedConsumption() { return ok(terminal); } } as unknown as OperatorConsentStore;
    const useCase = new ApproveBeaconDraft({ clock: { now: () => new Date(timestamp) }, ids: { next: () => versionId }, hasher: { hash: () => semanticHash }, captureStore: configured.captureStore, beaconStore: configured.beaconStore, consentStore: store });
    expect(await useCase.completeConsent({ requestId: request.requestId, grant })).toMatchObject({ ok: false, error: { rule: "consent-consumption-conflict" } });
    expect(configured.approvals()).toBe(scenario === "terminal replay" ? 0 : 1);
  });

  it("retries a concurrent consumed winner with its immutable command and original grant", async () => {
    const configured = dependencies();
    const binding = { action: "approve" as const, projectId, beaconId, draftId, expectedRevision: 1, semanticHash, requestId: request.requestId };
    const grant = { binding, challengeId: "host", contract: "pharos.operator-consent-grant/1" as const, decision: "granted" as const, expiresAtEpochMs: Date.parse(timestamp) + 60000, hostId: "host", keyId: "key", algorithm: "ed25519" as const, signature: "signed" };
    const immutable = { versionId, approvedAt: timestamp, actor: null, bindingHash: "hash" };
    const terminal = { status: "consumed" as const, provenance: "verified" as const, requestId: request.requestId, actionHash: "hash", approvalCommand: immutable, result: { beaconId, versionId, status: "active", semanticHash, assurance: "operator_confirmed" }, auditId: "audit" };
    let reads = 0;
    let attempts = 0;
    const store = { actionHash: () => "hash", async getChallenge() { return ok(++reads === 1 ? { status: "pending", request: { contract: "pharos.operator-consent-request/1", binding, challengeId: "host", expiresAtEpochMs: grant.expiresAtEpochMs }, auditId: "audit" } : terminal); }, async beginVerifiedApproval(_id: string, _hash: string, signed: unknown, command: unknown) { attempts++; expect(signed).toBe(grant); if (attempts === 1) return err({ rule: "consent-consumption-conflict" as const, requestId: request.requestId }); expect(command).toEqual(immutable); return ok(terminal); } } as unknown as OperatorConsentStore;
    const useCase = new ApproveBeaconDraft({ clock: { now: () => new Date(timestamp) }, ids: { next: () => versionId }, hasher: { hash: () => semanticHash }, captureStore: configured.captureStore, beaconStore: configured.beaconStore, consentStore: store });
    expect(await useCase.completeConsent({ requestId: request.requestId, grant })).toMatchObject({ ok: true, value: { versionId } });
    expect(attempts).toBe(2);
    expect(configured.approvals()).toBe(0);
  });

  it.each([null, {}, { binding: { action: "approve", requestId: request.requestId } }, { binding: { action: "approve", requestId: request.requestId, expectedRevision: 0 } }])("refuses malformed signed input without hashing or mutation: %j", async (grant) => {
    const configured = dependencies();
    let hashes = 0;
    const store = { actionHash() { hashes++; throw new Error("must not hash malformed request"); } } as unknown as OperatorConsentStore;
    const useCase = new ApproveBeaconDraft({ clock: { now: () => new Date(timestamp) }, ids: { next: () => versionId }, hasher: { hash: () => semanticHash }, captureStore: configured.captureStore, beaconStore: configured.beaconStore, consentStore: store });
    await expect(useCase.completeConsent({ requestId: request.requestId, grant: grant as never })).resolves.toMatchObject({ ok: false, error: { rule: "invalid-consent-request" } });
    expect(hashes).toBe(0);
    expect(configured.approvals()).toBe(0);
  });

  it("refuses consent completion when no verified consumption store is configured", async () => {
    const configured = dependencies();
    await expect(configured.useCase.completeConsent({ requestId: request.requestId, grant: {} as never })).resolves.toMatchObject({ ok: false });
    expect(configured.approvals()).toBe(0);
  });

  it("approves the single associated open draft with the exact recomputed hash", async () => {
    const configured = dependencies();

    await expect(configured.useCase.execute(request)).resolves.toMatchObject({ ok: true, value: { beaconId, versionId, status: "active", semanticHash, assurance: "operator_confirmed" } });
    expect(configured.approvals()).toBe(1);
    expect(configured.command()).toMatchObject({ draftId, versionId, reviewedHash: semanticHash, actor: "operator_1", staleOriginAcknowledged: false });
  });

  it("does not persist before an operator has confirmed the request", async () => {
    const configured = dependencies();

    await expect(configured.useCase.execute({ ...request, operatorConfirmed: false })).resolves.toEqual({ ok: false, error: { rule: "operator-confirmation-required" } });
    expect(configured.approvals()).toBe(0);
  });

  it("reaches the store for a committed approval replay after its associated draft is closed", async () => {
    const replayKey = `beacon-approve:${projectId}:${beaconId}:${request.requestId}`;
    const closed = beacon({ [draftId]: {
      status: "closed", draftId, label: "Renew checkout", revision: 1,
      origin: { branchedFromVersion: null, branchedFromHash: null, forkedFromDraft: null },
      approvedVersionId: versionId, closedAt: timestamp,
    } as unknown as Beacon["drafts"][string] });
    const configured = dependencies({ aggregate: { ...closed, versions: { [versionId]: { status: "active", versionId, localNumber: 1, approval: { approvedAt: timestamp, reviewedHash: semanticHash, staleOriginAcknowledged: false, assurance: "operator_confirmed", actor: "operator_1" }, provenance: { approvedDraftId: draftId, approvedRevision: 1, branchedFromVersion: null, branchedFromHash: null } } }, activeVersionId: versionId }, replayKey });

    await expect(configured.useCase.execute(request)).resolves.toMatchObject({ ok: true, value: { versionId, semanticHash } });
    await expect(configured.useCase.execute({ ...request, requestId: "req_018f47de-7a00-7cc0-8000-000000000003" })).resolves.toEqual({
      ok: false,
      error: { rule: "draft-not-open", draftId, status: "closed" },
    });
    expect(configured.approvals()).toBe(2);
    expect(configured.key()).toBe(`beacon-approve:${projectId}:${beaconId}:req_018f47de-7a00-7cc0-8000-000000000003`);
  });

  it.each([
    ["missing association", { association: null }],
    ["association hash mismatch", { hash: "sha256:changed" }],
    ["reviewed hash mismatch", { hash: semanticHash }, { ...request, reviewedHash: "sha256:reviewed" }],
    ["closed associated draft", { aggregate: beacon({ [draftId]: { ...openDraft(), status: "closed", approvedVersionId: versionId, closedAt: timestamp } }) }],
    ["absent associated draft", { aggregate: beacon({}) }],
    ["ambiguous open drafts",  { aggregate: beacon({ [draftId]: openDraft(), "drf_018f47de-7a00-7cc0-8000-000000000099": openDraft("drf_018f47de-7a00-7cc0-8000-000000000099") }) }],
  ])("refuses %s without approving", async (_caseName, options, override = request) => {
    const configured = dependencies(options);

    await expect(configured.useCase.execute(override)).resolves.toMatchObject({ ok: false });
    expect(configured.approvals()).toBe(
      _caseName === "closed associated draft" || _caseName === "ambiguous open drafts" ? 1 : 0,
    );
  });
});
