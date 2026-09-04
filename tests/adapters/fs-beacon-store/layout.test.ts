import { describe, expect, it } from "vitest";
import {
  classifyId,
  createLayout,
  isValidId,
} from "../../../src/adapters/fs-beacon-store/layout.js";

describe("filesystem beacon-store layout", () => {
  it("constructs every store path beneath the project root", () => {
    const layout = createLayout("/project");

    expect(layout.lock()).toBe("/project/lock");
    expect(layout.journalEntry("abc")).toBe(
      "/project/journal/idempotency/abc.json",
    );
    expect(layout.beacon("bcn-1")).toBe("/project/beacons/bcn-1");
    expect(layout.beaconRecord("bcn-1")).toBe(
      "/project/beacons/bcn-1/beacon.json",
    );
    expect(layout.active("bcn-1")).toBe(
      "/project/beacons/bcn-1/active.json",
    );
    expect(layout.draft("bcn-1", "dr-1")).toBe(
      "/project/beacons/bcn-1/drafts/dr-1",
    );
    expect(layout.draftRecord("bcn-1", "dr-1")).toBe(
      "/project/beacons/bcn-1/drafts/dr-1/draft.json",
    );
    expect(layout.tombstone("bcn-1", "dr-1")).toBe(
      "/project/beacons/bcn-1/drafts/dr-1/tombstone.json",
    );
    expect(layout.version("bcn-1", "ver-1")).toBe(
      "/project/beacons/bcn-1/versions/ver-1",
    );
    expect(layout.manifest("bcn-1", "ver-1")).toBe(
      "/project/beacons/bcn-1/versions/ver-1/manifest.json",
    );
    expect(layout.semantics("bcn-1", "ver-1")).toBe(
      "/project/beacons/bcn-1/versions/ver-1/semantics.json",
    );
    expect(layout.revocation("bcn-1", "ver-1")).toBe(
      "/project/beacons/bcn-1/versions/ver-1/revocation.json",
    );
  });

  it("filters non-beacon project entries and temporary names", () => {
    const layout = createLayout("/project");

    expect(
      layout.listBeaconIds([
        "zeta",
        "project.json",
        "lock",
        "journal",
        "alpha.tmp.123",
        "alpha",
      ]),
    ).toEqual(["alpha", "zeta"]);
  });

  it("rejects reserved and malformed ids", () => {
    for (const value of [".", "..", "__proto__", "constructor", "prototype", "bad/id"]) {
      expect(isValidId(value)).toBe(false);
    }
    expect(isValidId("bcn_a-1.2")).toBe(true);
  });

  it("rejects ids colliding with temporary-file filtering", () => {
    expect(isValidId("bcn_a.tmp.1")).toBe(false);
  });
});

describe("filesystem beacon-store id provenance", () => {
  it("classifies an invalid disk segment as corrupt", () => {
    expect(classifyId("bad/id", "disk")).toBe("corrupt");
  });

  it("classifies an invalid caller id addressing existing state as not-found", () => {
    expect(classifyId("bad/id", "existing")).toBe("not-found");
  });

  it("classifies an invalid caller id naming created state as invalid-id", () => {
    expect(classifyId("bad/id", "creation")).toBe("invalid-id");
  });

  it("treats createDraft's beaconId as a creation id", () => {
    expect(classifyId("bad/id", "creation")).toBe("invalid-id");
  });
});
