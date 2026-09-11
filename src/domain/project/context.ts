import { err, ok } from "../../shared/result.js";
import {
  PROJECT_CONTEXT_CONTRACT,
  type ProjectContext,
  type ProjectContextInput,
  type ProjectContextResult,
  type ProjectEnvironment,
  type ProjectMode,
} from "./types.js";

const UUID_V7 = "[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const projectIdPattern = new RegExp(`^proj_${UUID_V7}$`);

export function isProjectId(value: string): value is `proj_${string}` {
  return projectIdPattern.test(value);
}

function isMode(value: string): value is ProjectMode {
  return value === "repository" || value === "external";
}

function isEnvironment(value: string): value is ProjectEnvironment {
  return value === "local" || value === "test" || value === "staging";
}

export function createProjectContext(input: ProjectContextInput): ProjectContextResult {
  if (input.contract !== PROJECT_CONTEXT_CONTRACT) {
    return err({ rule: "unsupported-project-context-contract", contract: input.contract });
  }
  if (!isProjectId(input.projectId)) return err({ rule: "invalid-project-id", projectId: input.projectId });
  if (input.environment === "production") return err({ rule: "production-environment" });
  if (input.revision !== 1) return err({ rule: "invalid-project-context", field: "revision" });
  if (input.name.trim().length === 0) return err({ rule: "invalid-project-context", field: "name" });
  if (!isMode(input.mode)) return err({ rule: "invalid-project-context", field: "mode" });
  if (!isEnvironment(input.environment)) return err({ rule: "invalid-project-context", field: "environment" });
  let baseUrl: URL;
  try {
    baseUrl = new URL(input.baseUrl);
  } catch {
    return err({ rule: "invalid-project-context", field: "baseUrl" });
  }
  if (
    (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") ||
    baseUrl.hostname.length === 0 ||
    baseUrl.username.length > 0 ||
    baseUrl.password.length > 0 ||
    baseUrl.hash.length > 0
  ) return err({ rule: "invalid-project-context", field: "baseUrl" });

  const createdAt = new Date(input.createdAt);
  if (Number.isNaN(createdAt.valueOf()) || createdAt.toISOString() !== input.createdAt) {
    return err({ rule: "invalid-project-context", field: "createdAt" });
  }

  const context: ProjectContext = {
    contract: PROJECT_CONTEXT_CONTRACT,
    projectId: input.projectId,
    revision: 1,
    name: input.name.trim(),
    mode: input.mode,
    environment: input.environment,
    baseUrl: baseUrl.toString(),
    createdAt: createdAt.toISOString(),
  };
  return ok(context);
}
