import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createProgram,
  loadPackageVersion,
  runCli,
} from "../../src/cli/program.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const FORBIDDEN_VOCABULARY = [
  "beacon",
  "browser",
  "storage",
  "recording",
  "annotation",
  "approval",
  "revocation",
  "draft",
  "json",
];

function makeWriters() {
  const outLines: string[] = [];
  const errLines: string[] = [];
  return {
    outLines,
    errLines,
    writeOut: (text: string) => {
      outLines.push(text);
    },
    writeErr: (text: string) => {
      errLines.push(text);
    },
  };
}

describe("runCli --version", () => {
  it("writes exactly the injected version and exits 0", async () => {
    const { outLines, errLines, writeOut, writeErr } = makeWriters();

    const status = await runCli(["node", "pharos", "--version"], {
      version: "9.9.9",
      writeOut,
      writeErr,
    });

    expect(status).toBe(0);
    expect(outLines.join("")).toBe("9.9.9\n");
    expect(errLines).toEqual([]);
  });

  it("loads the real version from the installed package manifest", () => {
    const manifest = JSON.parse(
      readFileSync(path.join(repoRoot, "package.json"), "utf8"),
    ) as { version: string };

    expect(loadPackageVersion()).toBe(manifest.version);
  });
});

describe("runCli --help and no arguments", () => {
  it("identifies pharos, lists no commands, and avoids product vocabulary on --help", async () => {
    const { outLines, errLines, writeOut, writeErr } = makeWriters();

    const status = await runCli(["node", "pharos", "--help"], {
      version: "1.0.0",
      writeOut,
      writeErr,
    });
    const output = outLines.join("");
    const lowerOutput = output.toLowerCase();

    expect(status).toBe(0);
    expect(errLines).toEqual([]);
    expect(output).toContain("pharos");
    expect(output).toContain("-h, --help");
    expect(output).toContain("-V, --version");
    expect(output).not.toContain("Commands:");
    for (const term of FORBIDDEN_VOCABULARY) {
      expect(lowerOutput).not.toContain(term);
    }
  });

  it("prints the same identifying help with no arguments and exits 0", async () => {
    const { outLines, errLines, writeOut, writeErr } = makeWriters();

    const status = await runCli(["node", "pharos"], {
      version: "1.0.0",
      writeOut,
      writeErr,
    });
    const output = outLines.join("");

    expect(status).toBe(0);
    expect(errLines).toEqual([]);
    expect(output).toContain("pharos");
    expect(output).not.toContain("Commands:");
  });
});

describe("createProgram command catalogue", () => {
  it("registers zero subcommands", () => {
    const program = createProgram({ version: "1.0.0" });

    expect(program.commands).toHaveLength(0);
  });
});

describe("runCli unknown command handling", () => {
  it("rejects 'beacon' as an unknown command with exit status 2", async () => {
    const { outLines, errLines, writeOut, writeErr } = makeWriters();

    const status = await runCli(["node", "pharos", "beacon"], {
      version: "1.0.0",
      writeOut,
      writeErr,
    });

    expect(status).toBe(2);
    expect(outLines).toEqual([]);
    expect(errLines.join("")).toContain("unknown command 'beacon'");
  });
});

describe("runCli usage-error normalization", () => {
  it("rejects an unrecognized option with exit status 2", async () => {
    const { errLines, writeOut, writeErr } = makeWriters();

    const status = await runCli(["node", "pharos", "--does-not-exist"], {
      version: "1.0.0",
      writeOut,
      writeErr,
    });

    expect(status).toBe(2);
    expect(errLines.length).toBeGreaterThan(0);
  });

  it("rejects excess operands with exit status 2", async () => {
    const { errLines, writeOut, writeErr } = makeWriters();

    const status = await runCli(["node", "pharos", "beacon", "extra"], {
      version: "1.0.0",
      writeOut,
      writeErr,
    });

    expect(status).toBe(2);
    expect(errLines.length).toBeGreaterThan(0);
  });
});
