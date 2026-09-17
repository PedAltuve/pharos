import { randomUUID } from "node:crypto";
import { open, readFile, stat, unlink } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { err, ok, type Result } from "../../shared/result.js";
import type { LockUnavailable } from "../../domain/ports/beacon-store-refusals.js";

interface LockHolder {
  readonly pid: number;
  readonly hostname: string;
  readonly nonce: string;
}

interface ParsedHolder {
  readonly pid: number | null;
  readonly hostname?: string;
  readonly nonce?: string;
}

export interface ProjectLockOptions {
  readonly waitMs?: number;
  readonly staleAfterMs?: number;
  readonly pollMs?: number;
}

export interface ProjectLease {
  release(): Promise<void>;
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function parseHolder(bytes: string): ParsedHolder {
  try {
    const value: unknown = JSON.parse(bytes);
    if (typeof value !== "object" || value === null) {
      return { pid: null };
    }
    const record = value as Record<string, unknown>;
    const pid = record.pid;
    return {
      pid: typeof pid === "number" && Number.isInteger(pid) && pid > 0
        ? pid
        : null,
      ...(typeof record.hostname === "string"
        ? { hostname: record.hostname }
        : {}),
      ...(typeof record.nonce === "string" ? { nonce: record.nonce } : {}),
    };
  } catch {
    return { pid: null };
  }
}

export class ProjectLock {
  readonly waitMs: number;
  readonly staleAfterMs: number;
  readonly pollMs: number;
  private readonly lockPath: string;

  constructor(projectRoot: string, options: ProjectLockOptions = {}) {
    this.waitMs = options.waitMs ?? 5_000;
    this.staleAfterMs = options.staleAfterMs ?? 2_000;
    this.pollMs = options.pollMs ?? 25;
    if (this.staleAfterMs >= this.waitMs) {
      throw new Error("staleAfterMs must be less than waitMs");
    }
    this.lockPath = join(projectRoot, "lock");
  }

  async acquire(): Promise<Result<ProjectLease, LockUnavailable>> {
    const startedAt = Date.now();
    let backoffMs = Math.max(1, this.pollMs);
    while (true) {
      try {
        return ok(this.lease(await this.createHolder()));
      } catch (error) {
        if (!isErrnoException(error) || error.code !== "EEXIST") {
          throw error;
        }
      }

      const holder = await this.readHolder();
      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs >= this.waitMs) {
        return err({
          rule: "lock-unavailable",
          holderPid: holder.pid,
          waitedMs: elapsedMs,
        });
      }
      if (holder.pid !== null && holder.hostname !== undefined) {
        if (holder.hostname !== hostname()) {
          const refusal = await this.waitUntilUnavailable(
            startedAt,
            holder.pid,
            backoffMs,
          );
          if (refusal) return refusal;
          backoffMs = Math.min(backoffMs * 2, 250);
          continue;
        }
        let holderIsAlive: boolean;
        try {
          process.kill(holder.pid, 0);
          holderIsAlive = true;
        } catch (error) {
          holderIsAlive = !(isErrnoException(error) && error.code === "ESRCH");
        }
        if (!holderIsAlive) {
          await this.breakLock();
          continue;
        }
        const refusal = await this.waitUntilUnavailable(
          startedAt,
          holder.pid,
          backoffMs,
        );
        if (refusal) return refusal;
        backoffMs = Math.min(backoffMs * 2, 250);
        continue;
      }

      if (await this.isStale()) {
        await this.breakLock();
        continue;
      }
      const refusal = await this.waitUntilUnavailable(
        startedAt,
        holder.pid,
        backoffMs,
      );
      if (refusal) return refusal;
      backoffMs = Math.min(backoffMs * 2, 250);
    }
  }

  private lease(nonce: string): ProjectLease {
    let state: "active" | "releasing" | "released" = "active";
    return {
      release: async (): Promise<void> => {
        if (state === "releasing") {
          throw new Error("lock lease is already being released");
        }
        if (state === "released") {
          throw new Error("lock lease has already been released");
        }
        state = "releasing";
        try {
          const holder = await this.readHolder();
          if (holder.nonce !== nonce) {
            throw new Error("lock nonce no longer belongs to the caller");
          }
          await this.breakLock();
          state = "released";
        } catch (error) {
          state = "active";
          throw error;
        }
      },
    };
  }

  private async createHolder(): Promise<string> {
    const handle = await open(this.lockPath, "wx");
    const holder: LockHolder = {
      pid: process.pid,
      hostname: hostname(),
      nonce: randomUUID(),
    };
    try {
      await handle.writeFile(JSON.stringify(holder), "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    return holder.nonce;
  }

  private async readHolder(): Promise<ParsedHolder> {
    try {
      return parseHolder(await readFile(this.lockPath, "utf8"));
    } catch (error) {
      if (isErrnoException(error) && error.code === "ENOENT") {
        return { pid: null };
      }
      throw error;
    }
  }

  private async isStale(): Promise<boolean> {
    const probePath = join(
      dirname(this.lockPath),
      `probe.tmp.${randomUUID()}`,
    );
    const probe = await open(probePath, "wx");
    await probe.close();

    let stale = false;
    let failure: unknown;
    try {
      const [lockStats, probeStats] = await Promise.all([
        stat(this.lockPath),
        stat(probePath),
      ]);
      stale = lockStats.mtimeMs + this.staleAfterMs <= probeStats.mtimeMs;
    } catch (error) {
      if (!(isErrnoException(error) && error.code === "ENOENT")) {
        failure = error;
      }
    }

    try {
      await unlink(probePath);
    } catch (error) {
      if (!(isErrnoException(error) && error.code === "ENOENT")) {
        failure ??= error;
      }
    }
    if (failure) {
      throw failure;
    }
    return stale;
  }

  private async breakLock(): Promise<void> {
    try {
      await unlink(this.lockPath);
    } catch (error) {
      if (isErrnoException(error) && error.code === "ENOENT") {
        return;
      }
      throw error;
    }
    const directory = await open(dirname(this.lockPath), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }

  private async waitUntilUnavailable(
    startedAt: number,
    holderPid: number | null,
    backoffMs: number,
  ): Promise<Result<never, LockUnavailable> | undefined> {
    const waitedMs = Date.now() - startedAt;
    if (waitedMs >= this.waitMs) {
      return err({ rule: "lock-unavailable", holderPid, waitedMs });
    }
    const jitterMs = Math.floor(Math.random() * Math.min(backoffMs, 10));
    const delayMs = Math.min(
      this.waitMs - waitedMs,
      backoffMs + jitterMs,
    );
    await new Promise<void>((resolve) => {
      setTimeout(resolve, delayMs);
    });
    if (Date.now() - startedAt >= this.waitMs) {
      return err({
        rule: "lock-unavailable",
        holderPid,
        waitedMs: Date.now() - startedAt,
      });
    }
  }
}
