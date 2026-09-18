import { describe, expect, it } from "vitest";
import { buildInitCommand } from "../../../src/cli/commands/init.js";

const runtime = {
  homeResolution: () => ({ ok: true as const, value: undefined }),
  ids: { next: () => "req_018f47de-7a00-7cc0-8000-000000000001" },
  input: { collectInit: async () => ({ ok: false as const, error: { rule: "prompt-cancelled" as const } }) },
  initialize: { execute: async () => ({ ok: false as const, error: { rule: "production-environment" as const } }) },
};

describe("unregistered guided command builders", () => {
  it("keeps init as a private builder with constrained common options", () => {
    const command = buildInitCommand(runtime);

    expect(command.name()).toBe("init");
    expect(command.options.map((option) => option.long)).toEqual(expect.arrayContaining([
      "--format", "--pharos-home", "--request-id", "--input",
    ]));
    expect(command.options.map((option) => option.long)).not.toContain("--project");
  });
});
