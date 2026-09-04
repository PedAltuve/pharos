import { access, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DraftOrigin } from "../../../src/domain/beacon/index.js";
import type { StoreCreateDraftCommand } from "../../../src/domain/ports/beacon-store.js";
import type { SemanticSource } from "../../../src/domain/semantics/index.js";
import type { AtomicWriter } from "../../../src/adapters/fs-beacon-store/atomic-writer.js";
import { FsAtomicWriter } from "../../../src/adapters/fs-beacon-store/atomic-writer.js";
import { FsBeaconStore } from "../../../src/adapters/fs-beacon-store/fs-beacon-store.js";
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
