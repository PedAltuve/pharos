import fc from "fast-check";
import { FIELD_DECLARATIONS } from "../../../src/domain/semantics/index.js";
import type {
  SemanticBundle,
  SemanticSource,
  SemanticSourceCore,
  SemanticValue,
  SourceCheckpoint,
  SourceVariable,
  VariableClassification,
} from "../../../src/domain/semantics/index.js";

const CLASSIFICATIONS: readonly VariableClassification[] = [
  "representative",
  "required_scenario",
  "test_data",
];

export const arbIdentifier: fc.Arbitrary<string> = fc
  .integer({ min: 0, max: 1_000_000 })
  .map((n) => `id-${n}`);

export const arbLeafSemanticValue: fc.Arbitrary<SemanticValue> = fc.oneof(
  fc.string(),
  fc.integer(),
  fc.boolean(),
  fc.constant(null),
);

/** A complete, standalone variable — used directly by keyed-order-insensitivity tests. */
export const arbVariable: fc.Arbitrary<SourceVariable> = fc
  .tuple(
    arbIdentifier,
    fc.constantFrom(...CLASSIFICATIONS),
    arbLeafSemanticValue,
  )
  .map(([name, classification, exampleValue]) => ({
    name,
    classification,
    constraints: { enum: { value: exampleValue } },
    secretReferenceId: null,
    nonSensitiveExample: exampleValue,
  }));

/**
 * A minimal `SemanticSource` in maximally-omitted form: every field that
 * has a `FIELD_DECLARATIONS` entry is left absent, so property 2 (omitted
 * == explicit default) has something meaningful to compare against.
 */
export const arbBaseSource: fc.Arbitrary<SemanticSource> = fc
  .tuple(
    fc.string({ minLength: 1, maxLength: 40 }),
    arbIdentifier,
    arbIdentifier,
  )
  .map(([purpose, actionName, variableName]) => ({
    purpose,
    actor: { type: "guest" },
    entryPoint: { path: "/start" },
    actions: [{ action: actionName }],
    checkpoints: {
      entries: {
        "checkpoint-1": { id: "checkpoint-1", expectations: {} },
      },
    },
    variables: {
      [variableName]: {
        name: variableName,
        classification: "representative" as VariableClassification,
      },
    },
    outcomes: [{ id: "outcome-1" }],
    allowedVariation: [{ id: "variation-1" }],
    prohibitedRegressions: [{ id: "regression-1" }],
    readinessIntent: { sideEffectClass: "stateful" as const },
  }));

/**
 * Overrides `variables` on an existing source with the given array,
 * keeping every other field fixed. Deliberately array form (not
 * pre-keyed) so `normalize()`'s own `toKeyed` performs the keying —
 * otherwise a keyed-order-insensitivity property test would never
 * exercise the array-to-Record conversion it is meant to cover.
 */
export function withVariables(
  source: SemanticSource,
  variables: readonly SourceVariable[],
): SemanticSource {
  return { ...source, variables };
}

/**
 * Get/set accessors over a `SemanticSource`, one per `FIELD_DECLARATIONS`
 * key. `withValue` writes the raw value at that path (creating the
 * addressed entry inside a keyed Record when needed); `readNormalized`
 * reads the corresponding resolved value back out of a normalized
 * `SemanticBundle`.
 */
export interface PathAccessor {
  withValue(source: SemanticSource, value: unknown): SemanticSource;
  readNormalized(bundle: SemanticBundle): unknown;
}

function firstVariableKey(
  variables: SemanticSource["variables"],
): [string, SourceVariable] {
  const entries = Object.entries(
    variables as Readonly<Record<string, SourceVariable>>,
  );
  const first = entries[0];
  if (first === undefined) {
    throw new Error("Expected at least one variable to exercise the path accessor");
  }
  return first;
}

function withFirstVariable(
  source: SemanticSource,
  update: (variable: SourceVariable) => SourceVariable,
): SemanticSource {
  const [key, variable] = firstVariableKey(source.variables);
  return {
    ...source,
    variables: { ...(source.variables as Record<string, SourceVariable>), [key]: update(variable) },
  };
}

function firstNormalizedVariable(bundle: SemanticBundle) {
  const entries = Object.values(bundle.variables);
  const first = entries[0];
  if (first === undefined) {
    throw new Error("Expected at least one normalized variable");
  }
  return first;
}

function checkpointEntries(
  checkpoints: NonNullable<SemanticSource["checkpoints"]>,
): Readonly<Record<string, SourceCheckpoint>> {
  return checkpoints.entries as Readonly<Record<string, SourceCheckpoint>>;
}

export const PATH_ACCESSORS: Readonly<
  Record<keyof typeof FIELD_DECLARATIONS, PathAccessor>
> = {
  "actor.identityRef": {
    withValue: (source, value) => ({
      ...source,
      actor: { ...source.actor, identityRef: value as string | null },
    }),
    readNormalized: (bundle) => bundle.actor.identityRef,
  },
  "entryPoint.query": {
    withValue: (source, value) => ({
      ...source,
      entryPoint: {
        ...source.entryPoint,
        query: value as Readonly<Record<string, string>> | null,
      },
    }),
    readNormalized: (bundle) => bundle.entryPoint.query,
  },
  "entryPoint.fragment": {
    withValue: (source, value) => ({
      ...source,
      entryPoint: { ...source.entryPoint, fragment: value as string | null },
    }),
    readNormalized: (bundle) => bundle.entryPoint.fragment,
  },
  "checkpoints.ordered": {
    withValue: (source, value) => ({
      ...source,
      checkpoints: source.checkpoints
        ? { ...source.checkpoints, ordered: value as boolean | null }
        : { ordered: value as boolean | null, entries: {} },
    }),
    readNormalized: (bundle) => bundle.checkpoints.ordering === "ordered",
  },
  "variable.constraints": {
    withValue: (source, value) =>
      withFirstVariable(source, (variable) => ({
        ...variable,
        constraints: value as SourceVariable["constraints"],
      })),
    readNormalized: (bundle) => firstNormalizedVariable(bundle).constraints,
  },
  "variable.secretReferenceId": {
    withValue: (source, value) =>
      withFirstVariable(source, (variable) => ({
        ...variable,
        secretReferenceId: value as string | null,
      })),
    readNormalized: (bundle) =>
      firstNormalizedVariable(bundle).secretReferenceId,
  },
  "variable.nonSensitiveExample": {
    withValue: (source, value) =>
      withFirstVariable(source, (variable) => ({
        ...variable,
        nonSensitiveExample: value as SemanticValue | null,
      })),
    readNormalized: (bundle) =>
      firstNormalizedVariable(bundle).nonSensitiveExample,
  },
  "action.target": {
    withValue: (source, value) => {
      const [first, ...rest] = source.actions;
      if (first === undefined) {
        throw new Error("Expected at least one action to exercise the path accessor");
      }
      return {
        ...source,
        actions: [{ ...first, target: value as string | null }, ...rest],
      };
    },
    readNormalized: (bundle) => {
      const first = bundle.actions[0];
      if (first === undefined) {
        throw new Error("Expected at least one normalized action");
      }
      return first.target;
    },
  },
  "action.value": {
    withValue: (source, value) => {
      const [first, ...rest] = source.actions;
      if (first === undefined) {
        throw new Error("Expected at least one action to exercise the path accessor");
      }
      return {
        ...source,
        actions: [
          { ...first, value: value as SemanticSourceCore["actions"][number]["value"] },
          ...rest,
        ],
      };
    },
    readNormalized: (bundle) => {
      const first = bundle.actions[0];
      if (first === undefined) {
        throw new Error("Expected at least one normalized action");
      }
      return first.value;
    },
  },
  "checkpoint.afterAction": {
    withValue: (source, value) => {
      const checkpoints = source.checkpoints ?? { entries: {} };
      const entries = checkpointEntries(checkpoints);
      const first = Object.entries(entries)[0];
      if (first === undefined) {
        throw new Error("Expected at least one checkpoint to exercise the path accessor");
      }
      const [key, entry] = first;
      return {
        ...source,
        checkpoints: {
          ...checkpoints,
          entries: {
            ...entries,
            [key]: { ...entry, afterAction: value as string | null },
          },
        },
      };
    },
    readNormalized: (bundle) => {
      if (bundle.checkpoints.ordering === "keyed") {
        const first = Object.values(bundle.checkpoints.entries)[0];
        if (first === undefined) {
          throw new Error("Expected at least one normalized checkpoint");
        }
        return first.afterAction;
      }
      const first = bundle.checkpoints.entries[0];
      if (first === undefined) {
        throw new Error("Expected at least one normalized checkpoint");
      }
      return first.afterAction;
    },
  },
  "declaration.description": {
    withValue: (source, value) => {
      const outcomes = source.outcomes;
      if (!Array.isArray(outcomes) || outcomes.length === 0) {
        throw new Error("Expected at least one outcome to exercise the path accessor");
      }
      const [first, ...rest] = outcomes as readonly {
        readonly id: string;
        readonly description?: string | null;
      }[];
      if (first === undefined) {
        throw new Error("Expected at least one outcome to exercise the path accessor");
      }
      const updatedOutcomes: readonly {
        readonly id: string;
        readonly description?: string | null;
      }[] = [{ ...first, description: value as string | null }, ...rest];
      return { ...source, outcomes: updatedOutcomes } as SemanticSource;
    },
    readNormalized: (bundle) => {
      const first = Object.values(bundle.outcomes)[0];
      if (first === undefined) {
        throw new Error("Expected at least one normalized outcome");
      }
      return first.description;
    },
  },
  "readinessIntent.isolation": {
    withValue: (source, value) => ({
      ...source,
      readinessIntent: {
        ...source.readinessIntent,
        isolation: value as SemanticSourceCore["readinessIntent"]["isolation"],
      },
    }),
    readNormalized: (bundle) => bundle.readinessIntent.isolation,
  },
  "isolation.scope": {
    withValue: (source, value) => {
      const isolation = source.readinessIntent.isolation ?? {
        strategy: "reset-fixture",
      };
      // `value` is either the raw array/null/undefined shape addressed by
      // the source, or (from FIELD_DECLARATIONS[path].declaredDefault) the
      // already-keyed `SemanticKeySet` shape ({}); accept all four so the
      // same accessor exercises "write raw" (property 3) and "write
      // omitted vs. the declared default" (property 2) uniformly. null and
      // undefined are kept distinct — resolveDeclared treats them
      // differently.
      let scope: readonly string[] | null | undefined;
      if (Array.isArray(value)) {
        scope = value as readonly string[];
      } else if (value === null) {
        scope = null;
      } else if (value === undefined) {
        scope = undefined;
      } else {
        scope = Object.keys(value as Readonly<Record<string, unknown>>);
      }
      return {
        ...source,
        readinessIntent: {
          ...source.readinessIntent,
          isolation: { ...isolation, scope },
        },
      };
    },
    readNormalized: (bundle) => bundle.readinessIntent.isolation?.scope ?? null,
  },
};

export const FIELD_DECLARATION_PATHS = Object.keys(
  FIELD_DECLARATIONS,
) as (keyof typeof FIELD_DECLARATIONS)[];
