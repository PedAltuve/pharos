import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { buildInitCommand } from "../../../src/cli/commands/init.js";
import { buildCaptureRecordCommand } from "../../../src/cli/commands/capture-record.js";
import { buildCaptureAnnotateCommand } from "../../../src/cli/commands/capture-annotate.js";
import { buildBeaconInspectCommand } from "../../../src/cli/commands/beacon-inspect.js";
import { bindExecution } from "../../../src/cli/commands/shared.js";
import { Command } from "commander";
import { validAnnotation } from "../../fixtures/capture-annotation.js";
import { createGuidedInputAdapter } from "../../../src/cli/prompts/input.js";

const project = {
  contract: "pharos.project-context/1" as const,
  projectId: "proj_018f47de-7a00-7cc0-8000-000000000001" as const,
  revision: 1 as const,
  name: "Checkout",
  mode: "external" as const,
  environment: "staging" as const,
  baseUrl: "https://staging.example.test/",
  createdAt: "2026-03-01T00:00:00.000Z",
};
const requestId = "req_018f47de-7a00-7cc0-8000-000000000002";
const captureId = "cap_018f47de-7a00-7cc0-8000-000000000003";
const beaconId = "bcn_018f47de-7a00-7cc0-8000-000000000004";

function runtime() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exits: number[] = [];
  return {
    stdout,
    stderr,
    exits,
    writers: { writeOut: (text: string) => stdout.push(text), writeErr: (text: string) => stderr.push(text) },
    setExitCode: (code: number) => exits.push(code),
    homeResolution: () => ({ ok: true as const, value: undefined }),
    ids: { next: () => requestId },
    resolveProject: async () => ({ ok: true as const, value: project }),
  };
}

describe("command boundaries", () => {
  it.each(["encoding", "json", "discriminator", "oversized", "tty", "missing"] as const)("maps machine %s input to usage before init dispatch", async (category) => {
    const env = runtime();
    let initialized = false;
    const command = buildInitCommand({
      ...env,
      input: { collectInit: async () => ({ ok: false as const, error: { rule: "invalid-input" as const, category } }) },
      initialize: { execute: async () => { initialized = true; return { ok: true as const, value: { projectId: project.projectId, nextAction: "capture-record" as const } }; } },
    });

    await command.parseAsync(["node", "init", "--format", "json", "--non-interactive", "--input", "-"]);
    expect(initialized).toBe(false);
    expect(env.exits).toEqual([2]);
  });

  it("validates annotation input before project resolution and dispatch", async () => {
    const env = runtime();
    let resolved = false;
    let annotated = false;
    const command = buildCaptureAnnotateCommand({
      ...env,
      input: { collectAnnotation: async () => ({ ok: false as const, error: { rule: "invalid-input" as const, category: "json" as const } }) },
      resolveProject: async () => { resolved = true; return { ok: true as const, value: project }; },
      annotate: { execute: async () => { annotated = true; return { ok: false as const, error: { rule: "capture-not-found", captureId } }; } },
    });

    await command.parseAsync(["node", "annotate", captureId, "--format", "json", "--non-interactive", "--input", "-"]);
    expect(resolved).toBe(false);
    expect(annotated).toBe(false);
    expect(env.exits).toEqual([2]);
  });

  it("turns invalid generated record and annotation IDs into internal exits without execution", async () => {
    const recordEnv = runtime();
    let recorded = false;
    const record = buildCaptureRecordCommand({
      ...recordEnv,
      ids: { next: () => "bad" },
      isInteractiveTerminal: () => true,
      signal: { aborted: false, onAbort: () => () => {} },
      record: { execute: async () => { recorded = true; return { ok: true as const, value: { captureId, status: "promoted" as const, nextAction: "capture-annotate" as const } }; } },
    });
    await record.parseAsync(["node", "record", "--format", "json", "--no-secret-sources"]);
    expect(recorded).toBe(false);
    expect(recordEnv.exits).toEqual([10]);

    const annotateEnv = runtime();
    let annotated = false;
    const annotate = buildCaptureAnnotateCommand({
      ...annotateEnv,
      ids: { next: () => "bad" },
      input: { collectAnnotation: async () => { throw new Error("must not collect"); } },
      annotate: { execute: async () => { annotated = true; return { ok: false as const, error: { rule: "capture-not-found", captureId } }; } },
    });
    await annotate.parseAsync(["node", "annotate", captureId, "--format", "json"]);
    expect(annotated).toBe(false);
    expect(annotateEnv.exits).toEqual([10]);
  });

  it("turns an invalid generated request ID into an internal exit without dispatch", async () => {
    const env = runtime();
    let initialized = false;
    const command = buildInitCommand({
      ...env,
      ids: { next: () => "not-a-request-id" },
      input: { collectInit: async () => ({ ok: true as const, value: {
        contract: "pharos.project-init/1", project_name: "Checkout", mode: "external", environment: "staging", base_url: "https://staging.example.test", association_path: "/workspace/checkout",
      } }) },
      initialize: { execute: async () => { initialized = true; return { ok: true as const, value: { projectId: project.projectId, nextAction: "capture-record" as const } }; } },
    });

    await command.parseAsync(["node", "init", "--format", "json"]);
    expect(initialized).toBe(false);
    expect(env.exits).toEqual([10]);
    expect(JSON.parse(env.stdout.join(""))).toMatchObject({ outcome: "failed", errors: [{ rule: "internal-error" }] });
  });

  it("rejects init project scoping as usage without initialization", async () => {
    const env = runtime();
    let initialized = false;
    const command = buildInitCommand({
      ...env,
      input: { collectInit: async () => { throw new Error("must not prompt"); } },
      initialize: { execute: async () => { initialized = true; return { ok: true as const, value: { projectId: project.projectId, nextAction: "capture-record" as const } }; } },
    });

    await expect(command.parseAsync(["node", "init", "--format", "json", "--project", project.projectId])).rejects.toMatchObject({ exitCode: 1 });
    expect(initialized).toBe(false);
    expect(env.exits).toEqual([2]);
  });

  it("normalizes missing required arguments and unknown options through the usage seam", async () => {
    const annotation = runtime();
    const annotate = buildCaptureAnnotateCommand({
      ...annotation,
      input: { collectAnnotation: async () => ({ ok: false as const, error: { rule: "prompt-cancelled" as const } }) },
      annotate: { execute: async () => ({ ok: false as const, error: { rule: "capture-not-found", captureId } }) },
    });
    await expect(annotate.parseAsync(["node", "annotate"])).rejects.toMatchObject({ exitCode: 1 });
    expect(annotation.exits).toEqual([2]);

    const initEnv = runtime();
    const init = buildInitCommand({
      ...initEnv,
      input: { collectInit: async () => ({ ok: false as const, error: { rule: "prompt-cancelled" as const } }) },
      initialize: { execute: async () => ({ ok: true as const, value: { projectId: project.projectId, nextAction: "capture-record" as const } }) },
    });
    await expect(init.parseAsync(["node", "init", "--unexpected"])).rejects.toMatchObject({ exitCode: 1 });
    expect(initEnv.exits).toEqual([2]);
  });

  it("normalizes invalid format to usage exit 2 before execution", async () => {
    const env = runtime();
    let invoked = false;
    const command = buildInitCommand({
      ...env,
      input: { collectInit: async () => { invoked = true; return { ok: false as const, error: { rule: "prompt-cancelled" as const } }; } },
      initialize: { execute: async () => ({ ok: true as const, value: { projectId: project.projectId, nextAction: "capture-record" as const } }) },
    });

    await command.parseAsync(["node", "init", "--format", "yaml"]);
    expect(invoked).toBe(false);
    expect(env.exits).toEqual([2]);
  });

  it("normalizes invalid request IDs to usage exit 2 before prompts or dispatch", async () => {
    const env = runtime();
    let prompted = false;
    const command = buildInitCommand({
      ...env,
      input: { collectInit: async () => { prompted = true; return { ok: false as const, error: { rule: "prompt-cancelled" as const } }; } },
      initialize: { execute: async () => ({ ok: true as const, value: { projectId: project.projectId, nextAction: "capture-record" as const } }) },
    });

    await command.parseAsync(["node", "init", "--format", "json", "--request-id", "bad"]);
    expect(prompted).toBe(false);
    expect(env.exits).toEqual([2]);
    expect(JSON.parse(env.stdout.join(""))).toMatchObject({ errors: [{ rule: "invalid-cli-usage" }] });
  });

  it("builds the complete initialization request before invoking the use case", async () => {
    const env = runtime();
    const received: unknown[] = [];
    const command = buildInitCommand({
      ...env,
      input: { collectInit: async () => ({ ok: true as const, value: {
        contract: "pharos.project-init/1", project_name: " Checkout ", mode: "external", environment: "staging",
        base_url: "https://staging.example.test", association_path: "/workspace/checkout",
      } }) },
      initialize: { execute: async (request: unknown) => { received.push(request); return { ok: true as const, value: { projectId: project.projectId, nextAction: "capture-record" as const } }; } },
    });

    await command.parseAsync(["node", "init", "--format", "json"]);
    expect(received).toEqual([{ name: " Checkout ", mode: "external", environment: "staging", baseUrl: "https://staging.example.test", associationPath: "/workspace/checkout", requestId }]);
    expect(env.exits).toEqual([0]);
  });

  it("wires capped machine input into initialization without prompting", async () => {
    const env = runtime();
    const received: unknown[] = [];
    let prompted = false;
    const input = createGuidedInputAdapter({
      stdin: Readable.from([JSON.stringify({
        contract: "pharos.project-init/1", project_name: "Checkout", mode: "external", environment: "staging",
        base_url: "https://staging.example.test", association_path: "/workspace/checkout",
      })]),
      stdinIsTty: false,
      initPrompt: { async prompt() { prompted = true; return {}; } },
      annotationPrompt: { async prompt() { return {}; } },
    });
    const command = buildInitCommand({
      ...env,
      input,
      initialize: { execute: async (request: unknown) => { received.push(request); return { ok: true as const, value: { projectId: project.projectId, nextAction: "capture-record" as const } }; } },
    });

    await command.parseAsync(["node", "init", "--format", "json", "--non-interactive", "--input", "-"]);
    expect(prompted).toBe(false);
    expect(received).toEqual([{ name: "Checkout", mode: "external", environment: "staging", baseUrl: "https://staging.example.test", associationPath: "/workspace/checkout", requestId }]);
  });

  it("passes the full resolved project context and cancellation to recording", async () => {
    const env = runtime();
    const received: unknown[] = [];
    const signal = { aborted: false, onAbort: () => () => {} };
    const command = buildCaptureRecordCommand({
      ...env,
      isInteractiveTerminal: () => true,
      signal,
      record: { execute: async (request: unknown) => { received.push(request); return { ok: true as const, value: { captureId, status: "promoted" as const, nextAction: "capture-annotate" as const } }; } },
    });

    await command.parseAsync(["node", "record", "--format", "json", "--secret-source", "env:TOKEN"]);
    expect(received).toEqual([{
      projectId: project.projectId, contextRevision: 1, url: project.baseUrl, requestId,
      secretSourceReferences: ["env:TOKEN"], noSecretSources: false, terminalMode: "json", signal,
    }]);
    expect(env.exits).toEqual([0]);
  });

  it("maps secret declarations from Commander before record dispatch", async () => {
    const signal = { aborted: false, onAbort: () => () => {} };
    const dispatch = async (args: readonly string[]) => {
      const env = runtime();
      const received: unknown[] = [];
      const command = buildCaptureRecordCommand({
        ...env,
        isInteractiveTerminal: () => true,
        signal,
        record: {
          execute: async (request: unknown) => {
            received.push(request);
            const declaration = request as { readonly noSecretSources: boolean; readonly secretSourceReferences: readonly string[] };
            return declaration.noSecretSources || declaration.secretSourceReferences.length > 0
              ? { ok: true as const, value: { captureId, status: "promoted" as const, nextAction: "capture-annotate" as const } }
              : { ok: false as const, error: { rule: "secret-sources-declaration-required" as const } };
          },
        },
      });
      await command.parseAsync(["node", "record", "--format", "json", ...args]);
      return { env, received };
    };

    const noSources = await dispatch(["--no-secret-sources"]);
    expect(noSources.received).toEqual([expect.objectContaining({ noSecretSources: true, secretSourceReferences: [] })]);
    expect(noSources.env.exits).toEqual([0]);

    const absent = await dispatch([]);
    expect(absent.received).toEqual([expect.objectContaining({ noSecretSources: false, secretSourceReferences: [] })]);
    expect(absent.env.exits).toEqual([3]);

    const declared = await dispatch(["--secret-source", "env:ONE", "--secret-source", "env:TWO"]);
    expect(declared.received).toEqual([expect.objectContaining({ noSecretSources: false, secretSourceReferences: ["env:ONE", "env:TWO"] })]);
    expect(declared.env.exits).toEqual([0]);
  });

  it("uses equivalent machine and prompt contracts to build annotation requests", async () => {
    const invoke = async (nonInteractive: boolean) => {
      const env = runtime();
      const received: unknown[] = [];
      const command = buildCaptureAnnotateCommand({
        ...env,
        input: { collectAnnotation: async () => ({ ok: true as const, value: validAnnotation }) },
        annotate: { execute: async (request: unknown) => { received.push(request); return { ok: true as const, value: { beaconId, draftId: "drf_018f47de-7a00-7cc0-8000-000000000005", revision: 1 as const, status: "open" as const, semanticHash: "hash", captureId, nextAction: "beacon-inspect" as const } }; } },
      });
      await command.parseAsync(["node", "annotate", captureId, "--format", "json", ...(nonInteractive ? ["--non-interactive", "--input", "-"] : [])]);
      return received;
    };

    const expected = [{ projectId: project.projectId, captureId, requestId, annotation: validAnnotation }];
    await expect(invoke(false)).resolves.toEqual(expected);
    await expect(invoke(true)).resolves.toEqual(expected);
  });

  it("builds a read-only inspect request from the resolved project and beacon ID", async () => {
    const env = runtime();
    const received: unknown[] = [];
    const command = buildBeaconInspectCommand({
      ...env,
      inspect: { execute: async (request: unknown) => { received.push(request); return { ok: false as const, error: { rule: "capture-not-found", captureId } }; } },
    });

    await command.parseAsync(["node", "inspect", beaconId, "--format", "json"]);
    expect(received).toEqual([{ projectId: project.projectId, beaconId }]);
    expect(env.exits).toEqual([3]);
    expect(JSON.parse(env.stdout.join(""))).toMatchObject({ outcome: "refused", errors: [{ rule: "capture-not-found", category: "prerequisite" }] });
  });

  it("normalizes prompt cancellation without mutation", async () => {
    const env = runtime();
    let invoked = false;
    const command = buildInitCommand({
      ...env,
      input: { collectInit: async () => ({ ok: false as const, error: { rule: "prompt-cancelled" as const } }) },
      initialize: { execute: async () => { invoked = true; return { ok: true as const, value: { projectId: project.projectId, nextAction: "capture-record" as const } }; } },
    });
    await command.parseAsync(["node", "init", "--format", "json"]);
    expect(invoked).toBe(false);
    expect(env.exits).toEqual([5]);
    expect(JSON.parse(env.stdout.join(""))).toMatchObject({ outcome: "interrupted" });
  });

  it("normalizes executor throws to one internal JSON envelope and exit 10", async () => {
    const env = runtime();
    const command = buildInitCommand({
      ...env,
      input: { collectInit: async () => ({ ok: true as const, value: {
        contract: "pharos.project-init/1", project_name: "Checkout", mode: "external", environment: "staging", base_url: "https://staging.example.test", association_path: "/workspace/checkout",
      } }) },
      initialize: { execute: async () => { throw new Error("canary /private/adapter"); } },
    });
    await command.parseAsync(["node", "init", "--format", "json"]);
    expect(env.exits).toEqual([10]);
    expect(env.stderr).toEqual([]);
    expect(env.stdout).toHaveLength(1);
    expect(env.stdout.join("")).not.toContain("canary");
    expect(JSON.parse(env.stdout.join(""))).toMatchObject({ outcome: "failed", errors: [{ rule: "internal-error", category: "internal" }] });
  });

  it("refuses unavailable homes and missing TTYs before executors", async () => {
    const home = runtime();
    let initialized = false;
    const init = buildInitCommand({
      ...home,
      homeResolution: () => ({ ok: false as const, error: { rule: "invalid-pharos-home" } }),
      input: { collectInit: async () => { throw new Error("prompted"); } },
      initialize: { execute: async () => { initialized = true; return { ok: true as const, value: { projectId: project.projectId, nextAction: "capture-record" as const } }; } },
    });
    await init.parseAsync(["node", "init", "--format", "json"]);
    expect(initialized).toBe(false);
    expect(home.exits).toEqual([3]);

    const tty = runtime();
    let recorded = false;
    const record = buildCaptureRecordCommand({
      ...tty,
      isInteractiveTerminal: () => false,
      signal: { aborted: false, onAbort: () => () => {} },
      record: { execute: async () => { recorded = true; return { ok: true as const, value: { captureId, status: "promoted" as const, nextAction: "capture-annotate" as const } }; } },
    });
    await record.parseAsync(["node", "record", "--format", "json", "--no-secret-sources"]);
    expect(recorded).toBe(false);
    expect(tty.exits).toEqual([3]);
  });

  it.each([
    { command: "bad /private", outcome: "succeeded", data: {}, errors: [], nextAction: null },
    { command: "init", outcome: "bad", data: {}, errors: [], nextAction: null },
    { command: "init", outcome: "refused", data: {}, errors: [{ rule: "invalid-contract", category: "bad", field: "/" }], nextAction: null },
    { command: "init", outcome: "refused", data: {}, errors: [{ rule: "raw diagnostics", category: "validation", field: "/" }], nextAction: null },
    { command: "init", outcome: "refused", data: {}, errors: [], nextAction: { command: "pharos /private", reason: "unsafe" } },
  ])("keeps malformed public scalar exit and JSON envelope coherent", async (malformed) => {
    const env = runtime();
    const command = bindExecution(new Command("scalar").option("--format <format>", "format", "json"), env, async () => malformed as never);
    await command.parseAsync(["node", "scalar"]);
    expect(env.exits).toEqual([10]);
    expect(JSON.parse(env.stdout.join(""))).toMatchObject({ outcome: "failed", errors: [{ rule: "internal-error" }] });
  });

  it("normalizes throwing outcome getters at the command boundary", async () => {
    const env = runtime();
    const command = bindExecution(new Command("getter").option("--format <format>", "format", "json"), env, async () => {
      const outcome = Object.create(null) as Record<string, unknown>;
      Object.defineProperty(outcome, "outcome", { get() { throw new Error("raw outcome"); } });
      return outcome as never;
    });

    await command.parseAsync(["node", "getter"]);
    expect(env.exits).toEqual([10]);
    expect(JSON.parse(env.stdout.join(""))).toMatchObject({ outcome: "failed", errors: [{ rule: "internal-error" }] });
  });

  it("propagates an inconclusive command outcome through the exit seam", async () => {
    const env = runtime();
    const command = bindExecution(new Command("probe").option("--format <format>", "format", "json"), env, async () => ({
      command: "probe", outcome: "inconclusive", data: {}, errors: [], nextAction: null,
    }));

    await command.parseAsync(["node", "probe"]);
    expect(env.exits).toEqual([4]);
  });

  it("gives modeled capture failures exit 1 and a non-internal human diagnostic", async () => {
    const env = runtime();
    const command = buildCaptureRecordCommand({
      ...env,
      isInteractiveTerminal: () => true,
      signal: { aborted: false, onAbort: () => () => {} },
      record: { execute: async () => ({ ok: true as const, value: { captureId, status: "failed" as const, nextAction: "rerun-capture" as const } }) },
    });
    await command.parseAsync(["node", "record", "--no-secret-sources"]);
    expect(env.exits).toEqual([1]);
    expect(env.stderr).toEqual(["pharos: operation failed\n"]);
  });
});
