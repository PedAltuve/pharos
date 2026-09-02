import { describe, expect, it } from "vitest";
import { resolveActiveVersion } from "../../../src/domain/beacon/index.js";
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

function baseBeacon(): Beacon {
  return {
    beaconId: "bcn_1",
    title: "Renew an active policy",
    drafts: {},
    versions: {},
    activeVersionId: null,
  };
}

describe("resolveActiveVersion", () => {
  it("returns null when activeVersionId is null", () => {
    const beacon = baseBeacon();

    expect(resolveActiveVersion(beacon)).toBeNull();
  });

  it("returns the matching ActiveVersion", () => {
    const beacon: Beacon = {
      ...baseBeacon(),
      versions: { ver_1: activeVersion("ver_1", 1) },
      activeVersionId: "ver_1",
    };

    expect(resolveActiveVersion(beacon)).toEqual(activeVersion("ver_1", 1));
  });

  it("throws when the pointer names an absent version", () => {
    const beacon: Beacon = { ...baseBeacon(), activeVersionId: "ver_missing" };

    expect(() => resolveActiveVersion(beacon)).toThrow(Error);
  });

  it("throws when the pointer names a non-active version", () => {
    const beacon: Beacon = {
      ...baseBeacon(),
      versions: { ver_1: supersededVersion("ver_1", 1, "ver_2") },
      activeVersionId: "ver_1",
    };

    expect(() => resolveActiveVersion(beacon)).toThrow(Error);
  });
});
