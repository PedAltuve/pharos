import { describe, expect, it } from "vitest";
import { ApproveBeaconDraft } from "../../src/application/approve-beacon-draft.js";
import type { Beacon } from "../../src/domain/beacon/index.js";
import type { CaptureBeaconAssociation, CaptureSession } from "../../src/domain/capture/index.js";
import type { BeaconStore, CaptureStore, Hasher, IdGenerator } from "../../src/domain/ports/index.js";
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
  return { useCase: new ApproveBeaconDraft({ clock: { now: () => new Date(timestamp) }, ids: { next: () => versionId } as IdGenerator, hasher: { hash: () => options.hash ?? semanticHash } as Hasher, captureStore, beaconStore }), approvals: () => approvals, command: () => command, key: () => key };
}

const request = { projectId, beaconId, requestId: "req_018f47de-7a00-7cc0-8000-000000000002" as const, reviewedHash: semanticHash, operatorConfirmed: true, actor: "operator_1" };

describe("ApproveBeaconDraft", () => {
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
