import { spawn as spawnChild, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import type { Recorder, RecordCaptureCommand } from "../../domain/ports/recorder.js";

const require = createRequire(import.meta.url);
const RECORDING = "recording.spec.ts";

type RecorderStdio = "inherit" | ["inherit", "ignore", "inherit"];

export interface RecorderProcess {
  kill(signal: "SIGINT"): void;
  waitForExit(): Promise<{ readonly code: number | null; readonly signal: string | null }>;
}
export type RecorderSpawn = (executable: string, arguments_: readonly string[], options: { readonly shell: false; readonly stdio: RecorderStdio }) => RecorderProcess;
export interface PlaywrightRecorderOptions {
  readonly projectRoot: string;
  readonly resolveCli?: () => Promise<string>;
  readonly spawn?: RecorderSpawn;
}

interface PackageManifest {
  readonly name: string;
  readonly bin?: string | Readonly<Record<string, string>>;
}

async function declaredPlaywrightCli(): Promise<string> {
  const manifestPath = require.resolve("playwright/package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as PackageManifest;
  const bin = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.playwright;
  if (manifest.name !== "playwright" || typeof bin !== "string") {
    throw new Error("direct Playwright package does not declare its public CLI");
  }
  return resolve(dirname(manifestPath), bin);
}

function nodeSpawn(executable: string, arguments_: readonly string[], options: { readonly shell: false; readonly stdio: RecorderStdio }): RecorderProcess {
  const child: ChildProcess = options.stdio === "inherit"
    ? spawnChild(executable, arguments_, { shell: false, stdio: "inherit" })
    : spawnChild(executable, arguments_, { shell: false, stdio: ["inherit", "ignore", "inherit"] });
  return {
    kill(signal) { child.kill(signal); },
    waitForExit() {
      return new Promise((resolveExit, reject) => {
        child.once("error", reject);
        child.once("exit", (code: number | null, signal: NodeJS.Signals | null) => resolveExit({ code, signal }));
      });
    },
  };
}

/** Runs only the direct package's documented codegen CLI; it never installs or downloads a browser. */
export class PlaywrightRecorder implements Recorder {
  private readonly resolveCli: () => Promise<string>;
  private readonly spawn: RecorderSpawn;

  constructor(private readonly options: PlaywrightRecorderOptions) {
    this.resolveCli = options.resolveCli ?? declaredPlaywrightCli;
    this.spawn = options.spawn ?? nodeSpawn;
  }

  async record(command: RecordCaptureCommand) {
    if (command.signal.aborted) return { kind: "interrupted" as const };
    try {
      const cli = await this.resolveCli();
      if (command.signal.aborted) return { kind: "interrupted" as const };
      let cancellationRequested = false;
      let child: RecorderProcess | undefined;
      const removeAbort = command.signal.onAbort?.(() => {
        cancellationRequested = true;
        child?.kill("SIGINT");
      });
      if (cancellationRequested || command.signal.aborted) {
        removeAbort?.();
        return { kind: "interrupted" as const };
      }
      try {
        child = this.spawn(process.execPath, [
          cli,
          "codegen",
          "--browser",
          "chromium",
          "--output",
          this.stagedRecording(command.captureId),
          command.url,
        ], {
          shell: false,
          stdio: command.terminalMode === "human" ? "inherit" : ["inherit", "ignore", "inherit"],
        });
        const exited = await child.waitForExit();
        return cancellationRequested || command.signal.aborted || exited.signal !== null
          ? { kind: "interrupted" as const }
          : { kind: "exited" as const, exitCode: exited.code ?? 1 };
      } finally {
        removeAbort?.();
      }
    } catch {
      return { kind: "prerequisite-or-process-failure" as const };
    }
  }

  private stagedRecording(captureId: string): string {
    return resolve(this.options.projectRoot, "capture-staging", captureId, RECORDING);
  }
}
