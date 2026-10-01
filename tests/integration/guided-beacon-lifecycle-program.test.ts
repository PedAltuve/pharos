import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FsBeaconStore } from "../../src/adapters/fs-beacon-store/index.js";
import { FsCaptureStore } from "../../src/adapters/fs-capture-store/index.js";
import { FsConsentStore } from "../../src/adapters/fs-consent-store/index.js";
import { FsProjectContextStore } from "../../src/adapters/fs-project-context-store/index.js";
import { JcsSha256Hasher } from "../../src/adapters/hashing/index.js";
import { AjvContractValidator } from "../../src/adapters/validation/ajv-contract-validator.js";
import {
  AnnotateCapture,
  ApproveBeaconDraft,
  BeaconStatus,
  InitializeProject,
  InspectBeaconDraft,
  RecordCapture,
  RevokeActiveBeacon,
} from "../../src/application/index.js";
import { mapAnnotation } from "../../src/application/annotation/index.js";
import { createComposition, createUnregisteredCommandSet } from "../../src/cli/composition.js";
import { createProgram } from "../../src/cli/program.js";
import { createHostConsentRuntime } from "../../src/host-consent/index.js";
import piConsent from "../../integrations/pi/extension.js";
import type { BeaconLifecyclePrompt } from "../../src/cli/prompts/input.js";
import type { Recorder, SensitivityScanner } from "../../src/domain/ports/index.js";
import { ok } from "../../src/shared/result.js";
import { validAnnotation } from "../fixtures/capture-annotation.js";

const ids = {
  project: "proj_018f47de-7a00-7cc0-8000-000000000011",
  capture: "cap_018f47de-7a00-7cc0-8000-000000000011",
  beacon: "bcn_018f47de-7a00-7cc0-8000-000000000011",
  olderDraft: "drf_018f47de-7a00-7cc0-8000-000000000010",
  draft: "drf_018f47de-7a00-7cc0-8000-000000000011",
  olderVersion: "ver_018f47de-7a00-7cc0-8000-000000000010",
  version: "ver_018f47de-7a00-7cc0-8000-000000000011",
  initRequest: "req_018f47de-7a00-7cc0-8000-000000000011",
  recordRequest: "req_018f47de-7a00-7cc0-8000-000000000012",
  annotateRequest: "req_018f47de-7a00-7cc0-8000-000000000013",
  approveRequest: "req_018f47de-7a00-7cc0-8000-000000000014",
  revokeRequest: "req_018f47de-7a00-7cc0-8000-000000000015",
  historyRequest: "req_018f47de-7a00-7cc0-8000-000000000016",
} as const;
const timestamp = "2026-03-06T00:00:00.000Z";
/** JCS SHA-256 binding the projected `validAnnotation` fixture with its variables omitted below. */
const expectedSemanticHash = "sha256:f6d3f3c88caba00d7676c8e366ab32be45741188a7e544e6582363c0bf7d7cfb";
let root: string;

class FakeRecorder implements Recorder {
  constructor(private readonly projectRoot: string) {}

  async start(command: Parameters<Recorder["start"]>[0]) {
    const bytes = "test-local supporting recorder output";
    await writeFile(join(this.projectRoot, "capture-staging", command.captureId, "recording.spec.ts"), bytes);
    return {
      evidence: undefined,
      async waitForCompletion() { return { kind: "exited" as const, exitCode: 0 }; },
      contain() {},
    };
  }

  async probeProcess() { return "absent" as const; }
}

class FakeScanner implements SensitivityScanner {
  async scan(command: Parameters<SensitivityScanner["scan"]>[0]) {
    const bytes = "test-local supporting recorder output";
    return ok({
      reference: `captures/${command.captureId}/recording.spec.ts`,
      byteSize: Buffer.byteLength(bytes),
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
}

function projectInput(target: string) {
  return {
    contract: "pharos.project-init/1",
    project_name: "Guided checkout",
    mode: "external",
    environment: "test",
    base_url: "https://guided.example.test",
    association_path: target,
  };
}

function compositionFactory(target: string) {
  return (pharosHome?: string) => createComposition({
    pharosHome: pharosHome ?? join(root, "pharos-home"),
    currentPath: async () => target,
    createAdapters: (home) => {
      const hasher = new JcsSha256Hasher();
      const projects = new FsProjectContextStore({ home });
      const projectRoot = join(home, "store", ids.project);
      const captures = new FsCaptureStore({ projectRoot });
      const beacons = new FsBeaconStore({ projectRoot, hasher });
      const consentStore = new FsConsentStore({ projectRoot });
      const issueChallenge = () => ({ challengeId: randomUUID(), expiresAtEpochMs: Date.now() + 300_000 });
      const generatedIds = {
        next(kind: "project" | "capture" | "beacon" | "draft" | "version" | "request") {
          return kind === "request" ? ids.annotateRequest : ids[kind];
        },
      };
      const resolver = { async resolve() { return ok({ values: new Map<string, string>(), dispose() {} }); } };
      return {
        initialize: new InitializeProject({
          clock: { now: () => new Date(timestamp) },
          ids: generatedIds,
          store: projects,
          hasher,
        }),
        async resolveProject(projectId) {
          return projectId === undefined
            ? projects.resolveByPath(target)
            : projects.resolveById(projectId, target);
        },
        forProject(project) {
          return {
            record: new RecordCapture({
              clock: { now: () => new Date(timestamp) }, ids: generatedIds, hasher,
              store: captures, resolver, recorder: new FakeRecorder(projectRoot), scanner: new FakeScanner(),
            }),
            annotate: new AnnotateCapture({
              clock: { now: () => new Date(timestamp) }, ids: generatedIds, hasher,
              captureStore: captures, beaconStore: beacons, validator: new AjvContractValidator(), resolver,
            }),
            inspect: new InspectBeaconDraft({ captureStore: captures, beaconStore: beacons, hasher }),
            approve: new ApproveBeaconDraft({
              clock: { now: () => new Date() }, ids: generatedIds, hasher,
              captureStore: captures, beaconStore: beacons, consentStore, issueChallenge,
            }),
            status: new BeaconStatus({ beaconStore: beacons }),
            consentStore,
            revoke: new RevokeActiveBeacon({
              clock: { now: () => new Date() }, beaconStore: beacons,
              canonicalProjectId: project.projectId, consentStore, issueChallenge,
            }),
          };
        },
      };
    },
  });
}

async function invoke(args: readonly string[], target: string, lifecyclePrompt: BeaconLifecyclePrompt) {
  const stdout: string[] = [];
  let exitCode = -1;
  const writers = { writeOut: (text: string) => stdout.push(text), writeErr: () => {} };
  const setExitCode = (code: number) => { exitCode = code; };
  const commands = createUnregisteredCommandSet({
    createComposition: compositionFactory(target),
    ids: { next: (kind) => kind === "request" ? ids.annotateRequest : ids[kind] },
    stdin: (async function* () {})(),
    stdinIsTty: false,
    initPrompt: { async prompt() { throw new Error("test does not prompt"); } },
    annotationPrompt: { async prompt() { throw new Error("test does not prompt"); } },
    lifecyclePrompt,
    isInteractiveTerminal: () => true,
    writers,
    setExitCode,
  });
  const program = createProgram(commands, { version: "0.0.0", ...writers, setExitCode });
  await program.parseAsync(["node", "pharos", ...args]);
  return { exitCode, envelope: JSON.parse(stdout.join("")) as Record<string, unknown> };
}

async function decideInPi(requestId: string, target: string, home: string) {
  let handler: ((args: string, context: unknown) => Promise<void>) | undefined;
  const notifications: string[] = [];
  const reviewPages: string[] = [];
  piConsent({ registerCommand(_name, command) { handler = command.handler as (args: string, context: unknown) => Promise<void>; } }, {
    broker: () => createHostConsentRuntime({ home, cwd: target }),
    width: () => 80,
    height: () => 24,
  });
  if (!handler) throw new Error("Pi consent command was not registered");
  await handler(requestId, { mode: "tui", ui: {
    select: async (title: string, choices: string[]) => {
      if (choices[0] === "Continue") {
        expect(choices).toEqual(["Continue", "Cancel"]);
        reviewPages.push(title);
        return "Continue";
      }
      expect(reviewPages.length).toBeGreaterThan(0);
      expect(reviewPages.join("\n")).toContain("requestId");
      expect(choices).toEqual(["Approve", "Decline"]);
      return "Approve";
    },
    notify: (message: string) => { notifications.push(message); },
  } });
  expect(reviewPages.length).toBeGreaterThan(0);
  expect(notifications).toContain("Pharos consent completed; inspect status for the public result");
}

function recordingLifecyclePrompt() {
  const approvals: Parameters<BeaconLifecyclePrompt["confirmApproval"]>[0][] = [];
  const revocations: Parameters<BeaconLifecyclePrompt["confirmRevocation"]>[0][] = [];
  const prompt: BeaconLifecyclePrompt = {
    async confirmApproval(approval) {
      approvals.push(approval);
      return true;
    },
    async requestRevocationReason() { return "  No longer needed  "; },
    async confirmRevocation(revocation) {
      revocations.push(revocation);
      return true;
    },
  };
  return { prompt, approvals, revocations };
}

async function snapshotFiles(path: string): Promise<ReadonlyMap<string, string>> {
  const snapshot = new Map<string, string>();
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const location = join(directory, entry.name);
      if (entry.isDirectory()) await visit(location);
      else if (entry.isFile()) snapshot.set(relative(path, location), await readFile(location, "utf8"));
    }
  }
  await visit(path);
  return snapshot;
}

afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("guided Beacon lifecycle program", () => {
  it("persists an approved version, clears active authority on revocation, and leaves repeated status reads unchanged", async () => {
    root = await mkdtemp(join(tmpdir(), "pharos-guided-lifecycle-"));
    const target = join(root, "non-production-target");
    await mkdir(target);
    const initFile = join(root, "project-init.json");
    const annotationFile = join(root, "annotation.json");
    await writeFile(initFile, JSON.stringify(projectInput(target)));
    await writeFile(annotationFile, JSON.stringify({ ...validAnnotation, variables: [] }));

    const lifecycle = recordingLifecyclePrompt();
    await expect(invoke(["init", "--format", "json", "--non-interactive", "--input", initFile, "--request-id", ids.initRequest], target, lifecycle.prompt)).resolves.toMatchObject({
      exitCode: 0, envelope: { outcome: "succeeded", data: { project_id: ids.project } },
    });
    await expect(invoke(["capture", "record", "--format", "json", "--no-secret-sources", "--request-id", ids.recordRequest], target, lifecycle.prompt)).resolves.toMatchObject({
      exitCode: 0, envelope: { outcome: "succeeded", data: { capture_id: ids.capture, status: "promoted" } },
    });
    await expect(invoke(["capture", "annotate", ids.capture, "--format", "json", "--non-interactive", "--input", annotationFile, "--request-id", ids.annotateRequest], target, lifecycle.prompt)).resolves.toMatchObject({
      exitCode: 0, envelope: { outcome: "succeeded", data: { beacon_id: ids.beacon, draft_id: ids.draft, status: "open" } },
    });

    const home = join(root, "pharos-home");
    const projectRoot = join(home, "store", ids.project);
    await expect(invoke(["beacon", "prepare", "approve", ids.beacon, "--request-id", ids.approveRequest, "--format", "json"], target, lifecycle.prompt)).resolves.toMatchObject({
      exitCode: 0, envelope: { outcome: "succeeded", data: { status: "host-decision-required", request: { binding: { action: "approve", semanticHash: expectedSemanticHash } } } },
    });
    await decideInPi(ids.approveRequest, target, home);
    await expect(invoke(["beacon", "consent-status", ids.approveRequest, "--format", "json"], target, lifecycle.prompt)).resolves.toMatchObject({
      exitCode: 0, envelope: { outcome: "succeeded", data: { status: "consumed" } },
    });
    const persistedApproval = await new FsBeaconStore({ projectRoot, hasher: new JcsSha256Hasher() }).getBeacon(ids.beacon);
    expect(persistedApproval).toMatchObject({
      ok: true,
      value: { drafts: { [ids.draft]: { status: "closed" } } },
    });
    if (!persistedApproval.ok || !persistedApproval.value.activeVersionId) throw new Error("approval did not activate a version");
    const versionId = persistedApproval.value.activeVersionId;
    expect(persistedApproval.value.versions[versionId]).toMatchObject({ status: "active", approval: { reviewedHash: expectedSemanticHash, assurance: "operator_confirmed" } });
    expect(lifecycle.approvals).toEqual([]);

    const beforeActiveStatus = await snapshotFiles(projectRoot);
    const activeStatus = await invoke(["status", ids.beacon, "--format", "json"], target, lifecycle.prompt);
    const repeatedActiveStatus = await invoke(["status", ids.beacon, "--format", "json"], target, lifecycle.prompt);
    expect(activeStatus).toMatchObject({
      exitCode: 0,
      envelope: { outcome: "succeeded", data: { authority: "active-approved", active_version_id: versionId, readiness: "unavailable", staleness: "unavailable", verification: "unavailable" } },
    });
    expect(repeatedActiveStatus).toEqual(activeStatus);
    await expect(snapshotFiles(projectRoot)).resolves.toEqual(beforeActiveStatus);

    await expect(invoke(["beacon", "prepare", "revoke", ids.beacon, "--request-id", ids.revokeRequest, "--reason", "No longer needed", "--format", "json"], target, lifecycle.prompt)).resolves.toMatchObject({
      exitCode: 0, envelope: { outcome: "succeeded", data: { status: "host-decision-required", request: { binding: { action: "revoke", expectedActiveVersion: versionId, reason: "No longer needed" } } } },
    });
    await decideInPi(ids.revokeRequest, target, home);
    await expect(invoke(["beacon", "consent-status", ids.revokeRequest, "--format", "json"], target, lifecycle.prompt)).resolves.toMatchObject({
      exitCode: 0, envelope: { outcome: "succeeded", data: { status: "consumed" } },
    });
    expect(lifecycle.revocations).toEqual([]);

    const persistedRevocation = await new FsBeaconStore({ projectRoot, hasher: new JcsSha256Hasher() }).getBeacon(ids.beacon);
    expect(persistedRevocation).toMatchObject({
      ok: true,
      value: {
        activeVersionId: null,
        versions: { [versionId]: { status: "revoked", approval: { reviewedHash: expectedSemanticHash }, revocation: { reason: "No longer needed" } } },
      },
    });

    const beforeRevokedStatus = await snapshotFiles(projectRoot);
    const revokedStatus = await invoke(["status", ids.beacon, "--format", "json"], target, lifecycle.prompt);
    const repeatedRevokedStatus = await invoke(["status", ids.beacon, "--format", "json"], target, lifecycle.prompt);
    expect(revokedStatus).toMatchObject({
      exitCode: 0,
      envelope: { outcome: "succeeded", data: { authority: "revoked-no-active", active_version_id: null, readiness: "unavailable", staleness: "unavailable", verification: "unavailable" } },
    });
    expect(repeatedRevokedStatus).toEqual(revokedStatus);
    await expect(snapshotFiles(projectRoot)).resolves.toEqual(beforeRevokedStatus);
  });

  it("never reactivates a real older version after the public replacement is revoked", async () => {
    root = await mkdtemp(join(tmpdir(), "pharos-guided-lifecycle-"));
    const target = join(root, "non-production-target");
    await mkdir(target);
    const initFile = join(root, "project-init.json");
    await writeFile(initFile, JSON.stringify(projectInput(target)));

    const lifecycle = recordingLifecyclePrompt();
    await expect(invoke(["init", "--format", "json", "--non-interactive", "--input", initFile, "--request-id", ids.initRequest], target, lifecycle.prompt)).resolves.toMatchObject({
      exitCode: 0, envelope: { outcome: "succeeded", data: { project_id: ids.project } },
    });
    await expect(invoke(["capture", "record", "--format", "json", "--no-secret-sources", "--request-id", ids.recordRequest], target, lifecycle.prompt)).resolves.toMatchObject({
      exitCode: 0, envelope: { outcome: "succeeded", data: { capture_id: ids.capture, status: "promoted" } },
    });

    const projectRoot = join(root, "pharos-home", "store", ids.project);
    const hasher = new JcsSha256Hasher();
    const beacons = new FsBeaconStore({ projectRoot, hasher });
    const captures = new FsCaptureStore({ projectRoot });
    const semanticFixture = { ...validAnnotation, variables: [] };
    const content = mapAnnotation(semanticFixture);

    await expect(beacons.createDraft(ids.beacon, {
      beaconTitle: semanticFixture.title,
      draftId: ids.olderDraft,
      label: semanticFixture.title,
      origin: { branchedFromVersion: null, branchedFromHash: null, forkedFromDraft: null },
      content,
    }, "history-create-older")).resolves.toMatchObject({ ok: true });
    await expect(beacons.approveDraft(ids.beacon, {
      draftId: ids.olderDraft,
      expectedRevision: 1,
      reviewedHash: expectedSemanticHash,
      versionId: ids.olderVersion,
      approvedAt: timestamp,
      actor: null,
      staleOriginAcknowledged: false,
    }, "history-approve-older")).resolves.toMatchObject({
      ok: true, value: { activeVersionId: ids.olderVersion, versions: { [ids.olderVersion]: { status: "active" } } },
    });
    await expect(beacons.createDraft(ids.beacon, {
      beaconTitle: semanticFixture.title,
      draftId: ids.draft,
      label: semanticFixture.title,
      origin: { branchedFromVersion: ids.olderVersion, branchedFromHash: expectedSemanticHash, forkedFromDraft: null },
      content,
    }, "history-create-replacement")).resolves.toMatchObject({ ok: true });

    const association = {
      contract: "pharos.capture-beacon-association/1" as const,
      state: "pending" as const,
      projectId: ids.project,
      captureId: ids.capture,
      requestId: ids.historyRequest,
      inputHash: "history-replacement-association",
      beaconId: ids.beacon,
      draftId: ids.draft,
      revision: 1 as const,
      createdAt: timestamp,
    };
    await expect(captures.claimAnnotation(association)).resolves.toMatchObject({ ok: true });
    await expect(captures.commitAssociation({
      ...association,
      state: "committed",
      semanticHash: expectedSemanticHash,
      committedAt: timestamp,
    })).resolves.toMatchObject({ ok: true });

    const home = join(root, "pharos-home");
    await expect(invoke(["beacon", "prepare", "approve", ids.beacon, "--request-id", ids.approveRequest, "--format", "json"], target, lifecycle.prompt)).resolves.toMatchObject({
      exitCode: 0, envelope: { outcome: "succeeded", data: { status: "host-decision-required", request: { binding: { action: "approve", semanticHash: expectedSemanticHash } } } },
    });
    await decideInPi(ids.approveRequest, target, home);
    const activated = await beacons.getActiveVersion(ids.beacon);
    if (!activated.ok || !activated.value) throw new Error("replacement did not activate");
    const versionId = activated.value.versionId;
    expect(lifecycle.approvals).toEqual([]);

    await expect(invoke(["status", ids.beacon, "--format", "json"], target, lifecycle.prompt)).resolves.toMatchObject({
      exitCode: 0,
      envelope: { outcome: "succeeded", data: { authority: "active-approved", active_version_id: versionId } },
    });
    await expect(invoke(["beacon", "prepare", "revoke", ids.beacon, "--request-id", ids.revokeRequest, "--reason", "No longer needed", "--format", "json"], target, lifecycle.prompt)).resolves.toMatchObject({
      exitCode: 0, envelope: { outcome: "succeeded", data: { status: "host-decision-required", request: { binding: { action: "revoke", expectedActiveVersion: versionId } } } },
    });
    await decideInPi(ids.revokeRequest, target, home);
    await expect(invoke(["status", ids.beacon, "--format", "json"], target, lifecycle.prompt)).resolves.toMatchObject({
      exitCode: 0,
      envelope: { outcome: "succeeded", data: { authority: "revoked-no-active", active_version_id: null } },
    });

    const persisted = await beacons.getBeacon(ids.beacon);
    expect(persisted).toMatchObject({
      ok: true,
      value: {
        activeVersionId: null,
        drafts: {
          [ids.olderDraft]: { status: "closed", approvedVersionId: ids.olderVersion },
          [ids.draft]: { status: "closed", approvedVersionId: versionId },
        },
        versions: {
          [ids.olderVersion]: { status: "superseded", supersededBy: versionId },
          [versionId]: { status: "revoked", previousStatus: "active", approval: { reviewedHash: expectedSemanticHash }, revocation: { reason: "No longer needed" } },
        },
      },
    });
  });
});
