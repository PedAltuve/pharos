import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { readFile as readFileNode } from "node:fs/promises";
import { promisify } from "node:util";
import type { RecorderProcessEvidence } from "../../domain/capture/types.js";

export type ProcessIdentityObservation =
  | { readonly kind: "present"; readonly identity: string }
  | { readonly kind: "absent" }
  | { readonly kind: "unknown" };
export type ProcessProbe = "same" | "absent" | "reused" | "unknown";
/** Adapter-internal child environment key; durable evidence contains only its fingerprint. */
export const RECORDER_OWNERSHIP_MARKER = "PHAROS_RECORDER_OWNERSHIP" as const;

export interface ProcessIdentityDependencies {
  readonly platform: string;
  readFile(path: string): Promise<string>;
  execFile(file: string, arguments_: readonly string[], options: { readonly env: { readonly LC_ALL: "C" } }): Promise<{ readonly stdout: string }>;
}

const execFile = promisify(execFileCallback);
const cLocale = { env: { LC_ALL: "C" } } as const;

function fingerprint(parts: readonly string[]): string {
  return createHash("sha256").update(parts.join("\n")).digest("hex");
}

function isErrno(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function linuxStartTicks(stat: string): string | undefined {
  const boundary = stat.lastIndexOf(")");
  if (boundary < 0) return undefined;
  const fields = stat.slice(boundary + 1).trim().split(/\s+/);
  // Field 3 is the first token after comm; starttime is field 22.
  const startTicks = fields[19];
  return startTicks !== undefined && /^\d+$/.test(startTicks) ? startTicks : undefined;
}

function macOwnershipToken(output: string): string | undefined {
  const matches = [...output.matchAll(new RegExp(`(?:^|\\s)${RECORDER_OWNERSHIP_MARKER}=([a-f0-9]{64})(?=\\s|$)`, "g"))];
  return matches.length === 1 ? matches[0]?.[1] : undefined;
}

function isMissingMacProcess(error: unknown): boolean {
  return typeof error === "object" && error !== null
    && "code" in error && error.code === 1
    && (!("stdout" in error) || String(error.stdout).trim() === "")
    && (!("stderr" in error) || String(error.stderr).trim() === "");
}

async function defaultExecFile(file: string, arguments_: readonly string[], options: { readonly env: { readonly LC_ALL: "C" } }): Promise<{ readonly stdout: string }> {
  const result = await execFile(file, arguments_ as string[], { env: { ...process.env, ...options.env } });
  return { stdout: String(result.stdout) };
}

function defaultDependencies(): ProcessIdentityDependencies {
  return {
    platform: process.platform,
    readFile: async (path) => await readFileNode(path, "utf8"),
    execFile: defaultExecFile,
  };
}

/** Node-only process identity boundary; its results remain adapter-neutral strings. */
export class ProcessIdentityAdapter {
  private readonly dependencies: ProcessIdentityDependencies;

  constructor(dependencies: ProcessIdentityDependencies = defaultDependencies()) {
    this.dependencies = dependencies;
  }

  async observe(pid: number): Promise<ProcessIdentityObservation> {
    if (!Number.isSafeInteger(pid) || pid <= 0) return { kind: "unknown" };
    if (this.dependencies.platform === "linux") return await this.observeLinux(pid);
    if (this.dependencies.platform === "darwin") return await this.observeMac(pid);
    return { kind: "unknown" };
  }

  async probe(evidence: RecorderProcessEvidence): Promise<ProcessProbe> {
    const observed = await this.observe(evidence.pid);
    if (observed.kind !== "present") return observed.kind;
    return observed.identity === evidence.identity ? "same" : "reused";
  }

  private async observeLinux(pid: number): Promise<ProcessIdentityObservation> {
    let stat: string;
    try {
      stat = await this.dependencies.readFile(`/proc/${pid}/stat`);
    } catch (error) {
      return isErrno(error, "ENOENT") ? { kind: "absent" } : { kind: "unknown" };
    }
    const startTicks = linuxStartTicks(stat);
    if (startTicks === undefined) return { kind: "unknown" };
    let bootId: string;
    try {
      bootId = (await this.dependencies.readFile("/proc/sys/kernel/random/boot_id")).trim().toLowerCase();
    } catch {
      return { kind: "unknown" };
    }
    return /^[0-9a-f-]{1,128}$/.test(bootId)
      ? { kind: "present", identity: fingerprint(["linux", bootId, startTicks]) }
      : { kind: "unknown" };
  }

  private async observeMac(pid: number): Promise<ProcessIdentityObservation> {
    let process: { readonly stdout: string };
    try {
      process = await this.dependencies.execFile("/bin/ps", ["eww", "-p", String(pid), "-o", "command="], cLocale);
    } catch (error) {
      return isMissingMacProcess(error) ? { kind: "absent" } : { kind: "unknown" };
    }
    const token = macOwnershipToken(process.stdout);
    return token === undefined
      ? { kind: "unknown" }
      : { kind: "present", identity: fingerprint(["darwin-token", token]) };
  }
}
