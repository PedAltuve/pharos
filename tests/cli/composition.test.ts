import { describe, expect, it } from "vitest";
import { createComposition } from "../../src/cli/composition.js";

describe("CLI composition", () => {
  it("resolves an injected home once and creates project-scoped use cases without exposing paths", async () => {
    const composition = createComposition({
      resolveHome: () => ({ ok: true, value: "/safe/pharos-home" }),
      currentPath: async () => "/workspace/project",
      createAdapters: (home) => ({
        home,
        resolveProject: async () => ({ ok: true as const, value: {
          contract: "pharos.project-context/1" as const,
          projectId: "proj_018f47de-7a00-7cc0-8000-000000000001" as const,
          revision: 1 as const,
          name: "Checkout",
          mode: "external" as const,
          environment: "staging" as const,
          baseUrl: "https://staging.example.test/",
          createdAt: "2026-03-01T00:00:00.000Z",
        } }),
        initialize: { execute: async () => ({ ok: true as const, value: { projectId: "proj_018f47de-7a00-7cc0-8000-000000000001" as const, nextAction: "capture-record" as const } }) },
      }),
    });

    const resolved = await composition.resolveProject();
    expect(resolved).toMatchObject({ ok: true, value: { projectId: "proj_018f47de-7a00-7cc0-8000-000000000001", revision: 1, baseUrl: "https://staging.example.test/" } });
    expect("home" in composition).toBe(false);
    expect(composition.initialize).toBeDefined();
  });

  it("returns the home-resolution refusal without constructing adapters", () => {
    let constructed = false;
    const composition = createComposition({
      resolveHome: () => ({ ok: false, error: { rule: "invalid-pharos-home" } }),
      currentPath: async () => "/workspace/project",
      createAdapters: () => {
        constructed = true;
        throw new Error("must not run");
      },
    });

    expect(composition.homeResolution()).toEqual({ ok: false, error: { rule: "invalid-pharos-home" } });
    expect(constructed).toBe(false);
  });
});
