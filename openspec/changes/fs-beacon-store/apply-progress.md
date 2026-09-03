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
- [ ] 3.1–3.13 (U3 — Advisory lock) and all later units (U4–U10) — out of scope for this run.

### Workload / PR Boundary
- Mode: stacked PR slice (`chain_strategy: stacked-to-main`, ratified by the operator)
- Current work unit: U1 — port, refusal union, idempotency-key types
- Boundary: starts from `master`, ends with a compiling/lint-clean/fully-tested `BeaconStore` port surface on branch `change/fs-beacon-store-u1`
- Estimated review budget impact: 284 authored lines (additions only, no deletions) — well under the 400-line budget; nominal forecast was 100–155, calibrated 210–275, actual 284 (slightly above calibrated midpoint, still under budget, no `size:exception` needed)

### Status
7/7 U1 tasks complete (plus 6/6 phase-0 scope checks). Ready for U2 in a future `sdd-apply` run.

---

## Work Unit U2 — Atomic-write seam + crash injection (PR 2)

**Status**: complete. All tasks `2.1`–`2.9` checked off in `tasks.md`.
**Branch**: `change/fs-beacon-store-u2` (off `change/fs-beacon-store-u1`).
**Mode**: Strict TDD.
**Native attempt**: acquired under parent token, settled `outcome: passed`, state returned `complete` (request-id `49450529-8113-4c74-bdea-7c2ff6c0981f`, evidence-revision `sha256:6e62bb98349b48d430b8e5ff4a52db7689d41211d0615f1bbb519d005ae9d545` — sha256 of commit `8b826bafb606beacd6d924e2c8844ace59316baf`).

### Completed Tasks
- [x] 2.1 RED — created `tests/adapters/fs-beacon-store/atomic-writer.test.ts`: `writeAtomic` materializes at the final path; an `InjectedCrash` at `"tmp-fsynced"` leaves nothing at the final path and prior content intact; confirmed it failed first (module absent — `Cannot find module '.../atomic-writer.js'`)
- [x] 2.2 GREEN — created `src/adapters/fs-beacon-store/atomic-writer.ts`: `WriteStage`, `WriteObserver`, `AtomicWriter` interface, `FsAtomicWriter.writeAtomic` (tmp-write → fsync file → rename → fsync parent dir); constructor `{ observer?: WriteObserver }` defaulting to a no-op observer
- [x] 2.3 — confirmed 2.1 passes (2/2 in the file)
- [x] 2.4 RED — extended the test file with `createExclusive` "created"/"exists"/"crash before link" cases; `createExclusive` stubbed to throw so the two behavioral cases failed for the right reason (the "crash before link" case passed vacuously against the stub — flagged and re-verified for the right reason after GREEN)
- [x] 2.5 GREEN — implemented `createExclusive` per D5's second materialisation strategy (tmp `wx` → fsync → `link` → `unlink` tmp → fsync dir); doc comment documents the `wx`-is-decorative note and the FAT/network-mount `link` failure mode from 0.6(b); re-ran the full file — 5/5 passed, including the crash-before-link case now exercising the real implementation
- [x] 2.6 RED — extended the test file with `removeAtomic` no-op-on-absent and removes-and-fsyncs-on-existing cases; `removeAtomic` stubbed to throw so both failed for the right reason
- [x] 2.7 GREEN — implemented `removeAtomic` (unlink; `ENOENT` → no-op, no fsync; otherwise fsync parent dir); `readonly leakedTempPolicy: "sweep-on-recover"` already present on the interface and class from 2.2; 7/7 passed
- [x] 2.8 RED→GREEN — added a leaked-temp test: an `InjectedCrash` at `"tmp-fsynced"` during `createExclusive` leaves exactly one unreferenced `<name>.tmp.<uuid>` on disk (via `readdir` + prefix match) and nothing at the final path; passed immediately (pins already-correct crash-before-link behavior, not new production code) — 8/8 passed
- [x] 2.9 — final verification: `npx vitest run tests/adapters/fs-beacon-store/atomic-writer.test.ts` → 8/8 passed; `npm run lint` → 0 errors (pre-existing `eslint-plugin-boundaries` deprecation warnings only, unrelated to this change); `npx tsc --noEmit` → exit 0; full `npm test` → 140/140 across 12 files

### Files Changed
| File | Action | What Was Done |
|------|--------|---------------|
| `src/adapters/fs-beacon-store/atomic-writer.ts` | Created | `WriteStage`, `WriteObserver`, `AtomicWriter` interface, `FsAtomicWriter` (`writeAtomic`, `createExclusive`, `removeAtomic`, `leakedTempPolicy`) per D5 verbatim — `link`, not `rename`, materializes write-once artifacts |
| `tests/adapters/fs-beacon-store/atomic-writer.test.ts` | Created | 8 tests against real `mkdtemp` directories; a writer-owned `WriteObserver` (`crashAt`/`isTempSiblingOf` helpers) injects `InjectedCrash` at a chosen `(stage, path)` pair — no `vi.mock("node:fs/promises")` anywhere |

### TDD Cycle Evidence
| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 2.1–2.3 | `tests/adapters/fs-beacon-store/atomic-writer.test.ts` | Integration (real fs, real temp dirs) | N/A (new file) | ✅ Written — module-not-found error on first run | ✅ Passed — `2 passed (2)` after implementing `writeAtomic` | ✅ 2 cases — happy path + crash-before-rename | ✅ Clean — no restructuring needed |
| 2.4–2.5 | same file | Integration | N/A (extends 2.1's file) | ✅ Written — `createExclusive` stubbed to throw; 2/3 new cases failed for the right reason (stub error), 1/3 passed vacuously against the stub and was re-verified against the real implementation post-GREEN | ✅ Passed — `5 passed (5)` after implementing `createExclusive` | ✅ 3 cases — created / exists-byte-identical / crash-before-link | ✅ Clean |
| 2.6–2.7 | same file | Integration | ✅ 5/5 pre-existing (this file) | ✅ Written — `removeAtomic` stubbed to throw; both cases failed for the right reason | ✅ Passed — `7 passed (7)` after implementing `removeAtomic` | ✅ 2 cases — no-op-on-absent + removes-and-fsyncs | ✅ Clean |
| 2.8 | same file | Integration | ✅ 7/7 pre-existing (this file) | N/A — RED→GREEN pin of already-correct crash-before-link behavior from 2.5, not new production code | ✅ Passed on first run — `8 passed (8)` | Triangulation skipped: pins one specific crash window already covered by 2.4's crash-before-link case; this test adds the leaked-artifact assertion, not new behavior | ✅ Clean |

### Test Summary
- **Total tests written**: 8 (all in `tests/adapters/fs-beacon-store/atomic-writer.test.ts`)
- **Total tests passing**: 8/8 in the touched file; 140/140 full repo suite (`npm test`, up from 132/132 after U1)
- **Layers used**: Integration (real `mkdtemp` temp directories, real `node:fs/promises` calls) — 8; Unit — 0 (the design explicitly rejects `vi.mock("node:fs/promises")` for this seam)
- **Approval tests** (refactoring): None — no refactoring tasks, all files new
- **Pure functions created**: 2 test-local helpers (`crashAt`, `isTempSiblingOf`); production helpers `isErrnoException`, `tempSiblingOf` are pure

### Work Unit Evidence
| Evidence | Value |
|---|---|
| Focused test command and exact result | `npx vitest run tests/adapters/fs-beacon-store/atomic-writer.test.ts` → `8 passed (8)` |
| Runtime harness command/scenario and exact result | Real `mkdtemp(tmpdir())` project directories per test, real `node:fs/promises` `open`/`writeFile`/`sync`/`rename`/`link`/`unlink` calls, no fs mocking; `InjectedCrash` via a writer-owned `WriteObserver` interrupts a chosen `(stage, path)` pair mid-sequence — reproduces R2's "crash before rename" and the write-once "crash before link" scenarios literally. All 8 scenarios passed against real filesystem semantics. |
| Rollback boundary | Delete `src/adapters/fs-beacon-store/atomic-writer.ts` and `tests/adapters/fs-beacon-store/atomic-writer.test.ts`; no other file was modified except `tasks.md`'s checkboxes for `2.1`–`2.9` |

### Deviations from Design
None — `writeAtomic` and `createExclusive` implement D5's two materialisation strategies verbatim (tmp-write → fsync → rename → fsync-dir; tmp-write `wx` → fsync → `link` → `unlink` tmp → fsync-dir), the observer is writer-owned per D5's explicit correction, and the FAT/network-mount `link` failure-mode ordering from task 0.6(b) is documented in `createExclusive`'s doc comment.

### Issues Found
None. One self-corrected TDD-discipline note: implementing `writeAtomic` and `createExclusive` together in the first pass (before `createExclusive`'s RED test existed) would have violated strict TDD's first law; caught before task 2.4 and corrected by stubbing `createExclusive`/`removeAtomic` to throw, writing their RED tests against the stubs, confirming genuine failure, then implementing GREEN — so every task from 2.4 onward followed a real RED→GREEN cycle.

### Remaining Tasks (U2)
None — all 9 tasks (`2.1`–`2.9`) complete.

### Workload / PR Boundary (U2)
- Mode: stacked PR slice (`chain_strategy: stacked-to-main`, ratified by the operator)
- Current work unit: U2 — atomic-write seam + crash injection
- Boundary: starts from `change/fs-beacon-store-u1`, ends with a compiling/lint-clean/fully-tested `FsAtomicWriter` seam on branch `change/fs-beacon-store-u2`
- Estimated review budget impact: 286 authored lines (129 production + 157 test, additions only) — under the 305–400 calibrated band and well under the 400-line budget; no `size:exception` needed

### Status (cumulative)
U1: 7/7 tasks complete (plus 6/6 phase-0 scope checks). U2: 9/9 tasks complete. 16/16 tasks complete across U1–U2. Ready for U3 (advisory lock, `tasks.md` phase 3) in a future `sdd-apply` run.
