import { describe, expect, it } from "vitest";
import {
  classifyContract,
  deserializeRecord,
  serializeRecord,
  type FileKind,
} from "../../../src/adapters/fs-beacon-store/serialization.js";

const cases: readonly [FileKind, Record<string, unknown>][] = [
  ["beacon", { beaconId: "bcn_1", title: "Beacon" }],
  ["active", { activeVersionId: "ver_1" }],
  ["draft", { draftId: "draft_1", status: "open", revision: 1 }],
  ["tombstone", { draftId: "draft_1", reason: "done" }],
  ["manifest", { versionId: "ver_1", localNumber: 1 }],
  ["semantics", { purpose: "test", actions: [] }],
  ["revocation", { previousStatus: "active", reason: "retired" }],
  ["idempotency", { key: "K", inputHash: "sha256:abc" }],
];

describe("contract-string serialization", () => {
  it.each(cases)("round-trips %s", (kind, value) => {
    const bytes = serializeRecord(kind, value);
    expect(deserializeRecord(kind, bytes)).toEqual(value);
  });

  it("uses the fixed contract string and classifies major versions", () => {
    const bytes = serializeRecord("beacon", { beaconId: "bcn_1", title: "Beacon" });
    expect(JSON.parse(bytes).contract).toBe("pharos.beacon/1");
    expect(classifyContract("pharos.beacon/2")).toBe("corrupt");
    expect(classifyContract("pharos.beacon/1")).toBe("valid");
  });
});
