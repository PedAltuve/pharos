import { describe, expect, it } from "vitest";
import { buildBeaconConsentStatusCommand } from "../../../src/cli/commands/beacon-consent-status.js";

const requestId = "req_018f47de-7a00-7cc0-8000-000000000003";
const projectId = "proj_018f47de-7a00-7cc0-8000-000000000001";
const request = { contract: "pharos.operator-consent-request/1", binding: { action: "revoke", projectId, beaconId: "bcn_018f47de-7a00-7cc0-8000-000000000002", requestId, expectedActiveVersion: "version-1", reason: "retired /private/archive/file" }, challengeId: "challenge-1", expiresAtEpochMs: 9999999999999 };

describe("agent-safe consent status", () => {
  it.each(["pending", "claimed", "declined", "consumed"])("publishes only safe %s state", async (status) => {
    const out: string[] = []; const stderr: string[] = [];
    const record = status === "pending" ? { status, request, auditId: "audit-1" } : { status, requestId, auditId: "audit-1", actionHash: "private-hash", result: { grant: "private-grant" }, approvalCommand: { signature: "private-signature" }, reason: "private-reason" };
    const command = buildBeaconConsentStatusCommand({
      homeResolution: () => ({ ok: true, value: undefined }), resolveProject: async () => ({ ok: true, value: { projectId } as never }),
      storeForProject: () => ({ getChallenge: async () => ({ ok: true, value: record as never }) }),
      writers: { writeOut: (text) => out.push(text), writeErr: (text) => stderr.push(text) }, setExitCode: () => {},
    });
    await command.parseAsync(["node", "status", requestId, "--format", "json"]);
    expect(out).toHaveLength(1); expect(stderr).toEqual([]);
    const envelope = JSON.parse(out[0]!);
    expect(envelope.data).toMatchObject({ contract: "pharos.consent-status/1", status: status === "pending" ? "host-decision-required" : status, auditId: "audit-1" });
    expect(envelope.data.request).toEqual(status === "pending" ? request : undefined);
    expect(out[0]).not.toMatch(/private-hash|private-grant|private-signature|private-reason/);
  });
  it.each(["missing", "expired", "invalid"])("refuses %s without leaking lookup details", async (scenario) => {
    const out: string[] = [];
    const command = buildBeaconConsentStatusCommand({ homeResolution: () => ({ ok: true, value: undefined }), resolveProject: async () => ({ ok: true, value: { projectId } as never }),
      storeForProject: () => ({ getChallenge: async () => scenario === "expired" ? { ok: false, error: { rule: "consent-expired" } } : { ok: true, value: undefined } }),
      writers: { writeOut: (text) => out.push(text), writeErr: () => {} }, setExitCode: () => {} });
    await command.parseAsync(["node", "status", scenario === "invalid" ? "bad" : requestId, "--format", "json"]);
    expect(out).toHaveLength(1); expect(JSON.parse(out[0]!).outcome).toBe("refused");
  });
});
