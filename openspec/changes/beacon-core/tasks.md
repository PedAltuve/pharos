# Tasks: Beacon Core (Slice C)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines (authored) | Nominal ~1,514 (C1 ~702 + C2 ~812, design floor); calibrated band ~2,420–3,180 applying Slice A's observed 1.6–2.1x miss factor |
| 400-line budget risk | High — every one of the six design work units risks landing above budget once calibrated; C1a and C2a are explicitly flagged by design at ~620–810 each, and C2b's own nominal (270) already crosses 400 once the same factor is applied (~432–567) |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (C1a) → PR 2 (C1b) → PR 3 (C1c) → PR 4 (C2a) → PR 5 (C2b) → PR 6 (C2c) — six chained PRs, one per design work unit, in the design's dependency order |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending — operator chooses stacked-to-main, feature-branch-chain, or size-exception at the guard; these tasks present the numbers and slice boundaries, not the decision. Work units below are cut so either stacked-to-main (each PR merges independently in order) or feature-branch-chain (each PR bases on the prior PR's branch) works unchanged. |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Reconciliation with design.md

Design's nominal per-unit forecast (C1a 387, C1b 153, C1c 162, C2a 387, C2b 270, C2c 155) is carried forward unchanged as the floor. This forecast does not revise those numbers; it adds the calibrated band the design already computed (1.6–2.1x, from Slice A's 775→1643 miss) to every unit, not only the two design names explicitly:

| Unit | Nominal | Calibrated band (1.6–2.1x) | Risk | Notes |
|---|---:|---:|---|---|
| C1a | 387 | ~620–810 | High | Design-flagged; largest single unit — types + refusals + createDraft + barrels + arbitraries + property 1 |
| C1b | 153 | ~245–321 | Low–Medium | Fits even at the upper calibrated bound |
| C1c | 162 | ~259–340 | Medium | Close to budget at the upper calibrated bound |
| C2a | 387 | ~620–810 | High | Design-flagged; Version model + revokeVersion + resolveActiveVersion |
| C2b | 270 | ~432–567 | High | Not named by design's two flagged units, but nominal already implies calibrated overrun; MUST NOT split tests from implementation (design constraint) |
| C2c | 155 | ~248–326 | Medium | Fits even at the upper calibrated bound, but depends on C2b landing first |

Pre-agreed relief order from design (apply in this order only if a unit's actual authored diff exceeds 400 lines): (i) move `tests/domain/beacon/arbitraries.ts` into its own preceding unit ahead of C1a and/or C2a; (ii) split C2a's `Version` model (`versions.ts`) away from `revokeVersion` (`revocation.ts`) into two units; (iii) an explicit `size:exception` recorded on the affected unit. C2b is the invariant-dense heart and MUST NOT be split by pulling its tests out of its implementation commit — if C2b overruns, only `size:exception` applies to it, not a test/implementation split.

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| C1a | `Result`, `Beacon`/`Draft` closed-union types, draft refusals, `createDraft`, real barrels, `arbitraries.ts`, no-mutation property | PR 1 | `npx vitest run tests/domain/beacon/drafts.test.ts` | N/A — pure in-process TypeScript, no I/O (design Threat Matrix: N/A) | Delete `src/shared/result.ts`, `src/domain/beacon/{types,refusals,drafts}.ts`, `tests/domain/beacon/{drafts.test.ts,arbitraries.ts}`; revert `src/shared/index.ts` and `src/domain/beacon/index.ts` to `export {};` |
| C1b | `updateDraft` revision-bound save + stale refusal, revision property | PR 2 (base = PR 1 branch, or independent if stacked) | `npx vitest run tests/domain/beacon/drafts.test.ts` | N/A | Revert `updateDraft`/`stale-draft-revision`/`draft-not-found`/`draft-not-open` additions in `drafts.ts`/`refusals.ts`; revert added test cases in `drafts.test.ts` |
| C1c | `forkDraft`, `abandonDraft`, inert-draft-work property (C1 scope) | PR 3 (base = PR 2 branch) | `npx vitest run tests/domain/beacon/drafts.test.ts` | N/A | Revert `forkDraft`/`abandonDraft`/`source-draft-has-no-content` additions in `drafts.ts`/`refusals.ts`; revert added test cases |
| C2a | `Version` closed union, `ApprovalRecord`/`VersionProvenance`/`RevocationRecord`, `revokeVersion`, `resolveActiveVersion`, `Beacon.versions`, arbitrary extension | PR 4 (base = PR 3 branch) | `npx vitest run tests/domain/beacon/revocation.test.ts tests/domain/beacon/active-version.test.ts` | N/A | Delete `src/domain/beacon/{versions,revocation,active-version}.ts`; revert `Beacon.versions` line in `types.ts`; revert `version-not-found`/`version-already-revoked` in `refusals.ts`; delete associated test files |
| C2b | `approveDraft` admission checks (ADR 6 fixed order) + first-approval success path, hash-binding property | PR 5 (base = PR 4 branch) | `npx vitest run tests/domain/beacon/approval.test.ts` | N/A | Delete `src/domain/beacon/approval.ts`; revert `duplicate-version-id`/`reviewed-hash-mismatch`/`stale-origin-not-acknowledged` in `refusals.ts`; delete `approval.test.ts` — tests and implementation revert together |
| C2c | Supersession, monotonic numbering, single-active + numbering properties | PR 6 (base = PR 5 branch) | `npx vitest run tests/domain/beacon/approval.test.ts` | N/A | Revert the supersession/numbering branch in `approval.ts`; revert property additions in `approval.test.ts`/`arbitraries.ts` |

## Scope and edit authority

- [x] 0.1 Restrict implementation edits to: `src/shared/result.ts`, `src/shared/index.ts`, `src/domain/beacon/types.ts`, `src/domain/beacon/refusals.ts`, `src/domain/beacon/drafts.ts`, `src/domain/beacon/versions.ts`, `src/domain/beacon/approval.ts`, `src/domain/beacon/revocation.ts`, `src/domain/beacon/active-version.ts`, `src/domain/beacon/index.ts`, `tests/domain/beacon/**`, this change's files under `openspec/changes/beacon-core/`, and task/apply evidence. <!-- sdd-owner: implementation -->
- [x] 0.2 Prove apply does not edit `src/domain/semantics/**`, `src/domain/ports/**`, `src/adapters/**`, `src/application/**`, `src/cli/**`, `openspec/changes/archive/2026-09-02-semantic-projection-core/**` (read-only), or `openspec/changes/archive/2026-09-02-semantic-projection-hashing/**` (read-only); C2b's port-composition case only consumes `src/domain/ports/hasher.ts` (read-only) and `src/adapters/hashing/**` (read-only) unchanged. <!-- sdd-owner: implementation --> (verified for C1a via `git diff --stat 582fc1f -- src/domain/semantics/ src/domain/ports/ src/adapters/ src/application/ src/cli/` = empty; re-verify per remaining unit)
- [x] 0.3 Keep C2b's tests and implementation in the same commit/PR; do not shrink C2b by pulling `approval.test.ts` out of the `approveDraft` implementation commit (design constraint). <!-- sdd-owner: implementation --> (kept as one commit `11c5936`, 507 lines, `size:exception` recorded per pre-authorization)
- [x] 0.4 Confirm the design Threat Matrix is N/A in full (no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary); no threat-matrix-derived RED test is owed by any unit below. <!-- sdd-owner: implementation -->
- [x] 0.5 Confirm `openspec/changes/beacon-core/specs/project-toolchain/spec.md` (read-only) already covers this slice's directory-skeleton scenarios; no `docs/technical-design-v1.md` edit is needed because Beacon Core adds no new architectural directory. <!-- sdd-owner: implementation -->

## Phase 1: C1a — Result, Beacon/Draft types, draft refusals, createDraft (PR 1)

Maps to: `beacon-draft-lifecycle` §Generic Result Refusal Carrier (Scenario: Refusal is a value, not a throw), §Beacon and Draft Are Closed, Caller-Identified, §createDraft Adds an Open Draft (Scenario: First draft on a Beacon with no active version; Scenario: Duplicate draft id is refused). ADRs 1, 2, 3, 4, 7. Testing-strategy property 1 (no mutation).

- [x] 1.1 RED: write `tests/domain/beacon/drafts.test.ts` — `createDraft` first-draft-on-empty-Beacon success (revision 1, `origin.branchedFromVersion: null`) and duplicate-`draftId` refusal; confirm it fails (no exports yet). <!-- sdd-owner: implementation -->
- [x] 1.2 GREEN: create `src/shared/result.ts` — `Result<T, E>`, `ok`, `err` per ADR 1. <!-- sdd-owner: implementation -->
- [x] 1.3 GREEN: create `src/domain/beacon/types.ts` — `Beacon` (`beaconId`, `title`, `drafts`, `activeVersionId`; `versions` deferred to C2a per ADR 7), `DraftOrigin`, and the `Draft` closed union (`open`/`closed`/`abandoned`) exactly per interfaces. <!-- sdd-owner: implementation -->
- [x] 1.4 GREEN: create `src/domain/beacon/refusals.ts` with `duplicate-draft-id` and the `BeaconRefusal` union (single member for now, widened per later unit). <!-- sdd-owner: implementation -->
- [x] 1.5 GREEN: create `src/domain/beacon/drafts.ts` — `createDraft(beacon, cmd)` implementing the collision refusal and open-draft-at-revision-1 success. <!-- sdd-owner: implementation -->
- [x] 1.6 GREEN: replace `src/shared/index.ts` and `src/domain/beacon/index.ts` placeholders with real barrels exporting the above. <!-- sdd-owner: implementation -->
- [x] 1.7 Confirm `tests/domain/beacon/drafts.test.ts` passes: `npx vitest run tests/domain/beacon/drafts.test.ts`. <!-- sdd-owner: implementation -->
- [x] 1.8 RED: create `tests/domain/beacon/arbitraries.ts` (fast-check generators for `Beacon`/`Draft`/commands, following the Slice A precedent) and add property 1 (no mutation: input `Beacon` deep-equals a pre-call `structuredClone` on both `ok` paths) to `drafts.test.ts`; confirm it fails or is vacuous before generalizing `createDraft`. <!-- sdd-owner: implementation --> (was vacuous — `createDraft` already non-mutating; see 1.9)
- [x] 1.9 GREEN: confirm property 1 passes against `createDraft`; vacuous-guard once — temporarily let `createDraft` mutate its input, confirm the property fails, then restore. <!-- sdd-owner: implementation --> (fault injected, property failed, reverted)
- [x] 1.10 Final verification: `npx vitest run tests/domain/beacon/drafts.test.ts`; `npm run lint`; `npm run typecheck`; `npm test`; `npx vitest run tests/architecture/boundaries.test.ts`. <!-- sdd-owner: implementation --> (all green)

## Phase 2: C1b — updateDraft (PR 2)

Maps to: `beacon-draft-lifecycle` §updateDraft Is Revision-Bound (Scenario: Stale save is refused without overwrite; Scenario: Update against a closed draft is refused). Testing-strategy property 2 (revision discipline).

- [x] 2.1 RED: extend `tests/domain/beacon/drafts.test.ts` — successful `updateDraft` increments `revision` by 1 and replaces `content`; stale `expectedRevision` refused without mutation; missing draft refused; non-`open` (`closed`) draft refused; confirm it fails. <!-- sdd-owner: implementation -->
- [x] 2.2 GREEN: add `draft-not-found`, `draft-not-open`, `stale-draft-revision` to `refusals.ts`. <!-- sdd-owner: implementation -->
- [x] 2.3 GREEN: implement `updateDraft(beacon, cmd)` in `drafts.ts` per the refusal order (not-found → not-open → stale-revision) and the exact `revision + 1` success rule. <!-- sdd-owner: implementation -->
- [x] 2.4 RED: add property 2 to `drafts.test.ts`/`arbitraries.ts` — a successful `updateDraft` yields exactly `currentRevision + 1`; a refused one leaves the stored draft deep-equal; confirm it fails before generalizing. <!-- sdd-owner: implementation --> (added alongside 2.1, genuinely failed pre-implementation)
- [x] 2.5 GREEN: confirm property 2 passes. <!-- sdd-owner: implementation -->
- [x] 2.6 Final verification: `npx vitest run tests/domain/beacon/drafts.test.ts`; `npm run lint`; `npm run typecheck`; `npm test`; `npx vitest run tests/architecture/boundaries.test.ts`. <!-- sdd-owner: implementation --> (all green)

## Phase 3: C1c — forkDraft, abandonDraft (PR 3)

Maps to: `beacon-draft-lifecycle` §forkDraft Preserves Lineage (Scenario: Fork after a rejected stale save; Scenario: Fork of an abandoned draft is refused), §abandonDraft Tombstones an Open Draft (Scenario: Abandonment discards content but keeps lineage; Scenario: Double abandonment is refused), §Scenario: Abandoned draft has no semantic hash in C1. Spec-conformance note: `draft-not-open` is removed from fork's refusal list; forking a `closed` draft is legal. Testing-strategy property 3, C1 scope (draft work preserves `activeVersionId`).

- [x] 3.1 RED: extend `drafts.test.ts` — `forkDraft` from an `open` source and from a `closed` source (both legal); source-not-found refused; new-`draftId` collision refused; fork of an `abandoned` source refused with `source-draft-has-no-content` and NOT `draft-not-open`; confirm it fails. <!-- sdd-owner: implementation -->
- [x] 3.2 GREEN: add `source-draft-has-no-content` to `refusals.ts`; implement `forkDraft(beacon, cmd)` in `drafts.ts` copying `content`+`origin` and overriding `origin.forkedFromDraft`, refusing exactly per the spec-conformance-resolved list (missing source, colliding id, abandoned source). <!-- sdd-owner: implementation -->
- [x] 3.3 RED: extend `drafts.test.ts` — `abandonDraft` on an `open` draft discards `content`, keeps `origin`/`finalRevision`/`reason`/`abandonedAt`, and the tombstone carries no semantic-hash field; double-abandonment refused (`draft-not-open`); confirm it fails. <!-- sdd-owner: implementation -->
- [x] 3.4 GREEN: implement `abandonDraft(beacon, cmd)` in `drafts.ts`, reusing `draft-not-found`/`draft-not-open`. <!-- sdd-owner: implementation -->
- [x] 3.5 RED: extend `arbitraries.ts`/`drafts.test.ts` with property 3, C1 scope — every C1 command (`createDraft`, `updateDraft`, `forkDraft`, `abandonDraft`) preserves `activeVersionId`; confirm it fails before generalizing if any command touches the pointer. <!-- sdd-owner: implementation --> (added alongside 3.1/3.3, genuinely failed pre-implementation)
- [x] 3.6 GREEN: confirm property 3 (C1 scope) passes across all four draft commands. <!-- sdd-owner: implementation -->
- [x] 3.7 Final verification: `npx vitest run tests/domain/beacon/drafts.test.ts`; `npm run lint`; `npm run typecheck`; `npm test`; `npx vitest run tests/architecture/boundaries.test.ts`. <!-- sdd-owner: implementation --> (all green)

## Phase 4: C2a — Version model, revokeVersion, resolveActiveVersion (PR 4)

Maps to: `beacon-version-lifecycle` §Version Is a Closed Union (structural), §revokeVersion Works on Any Approved Version (Scenario: Revoking the active version clears the pointer; Scenario: Double revocation is refused), §resolveActiveVersion Is a Pure Lookup (Scenario: No active version resolves to null). ADR 5 (corrupt-pointer throw, unspecified region), ADR 7 (`Beacon.versions` one-line addition), ADR 9 (`RevokedVersion.previousStatus`).

- [x] 4.1 RED: write `tests/domain/beacon/revocation.test.ts` — `revokeVersion` on a `superseded` version, on the `active` version (pointer cleared, `previousStatus` recorded), version-not-found refused, already-`revoked` refused without mutation; confirm it fails. <!-- sdd-owner: implementation -->
- [x] 4.2 GREEN: create `src/domain/beacon/versions.ts` — `Version` closed union (`active`/`superseded`/`revoked`), `ActiveVersion`, `ApprovalRecord`, `VersionProvenance`, `RevocationRecord` exactly per interfaces. <!-- sdd-owner: implementation -->
- [x] 4.3 GREEN: add the `versions: Readonly<Record<string, Version>>` line and its import to `src/domain/beacon/types.ts` (ADR 7 — one line, no other change). <!-- sdd-owner: implementation -->
- [x] 4.4 GREEN: add `version-not-found`, `version-already-revoked` to `refusals.ts`. <!-- sdd-owner: implementation -->
- [x] 4.5 GREEN: create `src/domain/beacon/revocation.ts` — `revokeVersion(beacon, cmd)`; revoking `active` sets `activeVersionId: null` with `previousStatus: "active"`; revoking `superseded` leaves the pointer untouched with `previousStatus: "superseded"`. <!-- sdd-owner: implementation -->
- [x] 4.6 RED: write `tests/domain/beacon/active-version.test.ts` — `resolveActiveVersion` returns `null` when `activeVersionId` is `null`; returns the matching `ActiveVersion` otherwise; throws a plain `Error` when the pointer names an absent id or a non-`active` version (ADR 5, unspecified region — pin the throw, not a spec refusal); confirm it fails. <!-- sdd-owner: implementation -->
- [x] 4.7 GREEN: create `src/domain/beacon/active-version.ts` — `resolveActiveVersion(beacon)` per ADR 5. <!-- sdd-owner: implementation -->
- [x] 4.8 GREEN: extend `src/domain/beacon/index.ts` barrel with `versions.ts`/`revocation.ts`/`active-version.ts` exports. <!-- sdd-owner: implementation -->
- [x] 4.9 GREEN: extend `tests/domain/beacon/arbitraries.ts` with `Version`/`ApprovalRecord`/`RevocationRecord` generators, and extend property 3 (from Phase 3) to also assert C1 commands preserve `versions` now that the field exists. <!-- sdd-owner: implementation -->
- [x] 4.10 Final verification: `npx vitest run tests/domain/beacon/revocation.test.ts tests/domain/beacon/active-version.test.ts`; `npm run lint`; `npm run typecheck`; `npm test`; `npx vitest run tests/architecture/boundaries.test.ts`. <!-- sdd-owner: implementation --> (all green; C2a split into two commits per relief (ii): `ea01c9b` Version model 258 lines, `abfecaa` revokeVersion 232 lines)

## Phase 5: C2b — approveDraft admission checks + first-approval success (PR 5)

Maps to: `beacon-version-lifecycle` §approveDraft Re-Verifies the Reviewed Hash (Scenario: Recomputed hash mismatch refuses approval), §Stale-Origin Approval Requires Explicit Acknowledgment (Scenario: Stale origin without acknowledgment is refused; Scenario: Stale origin with acknowledgment proceeds), §Approval Returns One Atomic Beacon (first-approval case: no prior active version). ADR 6 (fixed refusal order: existence → openness → duplicate version id → hash re-verification → stale-origin acknowledgment), ADR 8 (approval fact lives only in `ApprovalRecord`), ADR 10 (`Hasher` as explicit third parameter). Testing-strategy property 6 (hash binding) and the port-composition case with the real `JcsSha256Hasher`.

- [x] 5.1 RED: write `tests/domain/beacon/approval.test.ts` with a deterministic test-only `Hasher` stub — admission-check refusals in ADR 6 order: `draft-not-found`, `draft-not-open`, `duplicate-version-id`, `reviewed-hash-mismatch`, `stale-origin-not-acknowledged`; add one precedence case where both hash mismatch and unacknowledged stale-origin hold, asserting `reviewed-hash-mismatch` wins; confirm it fails (no `approval.ts` yet). <!-- sdd-owner: implementation -->
- [x] 5.2 GREEN: add `duplicate-version-id`, `reviewed-hash-mismatch`, `stale-origin-not-acknowledged` to `refusals.ts`. <!-- sdd-owner: implementation -->
- [x] 5.3 GREEN: create `src/domain/beacon/approval.ts` — `approveDraft(beacon, cmd, hasher)` implementing the fixed-order admission checks only (no success path yet); recompute `hasher.hash(project(draft.content))` and compare to `cmd.reviewedHash`. <!-- sdd-owner: implementation -->
- [x] 5.4 RED: extend `approval.test.ts` — first-approval success (Beacon with `activeVersionId: null`): new `active` `Version` at `localNumber: 1`, `ApprovalRecord` (`approvedAt`, `reviewedHash`, `staleOriginAcknowledged`, `assurance: "operator_confirmed"`, `actor`), draft becomes `closed` (`approvedVersionId`, `closedAt`, `content` retained), `activeVersionId` set to the new id; confirm it fails. <!-- sdd-owner: implementation -->
- [x] 5.5 GREEN: implement the first-approval success path in `approval.ts` (no prior-active branch; supersession is out of scope for this unit). <!-- sdd-owner: implementation -->
- [x] 5.6 RED: add one port-composition unit case wiring the real `src/adapters/hashing` `JcsSha256Hasher` (read-only import) through `approveDraft`, proving cast-free composition end to end; confirm it fails before wiring. <!-- sdd-owner: implementation --> (vacuous — approveDraft already generic over Hasher; vacuous-guard performed, see 5.7)
- [x] 5.7 GREEN: confirm the port-composition case passes; all other approval cases keep using the stub `Hasher`. <!-- sdd-owner: implementation --> (vacuous-guard: hardcoded currentHash, confirmed test failed, reverted)
- [x] 5.8 RED: add fast-check property 6 (hash binding) to `arbitraries.ts`/`approval.test.ts` — approving with a `reviewedHash` derived from any content different from `draft.content` always refuses `reviewed-hash-mismatch`; confirm it fails before generalizing. <!-- sdd-owner: implementation --> (vacuous — see 5.9)
- [x] 5.9 GREEN: confirm property 6 passes; vacuous-guard once — temporarily skip the hash comparison, confirm the property fails, then restore. <!-- sdd-owner: implementation --> (`if (false)` injected, property failed, reverted)
- [x] 5.10 GREEN: extend `src/domain/beacon/index.ts` barrel with the `approveDraft` export. <!-- sdd-owner: implementation -->
- [x] 5.11 Final verification: `npx vitest run tests/domain/beacon/approval.test.ts`; `npm run lint`; `npm run typecheck`; `npm test`; `npx vitest run tests/architecture/boundaries.test.ts`. <!-- sdd-owner: implementation --> (all green; committed as one unit `11c5936`, 507 lines, `size:exception` recorded)

## Phase 6: C2c — Supersession, monotonic numbering (PR 6)

Maps to: `beacon-version-lifecycle` §Approval Returns One Atomic Beacon (Scenario: Approval supersedes the prior active version), §Version Is a Closed Union (Scenario: Local numbers are monotonic per Beacon). Testing-strategy properties 4 (at most one active) and 5 (monotonic numbering, never reused). RED-first boundary pinned by design: the supersession test in 6.1 MUST genuinely fail against C2b's first-approval-only implementation before this unit's production change lands — if it passes on arrival, the C2b/C2c boundary was implemented ahead of its test and the RED step is invalid.

- [x] 6.1 RED: extend `approval.test.ts` — approve a second draft on a Beacon with `activeVersionId: "ver_1"`: `ver_1` becomes `superseded` with `supersededBy`/`supersededAt` set, the new version is `active` at `localNumber: 2`, `activeVersionId` points at it; run against the landed C2b code and record that it FAILS (C2b only implements the no-prior-active branch). <!-- sdd-owner: implementation --> (genuinely failed: `expected 'active' to be 'superseded'`, see apply-progress.md for full evidence)
- [x] 6.2 GREEN: extend `approval.ts` with the supersession branch — mark the prior `active` version `superseded`, compute the new `localNumber` as `max` over ALL versions (including `superseded`/`revoked`) plus 1, so numbers are never reused. <!-- sdd-owner: implementation -->
- [x] 6.3 RED: add fast-check property 4 to `arbitraries.ts`/`approval.test.ts` — after any sequence of approvals and revocations, at most one version has `status: "active"`, and `activeVersionId` is `null` or names exactly that version; run before 6.2's fix lands (or re-run once against a temporarily reverted supersession branch) and confirm it FAILS, per the RED-first boundary above. <!-- sdd-owner: implementation --> (reverted supersession branch with `if (false && ...)`, confirmed genuine failure — 2 active versions found — then restored)
- [x] 6.4 GREEN: confirm property 4 passes with the supersession branch wired. <!-- sdd-owner: implementation -->
- [x] 6.5 RED: add fast-check property 5 — local numbers strictly increase in approval order and are never reused, including after revocations; confirm it fails before generalizing if numbering is not sourced from all versions. <!-- sdd-owner: implementation --> (filtered out revoked versions from the max calc, confirmed genuine failure — number reused after revoke+approve — then restored)
- [x] 6.6 GREEN: confirm property 5 passes. <!-- sdd-owner: implementation -->
- [x] 6.7 Final verification: `npx vitest run tests/domain/beacon/approval.test.ts`; `npm run lint`; `npm run typecheck`; `npm test`; `npx vitest run tests/architecture/boundaries.test.ts`. <!-- sdd-owner: implementation --> (all green; committed as `7f64e45`, 186 lines, well under budget)

## Phase 7: Overall Final Verification (sequential, after C1a–C2c all land)

- [x] 7.1 From a clean dependency state, run `npm ci`, then `npm test`, `npm run test:watch -- --run`, `npm run build`, `npm run lint`, `npm run typecheck`; record each exit result. <!-- sdd-owner: implementation -->
- [x] 7.2 Re-run required-base `git diff --exit-code 582fc1f -- src/domain/semantics/ src/domain/ports/ src/adapters/`; confirm zero diff (frozen Slices A/B untouched). <!-- sdd-owner: implementation -->
- [x] 7.3 Confirm `tests/architecture/boundaries.test.ts` (read-only) still passes and `src/domain/beacon/**`/`src/shared/**` import only relative domain/shared paths. <!-- sdd-owner: implementation -->
- [x] 7.4 Confirm all `proposal.md` (read-only) Success Criteria are met; record each authored-line count (additions+deletions) per unit and cumulative against the reconciled forecast above, flagging any unit that exceeded 400 lines for a `size:exception` note or the pre-agreed relief order. <!-- sdd-owner: implementation -->
- [x] 7.5 Confirm per-unit rollback in reverse order (C2c → C2a → C1c → C1a) restores `src/domain/beacon/index.ts` and `src/shared/index.ts` to `export {};`. <!-- sdd-owner: implementation -->

## Delivery boundary

Delivery actions (commit, push, PR creation, and lifecycle gates) remain outside SDD implementation task completion. No review actor or post-apply lifecycle task is included because receipt-driven development is opt-in and currently disabled. Chain strategy (stacked-to-main vs. feature-branch-chain) and any `size:exception` are decided at the `ask-on-risk` guard before `sdd-apply` begins.

# Remediation (post-review amendment, 2026-09-02)

Addendum against the amended `beacon-draft-lifecycle`/`beacon-version-lifecycle` specs and the amended `design.md` ([R] rows 5, 10-13). Fixes are **woven into the original stacked commits by interactive rebase**, not appended as a new unit — operator-ratified. Existing Phase 1-7 tasks above are unchanged and unrenumbered.

## Remediation Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines (remediation delta) | ~172-270 authored lines across 7 units, per design work-unit table |
| 400-line budget risk | Low for the new increments (0-80 lines/unit); C2b's cumulative unit total remains above 400 under its pre-existing `size:exception` |
| Chained PRs recommended | Yes — reuse the existing stack; PR #9 (C2a) splits into 2: C2a-1 (versions model) and C2a-2 (revocation) |
| Suggested split | PR C1a -> PR C1b -> PR C1c -> PR C2a-1 -> PR C2a-2 -> PR C2b -> PR C2c (7 PRs, rebuilt via rebase, force-pushed) |
| Delivery strategy | ask-on-risk (unchanged) |
| Chain strategy | stacked-to-main (established); rebase-in-place per unit, not append |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: Low

### Per-unit new totals

| Unit | Landed | Remediation delta | New total | Exception status | Decision needed |
|---|---:|---:|---:|---|---|
| C1a | 293 | 45-70 | 338-363 | None | No |
| C1b | 198 | 12-25 | 210-223 | None | No |
| C1c | 277 | 55-80 | 332-357 | None | No |
| C2a-1 | 258 | 0-5 | 258-263 | None | No |
| C2a-2 | 232 | 35-50 | 267-282 | None | No |
| C2b | 545 | 25-40 | 570-585 | `size:exception` (previously ratified at 545) | Yes — re-confirm at new total; session-ratified ceiling 600, STOP if real diff exceeds it |
| C2c | 186 | 0 | 186 | None (rebase only) | No |

## Phase 8: Remediation rebase strategy (sequential, drives Phase 9-16)

- [x] 8.1 Rebuild the stack bottom-up via interactive rebase/cherry-pick, one unit at a time, in stack order (C1a -> C1b -> C1c -> C2a-1 -> C2a-2 -> C2b -> C2c); amend each unit's original commit(s) in place, preserving Conventional Commit messages, no AI attribution. <!-- sdd-owner: implementation --> (all seven units rebuilt; see per-commit tasks 8.2-8.9)
- [x] 8.2 Checkout `change/beacon-core-c1a`; apply Phase 9 fixes; `git commit --amend` on `0e923d2`; record the new SHA. <!-- sdd-owner: implementation --> (new SHA `bf058ff`)
- [x] 8.3 `git rebase --onto <c1a-new-sha> 0e923d2 change/beacon-core-c1b`; apply Phase 10 fixes; amend the replayed `e115d1c`. <!-- sdd-owner: implementation --> (rebased onto `bf058ff`; amended -> `8753c38`)
- [x] 8.4 `git rebase --onto <c1b-new-sha> e115d1c change/beacon-core-c1c`; apply Phase 11 fixes; amend the replayed `2244cac`. <!-- sdd-owner: implementation --> (rebased onto `8753c38`; amended -> `ac48d48`)
- [x] 8.5 `git checkout -b change/beacon-core-c2a1 <c1c-new-sha>`; `git cherry-pick ea01c9b`; apply Phase 12 delta (amend only if non-zero). <!-- sdd-owner: implementation --> (created from `ac48d48`; cherry-picked `ea01c9b` -> `5b8a495`, one import-line conflict in `drafts.test.ts` resolved by merging both import sets; delta genuinely 0, no amend)
- [x] 8.6 `git rebase --onto change/beacon-core-c2a1 ea01c9b change/beacon-core-c2a` (drops the promoted `ea01c9b`, replays `abfecaa` on `change/beacon-core-c2a1`); apply Phase 13 fixes; amend the replayed `abfecaa`. <!-- sdd-owner: implementation --> (rebase clean, no conflicts; amended -> `7893900`)
- [x] 8.7 `git rebase --onto <c2a-new-sha> abfecaa change/beacon-core-c2b`; apply Phase 14 fixes into the replayed `11c5936`; keep the replayed `84f6635` on top, squashing only if 14.5 finds duplicate coverage. <!-- sdd-owner: implementation --> (rebased onto `7893900`, clean; amended -> `d389973`; kept `84f6635` distinct -> `f7cadf4`; functional verification green; line-budget (14.6) re-ratified by the operator at 611 — see 14.6 note)
- [x] 8.8 `git rebase --onto <c2b-new-sha> 84f6635 change/beacon-core-c2c`; apply Phase 15 (rebase + the folded-in touch-point fix) to the replayed commit. <!-- sdd-owner: implementation --> (`git rebase --onto f7cadf4 84f6635 change/beacon-core-c2c` — clean, zero conflicts; supersession commit amended `222b24e` -> `312696b` with the 10th `getOwn` touch point, see Phase 15)
- [x] 8.9 After each unit's amend/rebase, run that unit's final verification (scoped `npm test`, lint, typecheck, boundaries) before moving up the stack; do not proceed on red. <!-- sdd-owner: implementation --> (followed through Phase 16; every unit green before moving up the stack)
- [ ] 8.10 Force-push each rebased branch (`-c1a`, `-c1b`, `-c1c`, `-c2a1`, `-c2a`, `-c2b`, `-c2c`) once its own unit is green. <!-- deferred to the orchestrator's delivery step, per this run's instructions -->

## Phase 9: C1a remediation — `records.ts` getOwn + createDraft fix (branch `change/beacon-core-c1a`, commit `0e923d2`)

Maps to: `beacon-draft-lifecycle` §Record Lookups Use Own-Property Semantics (Scenario: createDraft accepts a prototype-shadowing id). Design ADR 12, `getOwn` touch-point row `createDraft`/`drafts.ts`. Delta ~45-70 (new total ~338-363).

- [x] 9.1 RED: extend `tests/domain/beacon/drafts.test.ts` — `createDraft` with `draftId: "toString"` on an empty Beacon succeeds, one open draft keyed `"toString"`, not refused as duplicate; confirm it fails against the current bare-index lookup. <!-- sdd-owner: implementation --> (genuinely failed: `expected false to be true`)
- [x] 9.2 GREEN: create `src/domain/beacon/records.ts` — internal `getOwn<T>(record, key)` per design interfaces; do NOT re-export from `src/domain/beacon/index.ts`. <!-- sdd-owner: implementation -->
- [x] 9.3 GREEN: replace `drafts[cmd.draftId]` in `createDraft`'s duplicate check (`drafts.ts`) with `getOwn(beacon.drafts, cmd.draftId)`. <!-- sdd-owner: implementation -->
- [x] 9.4 RED: extend `arbitraries.ts`/`drafts.test.ts` with property 7 (prototype-key neutrality) over `Object.prototype` member names (`toString`, `constructor`, `valueOf`, `hasOwnProperty`, `__proto__`); confirm it fails before the fix. <!-- sdd-owner: implementation --> (vacuous-guard: reverted getOwn fix, confirmed genuine failure, restored)
- [x] 9.5 GREEN: confirm property 7 passes against the `getOwn`-routed `createDraft`. <!-- sdd-owner: implementation -->
- [x] 9.6 Unit final verification: `npx vitest run tests/domain/beacon/drafts.test.ts`; `npm run lint`; `npm run typecheck`; `npm test`; `npx vitest run tests/architecture/boundaries.test.ts`; record the authored-line delta against ~45-70. <!-- sdd-owner: implementation --> (all green; amended `0e923d2` -> `bf058ff`, 356 authored lines vs 293 landed = +63 delta, within ~45-70 estimate, well under 400 budget)

## Phase 10: C1b remediation — updateDraft getOwn (branch `change/beacon-core-c1b`, commit `e115d1c`)

Maps to: `beacon-draft-lifecycle` §Record Lookups Use Own-Property Semantics (domain-wide). `getOwn` touch-point row `updateDraft`/`drafts.ts`. Delta ~12-25 (new total ~210-223).

- [x] 10.1 RED: extend `drafts.test.ts` — `updateDraft` against an own-property draft keyed `"toString"` succeeds and increments revision; `draftId: "constructor"` with no own entry refuses `draft-not-found`; confirm it fails. <!-- sdd-owner: implementation --> (own-property case was already vacuous — own properties shadow the prototype on read; the no-own-entry case genuinely failed: `draft-not-open`/`status: undefined` instead of `draft-not-found`)
- [x] 10.2 GREEN: replace `drafts[cmd.draftId]` in `updateDraft` (`drafts.ts`) with `getOwn(beacon.drafts, cmd.draftId)`. <!-- sdd-owner: implementation -->
- [x] 10.3 Unit final verification: `npx vitest run tests/domain/beacon/drafts.test.ts`; `npm run lint`; `npm run typecheck`; `npm test`; `npx vitest run tests/architecture/boundaries.test.ts`; record the delta against ~12-25. <!-- sdd-owner: implementation --> (all green; amended `e115d1c` -> `8753c38`, 230 authored lines vs 198 landed = +32 delta, under 400 budget)

## Phase 11: C1c remediation — forkDraft/abandonDraft getOwn, finalHash, Hasher (branch `change/beacon-core-c1c`, commit `2244cac`)

Maps to: `beacon-draft-lifecycle` §Record Lookups Use Own-Property Semantics (Scenario: forkDraft refuses a prototype-shadowing id with no own entry), §Abandonment records the semantic hash of the final content. Design ADR 10, 12; `getOwn` touch-point rows `forkDraft` (x2), `abandonDraft`; `types.ts` `+ finalHash` (lands here, where the field is first consumed, per the design's test-placement constraint). Delta ~55-80 (new total ~332-357).

- [x] 11.1 GREEN: add `finalHash: string` to the `abandoned` member of the `Draft` union in `src/domain/beacon/types.ts` per the amended interfaces. <!-- sdd-owner: implementation -->
- [x] 11.2 RED: extend `drafts.test.ts` — `forkDraft` with `sourceDraftId: "toString"` on a Beacon with no draft keyed `"toString"` refuses `draft-not-found`, must not fabricate a source from `Object.prototype.toString`; confirm it fails. <!-- sdd-owner: implementation --> (genuinely failed: fabricated a fork with `content: undefined` and `origin.forkedFromDraft: "toString"` from the prototype method, instead of refusing)
- [x] 11.3 GREEN: replace both `drafts[cmd.sourceDraftId]` and `drafts[cmd.draftId]` (duplicate check) in `forkDraft` (`drafts.ts`) with `getOwn(beacon.drafts, ...)`. <!-- sdd-owner: implementation -->
- [x] 11.4 RED: extend `drafts.test.ts` — `abandonDraft` on an open draft with content `C` and a `Hasher` stub hashing `project(C)` to `H` produces a tombstone with `finalHash: H`; confirm it fails (no `Hasher` param yet). <!-- sdd-owner: implementation --> (genuinely failed: tombstone had no `finalHash` property, extra hasher arg silently ignored by the pre-fix 2-arg function)
- [x] 11.5 GREEN: add the `Hasher` trailing parameter to `abandonDraft(beacon, cmd, hasher)`; import `Hasher` from `../ports/index.js` and `project` from `../semantics/index.js`; compute `finalHash = hasher.hash(project(draft.content))` before dropping `content`; replace `drafts[cmd.draftId]` with `getOwn(beacon.drafts, cmd.draftId)`. <!-- sdd-owner: implementation -->
- [x] 11.6 GREEN: rethread existing `abandonDraft` call sites in `drafts.test.ts` through the deterministic test-only `Hasher` stub. <!-- sdd-owner: implementation --> (3 call sites: "refuses double abandonment", "refuses when the draft does not exist", property 3; plus `withAbandonedDraft` fixture now carries `finalHash`)
- [x] 11.7 Unit final verification: `npx vitest run tests/domain/beacon/drafts.test.ts`; `npm run lint`; `npm run typecheck`; `npm test`; `npx vitest run tests/architecture/boundaries.test.ts`; record the delta against ~55-80. <!-- sdd-owner: implementation --> (all green; amended `2244cac` -> `ac48d48`, 327 authored lines vs 277 landed = +50 delta, under the 400 budget)

## Phase 12: C2a-1 remediation — versions model (new branch `change/beacon-core-c2a1`, cherry-picked from `ea01c9b`)

Maps to: no scenario delta — types-only unit per design ADR 12/13 scope (no lookup site in `versions.ts`). Delta ~0-5 (new total ~258-263).

- [x] 12.1 Confirm `src/domain/beacon/versions.ts` and the `Beacon.versions` line in `types.ts` need no `getOwn` routing; if the delta is genuinely 0, record "no change" rather than an unneeded edit. <!-- sdd-owner: implementation --> (confirmed: `versions.ts` has no `record[key]` lookup site — pure type/interface declarations; no change made)
- [x] 12.2 Unit final verification on `change/beacon-core-c2a1`: `npx vitest run tests/domain/beacon/revocation.test.ts tests/domain/beacon/active-version.test.ts`; `npm run lint`; `npm run typecheck`; `npx vitest run tests/architecture/boundaries.test.ts`; record the ~0-5 delta. <!-- sdd-owner: implementation --> (all green — `revocation.test.ts` does not exist on this branch yet, matching original landed evidence; `active-version.test.ts` 4/4 passed; commit `5b8a495`, 258 authored lines vs 258 landed = 0 delta, exactly as estimated)

## Phase 13: C2a-2 remediation — revocation/active-version getOwn + identity throw (branch `change/beacon-core-c2a`, commit `abfecaa`, rebased onto C2a-1)

Maps to: `beacon-version-lifecycle` §resolveActiveVersion Is a Pure Lookup (Scenario: Version identity mismatch throws). Design ADR 5 (extended), ADR 13; `getOwn` touch-point rows `revokeVersion`/`resolveActiveVersion`. Delta ~35-50 (new total ~267-282).

- [x] 13.1 RED: extend `revocation.test.ts` — `revokeVersion` against an own-property version keyed `"toString"` succeeds; `versionId: "constructor"` with no own entry refuses `version-not-found`; confirm it fails. <!-- sdd-owner: implementation --> (own-property case was vacuous on read; the no-own-entry case genuinely failed: succeeded with a garbage `revoked` record instead of refusing)
- [x] 13.2 GREEN: replace `versions[cmd.versionId]` in `revokeVersion` (`revocation.ts`) with `getOwn(beacon.versions, cmd.versionId)`. <!-- sdd-owner: implementation -->
- [x] 13.3 RED: extend `active-version.test.ts` — a Beacon storing a version under key `"ver_A"` whose embedded `versionId` is `"ver_B"`; `resolveActiveVersion` called with `activeVersionId: "ver_A"` throws; confirm it fails. <!-- sdd-owner: implementation --> (genuinely failed: "expected function to throw an error, but it didn't")
- [x] 13.4 GREEN: replace `versions[beacon.activeVersionId]` in `resolveActiveVersion` (`active-version.ts`) with `getOwn(beacon.versions, beacon.activeVersionId)`; add the identity check — throw a plain `Error` when the resolved record's embedded `versionId` differs from the `activeVersionId` lookup key (design ADR 13: this check lives only here, not in `revokeVersion`/`approveDraft`). <!-- sdd-owner: implementation -->
- [x] 13.5 Unit final verification: `npx vitest run tests/domain/beacon/revocation.test.ts tests/domain/beacon/active-version.test.ts`; `npm run lint`; `npm run typecheck`; `npm test`; `npx vitest run tests/architecture/boundaries.test.ts`; record the delta against ~35-50. <!-- sdd-owner: implementation --> (all green; amended `abfecaa` -> `7893900`, 286 authored lines vs 232 landed = +54 delta, under 400 budget)

## Phase 14: C2b remediation — stale-origin gate + getOwn (branch `change/beacon-core-c2b`, commits `11c5936`+`84f6635`; ≤600-line exception)

Maps to: `beacon-version-lifecycle` §Stale-Origin Approval Requires Explicit Acknowledgment (Scenario: Null active version is stale relative to any recorded branch origin), plus one orchestrator-ratified addition (null-origin/active-exists direction, per design's refusal-taxonomy note under ADR 11). Design ADR 11, 12; `getOwn` touch-point row `approveDraft` (x3). Delta ~25-40 (new total ~570-585); session-ratified ceiling 600 — STOP and re-consult if exceeded.

- [x] 14.1 RED: extend `approval.test.ts` — draft `origin.branchedFromVersion: "ver_old"` on a Beacon with `activeVersionId: null` (post-revocation), `staleOriginAcknowledged: false`, refuses `stale-origin-not-acknowledged`; confirm it fails against the current `activeVersionId !== null && ...` guard (which evaluates false, and wrongly treats this as fresh, when `activeVersionId` is `null`). <!-- sdd-owner: implementation --> (genuinely failed: approved instead of refusing)
- [x] 14.2 RED: extend `approval.test.ts` — orchestrator-ratified addition: draft `origin.branchedFromVersion: null` on a Beacon with `activeVersionId: "ver_new"`, `staleOriginAcknowledged: false`, refuses `stale-origin-not-acknowledged`; confirm it fails against the current guard. <!-- sdd-owner: implementation --> (vacuous against the actual pre-fix guard — that direction was already handled correctly by the shipped `activeVersionId !== null && ...` guard; vacuous-guard performed instead: temporarily forced `isStaleOrigin = false`, confirmed genuine failure, reverted)
- [x] 14.3 GREEN: replace the stale-origin gate in `approval.ts` with plain inequality `draft.origin.branchedFromVersion !== beacon.activeVersionId`, unchanged position in the fixed ADR 6 refusal order. <!-- sdd-owner: implementation -->
- [x] 14.4 GREEN: replace the bare-index lookups in `approval.ts` present in this commit (`drafts[cmd.draftId]`, `versions[cmd.versionId]` duplicate check) with `getOwn(...)`. <!-- sdd-owner: implementation --> (the third touch-point row, `versions[beacon.activeVersionId]` prior-active lookup, does not exist in C2b's code — that line is only introduced by C2c's supersession branch; see Phase 15 note for where it is actually fixed)
- [x] 14.5 Confirm 14.1/14.2 pass and the existing "Stale origin with acknowledgment proceeds" case (commit `84f6635`) still passes unchanged; check for duplicate coverage against 14.1 before deciding whether to keep `84f6635` distinct or fold it into the amended `11c5936`. <!-- sdd-owner: implementation --> (all three pass; no duplicate coverage — 14.1 tests the refusal path with `staleOriginAcknowledged: false`, `84f6635` tests the success path with `staleOriginAcknowledged: true`; decision: kept as two distinct commits, `d389973` (admission checks + fixes) and `f7cadf4` (acknowledgment-success test), since they cover different behaviors and folding would not change the line count)
- [x] 14.6 Unit final verification: `npx vitest run tests/domain/beacon/approval.test.ts`; `npm run lint`; `npm run typecheck`; `npm test`; `npx vitest run tests/architecture/boundaries.test.ts`; record the delta and confirm the C2b PR total stays ≤600. <!-- sdd-owner: implementation --> **RESOLVED — re-ratified.** All functional verification passed green (`npx vitest run tests/domain/beacon/approval.test.ts` 13/13; `npm test` 10 files/124 tests; `npm run lint` clean; `npx tsc --noEmit` clean; boundaries 2/2). `git diff --shortstat 7893900 f7cadf4 -- src tests` = **611 authored lines** (610 insertions + 1 deletion), 11 over the session-ratified ceiling of 600. The operator re-ratified C2b's `size:exception` at the honest count of 611, keeping both null-direction stale-origin tests (14.1 and 14.2) per this run's explicit instruction not to trim tests to fit the review budget. Breakdown unchanged: `d389973` (base, admission checks + `getOwn` + plain-inequality gate + 14.1/14.2 tests) = 573 lines vs `7893900`; `f7cadf4` (test-only, `84f6635` unchanged) = +38 lines, cumulative 611. No further code change needed to resolve this task; resolution is the operator's budget ratification, recorded here and in `apply-progress.md`.

## Phase 15: C2c remediation — rebase only (branch `change/beacon-core-c2c`, commits `222b24e`/`7f64e45`)

Maps to: no scenario delta — pure rebase per design. Delta 0 (total unchanged at 186). **Correction (this run):** the design's `getOwn` touch-point table lists a third `approveDraft` lookup site, `versions[beacon.activeVersionId]` (prior-active), attributed to unit "C2b" — but that line of code does not exist in C2b's `approval.ts` (no prior-active handling in the first-approval-only C2b implementation). It is only introduced by C2c's supersession branch, so Phase 15 gained a small content edit (the 10th touch point) despite its original "rebase only" framing, to satisfy design ADR 12's exhaustive touch-point requirement. See `apply-progress.md` for full evidence.

- [x] 15.1 Rebase `change/beacon-core-c2c` onto the amended `change/beacon-core-c2b` tip (`f7cadf4`). <!-- sdd-owner: implementation --> (`git rebase --onto f7cadf4 84f6635 change/beacon-core-c2c` — clean, zero conflicts; supersession commit moved `222b24e` -> new tip after the touch-point amend below)
- [x] 15.2 GREEN (content edit, folded into the rebased commit per the correction note above): replace the bare-index prior-active lookup `beacon.versions[beacon.activeVersionId]` in `approval.ts`'s supersession branch with `getOwn(beacon.versions, beacon.activeVersionId)` — the 10th and final `getOwn` touch point. Added one unit test (`approveDraft: supersession > supersedes a prior active version keyed by a prototype-shadowing id (getOwn routing)`) confirming correct supersession when the prior active version is keyed under a prototype-colliding id (`"toString"`); the test passes identically before and after the fix (own-property access already shadows the prototype, and the pre-existing `priorActive.status === "active"` guard already rejects any non-`Version` prototype hit) — genuinely vacuous by construction, applied for ADR 12's domain-wide exhaustiveness convention, not for an observable behavior change. Amended into the rebased commit: `312696b` (was `222b24e`). <!-- sdd-owner: implementation -->
- [x] 15.3 Re-run its suite: `npx vitest run tests/domain/beacon/approval.test.ts` — 16/16 (15 prior + 1 new); `npm run lint` — clean; `npx tsc --noEmit` — clean; `npm test` — 10 files/128 tests; `npx vitest run tests/architecture/boundaries.test.ts` — 2/2. <!-- sdd-owner: implementation --> (all green; authored delta vs the amended C2b tip (`f7cadf4`) is 222 lines (219 insertions + 3 deletions, `git diff --shortstat f7cadf4 312696b -- src tests`) — 36 lines above the "zero delta" framing due to the folded-in touch-point fix + its test, still well under the 400-line budget)

## Phase 16: Remediation final verification and OpenSpec artifacts commit (sequential, after all units rebased)

- [x] 16.1 From the rebased `change/beacon-core-c2c` tip, run `npm ci`, `npm test`, `npm run build`, `npm run lint`, `npm run typecheck`; record each exit result. <!-- sdd-owner: implementation --> (`npm ci` — 183 packages, 0 vulnerabilities; `npm test` — 10 files/128 tests passed; `npm run build` (`tsc -p tsconfig.build.json`) — clean; `npm run lint` — clean, only pre-existing `eslint-plugin-boundaries` v6/v7 deprecation warnings; `npm run typecheck` — clean)
- [x] 16.2 Re-run `git diff --exit-code 582fc1f -- src/domain/semantics/ src/domain/ports/ src/adapters/`; confirm zero diff (frozen Slices A/B untouched). <!-- sdd-owner: implementation --> (empty diff, exit 0)
- [x] 16.3 Confirm `tests/architecture/boundaries.test.ts` still passes and `src/domain/beacon/**`/`src/shared/**` import only relative domain/shared paths (including the new `Hasher`/`project` imports in `drafts.ts`). <!-- sdd-owner: implementation --> (2/2 passed)
- [x] 16.4 Record per-unit authored-line accounting for the remediation delta against the design's ~172-270 total band, flagging any unit that exceeds its named band. <!-- sdd-owner: implementation --> (see `apply-progress.md` "Final per-unit line accounting" table; every unit landed within or near its named band except C2b, whose pre-existing `size:exception` was re-ratified at 611, and C2c, which gained a folded-in 36-line touch-point fix on top of its "0 delta" framing — both documented and within the 400-line per-unit budget except C2b's exception)
- [x] 16.5 Commit `openspec/changes/beacon-core/` (amended specs) plus the promoted `openspec/specs/` updates as the final commit on the rebased `change/beacon-core-c2c` tip. <!-- sdd-owner: implementation --> (see commit SHA in `apply-progress.md`)
- [ ] 16.6 Force-push any rebased branch not already pushed per Phase 8.10. <!-- deferred to the orchestrator's delivery step, per this run's instructions -->

## Remediation delivery boundary

Delivery actions (commit, push, PR creation, and lifecycle gates) remain outside SDD implementation task completion. PR #9 splits into PR C2a-1 (versions model, base = amended `change/beacon-core-c1c`) and PR C2a-2 (revocation, base = `change/beacon-core-c2a1`); all six other PRs keep their existing stacked-to-main order. Any `size:exception` re-confirmation for C2b happens at the `ask-on-risk` guard before `sdd-apply` begins.
