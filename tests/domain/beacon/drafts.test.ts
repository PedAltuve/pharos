import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createDraft, updateDraft } from "../../../src/domain/beacon/index.js";
import type { Beacon, Draft, DraftOrigin } from "../../../src/domain/beacon/index.js";
import type { SemanticSource } from "../../../src/domain/semantics/index.js";
import { arbBeaconAndCreateDraftCommand, arbPrototypeKey } from "./arbitraries.js";

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
