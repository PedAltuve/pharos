import type { BeaconId, RequestId } from "../domain/capture/index.js";
import type { BeaconStoreRefusal } from "../domain/ports/beacon-store-refusals.js";
import type { BeaconStore, Clock } from "../domain/ports/index.js";
import { err, ok, type Result } from "../shared/result.js";

export interface RevokeActiveBeaconRequest {
  readonly beaconId: BeaconId;
  readonly requestId: RequestId;
  /** Prepared by the confirmation boundary; locked store validation owns its freshness. */
  readonly expectedActiveVersionId: string | null;
  readonly reason: string;
  readonly actor: string | null;
}

export interface RevokedActiveBeacon {
  readonly beaconId: BeaconId;
  readonly versionId: string;
  readonly status: "revoked";
  readonly reason: string;
}

export interface ActiveVersionNotFound {
  readonly rule: "active-version-not-found";
  readonly beaconId: BeaconId;
}

export type RevokeActiveBeaconRefusal =
  | BeaconStoreRefusal
  | ActiveVersionNotFound;

export interface RevokeActiveBeaconDependencies {
  readonly clock: Clock;
  readonly beaconStore: BeaconStore & {
    readonly revokeActiveVersion: NonNullable<BeaconStore["revokeActiveVersion"]>;
  };
}

/** Revokes only the active immutable version; historical versions are never selected or reactivated. */
export class RevokeActiveBeacon {
  constructor(private readonly dependencies: RevokeActiveBeaconDependencies) {}

  async execute(request: RevokeActiveBeaconRequest): Promise<Result<RevokedActiveBeacon, RevokeActiveBeaconRefusal>> {
    const reason = request.reason.trim();
    if (reason.length === 0) return err({ rule: "invalid-revocation-reason" });

    const revoked = await this.dependencies.beaconStore.revokeActiveVersion(
      request.beaconId,
      {
        expectedActiveVersionId: request.expectedActiveVersionId,
        reason,
        actor: request.actor,
        revokedAt: this.dependencies.clock.now().toISOString(),
      },
      `beacon-revoke:${request.beaconId}:${request.requestId}`,
    );
    if (!revoked.ok) return revoked;

    const versionId = request.expectedActiveVersionId;
    if (versionId === null) {
      return err({ rule: "active-version-not-found", beaconId: request.beaconId });
    }
    const version = revoked.value.versions[versionId];
    if (version?.status !== "revoked") {
      return err({
        rule: "active-version-mismatch",
        expectedActiveVersionId: request.expectedActiveVersionId,
        currentActiveVersionId: revoked.value.activeVersionId,
      });
    }
    return ok({
      beaconId: request.beaconId,
      versionId,
      status: "revoked",
      reason: version.revocation.reason,
    });
  }
}
