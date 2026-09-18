import { describe, expect, it } from "vitest";
import { createUnregisteredCommandSet } from "../../src/cli/composition.js";

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

describe("unregistered composed command set", () => {
  it("applies command home overrides before init dispatch without registering root commands", async () => {
    const homes: Array<string | undefined> = [];
    const stdout: string[] = [];
    const commands = createUnregisteredCommandSet({
      createComposition: (pharosHome) => {
        homes.push(pharosHome);
        return {
          homeResolution: () => ({ ok: true as const, value: undefined }),
          initialize: { execute: async () => ({ ok: true as const, value: { projectId: project.projectId, nextAction: "capture-record" as const } }) },
          resolveProject: async () => ({ ok: true as const, value: project }),
          forProject: () => undefined,
        };
      },
      ids: { next: () => "req_018f47de-7a00-7cc0-8000-000000000002" },
      stdin: (async function* () { yield JSON.stringify({
        contract: "pharos.project-init/1", project_name: "Checkout", mode: "external", environment: "staging", base_url: "https://staging.example.test", association_path: "/workspace/checkout",
      }); })(),
      stdinIsTty: false,
      initPrompt: { async prompt() { throw new Error("must not prompt"); } },
      annotationPrompt: { async prompt() { throw new Error("must not prompt"); } },
      isInteractiveTerminal: () => false,
      writers: { writeOut: (text) => stdout.push(text), writeErr: () => {} },
      setExitCode: () => {},
    });

    expect(commands.root.commands).toHaveLength(0);
    await commands.init.parseAsync(["node", "init", "--format", "json", "--pharos-home", "/override", "--non-interactive", "--input", "-"]);
    expect(homes).toContain("/override");
    expect(JSON.parse(stdout.join(""))).toMatchObject({ outcome: "succeeded" });
  });

  it.each([false, true])("uses the injected production TTY seam (%s) before recorder dispatch", async (tty) => {
    let records = 0;
    const scoped: unknown[] = [];
    const commands = createUnregisteredCommandSet({
      createComposition: () => ({
        homeResolution: () => ({ ok: true as const, value: undefined }),
        initialize: undefined,
        resolveProject: async () => ({ ok: true as const, value: project }),
        forProject: (context) => {
          scoped.push(context);
          return ({
          record: { execute: async () => { records++; return { ok: true as const, value: { captureId: "cap_018f47de-7a00-7cc0-8000-000000000003", status: "promoted" as const, nextAction: "capture-annotate" as const } }; } },
          annotate: { execute: async () => ({ ok: false as const, error: { rule: "capture-not-found", captureId: "cap_018f47de-7a00-7cc0-8000-000000000003" } }) },
          inspect: { execute: async () => ({ ok: false as const, error: { rule: "capture-not-found", captureId: "cap_018f47de-7a00-7cc0-8000-000000000003" } }) },
          }) as never;
        },
      }),
      stdin: (async function* () {})(),
      stdinIsTty: false,
      initPrompt: { async prompt() { return undefined; } },
      annotationPrompt: { async prompt() { return undefined; } },
      isInteractiveTerminal: () => tty,
      writers: { writeOut: () => {}, writeErr: () => {} },
      setExitCode: () => {},
    });

    await commands.captureRecord.parseAsync(["node", "record", "--no-secret-sources"]);
    expect(records).toBe(tty ? 1 : 0);
    expect(scoped).toEqual(tty ? [project] : []);
  });
});
