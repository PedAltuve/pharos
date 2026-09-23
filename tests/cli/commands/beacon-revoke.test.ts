import { describe, expect, it } from "vitest";
import { buildBeaconRevokeCommand } from "../../../src/cli/commands/beacon-revoke.js";

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
const versionId = "ver_018f47de-7a00-7cc0-8000-000000000006" as const;
const requestId = "req_018f47de-7a00-7cc0-8000-000000000002" as const;

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

const activeStatus = { beaconId, authority: "active-approved" as const, activeVersionId: versionId, readiness: "unavailable" as const, staleness: "unavailable" as const, verification: "unavailable" as const } as const;

describe("beacon revoke command", () => {
  it("prepares the current active snapshot, trims the reason, and confirms the exact impact", async () => {
    const env = runtime();
    const confirmations: unknown[] = [];
    const revocations: unknown[] = [];
    const command = buildBeaconRevokeCommand({
      ...env,
      isInteractiveTerminal: () => true,
      prompt: { async requestRevocationReason() { return "  Recalled by operator  "; }, async confirmRevocation(value) { confirmations.push(value); return true; } },
      status: { execute: async () => ({ ok: true as const, value: activeStatus }) },
      revoke: { execute: async (request) => { revocations.push(request); return { ok: true as const, value: { beaconId, versionId, status: "revoked" as const, reason: "Recalled by operator" } }; } },
    });

    await command.parseAsync(["node", "revoke", beaconId, "--format", "json"]);

    expect(confirmations).toEqual([{ beaconId, expectedActiveVersionId: versionId, reason: "Recalled by operator" }]);
    expect(revocations).toEqual([{ beaconId, requestId, expectedActiveVersionId: versionId, reason: "Recalled by operator", actor: null }]);
    expect(env.exits).toEqual([0]);
    expect(JSON.parse(env.stdout.join(""))).toMatchObject({ outcome: "succeeded", data: { beacon_id: beaconId, version_id: versionId, status: "revoked" } });
  });

  it.each([
    { label: "is not a TTY", tty: false, reason: "Reason", confirmation: true, exit: 3, statusReads: 0 },
    { label: "cancels reason entry", tty: true, reason: undefined, confirmation: true, exit: 5, statusReads: 1 },
    { label: "supplies only whitespace", tty: true, reason: " \n\t ", confirmation: true, exit: 3, statusReads: 1 },
    { label: "cancels confirmation", tty: true, reason: "Reason", confirmation: undefined, exit: 5, statusReads: 1 },
    { label: "declines confirmation", tty: true, reason: "Reason", confirmation: false, exit: 3, statusReads: 1 },
  ])("does not revoke when $label", async ({ tty, reason, confirmation, exit, statusReads }) => {
    const env = runtime();
    let prepared = 0;
    let revocations = 0;
    const command = buildBeaconRevokeCommand({
      ...env,
      isInteractiveTerminal: () => tty,
      prompt: { async requestRevocationReason() { return reason; }, async confirmRevocation() { return confirmation; } },
      status: { execute: async () => { prepared += 1; return { ok: true as const, value: activeStatus }; } },
      revoke: { execute: async () => { revocations += 1; return { ok: true as const, value: {} as never }; } },
    });

    await command.parseAsync(["node", "revoke", beaconId, "--format", "json"]);

    expect(prepared).toBe(statusReads);
    expect(revocations).toBe(0);
    expect(env.exits).toEqual([exit]);
  });

  it("replays a successful revocation through the use case after status becomes no-active", async () => {
    const env = runtime();
    const revocations: unknown[] = [];
    let reads = 0;
    const dependencies = {
      ...env,
      isInteractiveTerminal: () => true,
      prompt: { async requestRevocationReason() { return "Reason"; }, async confirmRevocation() { return true; } },
      status: { execute: async () => ({ ok: true as const, value: reads++ === 0 ? activeStatus : { ...activeStatus, authority: "revoked-no-active" as const, activeVersionId: null } }) },
      revoke: { execute: async (request: unknown) => { revocations.push(request); return { ok: true as const, value: { beaconId, versionId, status: "revoked" as const, reason: "Reason" } }; } },
    };

    await buildBeaconRevokeCommand(dependencies).parseAsync(["node", "revoke", beaconId, "--format", "json", "--request-id", requestId]);
    await buildBeaconRevokeCommand(dependencies).parseAsync(["node", "revoke", beaconId, "--format", "json", "--request-id", requestId]);

    expect(revocations).toEqual([
      { beaconId, requestId, expectedActiveVersionId: versionId, reason: "Reason", actor: null },
      { beaconId, requestId, expectedActiveVersionId: null, reason: "Reason", actor: null },
    ]);
    expect(env.exits).toEqual([0, 0]);
    expect(JSON.parse(env.stdout[1] ?? "")).toMatchObject({ outcome: "succeeded", data: { version_id: versionId, status: "revoked" } });
  });
});
