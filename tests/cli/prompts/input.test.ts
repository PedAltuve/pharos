import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { collectContractInput, readJsonInput } from "../../../src/cli/prompts/input.js";

describe("readJsonInput", () => {
  it("single-reads valid JSON under the cap", async () => {
    const result = await readJsonInput({
      input: "-",
      stdin: Readable.from([Buffer.from('{"contract":"pharos.project-init/1"}')]),
      stdinIsTty: false,
      maxBytes: 1024,
    });

    expect(result).toEqual({ ok: true, value: { contract: "pharos.project-init/1" } });
  });

  it.each([
    { label: "wrong discriminator", input: "-", stdin: Readable.from(['{"contract":"other/1"}']), stdinIsTty: false, expectedContract: "pharos.project-init/1" },
    { label: "TTY stdin", input: "-", stdin: Readable.from([]), stdinIsTty: true },
    { label: "malformed UTF-8", input: "-", stdin: Readable.from([Buffer.from([0xc3, 0x28])]), stdinIsTty: false },
    { label: "malformed JSON", input: "-", stdin: Readable.from(["{"]), stdinIsTty: false },
    { label: "oversized", input: "-", stdin: Readable.from(["12345"]), stdinIsTty: false, maxBytes: 4 },
  ])("refuses $label without echoing input", async ({ input, stdin, stdinIsTty, maxBytes, expectedContract }) => {
    const result = await readJsonInput({ input, stdin, stdinIsTty, maxBytes, expectedContract });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatchObject({ rule: "invalid-input" });
  });

  it("stops streamed file input at the cap before reading later chunks", async () => {
    let readLater = false;
    async function* file() {
      yield "12345";
      readLater = true;
      yield "67890";
    }
    const result = await readJsonInput({
      input: "annotation.json",
      stdin: Readable.from([]),
      stdinIsTty: false,
      maxBytes: 4,
      openFile: () => file(),
    });

    expect(result).toEqual({ ok: false, error: { rule: "invalid-input", category: "oversized" } });
    expect(readLater).toBe(false);
  });

  it("preserves the same JSON-shaped contract from prompts and machine input", async () => {
    const contract = { contract: "pharos.project-init/1", project_name: "Checkout" };
    const interactive = await collectContractInput({
      nonInteractive: false,
      readMachine: async () => ({ ok: true, value: {} }),
      prompt: { async prompt() { return contract; } },
    });
    const machine = await collectContractInput({
      nonInteractive: true,
      input: "input.json",
      readMachine: async () => ({ ok: true, value: contract }),
      prompt: { async prompt() { return undefined; } },
    });

    expect(interactive).toEqual(machine);
  });

  it("does not prompt or mutate through a noninteractive missing-input refusal", async () => {
    let prompted = false;
    const result = await collectContractInput({
      nonInteractive: true,
      readMachine: async () => ({ ok: true, value: {} }),
      prompt: { async prompt() { prompted = true; return {}; } },
    });

    expect(result).toEqual({ ok: false, error: { rule: "invalid-input", category: "missing" } });
    expect(prompted).toBe(false);
  });

  it("maps a prompt cancellation to a typed interruption without machine input", async () => {
    const result = await collectContractInput({
      nonInteractive: false,
      readMachine: async () => ({ ok: true, value: {} }),
      prompt: { async prompt() { return undefined; } },
    });

    expect(result).toEqual({ ok: false, error: { rule: "prompt-cancelled" } });
  });
});
