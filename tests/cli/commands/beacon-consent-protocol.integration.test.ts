import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FsProjectContextStore } from "../../../src/adapters/fs-project-context-store/index.js";
import { FsBeaconStore } from "../../../src/adapters/fs-beacon-store/index.js";
import { FsConsentStore } from "../../../src/adapters/fs-consent-store/index.js";
import { FsCaptureStore } from "../../../src/adapters/fs-capture-store/index.js";
import { JcsSha256Hasher } from "../../../src/adapters/hashing/index.js";
import { staleComparisonDigest } from "../../../src/adapters/host-consent-verifier/index.js";
import { project } from "../../../src/domain/semantics/index.js";
import { createComposition } from "../../../src/cli/composition.js";
import { runCli } from "../../../src/cli/program.js";
import { createHostConsentRuntime } from "../../../src/host-consent/index.js";
import piConsent from "../../../integrations/pi/extension.js";

const projectId = "proj_018f47de-7a00-7cc0-8000-000000000001" as const;
const otherId = "proj_018f47de-7a00-7cc0-8000-000000000002" as const;
const beaconId = "bcn_018f47de-7a00-7cc0-8000-000000000001" as const;
const draftId = "drf_018f47de-7a00-7cc0-8000-000000000001" as const;
const versionId = "ver_018f47de-7a00-7cc0-8000-000000000001";
const requestId = "req_018f47de-7a00-7cc0-8000-000000000002" as const;
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

describe("production persisted consent CLI", () => {
  it.each([false, true])("prepares approval from a real promoted capture (stale origin: %s) without itself granting authority", async (stale) => {
    const root = await mkdtemp(join(tmpdir(), "pharos-cli-approval-"));
    roots.push(root);
    const home = join(root, "home");
    const target = process.cwd();
    const contexts = new FsProjectContextStore({ home });
    expect(await contexts.initialize({
      context: { contract: "pharos.project-context/1", projectId, revision: 1, name: "Checkout", mode: "external", environment: "staging", baseUrl: "https://staging.example.test/", createdAt: "2026-03-01T00:00:00.000Z" },
      associationPath: target, requestId: "req_init-approval", inputHash: "init-approval",
    })).toMatchObject({ ok: true });
    const projectRoot = join(home, "store", projectId);
    const captureId = "cap_018f47de-7a00-7cc0-8000-000000000001" as const;
    const captureRequestId = "req_018f47de-7a00-7cc0-8000-000000000001" as const;
    const captures = new FsCaptureStore({ projectRoot });
    expect(await captures.beginLaunch({ projectId, captureId, requestId: captureRequestId, inputHash: "sha256:capture", secretSourceReferences: [], createdAt: "2026-03-01T00:00:00.000Z" })).toMatchObject({ ok: true });
    expect(await captures.recordRecorderStarted(projectId, captureId, { pid: 4242, identity: "a".repeat(64) })).toMatchObject({ ok: true });
    expect(await captures.markPostExit(projectId, captureId, "2026-03-01T00:01:00.000Z")).toMatchObject({ ok: true });
    const bytes = "";
    const staging = join(projectRoot, "capture-staging", captureId, "recording.spec.ts");
    await writeFile(staging, bytes, { mode: 0o600 });
    expect(await captures.resolve(projectId, captureId, { resolution: "promote", artifact: { reference: `captures/${captureId}/recording.spec.ts`, byteSize: 0, sha256: createHash("sha256").update(bytes).digest("hex") } }, "2026-03-01T00:02:00.000Z")).toMatchObject({ ok: true, value: { status: "promoted" } });

    const content = { purpose: "Renew", actor: { type: "user" }, entryPoint: { path: "/checkout" }, actions: [], readinessIntent: { sideEffectClass: "stateless" } } as const;
    const semanticHash = new JcsSha256Hasher().hash(project(content));
    const beacon = new FsBeaconStore({ projectRoot, hasher: new JcsSha256Hasher() });
    expect(await beacon.createDraft(beaconId, { draftId, label: "Renew", beaconTitle: "Renew", origin: { branchedFromVersion: null, branchedFromHash: null, forkedFromDraft: null }, content }, "seed-approval-draft")).toMatchObject({ ok: true });
    if (stale) {
      expect(await beacon.approveDraft(beaconId, { draftId, expectedRevision: 1, reviewedHash: semanticHash, versionId, approvedAt: "2026-03-05T00:00:00.000Z", actor: "operator", staleOriginAcknowledged: false }, "seed-approval")).toMatchObject({ ok: true });
      expect(await beacon.createDraft(beaconId, { draftId: "drf_018f47de-7a00-7cc0-8000-000000000002", label: "Renew", beaconTitle: "Renew", origin: { branchedFromVersion: null, branchedFromHash: null, forkedFromDraft: null }, content }, "seed-stale-draft")).toMatchObject({ ok: true });
    }
    const pendingDraftId = stale ? "drf_018f47de-7a00-7cc0-8000-000000000002" : draftId;
    const pending = { contract: "pharos.capture-beacon-association/1", state: "pending" as const, projectId, captureId, requestId: captureRequestId, inputHash: "sha256:annotation", beaconId, draftId: pendingDraftId, revision: 1, createdAt: "2026-03-01T00:03:00.000Z" } as const;
    expect(await captures.claimAnnotation(pending)).toMatchObject({ ok: true });
    expect(await captures.commitAssociation({ ...pending, state: "committed", semanticHash, committedAt: "2026-03-01T00:04:00.000Z" })).toMatchObject({ ok: true });

    const invoke = async (args: string[]) => {
      const stdout: string[] = [];
      const stderr: string[] = [];
      const exit = await runCli(["node", "pharos", "beacon", ...args, "--pharos-home", home, "--format", "json"], { writeOut: (value) => stdout.push(value), writeErr: (value) => stderr.push(value) });
      expect(stdout).toHaveLength(1);
      expect(stderr).toEqual([]);
      expect(stdout[0]).not.toMatch(/signature|privateKey|"grant"/i);
      return { exit, envelope: JSON.parse(stdout[0]!) as { outcome: string; data?: { request?: unknown; status?: string; auditId?: string } } };
    };
    const prepared = await invoke(["prepare", "approve", beaconId, "--request-id", requestId]);
    expect(prepared.exit).toBe(0);
    const reviewed = stale ? { activeVersionId: versionId, activeSemanticHash: semanticHash,
      comparisonDigest: staleComparisonDigest(semanticHash, versionId, semanticHash) } : undefined;
    expect(prepared.envelope).toMatchObject({ outcome: "succeeded", data: { status: "host-decision-required", request: { contract: stale ? "pharos.operator-consent-request/2" : "pharos.operator-consent-request/1", binding: { action: "approve", projectId, beaconId, draftId: pendingDraftId, expectedRevision: 1, semanticHash, requestId, ...(stale ? { staleOriginAcknowledged: true, reviewed } : {}) } } } });
    const stored = await new FsConsentStore({ projectRoot }).getChallenge(requestId, Date.now());
    expect(stored).toMatchObject({ ok: true, value: { status: "pending" } });
    if (!stored.ok || stored.value?.status !== "pending") throw new Error("missing persisted approval request");
    expect(prepared.envelope.data?.request).toEqual(stored.value.request);
    expect(prepared.envelope.data?.auditId).toBe(stored.value.auditId);
    const status = await invoke(["consent-status", requestId]);
    expect(status.exit).toBe(0);
    expect(status.envelope.data?.request).toEqual(stored.value.request);
    expect(status.envelope.data?.auditId).toBe(stored.value.auditId);
    expect(await beacon.getBeacon(beaconId)).toMatchObject({ ok: true, value: { activeVersionId: stale ? versionId : null, drafts: { [pendingDraftId]: { status: "open" } } } });
    let handler: ((requestId: string, context: unknown) => Promise<void>) | undefined;
    const notifications: string[] = [];
    piConsent({ registerCommand(name, command) {
      if (name === "pharos-consent") handler = command.handler as (requestId: string, context: unknown) => Promise<void>;
    } }, { broker: () => createHostConsentRuntime({ home, cwd: target }), width: () => 80, height: () => 24 });
    if (!handler) throw new Error("Pi consent command not registered");
    const reviewTitles: string[] = [];
    await handler(requestId, { mode: "tui", ui: {
      select: async (title: string, choices: string[]) => {
        if (choices.includes("Continue")) {
          expect(choices).toEqual(["Continue", "Cancel"]);
          expect(title.split("\n").length).toBeLessThanOrEqual(8);
          reviewTitles.push(title);
          return "Continue";
        }
        void title;
        expect(title.includes("WARNING: stale origin")).toBe(stale);
        expect(choices).toEqual(["Approve", "Decline"]);
        return "Approve";
      },
      notify: (message: string) => notifications.push(message),
    } });
    expect(reviewTitles.length).toBeGreaterThan(1);
    const displayed = reviewTitles.map((title) => title.split("\n").slice(1).filter((line) => !line.startsWith("Escapes:")).join("")).join("");
    expect(displayed).toContain(`"requestId": "${requestId}"`);
    if (stale) {
      expect(displayed).toContain("Trusted semantic comparison");
      expect(displayed).toContain('"requestId": "req_');
    }
    expect(notifications).toEqual(expect.arrayContaining(["Pharos consent completed; inspect status for the public result"]));
    expect(await invoke(["consent-status", requestId])).toMatchObject({ exit: 0, envelope: { data: { status: "consumed" } } });
    const activated = await beacon.getActiveVersion(beaconId);
    expect(activated).toMatchObject({ ok: true, value: { status: "active", approval: { staleOriginAcknowledged: stale, reviewedHash: semanticHash } } });
    if (!activated.ok || !activated.value) throw new Error("Pi completion did not activate a version");
    if (stale) expect(await beacon.getBeacon(beaconId)).toMatchObject({ ok: true, value: { versions: { [versionId]: { status: "superseded", supersededBy: activated.value.versionId } } } });
  });
  it("prepares a canonical active Beacon revocation and reads the identical private request", async () => {
    const root = await mkdtemp(join(tmpdir(), "pharos-cli-consent-"));
    roots.push(root);
    const home = join(root, "home");
    const target = process.cwd();
    const otherTarget = join(root, "other-target");
    await mkdir(otherTarget);
    const contexts = new FsProjectContextStore({ home });
    for (const [id, path] of [[projectId, target], [otherId, otherTarget]] as const) {
      expect(await contexts.initialize({
        context: { contract: "pharos.project-context/1", projectId: id, revision: 1, name: "Checkout", mode: "external", environment: "staging", baseUrl: "https://staging.example.test/", createdAt: "2026-03-01T00:00:00.000Z" },
        associationPath: path, requestId: `req_init-${id}`, inputHash: `init-${id}`,
      })).toMatchObject({ ok: true });
    }
    const projectRoot = join(home, "store", projectId);
    const hasher = new JcsSha256Hasher();
    const beacon = new FsBeaconStore({ projectRoot, hasher });
    const content = { purpose: "Renew", actor: { type: "user" }, entryPoint: { path: "/checkout" }, actions: [], readinessIntent: { sideEffectClass: "stateless" } } as const;
    expect(await beacon.createDraft(beaconId, { draftId, label: "Renew", beaconTitle: "Renew", origin: { branchedFromVersion: null, branchedFromHash: null, forkedFromDraft: null }, content }, "seed-draft")).toMatchObject({ ok: true });
    expect(await beacon.approveDraft(beaconId, { draftId, expectedRevision: 1, reviewedHash: hasher.hash(project(content)), versionId, approvedAt: "2026-03-05T00:00:00.000Z", actor: "operator", staleOriginAcknowledged: false }, "seed-approval")).toMatchObject({ ok: true });
    const composition = createComposition({ pharosHome: home, currentPath: async () => target });
    expect(await composition.resolveProject()).toMatchObject({ ok: true, value: { projectId } });
    const invoke = async (args: string[]) => {
      const stdout: string[] = [];
      const stderr: string[] = [];
      const exit = await runCli(["node", "pharos", "beacon", ...args, "--pharos-home", home, "--format", "json"], { writeOut: (value) => stdout.push(value), writeErr: (value) => stderr.push(value) });
      expect(stdout).toHaveLength(1);
      expect(stdout[0]).not.toMatch(/signature|privateKey|"grant"/i);
      return { exit, envelope: JSON.parse(stdout[0]!) as { outcome: string; data?: { request?: unknown; status?: string }; errors?: { rule: string }[] }, stderr };
    };
    const prepared = await invoke(["prepare", "revoke", beaconId, "--request-id", requestId, "--reason", "withdrawn"]);
    expect(prepared.exit).toBe(0);
    expect(prepared.envelope).toMatchObject({ outcome: "succeeded", data: { status: "host-decision-required", request: { binding: { action: "revoke", projectId, beaconId, requestId, expectedActiveVersion: versionId, reason: "withdrawn" } } } });
    const stored = await new FsConsentStore({ projectRoot }).getChallenge(requestId, Date.now());
    expect(stored).toMatchObject({ ok: true, value: { status: "pending" } });
    if (!stored.ok || stored.value?.status !== "pending") throw new Error("missing persisted private request");
    expect(prepared.envelope.data?.request).toEqual(stored.value.request);
    const status = await invoke(["consent-status", requestId]);
    expect(status.exit).toBe(0);
    expect(status.envelope.data?.request).toEqual(stored.value.request);
    const unassociated = join(root, "unassociated");
    await mkdir(unassociated);
    const originalCwd = process.cwd();
    try {
      process.chdir(unassociated);
      for (const args of [
        ["prepare", "revoke", beaconId, "--request-id", "req_018f47de-7a00-7cc0-8000-000000000003", "--reason", "withdrawn", "--project", projectId],
        ["consent-status", requestId, "--project", projectId],
      ]) {
        const denied = await invoke(args);
        expect(denied.exit).not.toBe(0);
        expect(denied.envelope.outcome).toBe("refused");
        expect(denied.envelope.data?.request).toBeUndefined();
        expect(JSON.stringify(denied.envelope)).not.toContain(beaconId);
      }
    } finally {
      process.chdir(originalCwd);
    }
    expect(await new FsConsentStore({ projectRoot }).getChallenge("req_018f47de-7a00-7cc0-8000-000000000003", Date.now())).toEqual({ ok: true, value: undefined });
    const isolated = await new FsConsentStore({ projectRoot: join(home, "store", otherId) }).getChallenge(requestId, Date.now());
    expect(isolated).toEqual({ ok: true, value: undefined });
    const otherStatus = await invoke(["consent-status", requestId, "--project", otherId]);
    expect(otherStatus.envelope.outcome).toBe("refused");
    expect(otherStatus.envelope.data?.request).toBeUndefined();
    const expired = await new FsConsentStore({ projectRoot }).getChallenge(requestId, stored.value.request.expiresAtEpochMs + 1);
    expect(expired).toMatchObject({ ok: false, error: { rule: "consent-expired" } });
    const unknown = await invoke(["consent-status", requestId, "--unknown-secret", "private-value", "--format=json"]);
    expect(unknown.envelope.outcome).toBe("refused");
    expect(JSON.stringify(unknown)).not.toContain("private-value");
  });
});
