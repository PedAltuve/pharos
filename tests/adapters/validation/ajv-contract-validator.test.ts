import { describe, expect, it } from "vitest";
import { AjvContractValidator } from "../../../src/adapters/validation/ajv-contract-validator.js";

const annotation = {
  contract: "pharos.capture-annotation/1",
  title: "Renew checkout",
  purpose: "Renew the active checkout",
  actor: { type: "guest", identity_ref: null },
  entry_point: { path: "/checkout", query: null, fragment: null },
  actions: [{ action: "continue_checkout", target: "checkout_form", value: null }],
  checkpoints: { ordered: true, entries: [{ id: "checkout_open", after_action: "continue_checkout", expectations: { visible: true } }] },
  variables: [],
  outcomes: [{ id: "checkout_renewed", description: "Checkout is renewed" }],
  allowed_variation: [],
  prohibited_regressions: [{ id: "no_double_charge", description: "Charge only once" }],
  readiness_intent: { side_effect_class: "stateless", isolation: null },
};

describe("AjvContractValidator", () => {
  it("uses strict draft-2020-12 validation and returns stable errors without raw input", () => {
    const validator = new AjvContractValidator();
    expect(validator.validateAnnotation(annotation)).toEqual({ ok: true, value: annotation });
    expect(validator.validateAnnotation({ ...annotation, unexpected: "do-not-echo" })).toEqual({
      ok: false,
      error: expect.arrayContaining([
        expect.objectContaining({ rule: "invalid-contract", keyword: "additionalProperties" }),
      ]),
    });
  });

  it("accepts only the exact literal and variable action-value forms recursively", () => {
    const validator = new AjvContractValidator();
    const action = (value: unknown) => ({ ...annotation, actions: [{ ...annotation.actions[0], value }] });
    expect(validator.validateAnnotation(action({ kind: "literal", value: { selected: ["monthly", true] } }))).toMatchObject({ ok: true });
    expect(validator.validateAnnotation(action({ kind: "literal", selector: "#renew" }))).toMatchObject({ ok: false });
    expect(validator.validateAnnotation(action({ kind: "literal", value: "safe", extra: true }))).toMatchObject({ ok: false });
    expect(validator.validateAnnotation(action({ kind: "variable", variable: "checkout_token", selector: "#renew" }))).toMatchObject({ ok: false });
  });
});
