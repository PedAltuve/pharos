import type { Result } from "../../shared/result.js";
import type {
  BeaconId,
  CaptureBeaconAssociation,
  CaptureId,
  CaptureRefusal,
  CaptureResolution,
  CaptureSession,
  PromotedCaptureArtifact,
  RequestId,
} from "../capture/index.js";
import type { RecorderProcessEvidence } from "../capture/types.js";
import type { ProjectId } from "../project/index.js";

export interface BeginCaptureCommand {
  readonly projectId: ProjectId;
  readonly captureId: CaptureId;
  readonly requestId: RequestId;
  readonly inputHash: string;
  readonly secretSourceReferences: readonly string[];
  readonly createdAt: string;
}
export interface CaptureResolutionDecision {
  readonly resolution: CaptureResolution;
  readonly artifact?: PromotedCaptureArtifact;
  readonly detectionCount?: number;
  /** Stable safe category only; raw capture bytes and scanner details are forbidden. */
  readonly reason?: "sensitive-content" | "scan-incomplete" | "unsafe-artifact" | "recorder-exit" | "recorder-prerequisite-or-process-failure" | "operator-cancelled" | "signal";
}
/** @deprecated Use CaptureResolutionDecision; this alias deliberately has no recordedAt field. */
export type ResolutionRecord = CaptureResolutionDecision;

export interface BeginLaunchResult {
  readonly session: CaptureSession;
  /** True only for the caller that durably initialized a new launch. */
  readonly claimed: boolean;
}
/** A different project capture is durably nonterminal and owns launch authority. */
export interface CaptureProcessStillActive {
  readonly rule: "capture-process-still-active";
  readonly captureId: CaptureId;
}
export type BeginLaunchRefusal = CaptureRefusal | CaptureProcessStillActive;
export interface CaptureProjectRecovery {
  readonly recovered: readonly Extract<CaptureSession, { status: "promoted" | "rejected" | "failed" | "interrupted" }>[];
  readonly blocked: readonly Extract<CaptureSession, { status: "launching" | "recording" }>[];
}

/** Owns supporting capture state and associations; it never owns Beacon data. */
export interface CaptureStore {
  /** Initializes and claims a durable launching session under one project lease. */
  beginLaunch(command: BeginCaptureCommand): Promise<Result<BeginLaunchResult, BeginLaunchRefusal>>;
  /** Records adapter-observed PID evidence after a claimed launch. */
  recordRecorderStarted(projectId: ProjectId, captureId: CaptureId, evidence: RecorderProcessEvidence): Promise<Result<CaptureSession, CaptureRefusal>>;
  markPostExit(projectId: ProjectId, captureId: CaptureId, exitedAt: string): Promise<Result<CaptureSession, CaptureRefusal>>;
  /** Persists and completes one normalized terminal decision under one project lease. */
  resolve(projectId: ProjectId, captureId: CaptureId, decision: CaptureResolutionDecision, completedAt: string): Promise<Result<CaptureSession, CaptureRefusal>>;
  /** Recovers project-owned durable state at a caller-supplied canonical timestamp. */
  recoverProject(projectId: ProjectId, recoveredAt: string): Promise<Result<CaptureProjectRecovery, CaptureRefusal>>;
  getSession(projectId: ProjectId, captureId: CaptureId): Promise<Result<CaptureSession, CaptureRefusal>>;
  claimAnnotation(association: CaptureBeaconAssociation): Promise<Result<CaptureBeaconAssociation, CaptureRefusal>>;
  commitAssociation(association: CaptureBeaconAssociation): Promise<Result<CaptureBeaconAssociation, CaptureRefusal>>;
  getAssociationByCapture(projectId: ProjectId, captureId: CaptureId): Promise<Result<CaptureBeaconAssociation | null, CaptureRefusal>>;
  getAssociationByBeacon(projectId: ProjectId, beaconId: BeaconId): Promise<Result<CaptureBeaconAssociation | null, CaptureRefusal>>;
}
