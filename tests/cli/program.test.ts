import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createUnregisteredCommandSet } from "../../src/cli/composition.js";
import {
  createProgram,
  loadPackageVersion,
  runCli,
} from "../../src/cli/program.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const FORBIDDEN_LATER_LIFECYCLE_VOCABULARY = [
  "approval",
  "revocation",
  "generation",
  "execution",
  "evidence",
  "verification",
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

function createComposedCommands() {
  const { writeOut, writeErr } = makeWriters();
  return createUnregisteredCommandSet({
    writers: { writeOut, writeErr },
    setExitCode: () => {},
  });
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
  it("identifies pharos and lists exactly the supported guided journey on --help", async () => {
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
    for (const command of [
      "pharos init",
      "pharos capture record",
      "pharos capture annotate <capture-id>",
      "pharos beacon inspect <beacon-id>",
    ]) {
      expect(output).toContain(command);
    }
    for (const term of FORBIDDEN_LATER_LIFECYCLE_VOCABULARY) {
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
    expect(output).toContain("pharos init");
    expect(output).toContain("pharos capture record");
    expect(output).toContain("pharos capture annotate <capture-id>");
    expect(output).toContain("pharos beacon inspect <beacon-id>");
  });
});

describe("createProgram command catalogue", () => {
  it("registers only the complete guided journey without aliases", () => {
    const program = createProgram(createComposedCommands(), { version: "1.0.0" });

    expect(program.commands.map((command) => command.name())).toEqual(["init", "capture", "beacon"]);
    const capture = program.commands.find((command) => command.name() === "capture");
    const beacon = program.commands.find((command) => command.name() === "beacon");
    expect(capture?.commands.map((command) => command.name())).toEqual(["record", "annotate"]);
    expect(beacon?.commands.map((command) => command.name())).toEqual(["inspect"]);
    expect([...program.commands, ...(capture?.commands ?? []), ...(beacon?.commands ?? [])]
      .flatMap((command) => command.aliases())).toEqual([]);
  });
});

describe("program construction", () => {
  it("requires ordinary composed commands and exposes no command replacement hook", () => {
    const source = readFileSync(path.join(repoRoot, "src/cli/program.ts"), "utf8");
    const entry = readFileSync(path.join(repoRoot, "src/cli/index.ts"), "utf8");

    expect(createProgram.length).toBe(1);
    expect(source).toContain("const commands = createUnregisteredCommandSet({ writers, setExitCode });");
    expect(source).not.toContain("createCommandSet");
    expect(source.match(/createUnregisteredCommandSet\(/g)).toHaveLength(1);
    expect(entry).not.toMatch(/fake|test.*command|command.*test/i);
  });
});

describe("runCli unknown command handling", () => {
  it("rejects an unknown command with exit status 2", async () => {
    const { outLines, errLines, writeOut, writeErr } = makeWriters();

    const status = await runCli(["node", "pharos", "unknown"], {
      version: "1.0.0",
      writeOut,
      writeErr,
    });

    expect(status).toBe(2);
    expect(outLines).toEqual([]);
    expect(errLines.join("")).toContain("unknown command 'unknown'");
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

    const status = await runCli(["node", "pharos", "capture", "record", "extra"], {
      version: "1.0.0",
      writeOut,
      writeErr,
    });

    expect(status).toBe(2);
    expect(errLines.length).toBeGreaterThan(0);
  });
});
