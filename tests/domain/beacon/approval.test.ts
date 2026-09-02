import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { approveDraft } from "../../../src/domain/beacon/index.js";
import type { Beacon, Draft, DraftOrigin, Version } from "../../../src/domain/beacon/index.js";
import { project } from "../../../src/domain/semantics/index.js";
import type { Hasher } from "../../../src/domain/ports/index.js";
import type { SemanticSource } from "../../../src/domain/semantics/index.js";
import { JcsSha256Hasher } from "../../../src/adapters/hashing/jcs-sha256-hasher.js";
import { arbSemanticSource } from "./arbitraries.js";

/** Deterministic test-only Hasher: JSON.stringify of the projection, so
 * different content always yields a different "hash" and the same content
 * always yields the same one, without depending on adapter behavior. */
const stubHasher: Hasher = {
  hash: (value) => JSON.stringify(value),
};

function baseContent(): SemanticSource {
  return {
    purpose: "Renew an active policy",
    actor: { type: "guest" },
    entryPoint: { path: "/start" },
    actions: [{ action: "start" }],
    readinessIntent: { sideEffectClass: "stateless" },
  };
}

function baseOrigin(): DraftOrigin {
  return {
    branchedFromVersion: null,
    branchedFromHash: null,
    forkedFromDraft: null,
  };
}

function baseBeacon(): Beacon {
  return {
    beaconId: "bcn_1",
    title: "Renew an active policy",
    drafts: {},
    versions: {},
    activeVersionId: null,
  };
}

function withOpenDraft(
  beacon: Beacon,
  draftId: string,
  content: SemanticSource = baseContent(),
  origin: DraftOrigin = baseOrigin(),
): Beacon {
  const draft: Draft = {
    status: "open",
    draftId,
    label: "A draft",
    revision: 1,
    origin,
    content,
  };
  return { ...beacon, drafts: { ...beacon.drafts, [draftId]: draft } };
}

function withClosedDraft(beacon: Beacon, draftId: string): Beacon {
  const draft: Draft = {
    status: "closed",
    draftId,
    label: "A draft",
    revision: 1,
    origin: baseOrigin(),
    content: baseContent(),
    approvedVersionId: "ver_0",
    closedAt: "2026-01-01T00:00:00.000Z",
  };
  return { ...beacon, drafts: { ...beacon.drafts, [draftId]: draft } };
}

function approvalRecord(reviewedHash: string): {
  approvedAt: string;
  reviewedHash: string;
  staleOriginAcknowledged: boolean;
  assurance: "operator_confirmed";
  actor: string | null;
} {
  return {
    approvedAt: "2026-01-01T00:00:00.000Z",
    reviewedHash,
    staleOriginAcknowledged: false,
    assurance: "operator_confirmed",
    actor: "operator_1",
  };
}

function activeVersion(versionId: string, localNumber: number): Version {
  return {
    status: "active",
    versionId,
    localNumber,
    approval: approvalRecord(stubHasher.hash(project(baseContent()))),
    provenance: {
      approvedDraftId: "drf_0",
      approvedRevision: 1,
      branchedFromVersion: null,
      branchedFromHash: null,
    },
  };
}

describe("approveDraft: admission checks (ADR 6 fixed order)", () => {
  it("refuses draft-not-found", () => {
    const beacon = baseBeacon();

    const result = approveDraft(
      beacon,
      {
        draftId: "drf_missing",
        versionId: "ver_1",
        approvedAt: "2026-01-01T00:00:00.000Z",
        actor: "operator_1",
        reviewedHash: "sha256:whatever",
        staleOriginAcknowledged: false,
      },
      stubHasher,
    );

    expect(result).toEqual({
      ok: false,
      error: { rule: "draft-not-found", draftId: "drf_missing" },
    });
  });

  it("refuses draft-not-open", () => {
    const beacon = withClosedDraft(baseBeacon(), "drf_1");

    const result = approveDraft(
      beacon,
      {
        draftId: "drf_1",
        versionId: "ver_1",
        approvedAt: "2026-01-01T00:00:00.000Z",
        actor: "operator_1",
        reviewedHash: "sha256:whatever",
        staleOriginAcknowledged: false,
      },
      stubHasher,
    );

    expect(result).toEqual({
      ok: false,
      error: { rule: "draft-not-open", draftId: "drf_1", status: "closed" },
    });
  });

  it("refuses duplicate-version-id", () => {
    const beacon: Beacon = {
      ...withOpenDraft(baseBeacon(), "drf_1"),
      versions: { ver_1: activeVersion("ver_1", 1) },
    };
    const reviewedHash = stubHasher.hash(project(baseContent()));

    const result = approveDraft(
      beacon,
      {
        draftId: "drf_1",
        versionId: "ver_1",
        approvedAt: "2026-01-01T00:00:00.000Z",
        actor: "operator_1",
        reviewedHash,
        staleOriginAcknowledged: false,
      },
      stubHasher,
    );

    expect(result).toEqual({
      ok: false,
      error: { rule: "duplicate-version-id", versionId: "ver_1" },
    });
  });

  it("refuses reviewed-hash-mismatch when the recomputed hash differs", () => {
    const beacon = withOpenDraft(baseBeacon(), "drf_1");

    const result = approveDraft(
      beacon,
      {
        draftId: "drf_1",
        versionId: "ver_1",
        approvedAt: "2026-01-01T00:00:00.000Z",
        actor: "operator_1",
        reviewedHash: "sha256:stale-review",
        staleOriginAcknowledged: false,
      },
      stubHasher,
    );

    expect(result).toEqual({
      ok: false,
      error: {
        rule: "reviewed-hash-mismatch",
        draftId: "drf_1",
        reviewedHash: "sha256:stale-review",
        currentHash: stubHasher.hash(project(baseContent())),
      },
    });
  });

  it("refuses stale-origin-not-acknowledged when the draft branched from a version that is no longer active", () => {
    const beacon: Beacon = {
      ...withOpenDraft(baseBeacon(), "drf_1", baseContent(), {
        ...baseOrigin(),
        branchedFromVersion: "ver_old",
      }),
      versions: { ver_current: activeVersion("ver_current", 1) },
      activeVersionId: "ver_current",
    };
    const reviewedHash = stubHasher.hash(project(baseContent()));

    const result = approveDraft(
      beacon,
      {
        draftId: "drf_1",
        versionId: "ver_new",
        approvedAt: "2026-01-01T00:00:00.000Z",
        actor: "operator_1",
        reviewedHash,
        staleOriginAcknowledged: false,
      },
      stubHasher,
    );

    expect(result).toEqual({
      ok: false,
      error: {
        rule: "stale-origin-not-acknowledged",
        draftId: "drf_1",
        branchedFromVersion: "ver_old",
        activeVersionId: "ver_current",
      },
    });
  });

  it("refuses stale-origin-not-acknowledged when activeVersionId is null and the draft recorded a branch origin (post-revocation)", () => {
    const beacon: Beacon = {
      ...withOpenDraft(baseBeacon(), "drf_1", baseContent(), {
        ...baseOrigin(),
        branchedFromVersion: "ver_old",
      }),
      versions: {},
      activeVersionId: null,
    };
    const reviewedHash = stubHasher.hash(project(baseContent()));

    const result = approveDraft(
      beacon,
      {
        draftId: "drf_1",
        versionId: "ver_new",
        approvedAt: "2026-01-01T00:00:00.000Z",
        actor: "operator_1",
        reviewedHash,
        staleOriginAcknowledged: false,
      },
      stubHasher,
    );

    expect(result).toEqual({
      ok: false,
      error: {
        rule: "stale-origin-not-acknowledged",
        draftId: "drf_1",
        branchedFromVersion: "ver_old",
        activeVersionId: null,
      },
    });
  });

  it("refuses stale-origin-not-acknowledged when the draft recorded no branch origin but an active version now exists", () => {
    const beacon: Beacon = {
      ...withOpenDraft(baseBeacon(), "drf_1", baseContent(), baseOrigin()),
      versions: { ver_current: activeVersion("ver_current", 1) },
      activeVersionId: "ver_current",
    };
    const reviewedHash = stubHasher.hash(project(baseContent()));

    const result = approveDraft(
      beacon,
      {
        draftId: "drf_1",
        versionId: "ver_new",
        approvedAt: "2026-01-01T00:00:00.000Z",
        actor: "operator_1",
        reviewedHash,
        staleOriginAcknowledged: false,
      },
      stubHasher,
    );

    expect(result).toEqual({
      ok: false,
      error: {
        rule: "stale-origin-not-acknowledged",
        draftId: "drf_1",
        branchedFromVersion: null,
        activeVersionId: "ver_current",
      },
    });
  });

  it("precedence: when both hash mismatch and unacknowledged stale origin hold, reviewed-hash-mismatch wins", () => {
    const beacon: Beacon = {
      ...withOpenDraft(baseBeacon(), "drf_1", baseContent(), {
        ...baseOrigin(),
        branchedFromVersion: "ver_old",
      }),
      versions: { ver_current: activeVersion("ver_current", 1) },
      activeVersionId: "ver_current",
    };

    const result = approveDraft(
      beacon,
      {
        draftId: "drf_1",
        versionId: "ver_new",
        approvedAt: "2026-01-01T00:00:00.000Z",
        actor: "operator_1",
        reviewedHash: "sha256:stale-review",
        staleOriginAcknowledged: false,
      },
      stubHasher,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.rule).toBe("reviewed-hash-mismatch");
    }
  });
});

describe("approveDraft: first-approval success (no prior active version)", () => {
  it("appends a new active Version at localNumber 1 and closes the draft", () => {
    const beacon = withOpenDraft(baseBeacon(), "drf_1");
    const reviewedHash = stubHasher.hash(project(baseContent()));

    const result = approveDraft(
      beacon,
      {
        draftId: "drf_1",
        versionId: "ver_1",
        approvedAt: "2026-02-01T00:00:00.000Z",
        actor: "operator_1",
        reviewedHash,
        staleOriginAcknowledged: false,
      },
      stubHasher,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.versions["ver_1"]).toEqual({
      status: "active",
      versionId: "ver_1",
      localNumber: 1,
      approval: {
        approvedAt: "2026-02-01T00:00:00.000Z",
        reviewedHash,
        staleOriginAcknowledged: false,
        assurance: "operator_confirmed",
        actor: "operator_1",
      },
      provenance: {
        approvedDraftId: "drf_1",
        approvedRevision: 1,
        branchedFromVersion: null,
        branchedFromHash: null,
      },
    });
    expect(result.value.activeVersionId).toBe("ver_1");

    const closedDraft = result.value.drafts["drf_1"];
    expect(closedDraft).toEqual({
      status: "closed",
      draftId: "drf_1",
      label: "A draft",
      revision: 1,
      origin: baseOrigin(),
      content: baseContent(),
      approvedVersionId: "ver_1",
      closedAt: "2026-02-01T00:00:00.000Z",
    });
  });
});

describe("approveDraft: port composition with the real JcsSha256Hasher", () => {
  it("approves cast-free end to end when the reviewed hash matches the real hasher's output", () => {
    const realHasher = new JcsSha256Hasher();
    const beacon = withOpenDraft(baseBeacon(), "drf_1");
    const reviewedHash = realHasher.hash(project(baseContent()));

    const result = approveDraft(
      beacon,
      {
        draftId: "drf_1",
        versionId: "ver_1",
        approvedAt: "2026-02-01T00:00:00.000Z",
        actor: "operator_1",
        reviewedHash,
        staleOriginAcknowledged: false,
      },
      realHasher,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.versions["ver_1"]?.approval.reviewedHash).toBe(reviewedHash);
    expect(reviewedHash.startsWith("sha256:")).toBe(true);
  });
});

describe("property 6: hash binding", () => {
  it("approving with a reviewedHash derived from different content always refuses reviewed-hash-mismatch", () => {
    fc.assert(
      fc.property(
        arbSemanticSource,
        arbSemanticSource,
        (draftContent, reviewedContent) => {
          fc.pre(JSON.stringify(draftContent) !== JSON.stringify(reviewedContent));

          const beacon = withOpenDraft(baseBeacon(), "drf_1", draftContent);
          const reviewedHash = stubHasher.hash(project(reviewedContent));

          const result = approveDraft(
            beacon,
            {
              draftId: "drf_1",
              versionId: "ver_1",
              approvedAt: "2026-02-01T00:00:00.000Z",
              actor: "operator_1",
              reviewedHash,
              staleOriginAcknowledged: false,
            },
            stubHasher,
          );

          expect(result).toEqual({
            ok: false,
            error: {
              rule: "reviewed-hash-mismatch",
              draftId: "drf_1",
              reviewedHash,
              currentHash: stubHasher.hash(project(draftContent)),
            },
          });
        },
      ),
    );
  });
});
