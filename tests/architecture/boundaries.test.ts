import { fileURLToPath } from "node:url";
import path from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";
// @ts-expect-error - eslint.config.base.js has no type declarations
import baseConfig from "../../eslint.config.base.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

async function lint(relativeFile: string) {
  const eslint = new ESLint({
    overrideConfigFile: true,
    baseConfig,
    cwd: repoRoot,
  });
  const filePath = path.join(repoRoot, relativeFile);
  const results = await eslint.lintFiles([filePath]);
  const result = results[0];
  if (!result) {
    throw new Error(`ESLint produced no result for ${relativeFile}`);
  }
  return result;
}

describe("hexagonal dependency rule enforcement", () => {
  it("flags domain importing node:fs", async () => {
    const result = await lint(
      "tests/fixtures/boundaries/src/domain/uses-node-fs.ts",
    );

    expect(result.messages.length).toBeGreaterThanOrEqual(1);
    const ruleIds = result.messages.map((message) => message.ruleId);
    expect(
      ruleIds.some(
        (ruleId) =>
          ruleId === "no-restricted-imports" ||
          ruleId === "boundaries/external",
      ),
    ).toBe(true);
  });

  it("flags application importing adapters", async () => {
    const result = await lint(
      "tests/fixtures/boundaries/src/application/uses-adapters.ts",
    );

    expect(result.messages.length).toBeGreaterThanOrEqual(1);
    const ruleIds = result.messages.map((message) => message.ruleId);
    expect(ruleIds).toContain("boundaries/element-types");
  });
});
