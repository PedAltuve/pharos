import type { BeaconId, CaptureRefusal, RequestId } from "../domain/capture/index.js";
import type { BeaconStoreRefusal } from "../domain/ports/beacon-store-refusals.js";
import type { JsonValue } from "../domain/ports/json-value.js";
import type { AnyConsentGrant, AnyConsentRequest, ConsentGrant, ConsentRequest, ConsentRequestV2, ConsentStoreRefusal, OperatorConsentStore, VerifiedApprovalCommand } from "../domain/ports/operator-consent.js";
import type { BeaconStore, CaptureStore, Clock, Hasher, IdGenerator } from "../domain/ports/index.js";
import type { ProjectId } from "../domain/project/index.js";
import { project } from "../domain/semantics/index.js";
import { staleComparisonDigest } from "../adapters/host-consent-verifier/index.js";
import { err, ok, type Result } from "../shared/result.js";
import type { DraftAssociationMismatch } from "./annotate-capture.js";

function exactDataKeys(value: unknown, keys: readonly string[], optional: readonly string[] = []): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const own = Reflect.ownKeys(value);
  return keys.every((key) => Object.hasOwn(value, key)) && own.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return typeof key === "string" && (keys.includes(key) || optional.includes(key)) && descriptor?.enumerable === true && "value" in descriptor;
  });
}

function shortText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256;
}

/** Only shape-check here; the consent store authenticates the signed grant before claiming. */
function validApprovalGrant(value: unknown, requestId: string): value is AnyConsentGrant & { binding: Extract<ConsentGrant["binding"], { action: "approve" }> | ConsentRequestV2["binding"] } {
  if (!exactDataKeys(value, ["contract", "decision", "binding", "challengeId", "expiresAtEpochMs", "hostId", "keyId", "algorithm", "signature"])) return false;
  const grant = value as AnyConsentGrant;
  const v2 = grant.contract === "pharos.operator-consent-grant/2";
  if (!exactDataKeys(grant.binding, v2 ? ["action", "projectId", "beaconId", "draftId", "expectedRevision", "semanticHash", "requestId", "staleOriginAcknowledged", "reviewed"] : ["action", "projectId", "beaconId", "draftId", "expectedRevision", "semanticHash", "requestId"], v2 ? [] : ["staleOriginAcknowledged"])) return false;
  if (v2) {
    const staleBinding = grant.binding as ConsentRequestV2["binding"];
    const reviewed = staleBinding.reviewed;
    if (staleBinding.staleOriginAcknowledged !== true || !exactDataKeys(reviewed, ["activeVersionId", "activeSemanticHash", "comparisonDigest"]) ||
      !((reviewed.activeVersionId === null && reviewed.activeSemanticHash === null) || (shortText(reviewed.activeVersionId) && shortText(reviewed.activeSemanticHash))) ||
      reviewed.comparisonDigest !== staleComparisonDigest(staleBinding.semanticHash, reviewed.activeVersionId, reviewed.activeSemanticHash)) return false;
  }
  const binding = grant.binding;
  return (v2 || grant.contract === "pharos.operator-consent-grant/1") && grant.decision === "granted" && grant.algorithm === "ed25519" &&
    shortText(grant.challengeId) && shortText(grant.hostId) && shortText(grant.keyId) && typeof grant.signature === "string" && grant.signature.length > 0 && grant.signature.length <= 1024 &&
    Number.isSafeInteger(grant.expiresAtEpochMs) && grant.expiresAtEpochMs >= 0 && binding.action === "approve" && binding.requestId === requestId &&
    shortText(binding.projectId) && shortText(binding.beaconId) && shortText(binding.draftId) && shortText(binding.semanticHash) && shortText(binding.requestId) &&
    Number.isSafeInteger(binding.expectedRevision) && binding.expectedRevision >= 1 &&
    (!Object.hasOwn(binding, "staleOriginAcknowledged") || typeof binding.staleOriginAcknowledged === "boolean");
}

export interface ApproveBeaconDraftRequest {
  readonly projectId: ProjectId;
  readonly beaconId: BeaconId;
  readonly requestId: RequestId;
  readonly reviewedHash: string;
  readonly operatorConfirmed: boolean;
  readonly actor: string | null;
  readonly staleOriginAcknowledged?: boolean;
}

export interface ApprovedBeaconDraft {
  readonly beaconId: BeaconId;
  readonly versionId: string;
  readonly status: "active";
  readonly semanticHash: string;
  readonly assurance: "operator_confirmed";
}

export interface OperatorConfirmationRequired {
  readonly rule: "operator-confirmation-required";
}

export type ApproveBeaconDraftRefusal =
  | CaptureRefusal
  | BeaconStoreRefusal
  | OperatorConfirmationRequired
  | DraftAssociationMismatch;

export interface PrepareApprovalConsentRequest {
  readonly projectId: ProjectId;
  readonly beaconId: BeaconId;
  readonly requestId: RequestId;
}

export interface ApprovalConsentDisplay {
  readonly request: AnyConsentRequest;
  readonly auditId: string;
}

export interface ApproveBeaconDraftDependencies {
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly hasher: Hasher;
  readonly captureStore: CaptureStore;
  readonly beaconStore: BeaconStore;
  readonly consentStore?: OperatorConsentStore;
  /** Trusted host boundary; never sourced from the preparation request. */
  readonly issueChallenge?: () => { readonly challengeId: string; readonly expiresAtEpochMs: number };
}

/** Approves exactly one association-bound draft after an explicit operator confirmation. */
export class ApproveBeaconDraft {
  constructor(private readonly dependencies: ApproveBeaconDraftDependencies) {}

  async prepareConsent(request: PrepareApprovalConsentRequest): Promise<Result<ApprovalConsentDisplay, ApproveBeaconDraftRefusal | ConsentStoreRefusal>> {
    const store = this.dependencies.consentStore;
    const issueChallenge = this.dependencies.issueChallenge;
    if (store === undefined || issueChallenge === undefined) return err({ rule: "invalid-consent-request", requestId: request.requestId });
    const association = await this.dependencies.captureStore.getAssociationByBeacon(request.projectId, request.beaconId);
    if (!association.ok) return association;
    if (association.value?.state !== "committed" || association.value.semanticHash === undefined) return err({ rule: "draft-association-mismatch" });
    const session = await this.dependencies.captureStore.getSession(request.projectId, association.value.captureId);
    if (!session.ok) return session;
    if (session.value.status !== "promoted" || session.value.projectId !== request.projectId) return err({ rule: "draft-association-mismatch" });
    const beacon = await this.dependencies.beaconStore.getBeacon(request.beaconId);
    if (!beacon.ok) return beacon;
    if (beacon.value.beaconId !== request.beaconId || association.value.projectId !== request.projectId || association.value.beaconId !== request.beaconId) return err({ rule: "draft-association-mismatch" });
    const draft = Object.hasOwn(beacon.value.drafts, association.value.draftId) ? beacon.value.drafts[association.value.draftId] : undefined;
    if (draft?.status !== "open" || draft.draftId !== association.value.draftId || draft.revision !== association.value.revision || Object.values(beacon.value.drafts).filter((item) => item.status === "open").length !== 1) return err({ rule: "draft-association-mismatch" });
    const semanticHash = this.dependencies.hasher.hash(project(draft.content) as JsonValue);
    if (semanticHash !== association.value.semanticHash) return err({ rule: "draft-association-mismatch" });
    const stale = draft.origin.branchedFromVersion !== beacon.value.activeVersionId;
    // This binding describes what the host must ask the human to acknowledge;
    // preparing it does not authorize the transition or decide on their behalf.
    let reviewed: ConsentRequestV2["binding"]["reviewed"] | undefined;
    if (stale) {
      if (!this.dependencies.beaconStore.getActiveSemanticSnapshot) return err({ rule: "draft-association-mismatch" });
      const snapshot = await this.dependencies.beaconStore.getActiveSemanticSnapshot(request.beaconId);
      if (!snapshot.ok) return snapshot;
      if (snapshot.value?.versionId !== beacon.value.activeVersionId && !(snapshot.value === null && beacon.value.activeVersionId === null)) return err({ rule: "draft-association-mismatch" });
      const activeVersionId = snapshot.value?.versionId ?? null;
      const activeSemanticHash = snapshot.value?.semanticHash ?? null;
      const comparisonDigest = staleComparisonDigest(semanticHash, activeVersionId, activeSemanticHash);
      if (!comparisonDigest) return err({ rule: "draft-association-mismatch" });
      reviewed = { activeVersionId, activeSemanticHash, comparisonDigest };
    }
    const binding: ConsentRequest["binding"] | ConsentRequestV2["binding"] = { action: "approve", projectId: request.projectId, beaconId: request.beaconId, draftId: draft.draftId, expectedRevision: draft.revision, semanticHash, requestId: request.requestId, ...(reviewed ? { staleOriginAcknowledged: true, reviewed } : {}) };
    const existing = await store.getChallenge(request.requestId, this.dependencies.clock.now().getTime());
    if (!existing.ok) return existing;
    if (existing.value !== undefined) {
      if (existing.value.status !== "pending" || JSON.stringify(existing.value.request.binding) !== JSON.stringify(binding)) return err({ rule: "consent-request-conflict", requestId: request.requestId });
      const revalidated = await store.getChallenge(request.requestId, this.dependencies.clock.now().getTime());
      if (!revalidated.ok) return revalidated;
      if (revalidated.value?.status !== "pending" || JSON.stringify(revalidated.value.request) !== JSON.stringify(existing.value.request)) return err({ rule: "consent-request-conflict", requestId: request.requestId });
      return ok({ request: revalidated.value.request, auditId: revalidated.value.auditId });
    }
    const now = this.dependencies.clock.now().getTime();
    const challenge = issueChallenge();
    if (!Number.isSafeInteger(now) || !Number.isSafeInteger(challenge.expiresAtEpochMs) || challenge.expiresAtEpochMs <= now || typeof challenge.challengeId !== "string" || challenge.challengeId.length === 0 || challenge.challengeId.length > 256) return err({ rule: "invalid-consent-request", requestId: request.requestId });
    const consentRequest: AnyConsentRequest = reviewed
      ? { contract: "pharos.operator-consent-request/2", binding: binding as ConsentRequestV2["binding"], challengeId: challenge.challengeId, expiresAtEpochMs: challenge.expiresAtEpochMs }
      : { contract: "pharos.operator-consent-request/1", binding, challengeId: challenge.challengeId, expiresAtEpochMs: challenge.expiresAtEpochMs };
    const persistenceNow = this.dependencies.clock.now().getTime();
    if (!Number.isSafeInteger(persistenceNow) || persistenceNow < 0 || persistenceNow >= challenge.expiresAtEpochMs) {
      return err({ rule: "invalid-consent-request", requestId: request.requestId });
    }
    const created = await store.createChallenge(consentRequest, persistenceNow);
    if (!created.ok) {
      if (created.error.rule !== "consent-request-conflict") return created;
      const original = await store.getChallenge(request.requestId, this.dependencies.clock.now().getTime());
      if (!original.ok) return original;
      if (original.value?.status !== "pending" || JSON.stringify(original.value.request.binding) !== JSON.stringify(binding)) {
        return err({ rule: "consent-request-conflict", requestId: request.requestId });
      }
      return ok({ request: original.value.request, auditId: original.value.auditId });
    }
    if (created.value.status !== "pending") return err({ rule: "consent-request-conflict", requestId: request.requestId });
    return ok({ request: created.value.request, auditId: created.value.auditId });
  }

  async completeConsent(input: { readonly requestId: RequestId; readonly grant: AnyConsentGrant }): Promise<Result<ApprovedBeaconDraft, ApproveBeaconDraftRefusal | ConsentStoreRefusal>> {
    const store = this.dependencies.consentStore;
    const requestId = input.requestId;
    if (!store || !validApprovalGrant(input.grant, requestId)) return err({ rule: "invalid-consent-request", requestId });
    const binding = input.grant.binding;
    const signedRequest: AnyConsentRequest = input.grant.contract === "pharos.operator-consent-grant/2"
      ? { contract: "pharos.operator-consent-request/2", binding: binding as ConsentRequestV2["binding"], challengeId: input.grant.challengeId, expiresAtEpochMs: input.grant.expiresAtEpochMs }
      : { contract: "pharos.operator-consent-request/1", binding, challengeId: input.grant.challengeId, expiresAtEpochMs: input.grant.expiresAtEpochMs };
    const actionHash = store.actionHash(signedRequest);
    const existing = await store.getChallenge(requestId, this.dependencies.clock.now().getTime());
    if (!existing.ok) return existing;
    if (!existing.value || existing.value.status === "declined") return err({ rule: "consent-not-found", requestId });
    if (existing.value.status === "pending" && store.actionHash(existing.value.request) !== actionHash) return err({ rule: "consent-consumption-conflict", requestId });
    if (existing.value.status !== "pending" && (existing.value.provenance !== "verified" || existing.value.actionHash !== actionHash || !("approvalCommand" in existing.value) || !existing.value.approvalCommand)) return err({ rule: "consent-consumption-conflict", requestId });
    let command: VerifiedApprovalCommand = existing.value.status === "pending"
      ? { versionId: this.dependencies.ids.next("version"), approvedAt: this.dependencies.clock.now().toISOString(), actor: null, bindingHash: actionHash, ...(signedRequest.contract === "pharos.operator-consent-request/2" ? { reviewed: signedRequest.binding.reviewed } : {}) }
      : (existing.value as { readonly approvalCommand: VerifiedApprovalCommand }).approvalCommand;
    let claimed = await store.beginVerifiedApproval(requestId, actionHash, input.grant, command, this.dependencies.clock.now().getTime());
    if (!claimed.ok && claimed.error.rule === "consent-consumption-conflict" && existing.value.status === "pending") {
      const raced = await store.getChallenge(requestId, this.dependencies.clock.now().getTime());
      if (!raced.ok) return raced;
      if (!raced.value || (raced.value.status !== "claimed" && raced.value.status !== "consumed") || raced.value.provenance !== "verified" || raced.value.actionHash !== actionHash || !("approvalCommand" in raced.value) || !raced.value.approvalCommand) return claimed;
      command = raced.value.approvalCommand;
      claimed = await store.beginVerifiedApproval(requestId, actionHash, input.grant, command, this.dependencies.clock.now().getTime());
    }
    if (!claimed.ok) return claimed;
    if (claimed.value.status === "consumed") return this.approvedResult(claimed.value, binding.beaconId, binding.semanticHash, requestId, command.versionId);
    if (claimed.value.status !== "claimed" || claimed.value.provenance !== "verified" || !claimed.value.approvalCommand || claimed.value.actionHash !== actionHash) return err({ rule: "consent-consumption-conflict", requestId });
    command = claimed.value.approvalCommand;
    const approved = await this.dependencies.beaconStore.approveDraft(binding.beaconId as BeaconId, {
      draftId: binding.draftId as `drf_${string}`, expectedRevision: binding.expectedRevision, reviewedHash: binding.semanticHash,
      versionId: command.versionId, approvedAt: command.approvedAt, actor: command.actor,
      staleOriginAcknowledged: binding.staleOriginAcknowledged ?? false,
      ...(command.reviewed ? { reviewedActiveVersionId: command.reviewed.activeVersionId, reviewedActiveSemanticHash: command.reviewed.activeSemanticHash, comparisonDigest: command.reviewed.comparisonDigest } : {}),
    }, `beacon-approve:${binding.projectId}:${binding.beaconId}:${requestId}`);
    if (!approved.ok) return approved;
    const draft = Object.hasOwn(approved.value.drafts, binding.draftId) ? approved.value.drafts[binding.draftId] : undefined;
    const version = Object.hasOwn(approved.value.versions, command.versionId) ? approved.value.versions[command.versionId] : undefined;
    if (draft?.status !== "closed" || draft.approvedVersionId !== command.versionId || version?.status !== "active" || version.approval.reviewedHash !== binding.semanticHash || version.provenance.approvedDraftId !== binding.draftId || version.provenance.approvedRevision !== binding.expectedRevision || approved.value.activeVersionId !== command.versionId) return err({ rule: "draft-association-mismatch" });
    const result: ApprovedBeaconDraft = { beaconId: binding.beaconId as BeaconId, versionId: command.versionId, status: "active", semanticHash: binding.semanticHash, assurance: "operator_confirmed" };
    const completed = await store.completeVerifiedConsumption(requestId, actionHash, { ...result }, this.dependencies.clock.now().getTime());
    if (!completed.ok) return completed;
    return this.approvedResult(completed.value, binding.beaconId, binding.semanticHash, requestId, command.versionId);
  }

  private approvedResult(record: { readonly status: string; readonly result?: JsonValue; readonly approvalCommand?: VerifiedApprovalCommand }, beaconId: string, semanticHash: string, requestId: string, versionId: string): Result<ApprovedBeaconDraft, ConsentStoreRefusal> {
    const value = record.result as Record<string, unknown> | undefined;
    if (record.status !== "consumed" || !value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).sort().join(",") !== "assurance,beaconId,semanticHash,status,versionId" ||
      value.beaconId !== beaconId || value.semanticHash !== semanticHash || value.status !== "active" ||
      value.assurance !== "operator_confirmed" || record.approvalCommand?.versionId !== versionId || value.versionId !== versionId) return err({ rule: "consent-consumption-conflict", requestId });
    return ok(value as unknown as ApprovedBeaconDraft);
  }

  async execute(request: ApproveBeaconDraftRequest): Promise<Result<ApprovedBeaconDraft, ApproveBeaconDraftRefusal>> {
    if (!request.operatorConfirmed) return err({ rule: "operator-confirmation-required" });

    const association = await this.dependencies.captureStore.getAssociationByBeacon(
      request.projectId,
      request.beaconId,
    );
    if (!association.ok) return association;
    if (
      association.value === null
      || association.value.state !== "committed"
      || association.value.semanticHash === undefined
    ) return err({ rule: "draft-association-mismatch" });

    const session = await this.dependencies.captureStore.getSession(
      request.projectId,
      association.value.captureId,
    );
    if (!session.ok) return session;
    if (session.value.status !== "promoted") return err({ rule: "draft-association-mismatch" });

    const beacon = await this.dependencies.beaconStore.getBeacon(request.beaconId);
    if (!beacon.ok) return beacon;
    if (beacon.value.beaconId !== request.beaconId || beacon.value.beaconId !== association.value.beaconId) {
      return err({ rule: "draft-association-mismatch" });
    }

    // Supporting records select the semantic source only. Draft state,
    // revision, and cardinality are admitted atomically by BeaconStore.
    const draft = beacon.value.drafts[association.value.draftId];
    if (draft === undefined || draft.draftId !== association.value.draftId) {
      return err({ rule: "draft-association-mismatch" });
    }

    if (draft.status === "abandoned") return err({ rule: "draft-association-mismatch" });
    const semanticHash = draft.status === "open"
      ? this.dependencies.hasher.hash(project(draft.content) as JsonValue)
      : association.value.semanticHash;
    if (draft.status === "open" && semanticHash !== association.value.semanticHash) {
      return err({ rule: "draft-association-mismatch" });
    }
    if (semanticHash !== request.reviewedHash) {
      return err({
        rule: "reviewed-hash-mismatch",
        draftId: draft.draftId,
        reviewedHash: request.reviewedHash,
        currentHash: semanticHash,
      });
    }

    const versionId = this.dependencies.ids.next("version");
    const approvedAt = this.dependencies.clock.now().toISOString();
    const approved = await this.dependencies.beaconStore.approveDraft(
      request.beaconId,
      {
        draftId: association.value.draftId,
        expectedRevision: association.value.revision,
        reviewedHash: semanticHash,
        versionId,
        approvedAt,
        actor: request.actor,
        staleOriginAcknowledged: request.staleOriginAcknowledged ?? false,
      },
      `beacon-approve:${request.projectId}:${request.beaconId}:${request.requestId}`,
    );
    if (!approved.ok) return approved;

    const canonicalDraft = approved.value.drafts[association.value.draftId];
    const canonicalVersionId = canonicalDraft?.status === "closed"
      ? canonicalDraft.approvedVersionId
      : undefined;
    const version = canonicalVersionId === undefined
      ? undefined
      : approved.value.versions[canonicalVersionId];
    if (version?.status !== "active") return err({ rule: "draft-association-mismatch" });
    return ok({
      beaconId: request.beaconId,
      versionId: version.versionId,
      status: "active",
      semanticHash,
      assurance: "operator_confirmed",
    });
  }
}
