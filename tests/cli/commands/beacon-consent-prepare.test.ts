import { describe, expect, it } from "vitest";
import { createUnregisteredCommandSet } from "../../../src/cli/composition.js";
import { buildBeaconConsentPrepareCommand } from "../../../src/cli/commands/beacon-consent-prepare.js";
import type { ConsentRequest } from "../../../src/domain/ports/operator-consent.js";

const projectId = "proj_018f47de-7a00-7cc0-8000-000000000001" as const;
const beaconId = "bcn_018f47de-7a00-7cc0-8000-000000000002" as const;
const requestId = "req_018f47de-7a00-7cc0-8000-000000000003" as const;
const project = { projectId } as never;

describe("agent-safe consent preparation", () => {
  it.each(["x".repeat(300), "retired /private/archive/file"])("preserves the complete revocation reason in one public envelope", async (reason) => {
    const stdout: string[] = [];
    const request: ConsentRequest = { contract: "pharos.operator-consent-request/1", binding: { action: "revoke", projectId, beaconId, requestId, expectedActiveVersion: "version-1", reason }, challengeId: "challenge-1", expiresAtEpochMs: 1000 };
    const command = buildBeaconConsentPrepareCommand({
      homeResolution: () => ({ ok: true, value: undefined }), resolveProject: async () => ({ ok: true, value: project }),
      approveForProject: () => undefined, revokeForProject: () => ({ prepareConsent: async () => ({ ok: true, value: { request, auditId: "audit-1" } }) }),
      writers: { writeOut: (text) => stdout.push(text), writeErr: () => {} }, setExitCode: () => {},
    });
    await command.parseAsync(["node", "prepare", "revoke", beaconId, "--request-id", requestId, "--reason", reason, "--format", "json"]);
    expect(stdout).toHaveLength(1);
    const envelope = JSON.parse(stdout[0]!);
    expect(envelope.data.request).toEqual(request);
    expect(stdout[0]).not.toMatch(/signature|grant|privateKey/);
  });

  it("refuses model stale acknowledgement before calling approval preparation", async () => {
    const stdout: string[] = [];
    let calls = 0;
    const command = buildBeaconConsentPrepareCommand({
      homeResolution: () => ({ ok: true, value: undefined }), resolveProject: async () => ({ ok: true, value: project }),
      approveForProject: () => ({ prepareConsent: async () => { calls++; return { ok: false, error: { rule: "stale-origin" } }; } }),
      revokeForProject: () => undefined,
      writers: { writeOut: (text) => stdout.push(text), writeErr: () => {} }, setExitCode: () => {},
    });
    await expect(command.parseAsync(["node", "prepare", "approve", beaconId, "--request-id", requestId, "--stale-origin-acknowledged", "--format", "json"])).rejects.toThrow();
    expect(calls).toBe(0);
    expect(stdout).toHaveLength(1);
    expect(JSON.parse(stdout[0]!).outcome).toBe("refused");
  });

  it("directs stale drafts to the trusted host UI without asserting acknowledgement", async () => {
    const stdout: string[] = [];
    let supplied: unknown;
    const command = buildBeaconConsentPrepareCommand({
      homeResolution: () => ({ ok: true, value: undefined }), resolveProject: async () => ({ ok: true, value: project }),
      approveForProject: () => ({ prepareConsent: async (input) => { supplied = input; return { ok: false, error: { rule: "stale-origin-acknowledgement-required" } }; } }),
      revokeForProject: () => undefined,
      writers: { writeOut: (text) => stdout.push(text), writeErr: () => {} }, setExitCode: () => {},
    });
    await command.parseAsync(["node", "prepare", "approve", beaconId, "--request-id", requestId, "--format", "json"]);
    expect(supplied).not.toHaveProperty("staleOriginAcknowledged");
    expect(JSON.parse(stdout[0]!)).toMatchObject({ outcome: "refused", next_action: { command: "host-decision-required" } });
  });
  it.each(["approve", "revoke"])("returns canonical %s request without decision authority", async (action) => {
    const stdout: string[] = [];
    const request = { contract: "pharos.operator-consent-request/1", binding: action === "approve" ? { action, projectId, beaconId, requestId, draftId: "draft-1", expectedRevision: 1, semanticHash: "sha256:hash" } : { action, projectId, beaconId, requestId, expectedActiveVersion: "version-1", reason: "retired" }, challengeId: "host-challenge", expiresAtEpochMs: 1000 };
    const commands = createUnregisteredCommandSet({
      createComposition: () => ({
        homeResolution: () => ({ ok: true, value: undefined }), initialize: undefined,
        resolveProject: async () => ({ ok: true, value: project }),
        forProject: () => ({
          record: {} as never, annotate: {} as never, inspect: {} as never,
          approve: { execute: async () => { throw Error("legacy"); }, prepareConsent: async () => ({ ok: true, value: { request, auditId: "audit-1" } }) },
          revoke: { execute: async () => { throw Error("legacy"); }, prepareConsent: async () => ({ ok: true, value: { request, auditId: "audit-1" } }) },
        }) as never,
      }),
      writers: { writeOut: (text) => stdout.push(text), writeErr: () => {} }, setExitCode: () => {},
    });
    await commands.beaconConsentPrepare.parseAsync(["node", "prepare", action, beaconId, "--request-id", requestId, "--format", "json", ...(action === "revoke" ? ["--reason", "retired"] : [])]);
    expect(stdout).toHaveLength(1);
    expect(JSON.parse(stdout[0]!)).toMatchObject({ contract: "pharos.cli-envelope/1", outcome: "succeeded", data: { contract: "pharos.consent-prepare/1", status: "host-decision-required", request } });
    expect(stdout[0]).not.toMatch(/signature|grant|privateKey/);
  });
});
