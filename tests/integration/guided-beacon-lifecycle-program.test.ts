import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FsBeaconStore } from "../../src/adapters/fs-beacon-store/index.js";
import { FsCaptureStore } from "../../src/adapters/fs-capture-store/index.js";
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
        forProject() {
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
              clock: { now: () => new Date(timestamp) }, ids: generatedIds, hasher,
              captureStore: captures, beaconStore: beacons,
            }),
            status: new BeaconStatus({ beaconStore: beacons }),
            revoke: new RevokeActiveBeacon({
              clock: { now: () => new Date(timestamp) }, beaconStore: beacons,
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

    const approved = await invoke(["beacon", "approve", ids.beacon, "--format", "json", "--request-id", ids.approveRequest], target, lifecycle.prompt);
    expect(approved).toMatchObject({
      exitCode: 0,
      envelope: { outcome: "succeeded", data: { beacon_id: ids.beacon, version_id: ids.version, status: "active", assurance: "operator_confirmed", semantic_hash: expectedSemanticHash } },
    });
    expect(lifecycle.approvals).toEqual([{
      beaconId: ids.beacon, draftId: ids.draft, captureId: ids.capture, semanticHash: expectedSemanticHash,
    }]);

    const projectRoot = join(root, "pharos-home", "store", ids.project);
    const persistedApproval = await new FsBeaconStore({ projectRoot, hasher: new JcsSha256Hasher() }).getBeacon(ids.beacon);
    expect(persistedApproval).toMatchObject({
      ok: true,
      value: {
        activeVersionId: ids.version,
        drafts: { [ids.draft]: { status: "closed", approvedVersionId: ids.version } },
        versions: { [ids.version]: { status: "active", approval: { reviewedHash: expectedSemanticHash, assurance: "operator_confirmed" } } },
      },
    });

    const beforeActiveStatus = await snapshotFiles(projectRoot);
    const activeStatus = await invoke(["status", ids.beacon, "--format", "json"], target, lifecycle.prompt);
    const repeatedActiveStatus = await invoke(["status", ids.beacon, "--format", "json"], target, lifecycle.prompt);
    expect(activeStatus).toMatchObject({
      exitCode: 0,
      envelope: { outcome: "succeeded", data: { authority: "active-approved", active_version_id: ids.version, readiness: "unavailable", staleness: "unavailable", verification: "unavailable" } },
    });
    expect(repeatedActiveStatus).toEqual(activeStatus);
    await expect(snapshotFiles(projectRoot)).resolves.toEqual(beforeActiveStatus);

    const revoked = await invoke(["beacon", "revoke", ids.beacon, "--format", "json", "--request-id", ids.revokeRequest], target, lifecycle.prompt);
    expect(revoked).toMatchObject({
      exitCode: 0,
      envelope: { outcome: "succeeded", data: { beacon_id: ids.beacon, version_id: ids.version, status: "revoked" } },
    });
    expect(lifecycle.revocations).toEqual([{
      beaconId: ids.beacon, expectedActiveVersionId: ids.version, reason: "No longer needed",
    }]);

    const persistedRevocation = await new FsBeaconStore({ projectRoot, hasher: new JcsSha256Hasher() }).getBeacon(ids.beacon);
    expect(persistedRevocation).toMatchObject({
      ok: true,
      value: {
        activeVersionId: null,
        versions: { [ids.version]: { status: "revoked", approval: { reviewedHash: expectedSemanticHash }, revocation: { reason: "No longer needed" } } },
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

    const approved = await invoke(["beacon", "approve", ids.beacon, "--format", "json", "--request-id", ids.approveRequest], target, lifecycle.prompt);
    expect(approved).toMatchObject({
      exitCode: 0,
      envelope: { outcome: "succeeded", data: { beacon_id: ids.beacon, version_id: ids.version, status: "active", semantic_hash: expectedSemanticHash } },
    });
    expect(lifecycle.approvals).toEqual([{
      beaconId: ids.beacon, draftId: ids.draft, captureId: ids.capture, semanticHash: expectedSemanticHash,
    }]);

    await expect(invoke(["status", ids.beacon, "--format", "json"], target, lifecycle.prompt)).resolves.toMatchObject({
      exitCode: 0,
      envelope: { outcome: "succeeded", data: { authority: "active-approved", active_version_id: ids.version } },
    });
    await expect(invoke(["beacon", "revoke", ids.beacon, "--format", "json", "--request-id", ids.revokeRequest], target, lifecycle.prompt)).resolves.toMatchObject({
      exitCode: 0,
      envelope: { outcome: "succeeded", data: { beacon_id: ids.beacon, version_id: ids.version, status: "revoked" } },
    });
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
          [ids.draft]: { status: "closed", approvedVersionId: ids.version },
        },
        versions: {
          [ids.olderVersion]: { status: "superseded", supersededBy: ids.version },
          [ids.version]: { status: "revoked", previousStatus: "active", approval: { reviewedHash: expectedSemanticHash }, revocation: { reason: "No longer needed" } },
        },
      },
    });
  });
});
