import { createHash } from "node:crypto";
import { dirname, isAbsolute, join } from "node:path";
import type {
  InitializeProjectContextCommand,
  ProjectContextStore,
} from "../../domain/ports/project-context-store.js";
import {
  createProjectContext,
  isProjectId,
  type ProjectContext,
  type ProjectContextInput,
  type ProjectContextRefusal,
  type ProjectId,
} from "../../domain/project/index.js";
import { err, ok, type Result } from "../../shared/result.js";
import {
  canonicalDirectory,
  createPrivateJson,
  ensurePrivateDirectory,
  isErrno,
  readJson,
  type FsProjectObserver,
} from "../fs-project/filesystem.js";

const INIT_PLAN_CONTRACT = "pharos.project-init-plan/1";
const ASSOCIATION_CONTRACT = "pharos.project-path-association/1";

interface InitPlan {
  readonly contract: typeof INIT_PLAN_CONTRACT;
  readonly context: ProjectContext;
  readonly associationPath: string;
  readonly requestId: string;
  readonly inputHash: string;
}

interface PathAssociation {
  readonly contract: typeof ASSOCIATION_CONTRACT;
  readonly projectId: ProjectId;
}

export interface FsProjectContextStoreOptions {
  readonly home: string;
  /** Test-only observation seam for exercising filesystem failure recovery. */
  readonly observer?: FsProjectObserver;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function sameContext(left: ProjectContext, right: ProjectContext): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function toProjectContext(value: unknown): ProjectContext {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid persisted project context");
  }
  const record = value as Record<string, unknown>;
  const context = createProjectContext({
    contract: typeof record.contract === "string" ? record.contract : "",
    projectId: typeof record.projectId === "string" ? record.projectId : "",
    revision: typeof record.revision === "number" ? record.revision : Number.NaN,
    name: typeof record.name === "string" ? record.name : "",
    mode: typeof record.mode === "string" ? record.mode : "",
    environment: typeof record.environment === "string" ? record.environment : "",
    baseUrl: typeof record.baseUrl === "string" ? record.baseUrl : "",
    createdAt: typeof record.createdAt === "string" ? record.createdAt : "",
  } satisfies ProjectContextInput);
  if (!context.ok) throw new Error(`Invalid persisted project context: ${context.error.rule}`);
  return context.value;
}

function toPlan(value: unknown): InitPlan {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid persisted initialization plan");
  }
  const record = value as Record<string, unknown>;
  if (
    record.contract !== INIT_PLAN_CONTRACT ||
    typeof record.associationPath !== "string" ||
    typeof record.requestId !== "string" ||
    typeof record.inputHash !== "string"
  ) throw new Error("Invalid persisted initialization plan");
  return {
    contract: INIT_PLAN_CONTRACT,
    context: toProjectContext(record.context),
    associationPath: record.associationPath,
    requestId: record.requestId,
    inputHash: record.inputHash,
  };
}

function toAssociation(value: unknown): PathAssociation {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid persisted path association");
  }
  const record = value as Record<string, unknown>;
  if (record.contract !== ASSOCIATION_CONTRACT || typeof record.projectId !== "string" || !isProjectId(record.projectId)) {
    throw new Error("Invalid persisted path association");
  }
  return { contract: ASSOCIATION_CONTRACT, projectId: record.projectId };
}

/** Application-owned project routing. It never writes inside associationPath. */
export class FsProjectContextStore implements ProjectContextStore {
  private readonly home: string;
  private readonly observer: FsProjectObserver | undefined;

  constructor(options: FsProjectContextStoreOptions) {
    if (!isAbsolute(options.home)) throw new Error("Pharos home must be absolute");
    this.home = options.home;
    this.observer = options.observer;
  }

  async initialize(
    command: InitializeProjectContextCommand,
  ): Promise<Result<ProjectContext, ProjectContextRefusal>> {
    const layout = await this.layout();
    const associationPath = await canonicalDirectory(command.associationPath, this.observer);
    const planPath = join(layout.initJournal, `${sha256(command.requestId)}.json`);
    const requestedPlan: InitPlan = {
      contract: INIT_PLAN_CONTRACT,
      context: command.context,
      associationPath,
      requestId: command.requestId,
      inputHash: command.inputHash,
    };

    const created = await createPrivateJson(planPath, requestedPlan, this.observer);
    const plan = created === "created" ? requestedPlan : toPlan(await readJson(planPath, this.observer));
    // The durable request identity is supplied by the caller's stable input
    // hash, request ID, and canonical association path. `context` is only a
    // proposal for a newly created plan: generated IDs and timestamps MUST
    // NOT turn a same-input retry into a conflict.
    if (
      plan.inputHash !== command.inputHash ||
      plan.requestId !== command.requestId ||
      plan.associationPath !== associationPath
    ) return err({ rule: "project-request-conflict", requestId: command.requestId });

    const projectRoot = join(layout.store, plan.context.projectId);
    await ensurePrivateDirectory(projectRoot, this.observer);
    const projectPath = join(projectRoot, "project.json");
    await this.materializeContext(projectPath, plan.context);

    const pathAssociation = join(layout.associations, `${sha256(associationPath)}.json`);
    const associated = await createPrivateJson(pathAssociation, {
      contract: ASSOCIATION_CONTRACT,
      projectId: plan.context.projectId,
    } satisfies PathAssociation, this.observer);
    if (associated === "exists") {
      const current = toAssociation(await readJson(pathAssociation, this.observer));
      if (current.projectId !== plan.context.projectId) {
        return err({
          rule: "project-association-mismatch",
          selectedProjectId: plan.context.projectId,
          associatedProjectId: current.projectId,
        });
      }
    }
    return ok(plan.context);
  }

  async resolveById(
    projectId: ProjectId,
    canonicalCurrentPath?: string,
  ): Promise<Result<ProjectContext, ProjectContextRefusal>> {
    if (!isProjectId(projectId)) return err({ rule: "project-context-not-found", projectId });
    const layout = await this.layout();
    try {
      const context = toProjectContext(await readJson(join(layout.store, projectId, "project.json"), this.observer));
      if (context.projectId !== projectId) {
        return err({
          rule: "project-association-mismatch",
          selectedProjectId: projectId,
          associatedProjectId: context.projectId,
        });
      }
      if (canonicalCurrentPath !== undefined) {
        const associatedProjectId = await this.nearestAssociation(layout, canonicalCurrentPath);
        if (associatedProjectId !== undefined && associatedProjectId !== projectId) {
          return err({ rule: "project-association-mismatch", selectedProjectId: projectId, associatedProjectId });
        }
      }
      return ok(context);
    } catch (error) {
      if (isErrno(error, "ENOENT")) return err({ rule: "project-context-not-found", projectId });
      throw error;
    }
  }

  async resolveByPath(
    canonicalPath: string,
  ): Promise<Result<ProjectContext, ProjectContextRefusal>> {
    const layout = await this.layout();
    let associationProjectId: ProjectId | undefined;
    try {
      associationProjectId = await this.nearestAssociation(layout, canonicalPath);
    } catch (error) {
      if (isErrno(error, "ENOENT")) return err({ rule: "project-selection-required" });
      throw error;
    }
    if (associationProjectId === undefined) return err({ rule: "project-selection-required" });
    return this.resolveById(associationProjectId);
  }

  private async nearestAssociation(
    layout: { readonly associations: string },
    canonicalPath: string,
  ): Promise<ProjectId | undefined> {
    let current = await canonicalDirectory(canonicalPath, this.observer);
    while (true) {
      const associationPath = join(layout.associations, `${sha256(current)}.json`);
      try {
        return toAssociation(await readJson(associationPath, this.observer)).projectId;
      } catch (error) {
        if (!isErrno(error, "ENOENT")) throw error;
      }
      const parent = dirname(current);
      if (parent === current) return undefined;
      current = parent;
    }
  }

  private async materializeContext(path: string, context: ProjectContext): Promise<void> {
    const created = await createPrivateJson(path, context, this.observer);
    if (created === "created") return;
    const persisted = toProjectContext(await readJson(path, this.observer));
    if (!sameContext(persisted, context)) {
      throw new Error("Project ID is already bound to different context bytes");
    }
  }

  private async layout(): Promise<{
    readonly store: string;
    readonly initJournal: string;
    readonly associations: string;
  }> {
    await ensurePrivateDirectory(this.home, this.observer);
    const home = await canonicalDirectory(this.home, this.observer);
    const store = join(home, "store");
    const initJournal = join(home, "init-journal");
    const associations = join(home, "associations", "paths");
    await Promise.all([
      ensurePrivateDirectory(store, this.observer),
      ensurePrivateDirectory(initJournal, this.observer),
      ensurePrivateDirectory(join(home, "associations"), this.observer),
      ensurePrivateDirectory(associations, this.observer),
    ]);
    return { store, initJournal, associations };
  }
}
