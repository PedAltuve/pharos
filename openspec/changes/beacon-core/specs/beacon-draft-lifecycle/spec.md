# Beacon Draft Lifecycle Specification

## Purpose

Model the pure `Beacon` aggregate and its `Draft` union so a Beacon identity can carry multiple mutable, revision-bound drafts, with refusals expressed as values. No I/O, no `node:*` import, no external package, and no `Clock`/`IdGenerator` port; every id and timestamp is caller-supplied. `Draft.content` is `SemanticSource`; its projection and semantic hash are never cached on the draft. `abandonDraft` additionally accepts a `Hasher` to record the discarded content's semantic hash in the tombstone before the content itself is dropped.

## Requirements

### Requirement: Generic Result Refusal Carrier

`src/shared/` MUST export a generic `Result<T, E>` discriminated union (`{ ok: true; value: T } | { ok: false; error: E }`) with no dependency outside `shared`. Every domain function that can refuse MUST return `Result`, never throw, for an expected refusal.

#### Scenario: Refusal is a value, not a throw

- GIVEN any beacon-domain function documented as refusable
- WHEN it is called with input that triggers a documented refusal
- THEN it returns `{ ok: false, error }` synchronously and MUST NOT throw

### Requirement: Beacon and Draft Are Closed, Caller-Identified

A `Beacon` MUST hold an opaque caller-supplied `beaconId`, a mutable `title`, its `drafts`, and the `versions`/`activeVersionId` state owned by the version-lifecycle capability. A `Draft` MUST be a closed union discriminated by `status`: `open` (`draftId`, `label`, `revision`, `origin: DraftOrigin`, `content: SemanticSource`), `closed` (adds `approvedVersionId`, `closedAt`; retains `content` as immutable provenance), or `abandoned` (drops `content`; keeps `draftId`, `origin`, `finalRevision`, `finalHash: string`, `abandonedAt`, `reason`). No nullable status flag MAY substitute for the union.

`DraftOrigin` MUST carry `branchedFromVersion: string | null`, `branchedFromHash: string | null`, and `forkedFromDraft: string | null`. In this change (C1), `branchedFromVersion` is an opaque string only — no referential integrity to a `Version` entity is asserted or checked (`Version` becomes real in C2).

#### Scenario: Abandonment records the semantic hash of the final content

- GIVEN an open draft with `content` `C`, and a `Hasher` that hashes `project(C)` to `H`
- WHEN `abandonDraft` is called on it
- THEN the resulting tombstone carries `finalHash: H`, matching `hasher.hash(project(draft.content))` computed at abandonment

### Requirement: Record Lookups Use Own-Property Semantics

Every lookup of a caller-supplied id against a `Record`-shaped store (`Beacon.drafts`, `Beacon.versions`, and any future store keyed by caller-supplied id) MUST use own-property semantics and MUST NOT be satisfied by a property inherited from `Object.prototype`. An id such as `"toString"` or `"constructor"` MUST behave exactly like any other absent key: it MUST NOT be treated as an existing entry, and it MUST NOT surface a prototype value in place of a domain record. This requirement applies domain-wide, including the `versions` store introduced by `beacon-version-lifecycle`.

#### Scenario: createDraft accepts a prototype-shadowing id

- GIVEN an empty Beacon with no drafts
- WHEN `createDraft` is called with `draftId: "toString"`
- THEN it succeeds, returning a Beacon with one open draft keyed `"toString"` — it is NOT refused as a duplicate

#### Scenario: forkDraft refuses a prototype-shadowing id with no own entry

- GIVEN a Beacon with no draft keyed `"toString"`
- WHEN `forkDraft` is called with `sourceDraftId: "toString"`
- THEN it returns `{ ok: false }` with `draft-not-found`, and MUST NOT fabricate a source draft from `Object.prototype.toString`

### Requirement: createDraft Adds an Open Draft

`createDraft` MUST accept a caller-supplied `draftId`, `label`, `content`, and `origin`, and return a new `Beacon` with an added `open` draft at `revision: 1`. It MUST refuse on `draftId` collision within the Beacon.

#### Scenario: First draft on a Beacon with no active version

- GIVEN a Beacon with `activeVersionId: null` and no drafts
- WHEN `createDraft` is called with `origin.branchedFromVersion: null`
- THEN the returned Beacon has one `open` draft at revision 1

#### Scenario: Duplicate draft id is refused

- GIVEN a Beacon already holding a draft with `draftId: "drf_1"`
- WHEN `createDraft` is called again with `draftId: "drf_1"`
- THEN it returns `{ ok: false }` and the Beacon is unchanged

### Requirement: updateDraft Is Revision-Bound

`updateDraft` MUST accept `draftId`, `expectedRevision`, and new `content`. It MUST refuse without mutation when the draft does not exist, is not `open`, or `expectedRevision` does not equal the draft's current `revision`. On success it MUST increment `revision` by exactly 1 and replace `content`.

#### Scenario: Stale save is refused without overwrite

- GIVEN an open draft at `revision: 2`
- WHEN `updateDraft` is called with `expectedRevision: 1`
- THEN it returns `{ ok: false }` and the draft remains at revision 2 with its prior content

#### Scenario: Update against a closed draft is refused

- GIVEN a draft with `status: "closed"`
- WHEN `updateDraft` is called against it
- THEN it returns `{ ok: false }` and the Beacon is unchanged

### Requirement: forkDraft Preserves Lineage

`forkDraft` MUST create a new `open` draft at `revision: 1` from an existing source draft, copying its current `content` and setting `origin.forkedFromDraft` to the source `draftId`. It MUST refuse when the source draft does not exist, when the new `draftId` collides, or when the source draft is `abandoned` — an abandoned tombstone has discarded its `content`, so there is nothing to copy (`source-draft-has-no-content`). `open` and `closed` sources are forkable.

#### Scenario: Fork after a rejected stale save

- GIVEN an open draft `drf_1` at revision 2, and a caller holding a stale local revision
- WHEN `forkDraft` creates `drf_2` from `drf_1`
- THEN `drf_2` is `open` at revision 1 with `origin.forkedFromDraft: "drf_1"` and `drf_1` is unchanged

#### Scenario: Fork of an abandoned draft is refused

- GIVEN an `abandoned` draft `drf_1` whose tombstone carries no `content`
- WHEN `forkDraft` is called with `drf_1` as the source
- THEN it returns `{ ok: false }` with the `source-draft-has-no-content` refusal and the Beacon is unchanged

### Requirement: abandonDraft Tombstones an Open Draft

`abandonDraft` MUST accept `draftId`, `abandonedAt`, `reason`, and a `Hasher`, transitioning an `open` draft to `abandoned` and discarding its `content`. On success it MUST record `finalHash: hasher.hash(project(draft.content))` in the tombstone, computed from the draft's content at the moment of abandonment, alongside `finalRevision`. It MUST refuse when the draft does not exist or is not `open` (no double-abandon, no abandoning a closed draft).

#### Scenario: Abandonment discards content but keeps lineage

- GIVEN an open draft at revision 3
- WHEN `abandonDraft` is called with a reason
- THEN the resulting draft is `abandoned`, has no `content`, and retains `origin` and `finalRevision: 3`

#### Scenario: Double abandonment is refused

- GIVEN an already-`abandoned` draft
- WHEN `abandonDraft` is called on it again
- THEN it returns `{ ok: false }` and the draft is unchanged
