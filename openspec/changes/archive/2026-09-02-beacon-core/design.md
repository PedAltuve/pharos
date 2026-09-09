# Design: Beacon Core (Slice C)

> **Amended 2026-09-02 (post-review remediation).** The delta specs were amended after
> operator review confirmed three code defects (Engram `sdd/beacon-core/review-remediation`,
> observation 2142). Sections marked **[R]** below carry the remediation. Everything else is
> unchanged and remains ratified.

## Technical approach

The Beacon aggregate is the only write model in this slice. **Every command has one shape**: `(beacon, command[, hasher]) => Result<Beacon, BeaconRefusal>`. It takes the aggregate root, returns a whole new aggregate root or a refusal value, and never mutates its input. Domain atomicity is therefore "one returned value"; disk atomicity stays Slice D's.

Impossible states are removed by construction, as in Slice A: `Draft` and `Version` are closed unions discriminated by `status`, so an abandoned draft has no `content`, a revoked version cannot exist without its `RevocationRecord`, and a superseded version names its successor. No nullable status flags, no optional output properties.

Values a pure function cannot compute (ids, timestamps, actor, the reviewed hash, and — per `beacon-draft-lifecycle` §createDraft — the new draft's `origin`) are caller-supplied. Only values the aggregate alone owns (the next `localNumber`, supersession of the prior active version, a fork's `origin.forkedFromDraft`, an abandoned draft's `finalHash`) are derived internally, so a caller cannot lie about them.

## Architecture decisions

| # | Decision | Alternatives rejected | Rationale |
|---|---|---|---|
| 1 | `Result<T, E>` is `{ ok: true; value: T } \| { ok: false; error: E }` | `outcome: "succeeded"\|"refused"` mirroring the CLI envelope; `kind: "ok"\|"err"` | Ratified literally by `beacon-draft-lifecycle` §Generic Result Refusal Carrier. A boolean discriminant narrows with no string comparison and keeps the carrier vocabulary-free. The CLI envelope's `outcome` domain (`succeeded/refused/failed/inconclusive/interrupted`, technical-design §8) is an *execution* vocabulary a pure function cannot fill; binding `src/shared/` to it would pull edge presentation into the domain. Envelope mapping happens at the edge: `ok: false` → `outcome: "refused"` + exit 3, one line, no translation table. |
| 2 | Refusals carry a stable `rule` token plus a structured payload, never a message | `Error` subclasses; `{rule, message}` in domain | Thrown errors are not values and would defeat the returned-refusal contract. Human copy is presentation: the CLI composes the message from `rule` + payload, keeping the domain free of wording and i18n. `rule` feeds `refusal.rule` verbatim. |
| 3 | Commands are named `readonly` interfaces, not positional arguments | Positional `(beacon, draftId, versionId, approvedAt, actor)` | Caller-supplied ids and timestamps are adjacent `string`s; transposition would be silent and type-checked. One named object per operation also gives the future CLI a parse target. |
| 4 | Immutability by `readonly` types + spread with structural sharing | `Object.freeze` / deep freeze | Freezing pushes a runtime mechanism into pure value types for a guarantee the types and the no-mutation property tests already carry. Unchanged sub-objects are shared by reference. |
| 5 **[R]** | `resolveActiveVersion` returns `ActiveVersion \| null` and **throws** a plain `Error` on a corrupt active pointer. Three corruption forms throw: the id names no own entry, the entry is not `active`, **or the resolved record's embedded `versionId` differs from the `activeVersionId` key used to look it up** | Return `null` on corruption; return the wider `Version`; tolerate the key/identity mismatch and return the record | Returning `null` would launder store corruption into the legitimate "no active version" answer — the exact ambiguity this slice exists to eliminate. `beacon-version-lifecycle` §resolveActiveVersion now pins the identity clause literally ("a mismatch MUST throw, since it signals store corruption rather than an expected refusal"). `ActiveVersion` is the `status: "active"` member of `Version`, so every returned value **is** a `Version`; the narrowing only excludes states the aggregate's own commands cannot produce. |
| 6 | Approval checks run in fixed order: existence → openness → duplicate version id → **hash re-verification** → **stale-origin acknowledgment** | Stale-origin first; unordered | "What you reviewed is not what you are approving" is the more fundamental refusal than "your branch origin is behind". Precedence is observable, so it is pinned by a test where both conditions hold. The remediation in row 11 changes the stale-origin *formula*, not its position in this order. |
| 7 | `Beacon.versions` is introduced by C2, not C1 | C1 declaring a placeholder version type | A C1 stand-in would be type fiction. C1 keeps `activeVersionId` (an opaque pointer) so the invariant "draft work never alters the active version" is testable in C1; C2 adds exactly one property line plus one import. The change **as a whole** satisfies `beacon-draft-lifecycle` §Beacon and Draft Are Closed, which assigns `versions`/`activeVersionId` to the version-lifecycle capability. |
| 8 | The approval fact lives in exactly one place: `ApprovalRecord` carries `reviewedHash` and `staleOriginAcknowledged`; `Version` stores no body and no hash of its own | `staleOriginAcknowledged` in `VersionProvenance`; `Version.semantics` + `Version.semanticHash` | `beacon-version-lifecycle` §Version Is a Closed Union names `ApprovalRecord` as the host of both fields, and a gate that leaves no trace would not satisfy lifecycle §2's "recorded acknowledgment". A separate `Version.semanticHash` would duplicate `approval.reviewedHash`, and a separate `Version.semantics` would duplicate the closed draft's retained `content` — which `beacon-draft-lifecycle` §Beacon and Draft retains *as immutable provenance* precisely so the version body need not be copied. One fact, one field, nothing to desynchronize; the body resolves in-aggregate via `provenance.approvedDraftId`. |
| 9 | `RevokedVersion` carries `previousStatus: "active" \| "superseded"` | Drop it | Revoking the active version nulls the pointer; without this field the fact that it was ever active is unrecoverable, contradicting lifecycle §3's "preserve historical approval". |
| 10 **[R]** | `Hasher` is an explicit trailing parameter on **every** command that must bind content to a hash: `approveDraft(beacon, cmd, hasher)` **and `abandonDraft(beacon, cmd, hasher)`** | Dependency object; a `HashingBeaconService` class; keeping C1 Hasher-free by dropping `finalHash` | One port, one argument, no service seam. `beacon-draft-lifecycle` §abandonDraft now requires `finalHash: hasher.hash(project(draft.content))` in the tombstone, so C1c necessarily depends on the `Hasher` port and on `project()`. This supersedes the earlier "C1 has no Hasher dependency" narrowing: `Hasher` and `project()` are both already frozen predecessors (Slices A and B) inside this same change, so the dependency costs C1 one import, not a port introduction. |
| 11 **[R]** | Stale-origin gate is **plain inequality**: `draft.origin.branchedFromVersion !== beacon.activeVersionId`. Only equality is fresh; both null-directions are stale | Guarding with `beacon.activeVersionId !== null && …` (the shipped defect); semantic comparison of the divergence | The spec says the gate fires when the origin "differs from" the active version, with no null exclusion, and now pins the null direction with a scenario: origin `"ver_old"` against `activeVersionId: null` (post-revocation) MUST refuse with `stale-origin-not-acknowledged`. The `!== null` guard silently approved exactly that case. Plain inequality is also the only formula symmetric in both null directions: a draft branched from nothing while a version has since become active is stale, and a draft branched from a version that has since been revoked is stale. It stays a boolean gate — the domain performs no semantic comparison. |
| 12 **[R]** | **Domain-wide convention:** every lookup of a caller-supplied id against a `Record`-shaped store goes through one internal helper, `getOwn(record, key)` in `src/domain/beacon/records.ts`, implemented as `Object.hasOwn(record, key) ? record[key] : undefined`. A prototype-inherited key behaves exactly as absent | Bare `record[key] !== undefined` (the shipped defect); `Object.create(null)` prototype-less stores; `Map<string, T>`; an inline `Object.hasOwn` guard repeated at each call site | `beacon-draft-lifecycle` §Record Lookups Use Own-Property Semantics makes this a requirement, domain-wide, including `versions`. `Object.create(null)` would only protect stores this code constructs — a `Beacon` rehydrated by Slice D from JSON would still carry `Object.prototype`, so the guard must live at the read, not the write. `Map` would change the persisted shape and every spec-named `Record`. Repeating the guard inline is what let two of eight call sites drift; one helper makes the convention greppable and gives the boundary a single home. The helper is internal — it is **not** re-exported by `src/domain/beacon/index.ts` — and needs no new refusal token: prototype misses now surface as the existing `draft-not-found` / `version-not-found` / `duplicate-*` semantics, correctly inverted. |
| 13 **[R]** | The key-vs-embedded `versionId` integrity check lives **only** in `resolveActiveVersion`, not in `revokeVersion` or `approveDraft` | Folding the identity throw into `getOwn`; adding it to every `versions` lookup; normalising the embedded id to the lookup key on write | `resolveActiveVersion` is the only function that hands a *stored* `Version` back to a caller, so it is the only place a mismatched identity escapes the aggregate — which is exactly why the spec pins it there and nowhere else. `revokeVersion` and `approveDraft` never return a looked-up record; they rebuild it, preserving the embedded `versionId` verbatim under the same key, so corruption is neither amplified nor laundered. Folding the throw into `getOwn` would make three commands newly throwing in a region no scenario covers, converting a read-side integrity assertion into a write-side one. Normalising the embedded id to the key would be worse still: it would *erase* the evidence of corruption. |

## Interfaces

```ts
// src/shared/result.ts
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };
export function ok<T>(value: T): Result<T, never>;
export function err<E>(error: E): Result<never, E>;

// src/domain/beacon/records.ts   [R] (C1a; internal — not re-exported by the barrel)
export function getOwn<T>(
  record: Readonly<Record<string, T>>,
  key: string,
): T | undefined {
  // Guards against Object.prototype keys ("toString", "constructor", …) being
  // read as domain records. Every caller-supplied-id lookup MUST route here.
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

// src/domain/beacon/types.ts        (C1; one line added by C2)
export interface Beacon {
  readonly beaconId: string;
  readonly title: string;
  readonly drafts: Readonly<Record<string, Draft>>;
  readonly versions: Readonly<Record<string, Version>>; // C2 adds this line
  readonly activeVersionId: string | null;
}
export interface DraftOrigin {
  readonly branchedFromVersion: string | null; // opaque string in C1
  readonly branchedFromHash: string | null;
  readonly forkedFromDraft: string | null;
}
export type Draft =
  | { readonly status: "open"; readonly draftId: string; readonly label: string;
      readonly revision: number; readonly origin: DraftOrigin;
      readonly content: SemanticSource }
  | { readonly status: "closed"; readonly draftId: string; readonly label: string;
      readonly revision: number; readonly origin: DraftOrigin;
      readonly content: SemanticSource;       // retained as immutable provenance
      readonly approvedVersionId: string; readonly closedAt: string }
  | { readonly status: "abandoned"; readonly draftId: string; readonly label: string;
      readonly origin: DraftOrigin; readonly finalRevision: number;
      readonly finalHash: string;             // [R] hash of the discarded content
      readonly reason: string; readonly abandonedAt: string };
      // content is dropped; finalHash is the only trace of what it said

// src/domain/beacon/versions.ts     (C2)
interface ApprovedVersionBase {
  readonly versionId: string;     // portable version ID (lifecycle §1)
  readonly localNumber: number;   // monotonic per beacon, never reused
  readonly approval: ApprovalRecord;
  readonly provenance: VersionProvenance;
}
export type Version =
  | (ApprovedVersionBase & { readonly status: "active" })
  | (ApprovedVersionBase & { readonly status: "superseded";
      readonly supersededBy: string; readonly supersededAt: string })
  | (ApprovedVersionBase & { readonly status: "revoked";
      readonly revocation: RevocationRecord;
      readonly previousStatus: "active" | "superseded" });
export type ActiveVersion = Extract<Version, { readonly status: "active" }>;
export interface ApprovalRecord {
  readonly approvedAt: string;
  readonly reviewedHash: string;
  readonly staleOriginAcknowledged: boolean;
  readonly assurance: "operator_confirmed";   // v1 has exactly one level
  readonly actor: string | null;
}
export interface VersionProvenance {
  readonly approvedDraftId: string;
  readonly approvedRevision: number;
  readonly branchedFromVersion: string | null;
  readonly branchedFromHash: string | null;
}
export interface RevocationRecord {
  readonly revokedAt: string; readonly reason: string;
  readonly actor: string | null;
}
```

Commands (`Result<Beacon, BeaconRefusal>` for all six writers):

| Function | Command fields | Slice |
|---|---|---|
| `createDraft(beacon, cmd)` | `draftId, label, content, origin` | C1 |
| `updateDraft(beacon, cmd)` | `draftId, expectedRevision, content` | C1 |
| `forkDraft(beacon, cmd)` | `sourceDraftId, draftId, label` | C1 |
| `abandonDraft(beacon, cmd, hasher)` **[R]** | `draftId, reason, abandonedAt` | C1 |
| `approveDraft(beacon, cmd, hasher)` | `draftId, reviewedHash, versionId, approvedAt, actor, staleOriginAcknowledged` | C2 |
| `revokeVersion(beacon, cmd)` | `versionId, reason, actor, revokedAt` | C2 |
| `resolveActiveVersion(beacon): ActiveVersion \| null` | — | C2 |

`createDraft` takes the whole `origin` from the caller (spec scenario: called with `origin.branchedFromVersion: null`); it does **not** derive it from `activeVersionId`. `forkDraft` copies the source draft's `content` and `origin`, then overrides `origin.forkedFromDraft: sourceDraftId`. `abandonDraft` computes `finalHash` from the draft's content *at the moment of abandonment*, before dropping it. Command *field* shapes are frozen across C1→C2; only `abandonDraft`'s arity changed under this remediation.

### `getOwn` touch points **[R]**

Every one of these replaces a bare `record[key]` index read. This list is exhaustive for the change; a new caller-supplied-id lookup added later MUST join it.

| Function | File | Lookups routed through `getOwn` | Unit |
|---|---|---|---|
| `createDraft` | `drafts.ts` | `drafts[cmd.draftId]` (duplicate check) | C1a |
| `updateDraft` | `drafts.ts` | `drafts[cmd.draftId]` | C1b |
| `forkDraft` | `drafts.ts` | `drafts[cmd.sourceDraftId]`, `drafts[cmd.draftId]` (duplicate check) | C1c |
| `abandonDraft` | `drafts.ts` | `drafts[cmd.draftId]` | C1c |
| `approveDraft` | `approval.ts` | `drafts[cmd.draftId]`, `versions[cmd.versionId]` (duplicate check), `versions[beacon.activeVersionId]` (prior active) | C2b |
| `revokeVersion` | `revocation.ts` | `versions[cmd.versionId]` | C2a-2 |
| `resolveActiveVersion` | `active-version.ts` | `versions[beacon.activeVersionId]` | C2a-2 |

## Refusal taxonomy

Every member is `{ readonly rule: <token>, ...payload }`; `BeaconRefusal` is their closed union. **The remediation adds no token** — prototype-key misses surface as the existing tokens, correctly inverted.

| `rule` | Payload | Raised by |
|---|---|---|
| `draft-not-found` | `draftId` | update, fork (source), abandon, approve |
| `draft-not-open` | `draftId, status` | update, abandon, approve |
| `source-draft-has-no-content` | `draftId, status` | fork |
| `duplicate-draft-id` | `draftId` | create, fork |
| `stale-draft-revision` | `draftId, expectedRevision, currentRevision` | update |
| `duplicate-version-id` | `versionId` | approve |
| `reviewed-hash-mismatch` | `draftId, reviewedHash, currentHash` | approve |
| `stale-origin-not-acknowledged` | `draftId, branchedFromVersion, activeVersionId` | approve |
| `version-not-found` | `versionId` | revoke |
| `version-already-revoked` | `versionId` | revoke |

**Stale-origin condition [R]**: `draft.origin.branchedFromVersion !== beacon.activeVersionId`. Only equality is fresh; **both** null directions are stale. A draft that branched from nothing (`null`) while an active version now exists **is** stale-origin — meaning appeared after the draft started. A draft branched from `"ver_old"` on a Beacon whose `activeVersionId` is now `null` (post-revocation) **is equally** stale-origin — the ground it was written against is gone. Blank-string policing of `reason`/`label` is edge validation, not a domain refusal.

## Spec conformance notes

**`forkDraft` refusal list (resolved).** `beacon-draft-lifecycle` §forkDraft names three refusal conditions: a missing source, a colliding `draftId`, and an `abandoned` source (`source-draft-has-no-content` — the tombstone has discarded its `content`, so there is nothing to copy). `draft-not-open` is **removed** from fork, and forking a `closed` draft is legal (its retained `content` is exactly what fork copies). The refusal taxonomy above matches the spec's list exactly; the design widens nothing.

**Fields beyond the spec's MUST-carry floors** (floors, not ceilings — each is load-bearing):
- `ApprovalRecord.assurance` — lifecycle §2 has exactly one v1 assurance level; declaring it now makes a future second level a union widening rather than a schema migration.
- `ApprovalRecord.actor` / `RevocationRecord.actor` — caller-supplied `string | null` attribution; without it, who approved or revoked is unrecoverable, and no `Clock`/`IdGenerator` port exists to supply it later.
- `VersionProvenance.branchedFromHash` — records what the author diverged *from* at branch time, readable even after that origin version is revoked.
- `Draft.label` on all three variants, and `forkDraft`'s caller-supplied `label` — a tombstone or a fork must be identifiable without resolving content.
- `duplicate-version-id` on approve — the caller supplies `versionId`; without the check, an approval could silently overwrite an existing version.
- `RevokedVersion.previousStatus` — see decision 9.

**Corrected by the amendment [R]**: the earlier note that `abandonDraft.finalHash` was *removed* ("§Abandoned draft has no semantic hash in C1") is **void**. The amended `beacon-draft-lifecycle` Purpose and §abandonDraft both require the tombstone hash and the `Hasher` parameter. Any remaining claim in this repository that C1 has no `Hasher` dependency is superseded by decision 10. `updateDraft.label` stays removed (the spec's accepted arguments are `draftId`, `expectedRevision`, `content`).

## Data flow — abandonment **[R]**

```text
abandonDraft(beacon, cmd, hasher)
   │  getOwn(beacon.drafts, cmd.draftId)  ──> absent ──> err(draft-not-found)
   │  status !== "open"                   ─────────────> err(draft-not-open)
   │  draft.content (SemanticSource)
   ├──> project() ──> SemanticProjection ──> hasher.hash() ──> finalHash
   v
next Beacon: draft -> abandoned(finalRevision, finalHash, reason, abandonedAt,
                                origin retained, content dropped)
```

## Data flow — approval

```text
caller: ids, timestamps, reviewedHash, acknowledgment
   │
   v
approveDraft(beacon, cmd, hasher)
   │  every drafts/versions read goes through getOwn (own-property only)   [R]
   │  draft.content (SemanticSource)
   ├──> project() ──> SemanticProjection ──> hasher.hash() ──> currentHash
   │                                                             │
   │        reviewedHash === currentHash ? ──── no ──> err(reviewed-hash-mismatch)
   v yes
   │  stale := draft.origin.branchedFromVersion !== beacon.activeVersionId   [R]
   │           (plain inequality; only equality is fresh, both null-directions stale)
   │        stale && !staleOriginAcknowledged ──> err(stale-origin-not-acknowledged)
   v fresh, or stale and acknowledged
next Beacon: versions[new] = active(localNumber = max(all localNumbers) + 1,
                                    approval{approvedAt, reviewedHash,
                                             staleOriginAcknowledged})
             prior active  -> superseded(supersededBy, supersededAt)
             draft         -> closed(approvedVersionId, closedAt, content retained)
             activeVersionId -> new versionId
```

`max` runs over **all** versions including superseded and revoked, so numbers are never reused. `revokeVersion` on the active version sets `activeVersionId: null` with no reactivation; on a superseded version the pointer is untouched.

## File changes

| File | Action | Slice |
|---|---|---|
| `src/shared/result.ts` | Create — `Result`, `ok`, `err` | C1 |
| `src/shared/index.ts` | Modify — replace `export {};` | C1 |
| `src/domain/beacon/types.ts` | Create — `Beacon`, `DraftOrigin`, `Draft`; **[R]** `+ finalHash` on the abandoned variant | C1 |
| `src/domain/beacon/records.ts` **[R]** | Create — internal `getOwn` | C1 |
| `src/domain/beacon/refusals.ts` | Create, then extend in C2 | C1/C2 |
| `src/domain/beacon/drafts.ts` | Create — four draft commands; **[R]** `getOwn` at 5 sites, `Hasher`/`project` on `abandonDraft` | C1 |
| `src/domain/beacon/index.ts` | Modify — real barrel, extended in C2 (`records.ts` stays internal) | C1/C2 |
| `src/domain/beacon/versions.ts` | Create — `Version` union, `ActiveVersion`, records | C2 |
| `src/domain/beacon/approval.ts` | Create — `approveDraft`; **[R]** `getOwn` at 3 sites, plain-inequality stale gate | C2 |
| `src/domain/beacon/revocation.ts` | Create — `revokeVersion`; **[R]** `getOwn` at 1 site | C2 |
| `src/domain/beacon/active-version.ts` | Create — `resolveActiveVersion`; **[R]** `getOwn` + key/identity throw | C2 |
| `tests/domain/beacon/*` | Create — units, properties, arbitraries | C1/C2 |
| `openspec/specs/project-toolchain` | Modified delta (already authored) | C1 |

Nothing under `src/domain/semantics/`, `src/domain/ports/`, or `src/adapters/` changes. `src/domain/beacon/**` and `src/shared/**` import only relative domain/shared paths; the existing lint boundary and `tests/architecture/boundaries.test.ts` remain the proof. **[R]** `drafts.ts` newly imports `Hasher` from `../ports/index.js` and `project` from `../semantics/index.js` — both intra-domain, so the boundary proof is unaffected.

## Testing strategy

| Layer | What | How |
|---|---|---|
| Unit | Each refusal token, each success transition, check precedence, corrupt-pointer throw, **[R]** key/identity-mismatch throw, prototype-key lookups on both the read and duplicate-check sides | Table-driven Vitest cases over hand-built aggregates in `tests/domain/beacon/{drafts,approval,revocation,active-version}.test.ts` |
| Property | Aggregate invariants | `fast-check@4.9.0`, `tests/domain/beacon/arbitraries.ts` following the Slice A precedent |
| Port composition | `approveDraft` with the real `JcsSha256Hasher` | Exactly one unit case; all other approval **and abandonment [R]** cases use a deterministic test-only `Hasher` stub so domain tests do not depend on adapter behavior |

Properties:

1. **No mutation** — for any command, the input `Beacon` deep-equals a pre-call `structuredClone`, on both the `ok: true` and `ok: false` paths.
2. **Revision discipline** — a successful `updateDraft` yields exactly `currentRevision + 1`; a refused one leaves the stored draft deep-equal.
3. **Draft work is inert** — every C1 command preserves `activeVersionId` (and, in C2, `versions`).
4. **At most one active** — after any sequence of approvals and revocations, at most one version has `status: "active"`, and `activeVersionId` is `null` or names exactly that version.
5. **Monotonic numbering** — local numbers strictly increase in approval order and are never reused, including after revocations.
6. **Hash binding** — approving with a `reviewedHash` derived from any different content always refuses with `reviewed-hash-mismatch`.
7. **Prototype-key neutrality [R]** — for any id drawn from an arbitrary that includes `Object.prototype` member names (`toString`, `constructor`, `valueOf`, `hasOwnProperty`, `__proto__`), a lookup against an empty store behaves exactly as it does for a fresh random id, and a `createDraft` under such an id is never refused as a duplicate.

`Result` gets no dedicated suite; its first RED consumer is a `drafts` test. `getOwn` gets no dedicated suite either — decision 12 makes it internal, and the amended spec pins its behavior through `createDraft`/`forkDraft` scenarios, which is where the RED evidence belongs. Strict-TDD order per work unit is RED unit case → minimal GREEN → RED property → generalize. Property 4 must fail against the C2b implementation before C2c exists; if it passes on arrival, the C2b/C2c boundary was implemented ahead of its test and the RED step is invalid.

## Work units and line forecast

Nominal authored lines (additions + deletions, production + tests). The original six units landed as seven commits after relief (ii) split C2a; the remediation is **woven into those original commits by rebase**, not appended as a new unit — operator-ratified 2026-09-02, so each PR ships its own fix and no PR merges in a defective state.

| Unit | Contents | Landed | Remediation delta **[R]** | New total | Fits budget? |
|---|---|---:|---:|---:|---|
| C1a | `Result`, `Beacon`/`Draft` types, draft refusals, `createDraft`, barrels, arbitraries, no-mutation property | 293 | **45–70** — `records.ts` + `getOwn`; `createDraft` duplicate check via `getOwn`; the `createDraft` prototype-shadowing scenario test; prototype-key arbitrary + property 7 | ~338–363 | Yes |
| C1b | `updateDraft` revision-bound save + stale refusal, revision property | 198 | **12–25** — `updateDraft` lookup via `getOwn`; own-property regression case | ~210–223 | Yes |
| C1c | `forkDraft`, `abandonDraft`, inert-draft-work property | 277 | **55–80** — fork's two lookups + abandon's lookup via `getOwn`; `Draft.abandoned.finalHash`; `abandonDraft` gains `hasher` + `project()`; existing abandon cases rethreaded through a `Hasher` stub; the forkDraft prototype-shadowing scenario test; the abandonment-finalHash scenario test | ~332–357 | Yes |
| C2a-1 | `Version` model, `Beacon.versions`, arbitrary extension | 258 | **0–5** — types only; no lookup site | ~258–263 | Yes |
| C2a-2 | `revokeVersion`, `resolveActiveVersion` | 232 | **35–50** — both lookups via `getOwn`; key/identity throw in `resolveActiveVersion`; the identity-mismatch scenario test; revoke own-property regression case | ~267–282 | Yes |
| C2b | `approveDraft` admission checks + first-approval success path, hash-binding property (+ C2b-r1 stale-origin test) | 545 | **25–40** — stale gate to plain inequality; three lookups via `getOwn`; the null-active stale-origin scenario test | ~570–585 | `size:exception` |
| C2c | Supersession, monotonic numbering, single-active + numbering properties | 186 | **0** — rebase only, no authored change | 186 | Yes |

**Remediation total ≈ 172–270 authored lines** across the stack. Every unit except C2b stays under the 400-line budget with room; C2c is a pure rebase. C2b already carries the operator-ratified `size:exception` (545); the remediation moves it to ≈570–585, which the existing exception is expected to absorb but which the operator should re-confirm at apply, since it is a fresh number rather than the one ratified.

Rollback is per unit in reverse order; the final rollback restores `src/domain/beacon/index.ts` and `src/shared/index.ts` to `export {};`. No consumer, persistence, or migration exists. Because the stack is rebased and force-pushed, rollback of any single unit invalidates every unit above it.

## Threat matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary. Pure in-process TypeScript with no I/O; the `Hasher` port is consumed, not implemented, here. Prototype-key handling (decision 12) is an input-integrity concern inside the domain, not a process boundary; it is covered by the spec scenarios and property 7 rather than by a threat-matrix row.

## Migration / rollout

No migration required. Purely additive; no persisted data exists until Slice D. `Draft.abandoned.finalHash` is a required field on a type that has never been persisted, so it is a type widening with no on-disk consequence.

## Open questions

- [x] `forkDraft` on an abandoned source — resolved: the fork requirement was amended to name the `source-draft-has-no-content` refusal.
- [x] Whether `revokeVersion`/`approveDraft` need the key-vs-embedded `versionId` check — resolved by decision 13: no, `resolveActiveVersion` only.

Deliberately deferred, not blocking: `Clock`/`IdGenerator` ports (arrive with the application slice that needs them), rich stale-origin impact comparison (CLI/application), import-time local renumbering (lifecycle §1, belongs with Slice D import), the store-level uniqueness of portable version ids across beacons, and extending `getOwn` to Slice D's rehydration path once a persisted store exists.
