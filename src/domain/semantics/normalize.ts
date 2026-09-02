import type {
  KeyedDeclaration,
  NormalizedActionValue,
  NormalizedActor,
  NormalizedCheckpoint,
  NormalizedCheckpoints,
  NormalizedConstraint,
  NormalizedEntryPoint,
  NormalizedIsolationIntent,
  OrderedJourneyAction,
  ReadinessIntent,
  SemanticBundle,
  SemanticKeySet,
  SemanticSource,
  SemanticSourceCore,
  SemanticValue,
  SourceCheckpoint,
  SourceDeclarationList,
  SourceVariable,
  VariableDecl,
} from "./types.js";

export interface FieldDeclaration<TValue> {
  readonly declaredDefault: TValue;
  readonly nullHasDomainMeaning: boolean;
}

export const FIELD_DECLARATIONS = {
  "actor.identityRef": { declaredDefault: null, nullHasDomainMeaning: true },
  "entryPoint.query": { declaredDefault: null, nullHasDomainMeaning: true },
  "entryPoint.fragment": { declaredDefault: null, nullHasDomainMeaning: true },
  "checkpoints.ordered": { declaredDefault: false, nullHasDomainMeaning: false },
  "variable.constraints": { declaredDefault: {}, nullHasDomainMeaning: false },
  "variable.secretReferenceId": {
    declaredDefault: null,
    nullHasDomainMeaning: true,
  },
  "variable.nonSensitiveExample": {
    declaredDefault: null,
    nullHasDomainMeaning: false,
  },
  "action.target": { declaredDefault: null, nullHasDomainMeaning: false },
  "action.value": { declaredDefault: null, nullHasDomainMeaning: false },
  "checkpoint.afterAction": { declaredDefault: null, nullHasDomainMeaning: false },
  "declaration.description": {
    declaredDefault: null,
    nullHasDomainMeaning: false,
  },
  "readinessIntent.isolation": {
    declaredDefault: null,
    nullHasDomainMeaning: true,
  },
  "isolation.scope": { declaredDefault: {}, nullHasDomainMeaning: false },
} as const;

/**
 * `undefined` -> declared default; `null` -> `null` when the declaration
 * gives `null` domain meaning, else the declared default; otherwise the raw
 * value is returned unchanged.
 */
export function resolveDeclared<T>(
  raw: T | null | undefined,
  declaration: FieldDeclaration<T | null>,
): T | null {
  if (raw === undefined) {
    return declaration.declaredDefault;
  }
  if (raw === null) {
    return declaration.nullHasDomainMeaning ? null : declaration.declaredDefault;
  }
  return raw;
}

/**
 * Keys entries by logical identity, from either array form (each entry's
 * identity becomes its key) or object form (the record key must already
 * equal the entry's identity). Throws on a duplicate identity in array
 * form, or on an identity/key disagreement in object form — last-wins
 * would silently collapse two distinct entries into one.
 */
export function toKeyed<T>(
  entries: readonly T[] | Readonly<Record<string, T>>,
  getIdentity: (entry: T) => string,
): Record<string, T> {
  const result: Record<string, T> = {};

  if (Array.isArray(entries)) {
    for (const entry of entries as readonly T[]) {
      const identity = getIdentity(entry);
      if (Object.prototype.hasOwnProperty.call(result, identity)) {
        throw new Error(`Duplicate logical identity: "${identity}"`);
      }
      result[identity] = entry;
    }
    return result;
  }

  for (const [key, entry] of Object.entries(entries)) {
    const identity = getIdentity(entry);
    if (identity !== key) {
      throw new Error(
        `Logical identity "${identity}" does not match record key "${key}"`,
      );
    }
    result[key] = entry;
  }
  return result;
}

function toKeySet(entries: readonly string[]): SemanticKeySet {
  const result: Record<string, true> = {};
  for (const key of entries) {
    result[key] = true;
  }
  return result;
}

function normalizeActor(raw: SemanticSourceCore["actor"]): NormalizedActor {
  return {
    type: raw.type,
    identityRef: resolveDeclared<string>(
      raw.identityRef,
      FIELD_DECLARATIONS["actor.identityRef"],
    ),
  };
}

function normalizeEntryPoint(
  raw: SemanticSourceCore["entryPoint"],
): NormalizedEntryPoint {
  return {
    path: raw.path,
    query: resolveDeclared<Readonly<Record<string, string>>>(
      raw.query,
      FIELD_DECLARATIONS["entryPoint.query"],
    ),
    fragment: resolveDeclared<string>(
      raw.fragment,
      FIELD_DECLARATIONS["entryPoint.fragment"],
    ),
  };
}

function isNormalizedActionValue(
  value: unknown,
): value is NormalizedActionValue {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    ((value as { kind: unknown }).kind === "literal" ||
      (value as { kind: unknown }).kind === "variable")
  );
}

function normalizeActionValue(
  raw: NormalizedActionValue | SemanticValue | null | undefined,
): NormalizedActionValue | null {
  const resolved = resolveDeclared<NormalizedActionValue | SemanticValue>(
    raw,
    FIELD_DECLARATIONS["action.value"],
  );
  if (resolved === null) {
    return null;
  }
  if (isNormalizedActionValue(resolved)) {
    return resolved;
  }
  return { kind: "literal", value: resolved };
}

function normalizeActions(
  raw: SemanticSourceCore["actions"],
): readonly OrderedJourneyAction[] {
  return raw.map((action) => ({
    action: action.action,
    target: resolveDeclared<string>(
      action.target,
      FIELD_DECLARATIONS["action.target"],
    ),
    value: normalizeActionValue(action.value),
  }));
}

function normalizeCheckpoint(raw: SourceCheckpoint): NormalizedCheckpoint {
  return {
    id: raw.id,
    afterAction: resolveDeclared<string>(
      raw.afterAction,
      FIELD_DECLARATIONS["checkpoint.afterAction"],
    ),
    expectations: raw.expectations,
  };
}

function normalizeCheckpoints(
  raw: SemanticSourceCore["checkpoints"],
): NormalizedCheckpoints {
  if (raw === null || raw === undefined) {
    return { ordering: "keyed", entries: {} };
  }

  const ordered = resolveDeclared<boolean>(
    raw.ordered,
    FIELD_DECLARATIONS["checkpoints.ordered"],
  );

  if (ordered) {
    const entries = Array.isArray(raw.entries)
      ? raw.entries
      : Object.values(raw.entries);
    return {
      ordering: "ordered",
      entries: entries.map(normalizeCheckpoint),
    };
  }

  const keyed = toKeyed(raw.entries, (entry) => entry.id);
  const normalizedEntries: Record<string, NormalizedCheckpoint> = {};
  for (const [key, entry] of Object.entries(keyed)) {
    normalizedEntries[key] = normalizeCheckpoint(entry);
  }
  return { ordering: "keyed", entries: normalizedEntries };
}

function normalizeConstraints(
  raw: SourceVariable["constraints"],
): Readonly<Record<string, NormalizedConstraint>> {
  const resolved = resolveDeclared<NonNullable<SourceVariable["constraints"]>>(
    raw,
    FIELD_DECLARATIONS["variable.constraints"],
  );
  if (resolved === null) {
    return {};
  }

  const result: Record<string, NormalizedConstraint> = {};
  if (Array.isArray(resolved)) {
    for (const entry of resolved) {
      if (Object.prototype.hasOwnProperty.call(result, entry.kind)) {
        throw new Error(`Duplicate constraint kind: "${entry.kind}"`);
      }
      result[entry.kind] = { kind: entry.kind, value: entry.value };
    }
    return result;
  }

  for (const [kind, entry] of Object.entries(resolved)) {
    result[kind] = { kind, value: entry.value };
  }
  return result;
}

function normalizeVariable(raw: SourceVariable): VariableDecl {
  return {
    name: raw.name,
    classification: raw.classification,
    constraints: normalizeConstraints(raw.constraints),
    secretReferenceId: resolveDeclared<string>(
      raw.secretReferenceId,
      FIELD_DECLARATIONS["variable.secretReferenceId"],
    ),
    nonSensitiveExample: resolveDeclared<SemanticValue>(
      raw.nonSensitiveExample,
      FIELD_DECLARATIONS["variable.nonSensitiveExample"],
    ),
  };
}

function normalizeVariables(
  raw: SemanticSourceCore["variables"],
): Readonly<Record<string, VariableDecl>> {
  if (raw === null || raw === undefined) {
    return {};
  }
  const keyed = toKeyed(raw, (entry) => entry.name);
  const result: Record<string, VariableDecl> = {};
  for (const [key, entry] of Object.entries(keyed)) {
    result[key] = normalizeVariable(entry);
  }
  return result;
}

function normalizeDeclarationList(
  raw: SourceDeclarationList | null | undefined,
): Readonly<Record<string, KeyedDeclaration>> {
  if (raw === null || raw === undefined) {
    return {};
  }

  const result: Record<string, KeyedDeclaration> = {};

  if (Array.isArray(raw)) {
    for (const entry of raw) {
      const id = typeof entry === "string" ? entry : entry.id;
      const description =
        typeof entry === "string"
          ? null
          : resolveDeclared<string>(
              entry.description,
              FIELD_DECLARATIONS["declaration.description"],
            );
      if (Object.prototype.hasOwnProperty.call(result, id)) {
        throw new Error(`Duplicate declaration identity: "${id}"`);
      }
      result[id] = { id, description };
    }
    return result;
  }

  for (const [id, entry] of Object.entries(
    raw as Readonly<Record<string, { readonly description?: string | null }>>,
  )) {
    result[id] = {
      id,
      description: resolveDeclared<string>(
        entry.description,
        FIELD_DECLARATIONS["declaration.description"],
      ),
    };
  }
  return result;
}

function normalizeIsolationScope(
  raw: readonly string[] | null | undefined,
): SemanticKeySet {
  const asKeySet = raw === null || raw === undefined ? raw : toKeySet(raw);
  return resolveDeclared<SemanticKeySet>(
    asKeySet,
    FIELD_DECLARATIONS["isolation.scope"],
  ) as SemanticKeySet;
}

function normalizeIsolation(
  raw: SemanticSourceCore["readinessIntent"]["isolation"],
): NormalizedIsolationIntent | null {
  const resolved = resolveDeclared<{
    readonly strategy: string;
    readonly scope?: readonly string[] | null;
  }>(raw, FIELD_DECLARATIONS["readinessIntent.isolation"]);
  if (resolved === null) {
    return null;
  }
  return {
    strategy: resolved.strategy,
    scope: normalizeIsolationScope(resolved.scope),
  };
}

function normalizeReadinessIntent(
  raw: SemanticSourceCore["readinessIntent"],
): ReadinessIntent {
  return {
    sideEffectClass: raw.sideEffectClass,
    isolation: normalizeIsolation(raw.isolation),
  };
}

export function normalize(source: SemanticSource): SemanticBundle {
  return {
    purpose: source.purpose,
    actor: normalizeActor(source.actor),
    entryPoint: normalizeEntryPoint(source.entryPoint),
    actions: normalizeActions(source.actions),
    checkpoints: normalizeCheckpoints(source.checkpoints),
    variables: normalizeVariables(source.variables),
    outcomes: normalizeDeclarationList(source.outcomes),
    allowedVariation: normalizeDeclarationList(source.allowedVariation),
    prohibitedRegressions: normalizeDeclarationList(
      source.prohibitedRegressions,
    ),
    readinessIntent: normalizeReadinessIntent(source.readinessIntent),
  };
}
