import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { abandonDraft, createDraft, forkDraft, updateDraft } from "../../../src/domain/beacon/index.js";
import type { Beacon, Draft, DraftOrigin, Version } from "../../../src/domain/beacon/index.js";
import type { Hasher } from "../../../src/domain/ports/index.js";
import { project } from "../../../src/domain/semantics/index.js";
import type { SemanticSource } from "../../../src/domain/semantics/index.js";
import { arbBeaconAndCreateDraftCommand, arbPrototypeKey } from "./arbitraries.js";

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

function withOpenDraft(beacon: Beacon, draftId: string, revision: number): Beacon {
  const draft: Draft = {
    status: "open",
    draftId,
    label: "A draft",
    revision,
    origin: baseOrigin(),
    content: baseContent(),
  };
  return { ...beacon, drafts: { ...beacon.drafts, [draftId]: draft } };
}

function revisionOf(draft: Draft | undefined): number {
  if (draft?.status !== "open" && draft?.status !== "closed") {
    throw new Error("Expected an open or closed draft with a revision");
  }
  return draft.revision;
}

function withClosedDraft(beacon: Beacon, draftId: string): Beacon {
  const draft: Draft = {
    status: "closed",
    draftId,
    label: "A draft",
    revision: 1,
    origin: baseOrigin(),
    content: baseContent(),
    approvedVersionId: "ver_1",
    closedAt: "2026-01-01T00:00:00.000Z",
  };
  return { ...beacon, drafts: { ...beacon.drafts, [draftId]: draft } };
}

function sampleActiveVersion(versionId: string): Version {
  return {
    status: "active",
    versionId,
    localNumber: 1,
    approval: {
      approvedAt: "2026-01-01T00:00:00.000Z",
      reviewedHash: "sha256:abc",
      staleOriginAcknowledged: false,
      assurance: "operator_confirmed",
      actor: "operator_1",
    },
    provenance: {
      approvedDraftId: "drf_0",
      approvedRevision: 1,
      branchedFromVersion: null,
      branchedFromHash: null,
    },
  };
}

function withAbandonedDraft(beacon: Beacon, draftId: string): Beacon {
  const draft: Draft = {
    status: "abandoned",
    draftId,
    label: "A draft",
    origin: baseOrigin(),
    finalRevision: 3,
    finalHash: stubHasher.hash(project(baseContent())),
    reason: "No longer needed",
    abandonedAt: "2026-01-01T00:00:00.000Z",
  };
  return { ...beacon, drafts: { ...beacon.drafts, [draftId]: draft } };
}

describe("createDraft", () => {
  it("adds an open draft at revision 1 on a Beacon with no active version", () => {
    const beacon = baseBeacon();

    const result = createDraft(beacon, {
      draftId: "drf_1",
      label: "First draft",
      content: baseContent(),
      origin: baseOrigin(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.drafts["drf_1"]).toEqual({
      status: "open",
      draftId: "drf_1",
      label: "First draft",
      revision: 1,
      origin: baseOrigin(),
      content: baseContent(),
    });
  });

  it("refuses a duplicate draft id", () => {
    const beacon = baseBeacon();
    const created = createDraft(beacon, {
      draftId: "drf_1",
      label: "First draft",
      content: baseContent(),
      origin: baseOrigin(),
    });
    if (!created.ok) throw new Error("expected first createDraft to succeed");

    const result = createDraft(created.value, {
      draftId: "drf_1",
      label: "Second draft",
      content: baseContent(),
      origin: baseOrigin(),
    });

    expect(result).toEqual({
      ok: false,
      error: { rule: "duplicate-draft-id", draftId: "drf_1" },
    });
  });

  it("accepts a prototype-shadowing draftId, not refused as a duplicate", () => {
    const beacon = baseBeacon();

    const result = createDraft(beacon, {
      draftId: "toString",
      label: "First draft",
      content: baseContent(),
      origin: baseOrigin(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.drafts["toString"]).toEqual({
      status: "open",
      draftId: "toString",
      label: "First draft",
      revision: 1,
      origin: baseOrigin(),
      content: baseContent(),
    });
  });

  it("property 7: a createDraft under a prototype-key id on an empty store is never refused as a duplicate", () => {
    fc.assert(
      fc.property(arbPrototypeKey, (draftId) => {
        const beacon = baseBeacon();

        const result = createDraft(beacon, {
          draftId,
          label: "First draft",
          content: baseContent(),
          origin: baseOrigin(),
        });

        expect(result.ok).toBe(true);
      }),
    );
  });

  it("property: never mutates the input Beacon, on both ok and refused outcomes", () => {
    fc.assert(
      fc.property(arbBeaconAndCreateDraftCommand, ([beacon, cmd]) => {
        const before = structuredClone(beacon);

        createDraft(beacon, cmd);

        expect(beacon).toEqual(before);
      }),
    );
  });
});

describe("updateDraft", () => {
  it("increments revision by 1 and replaces content on a successful save", () => {
    const beacon = withOpenDraft(baseBeacon(), "drf_1", 1);
    const newContent: SemanticSource = { ...baseContent(), purpose: "Cancel an active policy" };

    const result = updateDraft(beacon, {
      draftId: "drf_1",
      expectedRevision: 1,
      content: newContent,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const updated = result.value.drafts["drf_1"];
    expect(revisionOf(updated)).toBe(2);
    expect(updated?.status).toBe("open");
    if (updated?.status === "open") {
      expect(updated.content).toEqual(newContent);
    }
  });

  it("refuses a stale expectedRevision without overwriting", () => {
    const beacon = withOpenDraft(baseBeacon(), "drf_1", 2);

    const result = updateDraft(beacon, {
      draftId: "drf_1",
      expectedRevision: 1,
      content: { ...baseContent(), purpose: "Cancel an active policy" },
    });

    expect(result).toEqual({
      ok: false,
      error: {
        rule: "stale-draft-revision",
        draftId: "drf_1",
        expectedRevision: 1,
        currentRevision: 2,
      },
    });
    expect(revisionOf(beacon.drafts["drf_1"])).toBe(2);
  });

  it("refuses when the draft does not exist", () => {
    const beacon = baseBeacon();

    const result = updateDraft(beacon, {
      draftId: "drf_missing",
      expectedRevision: 1,
      content: baseContent(),
    });

    expect(result).toEqual({
      ok: false,
      error: { rule: "draft-not-found", draftId: "drf_missing" },
    });
  });

  it("succeeds against an own-property draft keyed with a prototype-shadowing id", () => {
    const beacon = withOpenDraft(baseBeacon(), "toString", 1);

    const result = updateDraft(beacon, {
      draftId: "toString",
      expectedRevision: 1,
      content: { ...baseContent(), purpose: "Cancel an active policy" },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(revisionOf(result.value.drafts["toString"])).toBe(2);
  });

  it("refuses draft-not-found for a prototype-key id with no own entry", () => {
    const beacon = baseBeacon();

    const result = updateDraft(beacon, {
      draftId: "constructor",
      expectedRevision: 1,
      content: baseContent(),
    });

    expect(result).toEqual({
      ok: false,
      error: { rule: "draft-not-found", draftId: "constructor" },
    });
  });

  it("refuses against a closed draft", () => {
    const beacon = withClosedDraft(baseBeacon(), "drf_1");

    const result = updateDraft(beacon, {
      draftId: "drf_1",
      expectedRevision: 1,
      content: baseContent(),
    });

    expect(result).toEqual({
      ok: false,
      error: { rule: "draft-not-open", draftId: "drf_1", status: "closed" },
    });
  });

  it("property 2: a successful update yields exactly currentRevision + 1; a refused one leaves the stored draft deep-equal", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 50 }),
        fc.integer({ min: 1, max: 50 }),
        (currentRevision, expectedRevision) => {
          const beacon = withOpenDraft(baseBeacon(), "drf_1", currentRevision);
          const before = structuredClone(beacon);

          const result = updateDraft(beacon, {
            draftId: "drf_1",
            expectedRevision,
            content: { ...baseContent(), purpose: "Cancel an active policy" },
          });

          if (expectedRevision === currentRevision) {
            expect(result.ok).toBe(true);
            if (result.ok) {
              expect(revisionOf(result.value.drafts["drf_1"])).toBe(currentRevision + 1);
            }
          } else {
            expect(result.ok).toBe(false);
            expect(beacon).toEqual(before);
          }
        },
      ),
    );
  });
});

describe("forkDraft", () => {
  it("forks a new open draft at revision 1 from an open source, preserving origin lineage", () => {
    const beacon = withOpenDraft(baseBeacon(), "drf_1", 2);

    const result = forkDraft(beacon, {
      sourceDraftId: "drf_1",
      draftId: "drf_2",
      label: "Forked draft",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.drafts["drf_2"]).toEqual({
      status: "open",
      draftId: "drf_2",
      label: "Forked draft",
      revision: 1,
      origin: { ...baseOrigin(), forkedFromDraft: "drf_1" },
      content: baseContent(),
    });
    expect(result.value.drafts["drf_1"]).toEqual(beacon.drafts["drf_1"]);
  });

  it("forks from a closed source", () => {
    const beacon = withClosedDraft(baseBeacon(), "drf_1");

    const result = forkDraft(beacon, {
      sourceDraftId: "drf_1",
      draftId: "drf_2",
      label: "Forked draft",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.drafts["drf_2"]?.status).toBe("open");
  });

  it("refuses when the source draft does not exist", () => {
    const beacon = baseBeacon();

    const result = forkDraft(beacon, {
      sourceDraftId: "drf_missing",
      draftId: "drf_2",
      label: "Forked draft",
    });

    expect(result).toEqual({
      ok: false,
      error: { rule: "draft-not-found", draftId: "drf_missing" },
    });
  });

  it("refuses when the new draft id collides", () => {
    const beacon = withOpenDraft(withOpenDraft(baseBeacon(), "drf_1", 1), "drf_2", 1);

    const result = forkDraft(beacon, {
      sourceDraftId: "drf_1",
      draftId: "drf_2",
      label: "Forked draft",
    });

    expect(result).toEqual({
      ok: false,
      error: { rule: "duplicate-draft-id", draftId: "drf_2" },
    });
  });

  it("refuses forking an abandoned source with source-draft-has-no-content, not draft-not-open", () => {
    const beacon = withAbandonedDraft(baseBeacon(), "drf_1");

    const result = forkDraft(beacon, {
      sourceDraftId: "drf_1",
      draftId: "drf_2",
      label: "Forked draft",
    });

    expect(result).toEqual({
      ok: false,
      error: { rule: "source-draft-has-no-content", draftId: "drf_1", status: "abandoned" },
    });
  });

  it("refuses draft-not-found for a prototype-shadowing sourceDraftId with no own entry, without fabricating a source", () => {
    const beacon = baseBeacon();

    const result = forkDraft(beacon, {
      sourceDraftId: "toString",
      draftId: "drf_2",
      label: "Forked draft",
    });

    expect(result).toEqual({
      ok: false,
      error: { rule: "draft-not-found", draftId: "toString" },
    });
  });
});

describe("abandonDraft", () => {
  it("discards content but keeps lineage and records finalHash when abandoning an open draft", () => {
    const beacon = withOpenDraft(baseBeacon(), "drf_1", 3);
    const expectedHash = stubHasher.hash(project(baseContent()));

    const result = abandonDraft(
      beacon,
      {
        draftId: "drf_1",
        reason: "No longer needed",
        abandonedAt: "2026-01-01T00:00:00.000Z",
      },
      stubHasher,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const abandoned = result.value.drafts["drf_1"];
    expect(abandoned).toEqual({
      status: "abandoned",
      draftId: "drf_1",
      label: "A draft",
      origin: baseOrigin(),
      finalRevision: 3,
      finalHash: expectedHash,
      reason: "No longer needed",
      abandonedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(abandoned).not.toHaveProperty("content");
  });

  it("refuses double abandonment", () => {
    const beacon = withAbandonedDraft(baseBeacon(), "drf_1");

    const result = abandonDraft(
      beacon,
      {
        draftId: "drf_1",
        reason: "Again",
        abandonedAt: "2026-01-01T00:00:00.000Z",
      },
      stubHasher,
    );

    expect(result).toEqual({
      ok: false,
      error: { rule: "draft-not-open", draftId: "drf_1", status: "abandoned" },
    });
  });

  it("refuses when the draft does not exist", () => {
    const beacon = baseBeacon();

    const result = abandonDraft(
      beacon,
      {
        draftId: "drf_missing",
        reason: "No longer needed",
        abandonedAt: "2026-01-01T00:00:00.000Z",
      },
      stubHasher,
    );

    expect(result).toEqual({
      ok: false,
      error: { rule: "draft-not-found", draftId: "drf_missing" },
    });
  });
});

describe("property 3: draft work preserves activeVersionId and versions", () => {
  it("createDraft, updateDraft, forkDraft, and abandonDraft never change activeVersionId or versions", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<string | null>(null, "ver_1"),
        (activeVersionId) => {
          const beacon: Beacon = {
            ...withOpenDraft(baseBeacon(), "drf_1", 1),
            activeVersionId,
            versions: activeVersionId === null ? {} : { ver_1: sampleActiveVersion("ver_1") },
          };

          const createResult = createDraft(beacon, {
            draftId: "drf_new",
            label: "New",
            content: baseContent(),
            origin: baseOrigin(),
          });
          const updateResult = updateDraft(beacon, {
            draftId: "drf_1",
            expectedRevision: 1,
            content: baseContent(),
          });
          const forkResult = forkDraft(beacon, {
            sourceDraftId: "drf_1",
            draftId: "drf_fork",
            label: "Fork",
          });
          const abandonResult = abandonDraft(
            beacon,
            {
              draftId: "drf_1",
              reason: "done",
              abandonedAt: "2026-01-01T00:00:00.000Z",
            },
            stubHasher,
          );

          for (const result of [createResult, updateResult, forkResult, abandonResult]) {
            expect(result.ok).toBe(true);
            if (result.ok) {
              expect(result.value.activeVersionId).toBe(activeVersionId);
              expect(result.value.versions).toEqual(beacon.versions);
            }
          }
        },
      ),
    );
  });
});
