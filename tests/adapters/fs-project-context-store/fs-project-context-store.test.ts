import { lstat, mkdir, mkdtemp, readFile, rm, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FsProjectContextStore } from "../../../src/adapters/fs-project-context-store/index.js";
import type { InitializeProjectContextCommand } from "../../../src/domain/ports/project-context-store.js";

const firstProjectId = "proj_018f47de-7a00-7cc0-8000-000000000001" as const;
const secondProjectId = "proj_018f47de-7a00-7cc0-8000-000000000002" as const;
const requestId = "req_initialize-checkout" as const;
const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");
let tempRoot: string;
let home: string;
let workspace: string;

function command(
  overrides: Partial<InitializeProjectContextCommand> = {},
): InitializeProjectContextCommand {
  return {
    context: {
      contract: "pharos.project-context/1",
      projectId: firstProjectId,
      revision: 1,
      name: "Checkout",
      mode: "external",
      environment: "staging",
      baseUrl: "https://staging.example.test/",
      createdAt: "2026-03-01T00:00:00.000Z",
    },
    associationPath: workspace,
    requestId,
    inputHash: "initialize-input-hash",
    ...overrides,
  };
}

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "pharos-project-context-"));
  home = join(tempRoot, "pharos-home");
  workspace = join(tempRoot, "external-target");
  await mkdir(workspace);
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe("FsProjectContextStore.initialize", () => {
  it("creates private application-owned context and association files without changing an external target", async () => {
    const untouchedTargetFile = join(workspace, "README.md");
    await writeFile(untouchedTargetFile, "external target bytes\n", "utf8");
    const before = await readFile(untouchedTargetFile, "utf8");
    const store = new FsProjectContextStore({ home });

    const result = await store.initialize(command());

    expect(result).toEqual({ ok: true, value: command().context });
    expect(await readFile(untouchedTargetFile, "utf8")).toBe(before);
    expect((await stat(home)).mode & 0o777).toBe(0o700);
    expect((await stat(join(home, "store", firstProjectId))).mode & 0o777).toBe(0o700);
    expect((await stat(join(home, "store", firstProjectId, "project.json"))).mode & 0o777).toBe(0o600);
    expect((await stat(join(home, "init-journal", `${sha256(requestId)}.json`))).mode & 0o777).toBe(0o600);
  });

  it("replays a write-once request plan and restores a missing association without changing its project identity", async () => {
    const store = new FsProjectContextStore({ home });
    await expect(store.initialize(command())).resolves.toEqual({ ok: true, value: command().context });

    const association = join(home, "associations", "paths", `${sha256(workspace)}.json`);
    await unlink(association);

    await expect(new FsProjectContextStore({ home }).initialize(command())).resolves.toEqual({
      ok: true,
      value: command().context,
    });
    expect(await readFile(association, "utf8")).toContain(firstProjectId);
  });

  it("refuses a different request under the same request identity and a path already owned by another project", async () => {
    const store = new FsProjectContextStore({ home });
    await store.initialize(command());

    await expect(store.initialize(command({ inputHash: "different-input" }))).resolves.toEqual({
      ok: false,
      error: { rule: "project-request-conflict", requestId },
    });
    await expect(store.initialize(command({
      context: { ...command().context, projectId: secondProjectId },
      requestId: "req_other-project" as const,
      inputHash: "other-input",
    }))).resolves.toEqual({
      ok: false,
      error: {
        rule: "project-association-mismatch",
        selectedProjectId: secondProjectId,
        associatedProjectId: firstProjectId,
      },
    });
  });

  it("selects the nearest application-owned canonical path association", async () => {
    const parent = join(tempRoot, "parent");
    const nested = join(parent, "nested", "child");
    await mkdir(nested, { recursive: true });
    const store = new FsProjectContextStore({ home });
    await store.initialize(command({ associationPath: parent }));

    await expect(store.resolveByPath(nested)).resolves.toEqual({
      ok: true,
      value: command({ associationPath: parent }).context,
    });
  });

  it("prefers a nested association over an inherited parent association", async () => {
    const parent = join(tempRoot, "parent");
    const nested = join(parent, "nested");
    const child = join(nested, "child");
    await mkdir(child, { recursive: true });
    const store = new FsProjectContextStore({ home });
    await store.initialize(command({ associationPath: parent }));
    const nestedContext = { ...command().context, projectId: secondProjectId, name: "Nested checkout" };
    await store.initialize(command({
      context: nestedContext,
      associationPath: nested,
      requestId: "req_nested-checkout" as const,
      inputHash: "nested-input-hash",
    }));

    await expect(store.resolveByPath(child)).resolves.toEqual({
      ok: true,
      value: nestedContext,
    });
  });

  it.each([
    ["initialization plan", () => join(home, "init-journal", `${sha256(requestId)}.json`), "initialize"],
    ["path association", () => join(home, "associations", "paths", `${sha256(workspace)}.json`), "initialize"],
    ["project context", () => join(home, "store", firstProjectId, "project.json"), "resolve"],
  ] as const)("refuses a symlinked descendant %s state file", async (_artifact, statePathFor, operation) => {
    const store = new FsProjectContextStore({ home });
    await expect(store.initialize(command())).resolves.toEqual({ ok: true, value: command().context });

    const statePath = statePathFor();
    const outsidePath = join(tempRoot, `outside-${_artifact.replaceAll(" ", "-")}.json`);
    await writeFile(outsidePath, await readFile(statePath, "utf8"), "utf8");
    await unlink(statePath);
    await symlink(outsidePath, statePath);

    if (operation === "initialize") {
      await expect(store.initialize(command())).rejects.toThrow(/symlink/i);
    } else {
      await expect(store.resolveById(firstProjectId)).rejects.toThrow(/symlink/i);
    }
  });

  it("refuses explicit project selection when the nearest current-path association names another project", async () => {
    const selectedPath = join(tempRoot, "selected-target");
    const conflictingPath = join(tempRoot, "conflicting-target");
    await Promise.all([mkdir(selectedPath), mkdir(conflictingPath)]);
    const store = new FsProjectContextStore({ home });
    await store.initialize(command({ associationPath: selectedPath }));
    await store.initialize(command({
      context: { ...command().context, projectId: secondProjectId, name: "Conflicting checkout" },
      associationPath: conflictingPath,
      requestId: "req_conflicting-checkout" as const,
      inputHash: "conflicting-input-hash",
    }));

    const explicitStore = store as typeof store & {
      resolveById(projectId: typeof firstProjectId, canonicalPath: string): ReturnType<typeof store.resolveById>;
    };
    await expect(explicitStore.resolveById(firstProjectId, conflictingPath)).resolves.toEqual({
      ok: false,
      error: {
        rule: "project-association-mismatch",
        selectedProjectId: firstProjectId,
        associatedProjectId: secondProjectId,
      },
    });
  });

  it("refuses a project state file whose embedded ID differs from the requested explicit ID", async () => {
    const store = new FsProjectContextStore({ home });
    await store.initialize(command());
    const projectPath = join(home, "store", firstProjectId, "project.json");
    await writeFile(projectPath, JSON.stringify({ ...command().context, projectId: secondProjectId }), "utf8");

    await expect(store.resolveById(firstProjectId)).resolves.toEqual({
      ok: false,
      error: {
        rule: "project-association-mismatch",
        selectedProjectId: firstProjectId,
        associatedProjectId: secondProjectId,
      },
    });
  });

  it("rejects a symlinked Pharos home instead of following it", async () => {
    const realHome = join(tempRoot, "real-home");
    await mkdir(realHome);
    await symlink(realHome, home);

    await expect(new FsProjectContextStore({ home }).initialize(command())).rejects.toThrow(/symlink/i);
    expect((await lstat(home)).isSymbolicLink()).toBe(true);
  });
});
