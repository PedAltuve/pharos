import { Command } from "commander";
import type { RecordCapture, RecordedCapture } from "../../application/record-capture.js";
import type { RequestId } from "../../domain/capture/index.js";
import type { CancellationSignal, IdGenerator } from "../../domain/ports/index.js";
import { isProjectId, type ProjectContext, type ProjectId } from "../../domain/project/index.js";
import type { Result } from "../../shared/result.js";
import { internalOutcome, refusalOutcome, type CliRenderedOutcome } from "../envelope.js";
import { bindExecution, commonProductOptions, homeRefusal, isRequestId, type CommandRuntime, usageOutcome } from "./shared.js";

export interface CaptureRecordCommandDependencies extends CommandRuntime {
  readonly ids: Pick<IdGenerator, "next">;
  readonly signal: CancellationSignal;
  readonly isInteractiveTerminal: () => boolean;
  readonly resolveProject: (projectId?: ProjectId) => Promise<Result<ProjectContext, { readonly rule: string }>>;
  readonly record: Pick<RecordCapture, "execute">;
  readonly recordForProject?: (project: ProjectContext) => Pick<RecordCapture, "execute">;
}

function nextRequestId(ids: Pick<IdGenerator, "next">, supplied: unknown): RequestId | undefined {
  const candidate = typeof supplied === "string" ? supplied : ids.next("request");
  return isRequestId(candidate) ? candidate : undefined;
}

function recordOutcome(value: RecordedCapture): CliRenderedOutcome {
  const data = { capture_id: value.captureId, status: value.status };
  const nextAction = value.status === "promoted"
    ? { command: `pharos capture annotate ${value.captureId}`, reason: "Annotate the promoted capture" }
    : { command: "pharos capture record", reason: value.status === "rejected" ? "Record a new capture" : "Retry recording" };
  if (value.status === "rejected") {
    return { command: "capture.record", outcome: "refused", data, errors: [{ rule: "capture-rejected", category: "safety", field: "/" }], nextAction };
  }
  if (value.status === "failed") {
    return { command: "capture.record", outcome: "failed", data, errors: [{ rule: "capture-failed", category: "prerequisite", field: "/" }], nextAction };
  }
  if (value.status === "interrupted") {
    return { command: "capture.record", outcome: "interrupted", data, errors: [], nextAction };
  }
  return { command: "capture.record", outcome: "succeeded", data, errors: [], nextAction };
}

/** Unregistered interactive-only recorder builder. */
export function buildCaptureRecordCommand(dependencies: CaptureRecordCommandDependencies): Command {
  const command = commonProductOptions(new Command("record").description("Record a supporting capture"))
    .option("--request-id <request-id>", "opaque idempotency request ID")
    .option("--secret-source <reference>", "declared secret reference", collect, [])
    .option("--no-secret-sources", "acknowledge that no secret source is declared")
    .option("--non-interactive", "refuse because recording requires an interactive terminal");
  return bindExecution(command, dependencies, async (invocation) => {
    const unavailable = homeRefusal("capture.record", dependencies, invocation.options.pharosHome);
    if (unavailable !== undefined) return unavailable;
    if (invocation.options.nonInteractive === true || !dependencies.isInteractiveTerminal()) {
      return refusalOutcome("capture.record", { rule: "record-requires-interactive-terminal" });
    }
    if (invocation.options.requestId !== undefined && !isRequestId(invocation.options.requestId)) return usageOutcome("capture.record");
    const requestId = nextRequestId(dependencies.ids, invocation.options.requestId);
    if (requestId === undefined) return internalOutcome("capture.record");
    if (invocation.options.project !== undefined && (typeof invocation.options.project !== "string" || !isProjectId(invocation.options.project))) return usageOutcome("capture.record");
    const selectedProjectId = typeof invocation.options.project === "string" ? invocation.options.project : undefined;
    const project = await dependencies.resolveProject(selectedProjectId);
    if (!project.ok) return refusalOutcome("capture.record", project.error);
    const secretSourceReferences = Array.isArray(invocation.options.secretSource)
      ? invocation.options.secretSource.filter((value): value is string => typeof value === "string")
      : [];
    const recorder = dependencies.recordForProject?.(project.value) ?? dependencies.record;
    const result = await recorder.execute({
      projectId: project.value.projectId,
      contextRevision: project.value.revision,
      url: project.value.baseUrl,
      requestId,
      secretSourceReferences,
      noSecretSources: invocation.options.secretSources === false,
      terminalMode: invocation.options.format === "json" ? "json" : "human",
      signal: dependencies.signal,
    });
    return result.ok ? recordOutcome(result.value) : refusalOutcome("capture.record", result.error);
  });
}

function collect(value: string, values: readonly string[]): string[] {
  return [...values, value];
}
