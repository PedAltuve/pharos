import { readFile } from "node:fs/promises";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it, vi } from "vitest";
import { project } from "../../../src/domain/semantics/index.js";
import type { SemanticSource } from "../../../src/domain/semantics/index.js";

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

  it("triangulates invalid machine fixtures without a semantic map or draft operation", async () => {
    const annotation = await validator("capture-annotation");
    const createDraft = vi.fn();
    for (const invalid of [
      { ...validAnnotation, outcomes: [] },
      { ...validAnnotation, readiness_intent: { side_effect_class: "stateful", isolation: null } },
      { ...validAnnotation, actions: [{ action: "click", target: "page.getByRole('button')", value: null }] },
      { ...validAnnotation, entry_point: { path: "/../../etc/passwd", query: null, fragment: null } },
      { ...validAnnotation, secret_literal: "canary-secret" },
      { ...validAnnotation, purpose: "x".repeat(65_537) },
    ]) expect(annotation(invalid)).toBe(false);
    expect(createDraft).not.toHaveBeenCalled();
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

  it("keeps ingress separate from the frozen SemanticSource and SemanticProjection boundary", async () => {
    const annotation = await validator("capture-annotation");
    const duplicateDeclarations = {
      ...validAnnotation,
      outcomes: [
        { id: "checkout-renewed", description: "Checkout is renewed" },
        { id: "checkout-renewed", description: "Checkout is renewed" },
      ],
    };
    expect(annotation(duplicateDeclarations)).toBe(false);

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
