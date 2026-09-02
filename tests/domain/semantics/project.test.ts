import { describe, expect, it } from "vitest";
import { project } from "../../../src/domain/semantics/index.js";
import type { SemanticSource } from "../../../src/domain/semantics/index.js";

const ALLOWED_KEYS = [
  "purpose",
  "actor",
  "entryPoint",
  "actions",
  "checkpoints",
  "variables",
  "outcomes",
  "allowedVariation",
  "prohibitedRegressions",
  "readinessIntent",
] as const;

function richFixture(): SemanticSource {
  return {
    purpose: "Renew an active policy",
    actor: { type: "guest", identityRef: "actor-ref-1" },
    entryPoint: {
      path: "/policies/renew",
      query: { term: "12" },
      fragment: "top",
    },
    actions: [
      {
        action: "select_policy",
        target: "policy-list",
        value: { kind: "literal", value: "policy-42" },
      },
      {
        action: "confirm_renewal",
        target: "confirm-button",
        value: { kind: "variable", variable: "renewalTerm" },
      },
    ],
    checkpoints: {
      ordered: false,
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
        constraints: { enum: { value: ["6-month", "12-month"] } },
        secretReferenceId: null,
        nonSensitiveExample: "12-month",
      },
    },
    outcomes: [
      { id: "policy-renewed", description: "Policy renewal recorded" },
    ],
    allowedVariation: [
      { id: "term-length", description: "Renewal term may vary" },
    ],
    prohibitedRegressions: [
      { id: "no-lapse", description: "Coverage must never lapse" },
    ],
    readinessIntent: {
      sideEffectClass: "stateful",
      isolation: { strategy: "reset-fixture", scope: ["policy-db"] },
    },
  };
}

describe("project — inclusion", () => {
  it("projects the ten allowed fields in normalized form", () => {
    const projection = project(richFixture());

    expect(projection.purpose).toBe("Renew an active policy");
    expect(projection.actor).toEqual({
      type: "guest",
      identityRef: "actor-ref-1",
    });
    expect(projection.entryPoint).toEqual({
      path: "/policies/renew",
      query: { term: "12" },
      fragment: "top",
    });
    expect(projection.actions).toEqual([
      {
        action: "select_policy",
        target: "policy-list",
        value: { kind: "literal", value: "policy-42" },
      },
      {
        action: "confirm_renewal",
        target: "confirm-button",
        value: { kind: "variable", variable: "renewalTerm" },
      },
    ]);
    expect(projection.checkpoints).toEqual({
      ordering: "keyed",
      entries: {
        "renewal-confirmed": {
          id: "renewal-confirmed",
          afterAction: "confirm_renewal",
          expectations: { status: "active" },
        },
      },
    });
    expect(projection.variables).toEqual({
      renewalTerm: {
        name: "renewalTerm",
        classification: "representative",
        constraints: { enum: { kind: "enum", value: ["6-month", "12-month"] } },
        secretReferenceId: null,
        nonSensitiveExample: "12-month",
      },
    });
    expect(projection.outcomes).toEqual({
      "policy-renewed": {
        id: "policy-renewed",
        description: "Policy renewal recorded",
      },
    });
    expect(projection.allowedVariation).toEqual({
      "term-length": { id: "term-length", description: "Renewal term may vary" },
    });
    expect(projection.prohibitedRegressions).toEqual({
      "no-lapse": { id: "no-lapse", description: "Coverage must never lapse" },
    });
    expect(projection.readinessIntent).toEqual({
      sideEffectClass: "stateful",
      isolation: { strategy: "reset-fixture", scope: { "policy-db": true } },
    });
  });
});

function fixtureWithExcludedFields(): SemanticSource {
  return {
    ...richFixture(),
    projectId: "project-123",
    beaconId: "beacon-456",
    draftId: "draft-789",
    contractVersion: "pharos.beacon-semantics/3",
    localAddress: "http://localhost:4000",
    title: "Renew Policy (local draft)",
    schemaVersion: "pharos.beacon-semantics/3",
    approvalMetadata: {
      approvedBy: "reviewer-1",
      approvedAt: "2026-01-01T00:00:00Z",
    },
    artifactRefs: ["s3://bucket/artifact-1"],
    secretContents: { apiKey: "sk-super-secret-value" },
    runtimeResolvedValues: { resolvedHost: "https://staging.pharos.example" },
    setupMechanics: { seedScript: "scripts/seed.ts" },
    readinessValidationResults: {
      checksPassed: true,
      lastRunAt: "2026-01-01T00:00:00Z",
    },
  };
}

const EXCLUDED_TOKENS = [
  "project-123",
  "beacon-456",
  "draft-789",
  "pharos.beacon-semantics/3",
  "http://localhost:4000",
  "Renew Policy (local draft)",
  "reviewer-1",
  "s3://bucket/artifact-1",
  "sk-super-secret-value",
  "https://staging.pharos.example",
  "scripts/seed.ts",
  "checksPassed",
];

describe("project — exclusion", () => {
  it("drops identities, local address/title, schema version, approval metadata, artifact refs, secret contents, runtime-resolved values, setup mechanics, and readiness-validation results", () => {
    const projection = project(fixtureWithExcludedFields());
    const serialized = JSON.stringify(projection);

    for (const token of EXCLUDED_TOKENS) {
      expect(serialized).not.toContain(token);
    }
    expect(Object.keys(projection).sort()).toEqual([...ALLOWED_KEYS].sort());
  });
});

describe("project — ordered vs default-keyed checkpoints", () => {
  it("preserves declared-ordered checkpoints as an ordered sequence", () => {
    const source: SemanticSource = {
      ...richFixture(),
      checkpoints: {
        ordered: true,
        entries: [
          {
            id: "step-1",
            afterAction: "select_policy",
            expectations: { visible: true },
          },
          {
            id: "step-2",
            afterAction: "confirm_renewal",
            expectations: { status: "active" },
          },
        ],
      },
    };

    const projection = project(source);

    expect(projection.checkpoints).toEqual({
      ordering: "ordered",
      entries: [
        {
          id: "step-1",
          afterAction: "select_policy",
          expectations: { visible: true },
        },
        {
          id: "step-2",
          afterAction: "confirm_renewal",
          expectations: { status: "active" },
        },
      ],
    });
  });

  it("defaults undeclared checkpoints to a keyed, order-insensitive collection", () => {
    const source: SemanticSource = {
      ...richFixture(),
      checkpoints: {
        entries: {
          "renewal-confirmed": {
            id: "renewal-confirmed",
            afterAction: "confirm_renewal",
            expectations: { status: "active" },
          },
        },
      },
    };

    const projection = project(source);

    expect(projection.checkpoints).toEqual({
      ordering: "keyed",
      entries: {
        "renewal-confirmed": {
          id: "renewal-confirmed",
          afterAction: "confirm_renewal",
          expectations: { status: "active" },
        },
      },
    });
  });
});
