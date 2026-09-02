import type { SemanticSource } from "../semantics/index.js";
import type { Version } from "./versions.js";

export interface Beacon {
  readonly beaconId: string;
  readonly title: string;
  readonly drafts: Readonly<Record<string, Draft>>;
  readonly versions: Readonly<Record<string, Version>>;
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
