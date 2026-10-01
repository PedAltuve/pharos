import { describe, expect, it } from "vitest";
import { matchConsentGrant, rotateHostTrust, type ConsentGrant, type ConsentRequest } from "../../../src/domain/ports/operator-consent.js";

const binding = { action: "approve" as const, projectId: "p", beaconId: "b", draftId: "d", expectedRevision: 1, semanticHash: "sha256:x", requestId: "r", staleOriginAcknowledged: false };
const request = { contract: "pharos.operator-consent-request/1" as const, binding, challengeId: "c", expiresAtEpochMs: 1893456000000 };
const grant = { contract: "pharos.operator-consent-grant/1" as const, decision: "granted" as const, binding, challengeId: "c", expiresAtEpochMs: request.expiresAtEpochMs, hostId: "host", keyId: "key", algorithm: "ed25519", signature: "signed" };
const active = { status: "active" as const, hostId: "host", keyId: "key" };
const verified = { status: "verified" as const, hostId: "host", keyId: "key" };
const match = (candidate: unknown, trust: typeof active | { status: "revoked" | "unknown" } = active, now = 1893455999999) => matchConsentGrant(request, candidate, verified, trust, now);

describe("host consent authority boundary", () => {
  it("requires active trust for the exact host key after independent verification", () => {
    for (const trust of [{ status: "revoked" as const }, { status: "unknown" as const }, { ...active, keyId: "old" }, { ...active, hostId: "other" }]) {
      expect(match(grant, trust).ok).toBe(false);
    }
    expect(match(grant)).toEqual({ ok: true, value: { assurance: "operator_confirmed" } });
    for (const now of [-1, NaN, Infinity, 1.5, request.expiresAtEpochMs]) expect(match(grant, active, now).ok).toBe(false);
  });

  it("rotates a key atomically and refuses stale revisions and keys without changing state", () => {
    const initial = { hostId: "host", revision: 2, activeKeyId: "old", activePublicKey: "public-old", retiredKeyIds: [] as readonly string[] };
    const command = { hostId: "host", expectedRevision: 2, expectedKeyId: "old", nextKeyId: "next", nextPublicKey: "public-next" };
    const updated = rotateHostTrust(initial, command);
    expect(updated).toEqual({ ok: true, value: { hostId: "host", revision: 3, activeKeyId: "next", activePublicKey: "public-next", retiredKeyIds: ["old"] } });
    expect(rotateHostTrust(initial, { ...command, expectedRevision: 1 })).toEqual({ ok: false, error: "stale-host-trust" });
    expect(rotateHostTrust(initial, { ...command, expectedKeyId: "wrong" })).toEqual({ ok: false, error: "stale-host-trust" });
    expect(rotateHostTrust(initial, { ...command, nextKeyId: "old" }).ok).toBe(false);
    expect(initial).toEqual({ hostId: "host", revision: 2, activeKeyId: "old", activePublicKey: "public-old", retiredKeyIds: [] });
  });

  it("rejects undeclared grant and binding properties without changing the input", () => {
    const extraEnvelope = { ...grant, privateKey: "not-public" };
    const extraApproval = { ...grant, binding: { ...binding, privateKey: "not-public" } };
    const revokeBinding = { action: "revoke" as const, projectId: "p", beaconId: "b", expectedActiveVersion: "v", reason: "retire", requestId: "r" };
    const revokeRequest = { ...request, binding: revokeBinding };
    const extraRevoke = { ...grant, binding: { ...revokeBinding, privateKey: "not-public" } };
    expect(match(extraEnvelope).ok).toBe(false);
    expect(match(extraApproval).ok).toBe(false);
    expect(matchConsentGrant(revokeRequest, extraRevoke, verified, active, 1893455999999).ok).toBe(false);
    expect(extraEnvelope.privateKey).toBe("not-public");
    expect(extraApproval.binding.privateKey).toBe("not-public");
    expect(extraRevoke.binding.privateKey).toBe("not-public");
  });

  it("rejects hidden undeclared properties in requests, grants and both bindings", () => {
    const revokeBinding = { action: "revoke" as const, projectId: "p", beaconId: "b", expectedActiveVersion: "v", reason: "retire", requestId: "r" };
    for (const actionBinding of [binding, revokeBinding]) {
      const actionRequest = { ...request, binding: actionBinding };
      const actionGrant = { ...grant, binding: actionBinding };
      for (const location of ["request", "grant", "requestBinding", "grantBinding"] as const) {
        const candidateRequest = { ...actionRequest, binding: { ...actionBinding } };
        const candidateGrant = { ...actionGrant, binding: { ...actionBinding } };
        const target = location === "request" ? candidateRequest : location === "grant" ? candidateGrant : location === "requestBinding" ? candidateRequest.binding : candidateGrant.binding;
        Object.defineProperty(target, "privateKey", { value: "hidden", enumerable: false });
        expect(matchConsentGrant(candidateRequest, candidateGrant, verified, active, 1893455999999).ok).toBe(false);
        expect(Object.getOwnPropertyDescriptor(target, "privateKey")?.value).toBe("hidden");
      }
    }
  });

  it("rejects matching bindings with invalid field values", () => {
    const revisionZero = { ...binding, expectedRevision: 0 };
    const stringStale = { ...binding, staleOriginAcknowledged: "yes" };
    const revokeWhitespaceReason = { action: "revoke" as const, projectId: "p", beaconId: "b", expectedActiveVersion: "v", reason: " retire", requestId: "r" };
    const revokeEmptyVersion = { ...revokeWhitespaceReason, expectedActiveVersion: "", reason: "retire" };
    for (const malformedBinding of [revisionZero, stringStale, revokeWhitespaceReason, revokeEmptyVersion]) {
      const malformedRequest = { ...request, binding: malformedBinding } as unknown as ConsentRequest;
      const malformedGrant = { ...grant, binding: malformedBinding } as unknown as ConsentGrant;
      expect(matchConsentGrant(malformedRequest, malformedGrant, verified, active, 1893455999999).ok).toBe(false);
    }
  });

  it("rejects matching envelopes with invalid schema field values", () => {
    const longText = "x".repeat(257);
    const longSignature = "x".repeat(1025);
    const cases: readonly [ConsentRequest, ConsentGrant, typeof verified, typeof active][] = [
      [{ ...request, challengeId: "" } as ConsentRequest, { ...grant, challengeId: "" } as ConsentGrant, verified, active],
      [request, { ...grant, hostId: longText } as ConsentGrant, { ...verified, hostId: longText }, { ...active, hostId: longText }],
      [request, { ...grant, keyId: longText } as ConsentGrant, { ...verified, keyId: longText }, { ...active, keyId: longText }],
      [request, { ...grant, signature: longSignature } as ConsentGrant, verified, active],
    ];
    for (const [malformedRequest, malformedGrant, malformedVerified, malformedTrust] of cases) {
      expect(matchConsentGrant(malformedRequest, malformedGrant, malformedVerified, malformedTrust, 1893455999999).ok).toBe(false);
    }
  });

  it("rejects undeclared request properties", () => {
    const extraRequest = { ...request, privateKey: "not-public" } as unknown as ConsentRequest;
    expect(matchConsentGrant(extraRequest, grant, verified, active, 1893455999999).ok).toBe(false);
  });

  it("rejects model-authored claims, wrong signer, wrong binding and expired grants", () => {
    for (const candidate of [true, "operator", { tokenId: "any" }, { ...grant, signature: "" }, { ...grant, hostId: "other" }, { ...grant, keyId: "other" }, { ...grant, binding: { ...binding, action: "revoke" } }, { ...grant, binding: { ...binding, semanticHash: "different" } }]) {
      expect(match(candidate).ok).toBe(false);
    }
    expect(matchConsentGrant(request, grant, { status: "rejected" }, active, 1893455999999).ok).toBe(false);
    expect(match(grant, active, request.expiresAtEpochMs).ok).toBe(false);
  });
});
