import { err, ok } from "../../shared/result.js";
import type { AnnotationEligibility, CaptureSession, CaptureId } from "./types.js";

const UUID_V7 = "[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const captureIdPattern = new RegExp(`^cap_${UUID_V7}$`);

export function isCaptureId(value: string): value is CaptureId {
  return captureIdPattern.test(value);
}

/** Capture data is supporting only; a draft may be created only from a promoted terminal session. */
export function annotationEligibility(session: CaptureSession): AnnotationEligibility {
  if (session.status === "promoted") return ok(session);
  return err({ rule: "capture-not-promoted", captureId: session.captureId, status: session.status });
}
