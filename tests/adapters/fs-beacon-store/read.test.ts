import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DraftOrigin } from "../../../src/domain/beacon/index.js";
import type { SemanticSource } from "../../../src/domain/semantics/index.js";
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

describe("FsBeaconStore round-trip (fs-beacon-store R1 S1)", () => {
  it("reconstructs a Beacon with all three Draft variants and an active version identically", async () => {
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
    expect(result.value.beaconId).toBe("bcn_rt");
    expect(result.value.title).toBe("Round Trip");
    expect(result.value.activeVersionId).toBe("ver_1");
    expect(result.value.versions.ver_1).toMatchObject({ versionId: "ver_1", status: "active" });
    expect(Object.keys(result.value.drafts).sort()).toEqual([
      "draft_abandoned", "draft_closed", "draft_open",
    ]);
  });
});
