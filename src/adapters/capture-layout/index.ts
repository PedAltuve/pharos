import { createHash } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { lstat, open, type FileHandle } from "node:fs/promises";
import { resolve } from "node:path";
import type { CaptureId } from "../../domain/capture/index.js";

const RECORDING = "recording.spec.ts";

type FileIdentity = Pick<Stats, "dev" | "ino">;

export interface RegularFileContents {
  readonly bytes: Buffer;
  readonly byteSize: number;
  readonly sha256: string;
}

export interface HandleBoundRegularFile {
  readContents(): Promise<RegularFileContents | null>;
  matchesPath(): Promise<boolean>;
}

export function captureStageDirectory(projectRoot: string, captureId: CaptureId): string {
  return resolve(projectRoot, "capture-staging", captureId);
}

export function stagedRecordingPath(projectRoot: string, captureId: CaptureId): string {
  return resolve(captureStageDirectory(projectRoot, captureId), RECORDING);
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function isStable(before: Stats, after: Stats): boolean {
  return sameIdentity(before, after)
    && before.size === after.size
    && before.mtimeMs === after.mtimeMs;
}

async function matchesPath(path: string, identity: FileIdentity): Promise<boolean> {
  try {
    const current = await lstat(path);
    return current.isFile() && !current.isSymbolicLink() && sameIdentity(current, identity);
  } catch {
    return false;
  }
}

function handleBoundFile(path: string, handle: FileHandle, opened: Stats): HandleBoundRegularFile {
  return {
    async readContents(): Promise<RegularFileContents | null> {
      try {
        const before = await handle.stat();
        if (!isStable(opened, before)) return null;
        const bytes = await handle.readFile();
        const after = await handle.stat();
        if (!isStable(opened, after) || !await matchesPath(path, opened)) return null;
        return {
          bytes,
          byteSize: bytes.byteLength,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        };
      } catch {
        return null;
      }
    },
    async matchesPath(): Promise<boolean> {
      return await matchesPath(path, opened);
    },
  };
}

/** Opens a private regular file once and keeps its validated handle open for the caller's operation. */
export async function withHandleBoundRegularFile<T>(
  path: string,
  operation: (file: HandleBoundRegularFile) => Promise<T>,
): Promise<T | null> {
  let handle: FileHandle;
  let opened: Stats;
  try {
    const before = await lstat(path);
    if (!before.isFile() || before.isSymbolicLink()) return null;
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    opened = await handle.stat();
    if (!opened.isFile() || !sameIdentity(before, opened)) {
      await handle.close();
      return null;
    }
  } catch {
    return null;
  }

  try {
    return await operation(handleBoundFile(path, handle, opened));
  } finally {
    await handle.close();
  }
}
