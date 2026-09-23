import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FsBeaconStore } from "../../src/adapters/fs-beacon-store/index.js";
import { FsCaptureStore } from "../../src/adapters/fs-capture-store/index.js";
import { FsProjectContextStore } from "../../src/adapters/fs-project-context-store/index.js";
import { JcsSha256Hasher } from "../../src/adapters/hashing/index.js";
import { AjvContractValidator } from "../../src/adapters/validation/ajv-contract-validator.js";
import {
  AnnotateCapture,
  InitializeProject,
  InspectBeaconDraft,
  RecordCapture,
} from "../../src/application/index.js";
import { createComposition, createUnregisteredCommandSet } from "../../src/cli/composition.js";
import { createProgram } from "../../src/cli/program.js";
import type { BeaconStore, Recorder, SensitivityScanner } from "../../src/domain/ports/index.js";
import { ok } from "../../src/shared/result.js";
import { validAnnotation } from "../fixtures/capture-annotation.js";

const ids = {
  project: "proj_018f47de-7a00-7cc0-8000-000000000001",
  capture: "cap_018f47de-7a00-7cc0-8000-000000000001",
  beacon: "bcn_018f47de-7a00-7cc0-8000-000000000001",
  draft: "drf_018f47de-7a00-7cc0-8000-000000000001",
  version: "ver_018f47de-7a00-7cc0-8000-000000000001",
  initRequest: "req_018f47de-7a00-7cc0-8000-000000000001",
  recordRequest: "req_018f47de-7a00-7cc0-8000-000000000002",
  annotateRequest: "req_018f47de-7a00-7cc0-8000-000000000003",
} as const;
const timestamp = "2026-03-06T00:00:00.000Z";
let root: string;

class FakeRecorder implements Recorder {
  constructor(private readonly projectRoot: string) {}

  async start(command: Parameters<Recorder["start"]>[0]) {
    const bytes = "test-local supporting recorder output";
    await writeFile(
      join(this.projectRoot, "capture-staging", command.captureId, "recording.spec.ts"),
      bytes,
    );
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

function inputFile(name: string): string {
  return join(root, name);
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

function compositionFactory(target: string, crashAfterDraft: { armed: boolean }) {
  return (pharosHome?: string) => createComposition({
    pharosHome: pharosHome ?? join(root, "pharos-home"),
    currentPath: async () => target,
    createAdapters: (home) => {
      const hasher = new JcsSha256Hasher();
      const projects = new FsProjectContextStore({ home });
      const projectRoot = join(home, "store", ids.project);
      const captures = new FsCaptureStore({ projectRoot });
      const durableBeacons = new FsBeaconStore({ projectRoot, hasher });
      const beaconStore: BeaconStore = crashAfterDraft.armed
        ? {
            async createDraft(...args: Parameters<BeaconStore["createDraft"]>) {
              await durableBeacons.createDraft(...args);
              crashAfterDraft.armed = false;
              throw new Error("test crash after durable draft creation");
            },
            getBeacon: (...args: Parameters<BeaconStore["getBeacon"]>) => durableBeacons.getBeacon(...args),
          } as unknown as BeaconStore
        : durableBeacons;
      const generatedIds = {
        next(kind: "project" | "capture" | "beacon" | "draft" | "request") {
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
              captureStore: captures, beaconStore, validator: new AjvContractValidator(), resolver,
            }),
            inspect: new InspectBeaconDraft({ captureStore: captures, beaconStore: durableBeacons, hasher }),
          };
        },
      };
    },
  });
}

async function invoke(
  args: readonly string[],
  target: string,
  crashAfterDraft: { armed: boolean },
): Promise<{ readonly exitCode: number; readonly envelope: Record<string, unknown> }> {
  const stdout: string[] = [];
  let exitCode = -1;
  const writers = { writeOut: (text: string) => stdout.push(text), writeErr: () => {} };
  const setExitCode = (code: number) => { exitCode = code; };
  const commands = createUnregisteredCommandSet({
    createComposition: compositionFactory(target, crashAfterDraft),
    ids: { next: (kind) => kind === "request" ? ids.annotateRequest : ids[kind] },
    stdin: (async function* () {})(),
    stdinIsTty: false,
    initPrompt: { async prompt() { throw new Error("test does not prompt"); } },
    annotationPrompt: { async prompt() { throw new Error("test does not prompt"); } },
    isInteractiveTerminal: () => true,
    writers,
    setExitCode,
  });
  const program = createProgram(commands, { version: "0.0.0", ...writers, setExitCode });
  await program.parseAsync(["node", "pharos", ...args]);
  return { exitCode, envelope: JSON.parse(stdout.join("")) as Record<string, unknown> };
}

async function initialize(target: string, crashAfterDraft: { armed: boolean }): Promise<void> {
  const file = inputFile("project-init.json");
  await writeFile(file, JSON.stringify(projectInput(target)));
  const result = await invoke(["init", "--format", "json", "--non-interactive", "--input", file, "--request-id", ids.initRequest], target, crashAfterDraft);
  expect(result).toMatchObject({ exitCode: 0, envelope: { outcome: "succeeded", data: { project_id: ids.project } } });
}

async function record(
  target: string,
  crashAfterDraft: { armed: boolean },
  declaration: "source" | "none" = "source",
): Promise<void> {
  const declarationArgs = declaration === "none"
    ? ["--no-secret-sources"]
    : ["--secret-source", "env:CHECKOUT_TOKEN"];
  const result = await invoke(["capture", "record", "--format", "json", ...declarationArgs, "--request-id", ids.recordRequest], target, crashAfterDraft);
  expect(result).toMatchObject({ exitCode: 0, envelope: { outcome: "succeeded", data: { capture_id: ids.capture, status: "promoted" } } });
}

async function annotate(
  target: string,
  crashAfterDraft: { armed: boolean },
  annotation: unknown = validAnnotation,
) {
  const file = inputFile("annotation.json");
  await writeFile(file, JSON.stringify(annotation));
  return invoke(["capture", "annotate", ids.capture, "--format", "json", "--non-interactive", "--input", file, "--request-id", ids.annotateRequest], target, crashAfterDraft);
}

afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("guided Beacon capture program", () => {
  it("creates one authoritative open draft from a supporting promoted capture and inspects both authority levels", async () => {
    root = await mkdtemp(join(tmpdir(), "pharos-guided-program-"));
    const target = join(root, "non-production-target");
    await mkdir(target);
    const crashAfterDraft = { armed: false };
    await initialize(target, crashAfterDraft);

    const home = join(root, "pharos-home");
    const hasher = new JcsSha256Hasher();
    const beacons = new FsBeaconStore({ projectRoot: join(home, "store", ids.project), hasher });
    await expect(beacons.listBeacons()).resolves.toMatchObject({ ok: true, value: [] });

    await record(target, crashAfterDraft, "none");
    await expect(beacons.listBeacons()).resolves.toMatchObject({ ok: true, value: [] });

    const created = await annotate(target, crashAfterDraft, { ...validAnnotation, variables: [] });
    expect(created).toMatchObject({
      exitCode: 0,
      envelope: {
        outcome: "succeeded",
        data: {
          beacon_id: ids.beacon,
          draft_id: ids.draft,
          revision: 1,
          status: "open",
          semantic_hash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
          capture_id: ids.capture,
        },
      },
    });
    const annotationHash = (created.envelope.data as { readonly semantic_hash: string }).semantic_hash;
    const listed = await beacons.listBeacons();
    expect(listed).toMatchObject({ ok: true, value: [{ beaconId: ids.beacon, drafts: { [ids.draft]: { revision: 1, status: "open" } } }] });

    const inspected = await invoke(["beacon", "inspect", ids.beacon, "--format", "json"], target, crashAfterDraft);
    expect(inspected).toMatchObject({
      exitCode: 0,
      envelope: {
        outcome: "succeeded",
        data: {
          beacon: {
            authority: "authoritative",
            beaconId: ids.beacon,
            revision: 1,
            status: "open",
            semanticHash: annotationHash,
          },
          capture: { authority: "supporting-non-authoritative", captureId: ids.capture },
        },
      },
    });
  });

  it("refuses unknown captures and converges a crash plus retries to one draft", async () => {
    root = await mkdtemp(join(tmpdir(), "pharos-guided-program-"));
    const target = join(root, "non-production-target");
    await mkdir(target);
    const crashAfterDraft = { armed: false };
    await initialize(target, crashAfterDraft);

    const refusalFile = inputFile("annotation.json");
    await writeFile(refusalFile, JSON.stringify(validAnnotation));
    const refusal = await invoke(["capture", "annotate", "cap_018f47de-7a00-7cc0-8000-000000000099", "--format", "json", "--non-interactive", "--input", refusalFile, "--request-id", ids.annotateRequest], target, crashAfterDraft);
    expect(refusal).toMatchObject({ exitCode: 3, envelope: { outcome: "refused", errors: [{ rule: "capture-not-found" }] } });

    await record(target, crashAfterDraft);
    crashAfterDraft.armed = true;
    await expect(annotate(target, crashAfterDraft)).resolves.toMatchObject({ exitCode: 10, envelope: { outcome: "failed", errors: [{ rule: "internal-error" }] } });
    const recovered = await annotate(target, crashAfterDraft);
    const replay = await annotate(target, crashAfterDraft);
    expect(recovered).toMatchObject({ exitCode: 0, envelope: { data: { beacon_id: ids.beacon, draft_id: ids.draft, revision: 1, status: "open" } } });
    expect(replay).toMatchObject({ exitCode: 0, envelope: { data: { beacon_id: ids.beacon, draft_id: ids.draft, revision: 1, status: "open" } } });
    const recoveredHash = (recovered.envelope.data as { readonly semantic_hash: string }).semantic_hash;
    const replayHash = (replay.envelope.data as { readonly semantic_hash: string }).semantic_hash;
    expect(recoveredHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(replayHash).toBe(recoveredHash);

    const inspected = await invoke(["beacon", "inspect", ids.beacon, "--format", "json"], target, crashAfterDraft);
    expect(inspected).toMatchObject({
      exitCode: 0,
      envelope: { data: { beacon: { semanticHash: recoveredHash } } },
    });

    const beacons = new FsBeaconStore({ projectRoot: join(root, "pharos-home", "store", ids.project), hasher: new JcsSha256Hasher() });
    await expect(beacons.listBeacons()).resolves.toMatchObject({ ok: true, value: [{ beaconId: ids.beacon }] });
  });
});
