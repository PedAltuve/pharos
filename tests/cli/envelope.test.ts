import { createRequire } from "node:module";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import {
  domainValidationErrors,
  jsonEnvelope,
  refusalOutcome,
  renderOutcome,
} from "../../src/cli/envelope.js";

const require = createRequire(import.meta.url);
const envelopeSchema = require("../../src/contracts/schemas/cli-envelope.schema.json") as object;
const validateEnvelope = new Ajv2020({ strict: true }).compile(envelopeSchema);

describe("CLI envelopes", () => {
  it("writes exactly one safe v1 JSON object for a successful command", () => {
    const envelope = jsonEnvelope({
      command: "capture.annotate",
      outcome: "succeeded",
      data: { beacon_id: "bcn_01" },
      errors: [],
      nextAction: { command: "pharos beacon inspect bcn_01", reason: "Inspect the open draft" },
    });

    expect(envelope).toBe(`${JSON.stringify({
      contract: "pharos.cli-envelope/1",
      command: "capture.annotate",
      outcome: "succeeded",
      data: { beacon_id: "bcn_01" },
      errors: [],
      next_action: { command: "pharos beacon inspect bcn_01", reason: "Inspect the open draft" },
    })}\n`);
  });

  it("redacts unsafe result data before the single JSON object is emitted", () => {
    const output = jsonEnvelope({
      command: "capture.record",
      outcome: "failed",
      data: { adapter_path: "/private/adapter", token: "canary-secret", capture_bytes: "raw bytes" },
      errors: [],
      nextAction: null,
    });

    expect(output).not.toContain("/private/adapter");
    expect(output).not.toContain("canary-secret");
    expect(output).not.toContain("raw bytes");
    expect(JSON.parse(output)).toMatchObject({ contract: "pharos.cli-envelope/1", data: {} });
  });

  it("redacts nested values, errors, and next actions across supported path families", () => {
    const output = jsonEnvelope({
      command: "capture.annotate",
      outcome: "refused",
      data: {
        nested: [
          { named_home: "~operator/private", windows: "C:\\private\\capture", unc: "\\\\server\\share", file: "file:///private" },
          { normal: "safe" },
        ],
      },
      errors: [
        { rule: "invalid-contract", category: "validation", field: "/actions/0" },
        { rule: "internal-error", category: "internal", field: "/private/error" },
      ],
      nextAction: { command: "pharos capture annotate /private", reason: "file:///private" },
    });

    expect(output).not.toContain("private");
    expect(output).not.toContain("server");
    expect(JSON.parse(output)).toMatchObject({
      data: {},
      errors: [{ rule: "internal-error", category: "internal", field: "/" }],
      next_action: null,
    });
  });

  it.each([
    [{ rule: "production-environment" }, "safety", null],
    [{ rule: "capture-request-conflict" }, "conflict", null],
    [{ rule: "capture-not-promoted" }, "prerequisite", "pharos capture record"],
    [{ rule: "invalid-contract", field: "/actions/0", keyword: "required" }, "validation", null],
  ] as const)("maps refusal %o to stable category and next action", (refusal, category, nextCommand) => {
    const output = JSON.parse(jsonEnvelope(refusalOutcome("capture.annotate", refusal)));
    expect(output.errors).toEqual([{ rule: refusal.rule, category, field: refusal.rule === "invalid-contract" ? "/actions/0" : "/" }]);
    expect(output.next_action?.command ?? null).toBe(nextCommand);
  });

  it("omits cyclic and throwing envelope values without escaping", () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    const throwing = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(throwing, "boom", { enumerable: true, get() { throw new Error("raw diagnostic"); } });

    expect(() => jsonEnvelope({
      command: "init", outcome: "failed", data: { cyclic, throwing }, errors: [], nextAction: null,
    })).not.toThrow();
    expect(JSON.parse(jsonEnvelope({
      command: "init", outcome: "failed", data: { cyclic, throwing }, errors: [], nextAction: null,
    }))).toMatchObject({ data: {} });
  });

  it("normalizes malformed top-level scalars to one internal envelope", () => {
    const output = JSON.parse(jsonEnvelope({
      command: "init /private/path",
      outcome: "not-an-outcome" as never,
      data: {},
      errors: [],
      nextAction: null,
    }));
    expect(output).toMatchObject({ command: "pharos", outcome: "failed", errors: [{ rule: "internal-error", category: "internal" }] });
  });

  it("normalizes malformed categories, rules, and next actions to internal output", () => {
    for (const outcome of [
      { command: "init", outcome: "refused", data: {}, errors: [{ rule: "invalid-contract", category: "unknown", field: "/" }], nextAction: null },
      { command: "init", outcome: "refused", data: {}, errors: [{ rule: "raw error text", category: "validation", field: "/" }], nextAction: null },
      { command: "init", outcome: "refused", data: {}, errors: [], nextAction: { command: "pharos /private", reason: "unsafe" } },
    ]) {
      expect(JSON.parse(jsonEnvelope(outcome as never))).toMatchObject({ outcome: "failed", errors: [{ rule: "internal-error" }] });
    }
  });

  it("enforces schema scalar boundaries and emits schema-shaped safe fallbacks", () => {
    const command = "c".repeat(256);
    const rule = "r".repeat(256);
    const action = "a".repeat(1024);
    const valid = JSON.parse(jsonEnvelope({
      command, outcome: "refused", data: {}, errors: [{ rule, category: "validation", field: "" }],
      nextAction: { command: action, reason: action },
    }));
    expect(valid).toMatchObject({ command, errors: [{ rule, field: "" }], next_action: { command: action, reason: action } });
    for (const malformed of [
      { command: "", outcome: "refused", data: {}, errors: [], nextAction: null },
      { command: "c".repeat(257), outcome: "refused", data: {}, errors: [], nextAction: null },
      { command: "init", outcome: "refused", data: {}, errors: [{ rule: "r".repeat(257), category: "validation", field: "/" }], nextAction: null },
      { command: "init", outcome: "refused", data: {}, errors: [], nextAction: { command: "a".repeat(1025), reason: "ok" } },
    ]) {
      const normalized = JSON.parse(jsonEnvelope(malformed as never));
      expect(normalized).toEqual({
        contract: "pharos.cli-envelope/1", command: "pharos", outcome: "failed", data: {},
        errors: [{ rule: "internal-error", category: "internal", field: "/" }], next_action: null,
      });
      expect(validateEnvelope(normalized)).toBe(true);
    }
  });

  it("preserves RFC 6901 root and escapes while collapsing unsafe pointers", () => {
    const output = JSON.parse(jsonEnvelope({
      command: "init", outcome: "refused", data: {},
      errors: [
        { rule: "invalid-contract", category: "validation", field: "" },
        { rule: "invalid-contract", category: "validation", field: "/tilde~0slash~1segment" },
        { rule: "invalid-contract", category: "validation", field: "/bad~2escape" },
        { rule: "invalid-contract", category: "validation", field: "/private/error" },
      ],
      nextAction: null,
    }));
    expect(output.errors.map((error: { field: string }) => error.field)).toEqual(["", "/tilde~0slash~1segment", "/", "/"]);
  });

  it("preserves schema pointers but collapses filesystem-like validation fields", () => {
    expect(JSON.parse(jsonEnvelope({
      command: "init", outcome: "refused", data: {},
      errors: [
        { rule: "invalid-contract", category: "validation", field: "/entry_point/path" },
        { rule: "invalid-contract", category: "validation", field: "/escaped~1segment" },
        { rule: "invalid-contract", category: "validation", field: "/private/error" },
        { rule: "invalid-contract", category: "validation", field: "/home/operator" },
      ],
      nextAction: null,
    }))).toMatchObject({ errors: [
      { field: "/entry_point/path" }, { field: "/escaped~1segment" }, { field: "/" }, { field: "/" },
    ] });
  });

  it("omits unsafe object keys and getter failures across envelope fields", () => {
    const output = JSON.parse(jsonEnvelope({
      command: "init",
      outcome: "refused",
      data: { "/private/key": "safe", token_value: "safe", retained: "safe" },
      errors: [{ rule: "invalid-contract", category: "validation", field: "/" }],
      nextAction: null,
    }));
    expect(output.data).toEqual({ retained: "safe" });

    const outcome = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(outcome, "command", { get() { throw new Error("raw command"); } });
    expect(JSON.parse(jsonEnvelope(outcome as never))).toMatchObject({ outcome: "failed", errors: [{ rule: "internal-error" }] });
  });

  it("collapses arbitrary public rule prose and embedded locations", () => {
    const output = JSON.parse(jsonEnvelope({
      command: "init",
      outcome: "refused",
      data: { note: "failure at /private/adapter and C:\\private\\file" },
      errors: [{ rule: "Error: canary /private/path", category: "internal", field: "/" }],
      nextAction: null,
    }));

    expect(output.data).toEqual({});
    expect(output.errors).toEqual([{ rule: "internal-error", category: "internal", field: "/" }]);
  });

  it("maps validator fields to stable public refusal data without values or paths", () => {
    expect(domainValidationErrors([
      { rule: "invalid-contract", field: "/actions/0", keyword: "required" },
    ])).toEqual([
      { rule: "invalid-contract", category: "validation", field: "/actions/0" },
    ]);
  });

  it("renders safe scalar success identifiers and the next command for humans", () => {
    expect(renderOutcome({
      command: "capture.annotate",
      outcome: "succeeded",
      data: { beacon_id: "bcn_01", revision: 2, nested: { secret: "canary" }, captures: ["cap_01"] },
      errors: [],
      nextAction: { command: "pharos beacon inspect bcn_01", reason: "Inspect the open draft" },
    }, "human")).toEqual({
      stdout: "pharos: completed\nbeacon_id: bcn_01\nrevision: 2\nnext: pharos beacon inspect bcn_01\n",
      stderr: "",
    });
  });

  it("renders a bounded authoritative Beacon inspection view for nested data", () => {
    expect(renderOutcome({
      command: "beacon.inspect",
      outcome: "succeeded",
      data: {
        beacon: { authority: "authoritative", status: "open", revision: 1, semanticHash: "sha256:semantic", semantics: { purpose: "Renew checkout", actions: [{}], checkpoints: { entries: [{}] }, variables: [], outcomes: [{}] } },
        capture: { authority: "supporting-non-authoritative", captureId: "cap_01", artifact: { reference: "captures/cap_01/recording.spec.ts" } },
      },
      errors: [],
      nextAction: null,
    }, "human")).toEqual({
      stdout: "pharos: completed\nbeacon.authority: authoritative\nbeacon.status: open\nbeacon.revision: 1\nbeacon.semantic_hash: sha256:semantic\nbeacon.semantics: actions=1, checkpoints=1, variables=0, outcomes=1\ncapture.authority: supporting-non-authoritative\ncapture.association: cap_01\n",
      stderr: "",
    });
  });

  it("bounds and redacts nested Beacon inspection data instead of dumping it", () => {
    const rendered = renderOutcome({
      command: "beacon.inspect",
      outcome: "succeeded",
      data: {
        beacon: { authority: "authoritative", status: "open", revision: 1, semanticHash: "sha256:semantic", semantics: { actions: Array.from({ length: 200 }, () => ({ token: "canary-secret", deep: { raw: "raw capture bytes" } })), checkpoints: { entries: [] }, variables: [], outcomes: [] } },
        capture: { authority: "supporting-non-authoritative", captureId: "cap_01", diagnostic: "canary-secret" },
      },
      errors: [],
      nextAction: null,
    }, "human");
    expect(rendered.stdout).toContain("beacon.semantics: actions=200, checkpoints=0, variables=0, outcomes=0");
    expect(rendered.stdout).not.toContain("canary-secret");
    expect(rendered.stdout).not.toContain("raw capture bytes");
    expect(rendered.stdout).not.toContain("deep");
  });

  it("renders record capture IDs with their follow-up annotation command", () => {
    expect(renderOutcome({
      command: "capture.record",
      outcome: "succeeded",
      data: { capture_id: "cap_01" },
      errors: [],
      nextAction: { command: "pharos capture annotate cap_01", reason: "Annotate the capture" },
    }, "human").stdout).toBe("pharos: completed\ncapture_id: cap_01\nnext: pharos capture annotate cap_01\n");
  });

  it("separates human diagnostics and redacts secrets, paths, and exception messages", () => {
    const rendered = renderOutcome({
      command: "init",
      outcome: "failed",
      data: {},
      errors: [{ rule: "internal-error", category: "internal", field: "/" }],
      nextAction: null,
    }, "human");

    expect(rendered.stdout).toBe("");
    expect(rendered.stderr).toBe("pharos: internal error\n");
    expect(rendered.stderr).not.toContain("canary");
    expect(rendered.stderr).not.toContain("/");
  });
});
