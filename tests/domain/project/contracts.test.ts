import { describe, expect, it } from "vitest";
import {
  PROJECT_CONTEXT_CONTRACT,
  createProjectContext,
  isProjectId,
} from "../../../src/domain/project/index.js";

const projectId = "proj_018f47de-7a00-7cc0-8000-000000000001";

describe("ProjectContext v1", () => {
  it("accepts only the closed v1 context with a generated project ID", () => {
    expect(isProjectId(projectId)).toBe(true);
    expect(isProjectId("proj_018f47de-7a00-6cc0-8000-000000000001")).toBe(false);

    expect(
      createProjectContext({
        contract: PROJECT_CONTEXT_CONTRACT,
        projectId,
        revision: 1,
        name: "Checkout",
        mode: "external",
        environment: "staging",
        baseUrl: "https://staging.example.test",
        createdAt: "2026-03-01T00:00:00.000Z",
      }),
    ).toEqual({
      ok: true,
      value: {
        contract: PROJECT_CONTEXT_CONTRACT,
        projectId,
        revision: 1,
        name: "Checkout",
        mode: "external",
        environment: "staging",
        baseUrl: "https://staging.example.test",
        createdAt: "2026-03-01T00:00:00.000Z",
      },
    });
  });

  it("returns safe typed refusals for production, malformed IDs, and non-v1 contracts", () => {
    const valid = {
      contract: PROJECT_CONTEXT_CONTRACT,
      projectId,
      revision: 1,
      name: "Checkout",
      mode: "repository" as const,
      environment: "local" as const,
      baseUrl: "http://localhost:3000",
      createdAt: "2026-03-01T00:00:00.000Z",
    };

    expect(createProjectContext({ ...valid, environment: "production" })).toEqual({
      ok: false,
      error: { rule: "production-environment" },
    });
    expect(createProjectContext({ ...valid, projectId: "proj_not-a-uuid" })).toEqual({
      ok: false,
      error: { rule: "invalid-project-id", projectId: "proj_not-a-uuid" },
    });
    expect(createProjectContext({ ...valid, contract: "pharos.project-context/2" })).toEqual({
      ok: false,
      error: { rule: "unsupported-project-context-contract", contract: "pharos.project-context/2" },
    });
  });
});
