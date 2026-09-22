import { err, ok } from "../../shared/result.js";
import type { Result } from "../../shared/result.js";
import { getOwn } from "./records.js";
import type { BeaconRefusal } from "./refusals.js";
import type { Beacon } from "./types.js";
import type { Version } from "./versions.js";

export interface RevokeVersionCommand {
  readonly versionId: string;
  readonly reason: string;
  readonly actor: string | null;
  readonly revokedAt: string;
}

export interface RevokeActiveVersionCommand {
  readonly expectedActiveVersionId: string | null;
  readonly reason: string;
  readonly actor: string | null;
  readonly revokedAt: string;
}

export function revokeVersion(
  beacon: Beacon,
  cmd: RevokeVersionCommand,
): Result<Beacon, BeaconRefusal> {
  const reason = cmd.reason.trim();
  if (reason.length === 0) {
    return err({ rule: "invalid-revocation-reason" });
  }

  const version = getOwn(beacon.versions, cmd.versionId);
  if (version === undefined) {
    return err({ rule: "version-not-found", versionId: cmd.versionId });
  }
  if (version.status === "revoked") {
    return err({ rule: "version-already-revoked", versionId: cmd.versionId });
  }

  const revoked: Version = {
    versionId: version.versionId,
    localNumber: version.localNumber,
    approval: version.approval,
    provenance: version.provenance,
    status: "revoked",
    previousStatus: version.status,
    revocation: {
      revokedAt: cmd.revokedAt,
      reason,
      actor: cmd.actor,
    },
  };

  const activeVersionId =
    beacon.activeVersionId === cmd.versionId ? null : beacon.activeVersionId;

  return ok({
    ...beacon,
    versions: { ...beacon.versions, [cmd.versionId]: revoked },
    activeVersionId,
  });
}
