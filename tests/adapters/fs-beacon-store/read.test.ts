import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Beacon, DraftOrigin } from "../../../src/domain/beacon/index.js";
import type { SemanticSource } from "../../../src/domain/semantics/index.js";
import { BeaconStoreCorruptionError } from "../../../src/adapters/fs-beacon-store/corruption.js";
import { FsBeaconStore } from "../../../src/adapters/fs-beacon-store/fs-beacon-store.js";
import { serializeRecord } from "../../../src/adapters/fs-beacon-store/serialization.js";
import { JcsSha256Hasher } from "../../../src/adapters/hashing/jcs-sha256-hasher.js";

let projectDir: string;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "pharos-fs-beacon-store-"));
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

const noOrigin: DraftOrigin = {
  branchedFromVersion: null,
  branchedFromHash: null,
  forkedFromDraft: null,
};

const content: SemanticSource = {
  purpose: "p",
  actor: { type: "user" },
  entryPoint: { path: "/" },
  actions: [],
  readinessIntent: { sideEffectClass: "stateless" },
};

async function writeBeaconRecord(beaconDir: string, beaconId: string, title: string): Promise<void> {
  await mkdir(beaconDir, { recursive: true });
  await writeFile(join(beaconDir, "beacon.json"), serializeRecord("beacon", { beaconId, title }));
}

async function writeManifest(
  beaconDir: string,
  versionId: string,
  overrides: { readonly supersedesVersion?: string | null; readonly approvedAt?: string } = {},
): Promise<void> {
  const versionDir = join(beaconDir, "versions", versionId);
  await mkdir(versionDir, { recursive: true });
  await writeFile(
    join(versionDir, "manifest.json"),
    serializeRecord("manifest", {
      versionId,
      localNumber: 1,
      approval: {
        approvedAt: overrides.approvedAt ?? "2026-01-01T00:00:00Z",
        reviewedHash: "sha256:hash",
        staleOriginAcknowledged: false,
        assurance: "operator_confirmed",
        actor: null,
      },
      provenance: {
        approvedDraftId: "draft_1",
        approvedRevision: 1,
        branchedFromVersion: null,
        branchedFromHash: null,
      },
      supersedesVersion: overrides.supersedesVersion ?? null,
      idempotency: { key: "k", keyHash: "kh", inputHash: "sha256:in", method: "approveDraft" },
    }),
  );
}

async function writeActive(beaconDir: string, versionId: string | null): Promise<void> {
  await writeFile(
    join(beaconDir, "active.json"),
    serializeRecord("active", { activeVersionId: versionId }),
  );
}

async function writeOpenDraft(beaconDir: string, draftId: string, revision = 1): Promise<void> {
  const draftDir = join(beaconDir, "drafts", draftId);
  await mkdir(draftDir, { recursive: true });
  await writeFile(
    join(draftDir, "draft.json"),
    serializeRecord("draft", {
      draftId, label: "Open", status: "open", revision, origin: noOrigin, content,
    }),
  );
}

async function writeClosedDraft(
  beaconDir: string,
  draftId: string,
  approvedVersionId: string,
): Promise<void> {
  const draftDir = join(beaconDir, "drafts", draftId);
  await mkdir(draftDir, { recursive: true });
  await writeFile(
    join(draftDir, "draft.json"),
    serializeRecord("draft", {
      draftId, label: "Closed", status: "closed", revision: 2, origin: noOrigin, content,
      approvedVersionId, closedAt: "2026-01-04T00:00:00Z",
    }),
  );
}

async function writeAbandonedDraft(beaconDir: string, draftId: string): Promise<void> {
  const draftDir = join(beaconDir, "drafts", draftId);
  await mkdir(draftDir, { recursive: true });
  await writeFile(
    join(draftDir, "draft.json"),
    serializeRecord("draft", {
      draftId, label: "Stale open", status: "open", revision: 3, origin: noOrigin, content,
    }),
  );
  await writeFile(
    join(draftDir, "tombstone.json"),
    serializeRecord("tombstone", {
      draftId, label: "Abandoned label", origin: noOrigin,
      finalRevision: 3, finalHash: "sha256:final", reason: "no longer needed",
      abandonedAt: "2026-01-05T00:00:00Z",
    }),
  );
}

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

describe("FsBeaconStore.getBeacon — Draft reconstruction (D1b)", () => {
  it("reconstructs all three Draft variants; tombstone wins over draft.json", async () => {
    const beaconDir = join(projectDir, "beacons", "bcn_1");
    await writeBeaconRecord(beaconDir, "bcn_1", "Title");
    await writeAbandonedDraft(beaconDir, "draft_abandoned");
    await writeOpenDraft(beaconDir, "draft_open");
    await writeClosedDraft(beaconDir, "draft_closed", "ver_1");

    const store = new FsBeaconStore({ projectRoot: projectDir, hasher: new JcsSha256Hasher() });
    const result = await store.getBeacon("bcn_1");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.value.drafts.draft_abandoned).toEqual({
      status: "abandoned",
      draftId: "draft_abandoned",
      label: "Abandoned label",
      origin: noOrigin,
      finalRevision: 3,
      finalHash: "sha256:final",
      reason: "no longer needed",
      abandonedAt: "2026-01-05T00:00:00Z",
    });
    expect(result.value.drafts.draft_open).toEqual({
      status: "open", draftId: "draft_open", label: "Open", revision: 1, origin: noOrigin, content,
    });
    expect(result.value.drafts.draft_closed).toEqual({
      status: "closed", draftId: "draft_closed", label: "Closed", revision: 2, origin: noOrigin,
      content, approvedVersionId: "ver_1", closedAt: "2026-01-04T00:00:00Z",
    });
  });
});

describe("FsBeaconStore.listBeacons / getActiveVersion", () => {
  it("listBeacons sorts before semantic use and returns every beacon under beacons/", async () => {
    await writeBeaconRecord(join(projectDir, "beacons", "bcn_zeta"), "bcn_zeta", "Zeta");
    await writeBeaconRecord(join(projectDir, "beacons", "bcn_alpha"), "bcn_alpha", "Alpha");

    const store = new FsBeaconStore({ projectRoot: projectDir, hasher: new JcsSha256Hasher() });
    const result = await store.listBeacons();

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.value.map((beacon) => beacon.beaconId)).toEqual(["bcn_alpha", "bcn_zeta"]);
  });

  it("getActiveVersion returns the derived-active version and refuses beacon-not-found", async () => {
    const beaconDir = join(projectDir, "beacons", "bcn_1");
    await writeBeaconRecord(beaconDir, "bcn_1", "Title");
    await writeManifest(beaconDir, "ver_1");
    await writeActive(beaconDir, "ver_1");

    const store = new FsBeaconStore({ projectRoot: projectDir, hasher: new JcsSha256Hasher() });

    const active = await store.getActiveVersion("bcn_1");
    expect(active.ok).toBe(true);
    if (!active.ok) throw new Error("expected ok result");
    expect(active.value).toMatchObject({ versionId: "ver_1", status: "active" });

    const missing = await store.getActiveVersion("bcn_absent");
    expect(missing).toEqual({
      ok: false,
      error: { rule: "beacon-not-found", beaconId: "bcn_absent" },
    });
  });

  it("getActiveVersion returns null when activeVersionId derives to null", async () => {
    const beaconDir = join(projectDir, "beacons", "bcn_1");
    await writeBeaconRecord(beaconDir, "bcn_1", "Title");

    const store = new FsBeaconStore({ projectRoot: projectDir, hasher: new JcsSha256Hasher() });
    const active = await store.getActiveVersion("bcn_1");

    expect(active).toEqual({ ok: true, value: null });
  });
});

describe("FsBeaconStore round-trip (fs-beacon-store R1 S1)", () => {
  it("reconstructs a Beacon structurally identical to the original, not just matching fragments", async () => {
    const beaconDir = join(projectDir, "beacons", "bcn_rt");
    await writeBeaconRecord(beaconDir, "bcn_rt", "Round Trip");
    await writeManifest(beaconDir, "ver_1");
    await writeActive(beaconDir, "ver_1");
    await writeAbandonedDraft(beaconDir, "draft_abandoned");
    await writeOpenDraft(beaconDir, "draft_open");
    await writeClosedDraft(beaconDir, "draft_closed", "ver_1");

    const store = new FsBeaconStore({ projectRoot: projectDir, hasher: new JcsSha256Hasher() });
    const result = await store.getBeacon("bcn_rt");

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");

    const expected: Beacon = {
      beaconId: "bcn_rt",
      title: "Round Trip",
      activeVersionId: "ver_1",
      versions: {
        ver_1: {
          versionId: "ver_1",
          localNumber: 1,
          status: "active",
          approval: {
            approvedAt: "2026-01-01T00:00:00Z",
            reviewedHash: "sha256:hash",
            staleOriginAcknowledged: false,
            assurance: "operator_confirmed",
            actor: null,
          },
          provenance: {
            approvedDraftId: "draft_1",
            approvedRevision: 1,
            branchedFromVersion: null,
            branchedFromHash: null,
          },
        },
      },
      drafts: {
        draft_abandoned: {
          status: "abandoned",
          draftId: "draft_abandoned",
          label: "Abandoned label",
          origin: noOrigin,
          finalRevision: 3,
          finalHash: "sha256:final",
          reason: "no longer needed",
          abandonedAt: "2026-01-05T00:00:00Z",
        },
        draft_open: {
          status: "open",
          draftId: "draft_open",
          label: "Open",
          revision: 1,
          origin: noOrigin,
          content,
        },
        draft_closed: {
          status: "closed",
          draftId: "draft_closed",
          label: "Closed",
          revision: 2,
          origin: noOrigin,
          content,
          approvedVersionId: "ver_1",
          closedAt: "2026-01-04T00:00:00Z",
        },
      },
    };

    expect(result.value).toEqual(expected);
  });
});

describe("FsBeaconStore — project.json is untouched (R1 S2 / D9)", () => {
  it("leaves project.json byte-for-byte unchanged across all three read methods", async () => {
    const projectJsonPath = join(projectDir, "project.json");
    const originalBytes = '{"projectId":"proj_1"}';
    await writeFile(projectJsonPath, originalBytes);
    await writeBeaconRecord(join(projectDir, "beacons", "bcn_1"), "bcn_1", "Title");

    const store = new FsBeaconStore({ projectRoot: projectDir, hasher: new JcsSha256Hasher() });
    await store.getBeacon("bcn_1");
    await store.listBeacons();
    await store.getActiveVersion("bcn_1");

    expect(await readFile(projectJsonPath, "utf8")).toBe(originalBytes);
  });
});

describe("FsBeaconStore — non-directory entries in versions/drafts listings (R3 finding 2)", () => {
  it("rejects with BeaconStoreCorruptionError, never a raw ENOTDIR, for a stray file in versions/", async () => {
    const beaconDir = join(projectDir, "beacons", "bcn_1");
    await writeBeaconRecord(beaconDir, "bcn_1", "Title");
    await writeManifest(beaconDir, "ver_1");
    await writeActive(beaconDir, "ver_1");
    await mkdir(join(beaconDir, "versions"), { recursive: true });
    await writeFile(join(beaconDir, "versions", ".DS_Store"), "stray");

    const store = new FsBeaconStore({ projectRoot: projectDir, hasher: new JcsSha256Hasher() });

    await expect(store.getBeacon("bcn_1")).rejects.toThrow(BeaconStoreCorruptionError);
    await expect(store.getActiveVersion("bcn_1")).rejects.toThrow(BeaconStoreCorruptionError);
    await expect(store.listBeacons()).rejects.toThrow(BeaconStoreCorruptionError);
  });

  it("rejects with BeaconStoreCorruptionError, never a raw ENOTDIR, for a stray file in drafts/", async () => {
    const beaconDir = join(projectDir, "beacons", "bcn_2");
    await writeBeaconRecord(beaconDir, "bcn_2", "Title");
    await mkdir(join(beaconDir, "drafts"), { recursive: true });
    await writeFile(join(beaconDir, "drafts", ".DS_Store"), "stray");

    const store = new FsBeaconStore({ projectRoot: projectDir, hasher: new JcsSha256Hasher() });

    await expect(store.getBeacon("bcn_2")).rejects.toThrow(BeaconStoreCorruptionError);
    await expect(store.getActiveVersion("bcn_2")).rejects.toThrow(BeaconStoreCorruptionError);
    await expect(store.listBeacons()).rejects.toThrow(BeaconStoreCorruptionError);
  });
});

describe("FsBeaconStore — orphan classification (beacon-store-recovery R2 S1, read half)", () => {
  it("excludes an orphan left by a crash before active.json from getBeacon and getActiveVersion", async () => {
    const beaconDir = join(projectDir, "beacons", "bcn_1");
    await writeBeaconRecord(beaconDir, "bcn_1", "Title");
    await writeManifest(beaconDir, "ver_1");
    await writeActive(beaconDir, "ver_1");
    await writeManifest(beaconDir, "ver_orphan", { supersedesVersion: "ver_1" });

    const store = new FsBeaconStore({ projectRoot: projectDir, hasher: new JcsSha256Hasher() });

    const beaconResult = await store.getBeacon("bcn_1");
    expect(beaconResult.ok).toBe(true);
    if (!beaconResult.ok) throw new Error("expected ok result");
    expect(beaconResult.value.versions.ver_orphan).toBeUndefined();
    expect(beaconResult.value.activeVersionId).toBe("ver_1");

    const active = await store.getActiveVersion("bcn_1");
    expect(active.ok).toBe(true);
    if (!active.ok) throw new Error("expected ok result");
    expect(active.value?.versionId).toBe("ver_1");
  });
});

describe("FsBeaconStore — D7 caller-supplied id validation (ROOT CAUSE 1)", () => {
  it("returns beacon-not-found for an invalid caller-supplied beaconId in getBeacon, never a thrown Error", async () => {
    const store = new FsBeaconStore({ projectRoot: projectDir, hasher: new JcsSha256Hasher() });

    const result = await store.getBeacon("bad id");

    expect(result).toEqual({
      ok: false,
      error: { rule: "beacon-not-found", beaconId: "bad id" },
    });
  });

  it("returns beacon-not-found for an invalid caller-supplied beaconId in getActiveVersion, never a thrown Error", async () => {
    const store = new FsBeaconStore({ projectRoot: projectDir, hasher: new JcsSha256Hasher() });

    const result = await store.getActiveVersion("bad id");

    expect(result).toEqual({
      ok: false,
      error: { rule: "beacon-not-found", beaconId: "bad id" },
    });
  });
});

describe("FsBeaconStore — D7 disk-provenance id validation (ROOT CAUSE 1 / 2)", () => {
  it("throws BeaconStoreCorruptionError for a beacon directory name failing id validation", async () => {
    await writeBeaconRecord(join(projectDir, "beacons", "bad id"), "bad id", "Title");

    const store = new FsBeaconStore({ projectRoot: projectDir, hasher: new JcsSha256Hasher() });

    await expect(store.listBeacons()).rejects.toThrow(BeaconStoreCorruptionError);
  });

  it("rejects with BeaconStoreCorruptionError, never a raw ENOTDIR, for a stray file directly in beacons/", async () => {
    await mkdir(join(projectDir, "beacons"), { recursive: true });
    await writeFile(join(projectDir, "beacons", ".DS_Store"), "stray");
    await writeBeaconRecord(join(projectDir, "beacons", "bcn_1"), "bcn_1", "Title");

    const store = new FsBeaconStore({ projectRoot: projectDir, hasher: new JcsSha256Hasher() });

    await expect(store.listBeacons()).rejects.toThrow(BeaconStoreCorruptionError);
  });
});

describe("FsBeaconStore — pathExists surfaces non-ENOENT errors (DEFECT 3)", () => {
  it("propagates a non-ENOENT filesystem error instead of reporting beacon-not-found", async () => {
    await mkdir(join(projectDir, "beacons"), { recursive: true });
    await writeFile(join(projectDir, "beacons", "bcn_1"), "not a directory");

    const store = new FsBeaconStore({ projectRoot: projectDir, hasher: new JcsSha256Hasher() });

    await expect(store.getBeacon("bcn_1")).rejects.toThrow(/ENOTDIR/);
  });
});

describe("FsBeaconStore — unknown draft status is corruption (DEFECT 4 / D1b)", () => {
  it("throws BeaconStoreCorruptionError instead of silently reconstructing an unmodelled status as closed", async () => {
    const beaconDir = join(projectDir, "beacons", "bcn_1");
    await writeBeaconRecord(beaconDir, "bcn_1", "Title");
    const draftDir = join(beaconDir, "drafts", "draft_1");
    await mkdir(draftDir, { recursive: true });
    // Carries every field a "closed" draft needs, so the only signal that
    // this status is unmodelled is the status string itself — proving the
    // fallthrough is not merely masked by a missing-field check elsewhere.
    await writeFile(
      join(draftDir, "draft.json"),
      serializeRecord("draft", {
        draftId: "draft_1",
        label: "Pending",
        status: "pending",
        revision: 1,
        origin: noOrigin,
        content,
        approvedVersionId: "ver_1",
        closedAt: "2026-01-04T00:00:00Z",
      }),
    );

    const store = new FsBeaconStore({ projectRoot: projectDir, hasher: new JcsSha256Hasher() });

    await expect(store.getBeacon("bcn_1")).rejects.toThrow(BeaconStoreCorruptionError);
  });
});
