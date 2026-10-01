import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import { matchConsentGrant, matchConsentGrantV2, type ConsentGrantV2, type ConsentRequestV2, type ConsentGrant, type ConsentRequest, type GrantVerification, type HostConsentVerifier, type HostTrust } from "../../domain/ports/operator-consent.js";

/** Lookup returns only currently active Ed25519 SPKI DER bytes, or undefined for revoked/unknown hosts or keys.
 * Provisioning, persistence, rotation, and revocation are the caller's responsibility; an in-memory lookup is not production trust provisioning. */
export type ActiveHostPublicKeyLookup = (hostId: string, keyId: string) => Promise<Uint8Array | undefined>;

// DER SubjectPublicKeyInfo prefix: SEQUENCE(42), Ed25519 OID, BIT STRING(33), zero unused bits.
const ed25519SpkiPrefix = Buffer.from("302a300506032b6570032100", "hex");

/** Version 1 wire encoding: UTF-8 JSON of a positional array (no object-key order dependency):
 * ["pharos.operator-consent-grant/1", decision, [action, projectId, beaconId,
 * draftId, expectedRevision, semanticHash, requestId, staleOriginPresent, staleOriginValue]
 * for approval; [action, projectId, beaconId, expectedActiveVersion, reason, requestId]
 * for revocation, challengeId, expiresAtEpochMs, hostId, keyId, "ed25519"].
 * JSON.stringify uses ECMAScript JSON escaping and shortest numeric representation; strings
 * are exact UTF-16 values encoded as UTF-8 (no Unicode normalization). Signature is excluded.
 * Consumers must reject unknown versions, non-data objects and undeclared properties before encoding. */
export function canonicalConsentGrantPayload(grant: Omit<ConsentGrant, "signature">): Buffer | undefined {
  try {
    if (!plainData(grant) || !plainData(grant.binding)) return undefined;
    const b = grant.binding;
    const fields = b.action === "approve"
      ? [b.action, b.projectId, b.beaconId, b.draftId, b.expectedRevision, b.semanticHash, b.requestId, Object.hasOwn(b, "staleOriginAcknowledged"), b.staleOriginAcknowledged ?? null]
      : [b.action, b.projectId, b.beaconId, b.expectedActiveVersion, b.reason, b.requestId];
    return Buffer.from(JSON.stringify([grant.contract, grant.decision, fields, grant.challengeId, grant.expiresAtEpochMs, grant.hostId, grant.keyId, grant.algorithm]), "utf8");
  } catch { return undefined; }
}

/** Digest of the compared semantic projection hashes and active identity; caller derives hashes from trusted projections. */
export function staleComparisonDigest(draftSemanticHash: string, activeVersionId: string | null, activeSemanticHash: string | null): string | undefined {
  if (!draftSemanticHash || (activeVersionId === null) !== (activeSemanticHash === null) ||
    (activeVersionId !== null && (!activeVersionId || !activeSemanticHash))) return undefined;
  return `sha256:${createHash("sha256").update(JSON.stringify(["pharos.stale-comparison/2", draftSemanticHash, activeVersionId, activeSemanticHash])).digest("hex")}`;
}

export function canonicalConsentGrantPayloadV2(grant: Omit<ConsentGrantV2, "signature">): Buffer | undefined {
  try {
    if (!plainData(grant) || !plainData(grant.binding) || !plainData(grant.binding.reviewed)) return undefined;
    const b = grant.binding;
    const r = b.reviewed;
    return Buffer.from(JSON.stringify(["pharos.operator-consent-stale-approval/2", grant.contract, grant.decision,
      [b.action, b.projectId, b.beaconId, b.draftId, b.expectedRevision, b.semanticHash, b.requestId, b.staleOriginAcknowledged,
        r.activeVersionId, r.activeSemanticHash, r.comparisonDigest], grant.challengeId, grant.expiresAtEpochMs, grant.hostId, grant.keyId, grant.algorithm]), "utf8");
  } catch { return undefined; }
}

/** V2 is standalone until durable consent and locked Beacon approval consume it. */
export async function verifyEd25519ConsentV2(request: ConsentRequestV2, grant: ConsentGrantV2, nowEpochMs: number, lookup: ActiveHostPublicKeyLookup): Promise<GrantVerification> {
  const rejected = { status: "rejected" } as const;
  try {
    if (!plainData(request) || !plainData(request.binding) || !plainData(request.binding.reviewed) ||
      !plainData(grant) || !plainData(grant.binding) || !plainData(grant.binding.reviewed) ||
      !matchConsentGrantV2(request, grant, nowEpochMs) ||
      request.binding.reviewed.comparisonDigest !== staleComparisonDigest(request.binding.semanticHash, request.binding.reviewed.activeVersionId, request.binding.reviewed.activeSemanticHash)) return rejected;
    const signature = signatureBytes(grant.signature);
    const payload = canonicalConsentGrantPayloadV2(grant);
    if (!signature || !payload) return rejected;
    const key = await lookup(grant.hostId, grant.keyId);
    if (!key || !validPublicKey(key)) return rejected;
    return verifySignature(null, payload, createPublicKey({ key: Buffer.from(key), format: "der", type: "spki" }), signature)
      ? { status: "verified", hostId: grant.hostId, keyId: grant.keyId } : rejected;
  } catch { return rejected; }
}

function plainData(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return (proto === Object.prototype || proto === null) && Reflect.ownKeys(value).every(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return typeof key === "string" && descriptor !== undefined && descriptor.enumerable && "value" in descriptor;
  });
}

function signatureBytes(value: string): Buffer | undefined {
  if (!/^[A-Za-z0-9_-]{86}$/.test(value)) return undefined;
  const bytes = Buffer.from(value, "base64url");
  return bytes.length === 64 && bytes.toString("base64url") === value ? bytes : undefined;
}

export class Ed25519HostConsentVerifier implements HostConsentVerifier {
  readonly version = 1 as const;
  constructor(private readonly lookup: ActiveHostPublicKeyLookup) {}

  async trust(hostId: string, keyId: string): Promise<HostTrust> {
    try {
      const key = await this.lookup(hostId, keyId);
      return key && validPublicKey(key) ? { status: "active", hostId, keyId } : { status: "unknown" };
    } catch { return { status: "unknown" }; }
  }

  async verify(request: ConsentRequest, grant: ConsentGrant, nowEpochMs: number): Promise<GrantVerification> {
    return verifyEd25519Consent(request, grant, nowEpochMs, this.lookup);
  }
}

/** Authentic verification is a module function, not a caller-overridable verifier verdict. */
export async function verifyEd25519Consent(request: ConsentRequest, grant: ConsentGrant, nowEpochMs: number, lookup: ActiveHostPublicKeyLookup): Promise<GrantVerification> {
    const rejected = { status: "rejected" } as const;
    try {
      if (!plainData(request) || !plainData(request.binding) || !plainData(grant) || !plainData(grant.binding)) return rejected;
      // Reuse the closed domain validation, but never treat its structural result as evidence.
      if (!matchConsentGrant(request, grant, { status: "verified", hostId: grant.hostId, keyId: grant.keyId }, { status: "active", hostId: grant.hostId, keyId: grant.keyId }, nowEpochMs).ok) return rejected;
      const signature = signatureBytes(grant.signature);
      const payload = canonicalConsentGrantPayload(grant);
      if (!signature || !payload) return rejected;
      const key = await lookup(grant.hostId, grant.keyId);
      if (!key || !validPublicKey(key)) return rejected;
      const publicKey = createPublicKey({ key: Buffer.from(key), format: "der", type: "spki" });
      return verifySignature(null, payload, publicKey, signature) ? { status: "verified", hostId: grant.hostId, keyId: grant.keyId } : rejected;
    } catch { return rejected; }
}

function validPublicKey(key: Uint8Array): boolean {
  return key instanceof Uint8Array && key.length === 44 && Buffer.from(key.subarray(0, 12)).equals(ed25519SpkiPrefix);
}
