import { err, ok } from "../../shared/result.js";
import type { Result } from "../../shared/result.js";
import type { Hasher } from "../ports/index.js";
import { project } from "../semantics/index.js";
import { getOwn } from "./records.js";
import type { BeaconRefusal } from "./refusals.js";
import type { Beacon, Draft } from "./types.js";
import type { Version } from "./versions.js";

export interface ApproveDraftCommand {
  readonly draftId: string;
  readonly expectedRevision: number;
  readonly reviewedHash: string;
  readonly versionId: string;
  readonly approvedAt: string;
  readonly actor: string | null;
  readonly staleOriginAcknowledged: boolean;
}

export function approveDraft(
  beacon: Beacon,
  cmd: ApproveDraftCommand,
  hasher: Hasher,
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
  if (Object.values(beacon.drafts).filter((candidate) => candidate.status === "open").length !== 1) {
    return err({ rule: "ambiguous-open-drafts", beaconId: beacon.beaconId });
  }
  if (getOwn(beacon.versions, cmd.versionId) !== undefined) {
    return err({ rule: "duplicate-version-id", versionId: cmd.versionId });
  }

  const currentHash = hasher.hash(project(draft.content));
  if (currentHash !== cmd.reviewedHash) {
    return err({
      rule: "reviewed-hash-mismatch",
      draftId: cmd.draftId,
      reviewedHash: cmd.reviewedHash,
      currentHash,
    });
  }

  const isStaleOrigin = draft.origin.branchedFromVersion !== beacon.activeVersionId;
  if (isStaleOrigin && !cmd.staleOriginAcknowledged) {
    return err({
      rule: "stale-origin-not-acknowledged",
      draftId: cmd.draftId,
      branchedFromVersion: draft.origin.branchedFromVersion,
      activeVersionId: beacon.activeVersionId,
    });
  }

  const nextLocalNumber =
    Object.values(beacon.versions).reduce(
      (max, version) => Math.max(max, version.localNumber),
      0,
    ) + 1;

  const newVersion: Version = {
    status: "active",
    versionId: cmd.versionId,
    localNumber: nextLocalNumber,
    approval: {
      approvedAt: cmd.approvedAt,
      reviewedHash: cmd.reviewedHash,
      staleOriginAcknowledged: cmd.staleOriginAcknowledged,
      assurance: "operator_confirmed",
      actor: cmd.actor,
    },
    provenance: {
      approvedDraftId: cmd.draftId,
      approvedRevision: draft.revision,
      branchedFromVersion: draft.origin.branchedFromVersion,
      branchedFromHash: draft.origin.branchedFromHash,
    },
  };

  const closedDraft: Draft = {
    status: "closed",
    draftId: draft.draftId,
    label: draft.label,
    revision: draft.revision,
    origin: draft.origin,
    content: draft.content,
    approvedVersionId: cmd.versionId,
    closedAt: cmd.approvedAt,
  };

  const versions = { ...beacon.versions, [cmd.versionId]: newVersion };
  if (beacon.activeVersionId !== null) {
    const priorActive = getOwn(beacon.versions, beacon.activeVersionId);
    if (priorActive !== undefined && priorActive.status === "active") {
      versions[beacon.activeVersionId] = {
        versionId: priorActive.versionId,
        localNumber: priorActive.localNumber,
        approval: priorActive.approval,
        provenance: priorActive.provenance,
        status: "superseded",
        supersededBy: cmd.versionId,
        supersededAt: cmd.approvedAt,
      };
    }
  }

  return ok({
    ...beacon,
    drafts: { ...beacon.drafts, [cmd.draftId]: closedDraft },
    versions,
    activeVersionId: cmd.versionId,
  });
}
