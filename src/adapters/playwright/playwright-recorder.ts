import { spawn as spawnChild, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { stagedRecordingPath } from "../capture-layout/index.js";
import type { Recorder, RecordCaptureCommand, RecorderResult, RecorderRun } from "../../domain/ports/recorder.js";
import type { RecorderProcessEvidence } from "../../domain/capture/types.js";
import { ProcessIdentityAdapter, RECORDER_OWNERSHIP_MARKER, type ProcessIdentityObservation, type ProcessProbe } from "./process-identity.js";

const require = createRequire(import.meta.url);

type RecorderStdio = "inherit" | ["inherit", "ignore", "inherit"];
type RecorderSignal = "SIGINT" | "SIGTERM" | "SIGKILL";
type RecorderExit = { readonly code: number | null; readonly signal: string | null };
type ExitObservation = { readonly kind: "exit"; readonly value: RecorderExit } | { readonly kind: "failure" };
type ShutdownReason = "operator" | "contain";

export interface RecorderProcess {
  readonly pid: number | undefined;
  kill(signal: RecorderSignal): void;
  waitForExit(): Promise<RecorderExit>;
}
export interface RecorderDelay {
  readonly elapsed: Promise<void>;
  dispose(): void;
}
export type RecorderSpawn = (executable: string, arguments_: readonly string[], options: { readonly shell: false; readonly stdio: RecorderStdio; readonly env: NodeJS.ProcessEnv }) => RecorderProcess;
export interface ProcessIdentity {
  observe(pid: number): Promise<ProcessIdentityObservation>;
  probe(evidence: RecorderProcessEvidence): Promise<ProcessProbe>;
}
export interface PlaywrightRecorderOptions {
  readonly projectRoot: string;
  readonly resolveCli?: () => Promise<string>;
  readonly spawn?: RecorderSpawn;
  readonly identity?: ProcessIdentity;
  readonly ownershipToken?: () => string;
  readonly cancellationGraceMs?: number;
  readonly delay?: (milliseconds: number) => RecorderDelay;
}

interface PackageManifest {
  readonly name: string;
  readonly bin?: string | Readonly<Record<string, string>>;
}

async function declaredPlaywrightCli(): Promise<string> {
  const manifestPath = require.resolve("playwright/package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as PackageManifest;
  const bin = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.playwright;
  if (manifest.name !== "playwright" || typeof bin !== "string") throw new Error("direct Playwright package does not declare its public CLI");
  return resolve(dirname(manifestPath), bin);
}

function nodeSpawn(executable: string, arguments_: readonly string[], options: { readonly shell: false; readonly stdio: RecorderStdio; readonly env: NodeJS.ProcessEnv }): RecorderProcess {
  const child: ChildProcess = options.stdio === "inherit"
    ? spawnChild(executable, arguments_, { shell: false, stdio: "inherit", env: options.env })
    : spawnChild(executable, arguments_, { shell: false, stdio: ["inherit", "ignore", "inherit"], env: options.env });
  return {
    pid: child.pid,
    kill(signal) { child.kill(signal); },
    waitForExit() {
      return new Promise((resolveExit, reject) => {
        child.once("error", reject);
        child.once("exit", (code: number | null, signal: NodeJS.Signals | null) => resolveExit({ code, signal }));
      });
    },
  };
}

function nodeDelay(milliseconds: number): RecorderDelay {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const elapsed = new Promise<void>((resolveElapsed) => { timeout = setTimeout(resolveElapsed, milliseconds); });
  return { elapsed, dispose() { if (timeout !== undefined) clearTimeout(timeout); } };
}

function isSafePid(value: number | undefined): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

class FinalizedRecorderRun implements RecorderRun {
  readonly evidence = undefined;
  constructor(private readonly result: RecorderResult) {}
  async waitForCompletion(): Promise<RecorderResult> { return this.result; }
  contain(): void {}
}

class OwnedRecorderRun implements RecorderRun {
  evidence: RecorderProcessEvidence | undefined;
  private readonly stopped: Promise<void>;
  private readonly complete: Promise<RecorderResult>;
  private notifyStop!: () => void;
  private shutdownReason: ShutdownReason | undefined;
  private exitObservation: ExitObservation | undefined;
  private stopPrecedesExit = false;
  private signalsSent = 0;

  constructor(
    private readonly child: RecorderProcess,
    private readonly delay: (milliseconds: number) => RecorderDelay,
    private readonly graceMs: number,
  ) {
    this.stopped = new Promise((resolveStop) => { this.notifyStop = resolveStop; });
    // This is deliberately attached before any process identity lookup.
    const exit = child.waitForExit().then(
      (value): ExitObservation => {
        const observation = { kind: "exit", value } as const;
        this.exitObservation = observation;
        return observation;
      },
      (): ExitObservation => {
        const observation = { kind: "failure" } as const;
        this.exitObservation = observation;
        return observation;
      },
    );
    this.complete = this.observe(exit);
  }

  setEvidence(evidence: RecorderProcessEvidence): void {
    this.evidence = evidence;
  }

  cancelByOperator(): void {
    this.requestShutdown("operator");
  }

  contain(): void {
    this.requestShutdown("contain");
  }

  waitForCompletion(): Promise<RecorderResult> {
    return this.complete;
  }

  private requestShutdown(reason: ShutdownReason): void {
    if (this.shutdownReason !== undefined) return;
    this.shutdownReason = reason;
    queueMicrotask(() => {
      // Preserve the observer's same-turn provenance before assigning containment.
      this.stopPrecedesExit = this.exitObservation?.kind !== "exit";
      if (this.stopPrecedesExit && isSafePid(this.child.pid)) this.sendNextSignal();
      this.notifyStop();
    });
  }

  private async observe(exit: Promise<ExitObservation>): Promise<RecorderResult> {
    const first = await Promise.race([exit, this.stopped.then(() => undefined)]);
    if (first !== undefined) {
      if (first.kind === "failure" && this.shutdownReason !== undefined && isSafePid(this.child.pid)) {
        return await this.finishFailedObservation();
      }
      return this.resultFor(first);
    }
    if (!isSafePid(this.child.pid)) {
      return this.exitObservation?.kind === "failure"
        ? { kind: "prerequisite-or-process-failure" }
        : { kind: "process-still-active" };
    }
    while (true) {
      const observed = await this.waitForExitOrGrace(exit);
      if (observed !== undefined) {
        if (observed.kind === "exit") return this.resultFor(observed);
        return await this.finishFailedObservation();
      }
      if (this.signalsSent >= 3) return { kind: "process-still-active" };
      this.sendNextSignal();
    }
  }

  private sendNextSignal(): void {
    const signal = ["SIGINT", "SIGTERM", "SIGKILL"] as const;
    const next = signal[this.signalsSent++];
    if (next === undefined) return;
    try { this.child.kill(next); } catch { /* Bounded containment still advances after failed delivery. */ }
  }

  private resultFor(observation: ExitObservation): RecorderResult {
    if (observation.kind === "failure") {
      if (!isSafePid(this.child.pid)) return { kind: "prerequisite-or-process-failure" };
      return { kind: "process-still-active" };
    }
    if (this.shutdownReason === "contain" && this.stopPrecedesExit) return { kind: "prerequisite-or-process-failure" };
    if (this.shutdownReason === "operator" && this.stopPrecedesExit) return { kind: "operator-cancelled" };
    return observation.value.signal === null
      ? { kind: "exited", exitCode: observation.value.code ?? 1 }
      : { kind: "signalled" };
  }

  private async finishFailedObservation(): Promise<RecorderResult> {
    if (!isSafePid(this.child.pid)) return { kind: "prerequisite-or-process-failure" };
    while (this.signalsSent < 3) {
      await this.waitForGrace();
      this.sendNextSignal();
    }
    // The observer already failed: a post-SIGKILL wait cannot prove exit.
    return { kind: "process-still-active" };
  }

  private async waitForExitOrGrace(exit: Promise<ExitObservation>): Promise<ExitObservation | undefined> {
    const delay = this.delay(this.graceMs);
    try {
      return await Promise.race([exit, delay.elapsed.then(() => undefined)]);
    } finally {
      delay.dispose();
    }
  }

  private async waitForGrace(): Promise<void> {
    const delay = this.delay(this.graceMs);
    try {
      await delay.elapsed;
    } finally {
      delay.dispose();
    }
  }
}

/** Runs only the direct package's documented codegen CLI; it never installs or downloads a browser. */
export class PlaywrightRecorder implements Recorder {
  private readonly resolveCli: () => Promise<string>;
  private readonly spawn: RecorderSpawn;
  private readonly identity: ProcessIdentity;
  private readonly ownershipToken: () => string;
  private readonly cancellationGraceMs: number;
  private readonly delay: (milliseconds: number) => RecorderDelay;

  constructor(private readonly options: PlaywrightRecorderOptions) {
    this.resolveCli = options.resolveCli ?? declaredPlaywrightCli;
    this.spawn = options.spawn ?? nodeSpawn;
    this.identity = options.identity ?? new ProcessIdentityAdapter();
    this.ownershipToken = options.ownershipToken ?? (() => randomBytes(32).toString("hex"));
    this.cancellationGraceMs = options.cancellationGraceMs ?? 1_000;
    this.delay = options.delay ?? nodeDelay;
  }

  async probeProcess(evidence: RecorderProcessEvidence): Promise<ProcessProbe> {
    return await this.identity.probe(evidence);
  }

  async start(command: RecordCaptureCommand): Promise<RecorderRun> {
    if (command.signal.aborted) return new FinalizedRecorderRun({ kind: "operator-cancelled" });
    let cancellationRequested = false;
    let run: OwnedRecorderRun | undefined;
    const removeAbort = command.signal.onAbort(() => {
      cancellationRequested = true;
      run?.cancelByOperator();
    });
    try {
      if (cancellationRequested || command.signal.aborted) {
        removeAbort();
        return new FinalizedRecorderRun({ kind: "operator-cancelled" });
      }
      const cli = await this.resolveCli();
      if (cancellationRequested || command.signal.aborted) {
        removeAbort();
        return new FinalizedRecorderRun({ kind: "operator-cancelled" });
      }
      const ownershipToken = this.ownershipToken();
      if (!/^[a-f0-9]{64}$/.test(ownershipToken)) {
        removeAbort();
        return new FinalizedRecorderRun({ kind: "prerequisite-or-process-failure" });
      }
      const child = this.spawn(process.execPath, [
        cli, "codegen", "--browser", "chromium", "--output", stagedRecordingPath(this.options.projectRoot, command.captureId), command.url,
      ], {
        shell: false,
        stdio: command.terminalMode === "human" ? "inherit" : ["inherit", "ignore", "inherit"],
        env: { ...process.env, [RECORDER_OWNERSHIP_MARKER]: ownershipToken },
      });
      run = new OwnedRecorderRun(child, this.delay, this.cancellationGraceMs);
      void run.waitForCompletion().finally(removeAbort);
      if (isSafePid(child.pid)) {
        const observed = await this.identity.observe(child.pid);
        if (observed.kind === "present") run.setEvidence({ pid: child.pid, identity: observed.identity });
        else if (observed.kind === "unknown") run.contain();
      }
      if (cancellationRequested) run.cancelByOperator();
      return run;
    } catch {
      if (run !== undefined) {
        run.contain();
        return run;
      }
      removeAbort();
      return new FinalizedRecorderRun({ kind: "prerequisite-or-process-failure" });
    }
  }

  async record(command: RecordCaptureCommand): Promise<RecorderResult> {
    return await (await this.start(command)).waitForCompletion();
  }
}
