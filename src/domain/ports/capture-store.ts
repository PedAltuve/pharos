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
import type { ProjectId } from "../project/index.js";

export interface BeginCaptureCommand {
  readonly projectId: ProjectId;
  readonly captureId: CaptureId;
  readonly requestId: RequestId;
  readonly inputHash: string;
  readonly secretSourceReferences: readonly string[];
  readonly createdAt: string;
}
export interface ResolutionRecord { readonly resolution: CaptureResolution; readonly recordedAt: string; readonly artifact?: PromotedCaptureArtifact; readonly detectionCount?: number; }

/** Owns supporting capture state and associations; it never owns Beacon data. */
export interface CaptureStore {
  begin(command: BeginCaptureCommand): Promise<Result<CaptureSession, CaptureRefusal>>;
  markPostExit(projectId: ProjectId, captureId: CaptureId, exitedAt: string): Promise<Result<CaptureSession, CaptureRefusal>>;
  recordResolution(projectId: ProjectId, captureId: CaptureId, resolution: ResolutionRecord): Promise<Result<CaptureSession, CaptureRefusal>>;
  finishResolution(projectId: ProjectId, captureId: CaptureId, completedAt: string): Promise<Result<CaptureSession, CaptureRefusal>>;
  recover(projectId: ProjectId): Promise<Result<readonly CaptureSession[], CaptureRefusal>>;
  getSession(projectId: ProjectId, captureId: CaptureId): Promise<Result<CaptureSession, CaptureRefusal>>;
  claimAnnotation(association: CaptureBeaconAssociation): Promise<Result<CaptureBeaconAssociation, CaptureRefusal>>;
  commitAssociation(association: CaptureBeaconAssociation): Promise<Result<CaptureBeaconAssociation, CaptureRefusal>>;
  getAssociationByCapture(projectId: ProjectId, captureId: CaptureId): Promise<Result<CaptureBeaconAssociation | null, CaptureRefusal>>;
  getAssociationByBeacon(projectId: ProjectId, beaconId: BeaconId): Promise<Result<CaptureBeaconAssociation | null, CaptureRefusal>>;
}
