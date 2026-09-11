import { describe, expect, expectTypeOf, it } from "vitest";
import {
  CAPTURE_SESSION_CONTRACT,
  annotationEligibility,
  isCaptureId,
} from "../../../src/domain/capture/index.js";
import type {
  BeaconId,
  CaptureRequestConflict,
  CaptureSession,
  CaptureStoreCorruption,
} from "../../../src/domain/capture/index.js";
import type { CaptureStore } from "../../../src/domain/ports/index.js";

const captureId = "cap_018f47de-7a00-7cc0-8000-000000000001";
const common = {
  contract: CAPTURE_SESSION_CONTRACT,
  projectId: "proj_018f47de-7a00-7cc0-8000-000000000001",
  captureId,
  requestId: "req_018f47de-7a00-7cc0-8000-000000000001",
  inputHash: "sha256:input",
  secretSourceReferences: ["env:CHECKOUT_TOKEN"],
  createdAt: "2026-03-01T00:00:00.000Z",
} as const;

describe("CaptureSession v1 annotation eligibility", () => {
  it("accepts generated capture IDs and only terminal promoted sessions", () => {
    expect(isCaptureId(captureId)).toBe(true);
    expect(isCaptureId("cap_018f47de-7a00-6cc0-8000-000000000001")).toBe(false);

    const promoted = {
      ...common,
      status: "promoted" as const,
      artifact: {
        reference: "captures/cap_018f47de-7a00-7cc0-8000-000000000001/recording.spec.ts",
        byteSize: 42,
        sha256: "sha256:artifact",
      },
      completedAt: "2026-03-01T00:01:00.000Z",
    };
    expect(annotationEligibility(promoted)).toEqual({ ok: true, value: promoted });
  });

  const nonPromoted: readonly CaptureSession[] = [
    { ...common, status: "running" },
    { ...common, status: "post_exit", recorderExitedAt: "2026-03-01T00:01:00.000Z" },
    { ...common, status: "resolving", resolution: "promote" },
    { ...common, status: "rejected", reason: "sensitive-content", detectionCount: 1, completedAt: "2026-03-01T00:01:00.000Z" },
    { ...common, status: "failed", reason: "recorder-exit", completedAt: "2026-03-01T00:01:00.000Z" },
    { ...common, status: "interrupted", reason: "operator-cancelled", completedAt: "2026-03-01T00:01:00.000Z" },
  ];

  it.each(nonPromoted)("safely refuses non-promoted %s.status sessions", (session) => {
    expect(annotationEligibility(session)).toEqual({
      ok: false,
      error: { rule: "capture-not-promoted", captureId, status: session.status },
    });
  });

  it("exports the capture refusal types and brands beacon association lookup IDs", () => {
    expectTypeOf<CaptureRequestConflict["rule"]>().toEqualTypeOf<"capture-request-conflict">();
    expectTypeOf<CaptureStoreCorruption["rule"]>().toEqualTypeOf<"capture-store-corruption">();
    expectTypeOf<Parameters<CaptureStore["getAssociationByBeacon"]>[1]>().toEqualTypeOf<BeaconId>();
  });
});
