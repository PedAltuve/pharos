import { err, ok } from "../../shared/result.js";
import type { Result } from "../../shared/result.js";
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
