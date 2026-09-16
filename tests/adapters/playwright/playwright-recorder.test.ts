import { describe, expect, it } from "vitest";
import {
  PlaywrightRecorder,
  type RecorderProcess,
  type RecorderSpawn,
} from "../../../src/adapters/playwright/playwright-recorder.js";

const projectId = "proj_018f47de-7a00-7cc0-8000-000000000001" as const;
const captureId = "cap_018f47de-7a00-7cc0-8000-000000000001" as const;
const url = "http://localhost:3000/";

function fakeProcess(result: { readonly code: number | null; readonly signal: string | null }): RecorderProcess & { readonly kills: string[] } {
  const kills: string[] = [];
  return {
    kills,
    kill(signal) { kills.push(signal); },
    async waitForExit() { return result; },
  };
}

function recorder(spawn: RecorderSpawn) {
  return new PlaywrightRecorder({
    projectRoot: "/private/pharos/store/project",
    resolveCli: async () => "/private/node_modules/playwright/cli.js",
    spawn,
  });
}

describe("PlaywrightRecorder", () => {
  it("uses only the public codegen argument vector with shell disabled and human inherited streams", async () => {
    const calls: unknown[][] = [];
    const target = recorder(((...args) => {
      calls.push(args);
      return fakeProcess({ code: 0, signal: null });
    }) as RecorderSpawn);

    await expect(target.record({ projectId, captureId, url, terminalMode: "human", signal: { aborted: false } })).resolves.toEqual({ kind: "exited", exitCode: 0 });

    expect(calls).toEqual([[process.execPath, [
      "/private/node_modules/playwright/cli.js",
      "codegen",
      "--browser",
      "chromium",
      "--output",
      `/private/pharos/store/project/capture-staging/${captureId}/recording.spec.ts`,
      url,
    ], { shell: false, stdio: "inherit" }]]);
    expect((calls[0]?.[1] as readonly string[]).join(" ")).not.toContain("install");
    expect((calls[0]?.[1] as readonly string[]).join(" ")).not.toContain("npx");
  });

  it("isolates stdout in JSON mode and classifies non-zero and spawn failures without a browser", async () => {
    const jsonCalls: unknown[][] = [];
    const jsonRecorder = recorder(((...args) => {
      jsonCalls.push(args);
      return fakeProcess({ code: 12, signal: null });
    }) as RecorderSpawn);
    const unavailable = recorder((() => { throw new Error("missing runtime"); }) as RecorderSpawn);

    await expect(jsonRecorder.record({ projectId, captureId, url, terminalMode: "json", signal: { aborted: false } })).resolves.toEqual({ kind: "exited", exitCode: 12 });
    await expect(unavailable.record({ projectId, captureId, url, terminalMode: "human", signal: { aborted: false } })).resolves.toEqual({ kind: "prerequisite-or-process-failure" });
    expect(jsonCalls[0]?.[2]).toEqual({ shell: false, stdio: ["inherit", "ignore", "inherit"] });
  });

  it("does not spawn when cancellation occurs while CLI resolution is pending", async () => {
    let resolveCli: (path: string) => void;
    let aborted = false;
    let spawnCalls = 0;
    const target = new PlaywrightRecorder({
      projectRoot: "/private/pharos/store/project",
      resolveCli: () => new Promise((resolve) => { resolveCli = resolve; }),
      spawn: (() => { spawnCalls += 1; return fakeProcess({ code: 0, signal: null }); }) as RecorderSpawn,
    });

    const recording = target.record({
      projectId,
      captureId,
      url,
      terminalMode: "human",
      signal: { get aborted() { return aborted; } },
    });
    aborted = true;
    resolveCli!("/private/node_modules/playwright/cli.js");

    await expect(recording).resolves.toEqual({ kind: "interrupted" });
    expect(spawnCalls).toBe(0);
  });

  it("does not spawn when cancellation wins during abort-listener registration", async () => {
    let aborted = false;
    let spawnCalls = 0;
    const target = new PlaywrightRecorder({
      projectRoot: "/private/pharos/store/project",
      resolveCli: async () => "/private/node_modules/playwright/cli.js",
      spawn: (() => { spawnCalls += 1; return fakeProcess({ code: 0, signal: null }); }) as RecorderSpawn,
    });

    await expect(target.record({
      projectId,
      captureId,
      url,
      terminalMode: "human",
      signal: {
        get aborted() { return aborted; },
        onAbort(listener) { aborted = true; listener(); return () => {}; },
      },
    })).resolves.toEqual({ kind: "interrupted" });
    expect(spawnCalls).toBe(0);
  });

  it("returns interrupted after its owned-child cancellation even if the child reports exit zero", async () => {
    let abort: (() => void) | undefined;
    const child: RecorderProcess & { readonly kills: string[] } = {
      kills: [],
      kill(signal) { this.kills.push(signal); },
      async waitForExit() { abort?.(); return { code: 0, signal: null }; },
    };
    const target = recorder((() => child) as RecorderSpawn);

    await expect(target.record({
      projectId,
      captureId,
      url,
      terminalMode: "human",
      signal: { aborted: false, onAbort(listener: () => void) { abort = listener; return () => {}; } },
    })).resolves.toEqual({ kind: "interrupted" });
    expect(child.kills).toEqual(["SIGINT"]);
  });

  it("forwards cancellation only to the owned fake child and returns interrupted", async () => {
    let abort: (() => void) | undefined;
    const child: RecorderProcess & { readonly kills: string[] } = {
      kills: [],
      kill(signal) { this.kills.push(signal); },
      async waitForExit() { abort?.(); return { code: null, signal: "SIGINT" }; },
    };
    const target = recorder((() => child) as RecorderSpawn);

    await expect(target.record({
      projectId,
      captureId,
      url,
      terminalMode: "human",
      signal: { aborted: false, onAbort(listener: () => void) { abort = listener; return () => {}; } },
    })).resolves.toEqual({ kind: "interrupted" });

    expect(child.kills).toEqual(["SIGINT"]);
  });
});
