import { readFile } from "node:fs/promises";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { project } from "../../../src/domain/semantics/index.js";
import type { SemanticSource } from "../../../src/domain/semantics/index.js";
import { jsonEnvelope } from "../../../src/cli/envelope.js";

const schemaUrl = (name: string) => new URL(`../../../src/contracts/schemas/${name}.schema.json`, import.meta.url);

async function schema(name: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(schemaUrl(name), "utf8")) as Record<string, unknown>;
}

async function validator(name: string) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  return ajv.compile(await schema(name));
}

const validAnnotation = {
  contract: "pharos.capture-annotation/1",
  title: "Renew checkout",
  purpose: "Renew the active checkout",
  actor: { type: "guest", identity_ref: null },
  entry_point: { path: "/checkout", query: null, fragment: null },
  actions: [{ action: "continue_checkout", target: "checkout-form", value: null }],
  checkpoints: { ordered: true, entries: [{ id: "checkout-open", after_action: null, expectations: { visible: true } }] },
  variables: [],
  outcomes: [{ id: "checkout-renewed", description: "Checkout is renewed" }],
  allowed_variation: [],
  prohibited_regressions: [{ id: "no-double-charge", description: "Charge only once" }],
  readiness_intent: { side_effect_class: "stateless", isolation: null },
};

describe("host consent JSON contracts", () => {
  it("rejects impossible expiry values instead of interpreting calendar-shaped text", async () => {
    const request = await validator("operator-consent-request");
    const grant = await validator("operator-consent-grant");
    const binding = { action: "approve", projectId: "p", beaconId: "b", draftId: "d", expectedRevision: 1, semanticHash: "h", requestId: "r" };
    const base = { binding, challengeId: "c", expiresAtEpochMs: 1893456000000 };
    expect(request({ contract: "pharos.operator-consent-request/1", ...base })).toBe(true);
    expect(grant({ contract: "pharos.operator-consent-grant/1", decision: "granted", ...base, hostId: "h", keyId: "k", algorithm: "ed25519", signature: "s" })).toBe(true);
    for (const expiry of ["2030-02-30T99:99:99Z", -1, 1.5, "1893456000000"]) {
      expect(request({ contract: "pharos.operator-consent-request/1", ...base, expiresAtEpochMs: expiry })).toBe(false);
      expect(grant({ contract: "pharos.operator-consent-grant/1", decision: "granted", ...base, expiresAtEpochMs: expiry, hostId: "h", keyId: "k", algorithm: "ed25519", signature: "s" })).toBe(false);
    }
  });

  it("accepts exact approval and revocation requests and signed decisions", async () => {
    const request = await validator("operator-consent-request");
    const grant = await validator("operator-consent-grant");
    const binding = { action: "approve", projectId: "p", beaconId: "b", draftId: "d", expectedRevision: 1, semanticHash: "sha256:x", requestId: "r", staleOriginAcknowledged: true };
    const base = { binding, challengeId: "c", expiresAtEpochMs: 1893456000000 };
    const requested = { contract: "pharos.operator-consent-request/1", ...base };
    const signed = { contract: "pharos.operator-consent-grant/1", decision: "granted", ...base, hostId: "host", keyId: "key", algorithm: "ed25519", signature: "signed" };
    const revoke = { action: "revoke", projectId: "p", beaconId: "b", expectedActiveVersion: "v", reason: "retire", requestId: "r" };
    expect(request(requested)).toBe(true);
    expect(request({ ...requested, binding: revoke })).toBe(true);
    expect(grant(signed)).toBe(true);
    expect(grant({ ...signed, decision: "declined", binding: revoke })).toBe(true);
    for (const bad of [true, "operator", { tokenId: "arbitrary" }, { ...signed, signature: "" }, { ...signed, signature: undefined }, { ...signed, contract: "pharos.operator-consent-grant/2" }, { ...signed, privateKey: "secret" }, { ...signed, binding: { ...binding, action: "revoke" } }, { ...signed, binding: { ...binding, expectedRevision: Number.MAX_SAFE_INTEGER + 1 } }, { ...signed, binding: { ...revoke, reason: "  " } }]) expect(grant(bad)).toBe(false);
    for (const bad of [{ ...requested, contract: "pharos.operator-consent-request/2" }, { ...requested, binding: { ...binding, expectedRevision: "1" } }, { ...requested, binding: { ...binding, expectedRevision: Number.MAX_SAFE_INTEGER + 1 } }, { ...requested, binding: { ...revoke, reason: " trailing " } }]) expect(request(bad)).toBe(false);
  });
});

describe("isolated v2 stale approval JSON contracts", () => {
  it("accepts complete stale approval requests and signed grants without changing v1 non-stale acceptance", async () => {
    const request = await validator("operator-consent-request-v2");
    const grant = await validator("operator-consent-grant-v2");
    const binding = { action: "approve", projectId: "p", beaconId: "b", draftId: "d", expectedRevision: 1, semanticHash: "sha256:draft", requestId: "r", staleOriginAcknowledged: true, reviewed: { activeVersionId: "v", activeSemanticHash: "sha256:active", comparisonDigest: "sha256:comparison" } };
    const base = { binding, challengeId: "c", expiresAtEpochMs: 1893456000000 };
    expect(request({ contract: "pharos.operator-consent-request/2", ...base })).toBe(true);
    expect(grant({ contract: "pharos.operator-consent-grant/2", decision: "granted", ...base, hostId: "host", keyId: "key", algorithm: "ed25519", signature: "signed" })).toBe(true);
    expect(request({ contract: "pharos.operator-consent-request/2", ...base, binding: { ...binding, reviewed: { activeVersionId: null, activeSemanticHash: null, comparisonDigest: "sha256:none" } } })).toBe(true);
    const v1 = { action: "approve", projectId: "p", beaconId: "b", draftId: "d", expectedRevision: 1, semanticHash: "sha256:draft", requestId: "r" };
    expect((await validator("operator-consent-request"))({ contract: "pharos.operator-consent-request/1", ...base, binding: v1 })).toBe(true);
    expect((await validator("operator-consent-grant"))({ contract: "pharos.operator-consent-grant/1", decision: "granted", ...base, binding: v1, hostId: "host", keyId: "key", algorithm: "ed25519", signature: "signed" })).toBe(true);
  });

  it("rejects incomplete or unsafe v2 bindings and envelopes for both request and grant", async () => {
    const request = await validator("operator-consent-request-v2");
    const grant = await validator("operator-consent-grant-v2");
    const binding = { action: "approve", projectId: "p", beaconId: "b", draftId: "d", expectedRevision: 1, semanticHash: "h", requestId: "r", staleOriginAcknowledged: true, reviewed: { activeVersionId: "v", activeSemanticHash: "h", comparisonDigest: "digest" } };
    const base = { binding, challengeId: "c", expiresAtEpochMs: 1893456000000 };
    const accepts = (value: Record<string, unknown>) => {
      expect(request({ contract: "pharos.operator-consent-request/2", ...base, ...value })).toBe(false);
      expect(grant({ contract: "pharos.operator-consent-grant/2", decision: "granted", ...base, hostId: "host", keyId: "key", algorithm: "ed25519", signature: "signed", ...value })).toBe(false);
    };
    for (const field of ["activeVersionId", "activeSemanticHash", "comparisonDigest"] as const) {
      const reviewed: Record<string, unknown> = { ...binding.reviewed };
      delete reviewed[field];
      accepts({ binding: { ...binding, reviewed } });
    }
    accepts({ binding: { ...binding, reviewed: { ...binding.reviewed, activeVersionId: null } } });
    accepts({ binding: { ...binding, reviewed: { ...binding.reviewed, activeSemanticHash: null } } });
    accepts({ binding: { ...binding, reviewed: { ...binding.reviewed, extra: true } } });
    accepts({ binding: { ...binding, extra: true } });
    accepts({ extra: true });
    accepts({ binding: { ...binding, action: "revoke" } });
    accepts({ binding: { action: "revoke", projectId: "p", beaconId: "b", expectedActiveVersion: "v", reason: "retire", requestId: "r" } });
    accepts({ binding: { ...binding, staleOriginAcknowledged: false } });
    for (const revision of [0, 1.5, Number.MAX_SAFE_INTEGER + 1]) accepts({ binding: { ...binding, expectedRevision: revision } });
    for (const expiry of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, "1893456000000"]) accepts({ expiresAtEpochMs: expiry });
    expect(request({ contract: "pharos.operator-consent-request/1", ...base })).toBe(false);
    expect(grant({ contract: "pharos.operator-consent-grant/1", decision: "granted", ...base, hostId: "host", keyId: "key", algorithm: "ed25519", signature: "signed" })).toBe(false);
  });
});

describe("v1 JSON Schema 2020-12 ingress contracts", () => {
  it("declares three closed draft-2020-12 contracts and accepts their complete valid shapes", async () => {
    const [projectInit, annotation, envelope] = await Promise.all([
      schema("project-init"),
      schema("capture-annotation"),
      schema("cli-envelope"),
    ]);
    for (const contract of [projectInit, annotation, envelope]) {
      expect(contract.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
      expect(contract.additionalProperties).toBe(false);
    }

    expect((await validator("project-init"))({
      contract: "pharos.project-init/1",
      project_name: "Checkout",
      mode: "external",
      environment: "staging",
      base_url: "https://staging.example.test",
      association_path: "/operator/checkout",
    })).toBe(true);
    expect((await validator("capture-annotation"))(validAnnotation)).toBe(true);
    expect((await validator("cli-envelope"))({
      contract: "pharos.cli-envelope/1",
      command: "capture.annotate",
      outcome: "succeeded",
      data: {},
      errors: [],
      next_action: null,
    })).toBe(true);
  });

  it("refuses production, incomplete and unknown project/annotation/envelope fields at ingress", async () => {
    const projectInit = await validator("project-init");
    expect(projectInit({
      contract: "pharos.project-init/1", project_name: "Checkout", mode: "external", environment: "production", base_url: "https://example.test", association_path: "/operator/checkout",
    })).toBe(false);
    expect(projectInit({
      contract: "pharos.project-init/1", project_name: "Checkout", mode: "external", environment: "local", base_url: "http://localhost:3000", association_path: "/operator/checkout", guessed: true,
    })).toBe(false);

    const annotation = await validator("capture-annotation");
    expect(annotation({ ...validAnnotation, outcomes: [] })).toBe(false);
    expect(annotation({ ...validAnnotation, readiness_intent: { side_effect_class: "stateful", isolation: null } })).toBe(false);
    expect(annotation({ ...validAnnotation, actions: [{ action: "click", target: "page.getByRole('button')", value: null }] })).toBe(false);
    expect(annotation({ ...validAnnotation, entry_point: { path: "/../../etc/passwd", query: null, fragment: null } })).toBe(false);
    expect(annotation({ ...validAnnotation, secret_literal: "canary-secret" })).toBe(false);
    expect(annotation({ ...validAnnotation, purpose: "x".repeat(65_537) })).toBe(false);

    const envelope = await validator("cli-envelope");
    expect(envelope({ contract: "pharos.cli-envelope/1", command: "capture.annotate", outcome: "succeeded", data: {}, errors: [] })).toBe(false);
    expect(envelope({ contract: "pharos.cli-envelope/1", command: "capture.annotate", outcome: "succeeded", data: {}, errors: [], next_action: null, extra: true })).toBe(false);
  });

  it("reserves a top-level variable value for the complete variable-reference shape", async () => {
    const annotation = await validator("capture-annotation");
    const action = (value: unknown) => ({ ...validAnnotation, actions: [{ action: "enter", target: "checkout-form", value }] });

    expect(annotation(action({ kind: "variable" }))).toBe(false);
    expect(annotation(action({ kind: "variable", variable: 123 }))).toBe(false);
    expect(annotation(action({ kind: "variable", variable: "checkoutToken", extra: true }))).toBe(false);
    expect(annotation(action({ kind: "variable", variable: "checkoutToken" }))).toBe(true);
    expect(annotation(action({ kind: "literal", value: { ordinary: { kind: "variable" } } }))).toBe(true);
    expect(annotation(action({ kind: "ordinary", nested: { kind: "variable" } }))).toBe(false);
  });

  it("accepts structural tokens while leaving selector and Playwright semantics to policy", async () => {
    const annotation = await validator("capture-annotation");
    const action = (token: string) => ({ ...validAnnotation, actions: [{ action: "click", target: token, value: null }] });

    expect(annotation(action("selectorPanel"))).toBe(true);
    expect(annotation(action("getByRole"))).toBe(true);
    expect(annotation(action("page.getByRole('button')"))).toBe(false);
    expect(annotation(action("section/button"))).toBe(false);
    expect(annotation(action("getByRole(button)"))).toBe(false);
  });

  it("keeps uniqueItems limited to byte-identical declarations", async () => {
    const annotation = await validator("capture-annotation");
    expect(annotation({
      ...validAnnotation,
      outcomes: [
        { id: "checkout-renewed", description: "Checkout is renewed" },
        { id: "checkout-renewed", description: "Checkout is renewed" },
      ],
    })).toBe(false);
    expect(annotation({
      ...validAnnotation,
      outcomes: [
        { id: "checkout-renewed", description: "Checkout is renewed" },
        { id: "checkout-renewed", description: "Same logical ID, distinct text" },
      ],
    })).toBe(true);
  });

  it("triangulates stateful isolation and secret-variable redaction constraints", async () => {
    const annotation = await validator("capture-annotation");
    expect(annotation({
      ...validAnnotation,
      variables: [{ name: "checkoutToken", classification: "required_scenario", constraints: [], secret_reference_id: "env:CHECKOUT_TOKEN", non_sensitive_example: null }],
      readiness_intent: { side_effect_class: "stateful", isolation: { strategy: "reset_fixture", scope: ["checkout_db"] } },
    })).toBe(true);
    expect(annotation({
      ...validAnnotation,
      variables: [{ name: "checkoutToken", classification: "required_scenario", constraints: [], secret_reference_id: "env:CHECKOUT_TOKEN", non_sensitive_example: "literal-secret-placeholder" }],
    })).toBe(false);
  });

  it("aligns the CLI-envelope structure with public producer vocabulary", async () => {
    const envelope = await validator("cli-envelope");
    const base = {
      contract: "pharos.cli-envelope/1", command: "capture.annotate", outcome: "refused", data: {},
      errors: [{ rule: "invalid-contract", category: "validation", field: "" }], next_action: null,
    };
    expect(envelope(base)).toBe(true);
    expect(envelope({ ...base, errors: [{ rule: "invalid-contract", category: "unknown", field: "/" }] })).toBe(false);
    expect(envelope({ ...base, errors: [{ rule: "raw exception text", category: "validation", field: "/" }] })).toBe(false);
    expect(envelope({ ...base, errors: [{ rule: "invalid-contract", category: "validation", field: "/entry_point~1path/~0value" }] })).toBe(true);
    expect(envelope({ ...base, errors: [{ rule: "invalid-contract", category: "validation", field: "/bad~2escape" }] })).toBe(false);
    expect(envelope({ ...base, errors: [{ rule: "invalid-contract", category: "validation", field: null }] })).toBe(false);
    expect(envelope({ ...base, command: "c".repeat(256) })).toBe(true);
    expect(envelope({ ...base, command: "c".repeat(257) })).toBe(false);
    expect(envelope({ ...base, next_action: { command: "a".repeat(1024), reason: "r".repeat(1024) } })).toBe(true);
    expect(envelope({ ...base, next_action: { command: "a".repeat(1025), reason: "ok" } })).toBe(false);
  });

  it("accepts every representative normalized runtime envelope as a schema-valid safe subset", async () => {
    const envelope = await validator("cli-envelope");
    for (const value of [
      { command: "init", outcome: "succeeded", data: {}, errors: [], nextAction: null },
      { command: "unsafe /private/path", outcome: "bad", data: {}, errors: [], nextAction: null },
      { command: "init", outcome: "refused", data: {}, errors: [{ rule: "raw exception", category: "validation", field: "/" }], nextAction: null },
    ]) expect(envelope(JSON.parse(jsonEnvelope(value as never)))).toBe(true);
  });

  it("keeps ingress separate from the frozen SemanticSource and SemanticProjection boundary", async () => {
    const source: SemanticSource = {
      purpose: "Renew the active checkout",
      actor: { type: "guest" },
      entryPoint: { path: "/checkout" },
      actions: [{ action: "continue_checkout" }],
      readinessIntent: { sideEffectClass: "stateless" },
      captureId: "cap_not-projected",
      contract: "pharos.capture-annotation/1",
    };
    expect(project(source)).not.toHaveProperty("captureId");
    expect(project(source)).not.toHaveProperty("contract");
  });
});
