import { describe, expect, it } from "vitest";
import { buildBeaconApproveCommand } from "../../../src/cli/commands/beacon-approve.js";

const project = {
  contract: "pharos.project-context/1" as const,
  projectId: "proj_018f47de-7a00-7cc0-8000-000000000001" as const,
  revision: 1 as const,
  name: "Checkout",
  mode: "external" as const,
  environment: "staging" as const,
  baseUrl: "https://staging.example.test/",
  createdAt: "2026-03-01T00:00:00.000Z",
};
const beaconId = "bcn_018f47de-7a00-7cc0-8000-000000000004" as const;
const requestId = "req_018f47de-7a00-7cc0-8000-000000000002" as const;
const inspection = {
  beacon: { authority: "authoritative" as const, beaconId, draftId: "drf_018f47de-7a00-7cc0-8000-000000000005", revision: 1 as const, status: "open" as const, semanticHash: "sha256:reviewed", semantics: {} as never },
  capture: { authority: "supporting-non-authoritative" as const, captureId: "cap_018f47de-7a00-7cc0-8000-000000000003", artifact: { reference: "captures/cap/recording.spec.ts", byteSize: 1, sha256: "sha256:artifact" } },
} as const;

function runtime() {
  const stdout: string[] = [];
  const exits: number[] = [];
  return {
    stdout,
    exits,
    writers: { writeOut: (text: string) => stdout.push(text), writeErr: () => {} },
    setExitCode: (code: number) => exits.push(code),
    homeResolution: () => ({ ok: true as const, value: undefined }),
    ids: { next: () => requestId },
    resolveProject: async () => ({ ok: true as const, value: project }),
  };
}

describe("beacon approve command", () => {
  it("inspects and presents the exact hash before explicit approval with a null actor", async () => {
    const env = runtime();
    const approvals: unknown[] = [];
    const prompts: unknown[] = [];
    const command = buildBeaconApproveCommand({
      ...env,
      isInteractiveTerminal: () => true,
      prompt: { async confirmApproval(value) { prompts.push(value); return true; } },
      inspect: { execute: async () => ({ ok: true as const, value: inspection }) },
      approve: { execute: async (request) => { approvals.push(request); return { ok: true as const, value: { beaconId, versionId: "ver_018f47de-7a00-7cc0-8000-000000000006", status: "active" as const, semanticHash: inspection.beacon.semanticHash, assurance: "operator_confirmed" as const } }; } },
    });

    await command.parseAsync(["node", "approve", beaconId, "--format", "json"]);

    expect(prompts).toEqual([{ beaconId, draftId: inspection.beacon.draftId, captureId: inspection.capture.captureId, semanticHash: inspection.beacon.semanticHash }]);
    expect(approvals).toEqual([{ projectId: project.projectId, beaconId, requestId, reviewedHash: inspection.beacon.semanticHash, operatorConfirmed: true, actor: null }]);
    expect(env.exits).toEqual([0]);
    expect(JSON.parse(env.stdout.join(""))).toMatchObject({ outcome: "succeeded", data: { beacon_id: beaconId, semantic_hash: inspection.beacon.semanticHash, assurance: "operator_confirmed" } });
  });

  it.each([
    { label: "is not a TTY", tty: false, confirmation: true, exit: 3 },
    { label: "cancels confirmation", tty: true, confirmation: undefined, exit: 5 },
    { label: "declines confirmation", tty: true, confirmation: false, exit: 3 },
  ])("does not approve when $label", async ({ tty, confirmation, exit }) => {
    const env = runtime();
    let approvals = 0;
    let inspections = 0;
    const command = buildBeaconApproveCommand({
      ...env,
      isInteractiveTerminal: () => tty,
      prompt: { async confirmApproval() { return confirmation; } },
      inspect: { execute: async () => { inspections += 1; return { ok: true as const, value: inspection }; } },
      approve: { execute: async () => { approvals += 1; return { ok: true as const, value: {} as never }; } },
    });

    await command.parseAsync(["node", "approve", beaconId, "--format", "json"]);

    expect(approvals).toBe(0);
    expect(inspections).toBe(tty ? 1 : 0);
    expect(env.exits).toEqual([exit]);
  });
});
