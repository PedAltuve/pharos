import type { SemanticSource, SemanticValue } from "../../domain/semantics/index.js";
import { err, ok, type Result } from "../../shared/result.js";

export interface AnnotationPolicyRefusal {
  readonly rule: "invalid-annotation-policy";
  readonly field: string;
  readonly keyword: string;
}

export interface AnnotationPolicyContext {
  readonly secretSourceReferences: readonly string[];
  readonly resolvedSecrets: ReadonlyMap<string, string>;
}

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue {
  return value as RecordValue;
}

function policy(field: string, keyword: string): Result<never, AnnotationPolicyRefusal> {
  return err({ rule: "invalid-annotation-policy", field, keyword });
}

const PLAYWRIGHT_IDENTIFIERS = new Set([
  "browser", "browsercontext", "codegen", "elementhandle", "framelocator",
  "getbyalttext", "getbylabel", "getbyplaceholder", "getbyrole", "getbytestid", "getbytext", "getbytitle", "jshandle",
  "locator", "playwright",
]);

type MachineStringReason =
  | "tool-neutral-token"
  | "tool-neutral-call"
  | "tool-neutral-selector"
  | "tool-neutral-code"
  | "absolute-filesystem-path";

function isToolSpecificToken(value: string): boolean {
  const normalized = value.toLowerCase();
  return PLAYWRIGHT_IDENTIFIERS.has(normalized)
    || isPlaywrightApiIdentifier(value)
    || /^page(?:getby(?:role|text|label|testid)|locator|click)$/i.test(value);
}

/** Distinctive PascalCase public API families, never ordinary spaced prose. */
function isPlaywrightApiIdentifier(value: string): boolean {
  return /^API(?:[A-Z][A-Za-z0-9]*)+$/.test(value)
    || /^(?:Browser(?:Context|Type)|ElementHandle|FrameLocator|JSHandle|Locator|Page)$/.test(value);
}

/** Object keys are structural, so reserved tool names are not ordinary prose. */
function isToolSpecificKey(value: string): boolean {
  return isToolSpecificToken(value) || /^(?:selector|xpath|css)$/i.test(value);
}

/** Public Playwright calls are syntax, not ordinary prose mentioning a UI concept. */
function isPlaywrightCall(value: string): boolean {
  return /\b(?:getBy(?:Role|Text|Label|TestId|Placeholder|AltText|Title)|page\s*\.\s*[A-Za-z_$][A-Za-z0-9_$]*|(?:frameLocator|locator|browserContext)(?:\s*\.\s*[A-Za-z_$][A-Za-z0-9_$]*)?)\s*\(/i.test(value);
}

/** Splits CSS lists only at commas outside attribute and pseudo-function syntax. */
function splitTopLevelSelectorList(value: string): readonly string[] | undefined {
  const components: string[] = [];
  let start = 0;
  let parentheses = 0;
  let brackets = 0;
  let quote: "'" | '"' | undefined;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote !== undefined) {
      if (!escaped && character === quote) quote = undefined;
      escaped = !escaped && character === "\\";
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
    } else if (character === "(") {
      parentheses += 1;
    } else if (character === ")") {
      if (parentheses === 0) return undefined;
      parentheses -= 1;
    } else if (character === "[") {
      brackets += 1;
    } else if (character === "]") {
      if (brackets === 0) return undefined;
      brackets -= 1;
    } else if (character === "," && parentheses === 0 && brackets === 0) {
      const component = value.slice(start, index).trim();
      if (component.length === 0) return undefined;
      components.push(component);
      start = index + 1;
    }
  }

  if (quote !== undefined || parentheses !== 0 || brackets !== 0) return undefined;
  const component = value.slice(start).trim();
  if (component.length === 0) return undefined;
  components.push(component);
  return components;
}

/** Matches complete selector grammar fragments without treating prose punctuation as CSS. */
const SELECTOR_TYPE_ATOMS = new Set([
  "article", "button", "div", "footer", "form", "header", "input", "label", "li", "main", "nav", "section", "select", "span", "table", "tbody", "td", "textarea", "th", "tr", "ul",
  "svg", "path", "circle", "ellipse", "line", "polygon", "polyline", "rect", "g", "defs", "use", "symbol", "text", "tspan", "image", "marker", "mask", "pattern", "clippath", "filter", "foreignobject", "lineargradient", "radialgradient", "stop",
  "math", "mi", "mn", "mo", "mrow", "msup", "msub", "mfrac", "msqrt", "mtable", "mtr", "mtd",
]);
function isCssSelectorComponent(value: string): boolean {
  const identifier = "[A-Za-z_][A-Za-z0-9_-]*";
  const tag = "[A-Za-z][A-Za-z0-9-]*";
  const decoration = `(?:(?:#|\\.)${identifier}|\\[[^\\]]+\\]|:[a-z][a-z0-9-]*(?:\\([^)]*\\))?)`;
  const decoratedAtom = `(?:${tag})?(?:${decoration})+`;
  const atom = `(?:${tag}(?:${decoration})*|${decoratedAtom})`;
  const simple = new RegExp(`^(?:#${identifier}|\\.${identifier}|\\[[^\\]]+\\])$`);
  const decorated = new RegExp(`^${tag}(?:${decoration})+$`, "i");
  const chain = new RegExp(`^${atom}(?:\\s*[>+~]\\s*${atom}|\\s+${atom})+$`, "i");
  const hasCombinator = /[>+~]/.test(value);
  const hasDecoration = /(?:[#.[]|:[a-z])/i.test(value);
  return simple.test(value) || decorated.test(value)
    || (chain.test(value) && (hasCombinator || hasDecoration || value.split(/\s+/).some((atom) => atom.includes("-") || SELECTOR_TYPE_ATOMS.has(atom.toLowerCase()))));
}

function isCssSelector(value: string): boolean {
  const components = splitTopLevelSelectorList(value);
  return components !== undefined && components.every(isCssSelectorComponent);
}

function isXPathSelector(value: string): boolean {
  return /^(?:xpath=|\(\s*\.?\/\/|\.\/\/|\/\/)/.test(value);
}

/** Structural markers avoid the prior false positive on harmless semicolons or braces. */
function isObviousCode(value: string): boolean {
  return /\b(?:if|for|while|switch|catch)\s*\([^)]*\)\s*\{/.test(value)
    || /^\s*(?:if|for|while)\s*\([^)]*\)\s*[A-Za-z_$][A-Za-z0-9_$.]*\s*\([^{};]*\)\s*;?\s*$/.test(value)
    || /\b(?:const|let|var)\s+[A-Za-z_$][A-Za-z0-9_$]*\s*=/.test(value)
    || /\b(?:async\s*)?\([^)]*\)\s*=>/.test(value)
    || /\bawait\s+[A-Za-z_$][A-Za-z0-9_$.]*\s*\(/.test(value)
    || /\bfunction\s+[A-Za-z_$][A-Za-z0-9_$]*\s*\(/.test(value)
    || /^[A-Za-z_$][A-Za-z0-9_$]*(?:\s*\.\s*[A-Za-z_$][A-Za-z0-9_$]*)*\s*\([^{};]*\)\s*;?\s*$/.test(value);
}

/** Finds path tokens at boundaries so `and/or` remains ordinary prose. */
function hasAbsolutePathToken(value: string): boolean {
  return /(?:^|[\s("'[])(?:\/[^\s"'{}()[\],;]+|[A-Za-z]:[\\/][^\s"'{}()[\],;]+|\\\\[^\\\s"'{}()[\],;]+\\[^\\\s"'{}()[\],;]+|~[A-Za-z0-9_-]*\/[^\s"'{}()[\],;]+|file:\/+[^\s"'{}()[\],;]+)/.test(value);
}

function machineStringReason(value: string): MachineStringReason | undefined {
  const trimmed = value.trim();
  if (isToolSpecificToken(trimmed)) return "tool-neutral-token";
  if (isPlaywrightCall(trimmed)) return "tool-neutral-call";
  if (isCssSelector(trimmed) || isXPathSelector(trimmed)) return "tool-neutral-selector";
  if (hasAbsolutePathToken(trimmed)) return "absolute-filesystem-path";
  if (isObviousCode(trimmed)) return "tool-neutral-code";
  return undefined;
}

function unsafeSemanticField(value: unknown, pointer: string): { readonly field: string; readonly keyword: AnnotationPolicyRefusal["keyword"] } | undefined {
  if (typeof value === "string") {
    const keyword = machineStringReason(value);
    return keyword === undefined ? undefined : { field: pointer || "/", keyword };
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const unsafe = unsafeSemanticField(value[index], `${pointer}/${index}`);
      if (unsafe !== undefined) return unsafe;
    }
    return undefined;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      if (isToolSpecificKey(key)) return { field: `${pointer}/${key}`, keyword: "tool-neutral-token" };
      const unsafe = unsafeSemanticField(nested, `${pointer}/${key}`);
      if (unsafe !== undefined) return unsafe;
    }
  }
  return undefined;
}

function duplicate(entries: readonly unknown[], field: string): Result<void, AnnotationPolicyRefusal> {
  const seen = new Set<string>();
  for (let index = 0; index < entries.length; index += 1) {
    const item = record(entries[index]);
    const id = typeof item.id === "string" ? item.id : item.name;
    if (typeof id !== "string") return policy(`${field}/${index}`, "identity");
    if (seen.has(id)) return policy(`${field}/${index}`, "unique-logical-id");
    seen.add(id);
  }
  return ok(undefined);
}

function strings(value: unknown, pointer = ""): readonly { readonly field: string; readonly value: string }[] {
  if (typeof value === "string") return [{ field: pointer || "/", value }];
  if (Array.isArray(value)) return value.flatMap((entry, index) => strings(entry, `${pointer}/${index}`));
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([key, entry]) => [
      { field: `${pointer}/${key}`, value: key },
      ...strings(entry, `${pointer}/${key}`),
    ]);
  }
  return [];
}

/**
 * Pure post-schema checks. It refuses unsafe meaning rather than stripping it,
 * so callers cannot accidentally normalize a selector, path, or secret into
 * canonical Beacon semantics.
 */
export function validateAnnotationPolicy(
  input: unknown,
  context: AnnotationPolicyContext,
): Result<void, AnnotationPolicyRefusal> {
  const source = record(input);
  const actions = source.actions as readonly unknown[];
  const checkpoints = record(source.checkpoints).entries as readonly unknown[];
  const variables = source.variables as readonly unknown[];
  const outcomes = source.outcomes as readonly unknown[];
  const allowedVariation = source.allowed_variation as readonly unknown[];
  const prohibitedRegressions = source.prohibited_regressions as readonly unknown[];

  for (const [entries, field] of [
    [checkpoints, "/checkpoints/entries"], [variables, "/variables"],
    [outcomes, "/outcomes"], [allowedVariation, "/allowed_variation"], [prohibitedRegressions, "/prohibited_regressions"],
  ] as const) {
    const unique = duplicate(entries, field);
    if (!unique.ok) return unique;
  }

  const actionNames = new Set<string>();
  for (let index = 0; index < actions.length; index += 1) {
    const action = record(actions[index]);
    if (typeof action.action !== "string" || isToolSpecificToken(action.action)) return policy(`/actions/${index}/action`, "tool-neutral-token");
    if (actionNames.has(action.action)) return policy(`/actions/${index}/action`, "unique-logical-id");
    actionNames.add(action.action);
    if (typeof action.target === "string" && isToolSpecificToken(action.target)) return policy(`/actions/${index}/target`, "tool-neutral-token");
  }
  for (let index = 0; index < checkpoints.length; index += 1) {
    const checkpoint = record(checkpoints[index]);
    if (typeof checkpoint.after_action === "string" && !actionNames.has(checkpoint.after_action)) return policy(`/checkpoints/entries/${index}/after_action`, "action-reference");
  }

  const variableNames = new Set(variables.map((entry) => record(entry).name).filter((name): name is string => typeof name === "string"));
  for (let index = 0; index < actions.length; index += 1) {
    const value = record(actions[index]).value;
    if (value !== null && typeof value === "object" && record(value).kind === "variable") {
      const variable = record(value).variable;
      if (typeof variable !== "string" || !variableNames.has(variable)) return policy(`/actions/${index}/value/variable`, "variable-reference");
    }
  }

  for (let index = 0; index < variables.length; index += 1) {
    const variable = record(variables[index]);
    const reference = variable.secret_reference_id;
    if (typeof reference === "string" && !context.secretSourceReferences.includes(reference)) return policy(`/variables/${index}/secret_reference_id`, "declared-secret-reference");
    const constraints = variable.constraints as readonly unknown[];
    const uniqueConstraints = new Set<string>();
    for (let constraintIndex = 0; constraintIndex < constraints.length; constraintIndex += 1) {
      const kind = record(constraints[constraintIndex]).kind;
      if (typeof kind !== "string" || uniqueConstraints.has(kind)) return policy(`/variables/${index}/constraints/${constraintIndex}/kind`, "unique-logical-id");
      uniqueConstraints.add(kind);
    }
  }

  const entryPoint = record(source.entry_point);
  const path = entryPoint.path;
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//") || path.includes("\\") || /(?:^|\/)\.\.(?:\/|$)/.test(path) || /%2e/i.test(path)) return policy("/entry_point/path", "origin-relative-path");

  // Title and contract are ingress metadata. Every other included value can
  // reach SemanticSource, so inspect it before mapping while preserving prose.
  const unsafe = unsafeSemanticField({
    purpose: source.purpose,
    actor: source.actor,
    entry_point: { query: entryPoint.query, fragment: entryPoint.fragment },
    actions, checkpoints, variables, outcomes,
    allowed_variation: allowedVariation,
    prohibited_regressions: prohibitedRegressions,
    readiness_intent: source.readiness_intent,
  }, "");
  if (unsafe !== undefined) return policy(unsafe.field, unsafe.keyword);

  for (const candidate of strings(input)) {
    for (const secret of context.resolvedSecrets.values()) {
      if (secret.length > 0 && candidate.value.includes(secret)) return policy(candidate.field, "literal-secret");
    }
  }
  return ok(undefined);
}

/** Explicit one-way camel-case projection. Metadata is intentionally absent. */
export function mapAnnotation(input: unknown): SemanticSource {
  const annotation = record(input);
  const actor = record(annotation.actor);
  const entryPoint = record(annotation.entry_point);
  const checkpoints = record(annotation.checkpoints);
  const readiness = record(annotation.readiness_intent);
  const isolation = readiness.isolation === null ? null : record(readiness.isolation);
  return {
    purpose: annotation.purpose as string,
    actor: { type: actor.type as string, identityRef: actor.identity_ref as string | null },
    entryPoint: { path: entryPoint.path as string, query: entryPoint.query as Record<string, string> | null, fragment: entryPoint.fragment as string | null },
    actions: (annotation.actions as readonly unknown[]).map((value) => {
      const action = record(value);
      return { action: action.action as string, target: action.target as string | null, value: mapActionValue(action.value) };
    }),
    checkpoints: {
      ordered: checkpoints.ordered as boolean,
      entries: (checkpoints.entries as readonly unknown[]).map((value) => {
        const checkpoint = record(value);
        return { id: checkpoint.id as string, afterAction: checkpoint.after_action as string | null, expectations: checkpoint.expectations as Record<string, SemanticValue> };
      }),
    },
    variables: (annotation.variables as readonly unknown[]).map((value) => {
      const variable = record(value);
      return {
        name: variable.name as string,
        classification: variable.classification as "representative" | "required_scenario" | "test_data",
        constraints: (variable.constraints as readonly unknown[]).map((constraint) => {
          const entry = record(constraint);
          return { kind: entry.kind as string, value: entry.value as SemanticValue };
        }),
        secretReferenceId: variable.secret_reference_id as string | null,
        nonSensitiveExample: variable.non_sensitive_example as SemanticValue | null,
      };
    }),
    outcomes: mapDeclarations(annotation.outcomes as readonly unknown[]),
    allowedVariation: mapDeclarations(annotation.allowed_variation as readonly unknown[]),
    prohibitedRegressions: mapDeclarations(annotation.prohibited_regressions as readonly unknown[]),
    readinessIntent: {
      sideEffectClass: readiness.side_effect_class as "stateful" | "stateless",
      isolation: isolation === null ? null : { strategy: isolation.strategy as string, scope: isolation.scope as readonly string[] },
    },
  };
}

function mapActionValue(value: unknown): SemanticValue | { readonly kind: "variable"; readonly variable: string } | null {
  if (value === null) return null;
  if (value !== null && typeof value === "object") {
    const actionValue = record(value);
    if (actionValue.kind === "variable") {
      return { kind: "variable", variable: actionValue.variable as string };
    }
    if (actionValue.kind === "literal") return actionValue.value as SemanticValue;
  }
  return value as SemanticValue;
}

function mapDeclarations(entries: readonly unknown[]): readonly { readonly id: string; readonly description: string | null }[] {
  return entries.map((value) => {
    const declaration = record(value);
    return { id: declaration.id as string, description: declaration.description as string | null };
  });
}
