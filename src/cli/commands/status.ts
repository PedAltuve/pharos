import { Command } from "commander";
import type { BeaconLifecycleStatus, BeaconStatus } from "../../application/beacon-status.js";
import { isProjectId, type ProjectContext, type ProjectId } from "../../domain/project/index.js";
import type { Result } from "../../shared/result.js";
import { refusalOutcome, resultOutcome, type CliRenderedOutcome } from "../envelope.js";
import { bindExecution, commonProductOptions, homeRefusal, isBeaconId, type CommandRuntime, usageOutcome } from "./shared.js";

export interface StatusCommandDependencies extends CommandRuntime {
  readonly resolveProject: (projectId?: ProjectId) => Promise<Result<ProjectContext, { readonly rule: string }>>;
  readonly status: Pick<BeaconStatus, "execute">;
  readonly statusForProject?: (project: ProjectContext) => Pick<BeaconStatus, "execute">;
}

function nextAction(status: BeaconLifecycleStatus): CliRenderedOutcome["nextAction"] {
  if (status.authority === "open-draft") {
    return { command: `pharos beacon approve ${status.beaconId}`, reason: "Review and explicitly approve the open draft" };
  }
  if (status.authority === "active-approved") {
    return { command: `pharos beacon revoke ${status.beaconId}`, reason: "Revoke the current active version when required" };
  }
  return { command: "pharos capture record", reason: "Record and annotate a new capture before creating a draft" };
}

function success(value: BeaconLifecycleStatus): Omit<CliRenderedOutcome, "command" | "outcome" | "errors"> {
  return {
    data: {
      beacon_id: value.beaconId,
      authority: value.authority,
      active_version_id: value.activeVersionId,
      readiness: value.readiness,
      staleness: value.staleness,
      verification: value.verification,
    },
    nextAction: nextAction(value),
  };
}

/** Unregistered read-only lifecycle status builder. */
export function buildStatusCommand(dependencies: StatusCommandDependencies): Command {
  const command = commonProductOptions(new Command("status").description("Read canonical Beacon lifecycle status"))
    .argument("<beacon-id>");
  return bindExecution(command, dependencies, async (invocation) => {
    const unavailable = homeRefusal("status", dependencies, invocation.options.pharosHome);
    if (unavailable !== undefined) return unavailable;
    if (invocation.options.project !== undefined && (typeof invocation.options.project !== "string" || !isProjectId(invocation.options.project))) return usageOutcome("status");
    const beaconId = invocation.arguments[0];
    if (!isBeaconId(beaconId)) return usageOutcome("status");
    const project = await dependencies.resolveProject(typeof invocation.options.project === "string" ? invocation.options.project : undefined);
    if (!project.ok) return refusalOutcome("status", project.error);
    const statusReader = dependencies.statusForProject?.(project.value) ?? dependencies.status;
    return resultOutcome("status", await statusReader.execute({ beaconId }), success);
  });
}
