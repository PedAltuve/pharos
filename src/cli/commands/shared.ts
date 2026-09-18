import { Command } from "commander";
import { exitCodeFor, type CliOutcome } from "../exit-codes.js";
import { internalOutcome, normalizeOutcome, renderOutcome, type CliRenderedOutcome } from "../envelope.js";
import type { Result } from "../../shared/result.js";

export interface CliCommandWriters {
  readonly writeOut: (text: string) => void;
  readonly writeErr: (text: string) => void;
}

export interface CommandRuntime {
  readonly writers?: CliCommandWriters;
  readonly setExitCode?: (code: number) => void;
  readonly homeResolution: (override?: string) => Result<undefined, { readonly rule: string }>;
}

export interface CommandInvocation {
  readonly arguments: readonly unknown[];
  readonly options: Readonly<Record<string, unknown>>;
}

const UUID_V7 = "[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const requestIdPattern = new RegExp(`^req_${UUID_V7}$`);
const beaconIdPattern = new RegExp(`^bcn_${UUID_V7}$`);

export function isRequestId(value: unknown): value is `req_${string}` {
  return typeof value === "string" && requestIdPattern.test(value);
}

export function isBeaconId(value: unknown): value is `bcn_${string}` {
  return typeof value === "string" && beaconIdPattern.test(value);
}

export function usageOutcome(command: string): CliRenderedOutcome {
  return {
    command,
    outcome: "refused",
    data: {},
    errors: [{ rule: "invalid-cli-usage", category: "validation", field: "/" }],
    nextAction: null,
  };
}

export function commonProductOptions(command: Command, projectScoped = true): Command {
  const configured = command
    .option("--format <format>", "human or json output", "human")
    .option("--pharos-home <absolute-path>", "private Pharos home override");
  return projectScoped ? configured.option("--project <project-id>", "stable Pharos project ID") : configured;
}

function formatFor(command: Command): "human" | "json" {
  return command.opts<{ readonly format?: unknown }>().format === "json" ? "json" : "human";
}

function exitFor(outcome: CliRenderedOutcome, internal: boolean): CliOutcome {
  if (internal || outcome.errors.some((error) => error.category === "internal")) return "internal";
  if (outcome.errors.some((error) => error.rule === "invalid-cli-usage")) return "usage";
  return outcome.outcome;
}

function hardJson(command: string): string {
  return `{"contract":"pharos.cli-envelope/1","command":"${command}","outcome":"failed","data":{},"errors":[{"rule":"internal-error","category":"internal","field":"/"}],"next_action":null}\n`;
}

function writeSafely(write: (text: string) => void, text: string): boolean {
  try { write(text); return true; } catch { return false; }
}

/** Total command boundary: all conversion, rendering, and writer failure becomes a safe internal result. */
export function bindExecution(
  command: Command,
  runtime: CommandRuntime,
  operation: (invocation: CommandInvocation) => Promise<CliRenderedOutcome>,
): Command {
  command.configureOutput({
    writeOut: runtime.writers?.writeOut ?? ((text: string) => process.stdout.write(text)),
    writeErr: () => {},
    outputError: () => {},
  });
  command.exitOverride((error) => {
    try {
      const rendered = renderOutcome(usageOutcome(command.name()), formatFor(command));
      const writeOut = runtime.writers?.writeOut ?? ((text: string) => process.stdout.write(text));
      const writeErr = runtime.writers?.writeErr ?? ((text: string) => process.stderr.write(text));
      if (rendered.stdout.length > 0) writeSafely(writeOut, rendered.stdout);
      if (rendered.stderr.length > 0) writeSafely(writeErr, rendered.stderr);
    } catch {
      // Grammar failures never expose Commander diagnostics or custom writer details.
    }
    try { (runtime.setExitCode ?? ((code: number) => { process.exitCode = code; }))(2); } catch { process.exitCode = 2; }
    throw error;
  });
  return command.action(async (...arguments_: unknown[]) => {
    let result: CliRenderedOutcome;
    let format: "human" | "json" = "human";
    let internal = false;
    try {
      format = formatFor(command);
      const invocation: CommandInvocation = { arguments: arguments_, options: command.opts() };
      if (invocation.options.format !== "human" && invocation.options.format !== "json") {
        result = usageOutcome(command.name());
      } else {
        result = await operation(invocation);
      }
      const normalized = normalizeOutcome(result);
      result = normalized.value;
      internal ||= normalized.internal;
      const rendered = renderOutcome(result, format);
      const writeOut = runtime.writers?.writeOut ?? ((text: string) => process.stdout.write(text));
      const writeErr = runtime.writers?.writeErr ?? ((text: string) => process.stderr.write(text));
      if (rendered.stdout.length > 0 && !writeSafely(writeOut, rendered.stdout)) throw new Error("stdout unavailable");
      if (rendered.stderr.length > 0 && !writeSafely(writeErr, rendered.stderr)) throw new Error("stderr unavailable");
    } catch {
      internal = true;
      result = internalOutcome(command.name());
      const writeOut = runtime.writers?.writeOut ?? ((text: string) => process.stdout.write(text));
      const writeErr = runtime.writers?.writeErr ?? ((text: string) => process.stderr.write(text));
      if (format === "json") {
        if (!writeSafely(writeOut, hardJson(command.name()))) process.stdout.write(hardJson(command.name()));
      } else if (!writeSafely(writeErr, "pharos: internal error\n")) {
        process.stderr.write("pharos: internal error\n");
      }
    }
    let exitCode = 10;
    try { exitCode = exitCodeFor(exitFor(result, internal)); } catch { /* Safe fallback remains exit 10. */ }
    try {
      (runtime.setExitCode ?? ((code: number) => { process.exitCode = code; }))(exitCode);
    } catch {
      process.exitCode = 10;
    }
  });
}

export function homeRefusal(command: string, runtime: CommandRuntime, override: unknown): CliRenderedOutcome | undefined {
  const home = runtime.homeResolution(typeof override === "string" ? override : undefined);
  return home.ok ? undefined : {
    command,
    outcome: "refused",
    data: {},
    errors: [{ rule: home.error.rule, category: "prerequisite", field: "/" }],
    nextAction: null,
  };
}
