import { describe, expect, it } from "vitest";
import { revokeVersion } from "../../../src/domain/beacon/index.js";
import type { Beacon, Version } from "../../../src/domain/beacon/index.js";

function approvalRecord() {
  return {
    approvedAt: "2026-01-01T00:00:00.000Z",
    reviewedHash: "sha256:abc",
    staleOriginAcknowledged: false,
    assurance: "operator_confirmed" as const,
    actor: "operator_1",
  };
}

function provenance() {
  return {
    approvedDraftId: "drf_1",
    approvedRevision: 1,
    branchedFromVersion: null,
    branchedFromHash: null,
  };
}

function activeVersion(versionId: string, localNumber: number): Version {
  return {
    status: "active",
    versionId,
    localNumber,
    approval: approvalRecord(),
    provenance: provenance(),
  };
}

function supersededVersion(versionId: string, localNumber: number, supersededBy: string): Version {
  return {
    status: "superseded",
    versionId,
    localNumber,
    approval: approvalRecord(),
    provenance: provenance(),
    supersededBy,
    supersededAt: "2026-01-02T00:00:00.000Z",
  };
}

function revokedVersion(versionId: string, localNumber: number, previousStatus: "active" | "superseded"): Version {
  return {
    status: "revoked",
    versionId,
    localNumber,
    approval: approvalRecord(),
    provenance: provenance(),
    previousStatus,
    revocation: {
      revokedAt: "2026-01-03T00:00:00.000Z",
      reason: "Already revoked",
      actor: "operator_1",
    },
  };
}

function baseBeacon(): Beacon {
  return {
    beaconId: "bcn_1",
    title: "Renew an active policy",
    drafts: {},
    versions: {},
    activeVersionId: null,
  };
}

describe("revokeVersion", () => {
  it("revokes a superseded version, leaving the active pointer untouched", () => {
    const beacon: Beacon = {
      ...baseBeacon(),
      versions: {
        ver_1: supersededVersion("ver_1", 1, "ver_2"),
        ver_2: activeVersion("ver_2", 2),
      },
      activeVersionId: "ver_2",
    };

    const result = revokeVersion(beacon, {
      versionId: "ver_1",
      reason: "No longer valid",
      actor: "operator_1",
      revokedAt: "2026-01-04T00:00:00.000Z",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.versions["ver_1"]).toEqual({
      status: "revoked",
      versionId: "ver_1",
      localNumber: 1,
      approval: approvalRecord(),
      provenance: provenance(),
      previousStatus: "superseded",
      revocation: {
        revokedAt: "2026-01-04T00:00:00.000Z",
        reason: "No longer valid",
        actor: "operator_1",
      },
    });
    expect(result.value.activeVersionId).toBe("ver_2");
  });

  it("revokes the active version, clearing the pointer with previousStatus active", () => {
    const beacon: Beacon = {
      ...baseBeacon(),
      versions: { ver_2: activeVersion("ver_2", 2) },
      activeVersionId: "ver_2",
    };

    const result = revokeVersion(beacon, {
      versionId: "ver_2",
      reason: "Recalled",
      actor: "operator_1",
      revokedAt: "2026-01-04T00:00:00.000Z",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const revoked = result.value.versions["ver_2"];
    expect(revoked?.status).toBe("revoked");
    if (revoked?.status === "revoked") {
      expect(revoked.previousStatus).toBe("active");
    }
    expect(result.value.activeVersionId).toBeNull();
  });

  it("refuses when the version does not exist", () => {
    const beacon = baseBeacon();

    const result = revokeVersion(beacon, {
      versionId: "ver_missing",
      reason: "No longer valid",
      actor: "operator_1",
      revokedAt: "2026-01-04T00:00:00.000Z",
    });

    expect(result).toEqual({
      ok: false,
      error: { rule: "version-not-found", versionId: "ver_missing" },
    });
  });

  it("revokes an own-property version keyed with a prototype-shadowing id", () => {
    const beacon: Beacon = {
      ...baseBeacon(),
      versions: { toString: activeVersion("toString", 1) },
      activeVersionId: "toString",
    };

    const result = revokeVersion(beacon, {
      versionId: "toString",
      reason: "No longer valid",
      actor: "operator_1",
      revokedAt: "2026-01-04T00:00:00.000Z",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.versions["toString"]?.status).toBe("revoked");
  });

  it("refuses version-not-found for a prototype-key id with no own entry", () => {
    const beacon = baseBeacon();

    const result = revokeVersion(beacon, {
      versionId: "constructor",
      reason: "No longer valid",
      actor: "operator_1",
      revokedAt: "2026-01-04T00:00:00.000Z",
    });

    expect(result).toEqual({
      ok: false,
      error: { rule: "version-not-found", versionId: "constructor" },
    });
  });

  it("refuses double revocation without mutation", () => {
    const beacon: Beacon = {
      ...baseBeacon(),
      versions: { ver_1: revokedVersion("ver_1", 1, "active") },
      activeVersionId: null,
    };
    const before = structuredClone(beacon);

    const result = revokeVersion(beacon, {
      versionId: "ver_1",
      reason: "Again",
      actor: "operator_1",
      revokedAt: "2026-01-05T00:00:00.000Z",
    });

    expect(result).toEqual({
      ok: false,
      error: { rule: "version-already-revoked", versionId: "ver_1" },
    });
    expect(beacon).toEqual(before);
  });
});
