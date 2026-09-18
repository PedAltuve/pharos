import { annotationEligibility, type BeaconId, type CaptureId, type CaptureRefusal, type RequestId } from "../domain/capture/index.js";
import type { BeaconStoreRefusal } from "../domain/ports/beacon-store-refusals.js";
import type { JsonValue } from "../domain/ports/json-value.js";
import type { Clock, CaptureStore, ContractValidationError, ContractValidator, Hasher, IdGenerator, BeaconStore, SecretResolutionRefusal, SecretResolver } from "../domain/ports/index.js";
import { project } from "../domain/semantics/index.js";
import { err, ok, type Result } from "../shared/result.js";
import { mapAnnotation, validateAnnotationPolicy, type AnnotationPolicyRefusal } from "./annotation/index.js";
import type { ProjectId } from "../domain/project/index.js";

export interface AnnotateCaptureRequest {
  readonly projectId: ProjectId;
  readonly captureId: CaptureId;
  readonly requestId: RequestId;
  readonly annotation: unknown;
}

export interface AnnotatedCapture {
  readonly beaconId: BeaconId;
  readonly draftId: `drf_${string}`;
  readonly revision: 1;
  readonly status: "open";
  readonly semanticHash: string;
  readonly captureId: CaptureId;
  readonly nextAction: "beacon-inspect";
}

export interface DraftAssociationMismatch {
  readonly rule: "draft-association-mismatch";
}

export type AnnotateCaptureRefusal =
  | CaptureRefusal
  | BeaconStoreRefusal
  | SecretResolutionRefusal
  | ContractValidationError
  | AnnotationPolicyRefusal
  | DraftAssociationMismatch;

export interface AnnotateCaptureDependencies {
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly hasher: Hasher;
  readonly captureStore: CaptureStore;
  readonly beaconStore: BeaconStore;
  readonly validator: ContractValidator;
  readonly resolver: SecretResolver;
}

/**
 * The only application boundary that can turn a supporting promoted capture
 * into Beacon authority. Association identifiers are claimed before the
 * Beacon mutation and replayed after every supported crash window.
 */
export class AnnotateCapture {
  constructor(private readonly dependencies: AnnotateCaptureDependencies) {}

  async execute(request: AnnotateCaptureRequest): Promise<Result<AnnotatedCapture, AnnotateCaptureRefusal>> {
    const session = await this.dependencies.captureStore.getSession(request.projectId, request.captureId);
    if (!session.ok) return session;
    const promoted = annotationEligibility(session.value);
    if (!promoted.ok) return promoted;

    const validated = this.dependencies.validator.validateAnnotation(request.annotation);
    if (!validated.ok) {
      return err(validated.error[0] ?? { rule: "invalid-contract", field: "/", keyword: "invalid" });
    }

    const resolved = await this.dependencies.resolver.resolve(promoted.value.secretSourceReferences);
    if (!resolved.ok) return resolved;
    try {
      // Policy runs before mapAnnotation/project(), the association claim, or BeaconStore.createDraft.
      const policy = validateAnnotationPolicy(validated.value, {
        secretSourceReferences: promoted.value.secretSourceReferences,
        resolvedSecrets: resolved.value.values,
      });
      if (!policy.ok) return policy;

      const source = mapAnnotation(validated.value);
      const projection = project(source);
      const semanticHash = this.dependencies.hasher.hash(projection as JsonValue);
      const inputHash = this.dependencies.hasher.hash({
        title: (validated.value as { readonly title: string }).title,
        projection,
      } as unknown as JsonValue);
      const claim = await this.dependencies.captureStore.claimAnnotation({
        contract: "pharos.capture-beacon-association/1",
        state: "pending",
        projectId: request.projectId,
        captureId: request.captureId,
        requestId: request.requestId,
        inputHash,
        beaconId: this.dependencies.ids.next("beacon") as BeaconId,
        draftId: this.dependencies.ids.next("draft") as `drf_${string}`,
        revision: 1,
        createdAt: this.dependencies.clock.now().toISOString(),
      });
      if (!claim.ok) return claim;

      const created = await this.dependencies.beaconStore.createDraft(claim.value.beaconId, {
        beaconTitle: (validated.value as { readonly title: string }).title,
        draftId: claim.value.draftId,
        label: (validated.value as { readonly title: string }).title,
        origin: { branchedFromVersion: null, branchedFromHash: null, forkedFromDraft: null },
        content: source,
      }, `capture-annotate:${request.projectId}:${request.captureId}:${request.requestId}`);
      if (!created.ok) return created;
      const draft = created.value.drafts[claim.value.draftId];
      if (draft === undefined || draft.status !== "open" || draft.revision !== 1
        || this.dependencies.hasher.hash(project(draft.content) as JsonValue) !== semanticHash) {
        return err({ rule: "draft-association-mismatch" });
      }

      const committed = await this.dependencies.captureStore.commitAssociation({
        ...claim.value,
        state: "committed",
        semanticHash,
        committedAt: this.dependencies.clock.now().toISOString(),
      });
      if (!committed.ok) return committed;
      return ok({
        beaconId: claim.value.beaconId,
        draftId: claim.value.draftId,
        revision: 1,
        status: "open",
        semanticHash,
        captureId: request.captureId,
        nextAction: "beacon-inspect",
      });
    } finally {
      resolved.value.dispose();
    }
  }
}
