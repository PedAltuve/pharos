import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BeaconStoreCorruptionError } from "../../../src/adapters/fs-beacon-store/corruption.js";
import { scanVersions } from "../../../src/adapters/fs-beacon-store/reconcile.js";
import { serializeRecord } from "../../../src/adapters/fs-beacon-store/serialization.js";

let projectDir: string;
let beaconDir: string;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "pharos-reconcile-"));
  beaconDir = join(projectDir, "beacons", "bcn_1");
  await mkdir(beaconDir, { recursive: true });
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

interface ManifestOverrides {
  readonly localNumber?: number;
  readonly supersedesVersion?: string | null;
  readonly approvedAt?: string;
}

async function writeVersion(versionId: string, overrides: ManifestOverrides = {}): Promise<void> {
  const versionDir = join(beaconDir, "versions", versionId);
  await mkdir(versionDir, { recursive: true });
  await writeFile(
    join(versionDir, "manifest.json"),
    serializeRecord("manifest", {
      versionId,
      localNumber: overrides.localNumber ?? 1,
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

async function writeRevocation(
  versionId: string,
  previousStatus: "active" | "superseded",
): Promise<void> {
  await writeFile(
    join(beaconDir, "versions", versionId, "revocation.json"),
    serializeRecord("revocation", {
      previousStatus,
      revocation: { revokedAt: "2026-01-02T00:00:00Z", reason: "r", actor: null },
    }),
  );
}

async function writeActive(versionId: string | null): Promise<void> {
  await writeFile(
    join(beaconDir, "active.json"),
    serializeRecord("active", { activeVersionId: versionId }),
  );
}

describe("reconcile.scanVersions — committed-chain walk", () => {
  it("excludes an orphan while including its committed sibling as superseded (D1's trace)", async () => {
    await writeVersion("ver_1", { approvedAt: "2026-01-01T00:00:00Z" });
    await writeVersion("ver_2", { supersedesVersion: "ver_1", approvedAt: "2026-01-02T00:00:00Z" });
    await writeVersion("ver_3", { supersedesVersion: "ver_1", approvedAt: "2026-01-03T00:00:00Z" });
    await writeActive("ver_3");

    const scan = await scanVersions(projectDir, "bcn_1");

    expect(scan.activeVersionId).toBe("ver_3");
    expect(Object.keys(scan.versions).sort()).toEqual(["ver_1", "ver_3"]);
    expect(scan.versions.ver_3).toMatchObject({ status: "active" });
    expect(scan.versions.ver_1).toMatchObject({
      status: "superseded",
      supersededBy: "ver_3",
      supersededAt: "2026-01-03T00:00:00Z",
    });
    expect(scan.orphanVersionIds).toEqual(["ver_2"]);
  });

  it("derives activeVersionId as null when active.json names a version deriving to revoked", async () => {
    await writeVersion("ver_1");
    await writeRevocation("ver_1", "active");
    await writeActive("ver_1");

    const scan = await scanVersions(projectDir, "bcn_1");

    expect(scan.activeVersionId).toBeNull();
    expect(scan.versions.ver_1).toMatchObject({ status: "revoked", previousStatus: "active" });
  });

  it("derives at most one active version among committed versions", async () => {
    await writeVersion("ver_1");
    await writeVersion("ver_2", { supersedesVersion: "ver_1" });
    await writeActive("ver_2");

    const scan = await scanVersions(projectDir, "bcn_1");

    const activeVersions = Object.values(scan.versions).filter((version) => version.status === "active");
    expect(activeVersions).toHaveLength(1);
    expect(activeVersions[0]).toMatchObject({ versionId: "ver_2" });
  });

  it("does not throw when two manifests share the same supersedes_version", async () => {
    await writeVersion("ver_1");
    await writeVersion("ver_2", { supersedesVersion: "ver_1" });
    await writeVersion("ver_3", { supersedesVersion: "ver_1" });
    await writeActive("ver_3");

    await expect(scanVersions(projectDir, "bcn_1")).resolves.toBeDefined();
  });

  it("does not throw when two manifests share the same local_number", async () => {
    await writeVersion("ver_1", { localNumber: 5 });
    await writeVersion("ver_2", { localNumber: 5, supersedesVersion: "ver_1" });
    await writeActive("ver_1");

    await expect(scanVersions(projectDir, "bcn_1")).resolves.toBeDefined();
  });

  it("throws on a dangling supersedes_version pointer naming a version with no manifest.json", async () => {
    await writeVersion("ver_1", { supersedesVersion: "ver_missing" });
    await writeActive("ver_1");

    await expect(scanVersions(projectDir, "bcn_1")).rejects.toThrow(BeaconStoreCorruptionError);
  });

  it("throws on a cycle in the walk", async () => {
    await writeVersion("ver_1", { supersedesVersion: "ver_2" });
    await writeVersion("ver_2", { supersedesVersion: "ver_1" });
    await writeActive("ver_1");

    await expect(scanVersions(projectDir, "bcn_1")).rejects.toThrow(BeaconStoreCorruptionError);
  });

  it("throws when active.json names a version with no manifest.json", async () => {
    await writeActive("ver_ghost");

    await expect(scanVersions(projectDir, "bcn_1")).rejects.toThrow(BeaconStoreCorruptionError);
  });

  it("throws when an embedded version id does not match its directory name", async () => {
    const versionDir = join(beaconDir, "versions", "ver_1");
    await mkdir(versionDir, { recursive: true });
    await writeFile(
      join(versionDir, "manifest.json"),
      serializeRecord("manifest", {
        versionId: "ver_other",
        localNumber: 1,
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
        supersedesVersion: null,
        idempotency: { key: "k", keyHash: "kh", inputHash: "sha256:in", method: "approveDraft" },
      }),
    );
    await writeActive("ver_1");

    await expect(scanVersions(projectDir, "bcn_1")).rejects.toThrow(BeaconStoreCorruptionError);
  });
});
