import { mkdtemp, readdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const transientReadFailure = vi.hoisted(() => ({
  enabled: false,
  lockPath: "",
  arm(lockPath: string): void {
    this.enabled = true;
    this.lockPath = lockPath;
  },
}));

const directoryOpenGate = vi.hoisted(() => {
  let notifyOpened!: () => void;
  let continueRelease!: () => void;
  return {
    enabled: false,
    projectDir: "",
    opened: Promise.resolve(),
    wait: Promise.resolve(),
    arm(projectDir: string): void {
      this.enabled = true;
      this.projectDir = projectDir;
      this.opened = new Promise<void>((resolve) => {
        notifyOpened = resolve;
      });
      this.wait = new Promise<void>((resolve) => {
        continueRelease = resolve;
      });
      this.notifyOpened = () => {
        notifyOpened();
      };
      this.continueRelease = () => {
        continueRelease();
      };
    },
    notifyOpened(): void {},
    continueRelease(): void {},
  };
});

vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...fs,
    readFile: async (...args: Parameters<typeof fs.readFile>) => {
      if (
        transientReadFailure.enabled
        && args[0] === transientReadFailure.lockPath
      ) {
        transientReadFailure.enabled = false;
        throw new Error("transient lock read failure");
      }
      return fs.readFile(...args);
    },
    open: async (...args: Parameters<typeof fs.open>) => {
      if (
        directoryOpenGate.enabled
        && args[0] === directoryOpenGate.projectDir
        && args[1] === "r"
      ) {
        directoryOpenGate.enabled = false;
        directoryOpenGate.notifyOpened();
        await directoryOpenGate.wait;
      }
      return fs.open(...args);
    },
  };
});

import { ProjectLock } from "../../../src/adapters/fs-beacon-store/lock.js";
import type { LockUnavailable } from "../../../src/domain/ports/beacon-store-refusals.js";

let projectDir: string;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "pharos-lock-"));
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe("ProjectLock acquisition", () => {
  it("creates the lock directly and leaves no temp sibling", async () => {
    const lock = new ProjectLock(projectDir);

    const result = await lock.acquire();

    expect(result.ok).toBe(true);
    const holder = JSON.parse(await readFile(join(projectDir, "lock"), "utf8")) as {
      pid: number;
      hostname: string;
      nonce: string;
    };
    expect(holder.pid).toBe(process.pid);
    expect(holder.hostname).toBeTruthy();
    expect(holder.nonce).toEqual(expect.any(String));
    expect((await readdir(projectDir)).filter((entry) => entry.includes(".tmp.")).sort()).toEqual([]);
    await rm(join(projectDir, "lock"));
  });

  it("does not break a lock held by the current live process", async () => {
    const lockPath = join(projectDir, "lock");
    const original = JSON.stringify({
      pid: process.pid,
      hostname: hostname(),
      nonce: "foreign-nonce",
    });
    await writeFile(lockPath, original);

    const result = await new ProjectLock(projectDir, {
      waitMs: 35,
      staleAfterMs: 10,
      pollMs: 5,
    }).acquire();

    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: LockUnavailable }).error.rule).toBe(
      "lock-unavailable",
    );
    expect(await readFile(lockPath, "utf8")).toBe(original);
  });

  it("breaks a confirmed-dead same-host lock immediately", async () => {
    const lockPath = join(projectDir, "lock");
    await writeFile(
      lockPath,
      JSON.stringify({
        pid: 999_999_999,
        hostname: hostname(),
        nonce: "dead-nonce",
      }),
    );
    const lock = new ProjectLock(projectDir);

    const result = await Promise.race([
      lock.acquire(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("dead lock was not broken immediately")), 250),
      ),
    ]);

    expect(result.ok).toBe(true);
    await rm(lockPath);
  });

  it.each([
    ["zero-byte", ""],
    ["unparseable", "not-json"],
  ])("uses the age gate for a fresh %s lock", async (_label, bytes) => {
    const lockPath = join(projectDir, "lock");
    await writeFile(lockPath, bytes);
    const fresh = new Date(Date.now() + 1_000);
    await utimes(lockPath, fresh, fresh);

    const result = await new ProjectLock(projectDir, {
      waitMs: 45,
      staleAfterMs: 20,
      pollMs: 5,
    }).acquire();

    expect(result.ok).toBe(false);
    expect(await readFile(lockPath, "utf8")).toBe(bytes);
    expect((await readdir(projectDir)).filter((entry) => entry.includes("probe.tmp.")).sort()).toEqual([]);
  });

  it("rejects invalid staleAfterMs configuration", () => {
    expect(
      () => new ProjectLock(projectDir, { waitMs: 10, staleAfterMs: 10 }),
    ).toThrow(/staleAfterMs must be less than waitMs/);
  });

  it("breaks an aged unidentifiable lock and a positive-pid lock without a hostname", async () => {
    const lockPath = join(projectDir, "lock");
    await writeFile(lockPath, "");
    const old = new Date(Date.now() - 100);
    await utimes(lockPath, old, old);

    const options = { waitMs: 100, staleAfterMs: 20, pollMs: 5 };
    const first = await new ProjectLock(projectDir, options).acquire();
    expect(first.ok).toBe(true);
    await rm(lockPath);

    await writeFile(lockPath, JSON.stringify({ pid: 999_999_999, nonce: "no-host" }));
    await utimes(lockPath, old, old);
    const second = await new ProjectLock(projectDir, options).acquire();
    expect(second.ok).toBe(true);
    expect((await readdir(projectDir)).filter((entry) => entry.includes("probe.tmp.")).sort()).toEqual([]);
    await rm(lockPath);
  });

  it("waits with bounded backoff before refusing an unbreakable remote lock", async () => {
    const lockPath = join(projectDir, "lock");
    await writeFile(
      lockPath,
      JSON.stringify({
        pid: process.pid,
        hostname: "remote-host",
        nonce: "remote-nonce",
      }),
    );
    const result = await new ProjectLock(projectDir, {
      waitMs: 60,
      staleAfterMs: 20,
      pollMs: 10,
    }).acquire();

    expect(result).toEqual({
      ok: false,
      error: {
        rule: "lock-unavailable",
        holderPid: process.pid,
        waitedMs: expect.any(Number),
      },
    });
    if (!result.ok) {
      expect(result.error.waitedMs).toBeGreaterThanOrEqual(50);
      expect(result.error.waitedMs).toBeLessThanOrEqual(1_000);
    }
    expect(await readFile(lockPath, "utf8")).toContain("remote-nonce");
  });
});

describe("ProjectLock release", () => {
  it("removes the caller's lock and leaves no probe file", async () => {
    const lock = new ProjectLock(projectDir);
    const acquired = await lock.acquire();
    expect(acquired.ok).toBe(true);

    if (!acquired.ok) throw new Error("lock was not acquired");
    await acquired.value.release();

    await expect(readFile(join(projectDir, "lock"), "utf8")).rejects.toThrow(/ENOENT/);
    expect((await readdir(projectDir)).filter((entry) => entry.includes("probe.tmp.")).sort()).toEqual([]);
  });

  it("throws when the lock nonce no longer belongs to the caller", async () => {
    const lockPath = join(projectDir, "lock");
    const lock = new ProjectLock(projectDir);
    const acquired = await lock.acquire();
    expect(acquired.ok).toBe(true);
    await writeFile(
      lockPath,
      JSON.stringify({
        pid: process.pid,
        hostname: hostname(),
        nonce: "foreign-nonce",
      }),
    );

    if (!acquired.ok) throw new Error("lock was not acquired");
    await expect(acquired.value.release()).rejects.toThrow(/nonce/);
    expect(await readFile(lockPath, "utf8")).toContain("foreign-nonce");
  });

  it("keeps a lease active after a transient release failure", async () => {
    const lockPath = join(projectDir, "lock");
    const acquired = await new ProjectLock(projectDir).acquire();
    if (!acquired.ok) throw new Error("lock was not acquired");

    transientReadFailure.arm(lockPath);
    await expect(acquired.value.release()).rejects.toThrow(/transient lock read failure/);
    await acquired.value.release();

    await expect(readFile(lockPath, "utf8")).rejects.toThrow(/ENOENT/);
  });

  it("keeps an overlapping lease's ownership intact until that lease releases", async () => {
    const lock = new ProjectLock(projectDir);
    const first = await lock.acquire();
    if (!first.ok) throw new Error("first lock was not acquired");

    directoryOpenGate.arm(projectDir);
    const releasingFirst = first.value.release();
    await directoryOpenGate.opened;
    await expect(first.value.release()).rejects.toThrow(/already being released/);

    const second = await lock.acquire();
    if (!second.ok) throw new Error("second lock was not acquired");

    directoryOpenGate.continueRelease();
    await releasingFirst;
    const secondHolder = await readFile(join(projectDir, "lock"), "utf8");
    await expect(first.value.release()).rejects.toThrow(/already been released/);
    expect(await readFile(join(projectDir, "lock"), "utf8")).toBe(secondHolder);
    await second.value.release();

    await expect(readFile(join(projectDir, "lock"), "utf8")).rejects.toThrow(/ENOENT/);
  });
});
