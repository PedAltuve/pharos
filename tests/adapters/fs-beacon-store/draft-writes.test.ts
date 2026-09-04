import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DraftOrigin } from "../../../src/domain/beacon/index.js";
import type { StoreCreateDraftCommand } from "../../../src/domain/ports/beacon-store.js";
import type { SemanticSource } from "../../../src/domain/semantics/index.js";
import type { AtomicWriter } from "../../../src/adapters/fs-beacon-store/atomic-writer.js";
import { FsAtomicWriter } from "../../../src/adapters/fs-beacon-store/atomic-writer.js";
import { BeaconStoreCorruptionError } from "../../../src/adapters/fs-beacon-store/corruption.js";
import { FsBeaconStore } from "../../../src/adapters/fs-beacon-store/fs-beacon-store.js";
import { keyHash } from "../../../src/adapters/fs-beacon-store/journal.js";
import { applyPendingDraftReplays } from "../../../src/adapters/fs-beacon-store/reconcile.js";
import { deserializeRecord, serializeRecord } from "../../../src/adapters/fs-beacon-store/serialization.js";
import { JcsSha256Hasher } from "../../../src/adapters/hashing/jcs-sha256-hasher.js";

let projectDir: string;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "pharos-draft-writes-"));
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

const noOrigin: DraftOrigin = {
  branchedFromVersion: null,
  branchedFromHash: null,
  forkedFromDraft: null,
};

function content(purpose: string): SemanticSource {
  return {
    purpose,
    actor: { type: "user" },
    entryPoint: { path: "/" },
    actions: [],
    readinessIntent: { sideEffectClass: "stateless" },
  };
}

function createCmd(
  overrides: Partial<StoreCreateDraftCommand> = {},
): StoreCreateDraftCommand {
  return {
    draftId: "draft_1",
    label: "Draft",
    content: content("p"),
    origin: noOrigin,
    beaconTitle: "Title",
    ...overrides,
  };
}

/** Records write-path call order while delegating to a real FsAtomicWriter. */
class OrderRecordingWriter implements AtomicWriter {
  readonly calls: string[] = [];
  readonly leakedTempPolicy = "sweep-on-recover" as const;
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

/** Throws before delegating to a real FsAtomicWriter for any matching path. */
class CrashBeforeWriter implements AtomicWriter {
  readonly leakedTempPolicy = "sweep-on-recover" as const;
  private readonly inner = new FsAtomicWriter();

  constructor(private readonly shouldCrash: (path: string) => boolean) {}

  async writeAtomic(path: string, bytes: string): Promise<void> {
    if (this.shouldCrash(path)) throw new Error("InjectedCrash");
    await this.inner.writeAtomic(path, bytes);
  }

  async createExclusive(path: string, bytes: string): Promise<"created" | "exists"> {
    if (this.shouldCrash(path)) throw new Error("InjectedCrash");
    return this.inner.createExclusive(path, bytes);
  }

  async removeAtomic(path: string): Promise<void> {
    if (this.shouldCrash(path)) throw new Error("InjectedCrash");
    await this.inner.removeAtomic(path);
  }
}

function crashesAtJournalWrite(): CrashBeforeWriter {
  return new CrashBeforeWriter((path) => path.includes(join("journal", "idempotency")));
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe("FsBeaconStore.createDraft — bootstrap ordering (D10)", () => {
  it("bootstraps: writes beacon.json before drafts/<D>/draft.json, and only after the domain call returns ok", async () => {
    const writer = new OrderRecordingWriter();
    const store = new FsBeaconStore({
      projectRoot: projectDir,
      hasher: new JcsSha256Hasher(),
      writer,
    });
    const beaconDir = join(projectDir, "beacons", "bcn_1");
    const beaconRecordPath = join(beaconDir, "beacon.json");
    const draftRecordPath = join(beaconDir, "drafts", "draft_1", "draft.json");

    expect(await exists(beaconRecordPath)).toBe(false);

    const result = await store.createDraft("bcn_1", createCmd(), "key-1");

    expect(result.ok).toBe(true);
    expect(await exists(beaconRecordPath)).toBe(true);
    expect(await exists(draftRecordPath)).toBe(true);
    const beaconWriteIndex = writer.calls.indexOf(beaconRecordPath);
    const draftWriteIndex = writer.calls.indexOf(draftRecordPath);
    expect(beaconWriteIndex).toBeGreaterThanOrEqual(0);
    expect(draftWriteIndex).toBeGreaterThan(beaconWriteIndex);
  });
});

describe("FsBeaconStore.createDraft — existing beacon / no side effect on refusal (D10)", () => {
  it("writes only drafts/<D2>/draft.json for an existing beacon, without rewriting beacon.json", async () => {
    const store = new FsBeaconStore({ projectRoot: projectDir, hasher: new JcsSha256Hasher() });
    await store.createDraft("bcn_1", createCmd(), "key-1");
    const beaconRecordPath = join(projectDir, "beacons", "bcn_1", "beacon.json");
    const beforeBytes = await readFile(beaconRecordPath, "utf8");

    const result = await store.createDraft(
      "bcn_1",
      createCmd({ draftId: "draft_2", beaconTitle: "Ignored on non-bootstrap" }),
      "key-2",
    );

    expect(result.ok).toBe(true);
    expect(await readFile(beaconRecordPath, "utf8")).toBe(beforeBytes);
    expect(await exists(join(projectDir, "beacons", "bcn_1", "drafts", "draft_2", "draft.json"))).toBe(true);
  });

  it("leaves no beacon.json on disk when a would-be-bootstrap createDraft is refused", async () => {
    // D10's own text: duplicate-draft-id is unreachable on a bootstrap (the
    // in-memory record is always empty), so the only refusal reachable on a
    // fresh beaconId is the D7 invalid-id classification, checked before the
    // domain call is ever made. This is the closest reachable proof that no
    // refused mutation on an absent beacon ever leaves a beacon.json behind.
    const store = new FsBeaconStore({ projectRoot: projectDir, hasher: new JcsSha256Hasher() });

    const result = await store.createDraft("bcn_1", createCmd({ draftId: "bad id" }), "key-1");

    expect(result).toEqual({
      ok: false,
      error: { rule: "invalid-id", field: "draftId", value: "bad id" },
    });
    expect(await exists(join(projectDir, "beacons", "bcn_1", "beacon.json"))).toBe(false);
  });
});

describe("FsBeaconStore.createDraft — idempotency replay and conflict (beacon-store-port R2 S1/S2)", () => {
  it("replays a repeated key with the same logical input, without creating a second draft", async () => {
    const store = new FsBeaconStore({ projectRoot: projectDir, hasher: new JcsSha256Hasher() });
    const cmd = createCmd();

    const first = await store.createDraft("bcn_1", cmd, "same-key");
    const second = await store.createDraft("bcn_1", cmd, "same-key");

    expect(first.ok).toBe(true);
    expect(second).toEqual(first);
    const draftIds = await readdir(join(projectDir, "beacons", "bcn_1", "drafts"));
    expect(draftIds).toEqual(["draft_1"]);
  });

  it("refuses idempotency-key-conflict for a repeated key with a different logical input, performing no mutation", async () => {
    const store = new FsBeaconStore({ projectRoot: projectDir, hasher: new JcsSha256Hasher() });
    await store.createDraft("bcn_1", createCmd(), "same-key");

    const conflicting = await store.createDraft(
      "bcn_1",
      createCmd({ draftId: "draft_2", content: content("different") }),
      "same-key",
    );

    expect(conflicting.ok).toBe(false);
    if (conflicting.ok) throw new Error("expected a refusal");
    expect(conflicting.error).toMatchObject({ rule: "idempotency-key-conflict", key: "same-key" });
    expect(await exists(join(projectDir, "beacons", "bcn_1", "drafts", "draft_2"))).toBe(false);
  });
});

describe("FsBeaconStore.createDraft — GREEN confirmation of the pre-existing ordering (task 6.4)", () => {
  it("confirms the existing-beacon-only-write and refusal-leaves-no-beacon.json cases pass unmodified", async () => {
    // Task 6.4 asks to confirm 6.3 already passes against 6.2's construction
    // with no further code change. Both 6.3 cases above pass against the
    // same createDraft implementation exercised by 6.1/6.2 — no additional
    // GREEN pass was required beyond what those two describe blocks already
    // prove; this test only pins that fact so a future change cannot regress
    // it silently.
    const store = new FsBeaconStore({ projectRoot: projectDir, hasher: new JcsSha256Hasher() });
    await mkdir(join(projectDir, "beacons"), { recursive: true });

    const refused = await store.createDraft("bcn_x", createCmd({ draftId: ".." }), "k");
    expect(refused.ok).toBe(false);
    expect(await exists(join(projectDir, "beacons", "bcn_x"))).toBe(false);
  });
});

describe("FsBeaconStore.updateDraft — revision-bound against persisted state (beacon-store-port R4 S1)", () => {
  it("refuses a stale expectedRevision without mutation, leaving the persisted draft unchanged", async () => {
    const store = new FsBeaconStore({ projectRoot: projectDir, hasher: new JcsSha256Hasher() });
    await store.createDraft("bcn_1", createCmd(), "create-key");
    const draftPath = join(projectDir, "beacons", "bcn_1", "drafts", "draft_1", "draft.json");
    const beforeBytes = await readFile(draftPath, "utf8");

    const result = await store.updateDraft(
      "bcn_1",
      { draftId: "draft_1", expectedRevision: 0, content: content("stale") },
      "update-key",
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.error).toMatchObject({
      rule: "stale-draft-revision",
      draftId: "draft_1",
      expectedRevision: 0,
      currentRevision: 1,
    });
    expect(await readFile(draftPath, "utf8")).toBe(beforeBytes);
    // WARNING 5 — the non-bootstrap half: a refusal on an existing beacon
    // must leave no journal entry either, not only an unchanged draft.json.
    expect(await exists(join(projectDir, "journal", "idempotency", `${keyHash("update-key")}.json`))).toBe(false);
  });

  it("succeeds with a matching expectedRevision, incrementing the on-disk revision", async () => {
    const store = new FsBeaconStore({ projectRoot: projectDir, hasher: new JcsSha256Hasher() });
    await store.createDraft("bcn_1", createCmd(), "create-key");

    const result = await store.updateDraft(
      "bcn_1",
      { draftId: "draft_1", expectedRevision: 1, content: content("updated") },
      "update-key",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.value.drafts.draft_1).toMatchObject({ revision: 2, content: content("updated") });
  });

  it("refuses beacon-not-found for an absent beacon", async () => {
    const store = new FsBeaconStore({ projectRoot: projectDir, hasher: new JcsSha256Hasher() });

    const result = await store.updateDraft(
      "bcn_absent",
      { draftId: "draft_1", expectedRevision: 1, content: content("x") },
      "update-key",
    );

    expect(result).toEqual({
      ok: false,
      error: { rule: "beacon-not-found", beaconId: "bcn_absent" },
    });
  });
});

describe("FsBeaconStore.forkDraft — writes only the fork's draft.json", () => {
  it("forks from an open source, preserving origin.forkedFromDraft", async () => {
    const store = new FsBeaconStore({ projectRoot: projectDir, hasher: new JcsSha256Hasher() });
    await store.createDraft("bcn_1", createCmd(), "create-key");

    const result = await store.forkDraft(
      "bcn_1",
      { sourceDraftId: "draft_1", draftId: "draft_2", label: "Fork" },
      "fork-key",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.value.drafts.draft_2).toMatchObject({
      status: "open",
      label: "Fork",
      origin: { ...noOrigin, forkedFromDraft: "draft_1" },
      content: content("p"),
    });
    expect(await exists(join(projectDir, "beacons", "bcn_1", "drafts", "draft_2", "draft.json"))).toBe(true);
  });

  it("forks from a closed source, preserving origin.forkedFromDraft and content", async () => {
    const beaconDir = join(projectDir, "beacons", "bcn_1");
    await mkdir(beaconDir, { recursive: true });
    await writeFile(
      join(beaconDir, "beacon.json"),
      serializeRecord("beacon", { beaconId: "bcn_1", title: "Title" }),
    );
    const closedDraftDir = join(beaconDir, "drafts", "draft_closed");
    await mkdir(closedDraftDir, { recursive: true });
    await writeFile(
      join(closedDraftDir, "draft.json"),
      serializeRecord("draft", {
        draftId: "draft_closed", label: "Closed", status: "closed", revision: 2,
        origin: noOrigin, content: content("closed-content"),
        approvedVersionId: "ver_1", closedAt: "2026-01-04T00:00:00Z",
      }),
    );
    const store = new FsBeaconStore({ projectRoot: projectDir, hasher: new JcsSha256Hasher() });

    const result = await store.forkDraft(
      "bcn_1",
      { sourceDraftId: "draft_closed", draftId: "draft_fork", label: "From closed" },
      "fork-key",
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.value.drafts.draft_fork).toMatchObject({
      status: "open",
      origin: { ...noOrigin, forkedFromDraft: "draft_closed" },
      content: content("closed-content"),
    });
  });
});

describe("FsBeaconStore.updateDraft / forkDraft — invalid caller-supplied draft ids (D7, WARNING 1)", () => {
  it("updateDraft refuses draft-not-found for an invalid draftId instead of throwing", async () => {
    const store = new FsBeaconStore({ projectRoot: projectDir, hasher: new JcsSha256Hasher() });
    await store.createDraft("bcn_1", createCmd(), "create-key");

    const result = await store.updateDraft(
      "bcn_1",
      { draftId: "bad id", expectedRevision: 1, content: content("x") },
      "update-key",
    );

    expect(result).toEqual({
      ok: false,
      error: { rule: "draft-not-found", draftId: "bad id" },
    });
  });

  it("forkDraft refuses draft-not-found for an invalid sourceDraftId instead of throwing", async () => {
    const store = new FsBeaconStore({ projectRoot: projectDir, hasher: new JcsSha256Hasher() });
    await store.createDraft("bcn_1", createCmd(), "create-key");

    const result = await store.forkDraft(
      "bcn_1",
      { sourceDraftId: "bad id", draftId: "draft_2", label: "Fork" },
      "fork-key",
    );

    expect(result).toEqual({
      ok: false,
      error: { rule: "draft-not-found", draftId: "bad id" },
    });
  });
});

describe("FsBeaconStore — a replay-hit journal entry must be bound to the requesting beacon (WARNING 2)", () => {
  it("throws BeaconStoreCorruptionError instead of returning a foreign beacon's scan when the entry's beaconId does not match", async () => {
    const store = new FsBeaconStore({ projectRoot: projectDir, hasher: new JcsSha256Hasher() });
    await store.createDraft("bcn_1", createCmd(), "shared-key");
    const entryPath = join(projectDir, "journal", "idempotency", `${keyHash("shared-key")}.json`);
    const entry = deserializeRecord("idempotency", await readFile(entryPath, "utf8")) as Record<string, unknown>;
    await writeFile(entryPath, serializeRecord("idempotency", { ...entry, beaconId: "bcn_2" }));

    await expect(store.createDraft("bcn_1", createCmd(), "shared-key")).rejects.toThrow(
      BeaconStoreCorruptionError,
    );
  });
});

describe("reconcile.applyPendingDraftReplays — the other three guards (WARNING 3)", () => {
  it("skips a tombstoned draft, a draft directory with no draft.json, a stamp-less draft, and a non-draft-window stamp", async () => {
    const beaconDir = join(projectDir, "beacons", "bcn_1");

    // Guard 1 — tombstone present: draft.json still carries a stamp, but must be skipped.
    const tombstonedDir = join(beaconDir, "drafts", "draft_tombstoned");
    await mkdir(tombstonedDir, { recursive: true });
    await writeFile(
      join(tombstonedDir, "tombstone.json"),
      serializeRecord("tombstone", {
        draftId: "draft_tombstoned", label: "Gone", origin: noOrigin,
        finalRevision: 1, finalHash: "sha256:x", reason: "r", abandonedAt: "2026-01-01T00:00:00Z",
      }),
    );
    await writeFile(
      join(tombstonedDir, "draft.json"),
      serializeRecord("draft", {
        draftId: "draft_tombstoned", label: "Gone", status: "open", revision: 1,
        origin: noOrigin, content: content("p"),
        idempotency: { key: "kt", keyHash: "kh-tombstoned", inputHash: "sha256:in", method: "createDraft" },
      }),
    );

    // Guard 2 — draft directory present with no draft.json at all.
    await mkdir(join(beaconDir, "drafts", "draft_empty"), { recursive: true });

    // Guard 3a — draft.json present but carries no idempotency stamp.
    const noStampDir = join(beaconDir, "drafts", "draft_no_stamp");
    await mkdir(noStampDir, { recursive: true });
    await writeFile(
      join(noStampDir, "draft.json"),
      serializeRecord("draft", {
        draftId: "draft_no_stamp", label: "No stamp", status: "open", revision: 1,
        origin: noOrigin, content: content("p"),
      }),
    );

    // Guard 3b — stamp present but names a non-draft-window method.
    const wrongMethodDir = join(beaconDir, "drafts", "draft_wrong_method");
    await mkdir(wrongMethodDir, { recursive: true });
    await writeFile(
      join(wrongMethodDir, "draft.json"),
      serializeRecord("draft", {
        draftId: "draft_wrong_method", label: "Wrong method", status: "open", revision: 1,
        origin: noOrigin, content: content("p"),
        idempotency: { key: "kw", keyHash: "kh-wrong-method", inputHash: "sha256:in", method: "approveDraft" },
      }),
    );

    await expect(
      applyPendingDraftReplays(projectDir, "bcn_1", new FsAtomicWriter()),
    ).resolves.toBeUndefined();

    expect(await exists(join(projectDir, "journal", "idempotency", "kh-tombstoned.json"))).toBe(false);
    expect(await exists(join(projectDir, "journal", "idempotency", "kh-wrong-method.json"))).toBe(false);
  });
});

describe("D1e — the mutable-commit-point journal window (beacon-store-recovery R3)", () => {
  it("createDraft: a same-key retry after a crash between draft.json and the journal entry adopts, raising neither stale-draft-revision nor duplicate-draft-id", async () => {
    const crashingStore = new FsBeaconStore({
      projectRoot: projectDir, hasher: new JcsSha256Hasher(), writer: crashesAtJournalWrite(),
    });

    await expect(crashingStore.createDraft("bcn_1", createCmd(), "K")).rejects.toThrow();
    expect(await exists(join(projectDir, "beacons", "bcn_1", "drafts", "draft_1", "draft.json"))).toBe(true);
    expect(await exists(join(projectDir, "journal", "idempotency", `${keyHash("K")}.json`))).toBe(false);

    const store = new FsBeaconStore({ projectRoot: projectDir, hasher: new JcsSha256Hasher() });
    const retry = await store.createDraft("bcn_1", createCmd(), "K");

    expect(retry.ok).toBe(true);
    if (!retry.ok) throw new Error("expected ok result");
    // WARNING 4 — prove adoption, not a second draft or a wrong revision.
    expect(Object.keys(retry.value.drafts)).toEqual(["draft_1"]);
    expect(retry.value.drafts.draft_1).toMatchObject({ revision: 1, content: content("p") });
    const journalEntry = deserializeRecord(
      "idempotency",
      await readFile(join(projectDir, "journal", "idempotency", `${keyHash("K")}.json`), "utf8"),
    );
    expect(journalEntry).toMatchObject({ keyHash: keyHash("K"), method: "createDraft" });
  });

  it("updateDraft: a same-key retry after a crash between draft.json and the journal entry adopts, raising neither stale-draft-revision nor duplicate-draft-id", async () => {
    const store = new FsBeaconStore({ projectRoot: projectDir, hasher: new JcsSha256Hasher() });
    await store.createDraft("bcn_1", createCmd(), "create-key");
    const crashingStore = new FsBeaconStore({
      projectRoot: projectDir, hasher: new JcsSha256Hasher(), writer: crashesAtJournalWrite(),
    });

    await expect(crashingStore.updateDraft(
      "bcn_1",
      { draftId: "draft_1", expectedRevision: 1, content: content("updated") },
      "K",
    )).rejects.toThrow();
    expect(await exists(join(projectDir, "journal", "idempotency", `${keyHash("K")}.json`))).toBe(false);

    const retry = await store.updateDraft(
      "bcn_1",
      { draftId: "draft_1", expectedRevision: 1, content: content("updated") },
      "K",
    );

    expect(retry.ok).toBe(true);
    if (!retry.ok) throw new Error("expected ok result");
    // WARNING 4 — prove adoption, not a stale revision or a duplicate draft.
    expect(Object.keys(retry.value.drafts)).toEqual(["draft_1"]);
    expect(retry.value.drafts.draft_1).toMatchObject({ revision: 2, content: content("updated") });
    const journalEntry = deserializeRecord(
      "idempotency",
      await readFile(join(projectDir, "journal", "idempotency", `${keyHash("K")}.json`), "utf8"),
    );
    expect(journalEntry).toMatchObject({ keyHash: keyHash("K"), method: "updateDraft" });
  });

  it("forkDraft: a same-key retry after a crash between draft.json and the journal entry adopts, raising neither stale-draft-revision nor duplicate-draft-id", async () => {
    const store = new FsBeaconStore({ projectRoot: projectDir, hasher: new JcsSha256Hasher() });
    await store.createDraft("bcn_1", createCmd(), "create-key");
    const crashingStore = new FsBeaconStore({
      projectRoot: projectDir, hasher: new JcsSha256Hasher(), writer: crashesAtJournalWrite(),
    });

    await expect(crashingStore.forkDraft(
      "bcn_1",
      { sourceDraftId: "draft_1", draftId: "draft_2", label: "Fork" },
      "K",
    )).rejects.toThrow();
    expect(await exists(join(projectDir, "journal", "idempotency", `${keyHash("K")}.json`))).toBe(false);

    const retry = await store.forkDraft(
      "bcn_1",
      { sourceDraftId: "draft_1", draftId: "draft_2", label: "Fork" },
      "K",
    );

    expect(retry.ok).toBe(true);
    if (!retry.ok) throw new Error("expected ok result");
    // WARNING 4 — prove adoption: exactly the source plus one fork, at the
    // fork's expected revision, not a duplicate fork or a stale revision.
    expect(Object.keys(retry.value.drafts).sort()).toEqual(["draft_1", "draft_2"]);
    expect(retry.value.drafts.draft_2).toMatchObject({
      revision: 1, origin: { ...noOrigin, forkedFromDraft: "draft_1" },
    });
    const journalEntry = deserializeRecord(
      "idempotency",
      await readFile(join(projectDir, "journal", "idempotency", `${keyHash("K")}.json`), "utf8"),
    );
    expect(journalEntry).toMatchObject({ keyHash: keyHash("K"), method: "forkDraft" });
  });

  it("converges: a second createDraft retry after a successful replay performs no further action", async () => {
    const crashingStore = new FsBeaconStore({
      projectRoot: projectDir, hasher: new JcsSha256Hasher(), writer: crashesAtJournalWrite(),
    });
    await expect(crashingStore.createDraft("bcn_1", createCmd(), "K")).rejects.toThrow();

    const store = new FsBeaconStore({ projectRoot: projectDir, hasher: new JcsSha256Hasher() });
    const firstRetry = await store.createDraft("bcn_1", createCmd(), "K");
    expect(firstRetry.ok).toBe(true);

    const journalEntryPath = join(projectDir, "journal", "idempotency", `${keyHash("K")}.json`);
    const bytesAfterFirstRetry = await readFile(journalEntryPath, "utf8");

    const secondRetry = await store.createDraft("bcn_1", createCmd(), "K");

    expect(secondRetry).toEqual(firstRetry);
    expect(await readFile(journalEntryPath, "utf8")).toBe(bytesAfterFirstRetry);
  });
});
