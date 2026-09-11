import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const SHEBANG = "#!/usr/bin/env node\n";
const BUILT_ENTRY = path.join(repoRoot, "dist/cli/index.js");
const schemaPaths = [
  "dist/contracts/schemas/project-init.schema.json",
  "dist/contracts/schemas/capture-annotation.schema.json",
  "dist/contracts/schemas/cli-envelope.schema.json",
];

async function run(command: string, args: string[], cwd: string) {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, { cwd });
    return { status: 0, stdout, stderr };
  } catch (error) {
    const err = error as { code?: number; stdout?: string; stderr?: string };
    return { status: err.code ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

async function readRepoManifest(): Promise<Record<string, unknown>> {
  return JSON.parse(
    await readFile(path.join(repoRoot, "package.json"), "utf8"),
  ) as Record<string, unknown>;
}

describe("built and packaged distribution", () => {
  let tempDir: string;

  beforeAll(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "pharos-dist-"));
    await rm(path.join(repoRoot, "dist"), { recursive: true, force: true });
    await execFileAsync("npm", ["run", "build"], { cwd: repoRoot });
  }, 120_000);

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("emits the built entry with the exact shebang", async () => {
    expect(existsSync(BUILT_ENTRY)).toBe(true);
    const contents = await readFile(BUILT_ENTRY, "utf8");
    expect(contents.startsWith(SHEBANG)).toBe(true);
  });

  it("runs the built entry for --help, --version, and beacon", async () => {
    const manifest = await readRepoManifest();

    const help = await run("node", [BUILT_ENTRY, "--help"], repoRoot);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("pharos");

    const version = await run("node", [BUILT_ENTRY, "--version"], repoRoot);
    expect(version.status).toBe(0);
    expect(version.stdout).toBe(`${manifest.version as string}\n`);

    const beacon = await run("node", [BUILT_ENTRY, "beacon"], repoRoot);
    expect(beacon.status).toBe(2);
    expect(beacon.stderr).toContain("unknown command 'beacon'");
  });

  it("declares the exact publishable manifest contract", async () => {
    const manifest = await readRepoManifest();

    expect(
      Object.keys(manifest.scripts as Record<string, string>).sort(),
    ).toEqual([
      "build",
      "lint",
      "test",
      "test:playwright-contract",
      "test:watch",
      "typecheck",
    ]);
    expect(manifest.private).toBeUndefined();
    for (const hook of ["prepare", "prepack", "postpack", "prepublish", "postinstall"]) {
      expect(manifest[hook]).toBeUndefined();
    }
    expect(manifest.type).toBe("module");
    expect((manifest.engines as { node: string }).node).toBe(">=20");
    expect(manifest.license).toBe("MIT");
    expect(manifest.bin).toEqual({ pharos: "dist/cli/index.js" });
    expect(manifest.files).toEqual(["dist/", "README.md", "LICENSE"]);
    expect((manifest.dependencies as Record<string, string>).commander).toBe(
      "14.0.1",
    );
  });

  it("packs a dry-run archive with only the intended distributable files", async () => {
    const { stdout } = await execFileAsync(
      "npm",
      ["pack", "--dry-run", "--json", "--ignore-scripts"],
      { cwd: repoRoot },
    );
    const [report] = JSON.parse(stdout) as Array<{
      files: Array<{ path: string }>;
    }>;
    const files = (report as { files: Array<{ path: string }> }).files.map(
      (entry) => entry.path,
    );

    expect(files).toContain("package.json");
    expect(files).toContain("README.md");
    expect(files).toContain("LICENSE");
    expect(files).toContain("dist/cli/index.js");
    for (const schemaPath of schemaPaths) {
      expect(files).toContain(schemaPath);
    }
    for (const file of files) {
      const allowed =
        file === "package.json" ||
        file === "README.md" ||
        file === "LICENSE" ||
        file.startsWith("dist/");
      expect(allowed).toBe(true);
    }
  });

  it("installs the packed archive and runs the installed executable", async () => {
    const { stdout } = await execFileAsync(
      "npm",
      ["pack", "--json", "--ignore-scripts", "--pack-destination", tempDir],
      { cwd: repoRoot },
    );
    const [packEntry] = JSON.parse(stdout) as Array<{ filename: string }>;
    if (!packEntry) {
      throw new Error("npm pack --json produced no result entries");
    }
    const tarballPath = path.join(tempDir, packEntry.filename);

    const consumerDir = path.join(tempDir, "consumer");
    await mkdir(consumerDir, { recursive: true });
    await writeFile(
      path.join(consumerDir, "package.json"),
      JSON.stringify({ name: "consumer", version: "0.0.0", private: true }),
    );
    await execFileAsync(
      "npm",
      [
        "install",
        "--ignore-scripts",
        "--offline",
        "--no-audit",
        "--no-fund",
        "--package-lock=false",
        tarballPath,
      ],
      { cwd: consumerDir },
    );

    const installedManifest = JSON.parse(
      await readFile(
        path.join(consumerDir, "node_modules/pharos/package.json"),
        "utf8",
      ),
    ) as { version: string; bin: Record<string, string> };
    expect(installedManifest.bin).toEqual({ pharos: "dist/cli/index.js" });
    const installedBinPath = installedManifest.bin.pharos;
    if (!installedBinPath) {
      throw new Error("installed manifest does not map 'pharos' to a bin target");
    }

    const installedEntry = path.join(
      consumerDir,
      "node_modules/pharos",
      installedBinPath,
    );
    const contents = await readFile(installedEntry, "utf8");
    expect(contents.startsWith(SHEBANG)).toBe(true);

    for (const schemaPath of schemaPaths) {
      const schema = JSON.parse(
        await readFile(
          path.join(consumerDir, "node_modules/pharos", schemaPath),
          "utf8",
        ),
      ) as { $schema?: string };
      expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    }

    const shim = path.join(
      consumerDir,
      "node_modules/.bin",
      process.platform === "win32" ? "pharos.cmd" : "pharos",
    );
    expect(existsSync(shim)).toBe(true);

    const help = await run(shim, ["--help"], consumerDir);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("pharos");

    const version = await run(shim, ["--version"], consumerDir);
    expect(version.status).toBe(0);
    expect(version.stdout).toBe(`${installedManifest.version}\n`);
  }, 60_000);
});
