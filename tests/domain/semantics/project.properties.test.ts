import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  FIELD_DECLARATIONS,
  normalize,
  project,
  projectionsEqual,
  resolveDeclared,
} from "../../../src/domain/semantics/index.js";
import type {
  FieldDeclaration,
  SemanticSource,
} from "../../../src/domain/semantics/index.js";
import {
  arbBaseSource,
  arbVariable,
  FIELD_DECLARATION_PATHS,
  PATH_ACCESSORS,
  withVariables,
} from "./arbitraries.js";

function baseSource(): SemanticSource {
  return {
    purpose: "Exercise property coverage",
    actor: { type: "guest" },
    entryPoint: { path: "/start" },
    actions: [{ action: "start" }],
    checkpoints: { entries: {} },
    variables: {},
    outcomes: [],
    allowedVariation: [],
    prohibitedRegressions: [],
    readinessIntent: { sideEffectClass: "stateless" },
  };
}

describe("project — property-based coverage", () => {
  it("keyed-order insensitivity: reordering a keyed collection never changes the projection", () => {
    fc.assert(
      fc.property(
        fc
          .uniqueArray(arbVariable, {
            selector: (variable) => variable.name,
            minLength: 1,
            maxLength: 6,
          })
          .chain((entries) =>
            fc.tuple(
              fc.constant(entries),
              fc.shuffledSubarray(entries, {
                minLength: entries.length,
                maxLength: entries.length,
              }),
            ),
          ),
        ([original, shuffled]) => {
          const a = project(withVariables(baseSource(), original));
          const b = project(withVariables(baseSource(), shuffled));

          expect(projectionsEqual(a, b)).toBe(true);
        },
      ),
    );
  });

  it("omitted == explicit default: leaving a declared field absent equals stating its declared default", () => {
    fc.assert(
      fc.property(
        arbBaseSource,
        fc.constantFrom(...FIELD_DECLARATION_PATHS),
        (source, path) => {
          const declaration = FIELD_DECLARATIONS[path];
          const accessor = PATH_ACCESSORS[path];
          // Write "omitted" (undefined) and the declared default at the
          // SAME path on the SAME base, so only that one field's presence
          // varies — a nested path (e.g. `isolation.scope`) must not also
          // toggle its parent's own presence between the two variants.
          const omittedSource = accessor.withValue(source, undefined);
          const explicitSource = accessor.withValue(
            source,
            declaration.declaredDefault,
          );

          expect(
            projectionsEqual(project(omittedSource), project(explicitSource)),
          ).toBe(true);
        },
      ),
    );
  });

  it("null only where declared: null resolves per each field's nullHasDomainMeaning declaration", () => {
    fc.assert(
      fc.property(
        arbBaseSource,
        fc.constantFrom(...FIELD_DECLARATION_PATHS),
        (source, path) => {
          const declaration = FIELD_DECLARATIONS[path];
          const accessor = PATH_ACCESSORS[path];
          const updated = accessor.withValue(source, null);
          const bundle = normalize(updated);
          const expected = declaration.nullHasDomainMeaning
            ? null
            : declaration.declaredDefault;

          expect(accessor.readNormalized(bundle)).toEqual(expected);
        },
      ),
    );

    // Domain-independent contract check: every `nullHasDomainMeaning: true`
    // entry in FIELD_DECLARATIONS happens to declare `null` as its own
    // `declaredDefault` too, so the pipeline-level check above alone cannot
    // distinguish "null preserved because it is meaningful" from "null
    // always resolved to a coincidentally-null default". This exercises
    // `resolveDeclared` directly with a synthetic, non-null default so the
    // two branches are genuinely falsifiable.
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.string({ minLength: 1 }),
        (nullHasDomainMeaning, declaredDefault) => {
          const declaration: FieldDeclaration<string | null> = {
            declaredDefault,
            nullHasDomainMeaning,
          };
          const expected = nullHasDomainMeaning ? null : declaredDefault;

          expect(resolveDeclared<string>(null, declaration)).toEqual(expected);
        },
      ),
    );
  });
});
