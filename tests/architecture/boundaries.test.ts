import { fileURLToPath } from "node:url";
import path from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";
// @ts-expect-error - eslint.config.base.js has no type declarations
import baseConfig from "../../eslint.config.base.js";
import type { BeaconStore } from "../../src/domain/ports/beacon-store.js";

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

describe("beacon-store port structural constraints", () => {
  it("compiles the BeaconStore port with zero Node imports and clean lint", async () => {
    const result = await lint("src/domain/ports/beacon-store.ts");

    expect(result.messages).toEqual([]);
  });

  it("exposes exactly the 9 BeaconStore lifecycle methods", () => {
    const stub: BeaconStore = {
      getBeacon: async () => {
        throw new Error("stub not implemented");
      },
      listBeacons: async () => {
        throw new Error("stub not implemented");
      },
      getActiveVersion: async () => {
        throw new Error("stub not implemented");
      },
      createDraft: async () => {
        throw new Error("stub not implemented");
      },
      updateDraft: async () => {
        throw new Error("stub not implemented");
      },
      forkDraft: async () => {
        throw new Error("stub not implemented");
      },
      abandonDraft: async () => {
        throw new Error("stub not implemented");
      },
      approveDraft: async () => {
        throw new Error("stub not implemented");
      },
      revokeVersion: async () => {
        throw new Error("stub not implemented");
      },
    };

    expect(Object.keys(stub)).toHaveLength(9);
    expect(new Set(Object.keys(stub)).size).toBe(9);
  });
});
