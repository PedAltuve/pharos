import { randomUUID } from "node:crypto";
import { Command } from "commander";
import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  AnnotateCapture,
  ApproveBeaconDraft,
  BeaconStatus,
  InitializeProject,
  InspectBeaconDraft,
  RecordCapture,
  RevokeActiveBeacon,
} from "../application/index.js";
import type {
  AnnotateCaptureRequest,
  AnnotateCaptureRefusal,
  AnnotatedCapture,
  ApproveBeaconDraftRequest,
  ApproveBeaconDraftRefusal,
  ApprovedBeaconDraft,
  InitializeProjectRequest,
  InitializedProject,
  InspectBeaconDraftRequest,
  InspectBeaconDraftRefusal,
  InspectedBeaconDraft,
  RecordCaptureRefusal,
  RecordCaptureRequest,
  RecordedCapture,
  RevokeActiveBeaconRequest,
  RevokeActiveBeaconRefusal,
  RevokedActiveBeacon,
} from "../application/index.js";
import { FsBeaconStore } from "../adapters/fs-beacon-store/index.js";
import { FsCaptureStore } from "../adapters/fs-capture-store/index.js";
import { resolvePharosHome } from "../adapters/fs-project/index.js";
import { FsProjectContextStore } from "../adapters/fs-project-context-store/index.js";
import { JcsSha256Hasher } from "../adapters/hashing/index.js";
import { PlaywrightRecorder } from "../adapters/playwright/playwright-recorder.js";
import { EnvSecretResolver } from "../adapters/secret-resolution/env-secret-resolver.js";
import { LiteralSensitivityScanner } from "../adapters/sensitivity/literal-sensitivity-scanner.js";
import { AjvContractValidator } from "../adapters/validation/ajv-contract-validator.js";
import { buildBeaconApproveCommand } from "./commands/beacon-approve.js";
import { buildBeaconInspectCommand } from "./commands/beacon-inspect.js";
import { buildBeaconRevokeCommand } from "./commands/beacon-revoke.js";
import { buildCaptureAnnotateCommand } from "./commands/capture-annotate.js";
import { buildCaptureRecordCommand } from "./commands/capture-record.js";
import { buildInitCommand } from "./commands/init.js";
import { buildStatusCommand } from "./commands/status.js";
import type { CliCommandWriters } from "./commands/shared.js";
import { beaconLifecyclePrompt, captureAnnotationPrompt, projectInitPrompt } from "./prompts/clack.js";
import { createGuidedInputAdapter, type BeaconLifecyclePrompt, type InputPrompt } from "./prompts/input.js";
import type { CancellationSignal, IdGenerator } from "../domain/ports/index.js";
import type { ProjectContext, ProjectContextRefusal, ProjectId } from "../domain/project/index.js";
import type { Result } from "../shared/result.js";

export interface InitializeAdapter {
  execute(request: InitializeProjectRequest): Promise<Result<InitializedProject, ProjectContextRefusal>>;
}
export interface RecordAdapter {
  execute(request: RecordCaptureRequest): Promise<Result<RecordedCapture, RecordCaptureRefusal>>;
}
export interface AnnotateAdapter {
  execute(request: AnnotateCaptureRequest): Promise<Result<AnnotatedCapture, AnnotateCaptureRefusal>>;
}
export interface InspectAdapter {
  execute(request: InspectBeaconDraftRequest): Promise<Result<InspectedBeaconDraft, InspectBeaconDraftRefusal>>;
}
export interface ApproveAdapter {
  execute(request: ApproveBeaconDraftRequest): Promise<Result<ApprovedBeaconDraft, ApproveBeaconDraftRefusal>>;
}
export type StatusAdapter = Pick<BeaconStatus, "execute">;
export interface RevokeAdapter {
  execute(request: RevokeActiveBeaconRequest): Promise<Result<RevokedActiveBeacon, RevokeActiveBeaconRefusal>>;
}

export interface ProjectScopedAdapters {
  readonly record: RecordAdapter;
  readonly annotate: AnnotateAdapter;
  readonly inspect: InspectAdapter;
  readonly approve?: ApproveAdapter;
  readonly status?: StatusAdapter;
  readonly revoke?: RevokeAdapter;
}

export interface CliCompositionAdapters {
  readonly resolveProject: (projectId?: ProjectId) => Promise<Result<ProjectContext, ProjectContextRefusal>>;
  readonly initialize: InitializeAdapter;
  readonly forProject?: (project: ProjectContext) => ProjectScopedAdapters;
}

export interface CliCompositionOptions {
  readonly pharosHome?: string;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly platform?: NodeJS.Platform;
  readonly homeDirectory?: string;
  readonly currentPath?: () => Promise<string>;
  readonly resolveHome?: () => Result<string, { readonly rule: "invalid-pharos-home" } | { readonly rule: "unsupported-platform" }>;
  readonly createAdapters?: (home: string) => CliCompositionAdapters;
}

export interface CliComposition {
  readonly initialize: InitializeAdapter | undefined;
  homeResolution(): Result<undefined, { readonly rule: string }>;
  resolveProject(projectId?: ProjectId): Promise<Result<ProjectContext, { readonly rule: string }>>;
  forProject(project: ProjectContext): ProjectScopedAdapters | undefined;
}

const clock = { now: () => new Date() };
const noCancellation = { aborted: false, onAbort: () => () => {} };

function generatedId(kind: "project" | "capture" | "beacon" | "draft" | "version" | "request"): string {
  const uuid = randomUUID().replace(/^(.{14})./, "$17");
  const prefix = { project: "proj", capture: "cap", beacon: "bcn", draft: "drf", version: "ver", request: "req" }[kind];
  return `${prefix}_${uuid}`;
}

function productionAdapters(home: string, currentPath: () => Promise<string>): CliCompositionAdapters {
  const hasher = new JcsSha256Hasher();
  const projects = new FsProjectContextStore({ home });
  const ids = { next: generatedId };
  const resolver = new EnvSecretResolver();
  const initialize = new InitializeProject({ clock, ids, store: projects, hasher });

  return {
    initialize,
    async resolveProject(projectId) {
      const canonicalCurrentPath = await realpath(await currentPath());
      return projectId === undefined
        ? projects.resolveByPath(canonicalCurrentPath)
        : projects.resolveById(projectId, canonicalCurrentPath);
    },
    forProject(project) {
      const projectRoot = join(home, "store", project.projectId);
      const captureStore = new FsCaptureStore({ projectRoot });
      const beaconStore = new FsBeaconStore({ projectRoot, hasher });
      return {
        record: new RecordCapture({
          clock, ids, hasher, store: captureStore, resolver,
          recorder: new PlaywrightRecorder({ projectRoot }),
          scanner: new LiteralSensitivityScanner({ projectRoot }),
        }),
        annotate: new AnnotateCapture({
          clock, ids, hasher, captureStore, beaconStore,
          validator: new AjvContractValidator(), resolver,
        }),
        inspect: new InspectBeaconDraft({ captureStore, beaconStore, hasher }),
        approve: new ApproveBeaconDraft({ clock, ids, hasher, captureStore, beaconStore }),
        status: new BeaconStatus({ beaconStore }),
        revoke: new RevokeActiveBeacon({ clock, beaconStore }),
      };
    },
  };
}

/** Builds CLI-owned adapters once while keeping its resolved home private. */
export function createComposition(options: CliCompositionOptions = {}): CliComposition {
  const currentPath = options.currentPath ?? (async () => process.cwd());
  const homeResult = options.resolveHome?.() ?? resolvePharosHome({
    override: options.pharosHome,
    environment: options.environment ?? process.env,
    platform: options.platform ?? process.platform,
    homeDirectory: options.homeDirectory ?? homedir(),
  });
  const homeFailure = homeResult.ok ? undefined : homeResult.error;
  const adapters = homeResult.ok
    ? (options.createAdapters ?? ((home: string) => productionAdapters(home, currentPath)))(homeResult.value)
    : undefined;

  return {
    initialize: adapters?.initialize,
    homeResolution: () => homeFailure === undefined ? { ok: true, value: undefined } : { ok: false, error: homeFailure },
    async resolveProject(projectId) {
      if (adapters !== undefined) return adapters.resolveProject(projectId);
      return { ok: false, error: homeFailure ?? { rule: "invalid-pharos-home" } };
    },
    forProject(project) {
      return adapters?.forProject?.(project);
    },
  };
}

export interface UnregisteredCommandSet {
  /** A private holder only; it intentionally has no registered product commands. */
  readonly root: Command;
  readonly init: Command;
  readonly captureRecord: Command;
  readonly captureAnnotate: Command;
  readonly beaconInspect: Command;
  readonly beaconApprove: Command;
  readonly beaconRevoke: Command;
  readonly status: Command;
}

export interface UnregisteredCommandSetOptions {
  readonly createComposition?: (pharosHome?: string) => CliComposition;
  readonly ids?: Pick<IdGenerator, "next">;
  readonly signal?: CancellationSignal;
  readonly stdin?: AsyncIterable<string | Uint8Array>;
  readonly stdinIsTty?: boolean;
  readonly initPrompt?: InputPrompt<unknown>;
  readonly annotationPrompt?: InputPrompt<unknown>;
  readonly lifecyclePrompt?: BeaconLifecyclePrompt;
  readonly isInteractiveTerminal?: () => boolean;
  readonly writers?: CliCommandWriters;
  readonly setExitCode?: (code: number) => void;
}

/**
 * Creates usable but deliberately unregistered builders. Each action resolves a
 * fresh composition after parsing --pharos-home, so an override cannot reuse
 * adapters rooted at the default home.
 */
export function createUnregisteredCommandSet(options: UnregisteredCommandSetOptions = {}): UnregisteredCommandSet {
  const compositionFor = options.createComposition ?? ((pharosHome?: string) => createComposition({ pharosHome }));
  const input = createGuidedInputAdapter({
    stdin: options.stdin ?? process.stdin,
    stdinIsTty: options.stdinIsTty ?? Boolean(process.stdin.isTTY),
    initPrompt: options.initPrompt ?? projectInitPrompt(),
    annotationPrompt: options.annotationPrompt ?? captureAnnotationPrompt(),
  });
  const ids = options.ids ?? { next: generatedId };
  const lifecyclePrompt = options.lifecyclePrompt ?? beaconLifecyclePrompt();
  const isInteractiveTerminal = options.isInteractiveTerminal ?? (() => Boolean(process.stdin.isTTY && process.stdout.isTTY));
  let active: CliComposition | undefined;
  const runtime = {
    writers: options.writers,
    setExitCode: options.setExitCode,
    homeResolution(override?: string) {
      active = compositionFor(override);
      return active.homeResolution();
    },
  };
  const resolveProject = async (projectId?: ProjectId) => {
    if (active === undefined) return { ok: false as const, error: { rule: "invalid-pharos-home" } };
    return active.resolveProject(projectId);
  };
  const requireInitialize = () => {
    if (active?.initialize === undefined) throw new Error("Composition did not supply initialization");
    return active.initialize;
  };
  const requireScoped = (project: ProjectContext) => {
    const scoped = active?.forProject(project);
    if (scoped === undefined) throw new Error("Composition did not supply project adapters");
    return scoped;
  };
  const init = buildInitCommand({ ...runtime, ids, input, initialize: { execute: (request) => requireInitialize().execute(request) } });
  const captureRecord = buildCaptureRecordCommand({
    ...runtime,
    ids,
    signal: options.signal ?? noCancellation,
    isInteractiveTerminal,
    resolveProject,
    record: { execute: () => { throw new Error("Project context must be selected before record dispatch"); } },
    recordForProject: (project) => requireScoped(project).record,
  });
  const captureAnnotate = buildCaptureAnnotateCommand({
    ...runtime,
    ids,
    input,
    resolveProject,
    annotate: { execute: () => { throw new Error("Project context must be selected before annotation dispatch"); } },
    annotateForProject: (project) => requireScoped(project).annotate,
  });
  const beaconInspect = buildBeaconInspectCommand({
    ...runtime,
    resolveProject,
    inspect: { execute: () => { throw new Error("Project context must be selected before inspection dispatch"); } },
    inspectForProject: (project) => requireScoped(project).inspect,
  });
  const requireApprove = (project: ProjectContext) => {
    const approve = requireScoped(project).approve;
    if (approve === undefined) throw new Error("Composition did not supply approval adapters");
    return approve;
  };
  const requireStatus = (project: ProjectContext) => {
    const status = requireScoped(project).status;
    if (status === undefined) throw new Error("Composition did not supply status adapters");
    return status;
  };
  const requireRevoke = (project: ProjectContext) => {
    const revoke = requireScoped(project).revoke;
    if (revoke === undefined) throw new Error("Composition did not supply revocation adapters");
    return revoke;
  };
  const beaconApprove = buildBeaconApproveCommand({
    ...runtime,
    ids,
    isInteractiveTerminal,
    prompt: lifecyclePrompt,
    resolveProject,
    inspect: { execute: () => { throw new Error("Project context must be selected before inspection dispatch"); } },
    inspectForProject: (project) => requireScoped(project).inspect,
    approve: { execute: () => { throw new Error("Project context must be selected before approval dispatch"); } },
    approveForProject: requireApprove,
  });
  const beaconRevoke = buildBeaconRevokeCommand({
    ...runtime,
    ids,
    isInteractiveTerminal,
    prompt: lifecyclePrompt,
    resolveProject,
    status: { execute: () => { throw new Error("Project context must be selected before status dispatch"); } },
    statusForProject: requireStatus,
    revoke: { execute: () => { throw new Error("Project context must be selected before revocation dispatch"); } },
    revokeForProject: requireRevoke,
  });
  const status = buildStatusCommand({
    ...runtime,
    resolveProject,
    status: { execute: () => { throw new Error("Project context must be selected before status dispatch"); } },
    statusForProject: requireStatus,
  });
  return { root: new Command("pharos"), init, captureRecord, captureAnnotate, beaconInspect, beaconApprove, beaconRevoke, status };
}

/**
 * Attaches the only public product grammar. Builders stay independently
 * composable for the in-process harness; production registration happens here
 * once, at the root-program boundary.
 */
export function registerGuidedJourney(root: Command, commands: UnregisteredCommandSet): void {
  const capture = new Command("capture")
    .description("Supporting capture commands")
    .action((_options: unknown, command: Command) => {
      command.error("missing capture command", {
        code: "commander.missingSubcommand",
        exitCode: 2,
      });
    })
    .addCommand(commands.captureRecord)
    .addCommand(commands.captureAnnotate);
  const beacon = new Command("beacon")
    .description("Beacon lifecycle commands")
    .action((_options: unknown, command: Command) => {
      command.error("missing Beacon command", {
        code: "commander.missingSubcommand",
        exitCode: 2,
      });
    })
    .addCommand(commands.beaconInspect)
    .addCommand(commands.beaconApprove)
    .addCommand(commands.beaconRevoke);

  root.addCommand(commands.init).addCommand(capture).addCommand(beacon).addCommand(commands.status);
}

export { noCancellation };
