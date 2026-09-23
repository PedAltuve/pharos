import { Command } from "commander";
import type { BeaconStatus } from "../../application/beacon-status.js";
import type { RevokeActiveBeacon, RevokedActiveBeacon } from "../../application/revoke-active-beacon.js";
import type { RequestId } from "../../domain/capture/index.js";
import type { IdGenerator } from "../../domain/ports/index.js";
import { isProjectId, type ProjectContext, type ProjectId } from "../../domain/project/index.js";
import type { Result } from "../../shared/result.js";
import { internalOutcome, refusalOutcome, resultOutcome, type CliRenderedOutcome } from "../envelope.js";
import type { BeaconLifecyclePrompt } from "../prompts/input.js";
import { bindExecution, commonProductOptions, homeRefusal, isBeaconId, isRequestId, type CommandRuntime, usageOutcome } from "./shared.js";

export interface BeaconRevokeCommandDependencies extends CommandRuntime {
  readonly ids: Pick<IdGenerator, "next">;
  readonly isInteractiveTerminal: () => boolean;
  readonly prompt: Pick<BeaconLifecyclePrompt, "requestRevocationReason" | "confirmRevocation">;
  readonly resolveProject: (projectId?: ProjectId) => Promise<Result<ProjectContext, { readonly rule: string }>>;
  readonly status: Pick<BeaconStatus, "execute">;
  readonly statusForProject?: (project: ProjectContext) => Pick<BeaconStatus, "execute">;
  readonly revoke: Pick<RevokeActiveBeacon, "execute">;
  readonly revokeForProject?: (project: ProjectContext) => Pick<RevokeActiveBeacon, "execute">;
}

function nextRequestId(ids: Pick<IdGenerator, "next">, supplied: unknown): RequestId | undefined {
  const candidate = typeof supplied === "string" ? supplied : ids.next("request");
  return isRequestId(candidate) ? candidate : undefined;
}

function success(value: RevokedActiveBeacon): Omit<CliRenderedOutcome, "command" | "outcome" | "errors"> {
  return {
    data: { beacon_id: value.beaconId, version_id: value.versionId, status: value.status },
    nextAction: { command: `pharos status ${value.beaconId}`, reason: "Confirm that no active version remains" },
  };
}

/** Unregistered TTY-only revocation builder. */
export function buildBeaconRevokeCommand(dependencies: BeaconRevokeCommandDependencies): Command {
  const command = commonProductOptions(new Command("revoke").description("Revoke the current active Beacon version"))
    .argument("<beacon-id>")
    .option("--request-id <request-id>", "opaque idempotency request ID");
  return bindExecution(command, dependencies, async (invocation) => {
    const unavailable = homeRefusal("beacon.revoke", dependencies, invocation.options.pharosHome);
    if (unavailable !== undefined) return unavailable;
    if (!dependencies.isInteractiveTerminal()) return refusalOutcome("beacon.revoke", { rule: "revocation-requires-interactive-terminal" });
    if (invocation.options.requestId !== undefined && !isRequestId(invocation.options.requestId)) return usageOutcome("beacon.revoke");
    const requestId = nextRequestId(dependencies.ids, invocation.options.requestId);
    if (requestId === undefined) return internalOutcome("beacon.revoke");
    if (invocation.options.project !== undefined && (typeof invocation.options.project !== "string" || !isProjectId(invocation.options.project))) return usageOutcome("beacon.revoke");
    const beaconId = invocation.arguments[0];
    if (!isBeaconId(beaconId)) return usageOutcome("beacon.revoke");
    const project = await dependencies.resolveProject(typeof invocation.options.project === "string" ? invocation.options.project : undefined);
    if (!project.ok) return refusalOutcome("beacon.revoke", project.error);
    const statusReader = dependencies.statusForProject?.(project.value) ?? dependencies.status;
    const status = await statusReader.execute({ beaconId });
    if (!status.ok) return refusalOutcome("beacon.revoke", status.error);
    const expectedActiveVersionId = status.value.activeVersionId;
    const enteredReason = await dependencies.prompt.requestRevocationReason();
    if (enteredReason === undefined) return { command: "beacon.revoke", outcome: "interrupted", data: {}, errors: [], nextAction: null };
    const reason = enteredReason.trim();
    if (reason.length === 0) return refusalOutcome("beacon.revoke", { rule: "invalid-revocation-reason" });
    const confirmation = await dependencies.prompt.confirmRevocation({
      beaconId,
      expectedActiveVersionId: expectedActiveVersionId ?? "no active version",
      reason,
    });
    if (confirmation === undefined) return { command: "beacon.revoke", outcome: "interrupted", data: {}, errors: [], nextAction: null };
    if (!confirmation) return refusalOutcome("beacon.revoke", { rule: "operator-confirmation-declined" });
    const revoker = dependencies.revokeForProject?.(project.value) ?? dependencies.revoke;
    return resultOutcome("beacon.revoke", await revoker.execute({
      beaconId,
      requestId,
      expectedActiveVersionId,
      reason,
      actor: null,
    }), success);
  });
}
