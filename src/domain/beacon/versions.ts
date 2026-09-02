interface ApprovedVersionBase {
  readonly versionId: string;
  readonly localNumber: number;
  readonly approval: ApprovalRecord;
  readonly provenance: VersionProvenance;
}

export type Version =
  | (ApprovedVersionBase & { readonly status: "active" })
  | (ApprovedVersionBase & {
      readonly status: "superseded";
      readonly supersededBy: string;
      readonly supersededAt: string;
    })
  | (ApprovedVersionBase & {
      readonly status: "revoked";
      readonly revocation: RevocationRecord;
      readonly previousStatus: "active" | "superseded";
    });

export type ActiveVersion = Extract<Version, { readonly status: "active" }>;

export interface ApprovalRecord {
  readonly approvedAt: string;
  readonly reviewedHash: string;
  readonly staleOriginAcknowledged: boolean;
  readonly assurance: "operator_confirmed";
  readonly actor: string | null;
}

export interface VersionProvenance {
  readonly approvedDraftId: string;
  readonly approvedRevision: number;
  readonly branchedFromVersion: string | null;
  readonly branchedFromHash: string | null;
}

export interface RevocationRecord {
  readonly revokedAt: string;
  readonly reason: string;
  readonly actor: string | null;
}
