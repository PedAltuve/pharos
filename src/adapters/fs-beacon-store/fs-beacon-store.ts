import { access, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
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
import type { BeaconStoreRefusal } from "../../domain/ports/beacon-store-refusals.js";
import {
  createDraft as domainCreateDraft,
  forkDraft as domainForkDraft,
  resolveActiveVersion,
  updateDraft as domainUpdateDraft,
} from "../../domain/beacon/index.js";
import type { Hasher } from "../../domain/ports/hasher.js";
import { err, ok } from "../../shared/result.js";
import type { Result } from "../../shared/result.js";
import type { AtomicWriter } from "./atomic-writer.js";
import { FsAtomicWriter } from "./atomic-writer.js";
import {
  createDraftInput,
  createJournalEntry,
  forkDraftInput,
  inputHash,
  keyHash,
  lookupJournal,
  updateDraftInput,
} from "./journal.js";
import type { JournalMethod, JournalResult } from "./journal.js";
import { classifyId, createLayout } from "./layout.js";
import { ProjectLock } from "./lock.js";
import { getOwn } from "./records.js";
import { applyPendingDraftReplays, listBeaconIds, scanBeacon } from "./reconcile.js";
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
    const beaconIds = await listBeaconIds(this.projectRoot);
    const beacons: Beacon[] = [];
    for (const beaconId of beaconIds) {
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
    try {
      // (1a) D1e — complete a pending draft/journal window before this call
      // is ever allowed to reach the domain function again.
      await applyPendingDraftReplays(this.projectRoot, beaconId, this.writer);

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
      await this.lock.release();
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

    const acquired = await this.lock.acquire();
    if (!acquired.ok) return err(acquired.error);
    try {
      // (1a) D1e — same as createDraft's pre-lookup replay step.
      await applyPendingDraftReplays(this.projectRoot, beaconId, this.writer);

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
      await this.lock.release();
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
    if (classifyId(cmd.draftId, "creation") !== "valid") {
      return err({ rule: "invalid-id", field: "draftId", value: cmd.draftId });
    }

    const acquired = await this.lock.acquire();
    if (!acquired.ok) return err(acquired.error);
    try {
      // (1a) D1e — same as createDraft's pre-lookup replay step.
      await applyPendingDraftReplays(this.projectRoot, beaconId, this.writer);

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
      await this.lock.release();
    }
  }

  async abandonDraft(
    beaconId: string,
    cmd: AbandonDraftCommand,
    key: IdempotencyKey,
  ): Promise<Result<Beacon, BeaconStoreRefusal>> {
    void beaconId;
    void cmd;
    void key;
    throw new Error("abandonDraft: not yet implemented (lands in U7)");
  }

  async approveDraft(
    beaconId: string,
    cmd: ApproveDraftCommand,
    key: IdempotencyKey,
  ): Promise<Result<Beacon, BeaconStoreRefusal>> {
    void beaconId;
    void cmd;
    void key;
    throw new Error("approveDraft: not yet implemented (lands in U8)");
  }

  async revokeVersion(
    beaconId: string,
    cmd: RevokeVersionCommand,
    key: IdempotencyKey,
  ): Promise<Result<Beacon, BeaconStoreRefusal>> {
    void beaconId;
    void cmd;
    void key;
    throw new Error("revokeVersion: not yet implemented (lands in U9)");
  }
}
