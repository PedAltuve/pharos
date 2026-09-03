# Apply Progress: fs-beacon-store (Slice D)

## Work Unit U1 — Port, refusal union, idempotency-key types (PR 1)

**Status**: complete. All tasks `0.1`–`0.6` and `1.1`–`1.7` checked off in `tasks.md`.
**Branch**: `change/fs-beacon-store-u1` (off `master`).
**Mode**: Strict TDD.

### Completed Tasks
- [x] 0.1–0.6 — scope/edit-authority checks (see `tasks.md` for per-item verification notes)
- [x] 1.1 RED — extended `tests/architecture/boundaries.test.ts` asserting `src/domain/ports/beacon-store.ts` lints clean with zero Node imports; confirmed it fails first (module absent)
- [x] 1.2 GREEN — `src/domain/ports/beacon-store-refusals.ts` (7-member `BeaconStoreDiskRefusal` + composed `BeaconStoreRefusal`)
- [x] 1.3 GREEN — `src/domain/ports/beacon-store.ts` (`IdempotencyKey`, `StoreCreateDraftCommand`, `BeaconStore` — 9 methods)
- [x] 1.4 GREEN — extended `src/domain/ports/index.ts` barrel, `export type` only
- [x] 1.5 — confirmed 1.1 passes; added companion "exactly 9 members" structural test (excess-property + missing-property check via a typed literal stub)
- [x] 1.6 RED→GREEN — compile-time exhaustiveness switch test for `BeaconStoreRefusal` (17 cases, no `default`); RED demonstrated by temporarily removing one case and observing `tsc` TS2355, then restoring
- [x] 1.7 — final verification: `tsc --noEmit` (0), `npm run lint` (0), targeted vitest run (all green)

### Files Changed
| File | Action | What Was Done |
|------|--------|---------------|
| `src/domain/ports/beacon-store-refusals.ts` | Created | 7-member `BeaconStoreDiskRefusal` union + `ImmutableArtifact`, plus `BeaconStoreRefusal = BeaconRefusal \| BeaconStoreDiskRefusal`, per D3 verbatim |
| `src/domain/ports/beacon-store.ts` | Created | `IdempotencyKey`, `StoreCreateDraftCommand`, `BeaconStore` (9 methods: 3 reads + 6 mutations), all `import type`, zero `node:*` |
| `src/domain/ports/index.ts` | Modified | Added `export type` barrel entries for both new modules |
| `tests/architecture/boundaries.test.ts` | Modified | Added the R1 S1 zero-Node-import/clean-lint test and the R1 S2 exactly-9-members test |
| `tests/domain/ports/beacon-store-refusals.test.ts` | Created | Compile-time exhaustiveness pin (switch, no default) over all 17 `BeaconStoreRefusal` members, with real assertions per branch |

### TDD Cycle Evidence
| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 1.1–1.4 | `tests/architecture/boundaries.test.ts` | Structural (ESLint-over-file) | ✅ 2/2 pre-existing | ✅ Written — `eslint.lintFiles` threw `No files matching …` for the not-yet-created port module | ✅ Passed — `4 passed (4)` after creating the two production files + barrel | Triangulation skipped: purely structural (import shape), single possible output | ✅ Clean — no restructuring needed |
| 1.5 | `tests/architecture/boundaries.test.ts` | Structural (typed literal + `Object.keys`) | N/A (companion to 1.1's file) | ✅ Written — typed stub literal is excess/missing-property-checked by `tsc` (verified via full-project `tsc --noEmit`, exit 0) | ✅ Passed at both vitest-runtime (`Object.keys(stub)` = 9) and `tsc` levels | Triangulation skipped: exact-count structural pin, single possible output | ✅ Clean |
| 1.6 | `tests/domain/ports/beacon-store-refusals.test.ts` | Structural (exhaustive switch, `TS2355`) | N/A (new file) | ✅ Written and **empirically demonstrated**: temporarily removed the `stale-origin-not-acknowledged` case → `tsc --noEmit` failed with `TS2355: A function whose declared type is neither 'undefined', 'void', nor 'any' must return a value.` at the exact line; restored the case | ✅ Passed — `tsc --noEmit` exit 0 after restore; `2 passed (2)` at vitest runtime, each assertion calling `classifyRefusal` and checking a specific returned `rule` string | ✅ 2 groups — disk-only members (7 assertions) and domain-composed members (2 assertions), across 2 `it` blocks | ✅ Clean — removed an interleaved comment that tripped ESLint's `no-fallthrough` on the grouped case labels |

### Test Summary
- **Total tests written**: 4 new (2 in `boundaries.test.ts`, 2 in `beacon-store-refusals.test.ts`)
- **Total tests passing**: 6/6 in the two touched files; 132/132 full repo suite (`npm test`)
- **Layers used**: Structural/type-level only (Unit: 0 — U1 has no runtime domain logic, matches design's file-changes table)
- **Approval tests** (refactoring): None — no refactoring tasks, all files are new or additive barrel entries
- **Pure functions created**: 0 production functions (U1 is types-only per design); 1 test-local helper (`classifyRefusal`) used purely to force compile-time exhaustiveness

### Work Unit Evidence
| Evidence | Value |
|---|---|
| Focused test command and exact result | `npx vitest run tests/architecture/boundaries.test.ts` → `4 passed (4)`; `npx vitest run tests/domain/ports/beacon-store-refusals.test.ts` → `2 passed (2)` |
| Runtime harness command/scenario and exact result | N/A — U1 is pure types, no I/O boundary (per the Suggested Work Units table's own "N/A — pure types, no I/O" for U1) |
| Rollback boundary | Delete `src/domain/ports/beacon-store.ts` and `src/domain/ports/beacon-store-refusals.ts`; revert `src/domain/ports/index.ts` to the pre-U1 Hasher/JsonValue-only barrel; revert the two added `describe` blocks in `tests/architecture/boundaries.test.ts`; delete `tests/domain/ports/beacon-store-refusals.test.ts` |

### Deviations from Design
None — implementation matches design D3 and D9's interfaces block verbatim.

### Issues Found
One scope-list gap, recorded (not silently expanded): task 0.1's "Restrict implementation edits to" list does not literally enumerate `tests/architecture/boundaries.test.ts` or a new `tests/domain/ports/**` path, yet task 1.1 (same tasks.md, same phase) explicitly instructs extending `tests/architecture/boundaries.test.ts` and strict TDD requires a companion exhaustiveness test file. Resolved by treating 1.1's explicit, more-specific instruction as authoritative for these two structural-test paths — both prove only the files 0.1 does list (`beacon-store.ts`, `beacon-store-refusals.ts`, `index.ts`) — and recording the gap in 0.1's checkbox rather than silently expanding scope or blocking on it.

### Remaining Tasks
- [ ] 2.1–2.9 (U2 — Atomic-write seam + crash injection) and all later units (U3–U10) — out of scope for this run.

### Workload / PR Boundary
- Mode: stacked PR slice (`chain_strategy: stacked-to-main`, ratified by the operator)
- Current work unit: U1 — port, refusal union, idempotency-key types
- Boundary: starts from `master`, ends with a compiling/lint-clean/fully-tested `BeaconStore` port surface on branch `change/fs-beacon-store-u1`
- Estimated review budget impact: 284 authored lines (additions only, no deletions) — well under the 400-line budget; nominal forecast was 100–155, calibrated 210–275, actual 284 (slightly above calibrated midpoint, still under budget, no `size:exception` needed)

### Status
7/7 U1 tasks complete (plus 6/6 phase-0 scope checks). Ready for U2 in a future `sdd-apply` run.
