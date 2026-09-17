import { spawn as spawnChild, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import type { Recorder, RecordCaptureCommand, RecorderResult, RecorderRun } from "../../domain/ports/recorder.js";

const require = createRequire(import.meta.url);
const RECORDING = "recording.spec.ts";

type RecorderStdio = "inherit" | ["inherit", "ignore", "inherit"];
type RecorderSignal = "SIGINT" | "SIGTERM" | "SIGKILL";
type RecorderExit = { readonly code: number | null; readonly signal: string | null };
type ExitObservation = { readonly kind: "exit"; readonly value: RecorderExit } | { readonly kind: "failure" };
type StopReason = "operator" | "unpersisted";

export interface RecorderProcess {
  readonly pid: number | undefined;
  kill(signal: RecorderSignal): void;
  waitForExit(): Promise<RecorderExit>;
}
export interface RecorderDelay {
  readonly elapsed: Promise<void>;
  dispose(): void;
}
export type RecorderSpawn = (executable: string, arguments_: readonly string[], options: { readonly shell: false; readonly stdio: RecorderStdio }) => RecorderProcess;
export interface PlaywrightRecorderOptions {
  readonly projectRoot: string;
  readonly resolveCli?: () => Promise<string>;
  readonly spawn?: RecorderSpawn;
  readonly probeProcess?: (pid: number) => boolean;
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

function nodeSpawn(executable: string, arguments_: readonly string[], options: { readonly shell: false; readonly stdio: RecorderStdio }): RecorderProcess {
  const child: ChildProcess = options.stdio === "inherit"
    ? spawnChild(executable, arguments_, { shell: false, stdio: "inherit" })
    : spawnChild(executable, arguments_, { shell: false, stdio: ["inherit", "ignore", "inherit"] });
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

function processAppearsActive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
    return code !== "ESRCH";
  }
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
  stop(): void {}
}

class OwnedRecorderRun implements RecorderRun {
  readonly evidence: { readonly pid: number } | undefined;
  private readonly stopped: Promise<void>;
  private readonly complete: Promise<RecorderResult>;
  private notifyStop!: () => void;
  private stopReason: StopReason | undefined;
  private exitObservation: ExitObservation | undefined;
  private stopPrecedesExit = false;
  private signalsSent = 0;

  constructor(
    private readonly child: RecorderProcess,
    private readonly delay: (milliseconds: number) => RecorderDelay,
    private readonly graceMs: number,
  ) {
    this.evidence = isSafePid(child.pid) ? { pid: child.pid } : undefined;
    this.stopped = new Promise((resolveStop) => { this.notifyStop = resolveStop; });
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

  stop(): void {
    this.requestStop(this.evidence === undefined ? "unpersisted" : "operator");
  }

  stopForUnpersistedEvidence(): void {
    this.requestStop("unpersisted");
  }

  waitForCompletion(): Promise<RecorderResult> {
    return this.complete;
  }

  private requestStop(reason: StopReason): void {
    if (this.stopReason !== undefined) return;
    this.stopReason = reason;
    queueMicrotask(() => {
      this.stopPrecedesExit = this.exitObservation?.kind !== "exit";
      if (this.stopPrecedesExit) this.sendNextSignal();
      this.notifyStop();
    });
  }

  private async observe(exit: Promise<ExitObservation>): Promise<RecorderResult> {
    const first = await Promise.race([exit, this.stopped.then(() => undefined)]);
    if (first !== undefined) {
      if (first.kind === "failure") return await this.resultForFailedObservation();
      return this.resultFor(first);
    }
    while (true) {
      const observed = await this.waitForExitOrGrace(exit);
      if (observed !== undefined) {
        if (observed.kind === "failure") return await this.resultForFailedObservation();
        return this.resultFor(observed);
      }
      if (this.signalsSent >= 3) return { kind: "process-still-active" };
      this.sendNextSignal();
    }
  }

  private sendNextSignal(): void {
    const signal = ["SIGINT", "SIGTERM", "SIGKILL"] as const;
    const next = signal[this.signalsSent++];
    if (next === undefined) return;
    try { this.child.kill(next); } catch { /* Continue bounded shutdown after a failed signal delivery. */ }
  }

  private resultFor(observation: Extract<ExitObservation, { readonly kind: "exit" }>): RecorderResult {
    if (this.stopReason === "unpersisted") return { kind: "unpersisted-process" };
    if (this.stopReason === "operator" && this.stopPrecedesExit) return { kind: "operator-cancelled" };
    return observation.value.signal === null
      ? { kind: "exited", exitCode: observation.value.code ?? 1 }
      : { kind: "signalled" };
  }

  private async resultForFailedObservation(): Promise<RecorderResult> {
    if (this.stopReason === "unpersisted") return await this.finishUnpersistedShutdown();
    if (this.stopReason === "operator") return await this.finishOperatorShutdown();
    return { kind: "process-still-active" };
  }

  private async finishUnpersistedShutdown(): Promise<RecorderResult> {
    while (this.signalsSent < 3) {
      await this.waitForGrace();
      this.sendNextSignal();
    }
    await this.waitForGrace();
    return { kind: "unpersisted-process" };
  }

  private async finishOperatorShutdown(): Promise<RecorderResult> {
    while (this.signalsSent < 3) {
      await this.waitForGrace();
      this.sendNextSignal();
    }
    await this.waitForGrace();
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
  private readonly probeProcess: (pid: number) => boolean;
  private readonly cancellationGraceMs: number;
  private readonly delay: (milliseconds: number) => RecorderDelay;

  constructor(private readonly options: PlaywrightRecorderOptions) {
    this.resolveCli = options.resolveCli ?? declaredPlaywrightCli;
    this.spawn = options.spawn ?? nodeSpawn;
    this.probeProcess = options.probeProcess ?? processAppearsActive;
    this.cancellationGraceMs = options.cancellationGraceMs ?? 1_000;
    this.delay = options.delay ?? nodeDelay;
  }

  async isProcessActive(evidence: { readonly pid: number }): Promise<boolean> {
    return this.probeProcess(evidence.pid);
  }

  async start(command: RecordCaptureCommand): Promise<RecorderRun> {
    if (command.signal.aborted) return new FinalizedRecorderRun({ kind: "operator-cancelled" });
    let cancellationRequested = false;
    let run: OwnedRecorderRun | undefined;
    const removeAbort = command.signal.onAbort(() => {
      cancellationRequested = true;
      run?.stop();
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
      const child = this.spawn(process.execPath, [
        cli, "codegen", "--browser", "chromium", "--output", this.stagedRecording(command.captureId), command.url,
      ], {
        shell: false,
        stdio: command.terminalMode === "human" ? "inherit" : ["inherit", "ignore", "inherit"],
      });
      run = new OwnedRecorderRun(child, this.delay, this.cancellationGraceMs);
      void run.waitForCompletion().then(removeAbort);
      if (cancellationRequested) run.stop();
      if (run.evidence === undefined) run.stopForUnpersistedEvidence();
      return run;
    } catch {
      removeAbort();
      return new FinalizedRecorderRun({ kind: "prerequisite-or-process-failure" });
    }
  }

  async record(command: RecordCaptureCommand): Promise<RecorderResult> {
    return await (await this.start(command)).waitForCompletion();
  }

  private stagedRecording(captureId: string): string {
    return resolve(this.options.projectRoot, "capture-staging", captureId, RECORDING);
  }
}
