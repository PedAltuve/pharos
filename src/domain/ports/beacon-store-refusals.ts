import type { BeaconRefusal } from "../beacon/refusals.js";

export type ImmutableArtifact =
  | "manifest"
  | "semantics"
  | "revocation"
  | "tombstone"
  | "journal-entry";

export interface LockUnavailable {
  readonly rule: "lock-unavailable";
  readonly holderPid: number | null;
  readonly waitedMs: number;
}

export interface IdempotencyKeyConflict {
  readonly rule: "idempotency-key-conflict";
  readonly key: string;
  readonly storedInputHash: string;
  readonly requestedInputHash: string;
}

export interface ImmutableFileExists {
  readonly rule: "immutable-file-exists";
  readonly artifact: ImmutableArtifact;
  readonly beaconId: string;
  readonly ownerId: string; // draftId | versionId | keyHash
}

export interface BeaconNotFound {
  readonly rule: "beacon-not-found";
  readonly beaconId: string;
}

export interface StoredVersionNotFound {
  readonly rule: "stored-version-not-found";
  readonly beaconId: string;
  readonly versionId: string;
}

// An earlier interrupted attempt under this same key left a write-once
// artifact whose aggregate-derived fields are now stale. Normal interleaving,
// not corruption. Named exit: retry with a fresh versionId and a fresh key.
export interface StaleAttemptArtifact {
  readonly rule: "stale-attempt-artifact";
  readonly artifact: ImmutableArtifact;
  readonly beaconId: string;
  readonly ownerId: string;
  readonly key: string;
}

// A caller-supplied id failing D7 layer 1 validation. A *new* id on a
// creation path (createDraft/forkDraft's draftId, approveDraft's versionId)
// is neither "not found" nor corruption, and beacon-store-port R3 forbids
// throwing for caller input.
export interface InvalidId {
  readonly rule: "invalid-id";
  readonly field: "beaconId" | "draftId" | "versionId";
  readonly value: string;
}

export type BeaconStoreDiskRefusal =
  | LockUnavailable
  | IdempotencyKeyConflict
  | ImmutableFileExists
  | BeaconNotFound
  | StoredVersionNotFound
  | StaleAttemptArtifact
  | InvalidId;

export type BeaconStoreRefusal = BeaconRefusal | BeaconStoreDiskRefusal;
