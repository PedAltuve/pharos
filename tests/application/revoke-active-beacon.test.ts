import { describe, expect, it } from "vitest";
import { RevokeActiveBeacon } from "../../src/application/revoke-active-beacon.js";
import type { ActiveVersion, Beacon } from "../../src/domain/beacon/index.js";
import type { BeaconStore } from "../../src/domain/ports/index.js";
import { err, ok } from "../../src/shared/result.js";

const beaconId = "bcn_018f47de-7a00-7cc0-8000-000000000001" as const;
const versionId = "ver_018f47de-7a00-7cc0-8000-000000000001";
const timestamp = "2026-03-06T00:00:00.000Z";

const active: ActiveVersion = {
  status: "active",
  versionId,
  localNumber: 1,
  approval: {
    approvedAt: "2026-03-05T00:00:00.000Z",
    reviewedHash: "sha256:semantic",
    staleOriginAcknowledged: false,
    assurance: "operator_confirmed",
    actor: "operator_1",
  },
  provenance: {
    approvedDraftId: "drf_018f47de-7a00-7cc0-8000-000000000001",
    approvedRevision: 1,
    branchedFromVersion: null,
    branchedFromHash: null,
  },
};

function dependencies() {
  let revocations = 0;
  const commands: unknown[] = [];
  let replay: Beacon | undefined;
  const store: BeaconStore & {
    readonly revokeActiveVersion: NonNullable<BeaconStore["revokeActiveVersion"]>;
  } = {
    async getBeacon() { throw new Error("not applicable"); },
    async listBeacons() { return ok([]); },
    async getActiveVersion() { throw new Error("active state must be prepared before this use case"); },
    async createDraft() { throw new Error("not applicable"); },
    async updateDraft() { throw new Error("not applicable"); },
    async forkDraft() { throw new Error("not applicable"); },
    async abandonDraft() { throw new Error("not applicable"); },
    async approveDraft() { throw new Error("not applicable"); },
    async revokeVersion() { throw new Error("active-only revocation is required"); },
    async revokeActiveVersion(_beaconId, proposed) {
      revocations += 1;
      commands.push(proposed);
      if (proposed.expectedActiveVersionId === null) {
        return err({ rule: "active-version-not-found", beaconId });
      }
      if (replay !== undefined) return ok(replay);
      replay = {
        beaconId,
        title: "Renew checkout",
        drafts: {},
        activeVersionId: null,
        versions: {
          [proposed.expectedActiveVersionId]: {
            ...active,
            status: "revoked",
            previousStatus: "active",
            revocation: {
              revokedAt: proposed.revokedAt,
              reason: proposed.reason,
              actor: proposed.actor,
            },
          },
        },
      };
      return ok(replay);
    },
  };
  return {
    useCase: new RevokeActiveBeacon({
      clock: { now: () => new Date(timestamp) },
      beaconStore: store,
    }),
    revocations: () => revocations,
    commands: () => commands,
  };
}

const request = {
  beaconId,
  requestId: "req_018f47de-7a00-7cc0-8000-000000000002" as const,
  expectedActiveVersionId: versionId,
  reason: "  Recalled by operator  ",
  actor: "operator_1",
};

describe("RevokeActiveBeacon", () => {
  it("uses the prepared active snapshot without a mutable active read", async () => {
    const configured = dependencies();

    await expect(configured.useCase.execute(request)).resolves.toEqual({
      ok: true,
      value: { beaconId, versionId, status: "revoked", reason: "Recalled by operator" },
    });
    expect(configured.commands()).toEqual([expect.objectContaining({
      expectedActiveVersionId: versionId,
      reason: "Recalled by operator",
      actor: "operator_1",
      revokedAt: timestamp,
    })]);
  });

  it("replays the same prepared request after active state disappears", async () => {
    const configured = dependencies();

    const first = await configured.useCase.execute(request);
    const replay = await configured.useCase.execute(request);

    expect(first).toEqual(replay);
    expect(replay).toEqual({
      ok: true,
      value: { beaconId, versionId, status: "revoked", reason: "Recalled by operator" },
    });
    expect(configured.revocations()).toBe(2);
  });

  it.each(["", "   ", "\n\t"])("refuses an empty reason %j without mutating lifecycle state", async (reason) => {
    const configured = dependencies();

    await expect(configured.useCase.execute({ ...request, reason })).resolves.toEqual({
      ok: false,
      error: { rule: "invalid-revocation-reason" },
    });
    expect(configured.revocations()).toBe(0);
  });

  it("delegates a prepared null snapshot to locked active-only validation", async () => {
    const configured = dependencies();

    await expect(configured.useCase.execute({ ...request, expectedActiveVersionId: null })).resolves.toEqual({
      ok: false,
      error: { rule: "active-version-not-found", beaconId },
    });
    expect(configured.revocations()).toBe(1);
  });
});
