import { describe, expect, it } from "vitest";
import { mapAnnotation, validateAnnotationPolicy } from "../../../src/application/annotation/index.js";
import { JcsSha256Hasher } from "../../../src/adapters/hashing/jcs-sha256-hasher.js";
import { project } from "../../../src/domain/semantics/index.js";
import type { JsonValue } from "../../../src/domain/ports/json-value.js";
import { validAnnotation as annotation } from "../../fixtures/capture-annotation.js";

describe("guided annotation policy and mapper", () => {
  it("refuses selector, reference, and secret policy violations before mapping", () => {
    expect(validateAnnotationPolicy({ ...annotation, actions: [{ ...annotation.actions[0], target: "getByRole" }] }, {
      secretSourceReferences: ["env:CHECKOUT_TOKEN"],
      resolvedSecrets: new Map([["env:CHECKOUT_TOKEN", "canary-secret"]]),
    })).toMatchObject({ ok: false, error: { rule: "invalid-annotation-policy", field: "/actions/0/target" } });
    expect(validateAnnotationPolicy({ ...annotation, variables: [{ ...annotation.variables[0], secret_reference_id: "env:OTHER" }] }, {
      secretSourceReferences: ["env:CHECKOUT_TOKEN"],
      resolvedSecrets: new Map(),
    })).toMatchObject({ ok: false, error: { field: "/variables/0/secret_reference_id" } });
    expect(validateAnnotationPolicy({ ...annotation, purpose: "contains canary-secret" }, {
      secretSourceReferences: ["env:CHECKOUT_TOKEN"],
      resolvedSecrets: new Map([["env:CHECKOUT_TOKEN", "canary-secret"]]),
    })).toMatchObject({ ok: false, error: { field: "/purpose" } });
  });

  it("refuses tool identifiers, code, and filesystem paths only in semantic machine fields", () => {
    const context = { secretSourceReferences: ["env:CHECKOUT_TOKEN"], resolvedSecrets: new Map<string, string>() };
    for (const target of ["BrowserContext", "FrameLocator", "pageGetByRole"]) {
      expect(validateAnnotationPolicy({ ...annotation, actions: [{ ...annotation.actions[0], target }] }, context)).toMatchObject({ ok: false, error: { field: "/actions/0/target" } });
    }
    expect(validateAnnotationPolicy({ ...annotation, actions: [{ ...annotation.actions[0], value: { kind: "literal", value: "/tmp/recording.spec.ts" } }] }, context)).toMatchObject({ ok: false, error: { field: "/actions/0/value/value" } });
    expect(validateAnnotationPolicy({ ...annotation, actions: [{ ...annotation.actions[0], value: { kind: "literal", value: { selector: "renew_button" } } }] }, context)).toMatchObject({ ok: false, error: { field: "/actions/0/value/value/selector" } });
    expect(validateAnnotationPolicy({ ...annotation, actions: [{ ...annotation.actions[0], value: { kind: "literal", value: "#renew_button" } }] }, context)).toMatchObject({ ok: false, error: { field: "/actions/0/value/value" } });
    expect(validateAnnotationPolicy({ ...annotation, purpose: "Explain BrowserContext migration to a human reviewer", entry_point: { ...annotation.entry_point, path: "/checkout" } }, context)).toEqual({ ok: true, value: undefined });
  });

  it("classifies the verifier corpus with ordered whole-string syntax predicates", () => {
    const context = { secretSourceReferences: ["env:CHECKOUT_TOKEN"], resolvedSecrets: new Map<string, string>() };
    const literal = (value: string) => ({ ...annotation, actions: [{ ...annotation.actions[0], value: { kind: "literal", value } }] });
    const rejected = [
      "page.click('#submit')", "page.getByRole('button')", "locator('.save')", "frameLocator('#frame')", "BrowserContext", "FrameLocator", "APIRequestContext", "APIResponse", "APIRequestOptions",
      "button.primary", "table.results", "p.notice", "widget-card.notice", "button.primary, a.secondary", "input[name=\"email\"]:focus, widget-card.notice", "div > span", "div span", ".checkout .submit", "main .checkout .submit", "div > span > button", "main > .checkout .submit", "button:hover", "[disabled]", "input[name=\"email\"]", "#submit", ".primary", "form.checkout > button.primary", "[data-testid='renew']",
      "(//button)[1]", "(.//button)[1]", "//button", ".//button", "xpath=//button",
      "Open /etc/passwd", "use C:\\captures\\x.ts", "read \\\\server\\share\\capture.ts", "/var/lib/pharos/capture.json", "C:\\captures\\recording.spec.ts", "C:/captures/x.ts", "\\\\server\\share\\recording.spec.ts", "~/captures/recording.spec.ts", "~alice/capture.ts", "file:/var/tmp/capture.ts", "file://server/share/capture.ts", "file:///var/tmp/capture.ts",
      "if (ready) { submit(); }", "if (ready) submit();", "if (ready) submit()", "for (const item of items) { submit(); }", "const selected = page.locator('.renew');", "async () => await page.locator('.renew')", "submit();", "submit()",
    ] as const;
    const accepted = [
      "The operator said: {review}; then continue.",
      "Use ordinary punctuation (including semicolons); no code is implied.",
      "A reviewer can describe a selector in ordinary prose.",
      "Open the page and press the button in the browser context.",
      "page", "button", "selector", "browser context", "frame locator",
      "The frame locator concept is explained for humans.",
      "Use and/or punctuation in this ordinary description.",
      "Choose yes / no", "The table shows results after a button hover effect.",
      "API requests can be explained in ordinary prose without API identifiers.",
      "A browser context, page, locator, and selector are ordinary words here.",
      "Choose yes, no, or maybe later.", "Review table results, then continue.",
    ] as const;
    for (const value of rejected) {
      expect(validateAnnotationPolicy(literal(value), context), value).toMatchObject({ ok: false, error: { field: "/actions/0/value/value" } });
    }
    for (const value of accepted) {
      expect(validateAnnotationPolicy(literal(value), context)).toEqual({ ok: true, value: undefined });
    }
    expect(validateAnnotationPolicy({ ...annotation, entry_point: { ...annotation.entry_point, path: "/checkout/confirm" } }, context)).toEqual({ ok: true, value: undefined });
  });

  it("rejects arbitrary selector chains while preserving prose controls", () => {
    const context = { secretSourceReferences: ["env:CHECKOUT_TOKEN"], resolvedSecrets: new Map<string, string>() };
    const literal = (value: string) => ({ ...annotation, actions: [{ ...annotation.actions[0], value: { kind: "literal", value } }] });
    for (const selector of ["svg > path", "svg path", "math > mrow", "checkout-widget > checkout-panel"] as const) {
      expect(validateAnnotationPolicy(literal(selector), context), selector).toMatchObject({ ok: false, error: { field: "/actions/0/value/value", keyword: "tool-neutral-selector" } });
    }
    for (const prose of ["The svg path is explained to the reviewer.", "A checkout widget guides the customer."] as const) {
      expect(validateAnnotationPolicy(literal(prose), context), prose).toEqual({ ok: true, value: undefined });
    }
  });

  it("refuses resolved secrets used as literal object keys", () => {
    const context = { secretSourceReferences: ["env:CHECKOUT_TOKEN"], resolvedSecrets: new Map([["env:CHECKOUT_TOKEN", "canary-secret"]]) };
    const literal = (value: unknown) => ({ ...annotation, actions: [{ ...annotation.actions[0], value: { kind: "literal", value } }] });
    expect(validateAnnotationPolicy(literal({ "canary-secret": "safe" }), context)).toMatchObject({ ok: false, error: { field: "/actions/0/value/value/canary-secret", keyword: "literal-secret" } });
    expect(validateAnnotationPolicy(literal({ nested: { "canary-secret": true } }), context)).toMatchObject({ ok: false, error: { field: "/actions/0/value/value/nested/canary-secret", keyword: "literal-secret" } });
    expect(validateAnnotationPolicy(literal({ ordinary_key: { another_key: "safe" } }), context)).toEqual({ ok: true, value: undefined });
  });

  it("maps only approved fields into the unchanged semantic projection", () => {
    const source = mapAnnotation(annotation);
    const projection = project(source);
    expect(projection).toMatchObject({
      purpose: annotation.purpose,
      actor: { type: "guest", identityRef: null },
      entryPoint: annotation.entry_point,
      checkpoints: { ordering: "ordered" },
    });
    expect(projection).not.toHaveProperty("title");
    expect(projection).not.toHaveProperty("contract");
    expect(JSON.stringify(projection)).not.toContain("capture");
    const literal = mapAnnotation({ ...annotation, actions: [{ ...annotation.actions[0], value: { kind: "literal", value: { selected: "monthly" } } }] });
    expect(literal.actions[0]?.value).toEqual({ selected: "monthly" });
  });

  it("has a stable semantic hash vector that excludes annotation metadata", () => {
    const source = mapAnnotation(annotation);
    const projection = project(source);
    const hasher = new JcsSha256Hasher();
    expect(hasher.hash(projection as JsonValue)).toBe("sha256:598e544e35f842d782fdc072cdd7b08126a287924648da009e83714f395b3b6d");
    expect(hasher.hash(project(mapAnnotation({ ...annotation, title: "Different operator title", contract: "pharos.capture-annotation/1" })) as JsonValue)).toBe(hasher.hash(projection as JsonValue));
  });
});
