import type { CaptureId } from "../capture/index.js";
import type { ProjectId } from "../project/index.js";

export interface CancellationSignal { readonly aborted: boolean; }
export type RecorderTerminalMode = "human" | "json";
export interface RecordCaptureCommand {
  readonly projectId: ProjectId;
  readonly captureId: CaptureId;
  readonly url: string;
  readonly terminalMode: RecorderTerminalMode;
  readonly signal: CancellationSignal;
}
export type RecorderResult =
  | { readonly kind: "exited"; readonly exitCode: number }
  | { readonly kind: "interrupted" }
  | { readonly kind: "prerequisite-or-process-failure" };

/** Process/browser adapter boundary. No implementation detail enters the domain. */
export interface Recorder {
  record(command: RecordCaptureCommand): Promise<RecorderResult>;
}
