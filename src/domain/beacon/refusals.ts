export interface DuplicateDraftId {
  readonly rule: "duplicate-draft-id";
  readonly draftId: string;
}

export type BeaconRefusal = DuplicateDraftId;
