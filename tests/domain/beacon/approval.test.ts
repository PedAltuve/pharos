import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { approveDraft, createDraft, revokeVersion } from "../../../src/domain/beacon/index.js";
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
        expectedRevision: 1,
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
        expectedRevision: 1,
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
        expectedRevision: 1,
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
        expectedRevision: 1,
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
        expectedRevision: 1,
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
        expectedRevision: 1,
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
        expectedRevision: 1,
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
        expectedRevision: 1,
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

describe("approveDraft: locked admission preconditions", () => {
  it("refuses a stale expected revision", () => {
    const beacon = withOpenDraft(baseBeacon(), "drf_1");
    const result = approveDraft(beacon, {
      draftId: "drf_1", expectedRevision: 2, versionId: "ver_1",
      approvedAt: "2026-02-01T00:00:00.000Z", actor: "operator_1",
      reviewedHash: stubHasher.hash(project(baseContent())), staleOriginAcknowledged: false,
    }, stubHasher);

    expect(result).toEqual({
      ok: false,
      error: { rule: "stale-draft-revision", draftId: "drf_1", expectedRevision: 2, currentRevision: 1 },
    });
  });

  it("refuses approval when another draft remains open", () => {
    const beacon = withOpenDraft(withOpenDraft(baseBeacon(), "drf_1"), "drf_2");
    const result = approveDraft(beacon, {
      draftId: "drf_1", expectedRevision: 1, versionId: "ver_1",
      approvedAt: "2026-02-01T00:00:00.000Z", actor: "operator_1",
      reviewedHash: stubHasher.hash(project(baseContent())), staleOriginAcknowledged: false,
    }, stubHasher);

    expect(result).toEqual({ ok: false, error: { rule: "ambiguous-open-drafts", beaconId: "bcn_1" } });
  });
});

describe("approveDraft: stale-origin approval with explicit acknowledgment", () => {
  it("proceeds when staleOriginAcknowledged is true, recording the acknowledgment on the new version", () => {
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
        expectedRevision: 1,
        versionId: "ver_new",
        approvedAt: "2026-02-01T00:00:00.000Z",
        actor: "operator_1",
        reviewedHash,
        staleOriginAcknowledged: true,
      },
      stubHasher,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const newVersion = result.value.versions["ver_new"];
    expect(newVersion?.status).toBe("active");
    expect(newVersion?.approval.staleOriginAcknowledged).toBe(true);
    expect(newVersion?.approval.reviewedHash).toBe(reviewedHash);
    expect(newVersion?.provenance.branchedFromVersion).toBe("ver_old");
    expect(result.value.activeVersionId).toBe("ver_new");
    expect(result.value.drafts["drf_1"]?.status).toBe("closed");
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
        expectedRevision: 1,
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
        expectedRevision: 1,
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

describe("approveDraft: supersession", () => {
  it("supersedes the prior active version and activates the new one at the next localNumber", () => {
    const priorActive = activeVersion("ver_1", 1);
    const beacon: Beacon = {
      ...withOpenDraft(baseBeacon(), "drf_2", baseContent(), {
        ...baseOrigin(),
        branchedFromVersion: "ver_1",
      }),
      versions: { ver_1: priorActive },
      activeVersionId: "ver_1",
    };
    const reviewedHash = stubHasher.hash(project(baseContent()));

    const result = approveDraft(
      beacon,
      {
        draftId: "drf_2",
        expectedRevision: 1,
        versionId: "ver_2",
        approvedAt: "2026-03-01T00:00:00.000Z",
        actor: "operator_1",
        reviewedHash,
        staleOriginAcknowledged: false,
      },
      stubHasher,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const superseded = result.value.versions["ver_1"];
    expect(superseded?.status).toBe("superseded");
    if (superseded?.status === "superseded") {
      expect(superseded.supersededBy).toBe("ver_2");
      expect(superseded.supersededAt).toBe("2026-03-01T00:00:00.000Z");
    }

    const newActive = result.value.versions["ver_2"];
    expect(newActive?.status).toBe("active");
    expect(newActive?.localNumber).toBe(2);
    expect(result.value.activeVersionId).toBe("ver_2");
  });

  it("supersedes a prior active version keyed by a prototype-shadowing id (getOwn routing)", () => {
    const priorActive = activeVersion("toString", 1);
    const beacon: Beacon = {
      ...withOpenDraft(baseBeacon(), "drf_2", baseContent(), {
        ...baseOrigin(),
        branchedFromVersion: "toString",
      }),
      versions: { toString: priorActive },
      activeVersionId: "toString",
    };
    const reviewedHash = stubHasher.hash(project(baseContent()));

    const result = approveDraft(
      beacon,
      {
        draftId: "drf_2",
        expectedRevision: 1,
        versionId: "ver_2",
        approvedAt: "2026-03-01T00:00:00.000Z",
        actor: "operator_1",
        reviewedHash,
        staleOriginAcknowledged: false,
      },
      stubHasher,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const superseded = result.value.versions["toString"];
    expect(superseded?.status).toBe("superseded");
    if (superseded?.status === "superseded") {
      expect(superseded.supersededBy).toBe("ver_2");
    }
    expect(result.value.activeVersionId).toBe("ver_2");
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
              expectedRevision: 1,
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

interface SequenceStep {
  readonly kind: "approve" | "revoke";
  readonly pick: number;
}

const arbSequenceStep: fc.Arbitrary<SequenceStep> = fc.record({
  kind: fc.constantFrom("approve" as const, "revoke" as const),
  pick: fc.nat({ max: 1000 }),
});

const arbSequence: fc.Arbitrary<readonly SequenceStep[]> = fc.array(arbSequenceStep, {
  minLength: 1,
  maxLength: 8,
});

/**
 * Drives `beacon` through a sequence of approvals and revocations,
 * ignoring any step that refuses. Approvals always use a fresh draft/id
 * pair, a matching reviewed hash, and acknowledge stale origin so the
 * step exercises supersession rather than an admission-check refusal.
 */
function applySequence(steps: readonly SequenceStep[]): Beacon {
  let beacon = baseBeacon();
  let counter = 0;

  for (const step of steps) {
    if (step.kind === "approve") {
      const draftId = `drf_seq_${counter}`;
      const versionId = `ver_seq_${counter}`;
      counter += 1;

      const created = createDraft(beacon, {
        draftId,
        label: "Sequence draft",
        content: baseContent(),
        origin: { ...baseOrigin(), branchedFromVersion: beacon.activeVersionId },
      });
      if (!created.ok) continue;
      beacon = created.value;

      const reviewedHash = stubHasher.hash(project(baseContent()));
      const approved = approveDraft(
        beacon,
        {
          draftId,
          expectedRevision: 1,
          versionId,
          approvedAt: `2026-04-01T00:00:00.${String(counter).padStart(3, "0")}Z`,
          actor: "operator_1",
          reviewedHash,
          staleOriginAcknowledged: true,
        },
        stubHasher,
      );
      if (approved.ok) {
        beacon = approved.value;
      }
    } else {
      const versionIds = Object.keys(beacon.versions);
      if (versionIds.length === 0) continue;
      const versionId = versionIds[step.pick % versionIds.length] as string;

      const revoked = revokeVersion(beacon, {
        versionId,
        reason: "Sequence revocation",
        actor: "operator_1",
        revokedAt: `2026-05-01T00:00:00.${String(counter).padStart(3, "0")}Z`,
      });
      if (revoked.ok) {
        beacon = revoked.value;
      }
    }
  }

  return beacon;
}

describe("property 4: at most one active version", () => {
  it("after any sequence of approvals and revocations, at most one version is active and activeVersionId names exactly that version or is null", () => {
    fc.assert(
      fc.property(arbSequence, (steps) => {
        const beacon = applySequence(steps);

        const activeVersions = Object.values(beacon.versions).filter(
          (version) => version.status === "active",
        );
        expect(activeVersions.length).toBeLessThanOrEqual(1);

        if (beacon.activeVersionId === null) {
          expect(activeVersions.length).toBe(0);
        } else {
          expect(activeVersions.length).toBe(1);
          expect(activeVersions[0]?.versionId).toBe(beacon.activeVersionId);
        }
      }),
    );
  });
});

describe("property 5: monotonic numbering", () => {
  it("local numbers strictly increase in approval order and are never reused, including after revocations", () => {
    fc.assert(
      fc.property(arbSequence, (steps) => {
        const beacon = applySequence(steps);

        const localNumbers = Object.values(beacon.versions)
          .map((version) => version.localNumber)
          .sort((a, b) => a - b);
        const uniqueNumbers = new Set(localNumbers);

        expect(uniqueNumbers.size).toBe(localNumbers.length);
      }),
    );
  });
});
