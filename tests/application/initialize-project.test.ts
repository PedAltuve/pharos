import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FsProjectContextStore } from "../../src/adapters/fs-project-context-store/index.js";
import {
  InitializeProject,
  type InitializeProjectDependencies,
  type InitializeProjectRequest,
} from "../../src/application/initialize-project.js";
import type { Hasher, ProjectContextStore } from "../../src/domain/ports/index.js";
import type { ProjectContext } from "../../src/domain/project/index.js";
import { err, ok } from "../../src/shared/result.js";

const projectId = "proj_018f47de-7a00-7cc0-8000-000000000001" as const;
const requestId = "req_initialize-checkout" as const;

const request = (
  overrides: Partial<InitializeProjectRequest> = {},
): InitializeProjectRequest => ({
  name: "Checkout",
  mode: "repository",
  environment: "local",
  baseUrl: "http://localhost:3000",
  associationPath: "/workspace/checkout",
  requestId,
  ...overrides,
});

function createStore(): ProjectContextStore & {
  readonly calls: ProjectContext[];
  readonly commands: Parameters<ProjectContextStore["initialize"]>[0][];
} {
  const calls: ProjectContext[] = [];
  const commands: Parameters<ProjectContextStore["initialize"]>[0][] = [];
  return {
    calls,
    commands,
    async initialize(command) {
      calls.push(command.context);
      commands.push(command);
      return ok(command.context);
    },
    async resolveById(projectId) {
      return err({ rule: "project-context-not-found", projectId });
    },
    async resolveByPath() {
      return err({ rule: "project-selection-required" });
    },
  };
}

const identityHasher: Hasher = { hash: (value) => JSON.stringify(value) };

function initialize(store: ProjectContextStore): InitializeProject {
  return new InitializeProject({
    clock: { now: () => new Date("2026-03-01T00:00:00.000Z") },
    ids: { next: () => projectId },
    store,
    hasher: identityHasher,
  });
}

function initializeWithAdvancingFakes(home: string): {
  readonly useCase: InitializeProject;
  readonly generations: () => number;
} {
  const generatedProjectIds = [projectId, "proj_018f47de-7a00-7cc0-8000-000000000002"] as const;
  const generatedTimes = ["2026-03-01T00:00:00.000Z", "2026-03-02T00:00:00.000Z"] as const;
  let generation = 0;
  return {
    useCase: new InitializeProject({
      clock: { now: () => new Date(generatedTimes[generation] ?? generatedTimes[1]) },
      ids: { next: () => generatedProjectIds[generation++] ?? generatedProjectIds[1] },
      store: new FsProjectContextStore({ home }),
      hasher: identityHasher,
    }),
    generations: () => generation,
  };
}

describe("InitializeProject", () => {
  it.each(["local", "test", "staging"] as const)(
    "creates a stable non-production %s project without Beacon or capture dependencies",
    async (environment) => {
      const store = createStore();

      const result = await initialize(store).execute(request({ environment }));

      expect(result).toEqual({
        ok: true,
        value: {
          projectId,
          nextAction: "capture-record",
        },
      });
      expect(store.calls).toEqual([
        {
          contract: "pharos.project-context/1",
          projectId,
          revision: 1,
          name: "Checkout",
          mode: "repository",
          environment,
          baseUrl: "http://localhost:3000/",
          createdAt: "2026-03-01T00:00:00.000Z",
        },
      ]);
    },
  );

  it("refuses production and invalid URLs before calling the context store", async () => {
    const store = createStore();
    const useCase = initialize(store);

    await expect(useCase.execute(request({ environment: "production" }))).resolves.toEqual({
      ok: false,
      error: { rule: "production-environment" },
    });
    await expect(useCase.execute(request({ baseUrl: "file:///workspace/checkout" }))).resolves.toEqual({
      ok: false,
      error: { rule: "invalid-project-context", field: "baseUrl" },
    });
    expect(store.calls).toEqual([]);
  });

  it("replays the persisted context when advancing IDs and clocks retry the same request", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "pharos-initialize-project-replay-"));
    const home = join(tempRoot, "pharos-home");
    const associationPath = join(tempRoot, "external-target");
    await mkdir(associationPath);
    const advancing = initializeWithAdvancingFakes(home);

    try {
      const first = await advancing.useCase.execute(request({ associationPath }));
      const replay = await advancing.useCase.execute(request({ associationPath }));

      expect(advancing.generations()).toBe(2);
      expect(first).toEqual({ ok: true, value: { projectId, nextAction: "capture-record" } });
      expect(replay).toEqual(first);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it.each([
    ["name", { name: "Payments" }],
    ["mode", { mode: "external" as const }],
    ["environment", { environment: "test" as const }],
    ["base URL", { baseUrl: "https://staging.example.test" }],
  ])("returns a typed conflict when a retry changes canonical %s input", async (_field, changed) => {
    const tempRoot = await mkdtemp(join(tmpdir(), "pharos-initialize-project-conflict-"));
    const home = join(tempRoot, "pharos-home");
    const associationPath = join(tempRoot, "external-target");
    await mkdir(associationPath);
    const advancing = initializeWithAdvancingFakes(home);

    try {
      await expect(advancing.useCase.execute(request({ associationPath }))).resolves.toEqual({
        ok: true,
        value: { projectId, nextAction: "capture-record" },
      });
      await expect(advancing.useCase.execute(request({ associationPath, ...changed }))).resolves.toEqual({
        ok: false,
        error: { rule: "project-request-conflict", requestId },
      });
      expect(advancing.generations()).toBe(2);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("replays semantically equivalent normalized request fields despite advancing generators", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "pharos-initialize-project-normalized-replay-"));
    const home = join(tempRoot, "pharos-home");
    const associationPath = join(tempRoot, "external-target");
    await mkdir(associationPath);
    const advancing = initializeWithAdvancingFakes(home);

    try {
      const first = await advancing.useCase.execute(request({ associationPath, name: "Checkout", baseUrl: "https://staging.example.test" }));
      const replay = await advancing.useCase.execute(request({ associationPath, name: " Checkout ", baseUrl: "https://staging.example.test/" }));

      expect(first).toEqual({ ok: true, value: { projectId, nextAction: "capture-record" } });
      expect(replay).toEqual(first);
      expect(advancing.generations()).toBe(2);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("returns a typed conflict when a retry changes its canonical association path", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "pharos-initialize-project-conflict-"));
    const home = join(tempRoot, "pharos-home");
    const firstAssociationPath = join(tempRoot, "external-target");
    const secondAssociationPath = join(tempRoot, "other-external-target");
    await Promise.all([mkdir(firstAssociationPath), mkdir(secondAssociationPath)]);
    const advancing = initializeWithAdvancingFakes(home);

    try {
      await expect(advancing.useCase.execute(request({ associationPath: firstAssociationPath }))).resolves.toEqual({
        ok: true,
        value: { projectId, nextAction: "capture-record" },
      });
      await expect(advancing.useCase.execute(request({ associationPath: secondAssociationPath }))).resolves.toEqual({
        ok: false,
        error: { rule: "project-request-conflict", requestId },
      });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("derives initialization identity from normalized request semantics instead of a caller hash", async () => {
    const store = createStore();
    const hasher: Hasher = { hash: (value) => `trusted:${JSON.stringify(value)}` };
    const useCase = new InitializeProject({
      clock: { now: () => new Date("2026-03-01T00:00:00.000Z") },
      ids: { next: () => projectId },
      store,
      hasher,
    } as InitializeProjectDependencies);
    const untrustedRequest = { ...request(), inputHash: "caller-controlled" } as InitializeProjectRequest;

    await expect(useCase.execute(untrustedRequest)).resolves.toEqual({
      ok: true,
      value: { projectId, nextAction: "capture-record" },
    });
    expect(store.commands).toHaveLength(1);
    expect(store.commands[0]?.inputHash).toBe(
      'trusted:{"associationPath":"/workspace/checkout","baseUrl":"http://localhost:3000/","environment":"local","mode":"repository","name":"Checkout"}',
    );
  });

  it("preserves the store's same-request replay and different-input conflict results", async () => {
    const context: ProjectContext = {
      contract: "pharos.project-context/1",
      projectId,
      revision: 1,
      name: "Checkout",
      mode: "external",
      environment: "staging",
      baseUrl: "https://staging.example.test/",
      createdAt: "2026-03-01T00:00:00.000Z",
    };
    let invocation = 0;
    const store: ProjectContextStore = {
      initialize: async () => {
        invocation += 1;
        return invocation === 1 ? ok(context) : err({ rule: "project-request-conflict", requestId });
      },
      resolveById: async (project) => err({ rule: "project-context-not-found", projectId: project }),
      resolveByPath: async () => err({ rule: "project-selection-required" }),
    };
    const useCase = initialize(store);

    await expect(useCase.execute(request({ mode: "external", environment: "staging", baseUrl: "https://staging.example.test" }))).resolves.toEqual({
      ok: true,
      value: { projectId, nextAction: "capture-record" },
    });
    await expect(useCase.execute(request({ mode: "external", environment: "staging", baseUrl: "https://staging.example.test", name: "Changed checkout" }))).resolves.toEqual({
      ok: false,
      error: { rule: "project-request-conflict", requestId },
    });
  });
});
