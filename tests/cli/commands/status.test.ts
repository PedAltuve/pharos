import { describe, expect, it } from "vitest";
import { buildStatusCommand } from "../../../src/cli/commands/status.js";

const beaconId = "bcn_018f47de-7a00-7cc0-8000-000000000004";
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

function runtime() {
  const stdout: string[] = [];
  const exits: number[] = [];
  return {
    stdout,
    exits,
    writers: { writeOut: (text: string) => stdout.push(text), writeErr: () => {} },
    setExitCode: (code: number) => exits.push(code),
    homeResolution: () => ({ ok: true as const, value: undefined }),
    resolveProject: async () => ({ ok: true as const, value: project }),
  };
}

describe("status command", () => {
  it.each([
    ["no-authority", null, "pharos capture record"],
    ["open-draft", null, `pharos beacon approve ${beaconId}`],
    ["active-approved", "ver_018f47de-7a00-7cc0-8000-000000000006", `pharos beacon revoke ${beaconId}`],
    ["revoked-no-active", null, "pharos capture record"],
  ] as const)("renders %s authority separately from unavailable dimensions", async (authority, activeVersionId, nextCommand) => {
    const env = runtime();
    const received: unknown[] = [];
    const command = buildStatusCommand({
      ...env,
      status: { execute: async (request) => { received.push(request); return { ok: true as const, value: { beaconId, authority, activeVersionId, readiness: "unavailable" as const, staleness: "unavailable" as const, verification: "unavailable" as const } }; } },
    });

    await command.parseAsync(["node", "status", beaconId, "--format", "json"]);

    expect(received).toEqual([{ beaconId }]);
    expect(env.exits).toEqual([0]);
    expect(JSON.parse(env.stdout.join(""))).toMatchObject({
      command: "status", outcome: "succeeded",
      data: { beacon_id: beaconId, authority, active_version_id: activeVersionId, readiness: "unavailable", staleness: "unavailable", verification: "unavailable" },
      next_action: { command: nextCommand },
    });
  });

  it("keeps human output bounded to lifecycle dimensions instead of dumping status internals", async () => {
    const env = runtime();
    const command = buildStatusCommand({
      ...env,
      status: { execute: async () => ({ ok: true as const, value: { beaconId, authority: "open-draft" as const, activeVersionId: null, readiness: "unavailable" as const, staleness: "unavailable" as const, verification: "unavailable" as const } }) },
    });

    await command.parseAsync(["node", "status", beaconId]);

    expect(env.stdout.join("")).toContain("authority: open-draft");
    expect(env.stdout.join("")).toContain("readiness: unavailable");
    expect(env.stdout.join("")).not.toContain("semantics");
  });
});
