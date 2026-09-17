import type { Result } from "../../shared/result.js";
import type { ProjectId } from "../project/index.js";

export const CAPTURE_SESSION_CONTRACT = "pharos.capture-session/2" as const;
export const CAPTURE_ASSOCIATION_CONTRACT = "pharos.capture-beacon-association/1" as const;

export type CaptureId = `cap_${string}`;
export type BeaconId = `bcn_${string}`;
export type RequestId = `req_${string}`;
export type CaptureStatus = "pending" | "launching" | "recording" | "post_exit" | "resolving" | "promoted" | "rejected" | "failed" | "interrupted";
export type CaptureResolution = "promote" | "reject" | "fail" | "interrupt";

export interface CaptureSessionCommon {
  readonly contract: typeof CAPTURE_SESSION_CONTRACT;
  readonly projectId: ProjectId;
  readonly captureId: CaptureId;
  readonly requestId: RequestId;
  readonly inputHash: string;
  readonly secretSourceReferences: readonly string[];
  readonly createdAt: string;
}
/** A PID plus a bounded adapter-derived fingerprint for the observed recorder child. */
export interface RecorderProcessEvidence { readonly pid: number; readonly identity: string; }
/** The session exists but no recorder launch has been claimed. */
export interface PendingCaptureSession extends CaptureSessionCommon { readonly status: "pending"; }
/** Launch is claimed but no durable recorder evidence exists; recovery must not spawn or adopt a PID. */
export interface LaunchingCaptureSession extends CaptureSessionCommon { readonly status: "launching"; }
/** Durable adapter-owned recorder evidence exists and may be probed during recovery. */
export interface RecordingCaptureSession extends CaptureSessionCommon {
  readonly status: "recording";
  readonly recorder: RecorderProcessEvidence;
}
export interface PostExitCaptureSession extends CaptureSessionCommon { readonly status: "post_exit"; readonly recorderExitedAt: string; }
export interface ResolvingCaptureSession extends CaptureSessionCommon {
  readonly status: "resolving";
  readonly resolution: CaptureResolution;
  /** Durable, safe decision detail required for recovery; never raw capture bytes. */
  readonly artifact?: PromotedCaptureArtifact;
  readonly detectionCount?: number;
  readonly reason?: RejectedCaptureSession["reason"] | FailedCaptureSession["reason"] | InterruptedCaptureSession["reason"];
}
export interface PromotedCaptureArtifact { readonly reference: string; readonly byteSize: number; readonly sha256: string; }
export interface PromotedCaptureSession extends CaptureSessionCommon { readonly status: "promoted"; readonly artifact: PromotedCaptureArtifact; readonly completedAt: string; }
export interface RejectedCaptureSession extends CaptureSessionCommon { readonly status: "rejected"; readonly reason: "sensitive-content" | "scan-incomplete" | "unsafe-artifact"; readonly detectionCount: number; readonly completedAt: string; }
export interface FailedCaptureSession extends CaptureSessionCommon { readonly status: "failed"; readonly reason: "recorder-exit" | "recorder-prerequisite-or-process-failure"; readonly completedAt: string; }
export interface InterruptedCaptureSession extends CaptureSessionCommon { readonly status: "interrupted"; readonly reason: "operator-cancelled" | "signal"; readonly completedAt: string; }

export type CaptureSession = PendingCaptureSession | LaunchingCaptureSession | RecordingCaptureSession | PostExitCaptureSession | ResolvingCaptureSession | PromotedCaptureSession | RejectedCaptureSession | FailedCaptureSession | InterruptedCaptureSession;

export interface CaptureNotFound { readonly rule: "capture-not-found"; readonly captureId: CaptureId; }
export interface CaptureNotPromoted { readonly rule: "capture-not-promoted"; readonly captureId: CaptureId; readonly status: Exclude<CaptureStatus, "promoted">; }
export interface CaptureRequestConflict { readonly rule: "capture-request-conflict"; readonly requestId: RequestId; }
export interface CaptureAssociationConflict { readonly rule: "capture-association-conflict"; readonly captureId: CaptureId; }
export interface CaptureResolutionConflict { readonly rule: "capture-resolution-conflict"; readonly captureId: CaptureId; }
export interface CaptureStoreCorruption { readonly rule: "capture-store-corruption"; readonly captureId: CaptureId; }
export interface CaptureIllegalTransition {
  readonly rule: "capture-illegal-transition";
  readonly captureId: CaptureId;
  readonly from: CaptureStatus;
  readonly to: "launching" | "recording" | "post_exit" | "resolving" | "terminal";
}
export type CaptureRefusal = CaptureNotFound | CaptureNotPromoted | CaptureRequestConflict | CaptureAssociationConflict | CaptureResolutionConflict | CaptureStoreCorruption | CaptureIllegalTransition;

export interface CaptureBeaconAssociation {
  readonly contract: typeof CAPTURE_ASSOCIATION_CONTRACT;
  readonly state: "pending" | "committed";
  readonly projectId: ProjectId;
  readonly captureId: CaptureId;
  readonly requestId: RequestId;
  readonly inputHash: string;
  readonly beaconId: BeaconId;
  readonly draftId: `drf_${string}`;
  readonly revision: 1;
  readonly semanticHash?: string;
  readonly createdAt: string;
  readonly committedAt?: string;
}

export type AnnotationEligibility = Result<PromotedCaptureSession, CaptureNotPromoted>;
