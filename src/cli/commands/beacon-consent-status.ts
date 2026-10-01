import { Command } from "commander";
import type { ConsentRecord } from "../../adapters/fs-consent-store/index.js";
import { isProjectId, type ProjectContext, type ProjectId } from "../../domain/project/index.js";
import type { Result } from "../../shared/result.js";
import { refusalOutcome, type CliRenderedOutcome } from "../envelope.js";
import { bindExecution, commonProductOptions, homeRefusal, isRequestId, type CommandRuntime, usageOutcome } from "./shared.js";

export interface ConsentStatusDependencies extends CommandRuntime {
  resolveProject(projectId?: ProjectId): Promise<Result<ProjectContext, { readonly rule: string }>>;
  storeForProject(project: ProjectContext): { getChallenge(requestId: string, nowEpochMs: number): Promise<Result<ConsentRecord | undefined, { readonly rule: string }>> } | undefined;
}

/** This read-only command deliberately never returns claim, terminal result, or grant material. */
export function buildBeaconConsentStatusCommand(dependencies: ConsentStatusDependencies): Command {
  const command = commonProductOptions(new Command("consent-status").description("Inspect a host consent request (JSON only)"))
    .argument("<request-id>");
  return bindExecution(command, dependencies, async (invocation): Promise<CliRenderedOutcome> => {
    const name = "beacon.consent-status";
    const unavailable = homeRefusal(name, dependencies, invocation.options.pharosHome);
    if (unavailable) return unavailable;
    const [requestId] = invocation.arguments;
    const { project: selected, format } = invocation.options;
    if (format !== "json" || !isRequestId(requestId) || (selected !== undefined && (typeof selected !== "string" || !isProjectId(selected)))) return usageOutcome(name);
    const resolved = await dependencies.resolveProject();
    if (!resolved.ok) return refusalOutcome(name, resolved.error);
    if (selected !== undefined && selected !== resolved.value.projectId) return refusalOutcome(name, { rule: "project-association-mismatch" });
    const store = dependencies.storeForProject(resolved.value);
    if (!store) return refusalOutcome(name, { rule: "consent-status-unavailable" });
    const result = await store.getChallenge(requestId, Date.now());
    if (!result.ok) return refusalOutcome(name, { rule: result.error.rule });
    if (!result.value) return refusalOutcome(name, { rule: "consent-not-found" });
    const record = result.value;
    if (record.status === "pending" && (record.request.binding.projectId !== resolved.value.projectId || record.request.binding.requestId !== requestId)) return refusalOutcome(name, { rule: "consent-request-conflict" });
    const pending = record.status === "pending";
    return {
      command: name, outcome: "succeeded", errors: [],
      data: { contract: "pharos.consent-status/1", status: pending ? "host-decision-required" : record.status, auditId: record.auditId, requestId, ...(pending ? { request: record.request } : {}) },
      nextAction: pending ? { command: "host-decision-required", reason: "Present the exact request in a trusted interactive host" } : null,
    };
  });
}
