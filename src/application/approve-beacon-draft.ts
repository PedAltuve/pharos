import type { BeaconId, CaptureRefusal, RequestId } from "../domain/capture/index.js";
import type { BeaconStoreRefusal } from "../domain/ports/beacon-store-refusals.js";
import type { JsonValue } from "../domain/ports/json-value.js";
import type { BeaconStore, CaptureStore, Clock, Hasher, IdGenerator } from "../domain/ports/index.js";
import type { ProjectId } from "../domain/project/index.js";
import { project } from "../domain/semantics/index.js";
import { err, ok, type Result } from "../shared/result.js";
import type { DraftAssociationMismatch } from "./annotate-capture.js";

export interface ApproveBeaconDraftRequest {
  readonly projectId: ProjectId;
  readonly beaconId: BeaconId;
  readonly requestId: RequestId;
  readonly reviewedHash: string;
  readonly operatorConfirmed: boolean;
  readonly actor: string | null;
  readonly staleOriginAcknowledged?: boolean;
}

export interface ApprovedBeaconDraft {
  readonly beaconId: BeaconId;
  readonly versionId: string;
  readonly status: "active";
  readonly semanticHash: string;
  readonly assurance: "operator_confirmed";
}

export interface OperatorConfirmationRequired {
  readonly rule: "operator-confirmation-required";
}

export type ApproveBeaconDraftRefusal =
  | CaptureRefusal
  | BeaconStoreRefusal
  | OperatorConfirmationRequired
  | DraftAssociationMismatch;

export interface ApproveBeaconDraftDependencies {
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly hasher: Hasher;
  readonly captureStore: CaptureStore;
  readonly beaconStore: BeaconStore;
}

/** Approves exactly one association-bound draft after an explicit operator confirmation. */
export class ApproveBeaconDraft {
  constructor(private readonly dependencies: ApproveBeaconDraftDependencies) {}

  async execute(request: ApproveBeaconDraftRequest): Promise<Result<ApprovedBeaconDraft, ApproveBeaconDraftRefusal>> {
    if (!request.operatorConfirmed) return err({ rule: "operator-confirmation-required" });

    const association = await this.dependencies.captureStore.getAssociationByBeacon(
      request.projectId,
      request.beaconId,
    );
    if (!association.ok) return association;
    if (
      association.value === null
      || association.value.state !== "committed"
      || association.value.semanticHash === undefined
    ) return err({ rule: "draft-association-mismatch" });

    const session = await this.dependencies.captureStore.getSession(
      request.projectId,
      association.value.captureId,
    );
    if (!session.ok) return session;
    if (session.value.status !== "promoted") return err({ rule: "draft-association-mismatch" });

    const beacon = await this.dependencies.beaconStore.getBeacon(request.beaconId);
    if (!beacon.ok) return beacon;
    if (beacon.value.beaconId !== request.beaconId || beacon.value.beaconId !== association.value.beaconId) {
      return err({ rule: "draft-association-mismatch" });
    }

    // Supporting records select the semantic source only. Draft state,
    // revision, and cardinality are admitted atomically by BeaconStore.
    const draft = beacon.value.drafts[association.value.draftId];
    if (draft === undefined || draft.draftId !== association.value.draftId) {
      return err({ rule: "draft-association-mismatch" });
    }

    if (draft.status === "abandoned") return err({ rule: "draft-association-mismatch" });
    const semanticHash = draft.status === "open"
      ? this.dependencies.hasher.hash(project(draft.content) as JsonValue)
      : association.value.semanticHash;
    if (draft.status === "open" && semanticHash !== association.value.semanticHash) {
      return err({ rule: "draft-association-mismatch" });
    }
    if (semanticHash !== request.reviewedHash) {
      return err({
        rule: "reviewed-hash-mismatch",
        draftId: draft.draftId,
        reviewedHash: request.reviewedHash,
        currentHash: semanticHash,
      });
    }

    const versionId = this.dependencies.ids.next("version");
    const approvedAt = this.dependencies.clock.now().toISOString();
    const approved = await this.dependencies.beaconStore.approveDraft(
      request.beaconId,
      {
        draftId: association.value.draftId,
        expectedRevision: association.value.revision,
        reviewedHash: semanticHash,
        versionId,
        approvedAt,
        actor: request.actor,
        staleOriginAcknowledged: request.staleOriginAcknowledged ?? false,
      },
      `beacon-approve:${request.projectId}:${request.beaconId}:${request.requestId}`,
    );
    if (!approved.ok) return approved;

    const canonicalDraft = approved.value.drafts[association.value.draftId];
    const canonicalVersionId = canonicalDraft?.status === "closed"
      ? canonicalDraft.approvedVersionId
      : undefined;
    const version = canonicalVersionId === undefined
      ? undefined
      : approved.value.versions[canonicalVersionId];
    if (version?.status !== "active") return err({ rule: "draft-association-mismatch" });
    return ok({
      beaconId: request.beaconId,
      versionId: version.versionId,
      status: "active",
      semanticHash,
      assurance: "operator_confirmed",
    });
  }
}
