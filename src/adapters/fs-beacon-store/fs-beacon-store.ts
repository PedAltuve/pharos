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
import type { Hasher } from "../../domain/ports/hasher.js";
import { err, ok } from "../../shared/result.js";
import type { Result } from "../../shared/result.js";
import type { AtomicWriter } from "./atomic-writer.js";
import { FsAtomicWriter } from "./atomic-writer.js";
import { createLayout } from "./layout.js";
import { ProjectLock } from "./lock.js";
import { scanBeacon } from "./reconcile.js";

export interface FsBeaconStoreOptions {
  readonly projectRoot: string;
  readonly hasher: Hasher;
  readonly writer?: AtomicWriter;
  readonly lock?: ProjectLock;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
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
    const layout = createLayout(this.projectRoot);
    if (!(await pathExists(layout.beaconRecord(beaconId)))) {
      return err({ rule: "beacon-not-found", beaconId });
    }
    const scan = await scanBeacon(this.projectRoot, beaconId);
    return ok(scan.beacon);
  }

  async listBeacons(): Promise<Result<readonly Beacon[], BeaconStoreRefusal>> {
    throw new Error("listBeacons: not yet implemented");
  }

  async getActiveVersion(
    beaconId: string,
  ): Promise<Result<ActiveVersion | null, BeaconStoreRefusal>> {
    throw new Error(`getActiveVersion: not yet implemented for "${beaconId}"`);
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
