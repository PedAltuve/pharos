import { describe, expect, it } from "vitest";
import type { BeaconStoreRefusal } from "../../../src/domain/ports/index.js";

// Compile-time exhaustiveness pin: a switch over `rule` with no `default`
// clause. `classifyRefusal`'s explicit `string` return type means TS2366
// ("Function lacks ending return statement") fires at `tsc --noEmit` if any
// member of `BeaconStoreRefusal` (the 7-member disk union composed with the
// 14-member domain `BeaconRefusal`) is left unhandled.
function classifyRefusal(refusal: BeaconStoreRefusal): string {
  switch (refusal.rule) {
    // BeaconStoreDiskRefusal (7 members) and BeaconRefusal (14 members),
    // grouped together — no case body between labels, so this is not a
    // fallthrough: every listed rule returns its own name below.
    case "lock-unavailable":
    case "idempotency-key-conflict":
    case "immutable-file-exists":
    case "beacon-not-found":
    case "stored-version-not-found":
    case "stale-attempt-artifact":
    case "invalid-id":
    case "duplicate-draft-id":
    case "draft-not-found":
    case "draft-not-open":
    case "stale-draft-revision":
    case "source-draft-has-no-content":
    case "version-not-found":
    case "version-already-revoked":
    case "invalid-revocation-reason":
    case "ambiguous-open-drafts":
    case "active-version-not-found":
    case "active-version-mismatch":
    case "duplicate-version-id":
    case "reviewed-hash-mismatch":
    case "stale-origin-not-acknowledged":
    case "stale-origin-review-required":
    case "reviewed-active-snapshot-mismatch":
      return refusal.rule;
  }
}

describe("BeaconStoreRefusal exhaustiveness", () => {
  it("classifies every disk-only refusal member by its own rule", () => {
    expect(classifyRefusal({ rule: "lock-unavailable", holderPid: 42, waitedMs: 5_000 })).toBe(
      "lock-unavailable",
    );
    expect(
      classifyRefusal({
        rule: "idempotency-key-conflict",
        key: "k1",
        storedInputHash: "sha256:a",
        requestedInputHash: "sha256:b",
      }),
    ).toBe("idempotency-key-conflict");
    expect(
      classifyRefusal({
        rule: "immutable-file-exists",
        artifact: "manifest",
        beaconId: "bcn_1",
        ownerId: "ver_1",
      }),
    ).toBe("immutable-file-exists");
    expect(classifyRefusal({ rule: "beacon-not-found", beaconId: "bcn_1" })).toBe(
      "beacon-not-found",
    );
    expect(
      classifyRefusal({
        rule: "stored-version-not-found",
        beaconId: "bcn_1",
        versionId: "ver_1",
      }),
    ).toBe("stored-version-not-found");
    expect(
      classifyRefusal({
        rule: "stale-attempt-artifact",
        artifact: "semantics",
        beaconId: "bcn_1",
        ownerId: "drf_1",
        key: "k1",
      }),
    ).toBe("stale-attempt-artifact");
    expect(
      classifyRefusal({ rule: "invalid-id", field: "draftId", value: "../etc" }),
    ).toBe("invalid-id");
  });

  it("classifies a composed domain BeaconRefusal member by its own rule", () => {
    expect(classifyRefusal({ rule: "invalid-revocation-reason" })).toBe(
      "invalid-revocation-reason",
    );
    expect(classifyRefusal({ rule: "ambiguous-open-drafts", beaconId: "bcn_1" })).toBe(
      "ambiguous-open-drafts",
    );
    expect(classifyRefusal({ rule: "active-version-not-found", beaconId: "bcn_1" })).toBe(
      "active-version-not-found",
    );
    expect(classifyRefusal({
      rule: "active-version-mismatch",
      expectedActiveVersionId: "ver_1",
      currentActiveVersionId: "ver_2",
    })).toBe("active-version-mismatch");
    expect(classifyRefusal({ rule: "draft-not-found", draftId: "drf_1" })).toBe(
      "draft-not-found",
    );
    expect(
      classifyRefusal({
        rule: "stale-draft-revision",
        draftId: "drf_1",
        expectedRevision: 1,
        currentRevision: 2,
      }),
    ).toBe("stale-draft-revision");
  });
});
