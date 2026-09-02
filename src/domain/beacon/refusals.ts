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

export type BeaconRefusal =
  | DuplicateDraftId
  | DraftNotFound
  | DraftNotOpen
  | StaleDraftRevision
  | SourceDraftHasNoContent;
