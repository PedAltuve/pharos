import type { Dirent } from "node:fs";
import { mkdir, readFile, readdir } from "node:fs/promises";
import type { Beacon, Draft, DraftOrigin, RevocationRecord, Version } from "../../domain/beacon/index.js";
import type { SemanticSource } from "../../domain/semantics/index.js";
import type { AtomicWriter } from "./atomic-writer.js";
import { BeaconStoreCorruptionError } from "./corruption.js";
import { createJournalEntry, readJournalEntry } from "./journal.js";
import type { JournalMethod } from "./journal.js";
import { classifyId, createLayout } from "./layout.js";
import { deserializeRecord, serializeRecord, type FileKind } from "./serialization.js";

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
  readonly idempotency?: DraftIdempotencyStamp;
}

interface RevocationFile {
  readonly previousStatus: "active" | "superseded";
  readonly revocation: RevocationRecord;
  readonly idempotency?: DraftIdempotencyStamp;
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
  readonly idempotency?: DraftIdempotencyStamp;
}

// D1e's mutable-commit-point stamp. Untyped `method` on disk, same reasoning
// as DraftFile's `status` (DEFECT 4) — checked at runtime before use.
interface DraftIdempotencyStamp {
  readonly key: string;
  readonly keyHash: string;
  readonly inputHash: string;
  readonly method: string;
}

interface DraftFile {
  readonly draftId: string;
  readonly label: string;
  // Untyped on disk — `unpick` copies this verbatim with no enum
  // validation, so an unmodelled value must be checked at runtime (DEFECT 4).
  readonly status: string;
  readonly revision: number;
  readonly origin: DraftOrigin;
  readonly content: SemanticSource;
  readonly approvedVersionId?: string;
  readonly closedAt?: string;
  readonly idempotency?: DraftIdempotencyStamp;
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
// D7 — every remaining entry name is a disk-provenance id (ROOT CAUSE 1):
// a segment failing validation is corrupt store state, never a bare throw.
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
    if (classifyId(entry.name, "disk") !== "valid") {
      throw new BeaconStoreCorruptionError(`Invalid id "${entry.name}" found in "${path}"`);
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

    // D1b's reconstruction rule is total over exactly "open" | "closed" |
    // (tombstone-derived) "abandoned"; anything else is unmodelled disk
    // state and must not be silently folded into "closed" (DEFECT 4).
    if (draft.status !== "closed") {
      throw new BeaconStoreCorruptionError(
        `Draft "${draftId}" has an unmodelled status "${draft.status}"`,
      );
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

/**
 * D8 — sorted, `.tmp.`-filtered listing of every beacon directory. Same
 * treatment as `listSorted` (ROOT CAUSE 2): `withFileTypes` so a stray
 * non-directory entry raises `BeaconStoreCorruptionError` instead of
 * escaping as a raw `ENOTDIR` from a later read, and every disk-provenance
 * id is validated per D7 (ROOT CAUSE 1) before it reaches a caller.
 */
export async function listBeaconIds(projectRoot: string): Promise<string[]> {
  const layout = createLayout(projectRoot);
  let entries: Dirent[];
  try {
    entries = await readdir(layout.beacons(), { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }

  const names: string[] = [];
  for (const entry of entries) {
    if (entry.name.includes(".tmp.")) continue;
    if (!entry.isDirectory()) {
      throw new BeaconStoreCorruptionError(
        `Non-directory entry "${entry.name}" found in "${layout.beacons()}"`,
      );
    }
    names.push(entry.name);
  }

  const beaconIds = layout.listBeaconIds(names);
  for (const beaconId of beaconIds) {
    if (classifyId(beaconId, "disk") !== "valid") {
      throw new BeaconStoreCorruptionError(
        `Invalid beacon id "${beaconId}" found in "${layout.beacons()}"`,
      );
    }
  }
  return beaconIds;
}

const DRAFT_WINDOW_METHODS: ReadonlySet<string> = new Set(["createDraft", "updateDraft", "forkDraft"]);

function isDraftWindowMethod(value: string): value is JournalMethod {
  return DRAFT_WINDOW_METHODS.has(value);
}

function isAbandonmentMethod(value: string): value is "abandonDraft" {
  return value === "abandonDraft";
}

function isApprovalMethod(value: string): value is "approveDraft" {
  return value === "approveDraft";
}

function isRevocationMethod(value: string): value is "revokeVersion" {
  return value === "revokeVersion";
}

/**
 * D1e — the mutable-commit-point journal window. For each draft under
 * `beaconId` whose `draft.json` carries an idempotency stamp but whose
 * journal entry is missing, writes the missing entry from the stamp alone
 * (no stored snapshot, no re-execution). A tombstoned draft is D1b's
 * abandonment window: it finishes draft cleanup and writes the original
 * journal entry from the tombstone stamp. MUST be called with the project
 * lock already held (D5b) — this is step (1a) of the envelope.
 */
export async function applyPendingProjectDraftReplays(
  projectRoot: string,
  writer: AtomicWriter,
): Promise<void> {
  for (const beaconId of await listBeaconIds(projectRoot)) {
    await applyPendingDraftReplays(projectRoot, beaconId, writer);
  }
}

// D1c — revocation.json is the commit point. A missing journal proves
// cleanup is pending: remove a stale active pointer only when it still names
// the revoked version, then create the original journal entry.
async function applyPendingRevocationReplays(
  projectRoot: string,
  beaconId: string,
  writer: AtomicWriter,
): Promise<void> {
  const layout = createLayout(projectRoot);
  for (const versionId of await listSorted(layout.versions(beaconId))) {
    const revocation = await readRecord<RevocationFile>(
      layout.revocation(beaconId, versionId), "revocation",
    );
    const stamp = revocation?.idempotency;
    if (stamp === undefined || !isRevocationMethod(stamp.method)) continue;
    if (await readJournalEntry(projectRoot, stamp.keyHash)) continue;

    const active = await readRecord<ActiveFile>(layout.active(beaconId), "active");
    const removedRevokedActivePointer = active?.activeVersionId === versionId;
    if (removedRevokedActivePointer) {
      await writer.removeAtomic(layout.active(beaconId));
    }
    await mkdir(layout.journalIdempotency(), { recursive: true });
    await createJournalEntry(
      projectRoot,
      {
        key: stamp.key,
        keyHash: stamp.keyHash,
        method: stamp.method,
        beaconId,
        inputHash: stamp.inputHash,
        result: { beaconId, versionId, draftId: null, revision: null },
      },
      writer,
    );
  }
}

// D1's approval rows: active.json is the commit point. If its manifest's
// approval stamp has no journal, close the still-open draft (step 5) and
// create the missing journal entry (step 6). A closed draft skips step 5.
async function applyPendingApprovalReplay(
  projectRoot: string,
  beaconId: string,
  writer: AtomicWriter,
): Promise<void> {
  const layout = createLayout(projectRoot);
  const { activeVersionId } = await scanVersions(projectRoot, beaconId);
  if (activeVersionId === null) return;

  const manifest = await readRecord<ManifestFile>(
    layout.manifest(beaconId, activeVersionId),
    "manifest",
  );
  const stamp = manifest?.idempotency;
  if (manifest === undefined || stamp === undefined || !isApprovalMethod(stamp.method)) return;
  if (await readJournalEntry(projectRoot, stamp.keyHash)) return;

  const draftId = manifest.provenance.approvedDraftId;
  const draft = await readRecord<DraftFile>(layout.draftRecord(beaconId, draftId), "draft");
  if (draft?.status === "open") {
    await writer.writeAtomic(
      layout.draftRecord(beaconId, draftId),
      serializeRecord("draft", {
        ...draft,
        status: "closed",
        approvedVersionId: activeVersionId,
        closedAt: manifest.approval.approvedAt,
        idempotency: stamp,
      }),
    );
  }

  await mkdir(layout.journalIdempotency(), { recursive: true });
  await createJournalEntry(
    projectRoot,
    {
      key: stamp.key,
      keyHash: stamp.keyHash,
      method: stamp.method,
      beaconId,
      inputHash: stamp.inputHash,
      result: { beaconId, versionId: activeVersionId, draftId: null, revision: null },
    },
    writer,
  );
}

export async function applyPendingDraftReplays(
  projectRoot: string,
  beaconId: string,
  writer: AtomicWriter,
): Promise<void> {
  const layout = createLayout(projectRoot);
  await applyPendingRevocationReplays(projectRoot, beaconId, writer);
  await applyPendingApprovalReplay(projectRoot, beaconId, writer);
  const draftIds = await listSorted(layout.drafts(beaconId));

  for (const draftId of draftIds) {
    const tombstone = await readRecord<TombstoneFile>(layout.tombstone(beaconId, draftId), "tombstone");
    if (tombstone !== undefined) {
      const stamp = tombstone.idempotency;
      if (stamp === undefined || !isAbandonmentMethod(stamp.method)) continue;

      const existing = await readJournalEntry(projectRoot, stamp.keyHash);
      if (existing !== undefined) continue;

      // D1b — the tombstone is the abandonment commit point. Finish its
      // pending mutable cleanup before creating the missing original journal
      // entry; neither operation can replace an existing artifact.
      const draft = await readRecord<DraftFile>(layout.draftRecord(beaconId, draftId), "draft");
      if (draft !== undefined) {
        await writer.removeAtomic(layout.draftRecord(beaconId, draftId));
      }
      await mkdir(layout.journalIdempotency(), { recursive: true });
      await createJournalEntry(
        projectRoot,
        {
          key: stamp.key,
          keyHash: stamp.keyHash,
          method: stamp.method,
          beaconId,
          inputHash: stamp.inputHash,
          result: { beaconId, versionId: null, draftId, revision: tombstone.finalRevision },
        },
        writer,
      );
      continue;
    }

    const draft = await readRecord<DraftFile>(layout.draftRecord(beaconId, draftId), "draft");
    if (draft === undefined) continue;

    const stamp = draft.idempotency;
    if (stamp === undefined || !isDraftWindowMethod(stamp.method)) continue;

    const existing = await readJournalEntry(projectRoot, stamp.keyHash);
    if (existing !== undefined) continue;

    await mkdir(layout.journalIdempotency(), { recursive: true });
    await createJournalEntry(
      projectRoot,
      {
        key: stamp.key,
        keyHash: stamp.keyHash,
        method: stamp.method,
        beaconId,
        inputHash: stamp.inputHash,
        result: { beaconId, versionId: null, draftId, revision: draft.revision },
      },
      writer,
    );
  }
}
