import { createRequire } from "node:module";
import { Command, CommanderError } from "commander";
import { jsonEnvelope, refusalOutcome } from "./envelope.js";
import {
  createUnregisteredCommandSet,
  registerGuidedJourney,
  type UnregisteredCommandSet,
} from "./composition.js";

export interface CliWriters {
  readonly writeOut: (text: string) => void;
  readonly writeErr: (text: string) => void;
}

export interface ProgramOptions extends Partial<CliWriters> {
  readonly version?: string;
  /** Receives stable product outcomes without mutating process-global state. */
  readonly setExitCode?: (code: number) => void;
}

const require = createRequire(import.meta.url);

/** Commander exit codes normalized back to success by `runCli`. */
const SUCCESS_COMMANDER_CODES = new Set([
  "commander.helpDisplayed",
  "commander.version",
]);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function defaultWriteOut(text: string): void {
  process.stdout.write(text);
}

function defaultWriteErr(text: string): void {
  process.stderr.write(text);
}

export function loadPackageVersion(): string {
  const manifest: unknown = require("../../package.json");
  const version =
    typeof manifest === "object" && manifest !== null && "version" in manifest
      ? (manifest as { version: unknown }).version
      : undefined;

  if (!isNonEmptyString(version)) {
    throw new Error(
      "pharos: package.json does not declare a non-empty string version",
    );
  }
  return version;
}

/** Registers an already-composed command set; it does not select dependencies. */
export function createProgram(
  commands: UnregisteredCommandSet,
  options: ProgramOptions = {},
): Command {
  const writeOut = options.writeOut ?? defaultWriteOut;
  const writeErr = options.writeErr ?? defaultWriteErr;
  const version = options.version ?? loadPackageVersion();

  const program = new Command();
  program
    .name("pharos")
    .description("Pharos guided journey command-line interface.")
    .usage("[options]")
    .version(version)
    .configureOutput({
      writeOut,
      writeErr,
      outputError: (str, write) => write(str),
    })
    .exitOverride()
    .argument("[unsupportedCommand]")
    .action((unsupportedCommand: string | undefined, _options, command: Command) => {
      if (unsupportedCommand !== undefined) {
        command.error(`unknown command '${unsupportedCommand}'`, {
          code: "commander.unknownCommand",
          exitCode: 2,
        });
        return;
      }
      command.outputHelp();
    })
    .addHelpText("after", [
      "",
      "Supported guided journey:",
      "  pharos init",
      "  pharos capture record",
      "  pharos capture annotate <capture-id>",
      "  pharos beacon inspect <beacon-id>",
      "  pharos beacon prepare <approve|revoke> <beacon-id> --request-id <request-id> --format json",
      "  pharos beacon consent-status <request-id> --format json",
      "  pharos status <beacon-id>",
      "",
    ].join("\n"));
  registerGuidedJourney(program, commands);
  // Commander exit overrides are per-command, not inherited by nested parsers.
  const overrideNested = (command: Command): void => {
    for (const child of command.commands) {
      child.exitOverride();
      child.configureOutput({ writeOut, writeErr, outputError: (str, write) => write(str) });
      overrideNested(child);
    }
  };
  overrideNested(program);
  const beacon = program.commands.find((child) => child.name() === "beacon");
  beacon?.argument("[unsupportedCommand]").action((unsupportedCommand: string | undefined, _options, command: Command) => {
    command.error(unsupportedCommand === undefined ? "missing Beacon command" : `unknown command '${unsupportedCommand}'`, {
      code: unsupportedCommand === undefined ? "commander.missingSubcommand" : "commander.unknownCommand", exitCode: 2,
    });
  });

  return program;
}

export async function runCli(
  argv: readonly string[],
  options: ProgramOptions = {},
): Promise<number> {
  let productExitCode = 0;
  const jsonUsage = argv.some((arg, index) =>
    arg === "--format=json" || (arg === "--format" && argv[index + 1] === "json"));
  const nestedJsonUsage = jsonUsage && argv[2] === "beacon";
  const bufferedErrors: string[] = [];
  const writers = {
    writeOut: options.writeOut ?? defaultWriteOut,
    writeErr: (text: string) => { if (nestedJsonUsage) bufferedErrors.push(text); else (options.writeErr ?? defaultWriteErr)(text); },
  };
  const setExitCode = (code: number) => {
    productExitCode = code;
    options.setExitCode?.(code);
  };
  const commands = createUnregisteredCommandSet({ writers, setExitCode });
  const program = createProgram(commands, {
    version: options.version,
    ...writers,
    setExitCode,
  });

  try {
    await program.parseAsync(argv as string[]);
    return productExitCode;
  } catch (error) {
    if (error instanceof CommanderError) {
      if (nestedJsonUsage && !SUCCESS_COMMANDER_CODES.has(error.code)) {
        writers.writeOut(jsonEnvelope(refusalOutcome("beacon", { rule: "invalid-input" })));
      } else if (nestedJsonUsage) {
        for (const text of bufferedErrors) (options.writeErr ?? defaultWriteErr)(text);
      }
      return SUCCESS_COMMANDER_CODES.has(error.code) ? 0 : 2;
    }
    throw error;
  }
}
