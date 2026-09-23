import { describe, expect, it } from "vitest";
import { BeaconStatus } from "../../src/application/beacon-status.js";
import type { Beacon, Version } from "../../src/domain/beacon/index.js";
import type { BeaconStore } from "../../src/domain/ports/index.js";
import { ok } from "../../src/shared/result.js";

const beaconId = "bcn_018f47de-7a00-7cc0-8000-000000000001" as const;
const versionId = "ver_018f47de-7a00-7cc0-8000-000000000001";

function activeVersion(): Version {
  return { status: "active", versionId, localNumber: 1, approval: { approvedAt: "2026-03-05T00:00:00.000Z", reviewedHash: "sha256:semantic", staleOriginAcknowledged: false, assurance: "operator_confirmed", actor: "operator_1" }, provenance: { approvedDraftId: "drf_018f47de-7a00-7cc0-8000-000000000001", approvedRevision: 1, branchedFromVersion: null, branchedFromHash: null } };
}

function beacon(overrides: Partial<Beacon>): Beacon {
  return { beaconId, title: "Renew checkout", drafts: {}, versions: {}, activeVersionId: null, ...overrides };
}

function statusFor(aggregate: Beacon) {
  let reads = 0;
  const store: BeaconStore = {
    async getBeacon() { reads += 1; return ok(aggregate); }, async listBeacons() { return ok([]); }, async getActiveVersion() { throw new Error("status must derive from the canonical Beacon aggregate"); },
    async createDraft() { throw new Error("read only"); }, async updateDraft() { throw new Error("read only"); }, async forkDraft() { throw new Error("read only"); }, async abandonDraft() { throw new Error("read only"); }, async approveDraft() { throw new Error("read only"); }, async revokeVersion() { throw new Error("read only"); },
  };
  return { useCase: new BeaconStatus({ beaconStore: store }), reads: () => reads };
}

describe("BeaconStatus", () => {
  it.each([
    ["an open draft", beacon({ drafts: { "drf_018f47de-7a00-7cc0-8000-000000000001": { status: "open", draftId: "drf_018f47de-7a00-7cc0-8000-000000000001", label: "Renew", revision: 1, origin: { branchedFromVersion: null, branchedFromHash: null, forkedFromDraft: null }, content: { purpose: "Renew", actor: { type: "guest", identityRef: null }, entryPoint: { path: "/", query: null, fragment: null }, actions: [], checkpoints: { ordered: true, entries: [] }, variables: [], outcomes: [], allowedVariation: [], prohibitedRegressions: [], readinessIntent: { sideEffectClass: "stateless", isolation: null } } } } }), "open-draft"],
    ["an active approved version", beacon({ versions: { [versionId]: activeVersion() }, activeVersionId: versionId }), "active-approved"],
    ["a revoked version with no active pointer", beacon({ versions: { [versionId]: { ...activeVersion(), status: "revoked", previousStatus: "active", revocation: { revokedAt: "2026-03-06T00:00:00.000Z", reason: "Recalled", actor: "operator_1" } } } }), "revoked-no-active"],
    ["an abandoned-only Beacon", beacon({ drafts: { "drf_018f47de-7a00-7cc0-8000-000000000001": { status: "abandoned", draftId: "drf_018f47de-7a00-7cc0-8000-000000000001", label: "Renew", origin: { branchedFromVersion: null, branchedFromHash: null, forkedFromDraft: null }, finalRevision: 1, finalHash: "sha256:semantic", reason: "Superseded", abandonedAt: "2026-03-06T00:00:00.000Z" } } }), "no-authority"],
    ["an empty never-approved Beacon", beacon({}), "no-authority"],
  ] as const)("reports %s without evaluating unavailable lifecycle dimensions", async (_name, aggregate, authority) => {
    const configured = statusFor(aggregate);

    await expect(configured.useCase.execute({ beaconId })).resolves.toEqual({ ok: true, value: { beaconId, activeVersionId: aggregate.activeVersionId, authority, readiness: "unavailable", staleness: "unavailable", verification: "unavailable" } });
    expect(configured.reads()).toBe(1);
  });
});
