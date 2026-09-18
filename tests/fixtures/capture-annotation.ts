export const validAnnotation = {
  contract: "pharos.capture-annotation/1",
  title: "Renew checkout",
  purpose: "Renew the active checkout",
  actor: { type: "guest", identity_ref: null },
  entry_point: { path: "/checkout", query: null, fragment: null },
  actions: [{ action: "continue_checkout", target: "checkout_form", value: null }],
  checkpoints: { ordered: true, entries: [{ id: "checkout_open", after_action: "continue_checkout", expectations: { visible: true } }] },
  variables: [{ name: "checkout_token", classification: "required_scenario", constraints: [], secret_reference_id: "env:CHECKOUT_TOKEN", non_sensitive_example: null }],
  outcomes: [{ id: "checkout_renewed", description: "Checkout is renewed" }],
  allowed_variation: [],
  prohibited_regressions: [{ id: "no_double_charge", description: "Charge only once" }],
  readiness_intent: { side_effect_class: "stateful", isolation: { strategy: "reset_fixture", scope: ["checkout_db"] } },
};
