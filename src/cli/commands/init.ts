import { Command } from "commander";
import type { InitializeProjectRequest, InitializeProject, InitializedProject } from "../../application/initialize-project.js";
import type { IdGenerator } from "../../domain/ports/index.js";
import type { ProjectRequestId } from "../../domain/project/index.js";
import type { Result } from "../../shared/result.js";
import { internalOutcome, refusalOutcome, resultOutcome, type CliRenderedOutcome } from "../envelope.js";
import type { GuidedInputAdapter } from "../prompts/input.js";
import { bindExecution, commonProductOptions, homeRefusal, isRequestId, type CommandRuntime, usageOutcome } from "./shared.js";

export interface InitCommandDependencies extends CommandRuntime {
  readonly ids: Pick<IdGenerator, "next">;
  readonly input: Pick<GuidedInputAdapter, "collectInit">;
  readonly initialize: Pick<InitializeProject, "execute">;
}

type InitInput = {
  readonly project_name: string;
  readonly mode: InitializeProjectRequest["mode"];
  readonly environment: InitializeProjectRequest["environment"];
  readonly base_url: string;
  readonly association_path: string;
};

function initInput(value: unknown): InitInput | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  return input.contract === "pharos.project-init/1"
    && typeof input.project_name === "string"
    && (input.mode === "repository" || input.mode === "external")
    && (input.environment === "local" || input.environment === "test" || input.environment === "staging")
    && typeof input.base_url === "string" && typeof input.association_path === "string"
    ? input as InitInput
    : undefined;
}

function nextRequestId(ids: Pick<IdGenerator, "next">, supplied: unknown): ProjectRequestId | undefined {
  const candidate = typeof supplied === "string" ? supplied : ids.next("request");
  return isRequestId(candidate) ? candidate : undefined;
}

function success(value: InitializedProject): Omit<CliRenderedOutcome, "command" | "outcome" | "errors"> {
  return {
    data: { project_id: value.projectId },
    nextAction: { command: "pharos capture record", reason: "Record a supporting capture" },
  };
}

/** Unregistered builder; GBM-3 alone may attach it to the root program. */
export function buildInitCommand(dependencies: InitCommandDependencies): Command {
  const command = commonProductOptions(new Command("init").description("Initialize a Pharos project context"), false)
    .option("--request-id <request-id>", "opaque idempotency request ID")
    .option("--non-interactive", "refuse prompts and require --input")
    .option("--input <file|->", "JSON project-init input");
  return bindExecution(command, dependencies, async (invocation) => {
    const unavailable = homeRefusal("init", dependencies, invocation.options.pharosHome);
    if (unavailable !== undefined) return unavailable;
    if (invocation.options.requestId !== undefined && !isRequestId(invocation.options.requestId)) return usageOutcome("init");
    const requestId = nextRequestId(dependencies.ids, invocation.options.requestId);
    if (requestId === undefined) return internalOutcome("init");
    const input = await dependencies.input.collectInit({
      nonInteractive: invocation.options.nonInteractive === true,
      input: typeof invocation.options.input === "string" ? invocation.options.input : undefined,
    });
    if (!input.ok) return input.error.rule === "prompt-cancelled"
      ? { command: "init", outcome: "interrupted", data: {}, errors: [], nextAction: null }
      : input.error.rule === "invalid-input"
        ? usageOutcome("init")
        : refusalOutcome("init", input.error);
    const request = initInput(input.value);
    if (request === undefined) return usageOutcome("init");
    const result: Result<InitializedProject, { readonly rule: string }> = await dependencies.initialize.execute({
      name: request.project_name,
      mode: request.mode,
      environment: request.environment,
      baseUrl: request.base_url,
      associationPath: request.association_path,
      requestId,
    });
    return resultOutcome("init", result, success);
  });
}
