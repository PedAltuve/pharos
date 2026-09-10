import type { Result } from "../../shared/result.js";
import type { CaptureId } from "../capture/index.js";
import type { ProjectId } from "../project/index.js";

export interface ScanCaptureCommand { readonly projectId: ProjectId; readonly captureId: CaptureId; readonly resolvedSecrets: ReadonlyMap<string, string>; }
export interface SafeSensitivityFinding { readonly category: "detected" | "incomplete"; readonly count: number; }
export interface CleanCaptureArtifact { readonly reference: string; readonly byteSize: number; readonly sha256: string; }
export interface SensitivityScanRefusal { readonly rule: "scan-incomplete" | "unsafe-artifact"; }

/** Returns safe counts/categories only, never a matched secret, snippet, or byte offset. */
export interface SensitivityScanner {
  scan(command: ScanCaptureCommand): Promise<Result<CleanCaptureArtifact, SensitivityScanRefusal | SafeSensitivityFinding>>;
}
