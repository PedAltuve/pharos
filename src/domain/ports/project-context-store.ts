import type { Result } from "../../shared/result.js";
import type { ProjectContext, ProjectContextRefusal, ProjectId, ProjectRequestId } from "../project/index.js";

export interface InitializeProjectContextCommand {
  readonly context: ProjectContext;
  readonly associationPath: string;
  readonly requestId: ProjectRequestId;
  readonly inputHash: string;
}

/** Application-owned context routing. It must not write a target repository. */
export interface ProjectContextStore {
  initialize(command: InitializeProjectContextCommand): Promise<Result<ProjectContext, ProjectContextRefusal>>;
  resolveById(projectId: ProjectId): Promise<Result<ProjectContext, ProjectContextRefusal>>;
  resolveByPath(canonicalPath: string): Promise<Result<ProjectContext, ProjectContextRefusal>>;
}
