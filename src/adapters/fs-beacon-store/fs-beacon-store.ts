import { access, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type {
  AbandonDraftCommand,
  ActiveVersion,
  ApproveDraftCommand,
  Beacon,
  ForkDraftCommand,
  RevokeVersionCommand,
  UpdateDraftCommand,
} from "../../domain/beacon/index.js";
import type {
  BeaconStore,
  IdempotencyKey,
  StoreCreateDraftCommand,
} from "../../domain/ports/beacon-store.js";
import type {
  BeaconStoreRefusal,
  ImmutableArtifact,
  LockUnavailable,
} from "../../domain/ports/beacon-store-refusals.js";
import {
  abandonDraft as domainAbandonDraft,
  approveDraft as domainApproveDraft,
  createDraft as domainCreateDraft,
  forkDraft as domainForkDraft,
  revokeVersion as domainRevokeVersion,
  resolveActiveVersion,
  updateDraft as domainUpdateDraft,
} from "../../domain/beacon/index.js";
import type { Hasher } from "../../domain/ports/hasher.js";
import { project } from "../../domain/semantics/index.js";
import { err, ok } from "../../shared/result.js";
import type { Result } from "../../shared/result.js";
import type { AtomicWriter } from "./atomic-writer.js";
import { FsAtomicWriter } from "./atomic-writer.js";
import {
  abandonDraftInput,
  approveInput,
  createDraftInput,
  createJournalEntry,
  forkDraftInput,
  inputHash,
  keyHash,
  lookupJournal,
  revokeVersionInput,
  updateDraftInput,
} from "./journal.js";
import type { JournalMethod, JournalResult } from "./journal.js";
import { classifyId, createLayout } from "./layout.js";
import { ProjectLock } from "./lock.js";
import { getOwn } from "./records.js";
import {
  applyPendingProjectDraftReplays,
  applyRecovery,
  listBeaconIds,
  scanBeacon,
  scanRecovery,
  type RecoverReport,
} from "./reconcile.js";
import { BeaconStoreCorruptionError } from "./corruption.js";
import { serializeRecord } from "./serialization.js";

export interface FsBeaconStoreOptions {
  readonly projectRoot: string;
  readonly hasher: Hasher;
  readonly writer?: AtomicWriter;
  readonly lock?: ProjectLock;
}

function isMissing(error: unknown): boolean {
  return (
    error instanceof Error
    && "code" in error
    && (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

interface IdempotencyStamp {
  readonly key: string;
  readonly keyHash: string;
  readonly inputHash: string;
  readonly method: "approveDraft";
}

type JsonRecord = Record<string, unknown>;
type AdoptionOutcome = "write" | "adopt" | BeaconStoreRefusal;

function recordOf(value: unknown, label: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new BeaconStoreCorruptionError(`${label} is not an object`);
  }
  return value as JsonRecord;
}

function parseArtifact(bytes: string, label: string): JsonRecord {
  try {
    return recordOf(JSON.parse(bytes) as unknown, label);
  } catch (error) {
    if (error instanceof BeaconStoreCorruptionError) throw error;
    throw new BeaconStoreCorruptionError(`${label} is not valid JSON`);
  }
}

function stampOf(record: JsonRecord, label: string): IdempotencyStamp {
  const stamp = recordOf(record.idempotency, `${label} idempotency`);
  if (
    typeof stamp.key !== "string"
    || typeof stamp.key_hash !== "string"
    || typeof stamp.input_hash !== "string"
    || stamp.method !== "approveDraft"
  ) throw new BeaconStoreCorruptionError(`${label} has an invalid idempotency stamp`);
  return {
    key: stamp.key,
    keyHash: stamp.key_hash,
    inputHash: stamp.input_hash,
    method: "approveDraft",
  };
}

function manifestParts(record: JsonRecord): { input: JsonRecord; aggregate: JsonRecord } {
  const { local_number: localNumber, supersedes_version: supersedesVersion, provenance, ...input } = record;
  const { approved_revision: approvedRevision, ...inputProvenance } = recordOf(provenance, "manifest provenance");
  return {
    input: { ...input, provenance: inputProvenance },
    aggregate: {
      local_number: localNumber,
      supersedes_version: supersedesVersion,
      approved_revision: approvedRevision,
    },
  };
}

function stampedSemantics(bytes: string, stamp: IdempotencyStamp): string {
  return JSON.stringify({
    ...parseArtifact(bytes, "semantics"),
    idempotency: {
      key: stamp.key,
      key_hash: stamp.keyHash,
      input_hash: stamp.inputHash,
      method: stamp.method,
    },
  }, null, 2) + "\n";
}

async function resolveAdoption(
  path: string,
  artifact: Extract<ImmutableArtifact, "semantics" | "manifest">,
  expectedBytes: string,
  stamp: IdempotencyStamp,
  beaconId: string,
  ownerId: string,
): Promise<AdoptionOutcome> {
  let storedBytes: string;
  try {
    storedBytes = await readFile(path, "utf8");
  } catch (error) {
    if (isMissing(error)) return "write";
    throw error;
  }
  const stored = parseArtifact(storedBytes, artifact);
  const storedStamp = stampOf(stored, artifact);
  if (storedStamp.keyHash !== stamp.keyHash) {
    return { rule: "immutable-file-exists", artifact, beaconId, ownerId };
  }
  if (storedStamp.inputHash !== stamp.inputHash) {
    return {
      rule: "idempotency-key-conflict",
      key: stamp.key,
      storedInputHash: storedStamp.inputHash,
      requestedInputHash: stamp.inputHash,
    };
  }

  const expected = parseArtifact(expectedBytes, artifact);
  const storedParts = artifact === "manifest" ? manifestParts(stored) : { input: stored, aggregate: {} };
  const expectedParts = artifact === "manifest" ? manifestParts(expected) : { input: expected, aggregate: {} };
  if (!isDeepStrictEqual(storedParts.input, expectedParts.input)) {
    throw new BeaconStoreCorruptionError(`${artifact} input-determined fields differ for an equal input`);
  }
  if (!isDeepStrictEqual(storedParts.aggregate, expectedParts.aggregate)) {
    return { rule: "stale-attempt-artifact", artifact, beaconId, ownerId, key: stamp.key };
  }
  return "adopt";
}

// D3 — only genuine absence maps to `beacon-not-found`. Any other I/O
// condition (EACCES, EPERM, ENOTDIR, ...) has no refusal in D3's closed
// union and must surface, per D4's unmodelled-errno throw rule.
async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

export class FsBeaconStore implements BeaconStore {
  private readonly projectRoot: string;
  private readonly hasher: Hasher;
  private readonly writer: AtomicWriter;
  private readonly lock: ProjectLock;

  constructor(options: FsBeaconStoreOptions) {
    this.projectRoot = options.projectRoot;
    this.hasher = options.hasher;
    this.writer = options.writer ?? new FsAtomicWriter();
    this.lock = options.lock ?? new ProjectLock(options.projectRoot);
  }

  async getBeacon(beaconId: string): Promise<Result<Beacon, BeaconStoreRefusal>> {
    // D7 — a caller-supplied id addressing existing state fails validation
    // by naming nothing: refuse beacon-not-found, never throw (ROOT CAUSE 1).
    if (classifyId(beaconId, "existing") !== "valid") {
      return err({ rule: "beacon-not-found", beaconId });
    }
    const layout = createLayout(this.projectRoot);
    if (!(await pathExists(layout.beaconRecord(beaconId)))) {
      return err({ rule: "beacon-not-found", beaconId });
    }
    const scan = await scanBeacon(this.projectRoot, beaconId);
    return ok(scan.beacon);
  }

  async listBeacons(): Promise<Result<readonly Beacon[], BeaconStoreRefusal>> {
    const layout = createLayout(this.projectRoot);
    const beaconIds = await listBeaconIds(this.projectRoot);
    const beacons: Beacon[] = [];
    for (const beaconId of beaconIds) {
      // D10 — a beacon directory whose beacon.json was never committed is a
      // pre-commit bootstrap artifact from writeIntoDir's mkdir-then-write
      // crash window (I1: nothing is observable before the domain call
      // returns ok), never a corrupt or listable beacon. Skipping it here
      // keeps listBeacons in agreement with getBeacon's own not-found guard
      // instead of scanBeacon raising BeaconStoreCorruptionError on it.
      if (!(await pathExists(layout.beaconRecord(beaconId)))) continue;
      const scan = await scanBeacon(this.projectRoot, beaconId);
      beacons.push(scan.beacon);
    }
    return ok(beacons);
  }

  async getActiveVersion(
    beaconId: string,
  ): Promise<Result<ActiveVersion | null, BeaconStoreRefusal>> {
    // D7 — same caller-supplied/existing-state rule as getBeacon (ROOT CAUSE 1).
    if (classifyId(beaconId, "existing") !== "valid") {
      return err({ rule: "beacon-not-found", beaconId });
    }
    const layout = createLayout(this.projectRoot);
    if (!(await pathExists(layout.beaconRecord(beaconId)))) {
      return err({ rule: "beacon-not-found", beaconId });
    }
    const scan = await scanBeacon(this.projectRoot, beaconId);
    return ok(resolveActiveVersion(scan.beacon));
  }

  private async replayOrConflict(
    beaconId: string,
    key: IdempotencyKey,
    hash: string,
    requestedInputHash: string,
  ): Promise<Result<Beacon, BeaconStoreRefusal> | undefined> {
    const lookup = await lookupJournal(this.projectRoot, hash, requestedInputHash, key);
    if (lookup.outcome === "absent") return undefined;
    if (lookup.outcome === "replay-hit") {
      // WARNING 2 — entry.beaconId is stored alongside inputHash, not bound
      // to it cryptographically; a mismatch means this entry belongs to a
      // different transaction than the one the requested beaconId names, an
      // on-disk inconsistency no legal call sequence produces. Per D4's
      // unmodelled/impossible-state throw rule, this is corruption, not a
      // legitimate replay — never silently scan the requested beacon instead.
      if (lookup.entry.beaconId !== beaconId) {
        throw new BeaconStoreCorruptionError(
          `Journal entry ${hash} is bound to beacon "${lookup.entry.beaconId}", not the requested beacon "${beaconId}"`,
        );
      }
      const scan = await scanBeacon(this.projectRoot, beaconId);
      return ok(scan.beacon);
    }
    return err({
      rule: "idempotency-key-conflict",
      key,
      storedInputHash: lookup.entry.inputHash,
      requestedInputHash,
    });
  }

  // AtomicWriter writes into an already-existing parent directory (D5); the
  // store owns creating new beacon/draft/version subdirectories.
  private async writeIntoDir(path: string, bytes: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await this.writer.writeAtomic(path, bytes);
  }

  private async recordJournalEntry(
    key: string,
    hash: string,
    method: JournalMethod,
    beaconId: string,
    requestedInputHash: string,
    result: JournalResult,
  ): Promise<void> {
    await mkdir(createLayout(this.projectRoot).journalIdempotency(), { recursive: true });
    await createJournalEntry(
      this.projectRoot,
      { key, keyHash: hash, method, beaconId, inputHash: requestedInputHash, result },
      this.writer,
    );
  }

  async createDraft(
    beaconId: string,
    cmd: StoreCreateDraftCommand,
    key: IdempotencyKey,
  ): Promise<Result<Beacon, BeaconStoreRefusal>> {
    // D7's creation-provenance special case — createDraft's beaconId may
    // name a beacon that does not exist yet, so an invalid id here is
    // never not-found, only invalid-id.
    if (classifyId(beaconId, "creation") !== "valid") {
      return err({ rule: "invalid-id", field: "beaconId", value: beaconId });
    }
    if (classifyId(cmd.draftId, "creation") !== "valid") {
      return err({ rule: "invalid-id", field: "draftId", value: cmd.draftId });
    }

    const acquired = await this.lock.acquire();
    if (!acquired.ok) return err(acquired.error);
    const lease = acquired.value;
    try {
      // (1a) D1b/D1e — the journal is project-global, so complete pending
      // draft replays across every beacon before its lookup.
      await applyPendingProjectDraftReplays(this.projectRoot, this.writer);

      const hash = keyHash(key);
      const requestedInputHash = inputHash(createDraftInput(beaconId, cmd, this.hasher), this.hasher);
      const replayed = await this.replayOrConflict(beaconId, key, hash, requestedInputHash);
      if (replayed !== undefined) return replayed;

      const layout = createLayout(this.projectRoot);
      const beaconExists = await pathExists(layout.beaconRecord(beaconId));
      // D10 — an absent beacon is synthesized in memory only; nothing is
      // written to disk until the domain call returns ok (I1).
      const beacon: Beacon = beaconExists
        ? (await scanBeacon(this.projectRoot, beaconId)).beacon
        : { beaconId, title: cmd.beaconTitle, drafts: {}, versions: {}, activeVersionId: null };

      const mutated = domainCreateDraft(beacon, cmd);
      if (!mutated.ok) return mutated;

      if (!beaconExists) {
        await this.writeIntoDir(
          layout.beaconRecord(beaconId),
          serializeRecord("beacon", { beaconId, title: cmd.beaconTitle }),
        );
      }

      const draft = getOwn(mutated.value.drafts, cmd.draftId);
      if (draft === undefined || draft.status !== "open") {
        throw new Error(`createDraft invariant violated for draft "${cmd.draftId}"`);
      }
      await this.writeIntoDir(
        layout.draftRecord(beaconId, cmd.draftId),
        serializeRecord("draft", {
          ...draft,
          idempotency: { key, keyHash: hash, inputHash: requestedInputHash, method: "createDraft" },
        }),
      );

      await this.recordJournalEntry(key, hash, "createDraft", beaconId, requestedInputHash, {
        beaconId, versionId: null, draftId: cmd.draftId, revision: draft.revision,
      });

      return mutated;
    } finally {
      await lease.release();
    }
  }

  async updateDraft(
    beaconId: string,
    cmd: UpdateDraftCommand,
    key: IdempotencyKey,
  ): Promise<Result<Beacon, BeaconStoreRefusal>> {
    // updateDraft never bootstraps — beaconId always addresses existing state.
    if (classifyId(beaconId, "existing") !== "valid") {
      return err({ rule: "beacon-not-found", beaconId });
    }
    // D7 — cmd.draftId also addresses existing state (WARNING 1). No valid
    // draft can ever be keyed by an id that fails this check, so this is a
    // draft-not-found refusal — the same shape the domain lookup itself
    // returns for a valid-but-absent draftId — checked explicitly here so no
    // caller-supplied id ever depends on an implicit lookup-miss for safety.
    if (classifyId(cmd.draftId, "existing") !== "valid") {
      return err({ rule: "draft-not-found", draftId: cmd.draftId });
    }

    const acquired = await this.lock.acquire();
    if (!acquired.ok) return err(acquired.error);
    const lease = acquired.value;
    try {
      // (1a) D1b/D1e — same project-wide pre-lookup replay step.
      await applyPendingProjectDraftReplays(this.projectRoot, this.writer);

      const hash = keyHash(key);
      const requestedInputHash = inputHash(updateDraftInput(beaconId, cmd, this.hasher), this.hasher);
      const replayed = await this.replayOrConflict(beaconId, key, hash, requestedInputHash);
      if (replayed !== undefined) return replayed;

      const layout = createLayout(this.projectRoot);
      if (!(await pathExists(layout.beaconRecord(beaconId)))) {
        return err({ rule: "beacon-not-found", beaconId });
      }
      const { beacon } = await scanBeacon(this.projectRoot, beaconId);

      const mutated = domainUpdateDraft(beacon, cmd);
      if (!mutated.ok) return mutated;

      const draft = getOwn(mutated.value.drafts, cmd.draftId);
      if (draft === undefined || draft.status !== "open") {
        throw new Error(`updateDraft invariant violated for draft "${cmd.draftId}"`);
      }
      await this.writeIntoDir(
        layout.draftRecord(beaconId, cmd.draftId),
        serializeRecord("draft", {
          ...draft,
          idempotency: { key, keyHash: hash, inputHash: requestedInputHash, method: "updateDraft" },
        }),
      );

      await this.recordJournalEntry(key, hash, "updateDraft", beaconId, requestedInputHash, {
        beaconId, versionId: null, draftId: cmd.draftId, revision: draft.revision,
      });

      return mutated;
    } finally {
      await lease.release();
    }
  }

  async forkDraft(
    beaconId: string,
    cmd: ForkDraftCommand,
    key: IdempotencyKey,
  ): Promise<Result<Beacon, BeaconStoreRefusal>> {
    // forkDraft never bootstraps; only its new draftId is a creation id.
    if (classifyId(beaconId, "existing") !== "valid") {
      return err({ rule: "beacon-not-found", beaconId });
    }
    // D7 — sourceDraftId addresses existing state too (WARNING 1), same
    // reasoning as updateDraft's draftId check above.
    if (classifyId(cmd.sourceDraftId, "existing") !== "valid") {
      return err({ rule: "draft-not-found", draftId: cmd.sourceDraftId });
    }
    if (classifyId(cmd.draftId, "creation") !== "valid") {
      return err({ rule: "invalid-id", field: "draftId", value: cmd.draftId });
    }

    const acquired = await this.lock.acquire();
    if (!acquired.ok) return err(acquired.error);
    const lease = acquired.value;
    try {
      // (1a) D1b/D1e — same project-wide pre-lookup replay step.
      await applyPendingProjectDraftReplays(this.projectRoot, this.writer);

      const hash = keyHash(key);
      const requestedInputHash = inputHash(forkDraftInput(beaconId, cmd), this.hasher);
      const replayed = await this.replayOrConflict(beaconId, key, hash, requestedInputHash);
      if (replayed !== undefined) return replayed;

      const layout = createLayout(this.projectRoot);
      if (!(await pathExists(layout.beaconRecord(beaconId)))) {
        return err({ rule: "beacon-not-found", beaconId });
      }
      const { beacon } = await scanBeacon(this.projectRoot, beaconId);

      const mutated = domainForkDraft(beacon, cmd);
      if (!mutated.ok) return mutated;

      const draft = getOwn(mutated.value.drafts, cmd.draftId);
      if (draft === undefined || draft.status !== "open") {
        throw new Error(`forkDraft invariant violated for draft "${cmd.draftId}"`);
      }
      await this.writeIntoDir(
        layout.draftRecord(beaconId, cmd.draftId),
        serializeRecord("draft", {
          ...draft,
          idempotency: { key, keyHash: hash, inputHash: requestedInputHash, method: "forkDraft" },
        }),
      );

      await this.recordJournalEntry(key, hash, "forkDraft", beaconId, requestedInputHash, {
        beaconId, versionId: null, draftId: cmd.draftId, revision: draft.revision,
      });

      return mutated;
    } finally {
      await lease.release();
    }
  }

  async abandonDraft(
    beaconId: string,
    cmd: AbandonDraftCommand,
    key: IdempotencyKey,
  ): Promise<Result<Beacon, BeaconStoreRefusal>> {
    if (classifyId(beaconId, "existing") !== "valid") {
      return err({ rule: "beacon-not-found", beaconId });
    }
    if (classifyId(cmd.draftId, "existing") !== "valid") {
      return err({ rule: "draft-not-found", draftId: cmd.draftId });
    }

    const acquired = await this.lock.acquire();
    if (!acquired.ok) return err(acquired.error);
    const lease = acquired.value;
    try {
      // D1b/D1e — complete every pending committed draft mutation project-wide
      // before the project-global journal lookup.
      await applyPendingProjectDraftReplays(this.projectRoot, this.writer);

      const hash = keyHash(key);
      const requestedInputHash = inputHash(abandonDraftInput(beaconId, cmd), this.hasher);
      const replayed = await this.replayOrConflict(beaconId, key, hash, requestedInputHash);
      if (replayed !== undefined) return replayed;

      const layout = createLayout(this.projectRoot);
      if (!(await pathExists(layout.beaconRecord(beaconId)))) {
        return err({ rule: "beacon-not-found", beaconId });
      }
      const { beacon } = await scanBeacon(this.projectRoot, beaconId);
      const mutated = domainAbandonDraft(beacon, cmd, this.hasher);
      if (!mutated.ok) return mutated;

      const draft = getOwn(mutated.value.drafts, cmd.draftId);
      if (draft === undefined || draft.status !== "abandoned") {
        throw new Error(`abandonDraft invariant violated for draft "${cmd.draftId}"`);
      }
      const tombstone = layout.tombstone(beaconId, cmd.draftId);
      const created = await this.writer.createExclusive(
        tombstone,
        serializeRecord("tombstone", {
          draftId: draft.draftId,
          label: draft.label,
          origin: draft.origin,
          finalRevision: draft.finalRevision,
          finalHash: draft.finalHash,
          reason: draft.reason,
          abandonedAt: draft.abandonedAt,
          idempotency: { key, keyHash: hash, inputHash: requestedInputHash, method: "abandonDraft" },
        }),
      );
      if (created === "exists") {
        return err({
          rule: "immutable-file-exists", artifact: "tombstone", beaconId, ownerId: cmd.draftId,
        });
      }
      await this.writer.removeAtomic(layout.draftRecord(beaconId, cmd.draftId));
      await this.recordJournalEntry(key, hash, "abandonDraft", beaconId, requestedInputHash, {
        beaconId, versionId: null, draftId: cmd.draftId, revision: draft.finalRevision,
      });
      return mutated;
    } finally {
      await lease.release();
    }
  }

  async approveDraft(
    beaconId: string,
    cmd: ApproveDraftCommand,
    key: IdempotencyKey,
  ): Promise<Result<Beacon, BeaconStoreRefusal>> {
    if (classifyId(beaconId, "existing") !== "valid") {
      return err({ rule: "beacon-not-found", beaconId });
    }
    if (classifyId(cmd.draftId, "existing") !== "valid") {
      return err({ rule: "draft-not-found", draftId: cmd.draftId });
    }
    if (classifyId(cmd.versionId, "creation") !== "valid") {
      return err({ rule: "invalid-id", field: "versionId", value: cmd.versionId });
    }

    const acquired = await this.lock.acquire();
    if (!acquired.ok) return err(acquired.error);
    const lease = acquired.value;
    try {
      await applyPendingProjectDraftReplays(this.projectRoot, this.writer);
      const hash = keyHash(key);
      const requestedInputHash = inputHash(approveInput(beaconId, cmd), this.hasher);
      const replayed = await this.replayOrConflict(beaconId, key, hash, requestedInputHash);
      if (replayed !== undefined) return replayed;

      const layout = createLayout(this.projectRoot);
      if (!(await pathExists(layout.beaconRecord(beaconId)))) {
        return err({ rule: "beacon-not-found", beaconId });
      }
      const { beacon } = await scanBeacon(this.projectRoot, beaconId);
      const mutated = domainApproveDraft(beacon, cmd, this.hasher);
      if (!mutated.ok) return mutated;

      const draft = getOwn(mutated.value.drafts, cmd.draftId);
      const version = getOwn(mutated.value.versions, cmd.versionId);
      if (draft === undefined || draft.status !== "closed" || version === undefined) {
        throw new Error(`approveDraft invariant violated for draft "${cmd.draftId}"`);
      }
      const stamp: IdempotencyStamp = {
        key, keyHash: hash, inputHash: requestedInputHash, method: "approveDraft",
      };
      const semantics = layout.semantics(beaconId, cmd.versionId);
      const manifest = layout.manifest(beaconId, cmd.versionId);
      const semanticsBytes = stampedSemantics(
        serializeRecord("semantics", project(draft.content)), stamp,
      );
      const manifestBytes = serializeRecord("manifest", {
        versionId: version.versionId,
        localNumber: version.localNumber,
        approval: version.approval,
        provenance: version.provenance,
        supersedesVersion: beacon.activeVersionId,
        idempotency: stamp,
      });
      const semanticsAdoption = await resolveAdoption(
        semantics, "semantics", semanticsBytes, stamp, beaconId, cmd.versionId,
      );
      if (semanticsAdoption !== "write" && semanticsAdoption !== "adopt") {
        return err(semanticsAdoption);
      }
      const manifestAdoption = await resolveAdoption(
        manifest, "manifest", manifestBytes, stamp, beaconId, cmd.versionId,
      );
      if (manifestAdoption !== "write" && manifestAdoption !== "adopt") {
        return err(manifestAdoption);
      }
      await mkdir(dirname(semantics), { recursive: true });
      if (semanticsAdoption === "write" && await this.writer.createExclusive(semantics, semanticsBytes) === "exists") {
        return err({ rule: "immutable-file-exists", artifact: "semantics", beaconId, ownerId: cmd.versionId });
      }
      if (manifestAdoption === "write" && await this.writer.createExclusive(manifest, manifestBytes) === "exists") {
        return err({ rule: "immutable-file-exists", artifact: "manifest", beaconId, ownerId: cmd.versionId });
      }
      await this.writeIntoDir(
        layout.active(beaconId),
        serializeRecord("active", { activeVersionId: cmd.versionId }),
      );
      await this.writeIntoDir(
        layout.draftRecord(beaconId, cmd.draftId),
        serializeRecord("draft", {
          ...draft,
          idempotency: { key, keyHash: hash, inputHash: requestedInputHash, method: "approveDraft" },
        }),
      );
      await this.recordJournalEntry(key, hash, "approveDraft", beaconId, requestedInputHash, {
        beaconId, versionId: cmd.versionId, draftId: null, revision: null,
      });
      return mutated;
    } finally {
      await lease.release();
    }
  }

  async recoverProject(): Promise<Result<RecoverReport, LockUnavailable>> {
    const report = await scanRecovery(this.projectRoot);
    if (report.actions.length === 0) return ok(report);

    const acquired = await this.lock.acquire();
    if (!acquired.ok) return err(acquired.error);
    const lease = acquired.value;
    try {
      const authoritative = await scanRecovery(this.projectRoot);
      if (authoritative.actions.length > 0) {
        await applyRecovery(this.projectRoot, this.writer, authoritative, this.lock.staleAfterMs);
      }
      const postScan = await scanRecovery(this.projectRoot);
      return ok({ artifacts: postScan.artifacts, actions: authoritative.actions });
    } finally {
      await lease.release();
    }
  }

  async revokeVersion(
    beaconId: string,
    cmd: RevokeVersionCommand,
    key: IdempotencyKey,
  ): Promise<Result<Beacon, BeaconStoreRefusal>> {
    if (classifyId(beaconId, "existing") !== "valid") {
      return err({ rule: "beacon-not-found", beaconId });
    }
    if (classifyId(cmd.versionId, "existing") !== "valid") {
      return err({ rule: "version-not-found", versionId: cmd.versionId });
    }

    const acquired = await this.lock.acquire();
    if (!acquired.ok) return err(acquired.error);
    const lease = acquired.value;
    try {
      await applyPendingProjectDraftReplays(this.projectRoot, this.writer);
      const hash = keyHash(key);
      const requestedInputHash = inputHash(revokeVersionInput(beaconId, cmd), this.hasher);
      const replayed = await this.replayOrConflict(beaconId, key, hash, requestedInputHash);
      if (replayed !== undefined) return replayed;

      const layout = createLayout(this.projectRoot);
      if (!(await pathExists(layout.beaconRecord(beaconId)))) {
        return err({ rule: "beacon-not-found", beaconId });
      }
      const { beacon } = await scanBeacon(this.projectRoot, beaconId);
      const mutated = domainRevokeVersion(beacon, cmd);
      if (!mutated.ok) return mutated;

      const version = getOwn(mutated.value.versions, cmd.versionId);
      if (version === undefined || version.status !== "revoked") {
        throw new Error(`revokeVersion invariant violated for version "${cmd.versionId}"`);
      }
      await mkdir(dirname(layout.revocation(beaconId, cmd.versionId)), { recursive: true });
      const created = await this.writer.createExclusive(
        layout.revocation(beaconId, cmd.versionId),
        serializeRecord("revocation", {
          previousStatus: version.previousStatus,
          revocation: version.revocation,
          idempotency: { key, keyHash: hash, inputHash: requestedInputHash, method: "revokeVersion" },
        }),
      );
      if (created === "exists") {
        return err({
          rule: "immutable-file-exists", artifact: "revocation", beaconId, ownerId: cmd.versionId,
        });
      }
      if (beacon.activeVersionId === cmd.versionId) {
        await this.writer.removeAtomic(layout.active(beaconId));
      }
      await this.recordJournalEntry(key, hash, "revokeVersion", beaconId, requestedInputHash, {
        beaconId, versionId: cmd.versionId, draftId: null, revision: null,
      });
      return mutated;
    } finally {
      await lease.release();
    }
  }
}
