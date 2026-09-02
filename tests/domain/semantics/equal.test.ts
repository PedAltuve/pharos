import { describe, expect, it } from "vitest";
import { isMigrationEquivalent, projectionsEqual } from "../../../src/domain/semantics/index.js";
import type { SemanticProjection } from "../../../src/domain/semantics/index.js";

function baseProjection(): SemanticProjection {
  return {
    purpose: "Renew an active policy",
    actor: { type: "guest", identityRef: null },
    entryPoint: { path: "/policies/renew", query: null, fragment: null },
    actions: [
      { action: "select_policy", target: "policy-list", value: null },
      {
        action: "confirm_renewal",
        target: "confirm-button",
        value: { kind: "variable", variable: "renewalTerm" },
      },
    ],
    checkpoints: {
      ordering: "keyed",
      entries: {
        "renewal-confirmed": {
          id: "renewal-confirmed",
          afterAction: "confirm_renewal",
          expectations: { status: "active" },
        },
      },
    },
    variables: {
      renewalTerm: {
        name: "renewalTerm",
        classification: "representative",
        constraints: {
          enum: { kind: "enum", value: ["6-month", "12-month"] },
        },
        secretReferenceId: null,
        nonSensitiveExample: "12-month",
      },
    },
    outcomes: {
      "policy-renewed": { id: "policy-renewed", description: "Policy renewal recorded" },
    },
    allowedVariation: {
      "term-length": { id: "term-length", description: "Renewal term may vary" },
    },
    prohibitedRegressions: {
      "no-lapse": { id: "no-lapse", description: "Coverage must never lapse" },
    },
    readinessIntent: {
      sideEffectClass: "stateful",
      isolation: { strategy: "reset-fixture", scope: { "policy-db": true } },
    },
  };
}

describe("projectionsEqual", () => {
  it("reports true for a projection compared against itself (reflexivity)", () => {
    const projection = baseProjection();

    expect(projectionsEqual(projection, projection)).toBe(true);
  });

  it("reports true for two independently-built but structurally identical projections", () => {
    const a = baseProjection();
    const b = baseProjection();

    expect(a).not.toBe(b);
    expect(projectionsEqual(a, b)).toBe(true);
  });

  it("treats -0 and 0 as equal leaves", () => {
    const a: SemanticProjection = {
      ...baseProjection(),
      variables: {
        renewalTerm: {
          ...baseProjection().variables["renewalTerm"]!,
          constraints: { enum: { kind: "numeric", value: -0 } },
        },
      },
    };
    const b: SemanticProjection = {
      ...baseProjection(),
      variables: {
        renewalTerm: {
          ...baseProjection().variables["renewalTerm"]!,
          constraints: { enum: { kind: "numeric", value: 0 } },
        },
      },
    };

    expect(projectionsEqual(a, b)).toBe(true);
  });

  it("reports false when an included field differs", () => {
    const a = baseProjection();
    const b: SemanticProjection = {
      ...baseProjection(),
      purpose: "Cancel an active policy",
    };

    expect(projectionsEqual(a, b)).toBe(false);
  });

  it("reports false when checkpoints differ between keyed and ordered representations", () => {
    const keyed = baseProjection();
    const ordered: SemanticProjection = {
      ...baseProjection(),
      checkpoints: {
        ordering: "ordered",
        entries: [
          {
            id: "renewal-confirmed",
            afterAction: "confirm_renewal",
            expectations: { status: "active" },
          },
        ],
      },
    };

    expect(projectionsEqual(keyed, ordered)).toBe(false);
  });
});

describe("isMigrationEquivalent", () => {
  it("reports true for a source and target expressing the same schema-independent meaning", () => {
    const source = baseProjection();
    const target = baseProjection();

    expect(isMigrationEquivalent(source, target)).toBe(true);
  });

  it("reports false for a source and target differing in an included field", () => {
    const source = baseProjection();
    const target: SemanticProjection = {
      ...baseProjection(),
      readinessIntent: { sideEffectClass: "stateless", isolation: null },
    };

    expect(isMigrationEquivalent(source, target)).toBe(false);
  });
});
