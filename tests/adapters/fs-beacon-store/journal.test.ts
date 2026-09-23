import fc from "fast-check";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FsAtomicWriter } from "../../../src/adapters/fs-beacon-store/atomic-writer.js";
import { JcsSha256Hasher } from "../../../src/adapters/hashing/jcs-sha256-hasher.js";
import { serializeRecord } from "../../../src/adapters/fs-beacon-store/serialization.js";
import type { Hasher } from "../../../src/domain/ports/hasher.js";
import type { JsonValue } from "../../../src/domain/ports/json-value.js";
import type { SemanticSource } from "../../../src/domain/semantics/types.js";
import { describe, expect, it } from "vitest";
import {
  abandonDraftInput,
  approveInput,
  createDraftInput,
  forkDraftInput,
  createJournalEntry,
  keyHash,
  lookupJournal,
  revokeActiveVersionInput,
  revokeVersionInput,
  updateDraftInput,
} from "../../../src/adapters/fs-beacon-store/journal.js";

describe("idempotency journal", () => {
  it("builds six SemanticValue inputs without nesting command interfaces", () => {
    const content: SemanticSource = {
      purpose: "p",
      actor: { type: "user" },
      entryPoint: { path: "/" },
      actions: [],
      readinessIntent: { sideEffectClass: "stateless" },
    };
    const hashes: JsonValue[] = [];
    const hasher: Hasher = {
      hash(value) {
        hashes.push(value);
        return "sha256:content";
      },
    };
    const origin = {
      branchedFromVersion: null,
      branchedFromHash: null,
      forkedFromDraft: null,
    };

    expect(approveInput("b", {
      draftId: "d", expectedRevision: 1, reviewedHash: "h", versionId: "v", approvedAt: "t",
      actor: null, staleOriginAcknowledged: true,
    })).toHaveProperty("method", "approveDraft");
    expect(createDraftInput("b", {
      draftId: "d", label: "l", content, origin, beaconTitle: "title",
    }, hasher)).toHaveProperty("contentHash", "sha256:content");
    expect(updateDraftInput("b", { draftId: "d", expectedRevision: 1, content }, hasher))
      .toHaveProperty("contentHash", "sha256:content");
    expect(forkDraftInput("b", { sourceDraftId: "d", draftId: "d2", label: "l" }))
      .toHaveProperty("method", "forkDraft");
    expect(abandonDraftInput("b", { draftId: "d", reason: "r", abandonedAt: "t" }))
      .toHaveProperty("method", "abandonDraft");
    expect(revokeVersionInput("b", {
      versionId: "v", reason: "r", actor: null, revokedAt: "t",
    })).toHaveProperty("method", "revokeVersion");
    expect(hashes).toHaveLength(2);
  });

  it("uses stable approval and active-revocation request semantics, not generated outputs", () => {
    expect(approveInput("b", {
      draftId: "d", expectedRevision: 1, reviewedHash: "h", versionId: "ver_first",
      approvedAt: "first", actor: null, staleOriginAcknowledged: true,
    })).toEqual(approveInput("b", {
      draftId: "d", expectedRevision: 1, reviewedHash: "h", versionId: "ver_retry",
      approvedAt: "retry", actor: null, staleOriginAcknowledged: true,
    }));
    expect(revokeActiveVersionInput("b", {
      expectedActiveVersionId: "ver_first", reason: " withdrawn ", actor: null, revokedAt: "first",
    })).toEqual(revokeActiveVersionInput("b", {
      expectedActiveVersionId: null, reason: "withdrawn", actor: null, revokedAt: "retry",
    }));
  });

  it("ignores project-excluded source fields when hashing update input", () => {
    const base: SemanticSource = {
      purpose: "p",
      actor: { type: "user" },
      entryPoint: { path: "/" },
      actions: [],
      readinessIntent: { sideEffectClass: "stateless" },
    };
    const hasher = new JcsSha256Hasher();

    fc.assert(fc.property(
      fc.dictionary(fc.stringMatching(/^excluded:[a-z]{1,4}$/), fc.jsonValue()),
      (excluded) => {
        const first: SemanticSource = { ...base, ...excluded };
        const second: SemanticSource = {
          ...first,
          "excluded:changed": { nested: ["value"] },
        };
        expect(updateDraftInput("b", { draftId: "d", expectedRevision: 1, content: first }, hasher))
          .toEqual(updateDraftInput("b", { draftId: "d", expectedRevision: 1, content: second }, hasher));
      },
    ));
  });

  it("creates, reads, and distinguishes absent, replay, and conflict entries", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "journal-test-"));
    await mkdir(join(projectRoot, "journal", "idempotency"), { recursive: true });
    const entry = {
      key: "K",
      keyHash: keyHash("K"),
      method: "updateDraft" as const,
      beaconId: "bcn_1",
      inputHash: "sha256:input",
      result: { beaconId: "bcn_1", versionId: null, draftId: "draft_1", revision: 2 },
    };
    const writer = new FsAtomicWriter();

    await expect(lookupJournal(projectRoot, entry.keyHash, entry.inputHash, entry.key)).resolves.toEqual({
      outcome: "absent",
    });
    await expect(createJournalEntry(projectRoot, entry, writer)).resolves.toBe("created");
    await expect(lookupJournal(projectRoot, entry.keyHash, entry.inputHash, entry.key)).resolves.toMatchObject({
      outcome: "replay-hit",
    });
    await expect(lookupJournal(projectRoot, entry.keyHash, "sha256:other", entry.key)).resolves.toMatchObject({
      outcome: "conflict",
    });

    await rm(projectRoot, { recursive: true, force: true });
  });

  it("rejects contract-valid entries with mismatched key bindings", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "journal-test-"));
    const requestedKey = "requested";
    const entry = {
      key: "other",
      keyHash: keyHash("other"),
      method: "updateDraft" as const,
      beaconId: "bcn_1",
      inputHash: "sha256:input",
      result: { beaconId: "bcn_1", versionId: null, draftId: "draft_1", revision: 2 },
    };
    const entryPath = join(projectRoot, "journal", "idempotency", `${keyHash(requestedKey)}.json`);

    await mkdir(join(projectRoot, "journal", "idempotency"), { recursive: true });
    await writeFile(entryPath, serializeRecord("idempotency", entry));

    await expect(lookupJournal(
      projectRoot, keyHash(requestedKey), entry.inputHash, requestedKey,
    )).rejects.toThrow("Corrupt");
    await writeFile(entryPath, serializeRecord("idempotency", {
      ...entry, key: requestedKey, keyHash: keyHash("other"),
    }));
    await expect(lookupJournal(
      projectRoot, keyHash(requestedKey), entry.inputHash, requestedKey,
    )).rejects.toThrow("Corrupt");

    await rm(projectRoot, { recursive: true, force: true });
  });

  it("hashes the raw UTF-8 key bytes", () => {
    expect(keyHash("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(keyHash("abc")).not.toBe(
      "8b5f48702995c159cd1c56c6e65c7f7a8d1c6b6f5e8f8f3f1b2e2d8b8e4f6c4",
    );
  });
});
