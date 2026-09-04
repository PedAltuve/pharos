import { access } from "node:fs/promises";
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
import { resolveActiveVersion } from "../../domain/beacon/index.js";
import type { Hasher } from "../../domain/ports/hasher.js";
import { err, ok } from "../../shared/result.js";
import type { Result } from "../../shared/result.js";
import type { AtomicWriter } from "./atomic-writer.js";
import { FsAtomicWriter } from "./atomic-writer.js";
import { classifyId, createLayout } from "./layout.js";
import { ProjectLock } from "./lock.js";
import { listBeaconIds, scanBeacon } from "./reconcile.js";

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

  async createDraft(
    beaconId: string,
    cmd: StoreCreateDraftCommand,
    key: IdempotencyKey,
  ): Promise<Result<Beacon, BeaconStoreRefusal>> {
    void beaconId;
    void cmd;
    void key;
    throw new Error("createDraft: not yet implemented (lands in U6)");
  }

  async updateDraft(
    beaconId: string,
    cmd: UpdateDraftCommand,
    key: IdempotencyKey,
  ): Promise<Result<Beacon, BeaconStoreRefusal>> {
    void beaconId;
    void cmd;
    void key;
    throw new Error("updateDraft: not yet implemented (lands in U6)");
  }

  async forkDraft(
    beaconId: string,
    cmd: ForkDraftCommand,
    key: IdempotencyKey,
  ): Promise<Result<Beacon, BeaconStoreRefusal>> {
    void beaconId;
    void cmd;
    void key;
    throw new Error("forkDraft: not yet implemented (lands in U6)");
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
