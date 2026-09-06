import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DraftOrigin } from "../../../src/domain/beacon/index.js";
import { project } from "../../../src/domain/semantics/index.js";
import type {
  AtomicWriter,
  WriteObserver,
  WriteStage,
} from "../../../src/adapters/fs-beacon-store/atomic-writer.js";
import { FsAtomicWriter } from "../../../src/adapters/fs-beacon-store/atomic-writer.js";
import { FsBeaconStore } from "../../../src/adapters/fs-beacon-store/fs-beacon-store.js";
import {
  abandonDraftInput,
  inputHash,
  keyHash,
} from "../../../src/adapters/fs-beacon-store/journal.js";
import { deserializeRecord } from "../../../src/adapters/fs-beacon-store/serialization.js";
import { JcsSha256Hasher } from "../../../src/adapters/hashing/jcs-sha256-hasher.js";

let projectDir: string;
const hasher = new JcsSha256Hasher();
const origin: DraftOrigin = {
  branchedFromVersion: null,
  branchedFromHash: null,
  forkedFromDraft: null,
};
const source = {
  purpose: "p",
  actor: { type: "user" as const },
  entryPoint: { path: "/" },
  actions: [],
  readinessIntent: { sideEffectClass: "stateless" as const },
};
const cmd = {
  draftId: "draft_1",
  reason: "obsolete",
  abandonedAt: "2026-09-03T00:00:00.000Z",
};

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "pharos-abandon-"));
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

function store(writer?: AtomicWriter): FsBeaconStore {
  return new FsBeaconStore({ projectRoot: projectDir, hasher, writer });
}

async function seed(target = store()): Promise<FsBeaconStore> {
  const created = await target.createDraft("bcn_1", {
    draftId: cmd.draftId,
    label: "Draft",
    beaconTitle: "Beacon",
    origin,
    content: source,
  }, "create-key");
  expect(created.ok).toBe(true);
  return target;
}

class RecordingWriter implements AtomicWriter {
  readonly leakedTempPolicy = "sweep-on-recover" as const;
  readonly calls: string[] = [];
  private readonly inner = new FsAtomicWriter();

  async writeAtomic(path: string, bytes: string): Promise<void> {
    this.calls.push(path);
    await this.inner.writeAtomic(path, bytes);
  }

  async createExclusive(path: string, bytes: string): Promise<"created" | "exists"> {
    this.calls.push(path);
    return this.inner.createExclusive(path, bytes);
  }

  async removeAtomic(path: string): Promise<void> {
    this.calls.push(path);
    await this.inner.removeAtomic(path);
  }
}

class TombstoneExistsWriter extends RecordingWriter {
  override async createExclusive(path: string, bytes: string): Promise<"created" | "exists"> {
    this.calls.push(path);
    if (path.endsWith("tombstone.json")) return "exists";
    return super.createExclusive(path, bytes);
  }
}

class InjectedCrash extends Error {
  constructor(stage: WriteStage, path: string) {
    super(`InjectedCrash at ${stage} for ${path}`);
  }
}

function crashAt(stage: WriteStage, matches: (path: string) => boolean): WriteObserver {
  return {
    onStage(observedStage, path) {
      if (observedStage === stage && matches(path)) throw new InjectedCrash(stage, path);
    },
  };
}

function crashingStore(stage: WriteStage, matches: (path: string) => boolean): FsBeaconStore {
  return store(new FsAtomicWriter({ observer: crashAt(stage, matches) }));
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe("FsBeaconStore.abandonDraft", () => {
  it("writes the immutable tombstone, removes draft.json, then journals the abandoned result", async () => {
    const writer = new RecordingWriter();
    const target = await seed(store(writer));
    writer.calls.length = 0;
    const tombstone = join(projectDir, "beacons", "bcn_1", "drafts", cmd.draftId, "tombstone.json");
    const draft = join(projectDir, "beacons", "bcn_1", "drafts", cmd.draftId, "draft.json");
    const journal = join(projectDir, "journal", "idempotency");

    const result = await target.abandonDraft("bcn_1", cmd, "abandon-key");

    expect(result).toMatchObject({
      ok: true,
      value: {
        drafts: {
          draft_1: { status: "abandoned", ...cmd, label: "Draft", origin, finalRevision: 1 },
        },
      },
    });
    expect(deserializeRecord("tombstone", await readFile(tombstone, "utf8"))).toMatchObject({
      draftId: cmd.draftId,
      label: "Draft",
      origin,
      finalRevision: 1,
      finalHash: hasher.hash(project(source)),
      reason: cmd.reason,
      abandonedAt: cmd.abandonedAt,
      idempotency: {
        key: "abandon-key",
        keyHash: keyHash("abandon-key"),
        inputHash: inputHash(abandonDraftInput("bcn_1", cmd), hasher),
        method: "abandonDraft",
      },
    });
    expect(await exists(draft)).toBe(false);
    expect(writer.calls).toEqual([tombstone, draft, expect.stringContaining(journal)]);
  });

  it("replays an identical completed key, conflicts on changed input, and refuses a fresh-key second abandonment before writing", async () => {
    const writer = new RecordingWriter();
    const target = await seed(store(writer));
    const first = await target.abandonDraft("bcn_1", cmd, "abandon-key");
    const tombstone = join(projectDir, "beacons", "bcn_1", "drafts", cmd.draftId, "tombstone.json");
    const bytes = await readFile(tombstone, "utf8");
    writer.calls.length = 0;

    expect(await target.abandonDraft("bcn_1", cmd, "abandon-key")).toEqual(first);
    expect(await target.abandonDraft("bcn_1", { ...cmd, reason: "changed" }, "abandon-key"))
      .toMatchObject({ ok: false, error: { rule: "idempotency-key-conflict" } });
    expect(await target.abandonDraft("bcn_1", cmd, "fresh-key")).toEqual({
      ok: false,
      error: { rule: "draft-not-open", draftId: cmd.draftId, status: "abandoned" },
    });
    expect(writer.calls).toEqual([]);
    expect(await readFile(tombstone, "utf8")).toBe(bytes);
  });

  it("maps only an injected createExclusive exists response to immutable-file-exists", async () => {
    const writer = new TombstoneExistsWriter();
    const target = await seed(store(writer));

    await expect(target.abandonDraft("bcn_1", cmd, "abandon-key")).resolves.toEqual({
      ok: false,
      error: {
        rule: "immutable-file-exists",
        artifact: "tombstone",
        beaconId: "bcn_1",
        ownerId: cmd.draftId,
      },
    });
  });

  it("replays tombstone cleanup and the original journal after a tombstone-before-removal crash", async () => {
    const tombstone = join(projectDir, "beacons", "bcn_1", "drafts", cmd.draftId, "tombstone.json");
    const draft = join(projectDir, "beacons", "bcn_1", "drafts", cmd.draftId, "draft.json");
    const journal = join(projectDir, "journal", "idempotency", `${keyHash("abandon-key")}.json`);
    const crashing = await seed(crashingStore("materialized", (path) => path === tombstone));

    await expect(crashing.abandonDraft("bcn_1", cmd, "abandon-key")).rejects.toThrow(InjectedCrash);
    const tombstoneBytes = await readFile(tombstone, "utf8");
    expect(await exists(draft)).toBe(true);
    expect(await exists(journal)).toBe(false);
    expect(await exists(join(projectDir, "lock"))).toBe(false);

    const retryWriter = new RecordingWriter();
    const retry = store(retryWriter);
    await expect(retry.abandonDraft("bcn_1", cmd, "abandon-key")).resolves.toMatchObject({
      ok: true,
      value: { drafts: { draft_1: { status: "abandoned" } } },
    });
    expect(await exists(draft)).toBe(false);
    expect(await exists(journal)).toBe(true);
    expect(await readFile(tombstone, "utf8")).toBe(tombstoneBytes);
    expect(retryWriter.calls).toEqual([draft, journal]);

    retryWriter.calls.length = 0;
    await expect(retry.abandonDraft("bcn_1", cmd, "abandon-key")).resolves.toMatchObject({ ok: true });
    expect(retryWriter.calls).toEqual([]);
  });

  it("writes only the original journal after a removal-before-journal crash, then converges", async () => {
    const draft = join(projectDir, "beacons", "bcn_1", "drafts", cmd.draftId, "draft.json");
    const journal = join(projectDir, "journal", "idempotency", `${keyHash("abandon-key")}.json`);
    const crashing = await seed(crashingStore(
      "tmp-fsynced",
      (path) => path.startsWith(`${journal}.tmp.`),
    ));

    await expect(crashing.abandonDraft("bcn_1", cmd, "abandon-key")).rejects.toThrow(InjectedCrash);
    expect(await exists(draft)).toBe(false);
    expect(await exists(journal)).toBe(false);
    expect(await exists(join(projectDir, "lock"))).toBe(false);

    const retryWriter = new RecordingWriter();
    const retry = store(retryWriter);
    await expect(retry.abandonDraft("bcn_1", cmd, "abandon-key")).resolves.toMatchObject({ ok: true });
    expect(retryWriter.calls).toEqual([journal]);

    retryWriter.calls.length = 0;
    await expect(retry.abandonDraft("bcn_1", cmd, "abandon-key")).resolves.toMatchObject({ ok: true });
    expect(retryWriter.calls).toEqual([]);
  });

  it("completes a pending abandonment before another draft mutation looks up its journal", async () => {
    const abandonedDraft = join(projectDir, "beacons", "bcn_1", "drafts", cmd.draftId, "draft.json");
    const abandonedJournal = join(
      projectDir,
      "journal",
      "idempotency",
      `${keyHash("abandon-key")}.json`,
    );
    const crashing = await seed(crashingStore(
      "materialized",
      (path) => path.endsWith("tombstone.json"),
    ));

    await expect(crashing.abandonDraft("bcn_1", cmd, "abandon-key")).rejects.toThrow(InjectedCrash);

    const retry = store();
    await expect(retry.createDraft("bcn_1", {
      draftId: "draft_2",
      label: "Other",
      beaconTitle: "Beacon",
      origin,
      content: source,
    }, "create-other-key")).resolves.toMatchObject({
      ok: true,
      value: { drafts: { draft_1: { status: "abandoned" }, draft_2: { status: "open" } } },
    });
    expect(await exists(abandonedDraft)).toBe(false);
    expect(await exists(abandonedJournal)).toBe(true);
  });

  it("completes the original cleanup before reporting a changed-input conflict", async () => {
    const tombstone = join(projectDir, "beacons", "bcn_1", "drafts", cmd.draftId, "tombstone.json");
    const draft = join(projectDir, "beacons", "bcn_1", "drafts", cmd.draftId, "draft.json");
    const journal = join(projectDir, "journal", "idempotency", `${keyHash("abandon-key")}.json`);
    const crashing = await seed(crashingStore("materialized", (path) => path === tombstone));

    await expect(crashing.abandonDraft("bcn_1", cmd, "abandon-key")).rejects.toThrow(InjectedCrash);
    const tombstoneBytes = await readFile(tombstone, "utf8");

    const retryWriter = new RecordingWriter();
    const retry = store(retryWriter);
    await expect(retry.abandonDraft("bcn_1", { ...cmd, reason: "changed" }, "abandon-key"))
      .resolves.toMatchObject({ ok: false, error: { rule: "idempotency-key-conflict" } });
    expect(retryWriter.calls).toEqual([draft, journal]);
    expect(await readFile(tombstone, "utf8")).toBe(tombstoneBytes);

    retryWriter.calls.length = 0;
    await expect(retry.abandonDraft("bcn_1", cmd, "fresh-key")).resolves.toEqual({
      ok: false,
      error: { rule: "draft-not-open", draftId: cmd.draftId, status: "abandoned" },
    });
    expect(retryWriter.calls).toEqual([]);
  });

  it("replays a crashed abandonment project-wide before another beacon can claim its key", async () => {
    const tombstone = join(projectDir, "beacons", "bcn_1", "drafts", cmd.draftId, "tombstone.json");
    const draft = join(projectDir, "beacons", "bcn_1", "drafts", cmd.draftId, "draft.json");
    const journal = join(projectDir, "journal", "idempotency", `${keyHash("abandon-key")}.json`);
    const crashing = await seed(crashingStore("materialized", (path) => path === tombstone));

    await expect(crashing.abandonDraft("bcn_1", cmd, "abandon-key")).rejects.toThrow(InjectedCrash);
    const retry = store();
    await expect(retry.createDraft("bcn_2", {
      draftId: cmd.draftId,
      label: "Other",
      beaconTitle: "Other Beacon",
      origin,
      content: source,
    }, "abandon-key")).resolves.toMatchObject({
      ok: false,
      error: { rule: "idempotency-key-conflict", key: "abandon-key" },
    });
    expect(await exists(draft)).toBe(false);
    expect(deserializeRecord("idempotency", await readFile(journal, "utf8"))).toMatchObject({
      beaconId: "bcn_1",
      result: { draftId: cmd.draftId },
    });
    await expect(retry.abandonDraft("bcn_1", cmd, "abandon-key")).resolves.toMatchObject({ ok: true });
    await expect(retry.getBeacon("bcn_2")).resolves.toMatchObject({
      ok: false,
      error: { rule: "beacon-not-found" },
    });
  });

  it("replays a crashed create stamp before another beacon updates with its key", async () => {
    const retry = store();
    await expect(retry.createDraft("bcn_2", {
      draftId: "draft_2",
      label: "Other",
      beaconTitle: "Other Beacon",
      origin,
      content: source,
    }, "seed-key")).resolves.toMatchObject({ ok: true });

    const journal = join(projectDir, "journal", "idempotency", `${keyHash("create-key")}.json`);
    const crashing = crashingStore("tmp-fsynced", (path) => path.startsWith(`${journal}.tmp.`));
    await expect(crashing.createDraft("bcn_1", {
      draftId: cmd.draftId,
      label: "Draft",
      beaconTitle: "Beacon",
      origin,
      content: source,
    }, "create-key")).rejects.toThrow(InjectedCrash);

    await expect(retry.updateDraft("bcn_2", {
      draftId: "draft_2",
      expectedRevision: 1,
      content: source,
    }, "create-key")).resolves.toMatchObject({
      ok: false,
      error: { rule: "idempotency-key-conflict", key: "create-key" },
    });
    expect(deserializeRecord("idempotency", await readFile(journal, "utf8"))).toMatchObject({
      beaconId: "bcn_1",
      method: "createDraft",
    });
  });
});
