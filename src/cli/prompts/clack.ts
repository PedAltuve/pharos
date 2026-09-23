import { cancel, confirm, isCancel, select, text } from "@clack/prompts";
import { stderr } from "node:process";
import type { BeaconLifecyclePrompt, InputPrompt } from "./input.js";

/** CLI-only Clack bridge. It returns JSON-shaped objects consumed by the same validators as --input. */
export function projectInitPrompt(): InputPrompt<Record<string, unknown>> {
  return {
    async prompt() {
      const projectName = await text({ message: "Project name" });
      if (isCancel(projectName)) return undefined;
      const mode = await select({
        message: "Mode",
        options: [{ value: "external", label: "External" }, { value: "repository", label: "Repository" }],
      });
      if (isCancel(mode)) return undefined;
      const environment = await select({
        message: "Environment",
        options: ["local", "test", "staging"].map((value) => ({ value, label: value })),
      });
      if (isCancel(environment)) return undefined;
      const baseUrl = await text({ message: "Base URL" });
      if (isCancel(baseUrl)) return undefined;
      const associationPath = await text({ message: "Association path" });
      if (isCancel(associationPath)) return undefined;
      return {
        contract: "pharos.project-init/1",
        project_name: projectName,
        mode,
        environment,
        base_url: baseUrl,
        association_path: associationPath,
      };
    },
  };
}

/** Ensures a cancellation has an explicit terminal presentation when invoked by a command adapter. */
/** CLI-only annotation bridge; its object travels through the same ingress validator as --input. */
export function captureAnnotationPrompt(): InputPrompt<unknown> {
  return {
    async prompt() {
      const annotation = await text({ message: "Capture annotation JSON" });
      if (isCancel(annotation)) return undefined;
      if (typeof annotation !== "string") return undefined;
      try {
        return JSON.parse(annotation) as unknown;
      } catch {
        // Validation receives this untrusted value and returns its stable refusal.
        return annotation;
      }
    },
  };
}

export function beaconLifecyclePrompt(): BeaconLifecyclePrompt {
  return {
    async confirmApproval(input) {
      const response = await confirm({
        message: `Approve Beacon ${input.beaconId}, draft ${input.draftId}, capture ${input.captureId}, semantic hash ${input.semanticHash}?`,
        output: stderr,
      });
      return isCancel(response) ? undefined : response === true;
    },
    async requestRevocationReason() {
      const response = await text({ message: "Revocation reason", output: stderr });
      return isCancel(response) || typeof response !== "string" ? undefined : response;
    },
    async confirmRevocation(input) {
      const response = await confirm({
        message: `Revoke active version ${input.expectedActiveVersionId} of Beacon ${input.beaconId} with reason: ${input.reason}?`,
        output: stderr,
      });
      return isCancel(response) ? undefined : response === true;
    },
  };
}

export function announceCancellation(): void {
  cancel("Cancelled");
}
