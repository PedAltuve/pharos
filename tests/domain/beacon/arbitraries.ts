import fc from "fast-check";
import type {
  Beacon,
  CreateDraftCommand,
  Draft,
  DraftOrigin,
} from "../../../src/domain/beacon/index.js";
import type { SemanticSource } from "../../../src/domain/semantics/index.js";

export const arbDraftId: fc.Arbitrary<string> = fc
  .integer({ min: 0, max: 1_000_000 })
  .map((n) => `drf_${n}`);

/** `Object.prototype` member names, for property 7 (prototype-key neutrality). */
export const arbPrototypeKey: fc.Arbitrary<string> = fc.constantFrom(
  "toString",
  "constructor",
  "valueOf",
  "hasOwnProperty",
  "__proto__",
);

export const arbBeaconId: fc.Arbitrary<string> = fc
  .integer({ min: 0, max: 1_000_000 })
  .map((n) => `bcn_${n}`);

export const arbDraftOrigin: fc.Arbitrary<DraftOrigin> = fc.record({
  branchedFromVersion: fc.option(arbDraftId, { nil: null }),
  branchedFromHash: fc.option(fc.string(), { nil: null }),
  forkedFromDraft: fc.option(arbDraftId, { nil: null }),
});

export const arbSemanticSource: fc.Arbitrary<SemanticSource> = fc
  .record({
    purpose: fc.string({ minLength: 1, maxLength: 40 }),
    actorType: fc.constantFrom("guest", "member"),
    path: fc.string({ minLength: 1, maxLength: 20 }).map((s) => `/${s}`),
    action: fc.string({ minLength: 1, maxLength: 20 }),
    sideEffectClass: fc.constantFrom("stateful", "stateless"),
  })
  .map(({ purpose, actorType, path, action, sideEffectClass }) => ({
    purpose,
    actor: { type: actorType },
    entryPoint: { path },
    actions: [{ action }],
    readinessIntent: { sideEffectClass },
  }));

export const arbOpenDraft: fc.Arbitrary<Draft> = fc
  .tuple(
    arbDraftId,
    fc.string({ minLength: 1, maxLength: 20 }),
    fc.integer({ min: 1, max: 50 }),
    arbDraftOrigin,
    arbSemanticSource,
  )
  .map(([draftId, label, revision, origin, content]) => ({
    status: "open" as const,
    draftId,
    label,
    revision,
    origin,
    content,
  }));

/** A Beacon with zero to a few pre-existing open drafts, for exercising both the collision and no-collision branches of draft commands. */
export const arbBeacon: fc.Arbitrary<Beacon> = fc
  .tuple(
    arbBeaconId,
    fc.string({ minLength: 1, maxLength: 30 }),
    fc.uniqueArray(arbOpenDraft, { selector: (draft) => draft.draftId, maxLength: 4 }),
    fc.option(arbDraftId, { nil: null }),
  )
  .map(([beaconId, title, drafts, activeVersionId]) => ({
    beaconId,
    title,
    drafts: Object.fromEntries(drafts.map((draft) => [draft.draftId, draft])),
    activeVersionId,
  }));

export const arbCreateDraftCommand: fc.Arbitrary<CreateDraftCommand> = fc
  .tuple(
    arbDraftId,
    fc.string({ minLength: 1, maxLength: 20 }),
    arbSemanticSource,
    arbDraftOrigin,
  )
  .map(([draftId, label, content, origin]) => ({ draftId, label, content, origin }));

/**
 * Pairs a Beacon with a `createDraft` command, sometimes reusing one of the
 * Beacon's own draft ids so the collision refusal path is exercised too,
 * not only the success path.
 */
export const arbBeaconAndCreateDraftCommand: fc.Arbitrary<
  readonly [Beacon, CreateDraftCommand]
> = fc.tuple(arbBeacon, arbCreateDraftCommand).chain(([beacon, cmd]) => {
  const existingIds = Object.keys(beacon.drafts);
  const asIs = fc.constant([beacon, cmd] as const);
  if (existingIds.length === 0) {
    return asIs;
  }
  return fc.oneof(
    asIs,
    fc
      .constantFrom(...existingIds)
      .map((draftId) => [beacon, { ...cmd, draftId }] as const),
  );
});
