export interface DuplicateDraftId {
  readonly rule: "duplicate-draft-id";
  readonly draftId: string;
}

export interface DraftNotFound {
  readonly rule: "draft-not-found";
  readonly draftId: string;
}

export interface DraftNotOpen {
  readonly rule: "draft-not-open";
  readonly draftId: string;
  readonly status: string;
}

export interface StaleDraftRevision {
  readonly rule: "stale-draft-revision";
  readonly draftId: string;
  readonly expectedRevision: number;
  readonly currentRevision: number;
}

export interface SourceDraftHasNoContent {
  readonly rule: "source-draft-has-no-content";
  readonly draftId: string;
  readonly status: string;
}

export interface VersionNotFound {
  readonly rule: "version-not-found";
  readonly versionId: string;
}

export interface VersionAlreadyRevoked {
  readonly rule: "version-already-revoked";
  readonly versionId: string;
}

export interface DuplicateVersionId {
  readonly rule: "duplicate-version-id";
  readonly versionId: string;
}

export interface ReviewedHashMismatch {
  readonly rule: "reviewed-hash-mismatch";
  readonly draftId: string;
  readonly reviewedHash: string;
  readonly currentHash: string;
}

export interface StaleOriginNotAcknowledged {
  readonly rule: "stale-origin-not-acknowledged";
  readonly draftId: string;
  readonly branchedFromVersion: string | null;
  readonly activeVersionId: string | null;
}

export type BeaconRefusal =
  | DuplicateDraftId
  | DraftNotFound
  | DraftNotOpen
  | StaleDraftRevision
  | SourceDraftHasNoContent
  | VersionNotFound
  | VersionAlreadyRevoked
  | DuplicateVersionId
  | ReviewedHashMismatch
  | StaleOriginNotAcknowledged;
