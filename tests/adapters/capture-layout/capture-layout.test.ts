import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  captureStageDirectory,
  stagedRecordingPath,
  withHandleBoundRegularFile,
} from "../../../src/adapters/capture-layout/index.js";

const captureId = "cap_018f47de-7a00-7cc0-8000-000000000001" as const;
let root = "";

afterEach(async () => {
  if (root !== "") await rm(root, { recursive: true, force: true });
  root = "";
});

describe("capture layout", () => {
  it("owns the staging directory and recording artifact path", () => {
    expect(captureStageDirectory("/private/project", captureId)).toBe(
      `/private/project/capture-staging/${captureId}`,
    );
    expect(stagedRecordingPath("/private/project", captureId)).toBe(
      `/private/project/capture-staging/${captureId}/recording.spec.ts`,
    );
  });

  it("refuses a pathname replacement after opening a regular artifact", async () => {
    root = await mkdtemp(join(tmpdir(), "pharos-capture-layout-"));
    const directory = captureStageDirectory(root, captureId);
    const artifact = stagedRecordingPath(root, captureId);
    await mkdir(directory, { recursive: true });
    await writeFile(artifact, "original");

    const contents = await withHandleBoundRegularFile(artifact, async (file) => {
      await rm(artifact);
      await writeFile(artifact, "replacement");
      return await file.readContents();
    });

    expect(contents).toBeNull();
  });
});
