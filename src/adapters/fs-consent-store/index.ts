import { createHash } from "node:crypto";
import { chmod, lstat } from "node:fs/promises";
import { join } from "node:path";
import { matchConsentGrant, matchConsentGrantV2, type StaleApprovalBindingV2, type AnyConsentGrant, type AnyConsentRequest, type ConsentBinding, type ConsentGrant, type OperatorConsentStore, type VerifiedApprovalCommand, type VerifiedRevokeCommand } from "../../domain/ports/operator-consent.js";
import { canonicalConsentGrantPayload, canonicalConsentGrantPayloadV2, verifyEd25519ConsentV2, verifyEd25519Consent, type ActiveHostPublicKeyLookup } from "../host-consent-verifier/index.js";
import type { JsonValue } from "../../domain/ports/json-value.js";
import { err, ok, type Result } from "../../shared/result.js";
import { createPrivateJson, ensurePrivateDirectory, isErrno, readJson } from "../fs-project/filesystem.js";
import { ProjectLock } from "../fs-project/project-lock.js";
import { isValidId } from "../fs-beacon-store/layout.js";

export type ConsentRecord =
  | { readonly status: "pending"; readonly request: AnyConsentRequest; readonly auditId: string }
  | { readonly status: "claimed"; readonly provenance: "unauthenticated" | "verified"; readonly requestId: string; readonly actionHash: string; readonly auditId: string; readonly approvalCommand?: VerifiedApprovalCommand; readonly revokeCommand?: VerifiedRevokeCommand }
  | { readonly status: "declined"; readonly requestId: string; readonly reason: string; readonly auditId: string }
  | { readonly status: "consumed"; readonly provenance: "unauthenticated" | "verified"; readonly requestId: string; readonly actionHash: string; readonly result: JsonValue; readonly auditId: string; readonly approvalCommand?: VerifiedApprovalCommand; readonly revokeCommand?: VerifiedRevokeCommand };

export type ConsentStoreError =
  | { readonly rule: "consent-request-conflict"; readonly requestId: string }
  | { readonly rule: "consent-not-found"; readonly requestId: string }
  | { readonly rule: "consent-expired"; readonly requestId: string }
  | { readonly rule: "consent-already-declined"; readonly requestId: string }
  | { readonly rule: "consent-consumption-conflict"; readonly requestId: string }
  | { readonly rule: "consent-not-claimed"; readonly requestId: string }
  | { readonly rule: "invalid-consent-request"; readonly requestId: string };

export interface FsConsentStoreOptions {
  readonly projectRoot: string;
  readonly lock?: ProjectLock;
  /** Injected by trusted composition, never sourced from model arguments. */
  readonly activeHostKey?: ActiveHostPublicKeyLookup;
  readonly clock?: () => number;
}

const REQUEST_CONTRACT = "pharos.consent-request-record/1";
const CLAIM_CONTRACT = "pharos.consent-claim-record/1";
const TERMINAL_CONTRACT = "pharos.consent-terminal-record/1";
const VERIFIED_CLAIM_CONTRACT = "pharos.consent-verified-claim-record/2";
const APPROVAL_CLAIM_CONTRACT = "pharos.consent-verified-approval-claim-record/3";
const REVOKE_CLAIM_CONTRACT = "pharos.consent-verified-revoke-claim-record/4";
const VERIFIED_TERMINAL_CONTRACT = "pharos.consent-verified-terminal-record/2";

/** Stable identity of one exact persisted consent request, including its action binding. */
export function consentActionHash(request: AnyConsentRequest): string {
  const snapshot = snapshotRequest(request);
  if (!snapshot) throw new Error("Invalid consent request");
  return `sha256:${createHash("sha256").update(canonical(snapshot)).digest("hex")}`;
}

interface StoredRequest {
  readonly contract: typeof REQUEST_CONTRACT;
  readonly requestId: string;
  readonly requestHash: string;
  readonly request: AnyConsentRequest;
  readonly auditId: string;
}

interface StoredClaim {
  readonly contract: typeof CLAIM_CONTRACT;
  readonly requestId: string;
  readonly actionHash: string;
  readonly auditId: string;
}

interface StoredVerifiedClaim {
  readonly contract: typeof VERIFIED_CLAIM_CONTRACT | typeof APPROVAL_CLAIM_CONTRACT | typeof REVOKE_CLAIM_CONTRACT;
  readonly approvalCommand?: VerifiedApprovalCommand;
  readonly revokeCommand?: VerifiedRevokeCommand;
  readonly requestId: string;
  readonly requestHash: string;
  readonly actionHash: string;
  readonly grant: AnyConsentGrant;
  readonly verifiedAtEpochMs: number;
  readonly auditId: string;
}

interface StoredDecline {
  readonly contract: typeof TERMINAL_CONTRACT;
  readonly status: "declined";
  readonly requestId: string;
  readonly reason: string;
  readonly auditId: string;
}

interface StoredConsumption {
  readonly contract: typeof TERMINAL_CONTRACT | typeof VERIFIED_TERMINAL_CONTRACT;
  readonly status: "consumed";
  readonly requestId: string;
  readonly actionHash: string;
  readonly result: JsonValue;
  readonly auditId: string;
}

type StoredTerminal = StoredDecline | StoredConsumption;

function requestIdOf(request: AnyConsentRequest): string {
  return request.binding.requestId;
}

function auditId(requestId: string): string {
  return `consent:${requestId}`;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
}

function requestHash(request: AnyConsentRequest): string {
  return canonical(request);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(record: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  const keys = Object.keys(record);
  return required.every((key) => Object.hasOwn(record, key)) && keys.every((key) => required.includes(key) || optional.includes(key));
}

function hasToJsonDescriptor(value: object): boolean {
  let current: object | null = value;
  while (current !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(current, "toJSON");
    if (descriptor !== undefined) return true;
    current = Object.getPrototypeOf(current);
  }
  return false;
}

function hasOnlyDataProperties(record: Record<string, unknown>): boolean {
  return Object.values(Object.getOwnPropertyDescriptors(record)).every((descriptor) => "value" in descriptor);
}

function ownDataValue(record: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor !== undefined && "value" in descriptor ? descriptor.value : undefined;
}

function validShortText(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 256;
}

function validReason(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 4096 && !/^\s/.test(value) && /\S$/.test(value) && !/[\r\n]/.test(value);
}

function validPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

function validEpoch(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function validNow(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function validBinding(value: unknown): value is ConsentBinding {
  if (!isRecord(value)) return false;
  if (value.action === "approve") {
    return hasOnlyKeys(value, ["action", "projectId", "beaconId", "draftId", "expectedRevision", "semanticHash", "requestId"], ["staleOriginAcknowledged"])
      && validShortText(value.projectId) && validShortText(value.beaconId) && validShortText(value.draftId)
      && validPositiveSafeInteger(value.expectedRevision) && validShortText(value.semanticHash) && validShortText(value.requestId)
      && (!Object.hasOwn(value, "staleOriginAcknowledged") || typeof value.staleOriginAcknowledged === "boolean");
  }
  if (value.action === "revoke") {
    return hasOnlyKeys(value, ["action", "projectId", "beaconId", "expectedActiveVersion", "reason", "requestId"])
      && validShortText(value.projectId) && validShortText(value.beaconId) && validShortText(value.expectedActiveVersion)
      && validReason(value.reason) && validShortText(value.requestId);
  }
  return false;
}

function validRequest(request: AnyConsentRequest): boolean {
  return snapshotRequest(request) !== undefined;
}

function snapshotBinding(value: ConsentBinding): ConsentBinding | undefined {
  if (!isRecord(value) || !hasOnlyDataProperties(value)) return undefined;
  const action = ownDataValue(value, "action");
  if (action === "approve") {
    if (!hasOnlyKeys(value, ["action", "projectId", "beaconId", "draftId", "expectedRevision", "semanticHash", "requestId"], ["staleOriginAcknowledged"])) return undefined;
    const snapshot = Object.hasOwn(value, "staleOriginAcknowledged")
      ? { action, projectId: ownDataValue(value, "projectId"), beaconId: ownDataValue(value, "beaconId"), draftId: ownDataValue(value, "draftId"), expectedRevision: ownDataValue(value, "expectedRevision"), semanticHash: ownDataValue(value, "semanticHash"), requestId: ownDataValue(value, "requestId"), staleOriginAcknowledged: ownDataValue(value, "staleOriginAcknowledged") }
      : { action, projectId: ownDataValue(value, "projectId"), beaconId: ownDataValue(value, "beaconId"), draftId: ownDataValue(value, "draftId"), expectedRevision: ownDataValue(value, "expectedRevision"), semanticHash: ownDataValue(value, "semanticHash"), requestId: ownDataValue(value, "requestId") };
    return validBinding(snapshot) ? snapshot : undefined;
  }
  if (action === "revoke") {
    if (!hasOnlyKeys(value, ["action", "projectId", "beaconId", "expectedActiveVersion", "reason", "requestId"])) return undefined;
    const snapshot = { action, projectId: ownDataValue(value, "projectId"), beaconId: ownDataValue(value, "beaconId"), expectedActiveVersion: ownDataValue(value, "expectedActiveVersion"), reason: ownDataValue(value, "reason"), requestId: ownDataValue(value, "requestId") };
    return validBinding(snapshot) ? snapshot : undefined;
  }
  return undefined;
}

function snapshotRequest(request: AnyConsentRequest): AnyConsentRequest | undefined {
  if (!isRecord(request) || !hasOnlyDataProperties(request) || !hasOnlyKeys(request, ["contract", "binding", "challengeId", "expiresAtEpochMs"])
    || !(["pharos.operator-consent-request/1", "pharos.operator-consent-request/2"].includes(ownDataValue(request, "contract") as string)) || !validShortText(ownDataValue(request, "challengeId")) || !validEpoch(ownDataValue(request, "expiresAtEpochMs"))) return undefined;
  const bindingValue = ownDataValue(request, "binding");
  const contract = ownDataValue(request, "contract");
  if (contract === "pharos.operator-consent-request/2") {
    const binding = snapshotV2Binding(bindingValue);
    return binding ? { contract, binding, challengeId: ownDataValue(request, "challengeId") as string, expiresAtEpochMs: ownDataValue(request, "expiresAtEpochMs") as number } : undefined;
  }
  const binding = snapshotBinding(bindingValue as ConsentBinding);
  return binding === undefined ? undefined : { contract: "pharos.operator-consent-request/1", binding, challengeId: ownDataValue(request, "challengeId") as string, expiresAtEpochMs: ownDataValue(request, "expiresAtEpochMs") as number };
}

function snapshotReviewed(value: unknown): StaleApprovalBindingV2["reviewed"] | undefined {
  if (!isRecord(value) || !hasOnlyDataProperties(value) || Reflect.ownKeys(value).length !== 3 || !hasOnlyKeys(value, ["activeVersionId", "activeSemanticHash", "comparisonDigest"])) return undefined;
  const activeVersionId = ownDataValue(value, "activeVersionId");
  const activeSemanticHash = ownDataValue(value, "activeSemanticHash");
  const comparisonDigest = ownDataValue(value, "comparisonDigest");
  if (!((activeVersionId === null && activeSemanticHash === null) || (validShortText(activeVersionId) && validShortText(activeSemanticHash))) || !validShortText(comparisonDigest)) return undefined;
  return { activeVersionId, activeSemanticHash, comparisonDigest };
}

function snapshotV2Binding(value: unknown): StaleApprovalBindingV2 | undefined {
  if (!isRecord(value) || !hasOnlyDataProperties(value) || Reflect.ownKeys(value).length !== 9 || !hasOnlyKeys(value, ["action", "projectId", "beaconId", "draftId", "expectedRevision", "semanticHash", "requestId", "staleOriginAcknowledged", "reviewed"])) return undefined;
  const reviewed = snapshotReviewed(ownDataValue(value, "reviewed"));
  const action = ownDataValue(value, "action");
  const projectId = ownDataValue(value, "projectId");
  const beaconId = ownDataValue(value, "beaconId");
  const draftId = ownDataValue(value, "draftId");
  const expectedRevision = ownDataValue(value, "expectedRevision");
  const semanticHash = ownDataValue(value, "semanticHash");
  const requestId = ownDataValue(value, "requestId");
  if (!reviewed || action !== "approve" || ownDataValue(value, "staleOriginAcknowledged") !== true || !validShortText(projectId) || !validShortText(beaconId) || !validShortText(draftId) || !validPositiveSafeInteger(expectedRevision) || !validShortText(semanticHash) || !validShortText(requestId)) return undefined;
  return { action, projectId, beaconId, draftId, expectedRevision, semanticHash, requestId, staleOriginAcknowledged: true, reviewed };
}

function requestIdHint(request: unknown): string {
  if (!isRecord(request)) return "";
  const bindingDescriptor = Object.getOwnPropertyDescriptor(request, "binding");
  if (bindingDescriptor === undefined || !("value" in bindingDescriptor) || !isRecord(bindingDescriptor.value)) return "";
  const requestIdDescriptor = Object.getOwnPropertyDescriptor(bindingDescriptor.value, "requestId");
  return requestIdDescriptor !== undefined && "value" in requestIdDescriptor && typeof requestIdDescriptor.value === "string" ? requestIdDescriptor.value : "";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function isForbiddenResultKey(key: string): boolean {
  return /^(privateKey|capability|secret|token|grant|signature)$/i.test(key);
}

function jsonSnapshot(value: unknown, active: WeakSet<object> = new WeakSet<object>(), resultMode = true): JsonValue | undefined {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "object") return undefined;
  if (active.has(value)) return undefined;
  active.add(value);
  try {
    if (Array.isArray(value)) {
      if (hasToJsonDescriptor(value)) return undefined;
      const expectedKeys = Array.from({ length: value.length }, (_unused, index) => String(index));
      const ownNames = Object.getOwnPropertyNames(value).filter((key) => key !== "length");
      if (ownNames.length !== expectedKeys.length || ownNames.some((key, index) => key !== expectedKeys[index])) return undefined;
      const snapshot: JsonValue[] = [];
      const descriptors = Object.getOwnPropertyDescriptors(value);
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (descriptor === undefined || !("value" in descriptor)) return undefined;
        const item = jsonSnapshot(descriptor.value, active, resultMode);
        if (item === undefined) return undefined;
        snapshot.push(item);
      }
      return snapshot as unknown as JsonValue;
    }
    if (!isPlainObject(value) || Object.getOwnPropertyNames(value).length !== Object.keys(value).length || Object.hasOwn(value, "toJSON")) return undefined;
    const snapshot = Object.create(null) as Record<string, JsonValue>;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const key of Object.keys(value)) {
      if (resultMode && isForbiddenResultKey(key)) return undefined;
      const descriptor = descriptors[key];
      if (descriptor === undefined || !("value" in descriptor)) return undefined;
      const itemSnapshot = jsonSnapshot(descriptor.value, active, resultMode);
      if (itemSnapshot === undefined) return undefined;
      Object.defineProperty(snapshot, key, { value: itemSnapshot, enumerable: true, configurable: true, writable: true });
    }
    return snapshot as unknown as JsonValue;
  } finally {
    active.delete(value);
  }
}

// Exact signed material only: encoded, transformed, or model-authored results require a separate trusted output boundary.
function containsSignedMaterial(value: JsonValue, grant: AnyConsentGrant): boolean {
  const payload = grant.contract === "pharos.operator-consent-grant/2" ? canonicalConsentGrantPayloadV2(grant) : canonicalConsentGrantPayload(grant);
  const material = [grant.signature, canonical(grant), payload].filter((part): part is string => typeof part === "string" && part.length > 0);
  const visit = (item: JsonValue): boolean => {
    if (typeof item === "string") return material.some((part) => item.includes(part));
    if (item === null || typeof item !== "object") return false;
    if (canonical(item) === canonical(grant)) return true;
    return Array.isArray(item) ? item.some(visit) : Object.values(item).some(visit);
  };
  return visit(value);
}

function closedGrantShape(grant: unknown): boolean {
  if (!isRecord(grant)) return false;
  const binding = Object.getOwnPropertyDescriptor(grant, "binding");
  if (!binding || !("value" in binding) || !isRecord(binding.value)) return false;
  const expected = ["contract", "decision", "binding", "challengeId", "expiresAtEpochMs", "hostId", "keyId", "algorithm", "signature"];
  const bindingKeys = ownDataValue(binding.value, "action") === "approve"
    ? ["action", "projectId", "beaconId", "draftId", "expectedRevision", "semanticHash", "requestId", ...(Object.hasOwn(binding.value, "staleOriginAcknowledged") ? ["staleOriginAcknowledged"] : [])]
    : ["action", "projectId", "beaconId", "expectedActiveVersion", "reason", "requestId"];
  const reviewed = ownDataValue(binding.value, "reviewed");
  if (ownDataValue(grant, "contract") === "pharos.operator-consent-grant/2") {
    if (!isRecord(reviewed)) return false;
    bindingKeys.push("reviewed");
  }
  return [[grant, expected], [binding.value, bindingKeys], ...(isRecord(reviewed) ? [[reviewed, ["activeVersionId", "activeSemanticHash", "comparisonDigest"]]] : [])].every(([value, keys]) => {
    const record = value as Record<string, unknown>;
    const names = keys as string[];
    return Reflect.ownKeys(record).length === names.length && names.every(key => {
      const descriptor = Object.getOwnPropertyDescriptor(record, key);
      return descriptor !== undefined && descriptor.enumerable && "value" in descriptor;
    });
  });
}

function sameReviewedCommand(command: VerifiedApprovalCommand, reviewed: StaleApprovalBindingV2["reviewed"]): boolean {
  return command.reviewed !== undefined && canonical(command.reviewed) === canonical(reviewed);
}

function consistentVerifiedClaim(claim: StoredVerifiedClaim, request: StoredRequest): boolean {
  const grant = claim.grant;
  if (request.request.contract === "pharos.operator-consent-request/2") {
    if (claim.contract !== APPROVAL_CLAIM_CONTRACT || claim.grant.contract !== "pharos.operator-consent-grant/2" || !claim.approvalCommand || !sameReviewedCommand(claim.approvalCommand, request.request.binding.reviewed)) return false;
    return claim.requestId === request.requestId && claim.requestHash === request.requestHash && claim.actionHash === consentActionHash(request.request) && claim.verifiedAtEpochMs < request.request.expiresAtEpochMs && closedGrantShape(claim.grant) && matchConsentGrantV2(request.request, claim.grant, claim.verifiedAtEpochMs);
  }
  if (claim.grant.contract !== "pharos.operator-consent-grant/1") return false;
  if (claim.contract === REVOKE_CLAIM_CONTRACT && (request.request.binding.action !== "revoke" || claim.revokeCommand?.expectedActiveVersionId !== request.request.binding.expectedActiveVersion || claim.revokeCommand.reason !== request.request.binding.reason)) return false;
  return claim.requestId === request.requestId && claim.requestHash === request.requestHash &&
    claim.actionHash === consentActionHash(request.request) && claim.verifiedAtEpochMs < request.request.expiresAtEpochMs &&
    closedGrantShape(grant) && matchConsentGrant(request.request, grant,
      { status: "verified", hostId: grant.hostId, keyId: grant.keyId },
      { status: "active", hostId: grant.hostId, keyId: grant.keyId }, claim.verifiedAtEpochMs).ok;
}

function isJsonValue(value: unknown): value is JsonValue {
  return jsonSnapshot(value) !== undefined;
}

function storedRequestFrom(value: unknown): StoredRequest | undefined {
  if (!isRecord(value) || value.contract !== REQUEST_CONTRACT || typeof value.requestId !== "string" || typeof value.requestHash !== "string" || typeof value.auditId !== "string") return undefined;
  const request = value.request as AnyConsentRequest;
  if (!validRequest(request) || requestIdOf(request) !== value.requestId || auditId(value.requestId) !== value.auditId || requestHash(request) !== value.requestHash) return undefined;
  return { contract: REQUEST_CONTRACT, requestId: value.requestId, requestHash: value.requestHash, request, auditId: value.auditId };
}

function claimFrom(value: unknown): StoredClaim | undefined {
  if (!isRecord(value) || value.contract !== CLAIM_CONTRACT || typeof value.requestId !== "string" || typeof value.actionHash !== "string" || value.actionHash.length === 0 || value.auditId !== auditId(value.requestId)) return undefined;
  return { contract: CLAIM_CONTRACT, requestId: value.requestId, actionHash: value.actionHash, auditId: value.auditId };
}

function approvalCommandFrom(value: unknown): VerifiedApprovalCommand | undefined {
  const reviewed = isRecord(value) && Object.hasOwn(value, "reviewed") ? snapshotReviewed(ownDataValue(value, "reviewed")) : undefined;
  if (!isRecord(value) || (Object.hasOwn(value, "reviewed") && !reviewed) || !hasOnlyKeys(value, ["versionId", "approvedAt", "actor", "bindingHash"], ["reviewed"]) ||
    Reflect.ownKeys(value).length !== (reviewed ? 5 : 4) || !hasOnlyDataProperties(value) ||
    !validShortText(value.versionId) || !validShortText(value.approvedAt) ||
    (value.actor !== null && !validShortText(value.actor)) || !validShortText(value.bindingHash)) return undefined;
  return { versionId: value.versionId, approvedAt: value.approvedAt, actor: value.actor, bindingHash: value.bindingHash, ...(reviewed ? { reviewed } : {}) };
}

function revokeCommandFrom(value: unknown): VerifiedRevokeCommand | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, ["expectedActiveVersionId", "reason", "revokedAt", "actor", "bindingHash"]) ||
    Reflect.ownKeys(value).length !== 5 || !hasOnlyDataProperties(value) || !validShortText(value.expectedActiveVersionId) ||
    !validReason(value.reason) || !validShortText(value.revokedAt) || (value.actor !== null && !validShortText(value.actor)) || !validShortText(value.bindingHash)) return undefined;
  return { expectedActiveVersionId: value.expectedActiveVersionId, reason: value.reason, revokedAt: value.revokedAt, actor: value.actor, bindingHash: value.bindingHash };
}

function verifiedClaimFrom(value: unknown): StoredVerifiedClaim | undefined {
  if (!isRecord(value) || (value.contract !== VERIFIED_CLAIM_CONTRACT && value.contract !== APPROVAL_CLAIM_CONTRACT && value.contract !== REVOKE_CLAIM_CONTRACT) || !hasOnlyKeys(value, ["contract", "requestId", "requestHash", "actionHash", "grant", "verifiedAtEpochMs", "auditId", ...(value.contract === APPROVAL_CLAIM_CONTRACT ? ["approvalCommand"] : []), ...(value.contract === REVOKE_CLAIM_CONTRACT ? ["revokeCommand"] : [])]) ||
    (value.contract === REVOKE_CLAIM_CONTRACT && revokeCommandFrom(value.revokeCommand)?.bindingHash !== value.actionHash) ||
    (value.contract === APPROVAL_CLAIM_CONTRACT && (approvalCommandFrom(value.approvalCommand)?.bindingHash !== value.actionHash)) ||
    typeof value.requestId !== "string" || typeof value.requestHash !== "string" || typeof value.actionHash !== "string" || !value.actionHash ||
    !validEpoch(value.verifiedAtEpochMs) || value.auditId !== auditId(value.requestId)) return undefined;
  return value as unknown as StoredVerifiedClaim;
}

function terminalFrom(value: unknown): StoredTerminal | undefined {
  if (!isRecord(value) || (value.contract !== TERMINAL_CONTRACT && value.contract !== VERIFIED_TERMINAL_CONTRACT) || typeof value.requestId !== "string" || value.auditId !== auditId(value.requestId)) return undefined;
  if (value.contract === TERMINAL_CONTRACT && value.status === "declined" && typeof value.reason === "string") return { contract: TERMINAL_CONTRACT, status: "declined", requestId: value.requestId, reason: value.reason, auditId: value.auditId };
  if (value.status === "consumed" && typeof value.actionHash === "string" && isJsonValue(value.result)) return { contract: value.contract, status: "consumed", requestId: value.requestId, actionHash: value.actionHash, result: value.result, auditId: value.auditId };
  return undefined;
}

function toRecord(value: StoredRequest | StoredClaim | StoredVerifiedClaim | StoredTerminal): ConsentRecord {
  if (value.contract === REQUEST_CONTRACT) return { status: "pending", request: value.request, auditId: value.auditId };
  if (value.contract === CLAIM_CONTRACT || value.contract === VERIFIED_CLAIM_CONTRACT || value.contract === APPROVAL_CLAIM_CONTRACT || value.contract === REVOKE_CLAIM_CONTRACT) return { status: "claimed", provenance: value.contract === CLAIM_CONTRACT ? "unauthenticated" : "verified", requestId: value.requestId, actionHash: value.actionHash, auditId: value.auditId, ...(value.contract === APPROVAL_CLAIM_CONTRACT ? { approvalCommand: value.approvalCommand } : {}), ...(value.contract === REVOKE_CLAIM_CONTRACT ? { revokeCommand: value.revokeCommand } : {}) };
  if ("status" in value && value.status === "declined") return { status: "declined", requestId: value.requestId, reason: value.reason, auditId: value.auditId };
  if ("status" in value && value.status === "consumed") return { status: "consumed", provenance: value.contract === VERIFIED_TERMINAL_CONTRACT ? "verified" : "unauthenticated", requestId: value.requestId, actionHash: value.actionHash, result: value.result, auditId: value.auditId };
  throw new Error("Invalid consent record");
}

export class FsConsentStore implements OperatorConsentStore {
  private readonly projectRoot: string;
  private readonly lock: ProjectLock;
  private readonly activeHostKey?: ActiveHostPublicKeyLookup;
  private readonly clock: () => number;

  private effectiveNow(callerNow: number): number {
    return Math.max(callerNow, this.clock());
  }

  constructor(options: FsConsentStoreOptions) {
    this.projectRoot = options.projectRoot;
    this.lock = options.lock ?? new ProjectLock(options.projectRoot);
    this.activeHostKey = options.activeHostKey;
    this.clock = options.clock ?? Date.now;
  }

  actionHash(request: AnyConsentRequest): string {
    return consentActionHash(request);
  }

  /** Host-only recovery material. Never route this method through a CLI or model tool. */
  async recoveryClaim(requestId: string): Promise<{ readonly request: AnyConsentRequest; readonly auditId: string; readonly grant: AnyConsentGrant } | undefined> {
    if (!isValidId(requestId)) return undefined;
    const acquired = await this.lock.acquire();
    if (!acquired.ok) return undefined;
    try {
      await this.ensureExistingLayoutIfPresent();
      const request = await this.request(requestId);
      if (!request) return undefined;
      const claim = await this.verifiedClaim(requestId);
      if (!claim || (claim.contract !== APPROVAL_CLAIM_CONTRACT && claim.contract !== REVOKE_CLAIM_CONTRACT) ||
        claim.grant.binding.projectId !== request.request.binding.projectId ||
        claim.grant.binding.action !== request.request.binding.action) return undefined;
      const terminal = await this.terminal(requestId);
      if (terminal && (terminal.status !== "consumed" || terminal.contract !== VERIFIED_TERMINAL_CONTRACT || terminal.actionHash !== claim.actionHash)) return undefined;
      return { request: request.request, auditId: request.auditId, grant: claim.grant };
    } finally {
      await acquired.value.release();
    }
  }

  async getChallenge(requestId: string, nowEpochMs: number): Promise<Result<ConsentRecord | undefined, ConsentStoreError>> {
    if (!isValidId(requestId) || !validNow(nowEpochMs)) return err({ rule: "invalid-consent-request", requestId });
    const acquired = await this.lock.acquire();
    if (!acquired.ok) return err({ rule: "consent-request-conflict", requestId });
    try {
      await this.ensureExistingLayoutIfPresent();
      const stored = await this.request(requestId);
      if (stored === undefined) return ok(undefined);
      const terminal = await this.terminal(requestId);
      if (terminal !== undefined) {
        const claim = terminal.status === "consumed" && terminal.contract === VERIFIED_TERMINAL_CONTRACT ? await this.verifiedClaim(requestId) : undefined;
        return ok({ ...toRecord(terminal), ...(claim?.contract === APPROVAL_CLAIM_CONTRACT ? { approvalCommand: claim.approvalCommand } : {}), ...(claim?.contract === REVOKE_CLAIM_CONTRACT ? { revokeCommand: claim.revokeCommand } : {}) });
      }
      const claim = await this.claim(requestId);
      if (claim !== undefined) return ok(toRecord(claim));
      if (this.effectiveNow(nowEpochMs) >= stored.request.expiresAtEpochMs) return err({ rule: "consent-expired", requestId });
      return ok(toRecord(stored));
    } finally {
      await acquired.value.release();
    }
  }

  async createChallenge(request: AnyConsentRequest, nowEpochMs: number): Promise<Result<ConsentRecord, ConsentStoreError>> {
    const snapshot = snapshotRequest(request);
    const requestId = snapshot?.binding.requestId ?? requestIdHint(request);
    if (!validNow(nowEpochMs) || snapshot === undefined || !isValidId(requestId)) return err({ rule: "invalid-consent-request", requestId });

    const acquired = await this.lock.acquire();
    if (!acquired.ok) return err({ rule: "consent-request-conflict", requestId });
    const lease = acquired.value;
    try {
      const record: StoredRequest = { contract: REQUEST_CONTRACT, requestId, requestHash: requestHash(snapshot), request: snapshot, auditId: auditId(requestId) };
      await this.ensureExistingLayoutIfPresent();
      const existing = await this.request(requestId);
      if (existing !== undefined) {
        if (existing.requestHash !== record.requestHash) return err({ rule: "consent-request-conflict", requestId });
        const existingTerminal = await this.terminal(requestId);
        if (existingTerminal !== undefined) {
          const claim = existingTerminal.status === "consumed" && existingTerminal.contract === VERIFIED_TERMINAL_CONTRACT ? await this.verifiedClaim(requestId) : undefined;
          return ok({ ...toRecord(existingTerminal), ...(claim?.contract === APPROVAL_CLAIM_CONTRACT ? { approvalCommand: claim.approvalCommand } : {}), ...(claim?.contract === REVOKE_CLAIM_CONTRACT ? { revokeCommand: claim.revokeCommand } : {}) });
        }
        const existingClaim = await this.claim(requestId);
        if (existingClaim !== undefined) return ok(toRecord(existingClaim));
        if (this.effectiveNow(nowEpochMs) >= snapshot.expiresAtEpochMs) return err({ rule: "consent-expired", requestId });
        return ok(toRecord(existing));
      }
      if (this.effectiveNow(nowEpochMs) >= snapshot.expiresAtEpochMs) return err({ rule: "consent-expired", requestId });
      await this.ensureLayout();
      const path = this.requestPath(requestId);
      const created = await createPrivateJson(path, record);
      const stored = created === "created" ? record : storedRequestFrom(await readJson(path));
      if (stored === undefined) throw new Error(`Invalid consent request record: ${requestId}`);
      if (this.effectiveNow(nowEpochMs) >= stored.request.expiresAtEpochMs) return err({ rule: "consent-expired", requestId });
      return ok(toRecord(stored));
    } finally {
      await lease.release();
    }
  }

  async decline(requestId: string, reason: string, nowEpochMs: number): Promise<Result<ConsentRecord, ConsentStoreError>> {
    if (!validNow(nowEpochMs) || typeof reason !== "string") return err({ rule: "invalid-consent-request", requestId });
    const acquired = await this.lock.acquire();
    if (!acquired.ok) return err({ rule: "consent-request-conflict", requestId });
    const lease = acquired.value;
    try {
      await this.ensureLayout();
      const existing = await this.terminal(requestId);
      if (existing !== undefined) return existing.status === "declined" && existing.reason === reason ? ok(toRecord(existing)) : err({ rule: "consent-consumption-conflict", requestId });
      const claim = await this.claim(requestId);
      if (claim !== undefined) return err({ rule: "consent-consumption-conflict", requestId });
      const pending = await this.pending(requestId, nowEpochMs);
      if (!pending.ok) return pending;
      const terminal: StoredDecline = { contract: TERMINAL_CONTRACT, status: "declined", requestId, reason, auditId: auditId(requestId) };
      await createPrivateJson(this.terminalPath(requestId), terminal);
      return ok(toRecord(terminal));
    } finally {
      await lease.release();
    }
  }

  /** Claims the one-time authority before a caller performs an idempotent lifecycle mutation. */
  async beginConsumption(requestId: string, actionHash: string, nowEpochMs: number): Promise<Result<ConsentRecord, ConsentStoreError>> {
    if (!validNow(nowEpochMs) || typeof actionHash !== "string" || actionHash.length === 0) return err({ rule: "invalid-consent-request", requestId });
    const acquired = await this.lock.acquire();
    if (!acquired.ok) return err({ rule: "consent-request-conflict", requestId });
    const lease = acquired.value;
    try {
      await this.ensureLayout();
      const existing = await this.terminal(requestId);
      if (existing !== undefined) return existing.status === "declined" ? err({ rule: "consent-already-declined", requestId }) : (existing.contract === TERMINAL_CONTRACT && existing.actionHash === actionHash ? ok(toRecord(existing)) : err({ rule: "consent-consumption-conflict", requestId }));
      const existingClaim = await this.claim(requestId);
      if (existingClaim !== undefined) return existingClaim.contract === CLAIM_CONTRACT && existingClaim.actionHash === actionHash ? ok(toRecord(existingClaim)) : err({ rule: "consent-consumption-conflict", requestId });
      const pending = await this.pending(requestId, nowEpochMs);
      if (!pending.ok) return pending;
      const claim: StoredClaim = { contract: CLAIM_CONTRACT, requestId, actionHash, auditId: auditId(requestId) };
      const created = await createPrivateJson(this.claimPath(requestId), claim);
      const stored = created === "created" ? claim : claimFrom(await readJson(this.claimPath(requestId)));
      if (stored === undefined) throw new Error(`Invalid consent claim record: ${requestId}`);
      return stored.actionHash === actionHash ? ok(toRecord(stored)) : err({ rule: "consent-consumption-conflict", requestId });
    } finally {
      await lease.release();
    }
  }

  async beginVerifiedApproval(requestId: string, actionHash: string, grant: AnyConsentGrant, command: VerifiedApprovalCommand, nowEpochMs: number): Promise<Result<ConsentRecord, ConsentStoreError>> {
    const snapshot = approvalCommandFrom(command);
    if (!snapshot || snapshot.bindingHash !== actionHash) return err({ rule: "invalid-consent-request", requestId });
    return this.beginVerifiedConsumptionInternal(requestId, actionHash, grant, nowEpochMs, snapshot);
  }

  async beginVerifiedRevocation(requestId: string, actionHash: string, grant: ConsentGrant, command: VerifiedRevokeCommand, nowEpochMs: number): Promise<Result<ConsentRecord, ConsentStoreError>> {
    const snapshot = revokeCommandFrom(command);
    if (!snapshot || snapshot.bindingHash !== actionHash) return err({ rule: "invalid-consent-request", requestId });
    return this.beginVerifiedConsumptionInternal(requestId, actionHash, grant, nowEpochMs, undefined, snapshot);
  }

  /** Only this guarded entry point creates resumable verified authority. Legacy claims remain unverified. */
  async beginVerifiedConsumption(requestId: string, actionHash: string, grant: ConsentGrant, nowEpochMs: number): Promise<Result<ConsentRecord, ConsentStoreError>> {
    return this.beginVerifiedConsumptionInternal(requestId, actionHash, grant, nowEpochMs);
  }

  private async beginVerifiedConsumptionInternal(requestId: string, actionHash: string, grant: AnyConsentGrant, nowEpochMs: number, approvalCommand?: VerifiedApprovalCommand, revokeCommand?: VerifiedRevokeCommand): Promise<Result<ConsentRecord, ConsentStoreError>> {
    if (!validNow(nowEpochMs) || typeof actionHash !== "string" || !actionHash || !this.activeHostKey) return err({ rule: "invalid-consent-request", requestId });
    const acquired = await this.lock.acquire();
    if (!acquired.ok) return err({ rule: "consent-request-conflict", requestId });
    const lease = acquired.value;
    try {
      await this.ensureLayout();
      const pendingRequest = await this.request(requestId);
      if (pendingRequest === undefined) return err({ rule: "consent-not-found", requestId });
      if (actionHash !== consentActionHash(pendingRequest.request)) return err({ rule: "consent-consumption-conflict", requestId });
      const legacy = await this.claim(requestId);
      if (legacy?.contract === CLAIM_CONTRACT) return err({ rule: "consent-consumption-conflict", requestId });
      const terminal = await this.terminal(requestId);
      if (terminal?.status === "declined") return err({ rule: "consent-already-declined", requestId });
      if (!closedGrantShape(grant)) return err({ rule: "invalid-consent-request", requestId });
      const snapshot = jsonSnapshot(grant, new WeakSet<object>(), false);
      if (!isRecord(snapshot)) return err({ rule: "invalid-consent-request", requestId });
      const signed = snapshot as unknown as AnyConsentGrant;
      const previous = await this.verifiedClaim(requestId);
      if (pendingRequest.request.contract === "pharos.operator-consent-request/2" && (!approvalCommand || !sameReviewedCommand(approvalCommand, pendingRequest.request.binding.reviewed))) return err({ rule: "consent-consumption-conflict", requestId });
      if (pendingRequest.request.contract === "pharos.operator-consent-request/1" && approvalCommand?.reviewed !== undefined) return err({ rule: "consent-consumption-conflict", requestId });
      if (previous !== undefined) {
        // Persisted evidence is used only for the same exact signed input and request;
        // a rotated key need not remain active for this already-durable claim.
        if (previous.requestHash !== pendingRequest.requestHash || previous.actionHash !== actionHash ||
          (previous.contract === APPROVAL_CLAIM_CONTRACT) !== (approvalCommand !== undefined) ||
          (previous.contract === REVOKE_CLAIM_CONTRACT) !== (revokeCommand !== undefined) ||
          canonical(previous.grant) !== canonical(signed) || previous.verifiedAtEpochMs >= pendingRequest.request.expiresAtEpochMs ||
          (approvalCommand !== undefined && (previous.contract !== APPROVAL_CLAIM_CONTRACT || canonical(previous.approvalCommand) !== canonical(approvalCommand))) ||
          (revokeCommand !== undefined && (previous.contract !== REVOKE_CLAIM_CONTRACT || canonical(previous.revokeCommand) !== canonical(revokeCommand))))
          return err({ rule: "consent-consumption-conflict", requestId });
        return terminal === undefined ? ok(toRecord(previous)) : terminal.contract === VERIFIED_TERMINAL_CONTRACT && terminal.status === "consumed" && terminal.actionHash === actionHash ? ok(this.consumedRecord(terminal, previous)) : err({ rule: "consent-consumption-conflict", requestId });
      }
      if (terminal !== undefined) return err({ rule: "consent-consumption-conflict", requestId });
      if (this.effectiveNow(nowEpochMs) >= pendingRequest.request.expiresAtEpochMs) return err({ rule: "consent-expired", requestId });
      // Snapshot before calling third-party code: reject accessors and mutable malformed grants.
      const verification = pendingRequest.request.contract === "pharos.operator-consent-request/2" && signed.contract === "pharos.operator-consent-grant/2"
        ? await verifyEd25519ConsentV2(pendingRequest.request, signed, this.effectiveNow(nowEpochMs), this.activeHostKey)
        : pendingRequest.request.contract === "pharos.operator-consent-request/1" && signed.contract === "pharos.operator-consent-grant/1"
          ? await verifyEd25519Consent(pendingRequest.request, signed, this.effectiveNow(nowEpochMs), this.activeHostKey)
          : { status: "rejected" as const };
      if (this.effectiveNow(nowEpochMs) >= pendingRequest.request.expiresAtEpochMs) return err({ rule: "consent-expired", requestId });
      if (verification.status !== "verified") return err({ rule: "invalid-consent-request", requestId });
      const verifiedAtEpochMs = this.effectiveNow(nowEpochMs);
      if (verifiedAtEpochMs >= pendingRequest.request.expiresAtEpochMs) return err({ rule: "consent-expired", requestId });
      if (pendingRequest.request.contract === "pharos.operator-consent-request/2" && (!approvalCommand || !sameReviewedCommand(approvalCommand, pendingRequest.request.binding.reviewed))) return err({ rule: "consent-consumption-conflict", requestId });
      if (pendingRequest.request.contract === "pharos.operator-consent-request/1" && approvalCommand?.reviewed !== undefined) return err({ rule: "consent-consumption-conflict", requestId });
      if (approvalCommand && pendingRequest.request.binding.action !== "approve") return err({ rule: "consent-consumption-conflict", requestId });
      if (revokeCommand && (pendingRequest.request.binding.action !== "revoke" || revokeCommand.expectedActiveVersionId !== pendingRequest.request.binding.expectedActiveVersion || revokeCommand.reason !== pendingRequest.request.binding.reason)) return err({ rule: "consent-consumption-conflict", requestId });
      const claim: StoredVerifiedClaim = { contract: approvalCommand ? APPROVAL_CLAIM_CONTRACT : revokeCommand ? REVOKE_CLAIM_CONTRACT : VERIFIED_CLAIM_CONTRACT, ...(approvalCommand ? { approvalCommand } : {}), ...(revokeCommand ? { revokeCommand } : {}), requestId, requestHash: pendingRequest.requestHash, actionHash, grant: signed, verifiedAtEpochMs, auditId: auditId(requestId) };
      const created = await createPrivateJson(this.claimPath(requestId), claim);
      if (created !== "created") return err({ rule: "consent-consumption-conflict", requestId });
      return ok(toRecord(claim));
    } finally {
      await lease.release();
    }
  }

  /** Completes a previously claimed authority with the idempotent lifecycle result. Terminal replay ignores expiry. */
  async completeConsumption(requestId: string, actionHash: string, result: JsonValue, nowEpochMs: number): Promise<Result<ConsentRecord, ConsentStoreError>> {
    return this.finishConsumption(requestId, actionHash, result, nowEpochMs, false);
  }

  private async finishConsumption(requestId: string, actionHash: string, result: JsonValue, nowEpochMs: number, verified: boolean): Promise<Result<ConsentRecord, ConsentStoreError>> {
    const resultSnapshot = jsonSnapshot(result);
    if (!validNow(nowEpochMs) || typeof actionHash !== "string" || actionHash.length === 0 || resultSnapshot === undefined) return err({ rule: "invalid-consent-request", requestId });
    const acquired = await this.lock.acquire();
    if (!acquired.ok) return err({ rule: "consent-request-conflict", requestId });
    const lease = acquired.value;
    try {
      await this.ensureLayout();
      const existing = await this.terminal(requestId);
      if (existing !== undefined) {
        if (existing.status === "declined") return err({ rule: "consent-already-declined", requestId });
        if (verified && existing.contract === VERIFIED_TERMINAL_CONTRACT) {
          const claim = await this.verifiedClaim(requestId);
          if (claim && containsSignedMaterial(resultSnapshot, claim.grant)) return err({ rule: "invalid-consent-request", requestId });
        }
        return existing.contract === (verified ? VERIFIED_TERMINAL_CONTRACT : TERMINAL_CONTRACT) && existing.actionHash === actionHash ? ok(verified ? this.consumedRecord(existing, await this.verifiedClaim(requestId)) : toRecord(existing)) : err({ rule: "consent-consumption-conflict", requestId });
      }
      const claim = await this.claim(requestId);
      if (claim === undefined) return err({ rule: "consent-not-claimed", requestId });
      if (claim.actionHash !== actionHash || (claim.contract === CLAIM_CONTRACT) === verified) return err({ rule: "consent-consumption-conflict", requestId });
      if (claim.contract !== CLAIM_CONTRACT && containsSignedMaterial(resultSnapshot, claim.grant)) return err({ rule: "invalid-consent-request", requestId });
      const terminal: StoredConsumption = { contract: verified ? VERIFIED_TERMINAL_CONTRACT : TERMINAL_CONTRACT, status: "consumed", requestId, actionHash, result: resultSnapshot, auditId: auditId(requestId) };
      await createPrivateJson(this.terminalPath(requestId), terminal);
      return ok(verified ? this.consumedRecord(terminal, claim) : toRecord(terminal));
    } finally {
      await lease.release();
    }
  }

  /** Adds only the command from a validated persisted approval claim, never caller input or signed material. */
  private consumedRecord(terminal: StoredTerminal, claim: StoredVerifiedClaim | StoredClaim | undefined): ConsentRecord {
    return { ...toRecord(terminal), ...(terminal.contract === VERIFIED_TERMINAL_CONTRACT && terminal.status === "consumed" && claim?.contract === APPROVAL_CLAIM_CONTRACT ? { approvalCommand: claim.approvalCommand } : {}), ...(terminal.contract === VERIFIED_TERMINAL_CONTRACT && terminal.status === "consumed" && claim?.contract === REVOKE_CLAIM_CONTRACT ? { revokeCommand: claim.revokeCommand } : {}) } as ConsentRecord;
  }

  /** Only verified claims can produce verified terminal provenance. */
  async completeVerifiedConsumption(requestId: string, actionHash: string, result: JsonValue, nowEpochMs: number): Promise<Result<ConsentRecord, ConsentStoreError>> {
    return this.finishConsumption(requestId, actionHash, result, nowEpochMs, true);
  }

  private async pending(requestId: string, nowEpochMs: number): Promise<Result<StoredRequest, ConsentStoreError>> {
    if (!validNow(nowEpochMs)) return err({ rule: "invalid-consent-request", requestId });
    if (!isValidId(requestId)) return err({ rule: "consent-not-found", requestId });
    let stored: StoredRequest | undefined;
    try {
      const path = this.requestPath(requestId);
      await this.ensurePrivateFile(path);
      stored = storedRequestFrom(await readJson(path));
    } catch (error) {
      if (isErrno(error, "ENOENT")) return err({ rule: "consent-not-found", requestId });
      throw error;
    }
    if (stored === undefined) throw new Error(`Invalid consent request record: ${requestId}`);
    if (this.effectiveNow(nowEpochMs) >= stored.request.expiresAtEpochMs) return err({ rule: "consent-expired", requestId });
    return ok(stored);
  }

  private async request(requestId: string): Promise<StoredRequest | undefined> {
    try {
      const path = this.requestPath(requestId);
      await this.ensurePrivateFile(path);
      const stored = storedRequestFrom(await readJson(path));
      if (stored === undefined) throw new Error(`Invalid consent request record: ${requestId}`);
      return stored;
    } catch (error) {
      if (isErrno(error, "ENOENT")) return undefined;
      throw error;
    }
  }

  private async claim(requestId: string): Promise<StoredClaim | StoredVerifiedClaim | undefined> {
    try {
      const path = this.claimPath(requestId);
      await this.ensurePrivateFile(path);
      const value = await readJson(path);
      const stored = claimFrom(value) ?? verifiedClaimFrom(value);
      if (stored === undefined) throw new Error(`Invalid consent claim record: ${requestId}`);
      if (stored.contract !== CLAIM_CONTRACT) {
        const request = await this.request(requestId);
        if (!request || !consistentVerifiedClaim(stored, request)) throw new Error(`Invalid consent claim record: ${requestId}`);
      }
      return stored;
    } catch (error) {
      if (isErrno(error, "ENOENT")) return undefined;
      throw error;
    }
  }

  private async verifiedClaim(requestId: string): Promise<StoredVerifiedClaim | undefined> {
    try {
      const path = this.claimPath(requestId);
      await this.ensurePrivateFile(path);
      const value = await readJson(path);
      const stored = verifiedClaimFrom(value);
      if (stored === undefined && claimFrom(value) === undefined) throw new Error(`Invalid consent claim record: ${requestId}`);
      if (stored) {
        const request = await this.request(requestId);
        if (!request || !consistentVerifiedClaim(stored, request)) throw new Error(`Invalid consent claim record: ${requestId}`);
      }
      return stored;
    } catch (error) {
      if (isErrno(error, "ENOENT")) return undefined;
      throw error;
    }
  }

  private async terminal(requestId: string): Promise<StoredTerminal | undefined> {
    try {
      const path = this.terminalPath(requestId);
      await this.ensurePrivateFile(path);
      const stored = terminalFrom(await readJson(path));
      if (stored === undefined) throw new Error(`Invalid consent terminal record: ${requestId}`);
      if (stored.contract === VERIFIED_TERMINAL_CONTRACT && stored.status === "consumed") {
        const claim = await this.verifiedClaim(requestId);
        const request = await this.request(requestId);
        if (claim === undefined || request === undefined || !consistentVerifiedClaim(claim, request) ||
          claim.actionHash !== consentActionHash(request.request) || claim.actionHash !== stored.actionHash ||
          containsSignedMaterial(stored.result, claim.grant))
          throw new Error(`Invalid consent terminal record: ${requestId}`);
      }
      return stored;
    } catch (error) {
      if (isErrno(error, "ENOENT")) return undefined;
      throw error;
    }
  }

  private async ensurePrivateFile(path: string): Promise<void> {
    const entry = await lstat(path);
    if (entry.isSymbolicLink() || !entry.isFile()) throw new Error(`Refusing symlinked or non-regular private state file: ${path}`);
    if ((entry.mode & 0o777) !== 0o600) await chmod(path, 0o600);
  }

  private async ensureExistingLayoutIfPresent(): Promise<void> {
    try {
      await lstat(join(this.projectRoot, "consent"));
    } catch (error) {
      if (isErrno(error, "ENOENT")) return;
      throw error;
    }
    await this.ensureLayout();
  }

  private async ensureLayout(): Promise<void> {
    await ensurePrivateDirectory(join(this.projectRoot, "consent"));
    await ensurePrivateDirectory(join(this.projectRoot, "consent", "requests"));
    await ensurePrivateDirectory(join(this.projectRoot, "consent", "claims"));
    await ensurePrivateDirectory(join(this.projectRoot, "consent", "terminals"));
  }

  private requestPath(requestId: string): string {
    if (!isValidId(requestId)) throw new Error(`Invalid consent request id: ${requestId}`);
    return join(this.projectRoot, "consent", "requests", `${requestId}.json`);
  }

  private claimPath(requestId: string): string {
    if (!isValidId(requestId)) throw new Error(`Invalid consent request id: ${requestId}`);
    return join(this.projectRoot, "consent", "claims", `${requestId}.json`);
  }

  private terminalPath(requestId: string): string {
    if (!isValidId(requestId)) throw new Error(`Invalid consent request id: ${requestId}`);
    return join(this.projectRoot, "consent", "terminals", `${requestId}.json`);
  }
}
