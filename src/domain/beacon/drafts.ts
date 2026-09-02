import { err, ok } from "../../shared/result.js";
import type { Result } from "../../shared/result.js";
import type { Hasher } from "../ports/index.js";
import { project } from "../semantics/index.js";
import type { SemanticSource } from "../semantics/index.js";
import { getOwn } from "./records.js";
import type { BeaconRefusal } from "./refusals.js";
import type { Beacon, Draft, DraftOrigin } from "./types.js";

export interface CreateDraftCommand {
  readonly draftId: string;
  readonly label: string;
  readonly content: SemanticSource;
  readonly origin: DraftOrigin;
}

export interface UpdateDraftCommand {
  readonly draftId: string;
  readonly expectedRevision: number;
  readonly content: SemanticSource;
}

export interface ForkDraftCommand {
  readonly sourceDraftId: string;
  readonly draftId: string;
  readonly label: string;
}

export interface AbandonDraftCommand {
  readonly draftId: string;
  readonly reason: string;
  readonly abandonedAt: string;
}

export function createDraft(
  beacon: Beacon,
  cmd: CreateDraftCommand,
): Result<Beacon, BeaconRefusal> {
  if (getOwn(beacon.drafts, cmd.draftId) !== undefined) {
    return err({ rule: "duplicate-draft-id", draftId: cmd.draftId });
  }

  const draft: Draft = {
    status: "open",
    draftId: cmd.draftId,
    label: cmd.label,
    revision: 1,
    origin: cmd.origin,
    content: cmd.content,
  };

  return ok({
    ...beacon,
    drafts: { ...beacon.drafts, [cmd.draftId]: draft },
  });
}

export function updateDraft(
  beacon: Beacon,
  cmd: UpdateDraftCommand,
): Result<Beacon, BeaconRefusal> {
  const draft = getOwn(beacon.drafts, cmd.draftId);
  if (draft === undefined) {
    return err({ rule: "draft-not-found", draftId: cmd.draftId });
  }
  if (draft.status !== "open") {
    return err({ rule: "draft-not-open", draftId: cmd.draftId, status: draft.status });
  }
  if (cmd.expectedRevision !== draft.revision) {
    return err({
      rule: "stale-draft-revision",
      draftId: cmd.draftId,
      expectedRevision: cmd.expectedRevision,
      currentRevision: draft.revision,
    });
  }

  const updated: Draft = {
    ...draft,
    revision: draft.revision + 1,
    content: cmd.content,
  };

  return ok({
    ...beacon,
    drafts: { ...beacon.drafts, [cmd.draftId]: updated },
  });
}

export function forkDraft(
  beacon: Beacon,
  cmd: ForkDraftCommand,
): Result<Beacon, BeaconRefusal> {
  const source = getOwn(beacon.drafts, cmd.sourceDraftId);
  if (source === undefined) {
    return err({ rule: "draft-not-found", draftId: cmd.sourceDraftId });
  }
  if (getOwn(beacon.drafts, cmd.draftId) !== undefined) {
    return err({ rule: "duplicate-draft-id", draftId: cmd.draftId });
  }
  if (source.status === "abandoned") {
    return err({
      rule: "source-draft-has-no-content",
      draftId: cmd.sourceDraftId,
      status: source.status,
    });
  }

  const fork: Draft = {
    status: "open",
    draftId: cmd.draftId,
    label: cmd.label,
    revision: 1,
    origin: { ...source.origin, forkedFromDraft: cmd.sourceDraftId },
    content: source.content,
  };

  return ok({
    ...beacon,
    drafts: { ...beacon.drafts, [cmd.draftId]: fork },
  });
}

export function abandonDraft(
  beacon: Beacon,
  cmd: AbandonDraftCommand,
  hasher: Hasher,
): Result<Beacon, BeaconRefusal> {
  const draft = getOwn(beacon.drafts, cmd.draftId);
  if (draft === undefined) {
    return err({ rule: "draft-not-found", draftId: cmd.draftId });
  }
  if (draft.status !== "open") {
    return err({ rule: "draft-not-open", draftId: cmd.draftId, status: draft.status });
  }

  const abandoned: Draft = {
    status: "abandoned",
    draftId: draft.draftId,
    label: draft.label,
    origin: draft.origin,
    finalRevision: draft.revision,
    finalHash: hasher.hash(project(draft.content)),
    reason: cmd.reason,
    abandonedAt: cmd.abandonedAt,
  };

  return ok({
    ...beacon,
    drafts: { ...beacon.drafts, [cmd.draftId]: abandoned },
  });
}
