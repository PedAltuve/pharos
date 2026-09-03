import { mkdtemp, readdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

    await lock.release();

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

    await expect(lock.release()).rejects.toThrow(/nonce/);
    expect(await readFile(lockPath, "utf8")).toContain("foreign-nonce");
  });
});
