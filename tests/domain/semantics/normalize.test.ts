import { describe, expect, it } from "vitest";
import {
  FIELD_DECLARATIONS,
  normalize,
  resolveDeclared,
  toKeyed,
} from "../../../src/domain/semantics/index.js";
import type {
  FieldDeclaration,
  SemanticSource,
} from "../../../src/domain/semantics/index.js";
import { FIELD_DECLARATION_PATHS, PATH_ACCESSORS } from "./arbitraries.js";

interface NamedThing {
  readonly name: string;
  readonly value: number;
}

const declarationEntries = Object.entries(FIELD_DECLARATIONS) as [
  string,
  FieldDeclaration<unknown>,
][];

describe.each(declarationEntries)(
  "resolveDeclared for FIELD_DECLARATIONS[%s]",
  (path, declaration) => {
    it("resolves an omitted (undefined) value to the declared default", () => {
      expect(resolveDeclared<unknown>(undefined, declaration)).toEqual(
        declaration.declaredDefault,
      );
    });

    it("resolves a null value per nullHasDomainMeaning", () => {
      const expected = declaration.nullHasDomainMeaning
        ? null
        : declaration.declaredDefault;

      expect(resolveDeclared<unknown>(null, declaration)).toEqual(expected);
    });

    it("passes a present, non-null value through unchanged", () => {
      const raw = { sentinel: `${path}-present-value` };

      expect(resolveDeclared<unknown>(raw, declaration)).toBe(raw);
    });
  },
);

describe("resolveDeclared — declared-null contrast pair", () => {
  it("preserves null for entryPoint.query (null has domain meaning: unconstrained)", () => {
    const declaration = FIELD_DECLARATIONS["entryPoint.query"];

    expect(resolveDeclared(null, declaration)).toBeNull();
  });

  it("resolves null to the declared default for variable.constraints (null has no domain meaning)", () => {
    const declaration = FIELD_DECLARATIONS["variable.constraints"];

    expect(resolveDeclared(null, declaration)).toEqual({});
  });
});

describe("toKeyed", () => {
  it("keys entries from array form by their identity field", () => {
    const entries: readonly NamedThing[] = [
      { name: "a", value: 1 },
      { name: "b", value: 2 },
    ];

    expect(toKeyed(entries, (entry) => entry.name)).toEqual({
      a: { name: "a", value: 1 },
      b: { name: "b", value: 2 },
    });
  });

  it("keys entries already in object form, confirming identity matches the record key", () => {
    const entries: Readonly<Record<string, NamedThing>> = {
      a: { name: "a", value: 1 },
    };

    expect(toKeyed(entries, (entry) => entry.name)).toEqual({
      a: { name: "a", value: 1 },
    });
  });

  it("throws when an object-form entry's identity field disagrees with its record key", () => {
    const entries: Readonly<Record<string, NamedThing>> = {
      a: { name: "mismatched", value: 1 },
    };

    expect(() => toKeyed(entries, (entry) => entry.name)).toThrow(
      /mismatched.*"a"|"a".*mismatched/i,
    );
  });

  it("throws when array-form input carries a duplicate identity", () => {
    const entries: readonly NamedThing[] = [
      { name: "a", value: 1 },
      { name: "a", value: 2 },
    ];

    expect(() => toKeyed(entries, (entry) => entry.name)).toThrow(/duplicate/i);
  });
});

describe("PATH_ACCESSORS", () => {
  function fixtureSource(): SemanticSource {
    return {
      purpose: "Exercise path accessors",
      actor: { type: "guest" },
      entryPoint: { path: "/start" },
      actions: [{ action: "start" }],
      checkpoints: {
        entries: { "checkpoint-1": { id: "checkpoint-1", expectations: {} } },
      },
      variables: {
        "variable-1": { name: "variable-1", classification: "representative" },
      },
      outcomes: [{ id: "outcome-1" }],
      allowedVariation: [{ id: "variation-1" }],
      prohibitedRegressions: [{ id: "regression-1" }],
      readinessIntent: { sideEffectClass: "stateful" },
    };
  }

  it.each(FIELD_DECLARATION_PATHS)(
    "writes null at %s (including entries inside keyed Records) and reads the declared resolution back from the normalized bundle",
    (path) => {
      const declaration = FIELD_DECLARATIONS[path];
      const accessor = PATH_ACCESSORS[path];
      const updated = accessor.withValue(fixtureSource(), null);
      const bundle = normalize(updated);
      const expected = declaration.nullHasDomainMeaning
        ? null
        : declaration.declaredDefault;

      expect(accessor.readNormalized(bundle)).toEqual(expected);
    },
  );
});
