import type { Result } from "../../shared/result.js";
import type {
  AbandonDraftCommand,
  ActiveVersion,
  ApproveDraftCommand,
  Beacon,
  CreateDraftCommand,
  ForkDraftCommand,
  RevokeVersionCommand,
  RevokeActiveVersionCommand,
  UpdateDraftCommand,
} from "../beacon/index.js";
import type { SemanticProjection } from "../semantics/index.js";
import type { BeaconStoreRefusal } from "./beacon-store-refusals.js";

export type IdempotencyKey = string;

// createDraft also bootstraps beacon.json when the beacon does not exist yet.
// beaconTitle is used only on bootstrap.
export interface StoreCreateDraftCommand extends CreateDraftCommand {
  readonly beaconTitle: string;
}

export interface ActiveSemanticSnapshot {
  readonly versionId: string;
  readonly semanticHash: string;
  readonly semantics: SemanticProjection;
}

export interface BeaconStore {
  /** Optional only for legacy read-only test doubles; production stores implement this reader. */
  getActiveSemanticSnapshot?(beaconId: string): Promise<Result<ActiveSemanticSnapshot | null, BeaconStoreRefusal>>;
  getBeacon(beaconId: string): Promise<Result<Beacon, BeaconStoreRefusal>>;
  listBeacons(): Promise<Result<readonly Beacon[], BeaconStoreRefusal>>;
  getActiveVersion(
    beaconId: string,
  ): Promise<Result<ActiveVersion | null, BeaconStoreRefusal>>;

  createDraft(
    beaconId: string,
    cmd: StoreCreateDraftCommand,
    key: IdempotencyKey,
  ): Promise<Result<Beacon, BeaconStoreRefusal>>;
  updateDraft(
    beaconId: string,
    cmd: UpdateDraftCommand,
    key: IdempotencyKey,
  ): Promise<Result<Beacon, BeaconStoreRefusal>>;
  forkDraft(
    beaconId: string,
    cmd: ForkDraftCommand,
    key: IdempotencyKey,
  ): Promise<Result<Beacon, BeaconStoreRefusal>>;
  abandonDraft(
    beaconId: string,
    cmd: AbandonDraftCommand,
    key: IdempotencyKey,
  ): Promise<Result<Beacon, BeaconStoreRefusal>>;
  approveDraft(
    beaconId: string,
    cmd: ApproveDraftCommand,
    key: IdempotencyKey,
  ): Promise<Result<Beacon, BeaconStoreRefusal>>;
  revokeVersion(
    beaconId: string,
    cmd: RevokeVersionCommand,
    key: IdempotencyKey,
  ): Promise<Result<Beacon, BeaconStoreRefusal>>;
  /** Optional only for legacy read-only test doubles; production stores implement active-only revocation. */
  revokeActiveVersion?(
    beaconId: string,
    cmd: RevokeActiveVersionCommand,
    key: IdempotencyKey,
  ): Promise<Result<Beacon, BeaconStoreRefusal>>;
}
