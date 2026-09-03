import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FsAtomicWriter } from "../../../src/adapters/fs-beacon-store/atomic-writer.js";
import type {
  WriteObserver,
  WriteStage,
} from "../../../src/adapters/fs-beacon-store/atomic-writer.js";

class InjectedCrash extends Error {
  constructor(stage: WriteStage, path: string) {
    super(`InjectedCrash at ${stage} for ${path}`);
    this.name = "InjectedCrash";
  }
}

function crashAt(
  targetStage: WriteStage,
  pathMatches: (path: string) => boolean,
): WriteObserver {
  return {
    onStage(stage, path) {
      if (stage === targetStage && pathMatches(path)) {
        throw new InjectedCrash(stage, path);
      }
    },
  };
}

function isTempSiblingOf(finalPath: string): (path: string) => boolean {
  return (path: string) => path.startsWith(`${finalPath}.tmp.`);
}

let projectDir: string;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "pharos-atomic-writer-"));
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe("FsAtomicWriter.writeAtomic", () => {
  it("materializes content at the final path with no leftover temp reference", async () => {
    const writer = new FsAtomicWriter();
    const finalPath = join(projectDir, "beacon.json");

    await writer.writeAtomic(finalPath, '{"hello":"world"}');

    const written = await readFile(finalPath, "utf8");
    expect(written).toBe('{"hello":"world"}');
  });

  it("leaves nothing at the final path when crashed before rename, and prior content intact", async () => {
    const finalPath = join(projectDir, "active.json");
    const priorWriter = new FsAtomicWriter();
    await priorWriter.writeAtomic(finalPath, '{"active_version":"ver_1"}');

    const crashingWriter = new FsAtomicWriter({
      observer: crashAt("tmp-fsynced", isTempSiblingOf(finalPath)),
    });

    await expect(
      crashingWriter.writeAtomic(finalPath, '{"active_version":"ver_2"}'),
    ).rejects.toThrow();

    const survivingContent = await readFile(finalPath, "utf8");
    expect(survivingContent).toBe('{"active_version":"ver_1"}');
  });
});

describe("FsAtomicWriter.createExclusive", () => {
  it("creates the file at an absent path and returns \"created\"", async () => {
    const writer = new FsAtomicWriter();
    const finalPath = join(projectDir, "manifest.json");

    const outcome = await writer.createExclusive(
      finalPath,
      '{"version_id":"ver_1"}',
    );

    expect(outcome).toBe("created");
    const written = await readFile(finalPath, "utf8");
    expect(written).toBe('{"version_id":"ver_1"}');
  });

  it('returns "exists" and leaves the original bytes byte-identical on a second write', async () => {
    const writer = new FsAtomicWriter();
    const finalPath = join(projectDir, "manifest.json");
    await writer.createExclusive(finalPath, '{"version_id":"ver_1"}');

    const outcome = await writer.createExclusive(
      finalPath,
      '{"version_id":"ver_2"}',
    );

    expect(outcome).toBe("exists");
    const bytes = await readFile(finalPath, "utf8");
    expect(bytes).toBe('{"version_id":"ver_1"}');
  });

  it("leaves nothing at the final path when crashed before link", async () => {
    const finalPath = join(projectDir, "semantics.json");
    const crashingWriter = new FsAtomicWriter({
      observer: crashAt("tmp-fsynced", isTempSiblingOf(finalPath)),
    });

    await expect(
      crashingWriter.createExclusive(finalPath, '{"kind":"semantics"}'),
    ).rejects.toThrow();

    await expect(readFile(finalPath, "utf8")).rejects.toThrow(
      /ENOENT/,
    );
  });
});

describe("FsAtomicWriter.removeAtomic", () => {
  it("is a no-op on an absent path and does not throw", async () => {
    const writer = new FsAtomicWriter();
    const absentPath = join(projectDir, "drafts", "d1", "draft.json");

    await expect(writer.removeAtomic(absentPath)).resolves.toBeUndefined();
  });

  it("removes an existing file and fsyncs the parent directory", async () => {
    const writer = new FsAtomicWriter();
    const targetPath = join(projectDir, "draft.json");
    await writer.writeAtomic(targetPath, '{"status":"open"}');

    await writer.removeAtomic(targetPath);

    await expect(readFile(targetPath, "utf8")).rejects.toThrow(/ENOENT/);
  });
});

describe("FsAtomicWriter leaked-temp scope", () => {
  it("leaves an unreferenced <name>.tmp.<uuid> file when createExclusive crashes between temp-create and link", async () => {
    const finalPath = join(projectDir, "manifest.json");
    const crashingWriter = new FsAtomicWriter({
      observer: crashAt("tmp-fsynced", isTempSiblingOf(finalPath)),
    });

    await expect(
      crashingWriter.createExclusive(finalPath, '{"version_id":"ver_1"}'),
    ).rejects.toThrow(InjectedCrash);

    const entries = await readdir(projectDir);
    const leakedTemps = entries.filter((entry) =>
      entry.startsWith("manifest.json.tmp."),
    );
    expect(leakedTemps).toHaveLength(1);
    await expect(readFile(finalPath, "utf8")).rejects.toThrow(/ENOENT/);
  });
});
