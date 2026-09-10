import { createRequire } from "node:module";
import { Command, CommanderError } from "commander";

export interface CliWriters {
  readonly writeOut: (text: string) => void;
  readonly writeErr: (text: string) => void;
}

export interface ProgramOptions extends Partial<CliWriters> {
  readonly version?: string;
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

export function createProgram(options: ProgramOptions = {}): Command {
  const writeOut = options.writeOut ?? defaultWriteOut;
  const writeErr = options.writeErr ?? defaultWriteErr;
  const version = options.version ?? loadPackageVersion();

  const program = new Command();
  program
    .name("pharos")
    .description("Pharos command-line interface (bootstrap surface).")
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
      writeOut(command.helpInformation());
    });

  return program;
}

export async function runCli(
  argv: readonly string[],
  options: ProgramOptions = {},
): Promise<number> {
  const program = createProgram(options);

  try {
    await program.parseAsync(argv as string[]);
    return 0;
  } catch (error) {
    if (error instanceof CommanderError) {
      return SUCCESS_COMMANDER_CODES.has(error.code) ? 0 : 2;
    }
    throw error;
  }
}
