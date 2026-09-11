import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, open, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import type {
  BeaconId,
  CaptureBeaconAssociation,
  CaptureId,
  CaptureRefusal,
  CaptureResolution,
  CaptureSession,
  PromotedCaptureArtifact,
  RequestId,
} from "../../domain/capture/index.js";
import type { CaptureSessionCommon } from "../../domain/capture/types.js";
import type { ProjectId } from "../../domain/project/index.js";
import { CAPTURE_SESSION_CONTRACT, isCaptureId } from "../../domain/capture/index.js";
import { isProjectId } from "../../domain/project/index.js";
import type { BeginCaptureCommand, CaptureStore, ResolutionRecord } from "../../domain/ports/capture-store.js";
import { err, ok, type Result } from "../../shared/result.js";
import { ensurePrivateDirectory, isErrno, readJson, writePrivateJson } from "../fs-project/filesystem.js";
import { ProjectLock } from "../fs-project/project-lock.js";

const STAGED_RECORDING = "recording.spec.ts";
const PROMOTED_RECORDING = "recording.spec.ts";
const SHA256 = /^[a-f0-9]{64}$/;

type TerminalCaptureStatus = "promoted" | "rejected" | "failed" | "interrupted";
type StoredRequest = BeginCaptureCommand & {
  readonly completion?: { readonly status: TerminalCaptureStatus; readonly captureId: CaptureId };
};
type ResolvingDetails = {
  readonly resolution: CaptureResolution;
  readonly artifact?: PromotedCaptureArtifact;
  readonly detectionCount?: number;
  readonly reason?: "sensitive-content" | "scan-incomplete" | "unsafe-artifact" | "recorder-exit" | "recorder-prerequisite-or-process-failure" | "operator-cancelled" | "signal";
};
type StoredResolving = Extract<CaptureSession, { status: "resolving" }> & ResolvingDetails;

export type CaptureStoreStage =
  | "before-session-write"
  | "session-written"
  | "resolution-decision-recorded"
  | "promoted-materialized"
  | "stage-unlinked"
  | "journal-completed"
  | "association-capture-written"
  | "association-beacon-written";

export interface CaptureStoreObserver {
  onStage(stage: CaptureStoreStage, captureId: CaptureId): void | Promise<void>;
}

export interface FsCaptureStoreOptions {
  readonly projectRoot: string;
  readonly lock?: ProjectLock;
  readonly observer?: CaptureStoreObserver;
}

function requestHash(requestId: RequestId): string {
  return createHash("sha256").update(requestId).digest("hex");
}

function sameRequest(left: StoredRequest, right: BeginCaptureCommand): boolean {
  return left.projectId === right.projectId
    && left.captureId === right.captureId
    && left.requestId === right.requestId
    && left.inputHash === right.inputHash
    && left.createdAt === right.createdAt
    && left.secretSourceReferences.length === right.secretSourceReferences.length
    && left.secretSourceReferences.every((value, index) => value === right.secretSourceReferences[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function captureRefusal(captureId: CaptureId): Result<never, CaptureRefusal> {
  return err({ rule: "capture-store-corruption", captureId });
}

const UUID_V7 = "[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const requestIdPattern = new RegExp(`^req_${UUID_V7}$`);
const secretReferencePattern = /^env:[A-Za-z_][A-Za-z0-9_]*$/;

function hasOnlyKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(record).length === keys.length && Object.keys(record).every((key) => keys.includes(key));
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const date = new Date(value);
  return !Number.isNaN(date.valueOf()) && date.toISOString() === value;
}

function isRequestId(value: unknown): value is RequestId {
  return typeof value === "string" && requestIdPattern.test(value);
}

function isSafeSecretReference(value: unknown): value is string {
  return typeof value === "string" && secretReferencePattern.test(value);
}

function isSafeSecretReferences(value: unknown): value is readonly string[] {
  if (!Array.isArray(value)) return false;
  const references: string[] = [];
  for (const item of value) {
    if (!isSafeSecretReference(item)) return false;
    references.push(item);
  }
  return new Set(references).size === references.length;
}

function isTerminalStatus(value: unknown): value is TerminalCaptureStatus {
  return value === "promoted" || value === "rejected" || value === "failed" || value === "interrupted";
}

function requestFrom(value: unknown, captureId: CaptureId, requestId?: RequestId): StoredRequest | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, value.completion === undefined
    ? ["projectId", "captureId", "requestId", "inputHash", "secretSourceReferences", "createdAt"]
    : ["projectId", "captureId", "requestId", "inputHash", "secretSourceReferences", "createdAt", "completion"])
    || value.captureId !== captureId
    || typeof value.projectId !== "string" || !isProjectId(value.projectId)
    || !isRequestId(value.requestId) || (requestId !== undefined && value.requestId !== requestId)
    || typeof value.inputHash !== "string" || value.inputHash.trim().length === 0
    || !isSafeSecretReferences(value.secretSourceReferences)
    || !isCanonicalTimestamp(value.createdAt)) return undefined;
  const request: BeginCaptureCommand = {
    projectId: value.projectId,
    captureId,
    requestId: value.requestId,
    inputHash: value.inputHash,
    secretSourceReferences: value.secretSourceReferences,
    createdAt: value.createdAt,
  };
  if (value.completion === undefined) return request;
  if (!isRecord(value.completion)
    || !hasOnlyKeys(value.completion, ["status", "captureId"])
    || !isTerminalStatus(value.completion.status)
    || value.completion.captureId !== captureId) return undefined;
  return { ...request, completion: { status: value.completion.status, captureId } };
}

function isSafeArtifact(value: unknown, captureId: CaptureId): value is PromotedCaptureArtifact {
  return isRecord(value)
    && hasOnlyKeys(value, ["reference", "byteSize", "sha256"])
    && value.reference === `captures/${captureId}/${PROMOTED_RECORDING}`
    && typeof value.byteSize === "number"
    && Number.isSafeInteger(value.byteSize)
    && value.byteSize >= 0
    && typeof value.sha256 === "string"
    && SHA256.test(value.sha256);
}

function commonFrom(value: Record<string, unknown>, captureId: CaptureId): CaptureSessionCommon | undefined {
  if (
    value.contract !== CAPTURE_SESSION_CONTRACT
    || value.captureId !== captureId
    || typeof value.projectId !== "string" || !isProjectId(value.projectId)
    || !isRequestId(value.requestId)
    || typeof value.inputHash !== "string" || value.inputHash.length === 0
    || !isSafeSecretReferences(value.secretSourceReferences)
    || !isCanonicalTimestamp(value.createdAt)
  ) return undefined;
  return {
    contract: CAPTURE_SESSION_CONTRACT,
    projectId: value.projectId,
    captureId,
    requestId: value.requestId,
    inputHash: value.inputHash,
    secretSourceReferences: value.secretSourceReferences,
    createdAt: value.createdAt,
  };
}

function sessionFrom(value: unknown, captureId: CaptureId): Result<CaptureSession, CaptureRefusal> {
  if (!isRecord(value) || typeof value.status !== "string") return captureRefusal(captureId);
  const common = commonFrom(value, captureId);
  if (common === undefined) return captureRefusal(captureId);
  const commonKeys = ["contract", "projectId", "captureId", "requestId", "inputHash", "secretSourceReferences", "createdAt", "status"];
  if (value.status === "running" && hasOnlyKeys(value, commonKeys)) return ok({ ...common, status: "running" });
  if (value.status === "post_exit" && hasOnlyKeys(value, [...commonKeys, "recorderExitedAt"]) && isCanonicalTimestamp(value.recorderExitedAt)) {
    return ok({ ...common, status: "post_exit", recorderExitedAt: value.recorderExitedAt });
  }
  if (value.status === "resolving") {
    if (value.resolution === "promote" && hasOnlyKeys(value, [...commonKeys, "resolution", "artifact"]) && isSafeArtifact(value.artifact, captureId)) {
      return ok({ ...common, status: "resolving", resolution: "promote", artifact: value.artifact });
    }
    if (value.resolution === "reject" && hasOnlyKeys(value, [...commonKeys, "resolution", "reason", "detectionCount"])
      && (value.reason === "sensitive-content" || value.reason === "scan-incomplete" || value.reason === "unsafe-artifact")
      && typeof value.detectionCount === "number" && Number.isSafeInteger(value.detectionCount) && value.detectionCount >= 0) {
      return ok({ ...common, status: "resolving", resolution: "reject", reason: value.reason, detectionCount: value.detectionCount });
    }
    if (value.resolution === "fail" && hasOnlyKeys(value, [...commonKeys, "resolution", "reason"])
      && (value.reason === "recorder-exit" || value.reason === "recorder-prerequisite-or-process-failure")) {
      return ok({ ...common, status: "resolving", resolution: "fail", reason: value.reason });
    }
    if (value.resolution === "interrupt" && hasOnlyKeys(value, [...commonKeys, "resolution", "reason"])
      && (value.reason === "operator-cancelled" || value.reason === "signal")) {
      return ok({ ...common, status: "resolving", resolution: "interrupt", reason: value.reason });
    }
  }
  if (value.status === "promoted" && hasOnlyKeys(value, [...commonKeys, "artifact", "completedAt"])
    && isSafeArtifact(value.artifact, captureId) && isCanonicalTimestamp(value.completedAt)) {
    return ok({ ...common, status: "promoted", artifact: value.artifact, completedAt: value.completedAt });
  }
  if (value.status === "rejected" && hasOnlyKeys(value, [...commonKeys, "reason", "detectionCount", "completedAt"])
    && (value.reason === "sensitive-content" || value.reason === "scan-incomplete" || value.reason === "unsafe-artifact")
    && typeof value.detectionCount === "number" && Number.isSafeInteger(value.detectionCount) && value.detectionCount >= 0 && isCanonicalTimestamp(value.completedAt)) {
    return ok({ ...common, status: "rejected", reason: value.reason, detectionCount: value.detectionCount, completedAt: value.completedAt });
  }
  if (value.status === "failed" && hasOnlyKeys(value, [...commonKeys, "reason", "completedAt"])
    && (value.reason === "recorder-exit" || value.reason === "recorder-prerequisite-or-process-failure") && isCanonicalTimestamp(value.completedAt)) {
    return ok({ ...common, status: "failed", reason: value.reason, completedAt: value.completedAt });
  }
  if (value.status === "interrupted" && hasOnlyKeys(value, [...commonKeys, "reason", "completedAt"])
    && (value.reason === "operator-cancelled" || value.reason === "signal") && isCanonicalTimestamp(value.completedAt)) {
    return ok({ ...common, status: "interrupted", reason: value.reason, completedAt: value.completedAt });
  }
  return captureRefusal(captureId);
}

function commonOf(session: CaptureSession): CaptureSessionCommon {
  return {
    contract: session.contract,
    projectId: session.projectId,
    captureId: session.captureId,
    requestId: session.requestId,
    inputHash: session.inputHash,
    secretSourceReferences: session.secretSourceReferences,
    createdAt: session.createdAt,
  };
}

function transitionRefusal(captureId: CaptureId, from: CaptureSession["status"], to: "post_exit" | "resolving" | "terminal"): Result<never, CaptureRefusal> {
  return err({ rule: "capture-illegal-transition", captureId, from, to });
}

function detailFor(record: ResolutionRecord, captureId: CaptureId): Result<ResolvingDetails, CaptureRefusal> {
  if (record.resolution === "promote") {
    if (record.artifact === undefined || !isSafeArtifact(record.artifact, captureId)) return captureRefusal(captureId);
    return ok({ resolution: "promote", artifact: record.artifact });
  }
  if (record.resolution === "reject") {
    const reason = record.reason ?? "sensitive-content";
    if (!(reason === "sensitive-content" || reason === "scan-incomplete" || reason === "unsafe-artifact")
      || !Number.isSafeInteger(record.detectionCount ?? 0) || (record.detectionCount ?? 0) < 0) return captureRefusal(captureId);
    return ok({ resolution: "reject", detectionCount: record.detectionCount ?? 0, reason });
  }
  if (record.resolution === "fail") {
    const reason = record.reason ?? "recorder-prerequisite-or-process-failure";
    return reason === "recorder-exit" || reason === "recorder-prerequisite-or-process-failure"
      ? ok({ resolution: "fail", reason }) : captureRefusal(captureId);
  }
  const reason = record.reason ?? "operator-cancelled";
  return reason === "operator-cancelled" || reason === "signal"
    ? ok({ resolution: "interrupt", reason }) : captureRefusal(captureId);
}

const beaconIdPattern = new RegExp(`^bcn_${UUID_V7}$`);
const draftIdPattern = new RegExp(`^drf_${UUID_V7}$`);

function isBeaconId(value: unknown): value is BeaconId {
  return typeof value === "string" && beaconIdPattern.test(value);
}

function isDraftId(value: unknown): value is `drf_${string}` {
  return typeof value === "string" && draftIdPattern.test(value);
}

function associationCaptureId(value: unknown, expectedCaptureId?: CaptureId): CaptureId {
  return expectedCaptureId ?? (typeof value === "string" && isCaptureId(value) ? value : "cap_invalid" as CaptureId);
}

function associationFrom(value: unknown, expectedCaptureId?: CaptureId, expectedBeaconId?: BeaconId): Result<CaptureBeaconAssociation, CaptureRefusal> {
  const rawCaptureId = isRecord(value) ? value.captureId : undefined;
  const refusal = () => captureRefusal(associationCaptureId(rawCaptureId, expectedCaptureId));
  if (!isRecord(value)
    || value.contract !== "pharos.capture-beacon-association/1"
    || (value.state !== "pending" && value.state !== "committed")
    || typeof value.projectId !== "string" || !isProjectId(value.projectId)
    || typeof value.captureId !== "string" || !isCaptureId(value.captureId) || (expectedCaptureId !== undefined && value.captureId !== expectedCaptureId)
    || !isRequestId(value.requestId)
    || typeof value.inputHash !== "string" || value.inputHash.trim().length === 0
    || !isBeaconId(value.beaconId) || (expectedBeaconId !== undefined && value.beaconId !== expectedBeaconId)
    || !isDraftId(value.draftId)
    || value.revision !== 1
    || !isCanonicalTimestamp(value.createdAt)) return refusal();
  if (value.state === "pending") {
    if (!hasOnlyKeys(value, ["contract", "state", "projectId", "captureId", "requestId", "inputHash", "beaconId", "draftId", "revision", "createdAt"])) return refusal();
    return ok({ contract: "pharos.capture-beacon-association/1", state: "pending", projectId: value.projectId, captureId: value.captureId, requestId: value.requestId, inputHash: value.inputHash, beaconId: value.beaconId, draftId: value.draftId, revision: 1, createdAt: value.createdAt });
  }
  if (!hasOnlyKeys(value, ["contract", "state", "projectId", "captureId", "requestId", "inputHash", "beaconId", "draftId", "revision", "semanticHash", "createdAt", "committedAt"])
    || typeof value.semanticHash !== "string" || value.semanticHash.trim().length === 0
    || !isCanonicalTimestamp(value.committedAt)) return refusal();
  return ok({ contract: "pharos.capture-beacon-association/1", state: "committed", projectId: value.projectId, captureId: value.captureId, requestId: value.requestId, inputHash: value.inputHash, beaconId: value.beaconId, draftId: value.draftId, revision: 1, semanticHash: value.semanticHash, createdAt: value.createdAt, committedAt: value.committedAt });
}

function sameAssociationClaim(left: CaptureBeaconAssociation, right: CaptureBeaconAssociation): boolean {
  return left.contract === right.contract
    && left.projectId === right.projectId
    && left.captureId === right.captureId
    && left.requestId === right.requestId
    && left.inputHash === right.inputHash
    && left.beaconId === right.beaconId
    && left.draftId === right.draftId
    && left.revision === right.revision
    && left.createdAt === right.createdAt;
}

function sameAssociation(left: CaptureBeaconAssociation, right: CaptureBeaconAssociation): boolean {
  return sameAssociationClaim(left, right)
    && left.state === right.state
    && left.semanticHash === right.semanticHash
    && left.committedAt === right.committedAt;
}

/** Filesystem owner for non-authoritative capture state. It never reads or writes BeaconStore data. */
export class FsCaptureStore implements CaptureStore {
  private readonly projectRoot: string;
  private readonly lock: ProjectLock;
  private readonly observer?: CaptureStoreObserver;

  constructor(options: FsCaptureStoreOptions) {
    this.projectRoot = options.projectRoot;
    this.lock = options.lock ?? new ProjectLock(options.projectRoot);
    this.observer = options.observer;
  }

  async begin(command: BeginCaptureCommand): Promise<Result<CaptureSession, CaptureRefusal>> {
    if (!isCaptureId(command.captureId)) return err({ rule: "capture-not-found", captureId: command.captureId });
    await this.prepare();
    const acquired = await this.lock.acquire();
    if (!acquired.ok) throw new Error("capture project lock is unavailable");
    try {
      const requested = requestFrom(command, command.captureId, command.requestId);
      if (requested === undefined) return captureRefusal(command.captureId);
      const requestPath = this.requestPath(command.requestId);
      const existingRequest = await this.readRequest(requestPath, command.captureId, command.requestId);
      if (!existingRequest.ok) return existingRequest;
      if (existingRequest.value !== null) {
        if (!sameRequest(existingRequest.value, command)) {
          return err({ rule: "capture-request-conflict", requestId: command.requestId });
        }
        const stored = await this.getSessionUnlocked(command.captureId);
        if (stored.ok) {
          if (existingRequest.value.completion !== undefined && existingRequest.value.completion.status !== stored.value.status) return captureRefusal(command.captureId);
          return stored;
        }
        if (stored.error.rule !== "capture-not-found") return stored;
        if (existingRequest.value.completion !== undefined) return captureRefusal(command.captureId);
      }
      await writePrivateJson(requestPath, requested);
      await ensurePrivateDirectory(this.stageDirectory(command.captureId));
      const session: CaptureSession = { ...command, contract: CAPTURE_SESSION_CONTRACT, status: "running" };
      await this.writeSession(session);
      return ok(session);
    } finally {
      await this.lock.release();
    }
  }

  async markPostExit(projectId: ProjectId, captureId: CaptureId, exitedAt: string): Promise<Result<CaptureSession, CaptureRefusal>> {
    return this.mutate(captureId, async (session) => {
      if (session.projectId !== projectId) return captureRefusal(captureId);
      if (session.status !== "running") return transitionRefusal(captureId, session.status, "post_exit");
      const next: CaptureSession = { ...commonOf(session), status: "post_exit", recorderExitedAt: exitedAt };
      await this.writeSession(next);
      return ok(next);
    });
  }

  async recordResolution(projectId: ProjectId, captureId: CaptureId, record: ResolutionRecord): Promise<Result<CaptureSession, CaptureRefusal>> {
    return this.mutate(captureId, async (session) => {
      if (session.projectId !== projectId) return captureRefusal(captureId);
      const allowed = (record.resolution === "promote" || record.resolution === "reject")
        ? session.status === "post_exit"
        : session.status === "running";
      if (!allowed) return transitionRefusal(captureId, session.status, "resolving");
      const details = detailFor(record, captureId);
      if (!details.ok) return details;
      const next: StoredResolving = { ...commonOf(session), status: "resolving", ...details.value };
      await this.writeSession(next);
      await this.notify("resolution-decision-recorded", captureId);
      return ok(next);
    });
  }

  async finishResolution(projectId: ProjectId, captureId: CaptureId, completedAt: string): Promise<Result<CaptureSession, CaptureRefusal>> {
    if (!isCanonicalTimestamp(completedAt)) return captureRefusal(captureId);
    return this.mutate(captureId, async (session) => {
      if (session.projectId !== projectId) return captureRefusal(captureId);
      if (session.status !== "resolving") return transitionRefusal(captureId, session.status, "terminal");
      const resolving = session as StoredResolving;
      const next = await this.completeResolution(resolving, completedAt);
      if (!next.ok) return next;
      await this.writeSession(next.value);
      const completion = await this.writeRequestCompletion(next.value);
      if (!completion.ok) return completion;
      return next;
    });
  }

  async recover(projectId: ProjectId): Promise<Result<readonly CaptureSession[], CaptureRefusal>> {
    await this.prepare();
    const acquired = await this.lock.acquire();
    if (!acquired.ok) throw new Error("capture project lock is unavailable");
    try {
      await this.sweepStaleTemps();
      const captures = await this.captureIds();
      const recovered: CaptureSession[] = [];
      for (const captureId of captures) {
        const read = await this.getSessionUnlocked(captureId);
        if (!read.ok) return read;
        if (read.value.projectId !== projectId) continue;
        if (read.value.status !== "resolving") continue;
        const finished = await this.completeResolution(read.value as StoredResolving, new Date().toISOString());
        if (!finished.ok) return finished;
        await this.writeSession(finished.value);
        const completion = await this.writeRequestCompletion(finished.value);
        if (!completion.ok) return completion;
        recovered.push(finished.value);
      }
      return ok(recovered);
    } finally {
      await this.lock.release();
    }
  }

  async getSession(projectId: ProjectId, captureId: CaptureId): Promise<Result<CaptureSession, CaptureRefusal>> {
    const session = await this.getSessionUnlocked(captureId);
    if (!session.ok || session.value.projectId === projectId) return session;
    return captureRefusal(captureId);
  }

  async claimAnnotation(association: CaptureBeaconAssociation): Promise<Result<CaptureBeaconAssociation, CaptureRefusal>> {
    return this.writeAssociation(association, "pending");
  }

  async commitAssociation(association: CaptureBeaconAssociation): Promise<Result<CaptureBeaconAssociation, CaptureRefusal>> {
    return this.writeAssociation({ ...association, state: "committed" }, "committed");
  }

  async getAssociationByCapture(projectId: ProjectId, captureId: CaptureId): Promise<Result<CaptureBeaconAssociation | null, CaptureRefusal>> {
    const forward = await this.readAssociationFile(this.captureAssociationPath(captureId), projectId, captureId);
    if (!forward.ok || forward.value === null) return forward;
    const reverse = await this.readAssociationFile(this.beaconAssociationPath(forward.value.beaconId), projectId, captureId, forward.value.beaconId);
    if (!reverse.ok || reverse.value === null || !sameAssociation(forward.value, reverse.value)) return captureRefusal(captureId);
    return forward;
  }

  async getAssociationByBeacon(projectId: ProjectId, beaconId: BeaconId): Promise<Result<CaptureBeaconAssociation | null, CaptureRefusal>> {
    const reverse = await this.readAssociationFile(this.beaconAssociationPath(beaconId), projectId, undefined, beaconId);
    if (!reverse.ok || reverse.value === null) return reverse;
    const forward = await this.readAssociationFile(this.captureAssociationPath(reverse.value.captureId), projectId, reverse.value.captureId, beaconId);
    if (!forward.ok || forward.value === null || !sameAssociation(reverse.value, forward.value)) return captureRefusal(reverse.value.captureId);
    return reverse;
  }

  private async completeResolution(session: StoredResolving, completedAt: string): Promise<Result<CaptureSession, CaptureRefusal>> {
    if (session.resolution === "promote") {
      if (session.artifact === undefined) return captureRefusal(session.captureId);
      const promotion = await this.promote(session.captureId, session.artifact);
      if (!promotion.ok) return promotion;
      return ok({ ...commonOf(session), status: "promoted", artifact: session.artifact, completedAt });
    }
    await this.removeStage(session.captureId);
    if (session.resolution === "reject") return ok({ ...commonOf(session), status: "rejected", reason: session.reason as "sensitive-content" | "scan-incomplete" | "unsafe-artifact", detectionCount: session.detectionCount as number, completedAt });
    if (session.resolution === "fail") return ok({ ...commonOf(session), status: "failed", reason: session.reason as "recorder-exit" | "recorder-prerequisite-or-process-failure", completedAt });
    return ok({ ...commonOf(session), status: "interrupted", reason: session.reason as "operator-cancelled" | "signal", completedAt });
  }

  private async promote(captureId: CaptureId, artifact: PromotedCaptureArtifact): Promise<Result<void, CaptureRefusal>> {
    const staged = join(this.stageDirectory(captureId), STAGED_RECORDING);
    const destination = join(this.captureDirectory(captureId), PROMOTED_RECORDING);
    try {
      await lstat(staged);
    } catch (error) {
      if (!isErrno(error, "ENOENT")) throw error;
      return this.verifyDestination(destination, artifact, captureId);
    }
    const stageInfo = await this.regularFile(staged, captureId);
    if (!stageInfo.ok) return stageInfo;
    const digest = await this.digest(staged);
    if (digest.sha256 !== artifact.sha256 || digest.byteSize !== artifact.byteSize) return captureRefusal(captureId);
    let linked = false;
    try {
      await link(staged, destination);
      linked = true;
      await this.notify("promoted-materialized", captureId);
    } catch (error) {
      if (!isErrno(error, "EEXIST")) throw error;
    }
    const verified = await this.verifyDestination(destination, artifact, captureId);
    if (!verified.ok) {
      if (linked) await unlink(destination);
      return verified;
    }
    await this.removeStage(captureId);
    return ok(undefined);
  }

  private async verifyDestination(destination: string, artifact: PromotedCaptureArtifact, captureId: CaptureId): Promise<Result<void, CaptureRefusal>> {
    const existing = await this.regularFile(destination, captureId);
    if (!existing.ok) return existing;
    const existingDigest = await this.digest(destination);
    return existingDigest.sha256 === artifact.sha256 && existingDigest.byteSize === artifact.byteSize
      ? ok(undefined)
      : captureRefusal(captureId);
  }

  private async removeStage(captureId: CaptureId): Promise<void> {
    const path = join(this.stageDirectory(captureId), STAGED_RECORDING);
    try {
      await unlink(path);
      await this.notify("stage-unlinked", captureId);
    } catch (error) { if (!isErrno(error, "ENOENT")) throw error; }
    const directory = await open(this.stageDirectory(captureId), "r");
    try { await directory.sync(); } finally { await directory.close(); }
  }

  private async regularFile(path: string, captureId: CaptureId): Promise<Result<void, CaptureRefusal>> {
    try {
      const stat = await lstat(path);
      if (stat.isSymbolicLink() || !stat.isFile()) return captureRefusal(captureId);
      const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try { if (!(await handle.stat()).isFile()) return captureRefusal(captureId); } finally { await handle.close(); }
      return ok(undefined);
    } catch { return captureRefusal(captureId); }
  }

  private async digest(path: string): Promise<{ sha256: string; byteSize: number }> {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const bytes = await handle.readFile();
      return { sha256: createHash("sha256").update(bytes).digest("hex"), byteSize: bytes.byteLength };
    } finally { await handle.close(); }
  }

  private async mutate(captureId: CaptureId, operation: (session: CaptureSession) => Promise<Result<CaptureSession, CaptureRefusal>>): Promise<Result<CaptureSession, CaptureRefusal>> {
    await this.prepare();
    const acquired = await this.lock.acquire();
    if (!acquired.ok) throw new Error("capture project lock is unavailable");
    try {
      const session = await this.getSessionUnlocked(captureId);
      return session.ok ? operation(session.value) : session;
    } finally { await this.lock.release(); }
  }

  private async prepare(): Promise<void> {
    await ensurePrivateDirectory(this.projectRoot);
    await ensurePrivateDirectory(join(this.projectRoot, "capture-journal"));
    await ensurePrivateDirectory(join(this.projectRoot, "capture-journal", "requests"));
    await ensurePrivateDirectory(join(this.projectRoot, "capture-staging"));
    await ensurePrivateDirectory(join(this.projectRoot, "captures"));
    await ensurePrivateDirectory(join(this.projectRoot, "capture-associations"));
    await ensurePrivateDirectory(join(this.projectRoot, "capture-associations", "by-capture"));
    await ensurePrivateDirectory(join(this.projectRoot, "capture-associations", "by-beacon"));
  }

  private requestPath(requestId: RequestId): string { return join(this.projectRoot, "capture-journal", "requests", `${requestHash(requestId)}.json`); }
  private captureDirectory(captureId: CaptureId): string { return join(this.projectRoot, "captures", captureId); }
  private stageDirectory(captureId: CaptureId): string { return join(this.projectRoot, "capture-staging", captureId); }
  private sessionPath(captureId: CaptureId): string { return join(this.captureDirectory(captureId), "session.json"); }
  private captureAssociationPath(captureId: CaptureId): string { return join(this.projectRoot, "capture-associations", "by-capture", `${captureId}.json`); }
  private beaconAssociationPath(beaconId: BeaconId): string { return join(this.projectRoot, "capture-associations", "by-beacon", `${beaconId}.json`); }

  private async writeSession(session: CaptureSession): Promise<void> {
    await ensurePrivateDirectory(this.captureDirectory(session.captureId));
    await this.notify("before-session-write", session.captureId);
    await writePrivateJson(this.sessionPath(session.captureId), session);
    await this.notify("session-written", session.captureId);
  }

  private async getSessionUnlocked(captureId: CaptureId): Promise<Result<CaptureSession, CaptureRefusal>> {
    if (!isCaptureId(captureId)) return err({ rule: "capture-not-found", captureId });
    try { return sessionFrom(await readJson(this.sessionPath(captureId)), captureId); }
    catch (error) { return isErrno(error, "ENOENT") ? err({ rule: "capture-not-found", captureId }) : captureRefusal(captureId); }
  }

  private async readRequest(path: string, captureId: CaptureId, requestId: RequestId): Promise<Result<StoredRequest | null, CaptureRefusal>> {
    try {
      const parsed = requestFrom(await readJson(path), captureId, requestId);
      return parsed === undefined ? captureRefusal(captureId) : ok(parsed);
    } catch (error) {
      return isErrno(error, "ENOENT") ? ok(null) : captureRefusal(captureId);
    }
  }

  private async writeRequestCompletion(session: CaptureSession): Promise<Result<void, CaptureRefusal>> {
    const path = this.requestPath(session.requestId);
    const request = await this.readRequest(path, session.captureId, session.requestId);
    if (!request.ok || request.value === null || !isTerminalStatus(session.status)) return captureRefusal(session.captureId);
    if (request.value.completion !== undefined && request.value.completion.status !== session.status) return captureRefusal(session.captureId);
    await writePrivateJson(path, { ...request.value, completion: { status: session.status, captureId: session.captureId } });
    await this.notify("journal-completed", session.captureId);
    return ok(undefined);
  }

  private async captureIds(): Promise<CaptureId[]> {
    const entries = await readdir(join(this.projectRoot, "captures"), { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory() && isCaptureId(entry.name)).map((entry) => entry.name as CaptureId).sort();
  }

  /** Sweep only old regular sibling temporaries while holding the project lock. */
  private async sweepStaleTemps(): Promise<void> {
    const roots = [
      join(this.projectRoot, "capture-journal"),
      join(this.projectRoot, "capture-staging"),
      join(this.projectRoot, "captures"),
      join(this.projectRoot, "capture-associations"),
    ];
    for (const root of roots) await this.sweepDirectory(root);
  }

  private async sweepDirectory(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const stat = await lstat(path);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        await this.sweepDirectory(path);
      } else if (stat.isFile() && entry.name.includes(".tmp.") && Date.now() - stat.mtimeMs >= this.lock.staleAfterMs) {
        await unlink(path);
      }
    }
  }

  private async writeAssociation(association: CaptureBeaconAssociation, expectedState: "pending" | "committed"): Promise<Result<CaptureBeaconAssociation, CaptureRefusal>> {
    await this.prepare();
    const requested = associationFrom(association, association.captureId, association.beaconId);
    if (!requested.ok || requested.value.state !== expectedState) return captureRefusal(association.captureId);
    const acquired = await this.lock.acquire();
    if (!acquired.ok) throw new Error("capture project lock is unavailable");
    try {
      const forward = await this.readAssociationFile(this.captureAssociationPath(association.captureId), association.projectId, association.captureId, association.beaconId);
      if (!forward.ok) return forward;
      const reverse = await this.readAssociationFile(this.beaconAssociationPath(association.beaconId), association.projectId, undefined, association.beaconId);
      if (!reverse.ok) return reverse;
      for (const existing of [forward.value, reverse.value]) {
        if (existing !== null && !sameAssociationClaim(existing, requested.value)) {
          return err({ rule: "capture-association-conflict", captureId: association.captureId });
        }
      }

      const existing = [forward.value, reverse.value].filter((value): value is CaptureBeaconAssociation => value !== null);
      const committed = existing.find((value) => value.state === "committed");
      if (committed !== undefined && !sameAssociation(committed, requested.value) && expectedState === "committed") {
        return err({ rule: "capture-association-conflict", captureId: association.captureId });
      }
      if (forward.value !== null && reverse.value !== null && forward.value.state === reverse.value.state && !sameAssociation(forward.value, reverse.value)) {
        return err({ rule: "capture-association-conflict", captureId: association.captureId });
      }

      const target = committed ?? requested.value;
      if (!sameAssociationClaim(target, requested.value)) return err({ rule: "capture-association-conflict", captureId: association.captureId });
      if (forward.value === null || !sameAssociation(forward.value, target)) {
        await writePrivateJson(this.captureAssociationPath(target.captureId), target);
        await this.notify("association-capture-written", target.captureId);
      }
      if (reverse.value === null || !sameAssociation(reverse.value, target)) {
        await writePrivateJson(this.beaconAssociationPath(target.beaconId), target);
        await this.notify("association-beacon-written", target.captureId);
      }
      return ok(target);
    } finally { await this.lock.release(); }
  }

  private async notify(stage: CaptureStoreStage, captureId: CaptureId): Promise<void> {
    await this.observer?.onStage(stage, captureId);
  }

  private async readAssociationFile(path: string, projectId: ProjectId, captureId?: CaptureId, beaconId?: BeaconId): Promise<Result<CaptureBeaconAssociation | null, CaptureRefusal>> {
    try {
      const parsed = associationFrom(await readJson(path), captureId, beaconId);
      if (!parsed.ok || parsed.value.projectId !== projectId) return captureRefusal(captureId ?? (parsed.ok ? parsed.value.captureId : "cap_invalid" as CaptureId));
      return parsed;
    } catch (error) {
      return isErrno(error, "ENOENT") ? ok(null) : captureRefusal(captureId ?? "cap_invalid" as CaptureId);
    }
  }
}
