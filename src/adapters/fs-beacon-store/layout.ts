import { join } from "node:path";

export type IdProvenance = "disk" | "existing" | "creation";
export type IdValidationOutcome = "valid" | "corrupt" | "not-found" | "invalid-id";

const ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
const RESERVED_IDS = new Set([".", "..", "__proto__", "constructor", "prototype"]);

export function isValidId(value: string): boolean {
  return (
    typeof value === "string" &&
    ID_PATTERN.test(value) &&
    !RESERVED_IDS.has(value) &&
    !value.includes(".tmp.")
  );
}

export function classifyId(
  value: string,
  provenance: IdProvenance,
): IdValidationOutcome {
  if (isValidId(value)) return "valid";
  if (provenance === "disk") return "corrupt";
  return provenance === "creation" ? "invalid-id" : "not-found";
}

export function assertValidId(value: string): void {
  if (!isValidId(value)) {
    throw new Error(`Invalid filesystem id: ${value}`);
  }
}

function pathForId(...parts: string[]): string {
  const id = parts.at(-1);
  if (id === undefined) throw new Error("An id is required");
  assertValidId(id);
  return join(...parts);
}

export interface BeaconStoreLayout {
  lock(): string;
  journal(): string;
  journalIdempotency(): string;
  journalEntry(keyHash: string): string;
  beacons(): string;
  beacon(beaconId: string): string;
  beaconRecord(beaconId: string): string;
  active(beaconId: string): string;
  drafts(beaconId: string): string;
  draft(beaconId: string, draftId: string): string;
  draftRecord(beaconId: string, draftId: string): string;
  tombstone(beaconId: string, draftId: string): string;
  versions(beaconId: string): string;
  version(beaconId: string, versionId: string): string;
  manifest(beaconId: string, versionId: string): string;
  semantics(beaconId: string, versionId: string): string;
  revocation(beaconId: string, versionId: string): string;
  listBeaconIds(entries: readonly string[]): string[];
}

export function createLayout(projectRoot: string): BeaconStoreLayout {
  const beaconsRoot = join(projectRoot, "beacons");
  const journalRoot = join(projectRoot, "journal");
  const journalIdempotencyRoot = join(journalRoot, "idempotency");

  return {
    lock: () => join(projectRoot, "lock"),
    journal: () => journalRoot,
    journalIdempotency: () => journalIdempotencyRoot,
    journalEntry: (keyHash) => join(journalIdempotencyRoot, `${keyHash}.json`),
    beacons: () => beaconsRoot,
    beacon: (beaconId) => pathForId(beaconsRoot, beaconId),
    beaconRecord: (beaconId) => join(pathForId(beaconsRoot, beaconId), "beacon.json"),
    active: (beaconId) => join(pathForId(beaconsRoot, beaconId), "active.json"),
    drafts: (beaconId) => join(pathForId(beaconsRoot, beaconId), "drafts"),
    draft: (beaconId, draftId) =>
      pathForId(pathForId(beaconsRoot, beaconId), "drafts", draftId),
    draftRecord: (beaconId, draftId) =>
      join(pathForId(pathForId(beaconsRoot, beaconId), "drafts", draftId), "draft.json"),
    tombstone: (beaconId, draftId) =>
      join(pathForId(pathForId(beaconsRoot, beaconId), "drafts", draftId), "tombstone.json"),
    versions: (beaconId) => join(pathForId(beaconsRoot, beaconId), "versions"),
    version: (beaconId, versionId) =>
      pathForId(pathForId(beaconsRoot, beaconId), "versions", versionId),
    manifest: (beaconId, versionId) =>
      join(pathForId(pathForId(beaconsRoot, beaconId), "versions", versionId), "manifest.json"),
    semantics: (beaconId, versionId) =>
      join(pathForId(pathForId(beaconsRoot, beaconId), "versions", versionId), "semantics.json"),
    revocation: (beaconId, versionId) =>
      join(pathForId(pathForId(beaconsRoot, beaconId), "versions", versionId), "revocation.json"),
    listBeaconIds: (entries) =>
      entries
        .filter((entry) => entry !== "project.json" && entry !== "lock" && entry !== "journal")
        .filter((entry) => !entry.includes(".tmp."))
        .slice()
        .sort(),
  };
}
