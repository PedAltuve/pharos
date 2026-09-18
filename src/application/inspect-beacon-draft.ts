import type { BeaconId, CaptureId, CaptureRefusal } from "../domain/capture/index.js";
import type { BeaconStoreRefusal } from "../domain/ports/beacon-store-refusals.js";
import type { JsonValue } from "../domain/ports/json-value.js";
import type { BeaconStore, CaptureStore, Hasher } from "../domain/ports/index.js";
import type { ProjectId } from "../domain/project/index.js";
import { project, type SemanticSource } from "../domain/semantics/index.js";
import { err, ok, type Result } from "../shared/result.js";
import type { DraftAssociationMismatch } from "./annotate-capture.js";

export interface InspectBeaconDraftRequest {
  readonly projectId: ProjectId;
  readonly beaconId: BeaconId;
}

export interface InspectedBeaconDraft {
  readonly beacon: {
    readonly authority: "authoritative";
    readonly beaconId: BeaconId;
    readonly draftId: `drf_${string}`;
    readonly revision: 1;
    readonly status: "open";
    readonly semanticHash: string;
    readonly semantics: SemanticSource;
  };
  readonly capture: {
    readonly authority: "supporting-non-authoritative";
    readonly captureId: CaptureId;
    readonly artifact: { readonly reference: string; readonly byteSize: number; readonly sha256: string };
  };
}

export type InspectBeaconDraftRefusal = CaptureRefusal | BeaconStoreRefusal | DraftAssociationMismatch;

/** Read-only cross-store agreement check; it never upgrades supporting capture data to authority. */
export class InspectBeaconDraft {
  constructor(private readonly dependencies: { readonly captureStore: CaptureStore; readonly beaconStore: BeaconStore; readonly hasher: Hasher }) {}

  async execute(request: InspectBeaconDraftRequest): Promise<Result<InspectedBeaconDraft, InspectBeaconDraftRefusal>> {
    const association = await this.dependencies.captureStore.getAssociationByBeacon(request.projectId, request.beaconId);
    if (!association.ok) return association;
    if (association.value === null || association.value.state !== "committed" || association.value.semanticHash === undefined) {
      return err({ rule: "draft-association-mismatch" });
    }
    const session = await this.dependencies.captureStore.getSession(request.projectId, association.value.captureId);
    if (!session.ok) return session;
    if (session.value.status !== "promoted") return err({ rule: "draft-association-mismatch" });
    const beacon = await this.dependencies.beaconStore.getBeacon(request.beaconId);
    if (!beacon.ok) return beacon;
    if (beacon.value.beaconId !== request.beaconId || beacon.value.beaconId !== association.value.beaconId) {
      return err({ rule: "draft-association-mismatch" });
    }
    const draft = beacon.value.drafts[association.value.draftId];
    if (draft === undefined || draft.draftId !== association.value.draftId || draft.status !== "open" || draft.revision !== association.value.revision) {
      return err({ rule: "draft-association-mismatch" });
    }
    const semanticHash = this.dependencies.hasher.hash(project(draft.content) as JsonValue);
    if (semanticHash !== association.value.semanticHash) return err({ rule: "draft-association-mismatch" });
    return ok({
      beacon: {
        authority: "authoritative",
        beaconId: request.beaconId,
        draftId: draft.draftId as `drf_${string}`,
        revision: 1,
        status: "open",
        semanticHash,
        semantics: draft.content,
      },
      capture: {
        authority: "supporting-non-authoritative",
        captureId: session.value.captureId,
        artifact: session.value.artifact,
      },
    });
  }
}
