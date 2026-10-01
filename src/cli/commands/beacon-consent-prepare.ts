import { Command } from "commander";
import type { ApprovalConsentDisplay, PrepareApprovalConsentRequest } from "../../application/approve-beacon-draft.js";
import type { RevocationConsentDisplay, PrepareRevocationConsentRequest } from "../../application/revoke-active-beacon.js";
import { isProjectId, type ProjectContext, type ProjectId } from "../../domain/project/index.js";
import type { Result } from "../../shared/result.js";
import { refusalOutcome, type CliRenderedOutcome } from "../envelope.js";
import { bindExecution, commonProductOptions, homeRefusal, isBeaconId, isRequestId, type CommandRuntime, usageOutcome } from "./shared.js";

interface Preparer<T, V> {
  prepareConsent(request: T): Promise<Result<V, { readonly rule: string }>>;
}

export interface ConsentPrepareDependencies extends CommandRuntime {
  resolveProject(projectId?: ProjectId): Promise<Result<ProjectContext, { readonly rule: string }>>;
  approveForProject(project: ProjectContext): Preparer<PrepareApprovalConsentRequest, ApprovalConsentDisplay> | undefined;
  revokeForProject(project: ProjectContext): Preparer<PrepareRevocationConsentRequest, RevocationConsentDisplay> | undefined;
}

/** Only preparation is agent-callable. Decisions and grants have no CLI grammar. */
export function buildBeaconConsentPrepareCommand(dependencies: ConsentPrepareDependencies): Command {
  const command = commonProductOptions(new Command("prepare").description("Prepare host consent (JSON only)"))
    .argument("<action>")
    .argument("<beacon-id>")
    .requiredOption("--request-id <request-id>")
    .option("--reason <reason>");
  return bindExecution(command, dependencies, async (invocation): Promise<CliRenderedOutcome> => {
    const name = "beacon.prepare";
    const unavailable = homeRefusal(name, dependencies, invocation.options.pharosHome);
    if (unavailable) return unavailable;
    const [action, beacon] = invocation.arguments;
    const { project: selected, requestId, reason, format } = invocation.options;
    if (format !== "json" || (action !== "approve" && action !== "revoke") || !isBeaconId(beacon) || !isRequestId(requestId) ||
      (selected !== undefined && (typeof selected !== "string" || !isProjectId(selected))) ||
      (action === "approve" && reason !== undefined) || (action === "revoke" && (typeof reason !== "string" || reason.length < 1 || reason.length > 4096 || /^\s/.test(reason) || !/\S$/.test(reason) || /[\r\n]/.test(reason)))) return usageOutcome(name);
    const resolved = await dependencies.resolveProject();
    if (!resolved.ok) return refusalOutcome(name, resolved.error);
    if (selected !== undefined && selected !== resolved.value.projectId) return refusalOutcome(name, { rule: "project-association-mismatch" });
    const scoped = action === "approve" ? dependencies.approveForProject(resolved.value) : dependencies.revokeForProject(resolved.value);
    if (!scoped) return refusalOutcome(name, { rule: "consent-preparation-unavailable" });
    const binding = { projectId: resolved.value.projectId, beaconId: beacon, requestId };
    const result = action === "approve"
      ? await (scoped as Preparer<PrepareApprovalConsentRequest, ApprovalConsentDisplay>).prepareConsent(binding)
      : await (scoped as Preparer<PrepareRevocationConsentRequest, RevocationConsentDisplay>).prepareConsent({ ...binding, reason: reason as string });
    if (!result.ok) return refusalOutcome(name, result.error);
    return {
      command: name, outcome: "succeeded", errors: [],
      data: { contract: "pharos.consent-prepare/1", status: "host-decision-required", request: result.value.request, auditId: result.value.auditId },
      nextAction: { command: "host-decision-required", reason: "Present the exact request in a trusted interactive host" },
    };
  });
}
