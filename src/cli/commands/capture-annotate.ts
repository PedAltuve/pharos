import { Command } from "commander";
import type { AnnotateCapture, AnnotatedCapture } from "../../application/annotate-capture.js";
import { isCaptureId, type RequestId } from "../../domain/capture/index.js";
import type { IdGenerator } from "../../domain/ports/index.js";
import { isProjectId, type ProjectContext, type ProjectId } from "../../domain/project/index.js";
import type { Result } from "../../shared/result.js";
import { internalOutcome, refusalOutcome, resultOutcome, type CliRenderedOutcome } from "../envelope.js";
import type { GuidedInputAdapter } from "../prompts/input.js";
import { bindExecution, commonProductOptions, homeRefusal, isRequestId, type CommandRuntime, usageOutcome } from "./shared.js";

export interface CaptureAnnotateCommandDependencies extends CommandRuntime {
  readonly ids: Pick<IdGenerator, "next">;
  readonly input: Pick<GuidedInputAdapter, "collectAnnotation">;
  readonly resolveProject: (projectId?: ProjectId) => Promise<Result<ProjectContext, { readonly rule: string }>>;
  readonly annotate: Pick<AnnotateCapture, "execute">;
  readonly annotateForProject?: (project: ProjectContext) => Pick<AnnotateCapture, "execute">;
}

function nextRequestId(ids: Pick<IdGenerator, "next">, supplied: unknown): RequestId | undefined {
  const candidate = typeof supplied === "string" ? supplied : ids.next("request");
  return isRequestId(candidate) ? candidate : undefined;
}

function isAnnotationContract(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && (value as { readonly contract?: unknown }).contract === "pharos.capture-annotation/1";
}

function success(value: AnnotatedCapture): Omit<CliRenderedOutcome, "command" | "outcome" | "errors"> {
  return {
    data: {
      beacon_id: value.beaconId,
      draft_id: value.draftId,
      revision: value.revision,
      status: value.status,
      semantic_hash: value.semanticHash,
      capture_id: value.captureId,
    },
    nextAction: { command: `pharos beacon inspect ${value.beaconId}`, reason: "Inspect the open draft" },
  };
}

/** Unregistered annotation builder. */
export function buildCaptureAnnotateCommand(dependencies: CaptureAnnotateCommandDependencies): Command {
  const command = commonProductOptions(new Command("annotate").description("Annotate a promoted capture"))
    .argument("<capture-id>")
    .option("--request-id <request-id>", "opaque idempotency request ID")
    .option("--non-interactive", "refuse prompts and require --input")
    .option("--input <file|->", "JSON capture annotation input");
  return bindExecution(command, dependencies, async (invocation) => {
    const unavailable = homeRefusal("capture.annotate", dependencies, invocation.options.pharosHome);
    if (unavailable !== undefined) return unavailable;
    if (invocation.options.requestId !== undefined && !isRequestId(invocation.options.requestId)) return usageOutcome("capture.annotate");
    const requestId = nextRequestId(dependencies.ids, invocation.options.requestId);
    if (requestId === undefined) return internalOutcome("capture.annotate");
    if (invocation.options.project !== undefined && (typeof invocation.options.project !== "string" || !isProjectId(invocation.options.project))) return usageOutcome("capture.annotate");
    const capture = invocation.arguments[0];
    if (typeof capture !== "string" || !isCaptureId(capture)) return usageOutcome("capture.annotate");
    const input = await dependencies.input.collectAnnotation({
      nonInteractive: invocation.options.nonInteractive === true,
      input: typeof invocation.options.input === "string" ? invocation.options.input : undefined,
    });
    if (!input.ok) return input.error.rule === "prompt-cancelled"
      ? { command: "capture.annotate", outcome: "interrupted", data: {}, errors: [], nextAction: null }
      : input.error.rule === "invalid-input"
        ? usageOutcome("capture.annotate")
        : refusalOutcome("capture.annotate", input.error);
    if (!isAnnotationContract(input.value)) return usageOutcome("capture.annotate");
    const projectId = typeof invocation.options.project === "string" ? invocation.options.project : undefined;
    const project = await dependencies.resolveProject(projectId);
    if (!project.ok) return refusalOutcome("capture.annotate", project.error);
    const annotator = dependencies.annotateForProject?.(project.value) ?? dependencies.annotate;
    const result = await annotator.execute({
      projectId: project.value.projectId,
      captureId: capture,
      requestId,
      annotation: input.value,
    });
    return resultOutcome("capture.annotate", result, success);
  });
}
