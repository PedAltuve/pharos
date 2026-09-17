import type { CaptureId } from "../capture/index.js";
import type { RecorderProcessEvidence } from "../capture/types.js";
import type { ProjectId } from "../project/index.js";

export interface CancellationSignal {
  readonly aborted: boolean;
  /** Adapter-neutral subscription used only to stop a child owned by this recorder call. */
  onAbort(listener: () => void): () => void;
}
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
  | { readonly kind: "operator-cancelled" }
  | { readonly kind: "signalled" }
  /** The owned child may be live, so its running session must not be terminalized. */
  | { readonly kind: "process-still-active" }
  | { readonly kind: "unpersisted-process" }
  | { readonly kind: "prerequisite-or-process-failure" };

/** A started recorder owns exactly one exit observer and offers bounded shutdown. */
export interface RecorderRun {
  readonly evidence: RecorderProcessEvidence | undefined;
  waitForCompletion(): Promise<RecorderResult>;
  stop(): void;
}

/** Process/browser adapter boundary. No implementation detail enters the domain. */
export interface Recorder {
  start(command: RecordCaptureCommand): Promise<RecorderRun>;
  /** A live or reused PID is conservatively active; only absence is actionable during recovery. */
  isProcessActive(evidence: RecorderProcessEvidence): Promise<boolean>;
}
