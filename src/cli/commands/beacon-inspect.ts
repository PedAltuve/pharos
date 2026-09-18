import { Command } from "commander";
import type { InspectBeaconDraft, InspectedBeaconDraft } from "../../application/inspect-beacon-draft.js";
import { isProjectId, type ProjectContext, type ProjectId } from "../../domain/project/index.js";
import type { Result } from "../../shared/result.js";
import { refusalOutcome, resultOutcome, type CliRenderedOutcome } from "../envelope.js";
import { bindExecution, commonProductOptions, homeRefusal, isBeaconId, type CommandRuntime, usageOutcome } from "./shared.js";

export interface BeaconInspectCommandDependencies extends CommandRuntime {
  readonly resolveProject: (projectId?: ProjectId) => Promise<Result<ProjectContext, { readonly rule: string }>>;
  readonly inspect: Pick<InspectBeaconDraft, "execute">;
  readonly inspectForProject?: (project: ProjectContext) => Pick<InspectBeaconDraft, "execute">;
}

function success(value: InspectedBeaconDraft): Omit<CliRenderedOutcome, "command" | "outcome" | "errors"> {
  return {
    data: {
      beacon: value.beacon,
      capture: value.capture,
    },
    nextAction: null,
  };
}

/** Unregistered read-only Beacon inspection builder. */
export function buildBeaconInspectCommand(dependencies: BeaconInspectCommandDependencies): Command {
  const command = commonProductOptions(new Command("inspect").description("Inspect an open Beacon draft"))
    .argument("<beacon-id>");
  return bindExecution(command, dependencies, async (invocation) => {
    const unavailable = homeRefusal("beacon.inspect", dependencies, invocation.options.pharosHome);
    if (unavailable !== undefined) return unavailable;
    if (invocation.options.project !== undefined && (typeof invocation.options.project !== "string" || !isProjectId(invocation.options.project))) return usageOutcome("beacon.inspect");
    const beacon = invocation.arguments[0];
    if (typeof beacon !== "string" || !isBeaconId(beacon)) return usageOutcome("beacon.inspect");
    const projectId = typeof invocation.options.project === "string" ? invocation.options.project : undefined;
    const project = await dependencies.resolveProject(projectId);
    if (!project.ok) return refusalOutcome("beacon.inspect", project.error);
    const inspector = dependencies.inspectForProject?.(project.value) ?? dependencies.inspect;
    const result = await inspector.execute({ projectId: project.value.projectId, beaconId: beacon });
    return resultOutcome("beacon.inspect", result, success);
  });
}
