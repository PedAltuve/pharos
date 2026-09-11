import { describe, expect, expectTypeOf, it } from "vitest";
import {
  PROJECT_CONTEXT_CONTRACT,
  createProjectContext,
  isProjectId,
} from "../../../src/domain/project/index.js";
import type {
  ProjectRequestConflict,
  ProjectRequestId,
} from "../../../src/domain/project/index.js";
import type { InitializeProjectContextCommand } from "../../../src/domain/ports/index.js";

const projectId = "proj_018f47de-7a00-7cc0-8000-000000000001";

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

describe("ProjectContext v1", () => {
  it("accepts only the closed v1 context with a generated project ID", () => {
    expect(isProjectId(projectId)).toBe(true);
    expect(isProjectId("proj_018f47de-7a00-6cc0-8000-000000000001")).toBe(false);

    expect(createProjectContext({ ...valid, name: "  Checkout  ", baseUrl: "HTTP://STAGING.EXAMPLE.TEST:80/path" })).toEqual({
      ok: true,
      value: {
        ...valid,
        name: "Checkout",
        baseUrl: "http://staging.example.test/path",
      },
    });
  });

  it("returns safe typed refusals for production, malformed IDs, and non-v1 contracts", () => {
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

  it("refuses non-http URLs, missing hosts, credentials, and non-canonical timestamps", () => {
    for (const baseUrl of ["ftp://example.test", "https:///", "https://user:password@example.test"]) {
      expect(createProjectContext({ ...valid, baseUrl })).toEqual({
        ok: false,
        error: { rule: "invalid-project-context", field: "baseUrl" },
      });
    }
    expect(createProjectContext({ ...valid, createdAt: "2026-03-01T00:00:00Z" })).toEqual({
      ok: false,
      error: { rule: "invalid-project-context", field: "createdAt" },
    });
  });

  it("brands initialization request identifiers at the project boundary", () => {
    expectTypeOf<InitializeProjectContextCommand["requestId"]>().toEqualTypeOf<ProjectRequestId>();
    expectTypeOf<ProjectRequestConflict["requestId"]>().toEqualTypeOf<ProjectRequestId>();
  });
});
