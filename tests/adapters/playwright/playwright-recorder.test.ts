import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ProcessIdentityAdapter } from "../../../src/adapters/playwright/process-identity.js";
import {
  PlaywrightRecorder,
  type RecorderProcess,
  type RecorderSpawn,
} from "../../../src/adapters/playwright/playwright-recorder.js";

const projectId = "proj_018f47de-7a00-7cc0-8000-000000000001" as const;
const captureId = "cap_018f47de-7a00-7cc0-8000-000000000001" as const;
const url = "http://localhost:3000/";
const recorderIdentity = "a".repeat(64);
const testIdentity = {
  async observe() { return { kind: "present" as const, identity: recorderIdentity }; },
  async probe(evidence: { readonly identity: string }) { return evidence.identity === recorderIdentity ? "same" as const : "reused" as const; },
};

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
    identity: testIdentity,
    resolveCli: async () => "/private/node_modules/playwright/cli.js",
    spawn,
  });
}

function command(signal = passiveSignal()) {
  return { projectId, captureId, url, terminalMode: "human" as const, signal, onStarted: async () => {} };
}

describe("PlaywrightRecorder", () => {
  it("probes Linux process identity with final-parenthesis stat parsing and preserves absent, reused, and unknown", async () => {
    const fingerprint = createHash("sha256").update("linux\nabcdef01-2345-6789-abcd-ef0123456789\n987").digest("hex");
    const same = new ProcessIdentityAdapter({
      platform: "linux",
      readFile: async (path) => path.endsWith("boot_id") ? "abcdef01-2345-6789-abcd-ef0123456789\n" : `42 (web worker) S ${new Array(18).fill("0").join(" ")} 987`,
      execFile: async () => ({ stdout: "" }),
    });
    await expect(same.probe({ pid: 42, identity: fingerprint })).resolves.toBe("same");
    await expect(same.probe({ pid: 42, identity: "a".repeat(64) })).resolves.toBe("reused");
    const absent = new ProcessIdentityAdapter({
      platform: "linux",
      readFile: async (path) => {
        if (path.endsWith("boot_id")) return "abcdef01-2345-6789-abcd-ef0123456789\n";
        throw Object.assign(new Error("gone"), { code: "ENOENT" });
      },
      execFile: async () => ({ stdout: "" }),
    });
    await expect(absent.probe({ pid: 42, identity: fingerprint })).resolves.toBe("absent");
    const absentWithoutBootId = new ProcessIdentityAdapter({
      platform: "linux",
      readFile: async (path) => {
        if (path.endsWith("boot_id")) throw new Error("boot identity unavailable");
        throw Object.assign(new Error("gone"), { code: "ENOENT" });
      },
      execFile: async () => ({ stdout: "" }),
    });
    await expect(absentWithoutBootId.probe({ pid: 42, identity: fingerprint })).resolves.toBe("absent");
    const unknown = new ProcessIdentityAdapter({
      platform: "linux",
      readFile: async () => "malformed stat",
      execFile: async () => ({ stdout: "" }),
    });
    await expect(unknown.probe({ pid: 42, identity: fingerprint })).resolves.toBe("unknown");
  });

  it("probes macOS ownership markers through injected unlimited-width ps output", async () => {
    const token = "c".repeat(64);
    const fingerprint = createHash("sha256").update(`darwin-token\n${token}`).digest("hex");
    const calls: unknown[][] = [];
    const adapter = new ProcessIdentityAdapter({
      platform: "darwin",
      readFile: async () => "",
      execFile: async (...args) => {
        calls.push(args);
        return { stdout: `playwright codegen PHAROS_RECORDER_OWNERSHIP=${token}\n` };
      },
    });
    await expect(adapter.probe({ pid: 42, identity: fingerprint })).resolves.toBe("same");
    await expect(adapter.probe({ pid: 42, identity: "a".repeat(64) })).resolves.toBe("reused");
    expect(calls[0]).toEqual(["/bin/ps", ["eww", "-p", "42", "-o", "command="], { env: { LC_ALL: "C" } }]);
    const noMarker = new ProcessIdentityAdapter({
      platform: "darwin",
      readFile: async () => "",
      execFile: async () => ({ stdout: "playwright codegen Mon Jan  2 03:04:05 2023\n" }),
    });
    await expect(noMarker.probe({ pid: 42, identity: fingerprint })).resolves.toBe("unknown");
    const malformedMarker = new ProcessIdentityAdapter({
      platform: "darwin",
      readFile: async () => "",
      execFile: async () => ({ stdout: "playwright PHAROS_RECORDER_OWNERSHIP=invalid\n" }),
    });
    await expect(malformedMarker.probe({ pid: 42, identity: fingerprint })).resolves.toBe("unknown");
    const absent = new ProcessIdentityAdapter({
      platform: "darwin",
      readFile: async () => "",
      execFile: async () => { throw Object.assign(new Error("missing process"), { code: 1, stdout: "", stderr: "" }); },
    });
    await expect(absent.probe({ pid: 42, identity: fingerprint })).resolves.toBe("absent");
  });

  it("keeps an exit observed before internal containment in the same turn", async () => {
    let resolveIdentity!: (value: { readonly kind: "unknown" }) => void;
    let resolveExit!: (value: { readonly code: number | null; readonly signal: string | null }) => void;
    const child = {
      pid: 4242,
      kills: [] as string[],
      kill(signal: string) { this.kills.push(signal); },
      waitForExit: () => new Promise<{ readonly code: number | null; readonly signal: string | null }>((resolve) => { resolveExit = resolve; }),
    } as RecorderProcess & { readonly kills: string[] };
    const target = new PlaywrightRecorder({
      projectRoot: "/private/pharos/store/project",
      resolveCli: async () => "/private/node_modules/playwright/cli.js",
      spawn: (() => child) as RecorderSpawn,
      identity: {
        observe: () => new Promise((resolve) => { resolveIdentity = resolve; }),
        async probe() { return "unknown" as const; },
      },
    });
    const starting = target.start(command());
    await settle();
    resolveExit({ code: 0, signal: null });
    await settle();
    resolveIdentity({ kind: "unknown" });
    const run = await starting;
    await expect(run.waitForCompletion()).resolves.toEqual({ kind: "exited", exitCode: 0 });
    expect(child.kills).toEqual([]);
  });

  it("maps internal containment observed before exit in the same turn to prerequisite failure", async () => {
    let resolveIdentity!: (value: { readonly kind: "unknown" }) => void;
    let resolveExit!: (value: { readonly code: number | null; readonly signal: string | null }) => void;
    const child = {
      pid: 4242,
      kills: [] as string[],
      kill(signal: string) { this.kills.push(signal); },
      waitForExit: () => new Promise<{ readonly code: number | null; readonly signal: string | null }>((resolve) => { resolveExit = resolve; }),
    } as RecorderProcess & { readonly kills: string[] };
    const target = new PlaywrightRecorder({
      projectRoot: "/private/pharos/store/project",
      resolveCli: async () => "/private/node_modules/playwright/cli.js",
      spawn: (() => child) as RecorderSpawn,
      identity: {
        observe: () => new Promise((resolve) => { resolveIdentity = resolve; }),
        async probe() { return "unknown" as const; },
      },
    });
    const starting = target.start(command());
    await settle();
    resolveIdentity({ kind: "unknown" });
    await settle();
    resolveExit({ code: 0, signal: null });
    const run = await starting;
    await expect(run.waitForCompletion()).resolves.toEqual({ kind: "prerequisite-or-process-failure" });
    expect(child.kills).toEqual(["SIGINT"]);
  });

  it("contains a spawned child when identity observation rejects without losing observer ownership", async () => {
    const cancellation = cancellationSignal();
    let resolveExit!: (value: { readonly code: number | null; readonly signal: string | null }) => void;
    let waitForExitCalls = 0;
    const child: RecorderProcess & { readonly kills: string[] } = {
      pid: 4242,
      kills: [],
      kill(signal) { this.kills.push(signal); },
      waitForExit() {
        waitForExitCalls += 1;
        return new Promise((resolve) => { resolveExit = resolve; });
      },
    };
    const target = new PlaywrightRecorder({
      projectRoot: "/private/pharos/store/project",
      resolveCli: async () => "/private/node_modules/playwright/cli.js",
      spawn: (() => child) as RecorderSpawn,
      identity: {
        async observe() { throw new Error("identity unavailable"); },
        async probe() { return "unknown" as const; },
      },
    });

    const run = await target.start(command(cancellation.signal));
    await settle();
    expect(child.kills).toEqual(["SIGINT"]);
    expect(waitForExitCalls).toBe(1);
    expect(cancellation.removals).toBe(0);
    resolveExit({ code: null, signal: "SIGINT" });
    await expect(run.waitForCompletion()).resolves.toEqual({ kind: "prerequisite-or-process-failure" });
    expect(cancellation.removals).toBe(1);
  });

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
    ], {
      shell: false,
      stdio: "inherit",
      env: expect.objectContaining({ PHAROS_RECORDER_OWNERSHIP: expect.stringMatching(/^[a-f0-9]{64}$/) }),
    }]]);
    expect((calls[0]?.[1] as readonly string[]).join(" ")).not.toContain("install");
    expect((calls[0]?.[1] as readonly string[]).join(" ")).not.toContain("npx");
  });

  it("passes a deterministic ownership marker to spawn and persists only its fingerprint", async () => {
    const token = "d".repeat(64);
    const expectedIdentity = createHash("sha256").update(`darwin-token\n${token}`).digest("hex");
    const calls: unknown[][] = [];
    const target = new PlaywrightRecorder({
      projectRoot: "/private/pharos/store/project",
      resolveCli: async () => "/private/node_modules/playwright/cli.js",
      spawn: ((...args) => {
        calls.push(args);
        return fakeProcess({ code: 0, signal: null });
      }) as RecorderSpawn,
      ownershipToken: () => token,
      identity: new ProcessIdentityAdapter({
        platform: "darwin",
        readFile: async () => "",
        execFile: async () => ({ stdout: `playwright PHAROS_RECORDER_OWNERSHIP=${token}` }),
      }),
    });
    const run = await target.start(command());
    expect(calls[0]?.[2]).toEqual({
      shell: false,
      stdio: "inherit",
      env: expect.objectContaining({ PHAROS_RECORDER_OWNERSHIP: token }),
    });
    expect(run.evidence).toEqual({ pid: 4242, identity: expectedIdentity });
    expect(JSON.stringify(run.evidence)).not.toContain(token);
  });

  it("fails closed without spawning when ownership token generation is invalid", async () => {
    let spawnCalls = 0;
    const target = new PlaywrightRecorder({
      projectRoot: "/private/pharos/store/project",
      resolveCli: async () => "/private/node_modules/playwright/cli.js",
      spawn: (() => { spawnCalls += 1; return fakeProcess({ code: 0, signal: null }); }) as RecorderSpawn,
      ownershipToken: () => "invalid",
      identity: testIdentity,
    });
    await expect(target.record(command())).resolves.toEqual({ kind: "prerequisite-or-process-failure" });
    expect(spawnCalls).toBe(0);
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
    expect(jsonCalls[0]?.[2]).toEqual({
      shell: false,
      stdio: ["inherit", "ignore", "inherit"],
      env: expect.objectContaining({ PHAROS_RECORDER_OWNERSHIP: expect.stringMatching(/^[a-f0-9]{64}$/) }),
    });
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

  it("exposes spawned PID and fingerprint evidence with an attached exit observer", async () => {
    let waitForExitCalls = 0;
    const child = fakeProcess({ code: 0, signal: null });
    const target = new PlaywrightRecorder({
      projectRoot: "/private/pharos/store/project",
      resolveCli: async () => "/private/node_modules/playwright/cli.js",
      spawn: (() => ({ ...child, pid: 4242, async waitForExit() {
        waitForExitCalls += 1;
        return { code: 0, signal: null };
      } })) as RecorderSpawn,
      identity: testIdentity,
    });

    const run = await target.start(command());
    expect(run.evidence).toEqual({ pid: 4242, identity: recorderIdentity });
    expect(waitForExitCalls).toBe(1);
    await expect(run.waitForCompletion()).resolves.toEqual({ kind: "exited", exitCode: 0 });
    await expect(target.probeProcess({ pid: 4242, identity: recorderIdentity })).resolves.toBe("same");
    await expect(target.probeProcess({ pid: 4242, identity: "b".repeat(64) })).resolves.toBe("reused");
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

  it("does not wait an extra grace after SIGKILL when its exit observer rejects", async () => {
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
      identity: testIdentity,
      cancellationGraceMs: 50,
      delay: delays.delay,
    });

    const recording = target.record(command(cancellation.signal));
    await settle();
    cancellation.abort();
    rejectExit(new Error("observer failed"));
    await settle();
    expect(child.kills).toEqual(["SIGINT"]);

    for (let index = 0; index < 2; index += 1) {
      delays.releaseNext();
      await settle();
    }

    await expect(recording).resolves.toEqual({ kind: "process-still-active" });
    expect(waitForExitCalls).toBe(1);
    expect(child.kills).toEqual(["SIGINT", "SIGTERM", "SIGKILL"]);
    expect(delays.disposed).toEqual([true, true]);
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

  it("classifies an async spawn error without a PID as a prerequisite failure", async () => {
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
    await expect(run.waitForCompletion()).resolves.toEqual({ kind: "prerequisite-or-process-failure" });
    expect(child.kills).toEqual([]);
    expect(waitForExitCalls).toBe(1);
    expect(delays.disposed).toEqual([]);
    expect(cancellation.removals).toBe(1);
  });
});
