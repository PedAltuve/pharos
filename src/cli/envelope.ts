import type { ContractValidationError } from "../domain/ports/index.js";
import type { Result } from "../shared/result.js";

export type CliEnvelopeOutcome = "succeeded" | "refused" | "failed" | "inconclusive" | "interrupted";
export type CliErrorCategory = "validation" | "prerequisite" | "conflict" | "safety" | "internal";

export interface CliError {
  readonly rule: string;
  readonly category: CliErrorCategory;
  readonly field: string;
}

export interface CliNextAction {
  readonly command: string;
  readonly reason: string;
}

export interface CliEnvelope {
  readonly contract: "pharos.cli-envelope/1";
  readonly command: string;
  readonly outcome: CliEnvelopeOutcome;
  readonly data: Readonly<Record<string, unknown>>;
  readonly errors: readonly CliError[];
  readonly next_action: CliNextAction | null;
}

export interface CliRenderedOutcome {
  readonly command: string;
  readonly outcome: CliEnvelopeOutcome;
  readonly data: Readonly<Record<string, unknown>>;
  readonly errors: readonly CliError[];
  readonly nextAction: CliNextAction | null;
}

type RuleRefusal = { readonly rule: string; readonly field?: unknown; readonly keyword?: unknown };

const OMIT = Symbol("omit");
const SENSITIVE_KEY = /(?:secret|token|password|error|raw|input|path|message|stack|exception|diagnostic|adapter|capture[\s_-]*bytes?)/i;
const ABSOLUTE_LOCATION = /(?:\/[A-Za-z0-9_.~-]+(?:\/|$)|\\\\|[A-Za-z]:[\\/]|~[^/\\]*[\\/]|file:)/i;
const PUBLIC_RULE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const SAFE_CATEGORY = new Set<CliErrorCategory>(["validation", "prerequisite", "conflict", "safety", "internal"]);
const SAFE_OUTCOME = new Set<CliEnvelopeOutcome>(["succeeded", "refused", "failed", "inconclusive", "interrupted"]);

type SafeValue = null | boolean | number | string | readonly SafeValue[] | { readonly [key: string]: SafeValue };

function safeString(value: unknown, maxLength = 256): string | typeof OMIT {
  return typeof value === "string" && value.length >= 1 && value.length <= maxLength && !ABSOLUTE_LOCATION.test(value)
    ? value
    : OMIT;
}

function safeRule(value: unknown): string {
  return typeof value === "string" && value.length >= 1 && value.length <= 256 && PUBLIC_RULE.test(value) ? value : "invalid-request";
}

function safeValue(value: unknown, seen = new WeakSet<object>()): SafeValue | typeof OMIT {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : OMIT;
  if (typeof value === "string") return safeString(value);
  if (Array.isArray(value)) {
    if (seen.has(value)) return OMIT;
    seen.add(value);
    try { return value.map((item) => safeValue(item, seen)).filter((item): item is SafeValue => item !== OMIT); }
    catch { return OMIT; }
  }
  if (typeof value !== "object" || value instanceof Uint8Array || value instanceof Error || seen.has(value)) return OMIT;
  seen.add(value);
  const safe: Record<string, SafeValue> = {};
  try {
    for (const key of Object.keys(value)) {
      if (SENSITIVE_KEY.test(key) || safeString(key) === OMIT) continue;
      const normalized = safeValue((value as Record<string, unknown>)[key], seen);
      if (normalized !== OMIT) safe[key] = normalized;
    }
  } catch { return OMIT; }
  return safe;
}

function safeData(data: Readonly<Record<string, unknown>>): Readonly<Record<string, SafeValue>> {
  const normalized = safeValue(data);
  return normalized !== OMIT && !Array.isArray(normalized) && normalized !== null
    ? normalized as Readonly<Record<string, SafeValue>>
    : {};
}

function safeField(value: unknown): string {
  if (typeof value !== "string" || value.length > 256 || (value !== "" && !/^(?:\/|\/(?:[^~/]|~[01])*)*$/.test(value))) return "/";
  if (value === "") return "";
  const segments = value.split("/").slice(1).map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~").toLowerCase());
  const filesystemRoot = new Set(["private", "home", "users", "tmp", "var", "etc", "opt", "usr", "root"]);
  const sensitive = /(?:secret|token|password|raw|input|message|stack|exception|diagnostic|adapter|capture[\s_-]*bytes?)/i;
  return segments.some((segment) => filesystemRoot.has(segment) || sensitive.test(segment) || /^[A-Za-z]:/.test(segment) || segment.startsWith("\\\\") || segment.startsWith("file:")) ? "/" : value;
}

function safeError(error: CliError): CliError | undefined {
  if (!SAFE_CATEGORY.has(error.category) || safeRule(error.rule) !== error.rule) return undefined;
  return {
    rule: error.rule,
    category: error.category,
    field: error.category === "validation" ? safeField(error.field) : "/",
  };
}

function safeNextAction(action: CliNextAction | null): CliNextAction | null | undefined {
  if (action === null) return null;
  const command = safeString(action.command, 1024);
  const reason = safeString(action.reason, 1024);
  return command === OMIT || reason === OMIT ? undefined : { command, reason };
}

/** Maps validator data without publishing Ajv prose, rejected values, or keywords. */
export function domainValidationErrors(errors: readonly ContractValidationError[]): readonly CliError[] {
  return errors.map((error) => ({ rule: error.rule, category: "validation", field: safeField(error.field) }));
}

function categoryFor(rule: string): CliErrorCategory {
  if (rule === "invalid-contract" || rule === "invalid-input" || rule === "invalid-project-context") return "validation";
  if (rule.includes("conflict") || rule.includes("mismatch")) return "conflict";
  if (rule === "production-environment" || rule.includes("corruption") || rule.includes("unsafe") || rule.includes("sensitive")) return "safety";
  return "prerequisite";
}

function nextActionFor(rule: string): CliNextAction | null {
  if (rule === "project-selection-required" || rule === "project-context-not-found") {
    return { command: "pharos init", reason: "Initialize or select a project" };
  }
  if (rule === "capture-not-promoted") return { command: "pharos capture record", reason: "Record and promote a capture" };
  return null;
}

/** Converts every modeled application refusal into one stable public contract. */
export function refusalOutcome(command: string, refusal: RuleRefusal): CliRenderedOutcome {
  const field = refusal.rule === "invalid-contract" ? safeField(refusal.field) : "/";
  return {
    command,
    outcome: "refused",
    data: {},
    errors: [{ rule: safeRule(refusal.rule), category: categoryFor(refusal.rule), field }],
    nextAction: nextActionFor(refusal.rule),
  };
}

export function resultOutcome<T, E extends RuleRefusal>(
  command: string,
  result: Result<T, E>,
  success: (value: T) => Omit<CliRenderedOutcome, "command" | "outcome" | "errors">,
): CliRenderedOutcome {
  return result.ok
    ? { command, outcome: "succeeded", errors: [], ...success(result.value) }
    : refusalOutcome(command, result.error);
}

export function internalOutcome(command: string): CliRenderedOutcome {
  return { command, outcome: "failed", data: {}, errors: [{ rule: "internal-error", category: "internal", field: "/" }], nextAction: null };
}

function hardInternalEnvelope(): string {
  return "{\"contract\":\"pharos.cli-envelope/1\",\"command\":\"pharos\",\"outcome\":\"failed\",\"data\":{},\"errors\":[{\"rule\":\"internal-error\",\"category\":\"internal\",\"field\":\"/\"}],\"next_action\":null}\n";
}

export interface NormalizedCliOutcome {
  readonly value: CliRenderedOutcome;
  readonly internal: boolean;
}

/** Produces the one safe result used for both presentation and process exit selection. */
export function normalizeOutcome(outcome: CliRenderedOutcome): NormalizedCliOutcome {
  try {
    const command = safeString(outcome.command);
    if (command === OMIT || !SAFE_OUTCOME.has(outcome.outcome) || !Array.isArray(outcome.errors) || outcome.errors.length > 100) {
      return { value: internalOutcome("pharos"), internal: true };
    }
    const errors = outcome.errors.map(safeError);
    const nextAction = safeNextAction(outcome.nextAction);
    if (errors.some((error) => error === undefined) || nextAction === undefined) {
      return { value: internalOutcome("pharos"), internal: true };
    }
    return {
      value: { command, outcome: outcome.outcome, data: safeData(outcome.data), errors: errors as CliError[], nextAction },
      internal: false,
    };
  } catch {
    return { value: internalOutcome("pharos"), internal: true };
  }
}

export function jsonEnvelope(outcome: CliRenderedOutcome): string {
  const normalized = normalizeOutcome(outcome);
  try {
    const envelope: CliEnvelope = {
      contract: "pharos.cli-envelope/1",
      command: normalized.value.command,
      outcome: normalized.value.outcome,
      data: normalized.value.data,
      errors: normalized.value.errors,
      next_action: normalized.value.nextAction,
    };
    return `${JSON.stringify(envelope)}\n`;
  } catch {
    return hardInternalEnvelope();
  }
}

function safeRecord(value: unknown): Readonly<Record<string, SafeValue>> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Readonly<Record<string, SafeValue>>
    : undefined;
}

function boundedCount(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.length > 999 ? "999+" : String(value.length);
}

/** A fixed inspection summary avoids turning nested envelope data into a raw human dump. */
function beaconInspection(data: Readonly<Record<string, unknown>>): string | undefined {
  const beacon = safeRecord(data.beacon);
  const capture = safeRecord(data.capture);
  const semantics = beacon === undefined ? undefined : safeRecord(beacon.semantics);
  if (beacon?.authority !== "authoritative" || capture?.authority !== "supporting-non-authoritative" || semantics === undefined
    || typeof beacon.status !== "string" || typeof beacon.revision !== "number" || typeof beacon.semanticHash !== "string" || typeof capture.captureId !== "string") return undefined;
  const actions = boundedCount(semantics.actions);
  const checkpoints = safeRecord(semantics.checkpoints);
  const checkpointCount = checkpoints === undefined ? undefined : boundedCount(checkpoints.entries);
  const variables = boundedCount(semantics.variables);
  const outcomes = boundedCount(semantics.outcomes);
  if ([actions, checkpointCount, variables, outcomes].some((count) => count === undefined)) return undefined;
  return [
    "beacon.authority: authoritative",
    `beacon.status: ${beacon.status}`,
    `beacon.revision: ${beacon.revision}`,
    `beacon.semantic_hash: ${beacon.semanticHash}`,
    `beacon.semantics: actions=${actions}, checkpoints=${checkpointCount}, variables=${variables}, outcomes=${outcomes}`,
    "capture.authority: supporting-non-authoritative",
    `capture.association: ${capture.captureId}`,
  ].join("\n").concat("\n");
}

function humanSuccess(command: string, data: Readonly<Record<string, unknown>>, nextAction: CliNextAction | null): string {
  const inspection = command === "beacon.inspect" ? beaconInspection(data) : undefined;
  const scalars = inspection ?? Object.entries(data)
    .filter((entry): entry is [string, null | boolean | number | string] => {
      const value = entry[1];
      return value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string";
    })
    .slice(0, 10)
    .map(([key, value]) => `${key}: ${String(value)}\n`)
    .join("");
  const next = nextAction === null ? "" : `next: ${nextAction.command}\n`;
  return `pharos: completed\n${scalars}${next}`;
}

/** Machine output is one envelope; human diagnostics never echo adapter detail. */
export function renderOutcome(outcome: CliRenderedOutcome, format: "human" | "json"): {
  readonly stdout: string;
  readonly stderr: string;
} {
  const normalized = normalizeOutcome(outcome).value;
  if (format === "json") return { stdout: jsonEnvelope(normalized), stderr: "" };
  if (normalized.outcome === "succeeded") return { stdout: humanSuccess(normalized.command, normalized.data, normalized.nextAction), stderr: "" };
  if (normalized.outcome === "interrupted") return { stdout: "", stderr: "pharos: interrupted\n" };
  if (normalized.outcome === "refused") return { stdout: "", stderr: "pharos: request refused\n" };
  if (normalized.outcome === "inconclusive") return { stdout: "", stderr: "pharos: outcome inconclusive\n" };
  if (normalized.errors.some((error) => error.category === "internal")) return { stdout: "", stderr: "pharos: internal error\n" };
  return { stdout: "", stderr: "pharos: operation failed\n" };
}
