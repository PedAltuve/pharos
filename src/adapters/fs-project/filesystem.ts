import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, realpath, rename, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export type FilesystemOperation = "lstat" | "mkdir" | "chmod" | "realpath" | "rename" | "fsync";

export interface FsProjectObserver {
  onOperation(operation: FilesystemOperation): void | Promise<void>;
}

const noopObserver: FsProjectObserver = { onOperation: () => undefined };

async function observe(observer: FsProjectObserver | undefined, operation: FilesystemOperation): Promise<void> {
  await (observer ?? noopObserver).onOperation(operation);
}

export function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

export async function ensurePrivateDirectory(path: string, observer?: FsProjectObserver): Promise<void> {
  try {
    await observe(observer, "lstat");
    const entry = await lstat(path);
    if (entry.isSymbolicLink()) throw new Error(`Refusing symlinked private directory: ${path}`);
    if (!entry.isDirectory()) throw new Error(`Private directory is not a directory: ${path}`);
  } catch (error) {
    if (!isErrno(error, "ENOENT")) throw error;
    await observe(observer, "mkdir");
    await mkdir(path, { recursive: true, mode: 0o700 });
    await observe(observer, "lstat");
    const entry = await lstat(path);
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      throw new Error(`Private directory changed while creating: ${path}`, { cause: error });
    }
  }
  await observe(observer, "chmod");
  const handle = await open(path, "r");
  try {
    await handle.chmod(0o700);
  } finally {
    await handle.close();
  }
}

export async function canonicalDirectory(path: string, observer?: FsProjectObserver): Promise<string> {
  await observe(observer, "lstat");
  const entry = await lstat(path);
  if (entry.isSymbolicLink() || !entry.isDirectory()) {
    throw new Error(`Expected a non-symlink directory: ${path}`);
  }
  await observe(observer, "realpath");
  return realpath(path);
}

async function ensureRegularFile(path: string, observer?: FsProjectObserver): Promise<void> {
  await observe(observer, "lstat");
  const entry = await lstat(path);
  if (entry.isSymbolicLink() || !entry.isFile()) {
    throw new Error(`Refusing symlinked or non-regular private state file: ${path}`);
  }
}

async function fsyncDirectory(path: string, observer?: FsProjectObserver): Promise<void> {
  await observe(observer, "fsync");
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeTemp(path: string, bytes: string): Promise<string> {
  const temporary = join(dirname(path), `${basename(path)}.tmp.${randomUUID()}`);
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(bytes, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  return temporary;
}

export async function writePrivateJson(path: string, value: unknown, observer?: FsProjectObserver): Promise<void> {
  const temporary = await writeTemp(path, JSON.stringify(value));
  await observe(observer, "rename");
  await rename(temporary, path);
  await fsyncDirectory(dirname(path), observer);
}

export async function createPrivateJson(path: string, value: unknown, observer?: FsProjectObserver): Promise<"created" | "exists"> {
  const temporary = await writeTemp(path, JSON.stringify(value));
  try {
    await link(temporary, path);
  } catch (error) {
    if (isErrno(error, "EEXIST")) {
      await unlink(temporary);
      await ensureRegularFile(path, observer);
      return "exists";
    }
    throw error;
  }
  await unlink(temporary);
  await fsyncDirectory(dirname(path), observer);
  return "created";
}

/** Read state only through a no-follow descriptor after validating its type. */
export async function readJson(path: string, observer?: FsProjectObserver): Promise<unknown> {
  await ensureRegularFile(path, observer);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const entry = await handle.stat();
    if (!entry.isFile()) throw new Error(`Refusing symlinked or non-regular private state file: ${path}`);
    return JSON.parse(await handle.readFile({ encoding: "utf8" })) as unknown;
  } finally {
    await handle.close();
  }
}
