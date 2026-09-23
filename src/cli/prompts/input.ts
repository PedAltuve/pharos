import { createReadStream } from "node:fs";
import { TextDecoder } from "node:util";
import { err, ok, type Result } from "../../shared/result.js";

export const MAX_INPUT_BYTES = 1024 * 1024;

export interface InvalidInput {
  readonly rule: "invalid-input";
  readonly category: "missing" | "tty" | "encoding" | "json" | "oversized" | "discriminator";
}

export interface ReadJsonInputOptions {
  readonly input: string;
  readonly stdin: AsyncIterable<string | Uint8Array>;
  readonly stdinIsTty: boolean;
  readonly maxBytes?: number;
  readonly expectedContract?: string;
  readonly openFile?: (path: string) => AsyncIterable<string | Uint8Array>;
}

function invalid(category: InvalidInput["category"]): Result<never, InvalidInput> {
  return err({ rule: "invalid-input", category });
}

async function readCapped(stream: AsyncIterable<string | Uint8Array>, maxBytes: number): Promise<Result<Uint8Array, InvalidInput>> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const bytes = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
    size += bytes.byteLength;
    if (size > maxBytes) return invalid("oversized");
    chunks.push(bytes);
  }
  return ok(Buffer.concat(chunks));
}

function hasExpectedContract(value: unknown, expectedContract: string): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && Object.hasOwn(value, "contract")
    && (value as { readonly contract?: unknown }).contract === expectedContract;
}

function parse(bytes: Uint8Array, expectedContract: string | undefined): Result<unknown, InvalidInput> {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return invalid("encoding");
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return invalid("json");
  }
  if (expectedContract !== undefined && !hasExpectedContract(value, expectedContract)) {
    return invalid("discriminator");
  }
  return ok(value);
}

/** Reads the requested machine input exactly once and never returns source bytes in a refusal. */
export async function readJsonInput(options: ReadJsonInputOptions): Promise<Result<unknown, InvalidInput>> {
  const maxBytes = options.maxBytes ?? MAX_INPUT_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) return invalid("oversized");
  if (options.input === "-") {
    if (options.stdinIsTty) return invalid("tty");
    const bytes = await readCapped(options.stdin, maxBytes);
    return bytes.ok ? parse(bytes.value, options.expectedContract) : bytes;
  }
  try {
    const bytes = await readCapped(options.openFile?.(options.input) ?? createReadStream(options.input), maxBytes);
    return bytes.ok ? parse(bytes.value, options.expectedContract) : bytes;
  } catch {
    return invalid("missing");
  }
}

export interface InputPrompt<T> {
  prompt(): Promise<T | undefined>;
}

/** Narrow TTY-only confirmation seam; prompts never carry lifecycle authority. */
export interface BeaconLifecyclePrompt {
  confirmApproval(input: {
    readonly beaconId: string;
    readonly draftId: string;
    readonly captureId: string;
    readonly semanticHash: string;
  }): Promise<boolean | undefined>;
  requestRevocationReason(): Promise<string | undefined>;
  confirmRevocation(input: {
    readonly beaconId: string;
    readonly expectedActiveVersionId: string;
    readonly reason: string;
  }): Promise<boolean | undefined>;
}

export type InputCollectionRefusal = InvalidInput | { readonly rule: "prompt-cancelled" };

export interface GuidedInputAdapter {
  collectInit(options: { readonly nonInteractive: boolean; readonly input?: string }): Promise<Result<unknown, InputCollectionRefusal>>;
  collectAnnotation(options: { readonly nonInteractive: boolean; readonly input?: string }): Promise<Result<unknown, InputCollectionRefusal>>;
}

export function createGuidedInputAdapter(options: {
  readonly stdin: AsyncIterable<string | Uint8Array>;
  readonly stdinIsTty: boolean;
  readonly initPrompt: InputPrompt<unknown>;
  readonly annotationPrompt: InputPrompt<unknown>;
  readonly openFile?: (path: string) => AsyncIterable<string | Uint8Array>;
}): GuidedInputAdapter {
  const collect = (expectedContract: string, prompt: InputPrompt<unknown>) => async (input: { readonly nonInteractive: boolean; readonly input?: string }) => collectContractInput({
    ...input,
    expectedContract,
    prompt,
    readMachine: async (source) => readJsonInput({
      input: source,
      stdin: options.stdin,
      stdinIsTty: options.stdinIsTty,
      expectedContract,
      openFile: options.openFile,
    }),
  });
  return {
    collectInit: collect("pharos.project-init/1", options.initPrompt),
    collectAnnotation: collect("pharos.capture-annotation/1", options.annotationPrompt),
  };
}

export async function collectContractInput<T>(options: {
  readonly nonInteractive: boolean;
  readonly input?: string;
  readonly readMachine: (input: string) => Promise<Result<unknown, InvalidInput>>;
  readonly prompt: InputPrompt<T>;
  readonly expectedContract?: string;
}): Promise<Result<T | unknown, InvalidInput | { readonly rule: "prompt-cancelled" }>> {
  if (options.nonInteractive) {
    if (options.input === undefined) return invalid("missing");
    return options.readMachine(options.input);
  }
  const value = await options.prompt.prompt();
  if (value === undefined) return err({ rule: "prompt-cancelled" });
  return options.expectedContract !== undefined && !hasExpectedContract(value, options.expectedContract)
    ? invalid("discriminator")
    : ok(value);
}
