import type { Result } from "../../shared/result.js";

export const PROJECT_CONTEXT_CONTRACT = "pharos.project-context/1" as const;

export type ProjectId = `proj_${string}`;
export type ProjectMode = "repository" | "external";
export type ProjectEnvironment = "local" | "test" | "staging";

export interface ProjectContext {
  readonly contract: typeof PROJECT_CONTEXT_CONTRACT;
  readonly projectId: ProjectId;
  readonly revision: 1;
  readonly name: string;
  readonly mode: ProjectMode;
  readonly environment: ProjectEnvironment;
  readonly baseUrl: string;
  readonly createdAt: string;
}

/** Untrusted, persisted context-shaped input. It is narrowed only by createProjectContext. */
export interface ProjectContextInput {
  readonly contract: string;
  readonly projectId: string;
  readonly revision: number;
  readonly name: string;
  readonly mode: string;
  readonly environment: string;
  readonly baseUrl: string;
  readonly createdAt: string;
}

export interface UnsupportedProjectContextContract {
  readonly rule: "unsupported-project-context-contract";
  readonly contract: string;
}
export interface InvalidProjectId {
  readonly rule: "invalid-project-id";
  readonly projectId: string;
}
export interface InvalidProjectContext {
  readonly rule: "invalid-project-context";
  readonly field: "revision" | "name" | "mode" | "environment" | "baseUrl" | "createdAt";
}
export interface ProductionEnvironment {
  readonly rule: "production-environment";
}
export interface ProjectSelectionRequired {
  readonly rule: "project-selection-required";
}
export interface ProjectContextNotFound {
  readonly rule: "project-context-not-found";
  readonly projectId: ProjectId;
}
export interface ProjectAssociationMismatch {
  readonly rule: "project-association-mismatch";
  readonly selectedProjectId: ProjectId;
  readonly associatedProjectId: ProjectId;
}
export interface ProjectRequestConflict {
  readonly rule: "project-request-conflict";
  readonly requestId: string;
}

export type ProjectContextRefusal =
  | UnsupportedProjectContextContract
  | InvalidProjectId
  | InvalidProjectContext
  | ProductionEnvironment
  | ProjectSelectionRequired
  | ProjectContextNotFound
  | ProjectAssociationMismatch
  | ProjectRequestConflict;

export type ProjectContextResult = Result<ProjectContext, ProjectContextRefusal>;
