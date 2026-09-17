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
  | { readonly kind: "prerequisite-or-process-failure" };
export type ProcessProbe = "same" | "absent" | "reused" | "unknown";

/** A started recorder owns exactly one exit observer and exposes internal containment. */
export interface RecorderRun {
  readonly evidence: RecorderProcessEvidence | undefined;
  waitForCompletion(): Promise<RecorderResult>;
  contain(): void;
}

/** Process/browser adapter boundary. No implementation detail enters the domain. */
export interface Recorder {
  start(command: RecordCaptureCommand): Promise<RecorderRun>;
  /** Recovery never signals the observed process; identity reuse is distinct from absence. */
  probeProcess(evidence: RecorderProcessEvidence): Promise<ProcessProbe>;
}
