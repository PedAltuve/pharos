import { describe, expect, it } from "vitest";
import { HostConsentDecision } from "../../src/application/operator-consent-host.js";
import type { ConsentRequest, OperatorConsentStore } from "../../src/domain/ports/operator-consent.js";
import { err, ok } from "../../src/shared/result.js";

const request: ConsentRequest = { contract: "pharos.operator-consent-request/1", challengeId: "challenge_1", expiresAtEpochMs: 200, binding: { action: "revoke", projectId: "project", beaconId: "beacon", expectedActiveVersion: "version", reason: "obsolete", requestId: "request" } };

describe("host-only consent decision", () => {
  it("displays the exact pending public request and declines without lifecycle mutation", async () => {
    let status: "pending" | "declined" = "pending";
    let calls = 0;
    const store = {
      async getChallenge() { return ok(status === "pending" ? { status, request, auditId: "audit" } : { status, requestId: "request", reason: "operator-declined", auditId: "audit" }); },
      async decline(_id: string, reason: string) { calls++; status = "declined"; return ok({ status: "declined" as const, requestId: "request", reason, auditId: "audit" }); },
    } as unknown as OperatorConsentStore;
    const service = new HostConsentDecision({ consentStore: store, clock: () => 100 });
    expect(await service.inspect("request")).toEqual(ok({ request, auditId: "audit" }));
    expect(await service.decline("request")).toEqual(ok({ status: "declined", requestId: "request", reason: "operator-declined", auditId: "audit" }));
    expect(await service.inspect("request")).toEqual(err({ rule: "consent-already-declined", requestId: "request" }));
    expect(await service.decline("request")).toEqual(ok({ status: "declined", requestId: "request", reason: "operator-declined", auditId: "audit" }));
    expect(calls).toBe(2);
  });
  it.each(["consent-expired", "consent-consumption-conflict"] as const)("preserves %s refusal", async (rule) => {
    const store = { async getChallenge() { return err({ rule, requestId: "request" }); }, async decline() { return err({ rule, requestId: "request" }); } } as unknown as OperatorConsentStore;
    const service = new HostConsentDecision({ consentStore: store, clock: () => 300 });
    expect(await service.inspect("request")).toEqual(err({ rule, requestId: "request" }));
    expect(await service.decline("request")).toEqual(err({ rule, requestId: "request" }));
  });
});
