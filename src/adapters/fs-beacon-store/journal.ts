import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { AtomicWriter } from "./atomic-writer.js";
import { createLayout } from "./layout.js";
import { deserializeRecord, serializeRecord } from "./serialization.js";
import type {
  AbandonDraftCommand,
  ApproveDraftCommand,
  ForkDraftCommand,
  RevokeVersionCommand,
  RevokeActiveVersionCommand,
  UpdateDraftCommand,
} from "../../domain/beacon/index.js";
import type { Hasher } from "../../domain/ports/hasher.js";
import type { StoreCreateDraftCommand } from "../../domain/ports/beacon-store.js";
import { project } from "../../domain/semantics/project.js";
import type { SemanticValue } from "../../domain/semantics/types.js";

export type JournalMethod =
  | "approveDraft"
  | "createDraft"
  | "updateDraft"
  | "forkDraft"
  | "abandonDraft"
  | "revokeVersion"
  | "revokeActiveVersion";

export interface JournalResult {
  readonly beaconId: string;
  readonly versionId: string | null;
  readonly draftId: string | null;
  readonly revision: number | null;
}

export interface JournalEntry {
  readonly key: string;
  readonly keyHash: string;
  readonly method: JournalMethod;
  readonly beaconId: string;
  readonly inputHash: string;
  readonly result: JournalResult;
}

export type JournalLookup =
  | { readonly outcome: "absent" }
  | { readonly outcome: "replay-hit"; readonly entry: JournalEntry }
  | { readonly outcome: "conflict"; readonly entry: JournalEntry };

export const keyHash = (key: string): string =>
  createHash("sha256").update(key, "utf8").digest("hex");

export function approveInput(beaconId: string, c: ApproveDraftCommand): SemanticValue {
  return {
    method: "approveDraft", beaconId, draftId: c.draftId,
    expectedRevision: c.expectedRevision, reviewedHash: c.reviewedHash,
    actor: c.actor, staleOriginAcknowledged: c.staleOriginAcknowledged,
  };
}

export function createDraftInput(
  beaconId: string,
  c: StoreCreateDraftCommand,
  hasher: Hasher,
): SemanticValue {
  return {
    method: "createDraft", beaconId, draftId: c.draftId, label: c.label,
    beaconTitle: c.beaconTitle, contentHash: hasher.hash(project(c.content)),
    origin: {
      branchedFromVersion: c.origin.branchedFromVersion,
      branchedFromHash: c.origin.branchedFromHash,
      forkedFromDraft: c.origin.forkedFromDraft,
    },
  };
}

export function updateDraftInput(
  beaconId: string,
  c: UpdateDraftCommand,
  hasher: Hasher,
): SemanticValue {
  return {
    method: "updateDraft", beaconId, draftId: c.draftId,
    expectedRevision: c.expectedRevision, contentHash: hasher.hash(project(c.content)),
  };
}

export function forkDraftInput(beaconId: string, c: ForkDraftCommand): SemanticValue {
  return {
    method: "forkDraft", beaconId, sourceDraftId: c.sourceDraftId,
    draftId: c.draftId, label: c.label,
  };
}

export function abandonDraftInput(beaconId: string, c: AbandonDraftCommand): SemanticValue {
  return {
    method: "abandonDraft", beaconId, draftId: c.draftId,
    reason: c.reason, abandonedAt: c.abandonedAt,
  };
}

export function revokeVersionInput(beaconId: string, c: RevokeVersionCommand): SemanticValue {
  return {
    method: "revokeVersion", beaconId, versionId: c.versionId,
    reason: c.reason, actor: c.actor, revokedAt: c.revokedAt,
  };
}

export function revokeActiveVersionInput(
  beaconId: string,
  c: RevokeActiveVersionCommand,
): SemanticValue {
  return {
    method: "revokeActiveVersion", beaconId,
    reason: c.reason.trim(), actor: c.actor,
  };
}

export function inputHash(value: SemanticValue, hasher: Hasher): string {
  return hasher.hash(value);
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export async function readJournalEntry(
  projectRoot: string,
  hash: string,
): Promise<JournalEntry | undefined> {
  try {
    const bytes = await readFile(createLayout(projectRoot).journalEntry(hash), "utf8");
    return deserializeRecord("idempotency", bytes) as JournalEntry;
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

export async function createJournalEntry(
  projectRoot: string,
  entry: JournalEntry,
  writer: AtomicWriter,
): Promise<"created" | "exists"> {
  const layout = createLayout(projectRoot);
  return writer.createExclusive(
    layout.journalEntry(entry.keyHash),
    serializeRecord("idempotency", entry),
  );
}

export async function lookupJournal(
  projectRoot: string,
  hash: string,
  requestedInputHash: string,
  requestedKey: string,
): Promise<JournalLookup> {
  const entry = await readJournalEntry(projectRoot, hash);
  if (entry === undefined) return { outcome: "absent" };
  if (
    entry.key !== requestedKey
    || entry.keyHash !== keyHash(entry.key)
    || entry.keyHash !== keyHash(requestedKey)
    || entry.keyHash !== hash
  ) throw new Error("Corrupt journal entry");
  return entry.inputHash === requestedInputHash
    ? { outcome: "replay-hit", entry }
    : { outcome: "conflict", entry };
}
