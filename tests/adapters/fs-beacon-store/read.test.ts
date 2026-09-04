import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FsBeaconStore } from "../../../src/adapters/fs-beacon-store/fs-beacon-store.js";
import { JcsSha256Hasher } from "../../../src/adapters/hashing/jcs-sha256-hasher.js";

let projectDir: string;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "pharos-fs-beacon-store-"));
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe("FsBeaconStore.getBeacon", () => {
  it("returns beacon-not-found for an absent beacon directory", async () => {
    const store = new FsBeaconStore({ projectRoot: projectDir, hasher: new JcsSha256Hasher() });

    const result = await store.getBeacon("bcn_absent");

    expect(result).toEqual({
      ok: false,
      error: { rule: "beacon-not-found", beaconId: "bcn_absent" },
    });
  });
});
