import { describe, expect, it } from "vitest";
import { recordCaptureScaffold } from "../../src/application/record-capture.js";

// Slice 3 intentionally exposes no recorder orchestration, secret handling, or process control.
describe("record-capture Slice 3 scaffold", () => {
  it("carries only the CaptureStore seam forward to the recorder slice", () => {
    const store = { begin: "capture-store-seam" };
    expect(recordCaptureScaffold(store)).toBe(store);
  });
});
