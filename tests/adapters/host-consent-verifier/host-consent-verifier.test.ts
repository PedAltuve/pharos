import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalConsentGrantPayload, canonicalConsentGrantPayloadV2, staleComparisonDigest, verifyEd25519ConsentV2, Ed25519HostConsentVerifier } from "../../../src/adapters/host-consent-verifier/index.js";
import type { ConsentGrant, ConsentRequest, ConsentRequestV2, ConsentGrantV2 } from "../../../src/domain/ports/operator-consent.js";

const binding = { action: "approve" as const, projectId: "p", beaconId: "b", draftId: "d", expectedRevision: 1, semanticHash: "sha256:x", requestId: "r", staleOriginAcknowledged: false };
const request: ConsentRequest = { contract: "pharos.operator-consent-request/1", binding, challengeId: "challenge", expiresAtEpochMs: 2000000000000 };
const unsigned = { contract: "pharos.operator-consent-grant/1" as const, decision: "granted" as const, binding, challengeId: request.challengeId, expiresAtEpochMs: request.expiresAtEpochMs, hostId: "host", keyId: "key", algorithm: "ed25519" as const };
const now = 1900000000000;

describe("v2 stale comparison signatures", () => {
  it("binds the reviewed pair and refuses v1 stale grants", async () => {
    const keys = generateKeyPairSync("ed25519");
    const lookup = async () => keys.publicKey.export({ format: "der", type: "spki" });
    const reviewed = { activeVersionId: "v", activeSemanticHash: "sha256:active", comparisonDigest: staleComparisonDigest("sha256:x", "v", "sha256:active")! };
    const v2binding = { ...binding, staleOriginAcknowledged: true as const, reviewed };
    const v2request: ConsentRequestV2 = { ...request, contract: "pharos.operator-consent-request/2", binding: v2binding };
    const v2unsigned = { ...unsigned, contract: "pharos.operator-consent-grant/2" as const, binding: v2binding };
    const payload = canonicalConsentGrantPayloadV2(v2unsigned)!;
    const grant: ConsentGrantV2 = { ...v2unsigned, signature: sign(null, payload, keys.privateKey).toString("base64url") };
    expect(await verifyEd25519ConsentV2(v2request, grant, now, lookup)).toEqual({ status: "verified", hostId: "host", keyId: "key" });
    for (const field of ["activeVersionId", "activeSemanticHash", "comparisonDigest"] as const) {
      const tampered = { ...v2binding, reviewed: { ...reviewed, [field]: "changed" } };
      expect(await verifyEd25519ConsentV2({ ...v2request, binding: tampered }, grant, now, lookup)).toEqual({ status: "rejected" });
      expect(await verifyEd25519ConsentV2(v2request, { ...grant, binding: tampered }, now, lookup)).toEqual({ status: "rejected" });
    }
    expect(await verifyEd25519ConsentV2({ ...v2request, binding: { ...v2binding, reviewed: { activeVersionId: null, activeSemanticHash: null, comparisonDigest: "sha256:none" } } }, grant, now, lookup)).toEqual({ status: "rejected" });
    const v1stale = { ...binding, staleOriginAcknowledged: true };
    const v1request = { ...request, binding: v1stale };
    const v1unsigned = { ...unsigned, binding: v1stale };
    const v1grant = { ...v1unsigned, signature: sign(null, canonicalConsentGrantPayload(v1unsigned)!, keys.privateKey).toString("base64url") };
    expect(await new Ed25519HostConsentVerifier(lookup).verify(v1request, v1grant, now)).toEqual({ status: "rejected" });
  });
});

describe("authentic host consent", () => {
  it("accepts only a real signature over the exact request with an active key", async () => {
    const keys = generateKeyPairSync("ed25519");
    const other = generateKeyPairSync("ed25519");
    const publicKey = keys.publicKey.export({ format: "der", type: "spki" });
    let active = true;
    const verifier = new Ed25519HostConsentVerifier(async (host, key) => host === "host" && key === "key" && active ? publicKey : undefined);
    const payload = canonicalConsentGrantPayload(unsigned);
    expect(payload).toBeDefined();
    const grant: ConsentGrant = { ...unsigned, signature: sign(null, payload!, keys.privateKey).toString("base64url") };
    expect(await verifier.verify(request, grant, now)).toEqual({ status: "verified", hostId: "host", keyId: "key" });
    expect(await verifier.verify(request, { ...grant, signature: sign(null, payload!, other.privateKey).toString("base64url") }, now)).toEqual({ status: "rejected" });
    expect(await new Ed25519HostConsentVerifier(async () => other.publicKey.export({ format: "der", type: "spki" })).verify(request, grant, now)).toEqual({ status: "rejected" });
    expect(await verifier.verify({ ...request, binding: { ...binding, semanticHash: "changed" } }, grant, now)).toEqual({ status: "rejected" });
    expect(await verifier.verify(request, { ...grant, binding: { ...binding, requestId: "changed" } }, grant.expiresAtEpochMs - 1)).toEqual({ status: "rejected" });
    expect(await verifier.verify(request, grant, request.expiresAtEpochMs)).toEqual({ status: "rejected" });
    active = false;
    expect(await verifier.verify(request, grant, now)).toEqual({ status: "rejected" });
    expect(await verifier.trust("host", "key")).toEqual({ status: "unknown" });
  });

  it("rejects hidden undeclared properties on signed approval and revocation grants without reading getters", async () => {
    const keys = generateKeyPairSync("ed25519");
    const verifier = new Ed25519HostConsentVerifier(async () => keys.publicKey.export({ format: "der", type: "spki" }));
    const revokeBinding = { action: "revoke" as const, projectId: "p", beaconId: "b", expectedActiveVersion: "v", reason: "retire", requestId: "r" };
    for (const actionBinding of [binding, revokeBinding]) {
      const actionRequest: ConsentRequest = { ...request, binding: actionBinding };
      const unsignedAction = { ...unsigned, binding: actionBinding };
      const payload = canonicalConsentGrantPayload(unsignedAction)!;
      const signed: ConsentGrant = { ...unsignedAction, signature: sign(null, payload, keys.privateKey).toString("base64url") };
      expect(await verifier.verify(actionRequest, signed, now)).toEqual({ status: "verified", hostId: "host", keyId: "key" });
      for (const target of ["grant", "binding"] as const) {
        const candidate = { ...signed, binding: { ...actionBinding } };
        const object = target === "grant" ? candidate : candidate.binding;
        Object.defineProperty(object, "privateKey", { value: "hidden", enumerable: false });
        expect(await verifier.verify(actionRequest, candidate, now)).toEqual({ status: "rejected" });
        expect(Object.getOwnPropertyDescriptor(object, "privateKey")?.value).toBe("hidden");
      }
      const getterGrant = { ...signed };
      Object.defineProperty(getterGrant, "signature", { get() { throw new Error("getter invoked"); } });
      expect(await verifier.verify(actionRequest, getterGrant, now)).toEqual({ status: "rejected" });
    }
  });

  it("rejects malformed data, ambiguous signatures, unknown versions and non-Ed25519 keys", async () => {
    const keys = generateKeyPairSync("ed25519");
    const payload = canonicalConsentGrantPayload(unsigned)!;
    const grant: ConsentGrant = { ...unsigned, signature: sign(null, payload, keys.privateKey).toString("base64url") };
    const verifier = new Ed25519HostConsentVerifier(async () => keys.publicKey.export({ format: "der", type: "spki" }));
    for (const candidate of [
      { ...grant, signature: grant.signature + "=" },
      { ...grant, privateKey: "leak" },
      { ...grant, contract: "pharos.operator-consent-grant/2" },
      { ...grant, binding: { ...binding, extra: true } },
      { ...grant, binding: { ...binding, staleOriginAcknowledged: undefined } },
      { ...grant, signature: "A".repeat(86) },
    ]) expect(await verifier.verify(request, candidate as ConsentGrant, now)).toEqual({ status: "rejected" });
    expect(await verifier.verify({ ...request, extra: true } as ConsentRequest, grant, now)).toEqual({ status: "rejected" });
    expect(await verifier.verify(request, grant, NaN)).toEqual({ status: "rejected" });
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
    expect(await new Ed25519HostConsentVerifier(async () => rsa.publicKey.export({ format: "der", type: "spki" })).verify(request, grant, now)).toEqual({ status: "rejected" });
  });
});
