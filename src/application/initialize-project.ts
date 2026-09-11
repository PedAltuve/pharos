import {
  PROJECT_CONTEXT_CONTRACT,
  createProjectContext,
  type ProjectContext,
  type ProjectContextRefusal,
  type ProjectEnvironment,
  type ProjectId,
  type ProjectMode,
  type ProjectRequestId,
} from "../domain/project/index.js";
import type { Clock, Hasher, IdGenerator, ProjectContextStore } from "../domain/ports/index.js";
import { err, ok, type Result } from "../shared/result.js";

export interface InitializeProjectRequest {
  readonly name: string;
  readonly mode: ProjectMode;
  readonly environment: ProjectEnvironment | "production";
  readonly baseUrl: string;
  /** A caller-canonicalized, application-owned routing path. */
  readonly associationPath: string;
  readonly requestId: ProjectRequestId;
}

export interface InitializedProject {
  readonly projectId: ProjectId;
  readonly nextAction: "capture-record";
}

export interface InitializeProjectDependencies {
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly store: ProjectContextStore;
  /** Hashes canonical request semantics after domain normalization. */
  readonly hasher: Hasher;
}

function initializationInputHash(
  hasher: Hasher,
  context: ProjectContext,
  associationPath: string,
): string {
  // Project and timestamp are generated after the request is accepted and
  // therefore deliberately excluded from idempotency identity.
  return hasher.hash({
    associationPath,
    baseUrl: context.baseUrl,
    environment: context.environment,
    mode: context.mode,
    name: context.name,
  });
}

/**
 * Coordinates context construction only. Persistence and path routing remain
 * application-owned in ProjectContextStore; this use case has no Beacon or
 * CaptureStore dependency, so initialization cannot create either artifact.
 */
export class InitializeProject {
  private readonly clock: Clock;
  private readonly ids: IdGenerator;
  private readonly store: ProjectContextStore;
  private readonly hasher: Hasher;

  constructor(dependencies: InitializeProjectDependencies) {
    this.clock = dependencies.clock;
    this.ids = dependencies.ids;
    this.store = dependencies.store;
    this.hasher = dependencies.hasher;
  }

  async execute(
    request: InitializeProjectRequest,
  ): Promise<Result<InitializedProject, ProjectContextRefusal>> {
    const context = createProjectContext({
      contract: PROJECT_CONTEXT_CONTRACT,
      projectId: this.ids.next("project"),
      revision: 1,
      name: request.name,
      mode: request.mode,
      environment: request.environment,
      baseUrl: request.baseUrl,
      createdAt: this.clock.now().toISOString(),
    });
    if (!context.ok) return context;

    const initialized = await this.store.initialize({
      context: context.value,
      associationPath: request.associationPath,
      requestId: request.requestId,
      inputHash: initializationInputHash(this.hasher, context.value, request.associationPath),
    });
    if (!initialized.ok) return err(initialized.error);

    return ok({
      projectId: initialized.value.projectId,
      nextAction: "capture-record",
    });
  }
}
