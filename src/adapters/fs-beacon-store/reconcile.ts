import type { Dirent } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import type { Beacon, Draft, DraftOrigin, RevocationRecord, Version } from "../../domain/beacon/index.js";
import type { SemanticSource } from "../../domain/semantics/index.js";
import { BeaconStoreCorruptionError } from "./corruption.js";
import { createLayout } from "./layout.js";
import { deserializeRecord, type FileKind } from "./serialization.js";

interface ManifestFile {
  readonly versionId: string;
  readonly localNumber: number;
  readonly approval: {
    readonly approvedAt: string;
    readonly reviewedHash: string;
    readonly staleOriginAcknowledged: boolean;
    readonly assurance: "operator_confirmed";
    readonly actor: string | null;
  };
  readonly provenance: {
    readonly approvedDraftId: string;
    readonly approvedRevision: number;
    readonly branchedFromVersion: string | null;
    readonly branchedFromHash: string | null;
  };
  readonly supersedesVersion: string | null;
}

interface RevocationFile {
  readonly previousStatus: "active" | "superseded";
  readonly revocation: RevocationRecord;
}

interface ActiveFile {
  readonly activeVersionId: string | null;
}

interface BeaconRecordFile {
  readonly beaconId: string;
  readonly title: string;
}

interface TombstoneFile {
  readonly draftId: string;
  readonly label: string;
  readonly origin: DraftOrigin;
  readonly finalRevision: number;
  readonly finalHash: string;
  readonly reason: string;
  readonly abandonedAt: string;
}

interface DraftFile {
  readonly draftId: string;
  readonly label: string;
  readonly status: "open" | "closed";
  readonly revision: number;
  readonly origin: DraftOrigin;
  readonly content: SemanticSource;
  readonly approvedVersionId?: string;
  readonly closedAt?: string;
}

export interface VersionScan {
  readonly versions: Readonly<Record<string, Version>>;
  readonly activeVersionId: string | null;
  readonly orphanVersionIds: readonly string[];
}

function isMissing(error: unknown): boolean {
  return (
    error instanceof Error
    && "code" in error
    && (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

// D8 — every listing is sorted before any semantic use, and D8's `.tmp.`
// filter excludes interrupted writes and D2's leaked liveness probes.
// A non-directory entry is not a declared D4 non-corruption row, so it
// throws (D4 default) instead of silently masking a lost directory.
async function listSorted(path: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  const names: string[] = [];
  for (const entry of entries) {
    if (entry.name.includes(".tmp.")) continue;
    if (!entry.isDirectory()) {
      throw new BeaconStoreCorruptionError(
        `Non-directory entry "${entry.name}" found in "${path}"`,
      );
    }
    names.push(entry.name);
  }
  return names.sort();
}

async function readRecord<T>(path: string, kind: FileKind): Promise<T | undefined> {
  let bytes: string;
  try {
    bytes = await readFile(path, "utf8");
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
  try {
    return deserializeRecord(kind, bytes) as T;
  } catch (cause) {
    throw new BeaconStoreCorruptionError(
      `Corrupt ${kind} at ${path}: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
}

/**
 * The lock-free, pure-read half of D1's committed-chain walk. Reads every
 * version's manifest and revocation record, derives the committed set by a
 * backward walk from the roots (the active.json target, plus every revoked
 * version), and derives each committed version's status per D1's 3-row
 * table. A version directory with a manifest never reached by the walk is
 * an orphan (D1's "aborted" row) and is excluded from `versions`.
 */
export async function scanVersions(projectRoot: string, beaconId: string): Promise<VersionScan> {
  const layout = createLayout(projectRoot);
  const versionIds = await listSorted(layout.versions(beaconId));

  const manifests = new Map<string, ManifestFile>();
  for (const versionId of versionIds) {
    const manifest = await readRecord<ManifestFile>(layout.manifest(beaconId, versionId), "manifest");
    if (manifest === undefined) continue;
    if (manifest.versionId !== versionId) {
      throw new BeaconStoreCorruptionError(
        `Embedded version id "${manifest.versionId}" does not match directory "${versionId}"`,
      );
    }
    manifests.set(versionId, manifest);
  }

  const revocations = new Map<string, RevocationFile>();
  for (const versionId of manifests.keys()) {
    const revocation = await readRecord<RevocationFile>(
      layout.revocation(beaconId, versionId),
      "revocation",
    );
    if (revocation !== undefined) revocations.set(versionId, revocation);
  }

  const active = await readRecord<ActiveFile>(layout.active(beaconId), "active");
  const activeVersionRaw = active?.activeVersionId ?? null;

  const roots = new Set<string>(revocations.keys());
  if (activeVersionRaw !== null) roots.add(activeVersionRaw);

  // Pass 1 — collect committed ids and walk-step edges across ALL roots
  // before deciding status; edges are only ever set, never cleared, so
  // pass 2 is independent of root order (D1c's revocation crash window).
  const committedIds = new Set<string>();
  const supersededByEdge = new Map<string, { readonly by: string; readonly at: string }>();

  for (const root of [...roots].sort()) {
    const chainVisited = new Set<string>();
    let predecessorId: string | null = null;
    let current: string | null = root;

    while (current !== null) {
      if (chainVisited.has(current)) {
        throw new BeaconStoreCorruptionError(
          `Cycle detected in the committed-chain walk at "${current}"`,
        );
      }
      chainVisited.add(current);

      const manifest = manifests.get(current);
      if (manifest === undefined) {
        throw new BeaconStoreCorruptionError(
          `"${current}" is named by active.json or a supersedes_version pointer but has no manifest.json`,
        );
      }

      committedIds.add(current);
      if (predecessorId !== null) {
        const predecessorManifest = manifests.get(predecessorId)!;
        supersededByEdge.set(current, {
          by: predecessorId,
          at: predecessorManifest.approval.approvedAt,
        });
      }

      predecessorId = current;
      current = manifest.supersedesVersion;
    }
  }

  // Pass 2 — D1's ratified 3-row table: revoked beats everything, a
  // walk-step edge beats being a root, else active.
  const committed = new Map<string, Version>();
  for (const versionId of committedIds) {
    const manifest = manifests.get(versionId)!;
    const base = {
      versionId: manifest.versionId,
      localNumber: manifest.localNumber,
      approval: manifest.approval,
      provenance: manifest.provenance,
    };

    const revocation = revocations.get(versionId);
    if (revocation !== undefined) {
      committed.set(versionId, {
        ...base,
        status: "revoked",
        previousStatus: revocation.previousStatus,
        revocation: revocation.revocation,
      });
      continue;
    }

    const edge = supersededByEdge.get(versionId);
    if (edge !== undefined) {
      committed.set(versionId, {
        ...base,
        status: "superseded",
        supersededBy: edge.by,
        supersededAt: edge.at,
      });
      continue;
    }

    committed.set(versionId, { ...base, status: "active" });
  }

  const orphanVersionIds = [...manifests.keys()].filter((id) => !committed.has(id)).sort();

  const activeVersionId =
    activeVersionRaw !== null && committed.get(activeVersionRaw)?.status === "active"
      ? activeVersionRaw
      : null;

  return {
    versions: Object.fromEntries(committed),
    activeVersionId,
    orphanVersionIds,
  };
}

// D1b's total reconstruction rule: tombstone.json wins over draft.json
// regardless of the latter's presence; draft.json alone reconstructs to
// "open" or "closed" per its own status field.
async function scanDrafts(
  projectRoot: string,
  beaconId: string,
): Promise<Readonly<Record<string, Draft>>> {
  const layout = createLayout(projectRoot);
  const draftIds = await listSorted(layout.drafts(beaconId));
  const drafts = new Map<string, Draft>();

  for (const draftId of draftIds) {
    const tombstone = await readRecord<TombstoneFile>(
      layout.tombstone(beaconId, draftId),
      "tombstone",
    );
    if (tombstone !== undefined) {
      if (tombstone.draftId !== draftId) {
        throw new BeaconStoreCorruptionError(
          `Embedded draft id "${tombstone.draftId}" does not match directory "${draftId}"`,
        );
      }
      drafts.set(draftId, {
        status: "abandoned",
        draftId: tombstone.draftId,
        label: tombstone.label,
        origin: tombstone.origin,
        finalRevision: tombstone.finalRevision,
        finalHash: tombstone.finalHash,
        reason: tombstone.reason,
        abandonedAt: tombstone.abandonedAt,
      });
      continue;
    }

    const draft = await readRecord<DraftFile>(layout.draftRecord(beaconId, draftId), "draft");
    if (draft === undefined) continue;
    if (draft.draftId !== draftId) {
      throw new BeaconStoreCorruptionError(
        `Embedded draft id "${draft.draftId}" does not match directory "${draftId}"`,
      );
    }

    if (draft.status === "open") {
      drafts.set(draftId, {
        status: "open",
        draftId: draft.draftId,
        label: draft.label,
        revision: draft.revision,
        origin: draft.origin,
        content: draft.content,
      });
      continue;
    }

    if (draft.approvedVersionId === undefined || draft.closedAt === undefined) {
      throw new BeaconStoreCorruptionError(
        `Closed draft "${draftId}" is missing approvedVersionId or closedAt`,
      );
    }
    drafts.set(draftId, {
      status: "closed",
      draftId: draft.draftId,
      label: draft.label,
      revision: draft.revision,
      origin: draft.origin,
      content: draft.content,
      approvedVersionId: draft.approvedVersionId,
      closedAt: draft.closedAt,
    });
  }

  return Object.fromEntries(drafts);
}

export interface BeaconScan {
  readonly beacon: Beacon;
  readonly orphanVersionIds: readonly string[];
}

/** The full read-only reconstruction: beacon.json + the version and draft scans. */
export async function scanBeacon(projectRoot: string, beaconId: string): Promise<BeaconScan> {
  const layout = createLayout(projectRoot);
  const beaconRecord = await readRecord<BeaconRecordFile>(layout.beaconRecord(beaconId), "beacon");
  if (beaconRecord === undefined) {
    throw new BeaconStoreCorruptionError(
      `beacon.json missing for existing beacon directory "${beaconId}"`,
    );
  }
  if (beaconRecord.beaconId !== beaconId) {
    throw new BeaconStoreCorruptionError(
      `Embedded beacon id "${beaconRecord.beaconId}" does not match directory "${beaconId}"`,
    );
  }

  const [{ versions, activeVersionId, orphanVersionIds }, drafts] = await Promise.all([
    scanVersions(projectRoot, beaconId),
    scanDrafts(projectRoot, beaconId),
  ]);

  return {
    beacon: { beaconId, title: beaconRecord.title, drafts, versions, activeVersionId },
    orphanVersionIds,
  };
}

/** D8 — sorted, `.tmp.`-filtered listing of every beacon directory. */
export async function listBeaconIds(projectRoot: string): Promise<string[]> {
  const layout = createLayout(projectRoot);
  let entries: string[];
  try {
    entries = await readdir(layout.beacons());
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  return layout.listBeaconIds(entries);
}
