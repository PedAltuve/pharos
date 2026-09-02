import type { SemanticSource } from "../semantics/index.js";

// C1 keeps `activeVersionId` as an opaque pointer; `versions` arrives with
// C2 (ADR 7) as a one-line addition, not a placeholder invented here.
export interface Beacon {
  readonly beaconId: string;
  readonly title: string;
  readonly drafts: Readonly<Record<string, Draft>>;
  readonly activeVersionId: string | null;
}

export interface DraftOrigin {
  readonly branchedFromVersion: string | null;
  readonly branchedFromHash: string | null;
  readonly forkedFromDraft: string | null;
}

export type Draft =
  | {
      readonly status: "open";
      readonly draftId: string;
      readonly label: string;
      readonly revision: number;
      readonly origin: DraftOrigin;
      readonly content: SemanticSource;
    }
  | {
      readonly status: "closed";
      readonly draftId: string;
      readonly label: string;
      readonly revision: number;
      readonly origin: DraftOrigin;
      readonly content: SemanticSource;
      readonly approvedVersionId: string;
      readonly closedAt: string;
    }
  | {
      readonly status: "abandoned";
      readonly draftId: string;
      readonly label: string;
      readonly origin: DraftOrigin;
      readonly finalRevision: number;
      readonly finalHash: string;
      readonly reason: string;
      readonly abandonedAt: string;
    };
