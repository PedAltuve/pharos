import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createDraft } from "../../../src/domain/beacon/index.js";
import type { Beacon, DraftOrigin } from "../../../src/domain/beacon/index.js";
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
