import { readFile, readdir } from "node:fs/promises";
import type { RevocationRecord, Version } from "../../domain/beacon/index.js";
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
async function listSorted(path: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(path);
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  return entries.filter((entry) => !entry.includes(".tmp.")).sort();
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

  const committed = new Map<string, Version>();

  function statusOf(versionId: string, manifest: ManifestFile, successorId: string | null): Version {
    const base = {
      versionId: manifest.versionId,
      localNumber: manifest.localNumber,
      approval: manifest.approval,
      provenance: manifest.provenance,
    };
    const revocation = revocations.get(versionId);
    if (revocation !== undefined) {
      return {
        ...base,
        status: "revoked",
        previousStatus: revocation.previousStatus,
        revocation: revocation.revocation,
      };
    }
    if (successorId !== null) {
      const successorManifest = manifests.get(successorId);
      if (successorManifest === undefined) {
        throw new BeaconStoreCorruptionError(
          `Walk successor "${successorId}" for "${versionId}" has no manifest.json`,
        );
      }
      return {
        ...base,
        status: "superseded",
        supersededBy: successorId,
        supersededAt: successorManifest.approval.approvedAt,
      };
    }
    return { ...base, status: "active" };
  }

  for (const root of [...roots].sort()) {
    const chainVisited = new Set<string>();
    let successorId: string | null = null;
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

      committed.set(current, statusOf(current, manifest, successorId));

      successorId = current;
      current = manifest.supersedesVersion;
    }
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
