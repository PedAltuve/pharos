import { Command } from "commander";
import type { ApproveBeaconDraft, ApprovedBeaconDraft } from "../../application/approve-beacon-draft.js";
import type { InspectBeaconDraft } from "../../application/inspect-beacon-draft.js";
import type { RequestId } from "../../domain/capture/index.js";
import type { IdGenerator } from "../../domain/ports/index.js";
import { isProjectId, type ProjectContext, type ProjectId } from "../../domain/project/index.js";
import type { Result } from "../../shared/result.js";
import { internalOutcome, refusalOutcome, resultOutcome, type CliRenderedOutcome } from "../envelope.js";
import type { BeaconLifecyclePrompt } from "../prompts/input.js";
import { bindExecution, commonProductOptions, homeRefusal, isBeaconId, isRequestId, type CommandRuntime, usageOutcome } from "./shared.js";

export interface BeaconApproveCommandDependencies extends CommandRuntime {
  readonly ids: Pick<IdGenerator, "next">;
  readonly isInteractiveTerminal: () => boolean;
  readonly prompt: Pick<BeaconLifecyclePrompt, "confirmApproval">;
  readonly resolveProject: (projectId?: ProjectId) => Promise<Result<ProjectContext, { readonly rule: string }>>;
  readonly inspect: Pick<InspectBeaconDraft, "execute">;
  readonly inspectForProject?: (project: ProjectContext) => Pick<InspectBeaconDraft, "execute">;
  readonly approve: Pick<ApproveBeaconDraft, "execute">;
  readonly approveForProject?: (project: ProjectContext) => Pick<ApproveBeaconDraft, "execute">;
}

function nextRequestId(ids: Pick<IdGenerator, "next">, supplied: unknown): RequestId | undefined {
  const candidate = typeof supplied === "string" ? supplied : ids.next("request");
  return isRequestId(candidate) ? candidate : undefined;
}

function success(value: ApprovedBeaconDraft): Omit<CliRenderedOutcome, "command" | "outcome" | "errors"> {
  return {
    data: {
      beacon_id: value.beaconId,
      version_id: value.versionId,
      status: value.status,
      semantic_hash: value.semanticHash,
      assurance: value.assurance,
    },
    nextAction: { command: `pharos beacon revoke ${value.beaconId}`, reason: "Revoke the active version when required" },
  };
}

/** Unregistered TTY-only approval builder. */
export function buildBeaconApproveCommand(dependencies: BeaconApproveCommandDependencies): Command {
  const command = commonProductOptions(new Command("approve").description("Approve an inspected open Beacon draft"))
    .argument("<beacon-id>")
    .option("--request-id <request-id>", "opaque idempotency request ID");
  return bindExecution(command, dependencies, async (invocation) => {
    const unavailable = homeRefusal("beacon.approve", dependencies, invocation.options.pharosHome);
    if (unavailable !== undefined) return unavailable;
    if (!dependencies.isInteractiveTerminal()) return refusalOutcome("beacon.approve", { rule: "approval-requires-interactive-terminal" });
    if (invocation.options.requestId !== undefined && !isRequestId(invocation.options.requestId)) return usageOutcome("beacon.approve");
    const requestId = nextRequestId(dependencies.ids, invocation.options.requestId);
    if (requestId === undefined) return internalOutcome("beacon.approve");
    if (invocation.options.project !== undefined && (typeof invocation.options.project !== "string" || !isProjectId(invocation.options.project))) return usageOutcome("beacon.approve");
    const beaconId = invocation.arguments[0];
    if (!isBeaconId(beaconId)) return usageOutcome("beacon.approve");
    const project = await dependencies.resolveProject(typeof invocation.options.project === "string" ? invocation.options.project : undefined);
    if (!project.ok) return refusalOutcome("beacon.approve", project.error);
    const inspector = dependencies.inspectForProject?.(project.value) ?? dependencies.inspect;
    const inspected = await inspector.execute({ projectId: project.value.projectId, beaconId });
    if (!inspected.ok) return refusalOutcome("beacon.approve", inspected.error);
    const confirmation = await dependencies.prompt.confirmApproval({
      beaconId,
      draftId: inspected.value.beacon.draftId,
      captureId: inspected.value.capture.captureId,
      semanticHash: inspected.value.beacon.semanticHash,
    });
    if (confirmation === undefined) return { command: "beacon.approve", outcome: "interrupted", data: {}, errors: [], nextAction: null };
    if (!confirmation) return refusalOutcome("beacon.approve", { rule: "operator-confirmation-declined" });
    const approver = dependencies.approveForProject?.(project.value) ?? dependencies.approve;
    return resultOutcome("beacon.approve", await approver.execute({
      projectId: project.value.projectId,
      beaconId,
      requestId,
      reviewedHash: inspected.value.beacon.semanticHash,
      operatorConfirmed: true,
      actor: null,
    }), success);
  });
}
