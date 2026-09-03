import type { SemanticProjection, SemanticSource, SemanticValue } from "../../domain/semantics/index.js";

export type FileKind =
  | "beacon"
  | "active"
  | "draft"
  | "tombstone"
  | "manifest"
  | "semantics"
  | "revocation"
  | "idempotency";
export type ContractClassification = "valid" | "corrupt";

type JsonObject = { [key: string]: unknown };

const CONTRACTS: Record<FileKind, string> = {
  beacon: "pharos.beacon/1",
  active: "pharos.beacon-active/1",
  draft: "pharos.beacon-draft/1",
  tombstone: "pharos.beacon-tombstone/1",
  manifest: "pharos.version-manifest/1",
  semantics: "pharos.beacon-semantics/1",
  revocation: "pharos.version-revocation/1",
  idempotency: "pharos.idempotency-entry/1",
};

function objectOf(value: unknown): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("A contract payload must be an object");
  }
  return value as JsonObject;
}

function pick(input: JsonObject, key: string, output: JsonObject, diskKey: string): void {
  if (Object.hasOwn(input, key)) output[diskKey] = input[key];
}

function unpick(input: JsonObject, diskKey: string, output: JsonObject, key: string): void {
  if (Object.hasOwn(input, diskKey)) output[key] = input[diskKey];
}

function origin(value: unknown): unknown {
  const input = objectOf(value);
  const output: JsonObject = {};
  pick(input, "branchedFromVersion", output, "branched_from_version");
  pick(input, "branchedFromHash", output, "branched_from_hash");
  pick(input, "forkedFromDraft", output, "forked_from_draft");
  return output;
}

function decodeOrigin(value: unknown): unknown {
  const input = objectOf(value);
  const output: JsonObject = {};
  unpick(input, "branched_from_version", output, "branchedFromVersion");
  unpick(input, "branched_from_hash", output, "branchedFromHash");
  unpick(input, "forked_from_draft", output, "forkedFromDraft");
  return output;
}

function idempotency(value: unknown): unknown {
  const input = objectOf(value);
  const output: JsonObject = {};
  pick(input, "key", output, "key");
  pick(input, "keyHash", output, "key_hash");
  pick(input, "inputHash", output, "input_hash");
  pick(input, "method", output, "method");
  return output;
}

function decodeIdempotency(value: unknown): unknown {
  const input = objectOf(value);
  const output: JsonObject = {};
  unpick(input, "key", output, "key");
  unpick(input, "key_hash", output, "keyHash");
  unpick(input, "input_hash", output, "inputHash");
  unpick(input, "method", output, "method");
  return output;
}

function approval(value: unknown): unknown {
  const input = objectOf(value);
  const output: JsonObject = {};
  pick(input, "approvedAt", output, "approved_at");
  pick(input, "reviewedHash", output, "reviewed_hash");
  pick(input, "staleOriginAcknowledged", output, "stale_origin_acknowledged");
  pick(input, "assurance", output, "assurance");
  pick(input, "actor", output, "actor");
  return output;
}

function decodeApproval(value: unknown): unknown {
  const input = objectOf(value);
  const output: JsonObject = {};
  unpick(input, "approved_at", output, "approvedAt");
  unpick(input, "reviewed_hash", output, "reviewedHash");
  unpick(input, "stale_origin_acknowledged", output, "staleOriginAcknowledged");
  unpick(input, "assurance", output, "assurance");
  unpick(input, "actor", output, "actor");
  return output;
}

function projection(value: unknown): unknown {
  const input = objectOf(value);
  const output: JsonObject = {};
  pick(input, "purpose", output, "purpose");
  if (Object.hasOwn(input, "actor")) {
    const actor = objectOf(input.actor);
    output.actor = { type: actor.type, identity_ref: actor.identityRef };
  }
  if (Object.hasOwn(input, "entryPoint")) {
    const entry = objectOf(input.entryPoint);
    output.entry_point = { path: entry.path, query: entry.query, fragment: entry.fragment };
  }
  if (Object.hasOwn(input, "actions")) {
    output.actions = (input.actions as readonly unknown[]).map((item) => {
      const action = objectOf(item);
      return {
        action: action.action,
        target: action.target,
        value: action.value,
      };
    });
  }
  if (Object.hasOwn(input, "checkpoints")) {
    const checkpoints = objectOf(input.checkpoints);
    output.checkpoints = {
      ordering: checkpoints.ordering,
      entries: checkpoints.entries,
    };
  }
  if (Object.hasOwn(input, "variables")) output.variables = input.variables;
  if (Object.hasOwn(input, "outcomes")) output.outcomes = input.outcomes;
  if (Object.hasOwn(input, "allowedVariation")) {
    output.allowed_variation = input.allowedVariation;
  }
  if (Object.hasOwn(input, "prohibitedRegressions")) {
    output.prohibited_regressions = input.prohibitedRegressions;
  }
  if (Object.hasOwn(input, "readinessIntent")) {
    const readiness = objectOf(input.readinessIntent);
    const isolation = readiness.isolation === null ? null : objectOf(readiness.isolation);
    output.readiness_intent = {
      side_effect_class: readiness.sideEffectClass,
      isolation: isolation === null ? null : {
        strategy: isolation.strategy,
        scope: isolation.scope,
      },
    };
  }
  return output;
}

function decodeProjection(value: JsonObject): JsonObject {
  const output: JsonObject = {};
  unpick(value, "purpose", output, "purpose");
  if (Object.hasOwn(value, "actor")) {
    const actor = objectOf(value.actor);
    output.actor = { type: actor.type, identityRef: actor.identity_ref };
  }
  if (Object.hasOwn(value, "entry_point")) {
    const entry = objectOf(value.entry_point);
    output.entryPoint = { path: entry.path, query: entry.query, fragment: entry.fragment };
  }
  if (Object.hasOwn(value, "actions")) output.actions = value.actions;
  if (Object.hasOwn(value, "checkpoints")) output.checkpoints = value.checkpoints;
  if (Object.hasOwn(value, "variables")) output.variables = value.variables;
  if (Object.hasOwn(value, "outcomes")) output.outcomes = value.outcomes;
  if (Object.hasOwn(value, "allowed_variation")) {
    output.allowedVariation = value.allowed_variation;
  }
  if (Object.hasOwn(value, "prohibited_regressions")) {
    output.prohibitedRegressions = value.prohibited_regressions;
  }
  if (Object.hasOwn(value, "readiness_intent")) {
    const readiness = objectOf(value.readiness_intent);
    const isolation = readiness.isolation === null ? null : objectOf(readiness.isolation);
    output.readinessIntent = {
      sideEffectClass: readiness.side_effect_class,
      isolation: isolation === null ? null : {
        strategy: isolation.strategy,
        scope: isolation.scope,
      },
    };
  }
  return output;
}

function encode(kind: FileKind, value: unknown): JsonObject {
  const input = objectOf(value);
  switch (kind) {
    case "beacon": {
      const output: JsonObject = {};
      pick(input, "beaconId", output, "beacon_id");
      pick(input, "title", output, "title");
      return output;
    }
    case "active": {
      const output: JsonObject = {};
      pick(input, "activeVersionId", output, "active_version");
      return output;
    }
    case "draft": {
      const output: JsonObject = {};
      pick(input, "draftId", output, "draft_id");
      pick(input, "label", output, "label");
      pick(input, "status", output, "status");
      pick(input, "revision", output, "revision");
      if (Object.hasOwn(input, "origin")) output.origin = origin(input.origin);
      if (Object.hasOwn(input, "content")) output.content = input.content;
      pick(input, "approvedVersionId", output, "approved_version_id");
      pick(input, "closedAt", output, "closed_at");
      if (Object.hasOwn(input, "idempotency")) output.idempotency = idempotency(input.idempotency);
      return output;
    }
    case "tombstone": {
      const output: JsonObject = {};
      pick(input, "draftId", output, "draft_id");
      pick(input, "label", output, "label");
      if (Object.hasOwn(input, "origin")) output.origin = origin(input.origin);
      pick(input, "finalRevision", output, "final_revision");
      pick(input, "finalHash", output, "final_hash");
      pick(input, "reason", output, "reason");
      pick(input, "abandonedAt", output, "abandoned_at");
      if (Object.hasOwn(input, "idempotency")) output.idempotency = idempotency(input.idempotency);
      return output;
    }
    case "manifest": {
      const output: JsonObject = {};
      pick(input, "versionId", output, "version_id");
      pick(input, "localNumber", output, "local_number");
      if (Object.hasOwn(input, "approval")) output.approval = approval(input.approval);
      if (Object.hasOwn(input, "provenance")) {
        const provenance = objectOf(input.provenance);
        output.provenance = {
          approved_draft_id: provenance.approvedDraftId,
          approved_revision: provenance.approvedRevision,
          branched_from_version: provenance.branchedFromVersion,
          branched_from_hash: provenance.branchedFromHash,
        };
      }
      pick(input, "supersedesVersion", output, "supersedes_version");
      if (Object.hasOwn(input, "idempotency")) output.idempotency = idempotency(input.idempotency);
      return output;
    }
    case "semantics": return projection(input) as JsonObject;
    case "revocation": {
      const output: JsonObject = {};
      pick(input, "previousStatus", output, "previous_status");
      if (Object.hasOwn(input, "revocation")) {
        const revocation = objectOf(input.revocation);
        output.revocation = {
          revoked_at: revocation.revokedAt,
          reason: revocation.reason,
          actor: revocation.actor,
        };
      }
      pick(input, "revokedAt", output, "revoked_at");
      pick(input, "reason", output, "reason");
      pick(input, "actor", output, "actor");
      if (Object.hasOwn(input, "idempotency")) output.idempotency = idempotency(input.idempotency);
      return output;
    }
    case "idempotency": {
      const output: JsonObject = {};
      pick(input, "key", output, "key");
      pick(input, "keyHash", output, "key_hash");
      pick(input, "method", output, "method");
      pick(input, "beaconId", output, "beacon_id");
      pick(input, "inputHash", output, "input_hash");
      if (Object.hasOwn(input, "result")) {
        const result = objectOf(input.result);
        output.result = {
          beacon_id: result.beaconId,
          version_id: result.versionId,
          draft_id: result.draftId,
          revision: result.revision,
        };
      }
      return output;
    }
  }
}

function decode(kind: FileKind, value: JsonObject): JsonObject {
  const output: JsonObject = {};
  switch (kind) {
    case "beacon": unpick(value, "beacon_id", output, "beaconId"); unpick(value, "title", output, "title"); return output;
    case "active": unpick(value, "active_version", output, "activeVersionId"); return output;
    case "draft": unpick(value, "draft_id", output, "draftId"); unpick(value, "label", output, "label"); unpick(value, "status", output, "status"); unpick(value, "revision", output, "revision"); if (Object.hasOwn(value, "origin")) output.origin = decodeOrigin(value.origin); if (Object.hasOwn(value, "content")) output.content = value.content; unpick(value, "approved_version_id", output, "approvedVersionId"); unpick(value, "closed_at", output, "closedAt"); if (Object.hasOwn(value, "idempotency")) output.idempotency = decodeIdempotency(value.idempotency); return output;
    case "tombstone": unpick(value, "draft_id", output, "draftId"); unpick(value, "label", output, "label"); if (Object.hasOwn(value, "origin")) output.origin = decodeOrigin(value.origin); unpick(value, "final_revision", output, "finalRevision"); unpick(value, "final_hash", output, "finalHash"); unpick(value, "reason", output, "reason"); unpick(value, "abandoned_at", output, "abandonedAt"); if (Object.hasOwn(value, "idempotency")) output.idempotency = decodeIdempotency(value.idempotency); return output;
    case "manifest": unpick(value, "version_id", output, "versionId"); unpick(value, "local_number", output, "localNumber"); if (Object.hasOwn(value, "approval")) output.approval = decodeApproval(value.approval); if (Object.hasOwn(value, "provenance")) { const provenance = objectOf(value.provenance); output.provenance = { approvedDraftId: provenance.approved_draft_id, approvedRevision: provenance.approved_revision, branchedFromVersion: provenance.branched_from_version, branchedFromHash: provenance.branched_from_hash }; } unpick(value, "supersedes_version", output, "supersedesVersion"); if (Object.hasOwn(value, "idempotency")) output.idempotency = decodeIdempotency(value.idempotency); return output;
    case "semantics": return decodeProjection(value);
    case "revocation": unpick(value, "previous_status", output, "previousStatus"); if (Object.hasOwn(value, "revocation")) { const revocation = objectOf(value.revocation); output.revocation = { revokedAt: revocation.revoked_at, reason: revocation.reason, actor: revocation.actor }; } unpick(value, "revoked_at", output, "revokedAt"); unpick(value, "reason", output, "reason"); unpick(value, "actor", output, "actor"); if (Object.hasOwn(value, "idempotency")) output.idempotency = decodeIdempotency(value.idempotency); return output;
    case "idempotency": unpick(value, "key", output, "key"); unpick(value, "key_hash", output, "keyHash"); unpick(value, "method", output, "method"); unpick(value, "beacon_id", output, "beaconId"); unpick(value, "input_hash", output, "inputHash"); if (Object.hasOwn(value, "result")) { const result = objectOf(value.result); output.result = { beaconId: result.beacon_id, versionId: result.version_id, draftId: result.draft_id, revision: result.revision }; } return output;
  }
}

export function classifyContract(value: unknown): ContractClassification {
  return typeof value === "string" && Object.values(CONTRACTS).includes(value) ? "valid" : "corrupt";
}

export function serializeRecord(kind: FileKind, value: unknown): string {
  return JSON.stringify({ contract: CONTRACTS[kind], ...encode(kind, value) }, null, 2) + "\n";
}

export function deserializeRecord(kind: FileKind, bytes: string): unknown {
  const parsed = objectOf(JSON.parse(bytes));
  if (parsed.contract !== CONTRACTS[kind]) throw new Error(`Corrupt contract: ${String(parsed.contract)}`);
  const payload = { ...parsed };
  delete payload.contract;
  return decode(kind, payload);
}

export type { SemanticProjection, SemanticSource, SemanticValue };
