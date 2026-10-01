import { err, ok, type Result } from "../../shared/result.js";

export type ConsentBinding =
  | { readonly action: "approve"; readonly projectId: string; readonly beaconId: string; readonly draftId: string; readonly expectedRevision: number; readonly semanticHash: string; readonly requestId: string; readonly staleOriginAcknowledged?: boolean }
  | { readonly action: "revoke"; readonly projectId: string; readonly beaconId: string; readonly expectedActiveVersion: string; readonly reason: string; readonly requestId: string };

export interface StaleApprovalBindingV2 {
  readonly action: "approve";
  readonly projectId: string;
  readonly beaconId: string;
  readonly draftId: string;
  readonly expectedRevision: number;
  readonly semanticHash: string;
  readonly requestId: string;
  readonly staleOriginAcknowledged: true;
  readonly reviewed: { readonly activeVersionId: string | null; readonly activeSemanticHash: string | null; readonly comparisonDigest: string };
}

/** Separate signed stale approval binding; non-stale v1 remains unchanged. */
export interface ConsentRequestV2 {
  readonly contract: "pharos.operator-consent-request/2";
  readonly binding: StaleApprovalBindingV2;
  readonly challengeId: string;
  readonly expiresAtEpochMs: number;
}

export interface ConsentGrantV2 extends Omit<ConsentGrant, "contract" | "binding"> {
  readonly contract: "pharos.operator-consent-grant/2";
  readonly binding: StaleApprovalBindingV2;
}

export interface ConsentRequest {
  readonly contract: "pharos.operator-consent-request/1";
  readonly binding: ConsentBinding;
  readonly challengeId: string;
  readonly expiresAtEpochMs: number;
}

export type AnyConsentRequest = ConsentRequest | ConsentRequestV2;
export type AnyConsentGrant = ConsentGrant | ConsentGrantV2;

/** Store-owned action identity and durable guarded consumption; never derive hashes in application code. */
export type VerifiedApprovalCommand = {
  readonly versionId: string;
  readonly approvedAt: string;
  readonly actor: string | null;
  readonly bindingHash: string;
  readonly reviewed: StaleApprovalBindingV2["reviewed"];
} | {
  readonly versionId: string;
  readonly approvedAt: string;
  readonly actor: string | null;
  readonly bindingHash: string;
  readonly reviewed?: never;
};

/* Legacy v1 command fields are unchanged. */
export interface LegacyApprovalCommand {
  readonly versionId: string;
  readonly approvedAt: string;
  readonly actor: string | null;
  readonly bindingHash: string;
}

export interface VerifiedRevokeCommand {
  readonly expectedActiveVersionId: string;
  readonly reason: string;
  readonly revokedAt: string;
  readonly actor: string | null;
  readonly bindingHash: string;
}

export interface OperatorConsentStore {
  actionHash(request: AnyConsentRequest): string;
  /** Terminal replay may include the immutable approval command only from a validated verified approval claim; never returns the grant. */
  getChallenge(requestId: string, nowEpochMs: number): Promise<Result<ConsentStoreRecord | undefined, ConsentStoreRefusal>>;
  createChallenge(request: AnyConsentRequest, nowEpochMs: number): Promise<Result<ConsentStoreRecord, ConsentStoreRefusal>>;
  decline(requestId: string, reason: string, nowEpochMs: number): Promise<Result<ConsentStoreRecord, ConsentStoreRefusal>>;
  beginVerifiedConsumption(requestId: string, actionHash: string, grant: ConsentGrant, nowEpochMs: number): Promise<Result<ConsentStoreRecord, ConsentStoreRefusal>>;
  beginVerifiedApproval(requestId: string, actionHash: string, grant: AnyConsentGrant, command: VerifiedApprovalCommand, nowEpochMs: number): Promise<Result<ConsentStoreRecord, ConsentStoreRefusal>>;
  beginVerifiedRevocation(requestId: string, actionHash: string, grant: ConsentGrant, command: VerifiedRevokeCommand, nowEpochMs: number): Promise<Result<ConsentStoreRecord, ConsentStoreRefusal>>;
  completeVerifiedConsumption(requestId: string, actionHash: string, result: import("./json-value.js").JsonValue, nowEpochMs: number): Promise<Result<ConsentStoreRecord, ConsentStoreRefusal>>;
}

export type ConsentStoreRecord =
  | { readonly status: "pending"; readonly request: AnyConsentRequest; readonly auditId: string }
  | { readonly status: "claimed"; readonly provenance: "unauthenticated" | "verified"; readonly requestId: string; readonly actionHash: string; readonly auditId: string; readonly approvalCommand?: VerifiedApprovalCommand; readonly revokeCommand?: VerifiedRevokeCommand }
  | { readonly status: "declined"; readonly requestId: string; readonly reason: string; readonly auditId: string }
  | { readonly status: "consumed"; readonly provenance: "unauthenticated" | "verified"; readonly requestId: string; readonly actionHash: string; readonly result: import("./json-value.js").JsonValue; readonly auditId: string; readonly approvalCommand?: VerifiedApprovalCommand; readonly revokeCommand?: VerifiedRevokeCommand };

export type ConsentStoreRefusal =
  | { readonly rule: "consent-request-conflict" | "consent-not-found" | "consent-expired" | "consent-already-declined" | "consent-consumption-conflict" | "consent-not-claimed" | "invalid-consent-request"; readonly requestId: string };

export interface ConsentGrant {
  readonly contract: "pharos.operator-consent-grant/1";
  readonly decision: "granted" | "declined";
  readonly binding: ConsentBinding;
  readonly challengeId: string;
  readonly expiresAtEpochMs: number;
  readonly hostId: string;
  readonly keyId: string;
  readonly algorithm: "ed25519";
  readonly signature: string;
}

export type HostTrust = { readonly status: "active"; readonly hostId: string; readonly keyId: string } | { readonly status: "revoked" | "unknown" };
export type GrantVerification = { readonly status: "verified"; readonly hostId: string; readonly keyId: string } | { readonly status: "rejected" };

/** Implementations must authenticate the signature against an active trusted public key, over the full versioned grant, and reject expired or mismatched requests. A caller-provided result is not proof. */
export interface HostConsentVerifier {
  readonly version: 1;
  trust(hostId: string, keyId: string): Promise<HostTrust>;
  verify(request: ConsentRequest, grant: ConsentGrant, nowEpochMs: number): Promise<GrantVerification>;
}

export interface HostTrustState {
  readonly hostId: string;
  readonly revision: number;
  readonly activeKeyId: string;
  readonly activePublicKey: string;
  readonly retiredKeyIds: readonly string[];
}

export type HostTrustReadback = HostTrustState & { readonly status: "active" | "revoked" };

export interface RotateHostTrustCommand {
  readonly hostId: string;
  readonly expectedRevision: number;
  readonly expectedKeyId: string;
  readonly nextKeyId: string;
  readonly nextPublicKey: string;
}

/** Pure transition; adapters must atomically compare and persist the entire returned state. */
export function rotateHostTrust(state: HostTrustState, command: RotateHostTrustCommand): Result<HostTrustState, "stale-host-trust" | "invalid-host-key"> {
  if (state.hostId !== command.hostId || !Number.isSafeInteger(state.revision) || state.revision < 0 || state.revision !== command.expectedRevision || state.activeKeyId !== command.expectedKeyId) return err("stale-host-trust");
  if (!command.nextKeyId || !command.nextPublicKey || command.nextKeyId === state.activeKeyId || state.retiredKeyIds.includes(command.nextKeyId) || state.revision === Number.MAX_SAFE_INTEGER) return err("invalid-host-key");
  return ok({ hostId: state.hostId, revision: state.revision + 1, activeKeyId: command.nextKeyId, activePublicKey: command.nextPublicKey, retiredKeyIds: [...state.retiredKeyIds, state.activeKeyId] });
}

/** Private keys never cross this port; rotate is a compare-and-swap of the entire host state. */
export interface TrustedHostRegistry {
  readonly version: 1;
  /** Host-only public readback; undefined means unknown or unsafe/corrupt state, never permission to overwrite. */
  trustState(hostId: string): Promise<HostTrustReadback | undefined>;
  register(hostId: string, keyId: string, publicKey: string): Promise<void>;
  rotate(command: RotateHostTrustCommand): Promise<Result<HostTrustState, "stale-host-trust" | "invalid-host-key">>;
  revoke(hostId: string, keyId: string): Promise<void>;
}

/** Defense-in-depth structural check after trusted verification; never authenticates a signature itself. */
export function matchConsentGrant(request: ConsentRequest, input: unknown, verification: GrantVerification, trust: HostTrust, nowEpochMs: number): Result<{ readonly assurance: "operator_confirmed" }, "invalid-consent"> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return err("invalid-consent");
  const grant = input as Partial<ConsentGrant>;
  if (!exactKeys(request, ["contract", "binding", "challengeId", "expiresAtEpochMs"]) ||
    !exactKeys(grant, ["contract", "decision", "binding", "challengeId", "expiresAtEpochMs", "hostId", "keyId", "algorithm", "signature"]) ||
    verification.status !== "verified" || trust.status !== "active" || request.contract !== "pharos.operator-consent-request/1" || grant.contract !== "pharos.operator-consent-grant/1" || grant.decision !== "granted" ||
    !validSignature(grant.signature) || grant.algorithm !== "ed25519" ||
    !validShortText(grant.hostId) || !validShortText(grant.keyId) || grant.hostId !== verification.hostId || grant.keyId !== verification.keyId || grant.hostId !== trust.hostId || grant.keyId !== trust.keyId ||
    !validShortText(request.challengeId) || !validShortText(grant.challengeId) || grant.challengeId !== request.challengeId || grant.expiresAtEpochMs !== request.expiresAtEpochMs ||
    !Number.isSafeInteger(request.expiresAtEpochMs) || request.expiresAtEpochMs < 0 || !Number.isSafeInteger(nowEpochMs) || nowEpochMs < 0 || nowEpochMs >= request.expiresAtEpochMs ||
    !sameBinding(grant.binding, request.binding) || (request.binding.action === "approve" && request.binding.staleOriginAcknowledged === true)) return err("invalid-consent");
  return ok({ assurance: "operator_confirmed" });
}

export function matchConsentGrantV2(request: ConsentRequestV2, input: unknown, nowEpochMs: number): boolean {
  if (!input || typeof input !== "object" || Array.isArray(input) || !validV2Request(request)) return false;
  const grant = input as Partial<ConsentGrantV2>;
  return exactKeys(grant, ["contract", "decision", "binding", "challengeId", "expiresAtEpochMs", "hostId", "keyId", "algorithm", "signature"]) &&
    grant.contract === "pharos.operator-consent-grant/2" && grant.decision === "granted" && grant.algorithm === "ed25519" &&
    validSignature(grant.signature) && validShortText(grant.hostId) && validShortText(grant.keyId) &&
    grant.challengeId === request.challengeId && grant.expiresAtEpochMs === request.expiresAtEpochMs &&
    Number.isSafeInteger(nowEpochMs) && nowEpochMs >= 0 && nowEpochMs < request.expiresAtEpochMs &&
    validV2Binding(grant.binding) && grant.binding.projectId === request.binding.projectId && grant.binding.beaconId === request.binding.beaconId &&
    grant.binding.draftId === request.binding.draftId && grant.binding.expectedRevision === request.binding.expectedRevision &&
    grant.binding.semanticHash === request.binding.semanticHash && grant.binding.requestId === request.binding.requestId &&
    grant.binding.reviewed.activeVersionId === request.binding.reviewed.activeVersionId &&
    grant.binding.reviewed.activeSemanticHash === request.binding.reviewed.activeSemanticHash &&
    grant.binding.reviewed.comparisonDigest === request.binding.reviewed.comparisonDigest;
}

function validV2Request(request: ConsentRequestV2): boolean {
  return exactKeys(request, ["contract", "binding", "challengeId", "expiresAtEpochMs"]) && request.contract === "pharos.operator-consent-request/2" &&
    validShortText(request.challengeId) && Number.isSafeInteger(request.expiresAtEpochMs) && request.expiresAtEpochMs >= 0 && validV2Binding(request.binding);
}

function validV2Binding(value: unknown): value is StaleApprovalBindingV2 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const b = value as Partial<StaleApprovalBindingV2>;
  if (!exactKeys(b, ["action", "projectId", "beaconId", "draftId", "expectedRevision", "semanticHash", "requestId", "staleOriginAcknowledged", "reviewed"]) ||
    b.action !== "approve" || b.staleOriginAcknowledged !== true || !validShortText(b.projectId) || !validShortText(b.beaconId) ||
    !validShortText(b.draftId) || !validPositiveSafeInteger(b.expectedRevision) || !validShortText(b.semanticHash) || !validShortText(b.requestId)) return false;
  const r = b.reviewed;
  return !!r && typeof r === "object" && exactKeys(r, ["activeVersionId", "activeSemanticHash", "comparisonDigest"]) &&
    ((r.activeVersionId === null && r.activeSemanticHash === null) || (validShortText(r.activeVersionId) && validShortText(r.activeSemanticHash))) && validShortText(r.comparisonDigest);
}

function exactKeys(value: object, required: readonly string[], optional: readonly string[] = []): boolean {
  const keys = Reflect.ownKeys(value);
  return required.every((key) => Object.hasOwn(value, key)) && keys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return typeof key === "string" && (required.includes(key) || optional.includes(key)) && descriptor?.enumerable === true && "value" in descriptor;
  });
}

function sameBinding(a: ConsentBinding | undefined, b: ConsentBinding): boolean {
  if (!validBinding(a) || !validBinding(b) || a.action !== b.action) return false;
  if (a.action === "approve" && b.action === "approve") return a.projectId === b.projectId && a.beaconId === b.beaconId && a.draftId === b.draftId && a.expectedRevision === b.expectedRevision && a.semanticHash === b.semanticHash && a.requestId === b.requestId && a.staleOriginAcknowledged === b.staleOriginAcknowledged && Object.hasOwn(a, "staleOriginAcknowledged") === Object.hasOwn(b, "staleOriginAcknowledged");
  if (a.action === "revoke" && b.action === "revoke") return a.projectId === b.projectId && a.beaconId === b.beaconId && a.expectedActiveVersion === b.expectedActiveVersion && a.reason === b.reason && a.requestId === b.requestId;
  return false;
}

function validBinding(value: unknown): value is ConsentBinding {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const binding = value as Partial<ConsentBinding>;
  if (binding.action === "approve") {
    return exactKeys(binding, ["action", "projectId", "beaconId", "draftId", "expectedRevision", "semanticHash", "requestId"], ["staleOriginAcknowledged"]) &&
      validShortText(binding.projectId) && validShortText(binding.beaconId) && validShortText(binding.draftId) &&
      validPositiveSafeInteger(binding.expectedRevision) &&
      validShortText(binding.semanticHash) && validShortText(binding.requestId) &&
      (!Object.hasOwn(binding, "staleOriginAcknowledged") || typeof binding.staleOriginAcknowledged === "boolean");
  }
  if (binding.action === "revoke") {
    return exactKeys(binding, ["action", "projectId", "beaconId", "expectedActiveVersion", "reason", "requestId"]) &&
      validShortText(binding.projectId) && validShortText(binding.beaconId) && validShortText(binding.expectedActiveVersion) &&
      validReason(binding.reason) && validShortText(binding.requestId);
  }
  return false;
}

function validShortText(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 256;
}

function validPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

function validReason(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 4096 && !/^\s/.test(value) && /\S$/.test(value) && !/[\r\n]/.test(value);
}

function validSignature(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 1024;
}
