import { describe, expect, it } from "vitest";
import { EnvSecretResolver } from "../../../src/adapters/secret-resolution/env-secret-resolver.js";

const canary = "encoded-canary-value";

describe("EnvSecretResolver", () => {
  it("resolves declared environment references transiently and clears them on disposal", async () => {
    const resolver = new EnvSecretResolver({ environment: { CAPTURE_TOKEN: canary } });

    const resolved = await resolver.resolve(["env:CAPTURE_TOKEN"]);

    expect(resolved).toEqual({
      ok: true,
      value: expect.objectContaining({ values: new Map([["env:CAPTURE_TOKEN", canary]]) }),
    });
    if (resolved.ok) {
      resolved.value.dispose();
      expect(resolved.value.values.size).toBe(0);
    }
  });

  it.each([
    ["missing", {}, { rule: "secret-source-unavailable", reference: "env:CAPTURE_TOKEN" }],
    ["empty", { CAPTURE_TOKEN: "" }, { rule: "secret-source-empty", reference: "env:CAPTURE_TOKEN" }],
  ])("returns only a stable %s source refusal", async (_name, environment, refusal) => {
    const result = await new EnvSecretResolver({ environment }).resolve(["env:CAPTURE_TOKEN"]);

    expect(result).toEqual({ ok: false, error: refusal });
    expect(JSON.stringify(result)).not.toContain(canary);
  });
});
