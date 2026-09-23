import type { BeaconId } from "../domain/capture/index.js";
import type { BeaconStoreRefusal } from "../domain/ports/beacon-store-refusals.js";
import type { BeaconStore } from "../domain/ports/index.js";
import { ok, type Result } from "../shared/result.js";

export interface BeaconStatusRequest {
  readonly beaconId: BeaconId;
}

export type BeaconAuthority = "no-authority" | "open-draft" | "active-approved" | "revoked-no-active";
export type UnavailableLifecycleDimension = "unavailable";

export interface BeaconLifecycleStatus {
  readonly beaconId: BeaconId;
  /** Canonical current snapshot; null never selects or reactivates history. */
  readonly activeVersionId: string | null;
  readonly authority: BeaconAuthority;
  readonly readiness: UnavailableLifecycleDimension;
  readonly staleness: UnavailableLifecycleDimension;
  readonly verification: UnavailableLifecycleDimension;
}

export interface BeaconStatusDependencies {
  readonly beaconStore: BeaconStore;
}

/** Reads canonical Beacon state without deriving unsupported readiness claims. */
export class BeaconStatus {
  constructor(private readonly dependencies: BeaconStatusDependencies) {}

  async execute(request: BeaconStatusRequest): Promise<Result<BeaconLifecycleStatus, BeaconStoreRefusal>> {
    const beacon = await this.dependencies.beaconStore.getBeacon(request.beaconId);
    if (!beacon.ok) return beacon;

    const authority: BeaconAuthority = beacon.value.activeVersionId !== null
      ? "active-approved"
      : Object.values(beacon.value.drafts).some((draft) => draft.status === "open")
        ? "open-draft"
        : Object.values(beacon.value.versions).some((version) => version.status === "revoked")
          ? "revoked-no-active"
          : "no-authority";
    return ok({
      beaconId: request.beaconId,
      activeVersionId: beacon.value.activeVersionId,
      authority,
      readiness: "unavailable",
      staleness: "unavailable",
      verification: "unavailable",
    });
  }
}
