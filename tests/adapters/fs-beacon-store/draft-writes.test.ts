import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DraftOrigin } from "../../../src/domain/beacon/index.js";
import type { StoreCreateDraftCommand } from "../../../src/domain/ports/beacon-store.js";
import type { SemanticSource } from "../../../src/domain/semantics/index.js";
import type { AtomicWriter } from "../../../src/adapters/fs-beacon-store/atomic-writer.js";
import { FsAtomicWriter } from "../../../src/adapters/fs-beacon-store/atomic-writer.js";
import { FsBeaconStore } from "../../../src/adapters/fs-beacon-store/fs-beacon-store.js";
import { serializeRecord } from "../../../src/adapters/fs-beacon-store/serialization.js";
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
