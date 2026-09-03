import { basename, dirname, join } from "node:path";
import { link, open, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";

export type WriteStage =
  | "tmp-written"
  | "tmp-fsynced"
  | "materialized"
  | "dir-fsynced";

export interface WriteObserver {
  onStage(stage: WriteStage, path: string): void | Promise<void>;
}

export interface AtomicWriter {
  writeAtomic(path: string, bytes: string): Promise<void>;
  createExclusive(path: string, bytes: string): Promise<"created" | "exists">;
  // Absent path is a no-op, never an error — D1b and D1c replay through this,
  // so idempotent convergence depends on it. Fsyncs the parent directory after
  // an actual unlink; skips the fsync when nothing was removed.
  removeAtomic(path: string): Promise<void>;
  readonly leakedTempPolicy: "sweep-on-recover";
}

const noopObserver: WriteObserver = {
  onStage: () => undefined,
};

function isErrnoException(
  error: unknown,
): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function tempSiblingOf(path: string): string {
  return join(dirname(path), `${basename(path)}.tmp.${randomUUID()}`);
}

export class FsAtomicWriter implements AtomicWriter {
  readonly leakedTempPolicy = "sweep-on-recover" as const;
  private readonly observer: WriteObserver;

  constructor(options?: { observer?: WriteObserver }) {
    this.observer = options?.observer ?? noopObserver;
  }

  async writeAtomic(path: string, bytes: string): Promise<void> {
    const tmpPath = tempSiblingOf(path);

    await this.writeAndFsyncTemp(tmpPath, bytes);
    await rename(tmpPath, path);
    await this.notify("materialized", path);
    await this.fsyncDir(dirname(path));
    await this.notify("dir-fsynced", path);
  }

  async createExclusive(
    path: string,
    bytes: string,
  ): Promise<"created" | "exists"> {
    const tmpPath = tempSiblingOf(path);

    await this.writeAndFsyncTemp(tmpPath, bytes);

    try {
      // `link` — not `rename` — is what makes this exclusive-create:
      // `rename` always replaces its destination on POSIX and Node exposes
      // no `RENAME_NOREPLACE`; `link` fails EEXIST when the destination
      // already exists, leaving the original bytes untouched (D5, C1).
      // The temp's own `wx` open (in `writeAndFsyncTemp`) is decorative —
      // all exclusivity lives in `link`, which is atomic and TOCTOU-proof.
      // `link` is unsupported on FAT and some network mounts; on such a
      // filesystem this throws an environment error that surfaces mid-
      // lifecycle at the first `approveDraft`/`abandonDraft` call, not at
      // `FsAtomicWriter` construction, because `beacon.json`/`draft.json`
      // (written via `writeAtomic`) succeed first.
      await link(tmpPath, path);
    } catch (error) {
      if (isErrnoException(error) && error.code === "EEXIST") {
        await unlink(tmpPath);
        return "exists";
      }
      throw error;
    }

    await this.notify("materialized", path);
    await unlink(tmpPath);
    await this.fsyncDir(dirname(path));
    await this.notify("dir-fsynced", path);
    return "created";
  }

  async removeAtomic(path: string): Promise<void> {
    try {
      await unlink(path);
    } catch (error) {
      if (isErrnoException(error) && error.code === "ENOENT") {
        return;
      }
      throw error;
    }
    await this.fsyncDir(dirname(path));
  }

  private async writeAndFsyncTemp(tmpPath: string, bytes: string): Promise<void> {
    const fh = await open(tmpPath, "wx");
    try {
      await fh.writeFile(bytes, "utf8");
      await this.notify("tmp-written", tmpPath);
      await fh.sync();
      await this.notify("tmp-fsynced", tmpPath);
    } finally {
      await fh.close();
    }
  }

  private async fsyncDir(dir: string): Promise<void> {
    const dh = await open(dir, "r");
    try {
      await dh.sync();
    } finally {
      await dh.close();
    }
  }

  private async notify(stage: WriteStage, path: string): Promise<void> {
    await this.observer.onStage(stage, path);
  }
}
