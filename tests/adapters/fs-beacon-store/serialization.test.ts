import type { SemanticProjection, SemanticSource } from "../../../src/domain/semantics/types.js";
import { describe, expect, it } from "vitest";
import {
  classifyContract,
  deserializeRecord,
  serializeRecord,
  type FileKind,
} from "../../../src/adapters/fs-beacon-store/serialization.js";

const cases: readonly [FileKind, Record<string, unknown>][] = [
  ["beacon", { beaconId: "bcn_1", title: "Beacon" }],
  ["active", { activeVersionId: "ver_1" }],
  ["draft", { draftId: "draft_1", status: "open", revision: 1 }],
  ["tombstone", { draftId: "draft_1", reason: "done" }],
  ["manifest", { versionId: "ver_1", localNumber: 1 }],
  ["semantics", { purpose: "test", actions: [] }],
  ["revocation", { previousStatus: "active", reason: "retired" }],
  ["idempotency", { key: "K", inputHash: "sha256:abc" }],
];

const opaqueKeys = Object.fromEntries([
  ["foo_bar", "underscore"],
  ["fooBar", "camel"],
  ["__proto__", "prototype-key"],
  ["", "empty-key"],
  ["ключ", "unicode-key"],
]);

const query: Record<string, string> = opaqueKeys;
const scope: Record<string, true> = Object.fromEntries(
  Object.keys(opaqueKeys).map((key) => [key, true as const]),
);

const source: SemanticSource = {
  purpose: "purpose",
  actor: { type: "user" },
  entryPoint: { path: "/", query: null },
  actions: [{ action: "set", value: opaqueKeys }],
  readinessIntent: { sideEffectClass: "stateless" },
  excluded_foo: opaqueKeys,
};

const projection: SemanticProjection = {
  purpose: "purpose",
  actor: { type: "user", identityRef: null },
  entryPoint: { path: "/", query, fragment: null },
  actions: [{ action: "set", target: null, value: { kind: "literal", value: opaqueKeys } }],
  checkpoints: {
    ordering: "keyed",
    entries: { checkpoint: { id: "checkpoint", afterAction: null, expectations: opaqueKeys } },
  },
  variables: {
    variable: {
      name: "variable",
      classification: "test_data",
      constraints: { "constraint_key": { kind: "constraint_key", value: opaqueKeys } },
      secretReferenceId: null,
      nonSensitiveExample: opaqueKeys,
    },
  },
  outcomes: { outcome: { id: "outcome", description: null } },
  allowedVariation: { variation: { id: "variation", description: null } },
  prohibitedRegressions: { regression: { id: "regression", description: null } },
  readinessIntent: {
    sideEffectClass: "stateful",
    isolation: { strategy: "project", scope },
  },
};

describe("contract-string serialization", () => {
  it.each(cases)("round-trips %s", (kind, value) => {
    const bytes = serializeRecord(kind, value);
    const parsed = deserializeRecord(kind, bytes);

    expect(parsed).toEqual(value);
  });

  it("preserves every caller key and literal value in draft content", () => {
    const value = { draftId: "draft_1", content: source };
    expect(deserializeRecord("draft", serializeRecord("draft", value))).toEqual(value);
  });

  it("preserves caller-keyed projection records and opaque values", () => {
    const value = projection;
    expect(deserializeRecord("semantics", serializeRecord("semantics", value))).toEqual(value);
  });

  it("is byte-stable when K1 input insertion order changes", () => {
    const reordered: SemanticProjection = {
      ...projection,
      actor: { identityRef: null, type: "user" },
    };

    expect(serializeRecord("semantics", projection)).toBe(
      serializeRecord("semantics", reordered),
    );
    expect(serializeRecord("semantics", projection)).toBe(
      serializeRecord("semantics", projection),
    );
  });

  it("classifies a contract with a major version other than 1 as corrupt", () => {
    expect(classifyContract("pharos.beacon/2")).toBe("corrupt");
    expect(classifyContract("pharos.beacon/1")).toBe("valid");
  });
});
