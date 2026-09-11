import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const enabled = process.env.PLAYWRIGHT_CONTRACT === "1";

interface PackageManifest {
  readonly name: string;
  readonly version: string;
  readonly bin?: string | Readonly<Record<string, string>>;
}

async function declaredPlaywrightCli(): Promise<string> {
  const manifestPath = require.resolve("playwright/package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as PackageManifest;
  expect(manifest.name).toBe("playwright");
  const bin = typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.playwright;
  expect(bin).toEqual(expect.any(String));
  return resolve(dirname(manifestPath), bin as string);
}

function invoke(cli: string, ...args: string[]) {
  return spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    shell: false,
    timeout: 15_000,
  });
}

describe.skipIf(!enabled)("direct Playwright public CLI contract", () => {
  it("resolves only the exact direct package's declared bin and exposes documented codegen options", async () => {
    const cli = await declaredPlaywrightCli();
    const rootHelp = invoke(cli, "--help");
    const codegenHelp = invoke(cli, "codegen", "--help");

    expect(rootHelp.status).toBe(0);
    expect(rootHelp.stdout).toContain("codegen");
    expect(codegenHelp.status).toBe(0);
    expect(codegenHelp.stdout).toContain("--output");
    expect(codegenHelp.stdout).toContain("--browser");
    expect(codegenHelp.stdout).toContain("chromium");
  });

  it.skip(
    "Browser launch, missing-browser diagnostics, and signal forwarding require an operator-preinstalled Chromium and an interactive TTY; this probe never installs a browser or starts a target without those host prerequisites.",
    () => {},
  );
});
