import type { SemanticProjection } from "./types.js";

type Shape = string | readonly [Shape] | { readonly [key: string]: Shape };
const value: Shape = "json";
const declaration: Shape = { id: "string", description: "nullable-string" };
const checkpoint: Shape = { id: "string", afterAction: "nullable-string", expectations: "json-record" };
const shape: Shape = {
  purpose: "string", actor: { type: "string", identityRef: "nullable-string" },
  entryPoint: { path: "string", query: "nullable-string-record", fragment: "nullable-string" },
  actions: [{ action: "string", target: "nullable-string", value: "action-value" }],
  checkpoints: "checkpoints", variables: "variables",
  outcomes: "declarations", allowedVariation: "declarations", prohibitedRegressions: "declarations",
  readinessIntent: { sideEffectClass: "side-effect", isolation: "isolation" },
};
function object(input: unknown): input is Record<string, unknown> {
  return input !== null && typeof input === "object" && !Array.isArray(input);
}
function exact(input: unknown, expected: Record<string, Shape>): boolean {
  return object(input) && Object.keys(input).length === Object.keys(expected).length
    && Object.entries(expected).every(([key, rule]) => Object.hasOwn(input, key) && check(input[key], rule));
}
function record(input: unknown, rule: Shape): boolean {
  return object(input) && Object.values(input).every((item) => check(item, rule));
}
function check(input: unknown, rule: Shape): boolean {
  if (typeof rule !== "string") {
    if (Array.isArray(rule)) return Array.isArray(input) && input.every((item) => check(item, rule[0]!));
    return exact(input, rule as Record<string, Shape>);
  }
  switch (rule) {
    case "string": return typeof input === "string";
    case "nullable-string": return input === null || typeof input === "string";
    case "side-effect": return input === "stateful" || input === "stateless";
    case "json": return input === null || typeof input === "string" || typeof input === "boolean"
      || (typeof input === "number" && Number.isFinite(input))
      || (Array.isArray(input) && input.every((item) => check(item, value)))
      || (object(input) && Object.values(input).every((item) => check(item, value)));
    case "json-record": return record(input, value);
    case "nullable-string-record": return input === null || record(input, "string");
    case "action-value": return input === null || (object(input) && (input.kind === "literal"
      ? exact(input, { kind: "string", value }) : input.kind === "variable"
        && exact(input, { kind: "string", variable: "string" })));
    case "checkpoints": return object(input) && (input.ordering === "keyed"
      ? exact(input, { ordering: "string", entries: "keyed-checkpoints" })
      : input.ordering === "ordered" && exact(input, { ordering: "string", entries: [checkpoint] }));
    case "keyed-checkpoints": return record(input, checkpoint) && Object.entries(input as Record<string, unknown>).every(([key, item]) => (item as { id: string }).id === key);
    case "variables": return record(input, { name: "string", classification: "classification", constraints: "constraints", secretReferenceId: "nullable-string", nonSensitiveExample: "nullable-json" })
      && Object.entries(input as Record<string, unknown>).every(([key, item]) => (item as { name: string }).name === key);
    case "classification": return ["representative", "required_scenario", "test_data"].includes(input as string);
    case "constraints": return record(input, { kind: "string", value }) && Object.entries(input as Record<string, unknown>).every(([key, item]) => (item as { kind: string }).kind === key);
    case "nullable-json": return input === null || check(input, value);
    case "declarations": return record(input, declaration) && Object.entries(input as Record<string, unknown>).every(([key, item]) => (item as { id: string }).id === key);
    case "isolation": return input === null || exact(input, { strategy: "string", scope: "key-set" });
    case "key-set": return record(input, "true");
    case "true": return input === true;
    default: return false;
  }
}

/** Rejects incomplete and unknown fields at every depth before decoding or hashing. */
export function isCompleteSemanticProjection(input: unknown): input is SemanticProjection {
  return check(input, shape);
}
