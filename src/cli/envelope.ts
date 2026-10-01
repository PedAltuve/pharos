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
      if ((key !== "contract" && SENSITIVE_KEY.test(key)) || safeString(key) === OMIT) continue;
      const raw = (value as Record<string, unknown>)[key];
      if (key === "contract" && typeof raw === "string" && /^pharos\.[a-z-]+\/1$/.test(raw)) { safe[key] = raw; continue; }
      const normalized = safeValue(raw, seen);
      if (normalized !== OMIT) safe[key] = normalized;
    }
  } catch { return OMIT; }
  return safe;
}

function publicConsentRequest(value: unknown): SafeValue | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const closed = (object: unknown, required: readonly string[], optional: readonly string[] = []): object is Record<string, unknown> =>
    !!object && typeof object === "object" && !Array.isArray(object) &&
    required.every((key) => Object.hasOwn(object, key)) &&
    Reflect.ownKeys(object).every((key) => typeof key === "string" && (required.includes(key) || optional.includes(key)) &&
      Object.getOwnPropertyDescriptor(object, key)?.enumerable === true && "value" in Object.getOwnPropertyDescriptor(object, key)!);
  const text = (item: unknown, max = 256): item is string => typeof item === "string" && item.length >= 1 && item.length <= max;
  if (!closed(value, ["contract", "binding", "challengeId", "expiresAtEpochMs"]) ||
    (value.contract !== "pharos.operator-consent-request/1" && value.contract !== "pharos.operator-consent-request/2") ||
    !text(value.challengeId) || !Number.isSafeInteger(value.expiresAtEpochMs) || (value.expiresAtEpochMs as number) < 0) return undefined;
  const binding = value.binding;
  if (!binding || typeof binding !== "object" || Array.isArray(binding)) return undefined;
  const b = binding as Record<string, unknown>;
  const base = ["action", "projectId", "beaconId", "requestId"];
  const v2 = value.contract === "pharos.operator-consent-request/2";
  const fields = b.action === "approve" ? [...base, "draftId", "expectedRevision", "semanticHash", ...(v2 ? ["staleOriginAcknowledged", "reviewed"] : [])] :
    b.action === "revoke" && !v2 ? [...base, "expectedActiveVersion", "reason"] : [];
  if (!fields.length || !closed(binding, fields, b.action === "approve" && !v2 ? ["staleOriginAcknowledged"] : []) ||
    !text(b.projectId) || !text(b.beaconId) || !text(b.requestId)) return undefined;
  if (b.action === "approve" ? (!text(b.draftId) || !text(b.semanticHash) || !Number.isSafeInteger(b.expectedRevision) || (b.expectedRevision as number) < 1 ||
    (Object.hasOwn(b, "staleOriginAcknowledged") && typeof b.staleOriginAcknowledged !== "boolean")) :
    (!text(b.expectedActiveVersion) || !text(b.reason, 4096) || /^\s/.test(b.reason as string) || !/\S$/.test(b.reason as string) || /[\r\n]/.test(b.reason as string))) return undefined;
  let reviewed: Record<string, SafeValue> | undefined;
  if (v2) {
    const r = b.reviewed;
    if (b.staleOriginAcknowledged !== true || !closed(r, ["activeVersionId", "activeSemanticHash", "comparisonDigest"]) ||
      !text(r.comparisonDigest) || !((r.activeVersionId === null && r.activeSemanticHash === null) ||
        (text(r.activeVersionId) && text(r.activeSemanticHash)))) return undefined;
    reviewed = { activeVersionId: r.activeVersionId as string | null, activeSemanticHash: r.activeSemanticHash as string | null,
      comparisonDigest: r.comparisonDigest };
  }
  // Construct only the closed public shape; never forward arbitrary object fields or accessors.
  const publicBinding: Record<string, SafeValue> = { action: b.action as string, projectId: b.projectId, beaconId: b.beaconId, requestId: b.requestId };
  if (b.action === "revoke") { publicBinding.expectedActiveVersion = b.expectedActiveVersion as string; publicBinding.reason = b.reason as string; }
  else {
    publicBinding.draftId = b.draftId as string; publicBinding.expectedRevision = b.expectedRevision as number;
    publicBinding.semanticHash = b.semanticHash as string;
    if (Object.hasOwn(b, "staleOriginAcknowledged")) publicBinding.staleOriginAcknowledged = b.staleOriginAcknowledged as boolean;
    if (reviewed) publicBinding.reviewed = reviewed;
  }
  return { contract: value.contract, binding: publicBinding, challengeId: value.challengeId, expiresAtEpochMs: value.expiresAtEpochMs as number };
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
  if (rule.includes("stale-origin")) return { command: "host-decision-required", reason: "Ask the trusted interactive host to acknowledge the stale draft before preparing a new request" };
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
    const consent = command === "beacon.prepare" && outcome.outcome === "succeeded" && outcome.data.contract === "pharos.consent-prepare/1";
    const request = consent ? publicConsentRequest(outcome.data.request) : undefined;
    if (consent && (!request || outcome.data.status !== "host-decision-required" || safeString(outcome.data.auditId) === OMIT ||
      !Object.hasOwn(outcome.data, "request") || Reflect.ownKeys(outcome.data).length !== 4)) return { value: internalOutcome("pharos"), internal: true };
    const statusConsent = command === "beacon.consent-status" && outcome.outcome === "succeeded";
    const state = outcome.data.status;
    const pendingStatus = state === "host-decision-required";
    const statusRequest = statusConsent && pendingStatus ? publicConsentRequest(outcome.data.request) : undefined;
    if (statusConsent && (outcome.data.contract !== "pharos.consent-status/1" ||
      !["host-decision-required", "claimed", "declined", "consumed"].includes(state as string) ||
      safeString(outcome.data.auditId) === OMIT || safeString(outcome.data.requestId) === OMIT ||
      Reflect.ownKeys(outcome.data).length !== (pendingStatus ? 5 : 4) ||
      (pendingStatus && (!statusRequest || typeof statusRequest !== "object" || Array.isArray(statusRequest) || statusRequest === null ||
        !("binding" in statusRequest) || typeof statusRequest.binding !== "object" || statusRequest.binding === null || Array.isArray(statusRequest.binding) ||
        !("requestId" in statusRequest.binding) || statusRequest.binding.requestId !== outcome.data.requestId)) ||
      (!pendingStatus && Object.hasOwn(outcome.data, "request")))) return { value: internalOutcome("pharos"), internal: true };
    const data = consent ? { contract: "pharos.consent-prepare/1", status: "host-decision-required", request: request!, auditId: outcome.data.auditId as string } :
      statusConsent ? { contract: "pharos.consent-status/1", status: state as string, auditId: outcome.data.auditId as string, requestId: outcome.data.requestId as string, ...(pendingStatus ? { request: statusRequest! } : {}) } : safeData(outcome.data);
    return {
      value: { command, outcome: outcome.outcome, data, errors: errors as CliError[], nextAction },
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
