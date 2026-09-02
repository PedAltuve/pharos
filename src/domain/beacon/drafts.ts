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
