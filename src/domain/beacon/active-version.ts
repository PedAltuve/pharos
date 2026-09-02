import type { Beacon } from "./types.js";
import type { ActiveVersion } from "./versions.js";

export function resolveActiveVersion(beacon: Beacon): ActiveVersion | null {
  if (beacon.activeVersionId === null) {
    return null;
  }

  const version = beacon.versions[beacon.activeVersionId];
  if (version === undefined || version.status !== "active") {
    throw new Error(
      `Corrupt active pointer: "${beacon.activeVersionId}" does not name an active version`,
    );
  }

  return version;
}
