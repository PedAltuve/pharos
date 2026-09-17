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
    pid: 4242,
    kills,
    kill(signal) { kills.push(signal); },
    async waitForExit() { return result; },
  };
}

function cancellationSignal(initial = false) {
  let aborted = initial;
  let listener: (() => void) | undefined;
  let removals = 0;
  return {
    signal: {
      get aborted() { return aborted; },
      onAbort(next: () => void) {
        listener = next;
        return () => {
          removals += 1;
          if (listener === next) listener = undefined;
        };
      },
    },
    abort() {
      aborted = true;
      listener?.();
    },
    get removals() { return removals; },
  };
}

function passiveSignal() {
  return cancellationSignal().signal;
}

function controlledDelays() {
  const waits: Array<{ readonly milliseconds: number; resolve: () => void; disposed: boolean; released: boolean }> = [];
  return {
    delay(milliseconds: number) {
      let resolve!: () => void;
      const elapsed = new Promise<void>((done) => { resolve = done; });
      const wait = { milliseconds, resolve, disposed: false, released: false };
      waits.push(wait);
      return {
        elapsed,
        dispose() { wait.disposed = true; },
      };
    },
    releaseNext() {
      const wait = waits.find((candidate) => !candidate.released);
      if (wait === undefined) throw new Error("no pending delay");
      wait.released = true;
      wait.resolve();
    },
    get milliseconds() { return waits.map((wait) => wait.milliseconds); },
    get disposed() { return waits.map((wait) => wait.disposed); },
  };
}

async function settle(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

function recorder(spawn: RecorderSpawn) {
  return new PlaywrightRecorder({
    projectRoot: "/private/pharos/store/project",
    resolveCli: async () => "/private/node_modules/playwright/cli.js",
    spawn,
  });
}

function command(signal = passiveSignal()) {
  return { projectId, captureId, url, terminalMode: "human" as const, signal, onStarted: async () => {} };
}

describe("PlaywrightRecorder", () => {
  it("uses only the public codegen argument vector with shell disabled and human inherited streams", async () => {
    const calls: unknown[][] = [];
    const cancellation = cancellationSignal();
    const target = recorder(((...args) => {
      calls.push(args);
      return fakeProcess({ code: 0, signal: null });
    }) as RecorderSpawn);

    await expect(target.record(command(cancellation.signal))).resolves.toEqual({ kind: "exited", exitCode: 0 });
    expect(cancellation.removals).toBe(1);

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
    const cancellation = cancellationSignal();

    await expect(jsonRecorder.record({ ...command(), terminalMode: "json" })).resolves.toEqual({ kind: "exited", exitCode: 12 });
    await expect(unavailable.record(command(cancellation.signal))).resolves.toEqual({ kind: "prerequisite-or-process-failure" });
    expect(cancellation.removals).toBe(1);
    expect(jsonCalls[0]?.[2]).toEqual({ shell: false, stdio: ["inherit", "ignore", "inherit"] });
  });

  it("does not spawn when pre-spawn cancellation occurs while CLI resolution is pending", async () => {
    let resolveCli!: (path: string) => void;
    let spawnCalls = 0;
    const cancellation = cancellationSignal();
    const target = new PlaywrightRecorder({
      projectRoot: "/private/pharos/store/project",
      resolveCli: () => new Promise((resolve) => { resolveCli = resolve; }),
      spawn: (() => { spawnCalls += 1; return fakeProcess({ code: 0, signal: null }); }) as RecorderSpawn,
    });

    const recording = target.record(command(cancellation.signal));
    cancellation.abort();
    resolveCli("/private/node_modules/playwright/cli.js");

    await expect(recording).resolves.toEqual({ kind: "operator-cancelled" });
    expect(spawnCalls).toBe(0);
    expect(cancellation.removals).toBe(1);
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
      ...command(),
      signal: {
        get aborted() { return aborted; },
        onAbort(listener) { aborted = true; listener(); return () => {}; },
      },
    })).resolves.toEqual({ kind: "operator-cancelled" });
    expect(spawnCalls).toBe(0);
  });

  it("exposes spawned PID evidence with an attached exit observer and probes PID liveness conservatively", async () => {
    let waitForExitCalls = 0;
    const child = fakeProcess({ code: 0, signal: null });
    const target = new PlaywrightRecorder({
      projectRoot: "/private/pharos/store/project",
      resolveCli: async () => "/private/node_modules/playwright/cli.js",
      spawn: (() => ({ ...child, pid: 4242, async waitForExit() {
        waitForExitCalls += 1;
        return { code: 0, signal: null };
      } })) as RecorderSpawn,
      probeProcess: (pid) => pid === 4242,
    });

    const run = await target.start(command());
    expect(run.evidence).toEqual({ pid: 4242 });
    expect(waitForExitCalls).toBe(1);
    await expect(run.waitForCompletion()).resolves.toEqual({ kind: "exited", exitCode: 0 });
    await expect(target.isProcessActive({ pid: 4242 })).resolves.toBe(true);
    await expect(target.isProcessActive({ pid: 4243 })).resolves.toBe(false);
  });

  it("maps an unsolicited child signal to the safe signal result without sending a signal", async () => {
    const child = fakeProcess({ code: null, signal: "SIGTERM" });
    const cancellation = cancellationSignal();

    await expect(recorder((() => child) as RecorderSpawn).record(command(cancellation.signal))).resolves.toEqual({ kind: "signalled" });

    expect(child.kills).toEqual([]);
    expect(cancellation.removals).toBe(1);
  });

  it("escalates only its owned child through bounded deterministic delays and reports it still active", async () => {
    const cancellation = cancellationSignal();
    const delays = controlledDelays();
    let resolveExit!: (result: { readonly code: number | null; readonly signal: string | null }) => void;
    const exit = new Promise<{ readonly code: number | null; readonly signal: string | null }>((resolve) => { resolveExit = resolve; });
    let waitForExitCalls = 0;
    const child: RecorderProcess & { readonly kills: string[] } = {
      pid: 4242,
      kills: [],
      kill(signal) { this.kills.push(signal); },
      waitForExit() { waitForExitCalls += 1; return exit; },
    };
    const target = new PlaywrightRecorder({
      projectRoot: "/private/pharos/store/project",
      resolveCli: async () => "/private/node_modules/playwright/cli.js",
      spawn: (() => child) as RecorderSpawn,
      cancellationGraceMs: 50,
      delay: delays.delay,
    });

    const recording = target.record(command(cancellation.signal));
    await settle();
    cancellation.abort();
    await settle();
    expect(child.kills).toEqual(["SIGINT"]);
    expect(delays.milliseconds).toEqual([50]);

    delays.releaseNext();
    await settle();
    expect(child.kills).toEqual(["SIGINT", "SIGTERM"]);
    delays.releaseNext();
    await settle();
    expect(child.kills).toEqual(["SIGINT", "SIGTERM", "SIGKILL"]);
    delays.releaseNext();
    await settle();

    await expect(recording).resolves.toEqual({ kind: "process-still-active" });
    expect(waitForExitCalls).toBe(1);
    expect(delays.milliseconds).toEqual([50, 50, 50]);
    expect(delays.disposed).toEqual([true, true, true]);
    expect(cancellation.removals).toBe(1);
    resolveExit({ code: null, signal: "SIGKILL" });
  });

  it("stops escalation when the owned child exits during a bounded wait", async () => {
    const cancellation = cancellationSignal();
    const delays = controlledDelays();
    let resolveExit!: (result: { readonly code: number | null; readonly signal: string | null }) => void;
    const exit = new Promise<{ readonly code: number | null; readonly signal: string | null }>((resolve) => { resolveExit = resolve; });
    const child: RecorderProcess & { readonly kills: string[] } = {
      pid: 4242,
      kills: [],
      kill(signal) { this.kills.push(signal); },
      waitForExit() { return exit; },
    };
    const target = new PlaywrightRecorder({
      projectRoot: "/private/pharos/store/project",
      resolveCli: async () => "/private/node_modules/playwright/cli.js",
      spawn: (() => child) as RecorderSpawn,
      cancellationGraceMs: 50,
      delay: delays.delay,
    });

    const recording = target.record(command(cancellation.signal));
    await settle();
    cancellation.abort();
    await settle();
    delays.releaseNext();
    await settle();
    resolveExit({ code: null, signal: "SIGTERM" });

    await expect(recording).resolves.toEqual({ kind: "operator-cancelled" });
    expect(child.kills).toEqual(["SIGINT", "SIGTERM"]);
    expect(delays.disposed).toEqual([true, true]);
    expect(cancellation.removals).toBe(1);
  });

  it("attaches one exit observer synchronously before application PID persistence can wait", async () => {
    let waitForExitCalls = 0;
    let resolveExit!: (result: { readonly code: number | null; readonly signal: string | null }) => void;
    const child: RecorderProcess = {
      pid: 4242,
      kill() {},
      waitForExit() {
        waitForExitCalls += 1;
        return new Promise((resolve) => { resolveExit = resolve; });
      },
    };
    const target = recorder((() => child) as RecorderSpawn) as unknown as {
      start(input: ReturnType<typeof command>): Promise<{ waitForCompletion(): Promise<unknown> }>;
    };

    const run = await target.start(command());
    expect(waitForExitCalls).toBe(1);
    resolveExit({ code: 0, signal: null });
    await expect(run.waitForCompletion()).resolves.toEqual({ kind: "exited", exitCode: 0 });
    expect(waitForExitCalls).toBe(1);
  });

  it("keeps an unsolicited signal when its exit was observed before a late abort", async () => {
    const cancellation = cancellationSignal();
    let resolveExit!: (result: { readonly code: number | null; readonly signal: string | null }) => void;
    const child = {
      pid: 4242,
      kills: [] as string[],
      kill(signal: string) { this.kills.push(signal); },
      waitForExit() { return new Promise<{ readonly code: number | null; readonly signal: string | null }>((resolve) => { resolveExit = resolve; }); },
    } as RecorderProcess & { readonly kills: string[] };
    const target = recorder((() => child) as RecorderSpawn) as unknown as {
      start(input: ReturnType<typeof command>): Promise<{ waitForCompletion(): Promise<unknown> }>;
    };

    const run = await target.start(command(cancellation.signal));
    resolveExit({ code: null, signal: "SIGTERM" });
    await settle();
    cancellation.abort();

    await expect(run.waitForCompletion()).resolves.toEqual({ kind: "signalled" });
    expect(child.kills).toEqual([]);
  });

  it("fails closed when a safe-PID exit observer rejects without cancellation", async () => {
    const cancellation = cancellationSignal();
    let waitForExitCalls = 0;
    const child: RecorderProcess & { readonly kills: string[] } = {
      pid: 4242,
      kills: [],
      kill(signal) { this.kills.push(signal); },
      waitForExit() {
        waitForExitCalls += 1;
        return Promise.reject(new Error("observer failed"));
      },
    };

    await expect(recorder((() => child) as RecorderSpawn).record(command(cancellation.signal))).resolves.toEqual({ kind: "process-still-active" });
    expect(waitForExitCalls).toBe(1);
    expect(child.kills).toEqual([]);
    expect(cancellation.removals).toBe(1);
  });

  it("contains a safe-PID child after cancellation when its exit observer rejects", async () => {
    const cancellation = cancellationSignal();
    const delays = controlledDelays();
    let rejectExit!: (reason?: unknown) => void;
    let waitForExitCalls = 0;
    const exit = new Promise<{ readonly code: number | null; readonly signal: string | null }>((_resolve, reject) => { rejectExit = reject; });
    const child: RecorderProcess & { readonly kills: string[] } = {
      pid: 4242,
      kills: [],
      kill(signal) { this.kills.push(signal); },
      waitForExit() { waitForExitCalls += 1; return exit; },
    };
    const target = new PlaywrightRecorder({
      projectRoot: "/private/pharos/store/project",
      resolveCli: async () => "/private/node_modules/playwright/cli.js",
      spawn: (() => child) as RecorderSpawn,
      cancellationGraceMs: 50,
      delay: delays.delay,
    });

    const recording = target.record(command(cancellation.signal));
    await settle();
    cancellation.abort();
    rejectExit(new Error("observer failed"));
    await settle();
    expect(child.kills).toEqual(["SIGINT"]);

    for (let index = 0; index < 3; index += 1) {
      delays.releaseNext();
      await settle();
    }

    await expect(recording).resolves.toEqual({ kind: "process-still-active" });
    expect(waitForExitCalls).toBe(1);
    expect(child.kills).toEqual(["SIGINT", "SIGTERM", "SIGKILL"]);
    expect(delays.disposed).toEqual([true, true, true]);
    expect(cancellation.removals).toBe(1);
  });

  it("keeps an exit resolved before abort in the same turn as an external signal", async () => {
    const cancellation = cancellationSignal();
    let resolveExit!: (result: { readonly code: number | null; readonly signal: string | null }) => void;
    const child = {
      pid: 4242,
      kills: [] as string[],
      kill(signal: string) { this.kills.push(signal); },
      waitForExit() { return new Promise<{ readonly code: number | null; readonly signal: string | null }>((resolve) => { resolveExit = resolve; }); },
    } as RecorderProcess & { readonly kills: string[] };
    const target = recorder((() => child) as RecorderSpawn);

    const recording = target.record(command(cancellation.signal));
    await settle();
    resolveExit({ code: null, signal: "SIGTERM" });
    cancellation.abort();

    await expect(recording).resolves.toEqual({ kind: "signalled" });
    expect(child.kills).toEqual([]);
  });

  it("keeps an abort before exit resolution in the same turn as operator cancellation", async () => {
    const cancellation = cancellationSignal();
    let resolveExit!: (result: { readonly code: number | null; readonly signal: string | null }) => void;
    const child = {
      pid: 4242,
      kills: [] as string[],
      kill(signal: string) { this.kills.push(signal); },
      waitForExit() { return new Promise<{ readonly code: number | null; readonly signal: string | null }>((resolve) => { resolveExit = resolve; }); },
    } as RecorderProcess & { readonly kills: string[] };
    const target = recorder((() => child) as RecorderSpawn);

    const recording = target.record(command(cancellation.signal));
    await settle();
    cancellation.abort();
    resolveExit({ code: 0, signal: null });

    await expect(recording).resolves.toEqual({ kind: "operator-cancelled" });
    expect(child.kills).toEqual(["SIGINT"]);
  });

  it("contains an invalid-PID child by consuming its rejecting exit and bounded owned-child shutdown", async () => {
    const cancellation = cancellationSignal();
    const delays = controlledDelays();
    let waitForExitCalls = 0;
    const child: RecorderProcess & { readonly kills: string[] } = {
      pid: undefined,
      kills: [],
      kill(signal) { this.kills.push(signal); },
      waitForExit() {
        waitForExitCalls += 1;
        return Promise.reject(new Error("child launch failed"));
      },
    };
    const target = new PlaywrightRecorder({
      projectRoot: "/private/pharos/store/project",
      resolveCli: async () => "/private/node_modules/playwright/cli.js",
      spawn: (() => child) as RecorderSpawn,
      cancellationGraceMs: 50,
      delay: delays.delay,
    }) as unknown as {
      start(input: ReturnType<typeof command>): Promise<{ readonly evidence: unknown; waitForCompletion(): Promise<unknown> }>;
    };

    const run = await target.start(command(cancellation.signal));
    expect(run.evidence).toBeUndefined();
    await settle();
    expect(child.kills).toEqual(["SIGINT"]);
    delays.releaseNext();
    await settle();
    delays.releaseNext();
    await settle();
    delays.releaseNext();
    await expect(run.waitForCompletion()).resolves.toEqual({ kind: "unpersisted-process" });
    expect(waitForExitCalls).toBe(1);
    expect(delays.disposed).toEqual([true, true, true]);
    expect(cancellation.removals).toBe(1);
  });
});
