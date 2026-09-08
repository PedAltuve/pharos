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

---

## Work Unit U3 — Advisory lock

**Status**: implementation complete but **blocked before commit by the explicit 400-line authored-diff budget**. Tasks `3.1`–`3.13` are checked off in `tasks.md`; no commit was created.
**Branch**: `change/fs-beacon-store-u3`, created from `change/fs-beacon-store-u2` at `9df0c1b`.
**Mode**: Strict TDD.
**Structured status consumed**: schema `gentle-ai.sdd-status` v2; change `fs-beacon-store`; artifact store `openspec`; `dependencies.apply=ready`; `nextRecommended=apply`; `actionContext.mode=repo-local`; workspace root `/home/pedro/pharos`; blocked reasons empty. Parent had already acquired the native runtime attempt (`state: proceed`); this phase did not acquire or settle it. No action-context warning or edit-root violation was observed.
**Workload / PR boundary**: stacked-to-main, current boundary is U3 only. The code and test files total **438 authored added lines** (`250` production + `188` tests), exceeding the 400-line budget. This was not reduced by code-golfing. A maintainer decision is required: authorize a documented `size:exception` for U3 or approve an honest cohesive split before commit.

### Completed Tasks and Persisted Checkbox Updates

- [x] 3.1 RED/GREEN — added the direct-`wx` acquisition test and implemented `ProjectLock` step 1; holder contains `pid`, `hostname`, and `nonce`, with no lock temp sibling.
- [x] 3.2 GREEN — added constructor-settable `waitMs`, `staleAfterMs`, and `pollMs`, with the required `staleAfterMs < waitMs` assertion.
- [x] 3.3 RED/GREEN — live same-host PID is probed and never broken; unbreakable acquisition refuses without changing the holder.
- [x] 3.4 GREEN — holder parsing, positive-PID guard, hostname-presence routing, liveness probing, and `ESRCH` handling.
- [x] 3.5 RED/GREEN — confirmed-dead same-host PID is broken immediately without the age gate.
- [x] 3.6 GREEN — live and dead PID scenarios pass.
- [x] 3.7 RED/GREEN — fresh zero-byte/unparseable locks and positive-PID/no-host locks use the age gate; `utimes` drives aged fixtures.
- [x] 3.8 GREEN — `probe.tmp.<uuid>` creation/stat/unlink age gate and unlink-plus-directory-fsync retry.
- [x] 3.9 RED/GREEN — bounded jittered backoff (doubling from `pollMs`, capped at 250ms) and `lock-unavailable` refusal with `holderPid`/`waitedMs`.
- [x] 3.10 GREEN — completed D2 step 7 wait/refusal behavior.
- [x] 3.11 RED/GREEN — nonce-checked release, unlink, directory fsync; foreign nonce throws.
- [x] 3.12 GREEN — probe files do not persist after acquisition/release and are absent on the lock-free release path. The dedicated assertion passed on its first run; probe lifecycle was also exercised by the earlier 3.7 RED/GREEN cycle.
- [x] 3.13 — focused test, lint, and typecheck all pass after the lint fix.

### TDD Cycle Evidence

| Task group | RED evidence | GREEN / triangulation / refactor |
|---|---|---|
| 3.1–3.2 | `npx vitest run tests/adapters/fs-beacon-store/lock.test.ts` failed before the module existed: `Cannot find module '../../../src/adapters/fs-beacon-store/lock.js'`. | First acquisition passed after direct `open(path, "wx")`; holder and no-temp assertions passed. |
| 3.3–3.4 | Same command first exposed a test configuration error (`staleAfterMs must be less than waitMs`), then the intended pre-liveness failure was `EEXIST: file already exists, open .../lock`. | Live-PID test passed after read/parse and liveness routing were added; no lock bytes changed. |
| 3.5–3.6 | Same command first failed because the fixture used a non-local hostname (`expected false to be true`); after fixing it to `hostname()`, the intended failure was `Error: dead lock was not broken immediately`. | `ESRCH` now unlinks and fsyncs the directory, then retries; live/dead tests passed. |
| 3.7–3.8 | Same command failed on the aged fixture with `expected false to be true`; an intermediate invalid fixture configuration also produced `staleAfterMs must be less than waitMs`. | Age gate uses a same-directory probe and cleans it in all completed paths; fresh and aged cases passed. |
| 3.9–3.10 | Same command failed with `expected 10 to be greater than or equal to 50`, showing the pre-step-7 implementation returned after one poll. | Jittered doubling/backoff waits through the configured bound and returns the required refusal shape. |
| 3.11 | Same command failed with `TypeError: lock.release is not a function`. | Nonce validation, release, and directory fsync passed. |
| 3.12 | The explicit final probe-property assertion was added after the release implementation and passed immediately; the preceding 3.7 age-gate RED run covered missing probe lifecycle behavior. | No probe remains after age-gated acquisition or release; no probe is created by a lock-free release. |

### Files Changed

| File | Change |
|---|---|
| `src/adapters/fs-beacon-store/lock.ts` | Added `ProjectLock` with direct `wx` acquisition, holder parsing, same-host PID liveness, ESRCH immediate break, filesystem-clock age gate, jittered wait/refusal, and nonce-guarded release. |
| `tests/adapters/fs-beacon-store/lock.test.ts` | Added 10 real-filesystem tests covering acquisition, liveness, stale age gate, refusal payload, release, nonce loss, and probe cleanup. |
| `openspec/changes/fs-beacon-store/tasks.md` | Changed only checkboxes `3.1`–`3.13` from unchecked to checked. |
| `openspec/changes/fs-beacon-store/apply-progress.md` | Appended this cumulative U3 evidence section. |

### Verification Evidence

- `npx vitest run tests/adapters/fs-beacon-store/lock.test.ts` → **10 passed (10)**, exit 0.
- `npm run lint` → exit 0; only pre-existing `eslint-plugin-boundaries` deprecation warnings.
- `npx tsc --noEmit` → exit 0, no output.
- No source-mutating formatter was run.
- Runtime harness: real `mkdtemp` directories, real `node:fs/promises`, real `utimes`, real `process.kill(pid, 0)`, and real directory fsync; no filesystem mocks.

### Scope-Fence Evidence

`git status --short` showed only the two allowed U3 source/test files and the allowed `tasks.md` modification, plus pre-existing untracked `.gentle-ai-instance` files under `openspec/changes/beacon-core/` and `openspec/changes/fs-beacon-store/`, which were not edited, deleted, staged, or committed. The changed tracked paths are within the allowed edit surfaces. `git diff --check` passed. The lock source contains no `AtomicWriter` import/reference, uses direct `open(this.lockPath, "wx")`, and only creates `probe.tmp.<uuid>` inside the age-gate path.

### Deviations, Underspecification, and Risks

- The requested citation `openspec/changes/fs-beacon-store/specs/beacon-store-recovery/spec.md` has no R4, S2, or S3; it contains three recovery requirements/scenario groups only. The lock R4/S2/S3 contract is in `specs/fs-beacon-store/spec.md`, as mapped by `tasks.md`. Implementation followed the coherent mapped contract without widening scope.
- No design contradiction was found in D2/D4/G1 for this slice. The only noted source mismatch is the recovery-spec citation above.
- Strict-TDD evidence for the dedicated 3.12 assertion is not an independent RED failure; it passed on first run, with its behavior covered by the earlier 3.7 RED cycle and the 3.11 missing-release RED. This is disclosed rather than retrofitted.
- Commit SHA/message: **none — intentionally not committed** because the authored code/test diff is 438 added lines, above the explicit 400-line budget.

### Rollback Boundary

Remove `src/adapters/fs-beacon-store/lock.ts` and `tests/adapters/fs-beacon-store/lock.test.ts`, and revert only the `3.1`–`3.13` checkbox changes plus this U3 evidence section in `apply-progress.md`; do not touch U1/U2 commits or the pre-existing `.gentle-ai-instance` files.

### Remaining Tasks

No implementation tasks remain in U3. Parent lifecycle action: resolve the over-budget delivery decision (`size:exception` or an approved cohesive split), then commit this U3 work unit without changing the implementation to code-golf it under budget.

## U3 Finalization — operator-approved size exception

The operator approved `size:exception` for this cohesive U3 slice at a **550-line cap**. Observed authored code/test diff: **438 lines** (`250` production + `188` test); native accounting including required task/progress evidence: **538 lines**. No split, code-golfing, rebase, or amendment was performed. Final verification from the current candidate is green: focused lock tests **10/10** (exit 0), `npm run lint` (exit 0; pre-existing boundaries deprecation warnings only), `npx tsc --noEmit` (exit 0), and `git diff --check` (exit 0). The recovery-spec citation remains underspecified for this work: `specs/beacon-store-recovery/spec.md` has no R4/S2/S3; the actual lock requirement is in `specs/fs-beacon-store/spec.md`.

## Work Unit U4a — Layout, id validation, and records (U4 tasks 4.1–4.7)

**Status**: implementation complete. Tasks `4.1`–`4.7` are checked off in `tasks.md`; U4b (`4.8`–`4.20`) remains deferred.
**Branch**: `change/fs-beacon-store-u4`, based on U3 commit `8979ae5`; lock source and tests were inspected and not modified.
**Mode**: Strict TDD.
**Structured status consumed**: schema `gentle-ai.sdd-status` v2; `changeName=fs-beacon-store`; artifact store `openspec`; `dependencies.apply=ready`; `nextRecommended=apply`; blocked reasons empty; `actionContext.mode=repo-local`; workspace `/home/pedro/pharos`; parent supplied native attempt authority and this phase did not acquire or settle an attempt. No action-context warning or edit-root violation was observed.
**Workload / PR boundary**: `stacked-to-main`, U4a only, layout/records half of U4. Authored additions plus deletions for source and tests: **238 lines** (`119` production, `119` tests; additions only), below the 400-line cap. No `size:exception` needed.

### Completed Tasks and Persisted Checkbox Updates

- [x] 4.1 RED/GREEN — added path-construction coverage for `lock`, journal idempotency entries, beacon/draft/version directories, and all required record files. The test was observed failing before `layout.ts` existed, then passed after `createLayout` was implemented.
- [x] 4.2 GREEN — created `layout.ts` with all D2/§4 path builders, sorted project-level beacon filtering for `project.json`, `lock`, `journal`, and `.tmp.` names, and D7 layer-1 validation.
- [x] 4.3 RED/GREEN — added independent tests for disk-origin `corrupt`, caller existing-state `not-found`, and caller creation-state `invalid-id` outcomes.
- [x] 4.4 GREEN — implemented provenance-aware classification. The `creation` provenance explicitly covers `createDraft`'s `beaconId` special case as well as newly-created draft/version ids; invalid caller input remains a value classification, never a throw.
- [x] 4.5 RED/GREEN — added and passed the `bcn_a.tmp.1` collision test; validation rejects the id before a path can be constructed and before listing exclusion can make it disappear.
- [x] 4.6 RED/GREEN — added adversarial record tests for `__proto__`, `constructor`, and `toString`, plus prototype-safe own-property lookup.
- [x] 4.7 GREEN — created adapter-local `records.ts` using `Map` accumulation and `Object.fromEntries`; `getOwn` is local and is not re-exported from the domain.

### TDD Cycle Evidence

| Task | RED observation | GREEN / triangulation / refactor |
|---|---|---|
| 4.1 | `npx vitest run tests/adapters/fs-beacon-store/layout.test.ts` → failed suite with `Error: Cannot find module '../../../src/adapters/fs-beacon-store/layout.js'` at the test import; `0 test` executed. | Implemented `createLayout`; focused layout/records run passed. Triangulation covered the complete path set and project filtering; no refactor needed. |
| 4.3 | After adding the three provenance cases before the classifier existed, the focused run produced 3 failures: `TypeError: classifyId is not a function` at the classifier assertions. | Implemented `classifyId` with `disk` → `corrupt`, `existing` → `not-found`, and `creation` → `invalid-id`; all provenance cases passed. |
| 4.5 | Temporarily removed the `.tmp.` predicate after the provenance implementation; `npx vitest run .../layout.test.ts` failed the collision case with `AssertionError: expected true to be false` (`Received true`). | Restored the `.tmp.` rejection; collision and all layout cases passed. |
| 4.6 | `npx vitest run tests/adapters/fs-beacon-store/records.test.ts` → failed suite with `Error: Cannot find module '../../../src/adapters/fs-beacon-store/records.js'`; `0 test` executed. | Implemented `recordFromEntries` and adapter-local `getOwn`; records tests passed. |

### Verification Evidence

- Focused tests: `npx vitest run tests/adapters/fs-beacon-store/layout.test.ts tests/adapters/fs-beacon-store/records.test.ts` → **2 files, 10 tests passed**, exit 0.
- `npm run lint` → exit 0; only pre-existing `eslint-plugin-boundaries` deprecation warnings.
- `npx tsc --noEmit` → exit 0, no output.
- `git diff --check` → exit 0.
- Runtime boundary: **N/A** — U4a contains pure path/classification/record helpers and has no filesystem I/O harness; tests use deterministic in-memory values.

### Files Changed

- `src/adapters/fs-beacon-store/layout.ts` — created path layout, listing filter, id validation, and provenance classification.
- `src/adapters/fs-beacon-store/records.ts` — created Map/Object.fromEntries record materialization and local `getOwn`.
- `tests/adapters/fs-beacon-store/layout.test.ts` — path, filter, validation, provenance, and `.tmp.` collision tests.
- `tests/adapters/fs-beacon-store/records.test.ts` — adversarial record and own-property tests.
- `openspec/changes/fs-beacon-store/tasks.md` — only checkboxes `4.1`–`4.7` changed to checked.
- `openspec/changes/fs-beacon-store/apply-progress.md` — appended this U4a evidence section.

### Deviations, Underspecification, and Risks

- No deviation from D7/D9. The design does not mandate export names, so U4a exposes a cohesive `createLayout` object plus `isValidId`/`classifyId` helpers for later adapter units.
- The three invalid-input outcomes are classifications in U4a; the reconstruction-boundary throw for disk-origin corruption remains intentionally deferred to U5 as the task specifies.
- No runtime harness applies to this pure helper unit. The pre-existing `.gentle-ai-instance` files remained untouched and untracked.

### Rollback Boundary

Delete `src/adapters/fs-beacon-store/layout.ts`, `src/adapters/fs-beacon-store/records.ts`, `tests/adapters/fs-beacon-store/layout.test.ts`, and `tests/adapters/fs-beacon-store/records.test.ts`; revert only the `4.1`–`4.7` checkbox changes and this U4a section. Do not touch U1–U3 history, lock files, or either `.gentle-ai-instance` file.

### Remaining Tasks

U4b remains for the next bounded apply unit. Exact unchecked U4 task lines copied from `tasks.md`:

- [ ] 4.8 RED: create `tests/adapters/fs-beacon-store/serialization.test.ts` — the §7 contract-string envelope round-trips for each of the 8 kinds (`pharos.beacon/1`, `pharos.beacon-active/1`, `pharos.beacon-draft/1`, `pharos.beacon-tombstone/1`, `pharos.version-manifest/1`, `pharos.beacon-semantics/1`, `pharos.version-revocation/1`, `pharos.idempotency-entry/1`); a major version other than `1` is corruption (asserted here as a classification, the throw itself lands in U5); confirm it fails. <!-- sdd-owner: implementation -->
- [ ] 4.9 GREEN: create `src/adapters/fs-beacon-store/serialization.ts` — K1 closed-key snake_case↔camelCase bijection per file kind, authored as explicit per-file-kind object literals in a fixed order (never a generic string converter, per D8); `JSON.stringify(value, null, 2) + "\n"` output. <!-- sdd-owner: implementation -->
- [ ] 4.10 RED: extend the test file with the K2 caller-keyed round-trip — **this is the RED test for DEF-1 MAJOR**: a `SemanticSource` whose excluded fields include `foo_bar`, `fooBar`, `__proto__`, an empty-string key, and a Unicode key round-trips **key-identical** (K2b, `draft.json`'s `content`); the same for `SemanticProjection`'s `variables`/`outcomes`/`expectations`/`entry_point.query`/`readiness_intent.isolation.scope` records (K2a — own keys verbatim, values recursed under K1/K2); each action's literal `value`, each variable's `nonSensitiveExample`, and each constraint's `value` are held verbatim (K2b, the three rows revision 3 added); confirm every one of these fails against a naive blanket-snake_case implementation before writing the exempt-node table. <!-- sdd-owner: implementation -->
- [ ] 4.11 GREEN: implement K2a/K2b exactly per D6's exempt-node table, applied per-node (not per-file); caller-keyed nodes emit their own keys through `Array.prototype.sort()` (never `localeCompare`), noting array-index-like keys sort first in ascending numeric order regardless of insertion order. <!-- sdd-owner: implementation -->
- [ ] 4.12 RED→GREEN: add a byte-stability test — the same logical value serializes to byte-identical output across two runs and (where feasible in CI) is asserted deterministic regardless of `Object.keys` insertion order for K1 nodes (D8). <!-- sdd-owner: implementation -->
- [ ] 4.13 RED: create `tests/adapters/fs-beacon-store/journal.test.ts` — `keyHash(key)` is a plain SHA-256 over the key's raw UTF-8 bytes via `node:crypto`, matching the golden vector `keyHash("abc") === "ba7816bf…"` (the canonical SHA-256 of `"abc"`) and is explicitly **not** the JCS-quoted digest; confirm it fails. <!-- sdd-owner: implementation -->
- [ ] 4.14 GREEN: create `src/adapters/fs-beacon-store/journal.ts` — `keyHash` per D6's `node:crypto` construction (three lines, no `Hasher` involvement). <!-- sdd-owner: implementation -->
- [ ] 4.15 RED: extend the test file — each of the 6 per-method `inputHash` builders (`approveInput`, `createDraftInput`, `updateDraftInput`, `forkDraftInput`, `abandonDraftInput`, `revokeVersionInput`) compiles with an explicit `SemanticValue` return annotation and no cast, and embeds `hasher.hash(project(content))` — never the raw command interface or `SemanticProjection` — as a top-level call inside the literal (D6's typechecking constraint); confirm the naive nested-command version fails to compile/typecheck before extracting the builders. <!-- sdd-owner: implementation -->
- [ ] 4.16 GREEN: implement the 6 builders per D6's pattern, using an injected `Hasher` (the port from `src/domain/ports/hasher.ts`, read-only import) for content-hash embedding. <!-- sdd-owner: implementation -->
- [ ] 4.17 RED: extend the test file — journal entry create/read: `createExclusive` via the seam (through `AtomicWriter`, injected); a journal lookup by `keyHash` with an absent entry, an entry with a matching `inputHash` (replay hit), and an entry with a differing `inputHash` (conflict) are three distinguishable outcomes (the basic 3-outcome half of D6b — the fuller 6-outcome adoption-probe table is U8's, since it needs the reconstructed aggregate); confirm it fails. <!-- sdd-owner: implementation -->
- [ ] 4.18 GREEN: implement journal entry read/write and the 3-outcome lookup. <!-- sdd-owner: implementation -->
- [ ] 4.19 RED→GREEN: add a property test (`fast-check@4.9.0`) over `SemanticSource`/`SemanticProjection` variants differing only in `project()`-excluded fields — their `inputHash` is unaffected (D6's "logically identical input" contract for `createDraft`/`updateDraft`). <!-- sdd-owner: implementation -->
- [ ] 4.20 Final verification: `npx vitest run tests/adapters/fs-beacon-store/{layout,records,serialization,journal}.test.ts`; `npm run lint`; `npx tsc --noEmit`. <!-- sdd-owner: implementation -->

Later Phase 5–10 tasks remain unchecked and out of scope. Parent lifecycle action: commit this bounded U4a unit, then route the next approved lifecycle step; do not treat U4a as completion of all U4 tasks.

## Work Unit U4b — remediation split (U4 tasks 4.8–4.20)

**Status**: complete after the operator-authorized native reset and three-way bounded split. The previously observed U4b RED/GREEN evidence is preserved below; it was not fabricated or rerun as new RED evidence. Each commit contains code, tests, task checkboxes, and bounded evidence.
**Structured status consumed**: authoritative OpenSpec status for `fs-beacon-store`; `artifactStore=openspec`; `applyState=ready`; `dependencies.apply=ready`; `nextRecommended=apply`; `actionContext.mode=repo-local`; workspace `/home/pedro/pharos`; edit surfaces are limited to the parent-authorized U4b files. Parent owns native attempt settlement against the failed evidence revision and this phase did not acquire or settle.
**Mode**: Strict TDD. Historical U4b RED observations remain exact and are carried forward; each remediation commit receives fresh GREEN verification only.
**Workload / PR boundary**: operator-selected `reset-and-split`, three stacked-to-main work units, maximum 400 authored additions plus deletions per commit including task/progress evidence. Runtime harness: N/A for serialization-only checks; real temporary filesystem journal harness for the journal commit.

### Commit 1 — Serialization K1

**Scope**: U4 tasks 4.8–4.9. Explicit per-file-kind contract envelopes, fixed-order K1 object literals, snake_case closed keys, and contract classification. K2 behavior, stability coverage, and journal work were intentionally deferred to Commit 2/3.
**Historical TDD evidence preserved**: task 4.8 originally observed `Cannot find module '../../../src/adapters/fs-beacon-store/serialization.js'` with `0 test` executed before implementation. The original U4b run then verified all eight envelope kinds and major-version classification; this remediation does not claim that historical RED as a new observation.
**GREEN verification**: `npx vitest run tests/adapters/fs-beacon-store/serialization.test.ts` → 1 file, 9 tests passed; `npm run lint` → exit 0 (pre-existing boundaries deprecation warnings); `npx tsc --noEmit` → exit 0; `git diff --check` → exit 0.
**Files**: `src/adapters/fs-beacon-store/serialization.ts`, `tests/adapters/fs-beacon-store/serialization.test.ts`, `openspec/changes/fs-beacon-store/tasks.md`, this subsection.
**Rollback boundary**: remove the two serialization files, revert only task checkboxes 4.8–4.9, and remove this commit subsection; leave U1–U4a and all later U4b work untouched.

### Commit 2 — Serialization K2 and stability

**Scope**: U4 tasks 4.10–4.12. This subsection records the exact previously observed DEF-1 RED, the D6 exempt-node implementation, explicit `Array.prototype.sort()` ordering, and byte-stability GREEN evidence.
**Status**: committed as `08c9ff2` (`fix(fs-beacon-store): preserve semantic keys with K2 serialization`), after Commit 1 (`bcac27e`).
**Rollback boundary**: revert only the K2/stability delta and task checkboxes 4.10–4.12; retain Commit 1's K1 serialization.

### Commit 2 evidence

**Historical RED preserved exactly**: the original U4b run against a temporary naive blanket converter failed 2 tests; `fooBar` and `__proto__` were missing, while `entryPoint` and `readinessIntent` were read back as `entry_point` and `readiness_intent`; projection K1 fields also remained snake_case. The original stability RED observed `identityRef`/`type` changing order when actor input insertion order changed. These are historical observations, not new RED claims.
**GREEN verification**: `npx vitest run tests/adapters/fs-beacon-store/serialization.test.ts` → 1 file, 12 tests passed; `npm run lint` → exit 0 (pre-existing boundaries deprecation warnings); `npx tsc --noEmit` → exit 0; `git diff --check` → exit 0. Final candidate hashes: serialization source `5bf2d261321b18557882a8a4ff789a242d6dfc62e9914dd558fd881f0993a997`; serialization test `33586fbb0331cc8e93f14c46e5270d8b2e644ae9a65f7322f089efc8214fd635`.
**Files**: `src/adapters/fs-beacon-store/serialization.ts`, `tests/adapters/fs-beacon-store/serialization.test.ts`, `openspec/changes/fs-beacon-store/tasks.md`, this subsection.
**Authored count**: 358 changed lines across all commit paths (225 additions, 133 deletions), within the 400-line limit; no code-golfing or semantic reduction was used.
**Rollback boundary**: revert only the K2/stability delta and task checkboxes 4.10–4.12; retain Commit 1's K1 serialization.

### Commit 3 — Journal and final verification

**Scope**: U4 tasks 4.13–4.20. Raw UTF-8 keyHash, six explicit inputHash builders, absent/replay/conflict journal outcomes, property coverage, and the exact final verification sequence.
**Status**: committed as `fa10bbd` (`feat(fs-beacon-store): add idempotency journal primitives`), after Commit 2 (`08c9ff2`).
**Rollback boundary**: remove only the journal source/test and revert task checkboxes 4.13–4.20; retain the two serialization commits.

### Commit 3 evidence

**Historical RED preserved exactly**: 4.13 originally failed with `Cannot find module '../../../src/adapters/fs-beacon-store/journal.js'` and `0 test` executed; 4.15's temporary nested-command probe failed with `TS2322` because `ApproveDraftCommand` lacked the required string index signature; 4.17's temporary lookup stub failed with `promise rejected "Error: lookup not implemented" instead of resolving`; and 4.19's temporary raw-content hash failed fast-check with shrunk counterexample `[{}]` because `excluded:changed` was included. These are historical observations, not new RED claims.
**GREEN verification before commit**: `npx vitest run tests/adapters/fs-beacon-store/journal.test.ts` → 1 file, 4 tests passed; `npm run lint` → exit 0 (pre-existing boundaries deprecation warnings); `npx tsc --noEmit` → exit 0; `git diff --check` → exit 0. The exact final 4.20 sequence is run again after Commit 3 as required.
**Files**: `src/adapters/fs-beacon-store/journal.ts`, `tests/adapters/fs-beacon-store/journal.test.ts`, `openspec/changes/fs-beacon-store/tasks.md`, this subsection.
**Authored count**: 299 changed lines across all commit paths (289 additions, 10 deletions), within the 400-line limit; no code-golfing or semantic reduction was used.

**Final U4 verification**: focused suite 4 files / 26 tests passed; full suite 17 files / 176 tests passed; lint and typecheck exited 0; `git diff --check` passed; the tracked worktree was clean. All four serialization/journal source and test hashes matched the pre-split verified candidate exactly.

**Remaining implementation tasks**: none for U4b; tasks 4.8–4.20 are checked. Parent-owned native settlement follows this artifact correction; no review, receipt, validation actor, or delivery gate was started by sdd-apply.

---

## Work Unit U5 — Read paths, committed-chain walk, corruption (PR 5)

**Status**: implementation complete. Tasks `5.1`–`5.17` are checked off in `tasks.md`, delivered as five commits (5a `84fa2c7`, 5b `0e78b0b`, 5c-1 `ef2b3d9`, 5c-2 `efb6c4b`, plus the RDD bounded correction `576846d`) per the operator-ratified split and the subsequent reliability correction documented below. A sixth commit, the external-review remediation described in the "Work Unit U5-external-review-remediation" section further below, lands after `576846d` on the same branch.
**Branch**: `change/fs-beacon-store-u5`, based on `master` at `d2b1ae5` (which already contains U1–U4, PRs #18/#19/#21/#22/#23/#24/#25, merged).
**Mode**: Strict TDD.
**Structured status consumed**: parent supplied the native runtime attempt authority (`gentle-ai sdd-attempt acquire` returned `state: proceed` against the parent's token, zero ledger mutation); this phase settles it. `artifactStore=openspec`; edit surfaces limited to `src/adapters/fs-beacon-store/**`, `tests/adapters/fs-beacon-store/**`, this change's OpenSpec files.

### Commit 5a — corruption.ts, FsBeaconStore skeleton, beacon-not-found (U5 tasks 5.1–5.3, 5.16)

**Scope**: `BeaconStoreCorruptionError`; `FsBeaconStore` constructor (`{ projectRoot, hasher, writer?, lock? }`, `writer` defaulting to `new FsAtomicWriter()`, `lock` defaulting to `new ProjectLock(projectRoot)`); `getBeacon` returning `beacon-not-found` on an absent `beacon.json`; stub bodies (throwing "not yet implemented") for the other 8 `BeaconStore` methods so the class satisfies the interface ahead of later units; `index.ts` now exports `FsBeaconStore`.
**RED evidence**: `npx vitest run tests/adapters/fs-beacon-store/read.test.ts` failed before `fs-beacon-store.ts` existed — `Error: Cannot find module '.../fs-beacon-store.js'`, 0 tests executed.
**GREEN evidence**: same command → `1 passed (1)` after implementing the constructor and `getBeacon`'s not-found branch.
**Triangulation**: skipped for this task — 5.1's RED test is the single literal scenario `beacon-store-port` R3 S2 names for `getBeacon`'s not-found path; the existing-beacon branch is exercised in Commit 5c once `reconcile.ts` exists to satisfy it.
**Full verification**: `npx tsc --noEmit` → exit 0; `npm run lint` → exit 0 (pre-existing `eslint-plugin-boundaries` deprecation warnings only); full `npx vitest run` → 18 files / 178 tests passed (up from 17/176 after U4).
**Files**: `src/adapters/fs-beacon-store/corruption.ts` (created), `src/adapters/fs-beacon-store/fs-beacon-store.ts` (created), `src/adapters/fs-beacon-store/index.ts` (modified), `tests/adapters/fs-beacon-store/read.test.ts` (created), `openspec/changes/fs-beacon-store/tasks.md` (checkboxes 5.1–5.3, 5.16).
**Authored diff**: 182 additions / 5 deletions across the five paths (`git diff --cached --stat`), under the 400-line budget.
**Rollback boundary**: delete `src/adapters/fs-beacon-store/corruption.ts` and `src/adapters/fs-beacon-store/fs-beacon-store.ts`; revert `index.ts` to `export {};`; delete `tests/adapters/fs-beacon-store/read.test.ts`; revert only checkboxes `5.1`–`5.3`, `5.16`. U1–U4 history untouched.

### Commit 5b — reconcile.ts scan half: committed-chain walk, D4 throw/no-throw table (U5 tasks 5.4–5.8)

**Scope**: `scanVersions(projectRoot, beaconId)` in the new `src/adapters/fs-beacon-store/reconcile.ts` — D1's read order for versions (manifest, revocation, active.json, every listing sorted first per D8), the roots set (`{ active.json's version } ∪ { every revoked version }`), the backward-walk closure over `supersedes_version`, the 3-row status derivation table, and D4's exact throw/no-throw split for the version-scoped corruption conditions. Draft reconstruction, the full `Beacon` assembly, and `journal` reads are explicitly out of scope for this commit — task 5.5 names the scan's version half only; D1b's Draft reconstruction is Commit 5c's.
**RED evidence**: `npx vitest run tests/adapters/fs-beacon-store/reconcile-walk.test.ts` failed before `reconcile.ts` existed — `Error: Cannot find module '.../reconcile.js'`, 0 tests executed for all 9 cases in the file (the trace reproduction, the `activeVersionId` null-derivation, the at-most-one-active structural assertion, the two "not corruption" duplicate-pointer/duplicate-`local_number` cases, the dangling-pointer throw, the cycle throw, the `active.json`-names-no-manifest throw, and the embedded-id-mismatch throw).
**GREEN evidence**: same command → `9 passed (9)` on the first implementation pass. The algorithm computes status by a single rule (`revocation.json` present → `revoked`, regardless of role; else reached as a walk step → `superseded`; else a root reached from nothing → `active`) applied per-root, per-chain, with per-chain (not global) cycle detection — this is what makes the "two manifests share `supersedes_version`" and "two manifests share `local_number`" cases pass with no throw by construction, with no separate duplicate-detection code path to accidentally trigger.
**Triangulation**: 9 cases across one implementation, covering every D4 row and D4's explicitly-not-corruption row in the same pass — RED confirmed the module absence for all of them together, matching the phase-4/U4 evidence pattern already used in this change for multi-case single-GREEN batches.
**Full verification**: `npx tsc --noEmit` → exit 0; `npm run lint` → exit 0 (pre-existing warnings only); full `npx vitest run` → 19 files / 187 tests passed.
**Files**: `src/adapters/fs-beacon-store/reconcile.ts` (created), `tests/adapters/fs-beacon-store/reconcile-walk.test.ts` (created), `openspec/changes/fs-beacon-store/tasks.md` (checkboxes 5.4–5.8).
**Deviation note**: D7 layer-1 id-validation wiring (the "path segment read from disk failing id validation → throw" row of D4) is not invoked inside `scanVersions` in this commit — no RED test in tasks 5.4–5.8 names it, and `Object.fromEntries` already provides D7 layer-2 prototype-pollution safety for the materialised `versions` record. Left for a later unit if a task requires it explicitly.
**Rollback boundary**: delete `src/adapters/fs-beacon-store/reconcile.ts` and `tests/adapters/fs-beacon-store/reconcile-walk.test.ts`; revert only checkboxes `5.4`–`5.8`. Commit 5a and all earlier units untouched.

### Commit 5c-1 — Draft reconstruction (D1b), getBeacon wiring, round-trip (U5 tasks 5.9, 5.10, 5.13)

**Split note**: Commit 5c was originally implemented and fully green as one slice covering tasks 5.9–5.15 and 5.17 (421 insertions / 15 deletions = 436 authored lines across `reconcile.ts`, `fs-beacon-store.ts`, `read.test.ts`, `tasks.md` — above the 400-line budget). Per the apply skill's STOP rule this was reported rather than silently committed over budget. The operator reviewed the measurement and ratified splitting it into two commits, 5c-1 and 5c-2, along the natural read-method boundary — no implementation change, only the commit boundary. This is that first half.
**Scope**: `reconcile.ts` extended with `scanDrafts` (D1b's total reconstruction rule — `tombstone.json` wins over `draft.json` regardless of the latter's presence, yielding `abandoned` with the tombstone's fields including `label`; `draft.json` alone with `status: "open"` → `open`; `status: "closed"` → `closed` with `content` retained) and `scanBeacon` (the full read-only `Beacon` assembly: `beacon.json` plus the concurrent version and draft scans); `fs-beacon-store.ts`'s `getBeacon` wired to `scanBeacon`; `listBeacons` and `getActiveVersion` remain the pre-existing "not yet implemented" stubs (5c-2's scope). `read.test.ts` extended with the shared fixture helpers (`writeBeaconRecord`, `writeManifest`, `writeActive`, `writeOpenDraft`, `writeClosedDraft`, `writeAbandonedDraft`), the Draft-reconstruction test (D1b, all 3 variants), and the round-trip test (`fs-beacon-store` R1 S1).
**RED evidence**: from the original combined implementation pass (before the split) — `npx vitest run tests/adapters/fs-beacon-store/read.test.ts` against the pre-extension `fs-beacon-store.ts` failed the Draft-reconstruction test and the round-trip test with `Error: getBeacon: reconstruction not yet implemented for "…"`; the pre-existing not-found test (5.1) continued passing, confirming the safety net.
**GREEN evidence**: with `scanDrafts`/`scanBeacon` implemented and `getBeacon` wired, both tests pass.
**Independent verification (post-split, this commit's exact tree)**: `npx vitest run tests/adapters/fs-beacon-store/` → 8 files / 57 tests passed; full `npx vitest run` → 19 files / 189 tests passed (up from 19/187 after Commit 5b); `npx tsc --noEmit` → exit 0 (`listBeacons`/`getActiveVersion` stubs still typecheck); `npm run lint` → exit 0 (pre-existing `eslint-plugin-boundaries` deprecation warnings only).
**Files**: `src/adapters/fs-beacon-store/reconcile.ts` (extended), `src/adapters/fs-beacon-store/fs-beacon-store.ts` (extended), `tests/adapters/fs-beacon-store/read.test.ts` (extended), `openspec/changes/fs-beacon-store/tasks.md` (checkboxes 5.9, 5.10, 5.13), `openspec/changes/fs-beacon-store/apply-progress.md`.
**Authored diff**: `git diff --cached --numstat` measured 327 authored lines (12+1 apply-progress.md, 3+3 tasks.md, 4+3 fs-beacon-store.ts, 134+1 reconcile.ts, 165+1 read.test.ts) immediately before commit — under the 400-line budget. Committed as `ef2b3d9`, which `git log --stat` reports as 318 insertions / 9 deletions = 327 changed lines, matching.
**Rollback boundary**: `git revert ef2b3d9`; `getBeacon` reverts to the not-found-only behavior from Commit 5a, `listBeacons`/`getActiveVersion` remain stubs as before. Commits 5a/5b and all earlier units untouched.

### Commit 5c-2 — listBeacons/getActiveVersion, project.json isolation, orphan classification, final verification (U5 tasks 5.11, 5.12, 5.14, 5.15, 5.17)

**Scope**: `reconcile.ts` extended with `listBeaconIds` (D8's sorted, `.tmp.`-filtered listing of every beacon directory); `fs-beacon-store.ts`'s `listBeacons` and `getActiveVersion` wired to `listBeaconIds`/`scanBeacon` and `resolveActiveVersion`, both read-only with no lock acquisition (`fs-beacon-store` R4 — reads never require the lock). `read.test.ts` extended with the `listBeacons`/`getActiveVersion` tests, the `project.json`-untouched test (R1 S2 / D9, exercising all three read methods together), and the orphan-classification test (`beacon-store-recovery` R2 S1, read half).
**RED evidence**: from the original combined implementation pass (before the split) — the `listBeacons` test failed with `Error: listBeacons: not yet implemented`; both `getActiveVersion` tests failed with `Error: getActiveVersion: not yet implemented for "…"`; the `project.json`-untouched and orphan-classification tests failed transitively through the same not-yet-implemented errors.
**GREEN evidence**: with `listBeaconIds` implemented and `listBeacons`/`getActiveVersion` wired, all pass. Combined with 5c-1's tests: `npx vitest run tests/adapters/fs-beacon-store/read.test.ts` → all cases pass.
**Full verification (this commit's exact tree, U5 final)**: `npx tsc --noEmit` → exit 0; `npm run lint` → exit 0 (pre-existing warnings only); full `npx vitest run` → 19 files / 194 tests passed (up from 19/189 after Commit 5c-1).
**Files**: `src/adapters/fs-beacon-store/reconcile.ts` (extended), `src/adapters/fs-beacon-store/fs-beacon-store.ts` (extended), `tests/adapters/fs-beacon-store/read.test.ts` (extended), `openspec/changes/fs-beacon-store/tasks.md` (checkboxes 5.11, 5.12, 5.14, 5.15, 5.17), `openspec/changes/fs-beacon-store/apply-progress.md`.
**Authored diff**: core code+test+tasks diff (`git diff --cached --numstat`, excluding this apply-progress.md addition) measured 126 authored lines (5+5 tasks.md, 15+3 fs-beacon-store.ts, 13+0 reconcile.ts, 84+1 read.test.ts) — well under the 400-line budget even combined with this evidence section. See the commit's own evidence line in the apply result for the exact final total including `apply-progress.md`.
**Rollback boundary**: revert this commit; `listBeacons`/`getActiveVersion` revert to the "not yet implemented" stubs from Commit 5a. Commit 5c-1 and all earlier units untouched.

U5 is now complete: all of tasks `5.1`–`5.17` checked off in `tasks.md`, delivered as four stacked commits (5a `84fa2c7`, 5b `0e78b0b`, 5c-1, 5c-2) — the last two produced by an operator-ratified split of what was originally implemented as a single over-budget slice, with no implementation change across the split, only the commit boundary.


### Bounded correction — U5-R3-reliability-correction (two CRITICAL reliability findings)

**Finding 1 — R3-walk-root-order-overwrite (CRITICAL, deterministic)**: `scanVersions`'s per-root walk called `committed.set(current, statusOf(...))` on every visit, so a version reachable from two roots (D1c's revocation crash window: a revoked root's `supersedesVersion` chains to the version `active.json` still names) had its final status decided by which root's sorted-order walk ran last, not by structure.
**RED observed** (`reconcile-walk.test.ts`, ordering A — revoked root id sorts before the active-named version id): `AssertionError: expected { versionId: 'ver_2_active', … } to match object { status: 'superseded', … }` — `- "status": "superseded", "supersededBy": "ver_1_revoked", + "status": "active"`. Ordering B (active-named id sorts first) passed by coincidence under the old code, confirming the bug is order-dependent exactly as described.
**Fix**: replaced the single-pass walk-and-write with two passes. Pass 1 walks every root and records the committed-id set plus every walk-step edge (`predecessor -> successor` via `supersedesVersion`) globally, only ever *setting* an edge, never clearing one, so the accumulated edges are independent of root visitation order. Pass 2 applies D1's ratified 3-row table to the completed structure: `revocation.json` present -> revoked; else a recorded walk-step edge -> superseded; else -> active. Per-chain cycle detection (`chainVisited`) is unchanged and still throws `BeaconStoreCorruptionError` on a true cycle within one chain.
**GREEN**: both orderings now derive `ver_2_active`/`ver_1_active` as `superseded` with `activeVersionId: null`; all 9 pre-existing `reconcile-walk.test.ts` cases still pass unchanged.

**Finding 2 — R3-enotdir-escapes-read-paths (CRITICAL, inferential)**: `listSorted` returned raw `readdir` entry names with only a `.tmp.` filter, so a stray non-directory entry inside `versions/` or `drafts/` (e.g. an OS metadata file) made the subsequent per-record `readFile` fail with a raw `ENOTDIR`, which `isMissing` does not recognise, so it escaped `getBeacon`/`listBeacons`/`getActiveVersion` unwrapped.
**RED observed** (`read.test.ts`, stray `.DS_Store` written into `versions/` and separately into `drafts/`): `AssertionError: expected error to be instance of BeaconStoreCorruptionError` — actual `Error { message: 'ENOTDIR: not a directory, open '.../versions/.DS_Store/manifest.json'', code: 'ENOTDIR' }` (and the analogous `drafts/.DS_Store/tombstone.json` for the drafts case), for all three read methods.
**Fix + D4 reasoning**: `listSorted` now calls `readdir(path, { withFileTypes: true })` and throws `BeaconStoreCorruptionError` for any non-`.tmp.` entry whose `Dirent.isDirectory()` is false, before it is ever joined into a record path. Chosen over silent filtering because D4's "declared NOT corruption" table (design.md D4) is an explicit, closed list, and a non-directory entry in `versions/`/`drafts/` is not one of its rows; D4's general rule for reads is "throw on corruption; a repair tool must survive what a read must not silently accept" (design.md, D1's classification-table note). Silently filtering the stray entry would also silently drop a real version/draft directory that a stray file happened to replace, with no signal to the caller — strictly worse than a loud, typed throw.
**GREEN**: both stray-file tests pass — `getBeacon`, `getActiveVersion`, and `listBeacons` all reject with `BeaconStoreCorruptionError`, never a raw `ENOTDIR`.

**Verification**: full `npx vitest run` -> 19 files / 198 tests passed (194 baseline + 4 new). `npx tsc --noEmit` -> exit 0. `npm run lint` -> exit 0 (pre-existing `eslint-plugin-boundaries` deprecation warnings only, unrelated to this change).
**Authored diff**: `git diff --cached --numstat` immediately before commit — see the apply result for the exact total; measured at 180 lines across `reconcile.ts`, `read.test.ts`, `reconcile-walk.test.ts` before this evidence addition, under the 200-line correction budget.
**Files**: `src/adapters/fs-beacon-store/reconcile.ts` (fixed), `tests/adapters/fs-beacon-store/reconcile-walk.test.ts` (+2 tests), `tests/adapters/fs-beacon-store/read.test.ts` (+2 tests), `openspec/changes/fs-beacon-store/apply-progress.md` (this section).
**Rollback boundary**: revert this single commit; U5's prior four commits (5a `84fa2c7`, 5b `0e78b0b`, 5c-1, 5c-2) are untouched and remain green on their own.

---

## Work Unit U5-external-review-remediation — external review fixes (PR 5 follow-up)

**Status**: implementation complete, one commit on `change/fs-beacon-store-u5` (HEAD `576846d` at start). This commit's own SHA is reported in the apply-phase return envelope rather than self-referenced here, since a commit cannot embed its own hash before it exists.
**Branch**: `change/fs-beacon-store-u5`.
**Mode**: Strict TDD.
**Scope guard**: only `src/adapters/fs-beacon-store/**`, `tests/adapters/fs-beacon-store/**`, and this file were touched. No domain, application, cli, other-adapter, or `package.json` change was needed.

### ROOT CAUSE 1 — wired D7's `classifyId` into every id path

**RED evidence** (`tests/adapters/fs-beacon-store/read.test.ts`, run before the fix): `getBeacon("bad id")` and `getActiveVersion("bad id")` both threw the bare `Error: Invalid filesystem id: bad id` from `assertValidId`/`pathForId` instead of resolving to `{ ok: false, error: { rule: "beacon-not-found", ... } }`. A beacon directory literally named `bad id` on disk made `listBeacons()` reject with that same bare `Error` instead of `BeaconStoreCorruptionError`. A version directory named `bad version` under `versions/` made `scanVersions` reject with the bare `Error` too (`tests/adapters/fs-beacon-store/reconcile-walk.test.ts`).
**Fix**: `fs-beacon-store.ts`'s `getBeacon`/`getActiveVersion` now call `classifyId(beaconId, "existing")` first and return the `beacon-not-found` refusal when it is not `"valid"`, before touching disk. `reconcile.ts`'s shared `listSorted` (versions/drafts) and `listBeaconIds` (beacons) now call `classifyId(name, "disk")` on every retained entry and throw `BeaconStoreCorruptionError` for anything that fails, closing the gap for beacon, version, and draft directory names alike.
**GREEN evidence**: all four new tests pass; full `npx vitest run` unaffected elsewhere.

### ROOT CAUSE 2 — closed the `listBeaconIds` ENOTDIR gap

**RED evidence**: a stray non-directory file directly in `beacons/` (`.DS_Store`) made `listBeacons()` reject with a raw `Error { code: 'ENOTDIR', ... }` instead of `BeaconStoreCorruptionError`, because `listBeaconIds` still called `readdir` without `withFileTypes`.
**Fix**: `listBeaconIds` now calls `readdir(layout.beacons(), { withFileTypes: true })`, exactly the treatment `listSorted` already had, and throws `BeaconStoreCorruptionError` for any non-`.tmp.` entry that is not a directory, before the D7 id check above runs.

### DEFECT 3 — `pathExists` no longer swallows every error

**RED evidence**: with `beacons/bcn_1` created as a *file* (not a directory), `store.getBeacon("bcn_1")` resolved to `{ ok: false, error: { rule: "beacon-not-found", beaconId: "bcn_1" } }` instead of surfacing the underlying `ENOTDIR` — the bare `catch` in `pathExists` mapped every error, not just `ENOENT`, to "not found".
**Fix + D3/D4 reasoning**: `pathExists` now re-throws unless the caught error's `code` is `ENOENT`. Justification: `BeaconStoreDiskRefusal` (D3) is a *closed* union with no generic "unreadable"/"io-error" member — inventing one to carry `EACCES`/`EPERM`/other errno values would either misuse `beacon-not-found` (a lie: the beacon is present, just inaccessible) or require widening the closed union outside this remediation's scope. D4's existing "Unmodelled `errno` ... → throw" row already establishes that an errno with no modelled disk condition throws rather than being folded into an existing refusal; applying the same rule to reads (not just writes) is the narrowest fix consistent with D3/D4 as written.
**GREEN evidence**: the new test asserts `getBeacon` rejects with an error matching `/ENOTDIR/` instead of resolving to a refusal.

### DEFECT 4 — unknown draft status is corruption, not silently `closed`

**RED evidence**: a `draft.json` with `status: "pending"` but otherwise carrying every field a `"closed"` draft needs (`approvedVersionId`, `closedAt`) was silently reconstructed with `status: "closed"` — `getBeacon` resolved `ok: true` with a beacon whose draft's status did not match what was on disk, no error at all.
**Fix**: `scanDrafts` now checks `draft.status !== "closed"` (after the `"open"` branch) and throws `BeaconStoreCorruptionError` for anything else, per D1b's reconstruction rule being total over exactly `open | closed | abandoned`. `DraftFile.status` is retyped `string` (was the optimistic `"open" | "closed"`) since `unpick` copies it verbatim with no enum validation — the type now matches what is actually trusted from disk.
**GREEN evidence**: the corrected test (carrying every "closed" field except a modelled status) now throws as expected.

### DEFECT 5 — round-trip test now asserts full structural equality

`tests/adapters/fs-beacon-store/read.test.ts`'s round-trip test was rewritten to build an explicit expected `Beacon` (every field of the version and all three reconstructed drafts) and assert `toEqual` against it, replacing the prior `toMatchObject`/key-list assertions. Observed: this test already passed against the pre-remediation implementation — `scanBeacon`/`scanVersions`/`scanDrafts` were already structurally correct; the defect was test coverage, not production behavior. No production code changed as a result of this defect.

### DEFECT 6 — orphan classification asserted at the `reconcile.ts` scan level

Added a test to `reconcile-walk.test.ts` that reproduces the crash precondition literally: `manifest.json` present, `semantics.json` present (a new `writeSemantics` helper), the version excluded from the committed set (via `supersedesVersion` pointing at the active root without being reachable), and no journal entry. Asserts directly on `scanVersions`'s `orphanVersionIds`, `versions[id]` being `undefined`, and `activeVersionId`. This test already passed against the pre-remediation `scanVersions` (the committed-chain walk already excluded it correctly); the defect was the missing assertion at the scan level with the full precondition, not a production bug. The pre-existing `read.test.ts` orphan-exclusion test (asserting through `FsBeaconStore`) is unchanged.

### DEFECT 7 — added the two missing D4 corruption-boundary tests

Added to `reconcile-walk.test.ts`: malformed JSON in `manifest.json` (`"{ this is not valid json"`), and a `contract` string with major version `2` (`"pharos.version-manifest/2"`). Both already throw `BeaconStoreCorruptionError` via `readRecord`'s existing catch-and-wrap around `deserializeRecord` (which throws on `JSON.parse` failure and on any contract-string mismatch, not only a major-version mismatch specifically) — both tests passed against the pre-remediation code. No production change was required; this closes a test-coverage gap D4's table declared but no test exercised.

### DEFECT 8 — this section, and the corrected U5 header above

Corrected the U5 section header (previously "four stacked commits" with 5c-2's SHA missing) to name all five prior commits, including the RDD correction `576846d`, and to point to this section for the sixth (remediation) commit.

### Final verification (this commit's exact tree)

- Focused: `npx vitest run tests/adapters/fs-beacon-store/` → 8 files / 76 tests passed (66 baseline + 10 new).
- Full suite: `npx vitest run` → 19 files / 208 tests passed (198 baseline + 10 new).
- `npx tsc --noEmit` → exit 0.
- `npm run lint` → exit 0 (pre-existing `eslint-plugin-boundaries` deprecation warnings only, unrelated to this change).
- `git diff --cached --numstat` (source + tests only, before this evidence addition): 24+3 `fs-beacon-store.ts`, 48+6 `reconcile.ts`, 144+9 `read.test.ts`, 71+0 `reconcile-walk.test.ts` = 305 authored lines, under the 400-line budget.

**Files**: `src/adapters/fs-beacon-store/fs-beacon-store.ts` (fixed), `src/adapters/fs-beacon-store/reconcile.ts` (fixed), `tests/adapters/fs-beacon-store/read.test.ts` (+8 tests, 1 rewritten), `tests/adapters/fs-beacon-store/reconcile-walk.test.ts` (+3 tests), `openspec/changes/fs-beacon-store/apply-progress.md` (this section and the U5 header correction).
**Rollback boundary**: revert this single commit; the five prior U5 commits (5a `84fa2c7`, 5b `0e78b0b`, 5c-1 `ef2b3d9`, 5c-2 `efb6c4b`, RDD correction `576846d`) are untouched and remain green on their own.

---

## Work Unit U6 — Draft write paths: createDraft, updateDraft, forkDraft (PR 6)

**Status**: in progress, delivered as an operator-ratified three-commit split (6a/6b/6c). This section covers Commit 6a (tasks 6.1–6.6).
**Branch**: `change/fs-beacon-store-u6`, based on `change/fs-beacon-store-u5-remediation` (PR #33, open, RDD-approved) at `3101644`.
**Mode**: Strict TDD.
**Structured status consumed**: `artifactStore=openspec`; edit surfaces limited to `src/adapters/fs-beacon-store/**`, `tests/adapters/fs-beacon-store/**`, `tests/contract/beacon-store/**`, this change's OpenSpec files. Parent supplied and owns the native runtime attempt authority (`gentle-ai sdd-attempt acquire` returned `state: proceed`, no `settle_obligation`); this phase settles it at the end of Commit 6c.

### Commit 6a — the mutating envelope + createDraft (U6 tasks 6.1–6.6)

**Scope**: `FsBeaconStore.createDraft` implementing the full envelope from the "Data Flow" section for this one method — lock acquire → journal lookup by `keyHash` (step 1b) → `readBeacon()`/D10 bootstrap synthesis (step 2) → the unchanged Slice C `createDraft` → project writes (`beacon.json` on bootstrap only, then `drafts/<D>/draft.json`, both via `writeAtomic`) → `createExclusive` journal entry → lock release. Step (1a)'s scan+apply pending replay is a documented no-op at this commit (no RED test in 6.1–6.6 names it; D1e's replay rows land in Commit 6c per task 6.12) — recorded as a code comment at the exact envelope position rather than a dead stub function. `updateDraft`/`forkDraft` remain the pre-existing "not yet implemented" stubs.
**D7 id validation** (Hard-won lesson 3 from U5): `createDraft`'s `beaconId` uses the `"creation"` provenance special case (D7's `[R4]` note — it may name a beacon that does not exist yet, so an invalid id refuses `invalid-id`, never `beacon-not-found`); `cmd.draftId` uses `"creation"` too, since it names a new draft. Both refuse before the lock is ever acquired, never throw.
**Directory creation**: `AtomicWriter` writes into an already-existing parent directory by design (D5); neither `writeAtomic` nor `createExclusive` create one. `FsBeaconStore` owns this via a new private `writeIntoDir` helper (`mkdir(dirname(path), { recursive: true })` before delegating to the writer) and an equivalent inline `mkdir` before `recordJournalEntry`'s `createExclusive` call for `journal/idempotency/`. This was not called out explicitly by any task text; it surfaced as an `ENOENT` failure during the first GREEN run against a fresh `mkdtemp` project (no prior unit had written into a not-yet-created subdirectory) and was fixed before re-running GREEN.
**RED evidence**: `npx vitest run tests/adapters/fs-beacon-store/draft-writes.test.ts` against the pre-implementation stub — all 6 new tests failed with `Error: createDraft: not yet implemented (lands in U6)`, thrown from the untouched stub body.
**GREEN evidence**: same command after implementing `createDraft` and `writeIntoDir` — 4 of 6 passed immediately; the bootstrap-ordering, existing-beacon, and both idempotency tests failed with `ENOENT` opening the temp sibling of `beacon.json` (root cause above); after adding `writeIntoDir`/`recordJournalEntry`'s `mkdir` calls, all 6 passed: `6 passed (6)`.
**Task 6.3 wording note (recorded, not silently expanded)**: the task names "a refused `createDraft` (duplicate `draftId`) on a bootstrap" as the no-side-effect case. D10's own text states this is unreachable by construction ("`duplicate-draft-id` is then unreachable on a bootstrap — the record is empty"), since the in-memory bootstrap `Beacon` always has an empty `drafts` record, so `getOwn` can never find an existing entry to collide with. The closest reachable refusal on an absent beacon is the D7 `invalid-id` classification, checked before the lock is acquired and before any domain call — the test exercises that path instead and documents the substitution inline.
**Task 6.4**: confirmed 6.3 passes against 6.2's construction with no additional production code change, as the task anticipates.
**Task 6.6**: confirmed 6.5's replay/conflict tests pass against the journal lookup already wired at step 1b of 6.2's envelope, with no additional production code change.
**Verification (this commit's exact staged tree)**: focused `npx vitest run tests/adapters/fs-beacon-store/draft-writes.test.ts` → `6 passed (6)`; `npx tsc --noEmit` → exit 0; `npm run lint` → exit 0 (pre-existing `eslint-plugin-boundaries` deprecation warnings only); full `npx vitest run` → 20 files / 214 tests passed (up from 208 baseline).
**Files**: `src/adapters/fs-beacon-store/fs-beacon-store.ts` (extended: imports, `replayOrConflict`, `writeIntoDir`, `recordJournalEntry`, `createDraft`), `tests/adapters/fs-beacon-store/draft-writes.test.ts` (created, 6 tests), `openspec/changes/fs-beacon-store/tasks.md` (checkboxes `6.1`–`6.6`).
**Authored diff** (`git diff --cached --numstat` immediately before commit): 6+6 `tasks.md`, 118+6 `fs-beacon-store.ts`, 191+0 `draft-writes.test.ts` — see the apply-result envelope for the exact total including this evidence addition; under the 400-line budget.
**Rollback boundary**: revert `createDraft`'s body to the "not yet implemented" stub, remove `replayOrConflict`/`writeIntoDir`/`recordJournalEntry` and the added imports, delete `tests/adapters/fs-beacon-store/draft-writes.test.ts`, and revert checkboxes `6.1`–`6.6`. U1–U5 and the U5 external-review-remediation commit are untouched.

### Commit 6b — updateDraft + forkDraft (U6 tasks 6.7–6.10)

**Scope**: `FsBeaconStore.updateDraft` and `FsBeaconStore.forkDraft`, both the same envelope shape as Commit 6a's `createDraft` minus the D10 bootstrap branch (`beacon-not-found` fires on an absent beacon for both). `updateDraft`'s `beaconId` and `forkDraft`'s `beaconId`/`sourceDraftId` use the `"existing"` D7 provenance (never bootstrap); `forkDraft`'s new `cmd.draftId` uses `"creation"`, matching `createDraft`'s new-draft-id treatment from 6a. Both reuse Commit 6a's `replayOrConflict`, `writeIntoDir`, and `recordJournalEntry` helpers unchanged.
**RED evidence**: `npx vitest run tests/adapters/fs-beacon-store/draft-writes.test.ts` against the pre-implementation stubs — the 5 new tests (stale-revision refusal, matching-revision success, `updateDraft` beacon-not-found, fork-from-open, fork-from-closed) failed with `Error: updateDraft: not yet implemented (lands in U6)` / `Error: forkDraft: not yet implemented (lands in U6)`; the 6 pre-existing `createDraft` tests continued passing, confirming the safety net.
**GREEN evidence**: same command after implementing both methods — `11 passed (11)`.
**Fork-from-closed fixture note**: `approveDraft` (U8) is not yet implemented, so a `closed` draft cannot be produced through the store's own API yet. The closed-source test writes `draft.json` directly to disk with `serializeRecord("draft", ...)` (the same technique `read.test.ts`'s `writeClosedDraft` helper already uses), then calls `store.forkDraft` against that fixture — `scanBeacon` reconstructs it identically regardless of how it reached disk, so this is a faithful exercise of the read-then-fork path, not a shortcut around it.
**Verification (this commit's exact staged tree)**: focused `npx vitest run tests/adapters/fs-beacon-store/draft-writes.test.ts` → `11 passed (11)`; `npx tsc --noEmit` → exit 0; `npm run lint` → exit 0 (pre-existing `eslint-plugin-boundaries` deprecation warnings only); full `npx vitest run` → 20 files / 219 tests passed (up from 214 after Commit 6a).
**Files**: `src/adapters/fs-beacon-store/fs-beacon-store.ts` (extended: imports, `updateDraft`, `forkDraft`), `tests/adapters/fs-beacon-store/draft-writes.test.ts` (extended, +5 tests), `openspec/changes/fs-beacon-store/tasks.md` (checkboxes `6.7`–`6.10`).
**Authored diff** (`git diff --cached --numstat` immediately before commit): 4+4 `tasks.md`, 91+8 `fs-beacon-store.ts`, 114+1 `draft-writes.test.ts` — see the apply-result envelope for the exact total including this evidence addition; under the 400-line budget.
**Rollback boundary**: revert `updateDraft`/`forkDraft` bodies to their "not yet implemented" stubs, remove the four added journal imports and the two domain aliases, delete the 5 tests added by this commit, and revert checkboxes `6.7`–`6.10`. Commit 6a and all earlier units are untouched.

### Commit 6c — D1e replay wiring + convergence (U6 tasks 6.11–6.14)

**Scope**: `reconcile.ts` gains `applyPendingDraftReplays(projectRoot, beaconId, writer)` — D1e's draft-scoped classification: for each draft under `beaconId` with no `tombstone.json`, reads `draft.json`'s `idempotency` stamp (a new optional `DraftIdempotencyStamp` field on the existing `DraftFile` interface, following the same untyped-on-disk/checked-at-runtime treatment DEFECT 4 established for `status`); when a stamp is present, its `method` is one of the three draft-window methods, and no journal entry exists yet for its `keyHash`, writes the missing entry from the stamp alone (`createJournalEntry`, `createExclusive`-based so a race lands on `"exists"` rather than a duplicate). `FsBeaconStore.createDraft`/`updateDraft`/`forkDraft` each call this at the top of their lock-held block, before the journal lookup, matching the envelope's step (1a). U6's task boundary intentionally stops here: the full `ArtifactClass`/`ArtifactRef`/`RecoverAction`/`RecoverReport` type surface D5b describes is explicitly task 9.6's to assemble, not this unit's — `applyPendingDraftReplays` is scoped to exactly the draft window this unit owns and is written to compose with, not duplicate, that later work.
**RED evidence**: `npx vitest run tests/adapters/fs-beacon-store/draft-writes.test.ts` against the pre-wiring tree — the 4 new "D1e" tests (createDraft/updateDraft/forkDraft same-key retry, plus the convergence test) failed with `expected false to be true`, because the retry reached the unchanged domain function and refused (`duplicate-draft-id` / `stale-draft-revision`) exactly as D1e's problem statement describes; the 11 pre-existing tests continued passing.
**GREEN evidence**: same command after adding `applyPendingDraftReplays` and wiring it into all three methods — `15 passed (15)`.
**Directory-creation note**: the first attempt at GREEN needed one more fix — `applyPendingDraftReplays`'s own `createJournalEntry` call needs `journal/idempotency/` to exist, exactly as Commit 6a's `recordJournalEntry` does; added the same `mkdir(layout.journalIdempotency(), { recursive: true })` call immediately before it.
**Verification (this commit's exact staged tree)**: focused `npx vitest run tests/adapters/fs-beacon-store/draft-writes.test.ts` → `15 passed (15)`; `npx tsc --noEmit` → exit 0; `npm run lint` → exit 0 (pre-existing `eslint-plugin-boundaries` deprecation warnings only); full `npx vitest run` → 20 files / 223 tests passed (up from 219 after Commit 6b).
**Call-site check (U5's Lesson 1)**: `grep -rn "applyPendingDraftReplays" src tests` shows the export, its three call sites in `fs-beacon-store.ts`, and its exercise from all 4 D1e tests — the primitive is wired, not merely unit-tested in isolation.
**Files**: `src/adapters/fs-beacon-store/reconcile.ts` (extended: `DraftIdempotencyStamp`, `idempotency?` on `DraftFile`, `applyPendingDraftReplays`), `src/adapters/fs-beacon-store/fs-beacon-store.ts` (extended: one import, three call sites), `tests/adapters/fs-beacon-store/draft-writes.test.ts` (extended: `CrashBeforeWriter`, `crashesAtJournalWrite`, +4 tests), `openspec/changes/fs-beacon-store/tasks.md` (checkboxes `6.11`–`6.14`).
**Authored diff** (`git diff --cached --numstat` immediately before commit): 4+4 `tasks.md`, 11+4 `fs-beacon-store.ts`, 65+1 `reconcile.ts`, 110+0 `draft-writes.test.ts` — see the apply-result envelope for the exact total including this evidence addition; under the 400-line budget.
**Rollback boundary**: remove `applyPendingDraftReplays`/`DraftIdempotencyStamp`/the `idempotency?` field from `reconcile.ts`; remove the three `applyPendingDraftReplays` call sites and the import from `fs-beacon-store.ts`; delete the 4 D1e tests and the `CrashBeforeWriter`/`crashesAtJournalWrite` helpers; revert checkboxes `6.11`–`6.14`. Commits 6a/6b and all earlier units are untouched.

U6 is now complete: all of tasks `6.1`–`6.14` checked off in `tasks.md`, delivered as three stacked commits (6a, 6b, 6c) per the operator-ratified split. Native runtime attempt settlement for `U6-draft-write-paths` is reported in the apply-result envelope, not self-referenced here.

---

## Work Unit U6-advisory-remediation — RDD advisory findings on U6 (5 WARNINGs)

**Scope**: `src/adapters/fs-beacon-store/fs-beacon-store.ts`, `tests/adapters/fs-beacon-store/draft-writes.test.ts`, this file. No domain, application, cli, other-adapter, or `package.json` change was needed. The 3 SUGGESTIONs (`R3-bootstrap-partial-write`, `R3-refusal-classification-gaps`, `R3-replay-blast-radius`) were left untouched per instructions.

### WARNING 1 — `R3-unvalidated-draft-ids` (correctness)

**Reachability analysis (recorded honestly)**: `updateDraft`'s `cmd.draftId` and `forkDraft`'s `cmd.sourceDraftId` were never validated by `classifyId` before this fix, but tracing every use showed neither ever reaches `layout.draftRecord`/`pathForId` while invalid. Both flow only into `getOwn(beacon.drafts, id)` (a pure `Object.hasOwn` lookup, D7-safe against prototype shadowing) before any disk write; an invalid id can never match a real (validated-at-creation) key, so the domain function itself already refuses `draft-not-found` first. A RED test for both (`updateDraft`/`forkDraft` with an invalid id, e.g. `"bad id"`) was written expecting exactly `{ rule: "draft-not-found", draftId: "bad id" }` and **passed unmodified against the pre-fix code** — a coverage confirmation, not a bug reproduction; recorded here rather than fabricated as a failure.
**Fix (still applied, as directed)**: added explicit `classifyId(cmd.draftId, "existing")` / `classifyId(cmd.sourceDraftId, "existing")` checks at the same position as every other D7 guard in the file, both refusing `draft-not-found` (D7's row 2 — caller-supplied id addressing existing state → not-found refusal, never a throw). `draft-not-found` was chosen over inventing a new `BeaconStoreDiskRefusal` member because it is exactly the refusal the domain function already returns for a valid-but-absent id of the same kind — reusing it keeps `BeaconStoreDiskRefusal`'s closed union unwidened, the same reasoning already applied to `pathExists` in the U5 remediation. This closes the *structural* gap the review flagged (every other caller-supplied id in the file has an explicit D7 guard; these two didn't) and removes the dependency on the domain's lookup-miss as an implicit safety net, without changing observable behavior for any input — confirmed by the unchanged RED-turned-confirmation test staying green.

### WARNING 2 — `R3-replay-hit-unguarded-scan` (correctness)

**Root cause**: `JournalEntry.beaconId` is stored alongside `inputHash` in the same JSON file but is not cryptographically bound to it — nothing prevents the two fields from disagreeing on disk. `replayOrConflict`'s replay-hit branch trusted `inputHash` equality alone and re-scanned whatever beacon the *current* call requested, never checking it against the entry's own `beaconId`.
**RED evidence**: wrote a test that performs a real `createDraft`, then tampers the persisted journal entry file (`deserializeRecord`/`serializeRecord` round-trip changing only `beaconId`), then repeats the same call. Before the fix this **resolved** `{ ok: true, value: <bcn_1's scan> }` instead of rejecting — observed directly (`AssertionError: promise resolved ... instead of rejecting`) — silently masking the on-disk inconsistency.
**D3/D4 reasoning**: a mismatched `beaconId` on an otherwise-matching entry is not reachable through any legal call sequence (every `*Input` builder embeds `beaconId` in the hashed `SemanticValue`, so two different beacons can only produce colliding `inputHash`es via a SHA-256 collision) — it is definitionally an on-disk inconsistency. D4's unmodelled/impossible-state rule says throw, not invent a refusal; D3's closed `BeaconStoreDiskRefusal` union has no member for "the journal entry disagrees with itself," and manufacturing one would misclassify genuine corruption as an ordinary, retriable refusal. `BeaconStoreCorruptionError` was chosen (imported from `./corruption.js`) instead of a bare `Error`, consistent with every other corruption signal in this adapter.
**GREEN evidence**: same test now passes — `rejects.toThrow(BeaconStoreCorruptionError)`.

### WARNING 3 — `R3-replay-guards-untested` (coverage)

Added one test driving `applyPendingDraftReplays` directly with four sibling draft fixtures under one beacon: a tombstoned draft (with a stamp that would otherwise replay), an empty draft directory with no `draft.json`, a `draft.json` with no `idempotency` field, and a `draft.json` whose stamp names `"approveDraft"` (not a draft-window method). Asserted the call resolves without throwing and that neither the tombstoned nor the wrong-method stamp's `keyHash` produced a journal entry. **This test passed unmodified against the pre-existing `reconcile.ts`** — the three guards were already correctly implemented; this closes a coverage gap only, no production change.

### WARNING 4 — `R3-d1e-assertions-too-weak` (coverage)

Strengthened all three D1e crash-retry tests (`createDraft`/`updateDraft`/`forkDraft`) beyond `expect(retry.ok).toBe(true)`: each now asserts the exact draft set present (`Object.keys(retry.value.drafts)`, ruling out a duplicate draft), the adopted draft's actual `revision`/`content`/`origin` (ruling out a stale revision), and that the journal entry now exists with the expected `keyHash` and `method` (`deserializeRecord` round-trip). **All three passed unmodified** — the D1e implementation from Commit 6c was already correct; this closes a coverage gap only, no production change.

### WARNING 5 — `R3-refusal-side-effect-unproved` (coverage)

Added one assertion to the existing non-bootstrap stale-`expectedRevision` `updateDraft` test: after the refusal, `journal/idempotency/<keyHash>.json` does not exist (the existing assertion already covered `draft.json` bytes being unchanged). **Passed unmodified** — `updateDraft` already returns before any write on a domain refusal (`if (!mutated.ok) return mutated;` precedes both `writeIntoDir` and `recordJournalEntry`); this closes the non-bootstrap half of the no-side-effect proof that Task 6.3's bootstrap case left open, no production change.

### Call-site check

`grep -n "applyPendingDraftReplays\|BeaconStoreCorruptionError" src/adapters/fs-beacon-store/fs-beacon-store.ts` shows `BeaconStoreCorruptionError` imported and thrown at exactly the new guard (line ~142), and `applyPendingDraftReplays` still wired at all three pre-existing call sites — nothing added here is orphaned.

### Final verification (this commit's exact staged tree)

- Focused: `npx vitest run tests/adapters/fs-beacon-store/draft-writes.test.ts` → `19 passed (19)` (13 baseline + 6 new/strengthened describe blocks covering the 5 warnings).
- Full suite: `npx vitest run` → 20 files / 227 tests passed (up from 223 baseline).
- `npx tsc --noEmit` → exit 0.
- `npm run lint` → exit 0 (pre-existing `eslint-plugin-boundaries` deprecation warnings only).
- `git diff --cached --numstat` (before this evidence addition): 25+0 `fs-beacon-store.ts`, 142+1 `draft-writes.test.ts` = 168 authored lines, well under the 350-line budget.

**Files**: `src/adapters/fs-beacon-store/fs-beacon-store.ts` (D7 guards on `updateDraft`/`forkDraft`; `replayOrConflict` beaconId guard; `BeaconStoreCorruptionError` import), `tests/adapters/fs-beacon-store/draft-writes.test.ts` (2 new describe blocks for WARNING 1/3, 1 new describe block for WARNING 2, strengthened assertions in the 3 D1e tests and the stale-revision test for WARNING 4/5), `openspec/changes/fs-beacon-store/apply-progress.md` (this section).
**Rollback boundary**: revert the two `classifyId` guards added to `updateDraft`/`forkDraft`, the `beaconId` mismatch guard and its throw in `replayOrConflict`, and the `BeaconStoreCorruptionError` import in `fs-beacon-store.ts`; revert `draft-writes.test.ts` to its Commit 6c state. All of U1–U6 (including the U5 external-review remediation) are untouched.

## Work Unit U5-advisory-remediation — RDD advisory findings re-derived against current code

**Scope**: `src/adapters/fs-beacon-store/fs-beacon-store.ts`, `tests/adapters/fs-beacon-store/read.test.ts`, `tests/adapters/fs-beacon-store/layout.test.ts`, this file. No domain, application, cli, other-adapter, or `package.json` change was needed. `R3-malformed-record-untested` was already closed by the U5 remediation (`reconcile-walk.test.ts`) — left untouched.

### FINDING 1 — `R3-listbeacons-partial-directory` (correctness) — FIXED

**Root cause**: `writeIntoDir` does `mkdir(dirname(path), { recursive: true })` and then the atomic write. A crash between those two steps leaves `beacons/<id>/` existing but empty. `getBeacon` guards with `pathExists(layout.beaconRecord(id))` before ever calling `scanBeacon`, so it correctly reported `beacon-not-found`. `listBeacons` had no equivalent guard — it fed every directory name straight from `listBeaconIds` into `scanBeacon`, which throws `BeaconStoreCorruptionError("beacon.json missing for existing beacon directory")` for the same state.
**D10/I1/D4 reasoning**: D10 states `createDraft`'s bootstrap writes `beacon.json` before `draft.json`, and the window between the two "leaves a beacon with zero drafts and zero versions... a legal `Beacon`, not an artifact." The window *before* `beacon.json` lands is the same kind of pre-commit crash window one step earlier — I1 states nothing is observable before the domain call returns `ok`, so an empty beacon directory must not be observable as either a committed beacon or as corruption; it is simply not-yet-a-beacon. D4's corruption table has no row for "beacon directory present, `beacon.json` absent" — every row that *does* throw describes disk state that is inconsistent with something already committed (embedded id mismatch, malformed JSON, a dangling pointer). An empty directory is consistent with "not committed yet," which is exactly `beacon-not-found`'s territory, not corruption's. Conclusion: both read methods must treat a missing `beacon.json` identically to an absent directory.
**Fix**: `listBeacons` now checks `pathExists(layout.beaconRecord(beaconId))` per id (the same guard `getBeacon`/`getActiveVersion`/`updateDraft`/`forkDraft` already use) and skips ids that fail it, instead of calling `scanBeacon` unconditionally. `scanBeacon`'s own throw is left intact as a defensive last-resort for a record that disappears between an existence check and the read (a genuine race, not this finding's crash window) — every call site now performs that check first.
**RED evidence**: new test creates `beacons/bcn_crash/` via bare `mkdir` (no `beacon.json`) alongside a real committed beacon. Before the fix: `getBeacon("bcn_crash")` already returned `beacon-not-found` (passed), but `listBeacons()` threw — observed exactly: `BeaconStoreCorruptionError: beacon.json missing for existing beacon directory "bcn_crash"` at `reconcile.ts:363`, via `FsBeaconStore.listBeacons` at `fs-beacon-store.ts:105`.
**GREEN evidence**: same test now passes — `listBeacons()` resolves `ok: true` with only `["bcn_committed"]`, agreeing with `getBeacon`'s `beacon-not-found`.

### FINDING 2 — `R3-draft-throw-rows-untested` (coverage) — CONFIRMED, no production change

Two `scanDrafts` corruption rows in `reconcile.ts` were untested (the unmodelled-status row was already covered by the U5 remediation). Added two tests to `read.test.ts`, driven through `FsBeaconStore.getBeacon` (matching the existing "unknown draft status" test's pattern, since `scanDrafts` is not exported):
- An embedded `draftId` not matching its directory name (`draft.json` with `draftId: "draft_other"` under `drafts/draft_1/`).
- A `status: "closed"` draft missing both `approvedVersionId` and `closedAt`.

Both **passed unmodified against the pre-existing `reconcile.ts`** — a coverage confirmation, not a bug reproduction. The corresponding `throw new BeaconStoreCorruptionError(...)` guards at `reconcile.ts` lines ~307 (id mismatch) and ~334 (missing closed-draft fields) were already correct; this closes a coverage gap only.

### FINDING 3 — `R3-lockfree-read-unasserted` (coverage) — CONFIRMED, no production change

Added one test using the real `ProjectLock`: writes a `lock` file directly (bypassing `ProjectLock.acquire`) with a `remote-host-not-us` holder — a holder `ProjectLock`'s own liveness/staleness logic never breaks quickly, so any `acquire()` call on this fixture would block for the default 5s wait. Wrapped `getBeacon`, `listBeacons`, and `getActiveVersion` in a 300ms `Promise.race` deadline and asserted all three resolve `ok: true` well inside it, plus that the lock file bytes are untouched afterward. This gives the assertion teeth: if any read method were changed to call `lock.acquire()` first, the race would reject with `"read path blocked on the project lock"` and the test would fail, not merely pass by coincidence. **Passed unmodified** — none of the three read methods ever touch `this.lock`; this closes a coverage gap only, confirming `fs-beacon-store` R4.

### FINDING 4 — `R3-tmp-substring-filter` (SUGGESTION) — VERDICT: CORRECT AS-IS, no production change

Investigated whether the `.tmp.` substring filters in `reconcile.ts` (`listSorted`, `listBeaconIds`) and `layout.ts` (`isValidId`, `listBeaconIds`) can disagree. They cannot: `isValidId` unconditionally rejects any id containing `.tmp.` (`!value.includes(".tmp.")`), for every provenance (disk/existing/creation). Any name the substring pre-filter drops would *also* fail `classifyId(name, "disk")` immediately afterward and raise `BeaconStoreCorruptionError` — the pre-filter only changes that outcome from "throw" to "silently skip," which is exactly D8's stated intent ("the `.tmp.` filter excludes interrupted writes and D2's leaked liveness probes"). Because no legitimate id can ever contain `.tmp.` (the grammar forbids it universally), the filter can never silently drop a legitimate id — there is no id that is "valid" by grammar but happens to be excluded only by the substring check. Verdict: **harmless and correct as designed; not a defect.**
Added two pinning tests instead of changing code: a `layout.test.ts` unit test asserting every `.tmp.`-containing sample name is also grammar-invalid per `isValidId` (proving the two mechanisms structurally cannot diverge), and a `read.test.ts` integration test proving a `.tmp.`-named beacon directory (`bcn_1.tmp.leftover`) is silently excluded from `listBeacons()` rather than raising corruption, alongside a real committed beacon. Both passed unmodified.

### Final verification (this commit's exact staged tree)

- Focused: `npx vitest run tests/adapters/fs-beacon-store/read.test.ts tests/adapters/fs-beacon-store/layout.test.ts` → `30 passed (30)` (21 + 9 baseline across the two files, plus 6 new describe blocks / cases).
- Full suite: `npx vitest run` → 20 files / 233 tests passed (up from 227 baseline).
- `npx tsc --noEmit` → exit 0.
- `npm run lint` → exit 0 (pre-existing `eslint-plugin-boundaries` deprecation warnings only, no errors).
- `git diff --cached --numstat`: 8+0 `fs-beacon-store.ts`, 12+0 `layout.test.ts`, 120+0 `read.test.ts` = 140 authored lines, well under the 300-line budget.

**Files**: `src/adapters/fs-beacon-store/fs-beacon-store.ts` (`listBeacons` gains the `pathExists(layout.beaconRecord(beaconId))` guard, Finding 1 only), `tests/adapters/fs-beacon-store/read.test.ts` (5 new describe blocks: Finding 1 RED→GREEN, Finding 3 lock-free proof, Finding 2's two coverage confirmations, Finding 4's coverage confirmation), `tests/adapters/fs-beacon-store/layout.test.ts` (1 new test pinning Finding 4's grammar agreement), `openspec/changes/fs-beacon-store/apply-progress.md` (this section).
**Rollback boundary**: revert the `pathExists` guard added to `listBeacons` in `fs-beacon-store.ts`; revert the 5 new describe blocks in `read.test.ts` and the 1 new test in `layout.test.ts`. All of U1–U6 and the U5/U6 prior remediations are untouched.

---

## Work Unit U7a — normal abandonment and completed retries (tasks 7.1–7.4)

**Status**: complete; persisted checkboxes `7.1`–`7.4` are checked. U7b and all later work remain deferred. Strict TDD mode.

### Completed behavior
- `abandonDraft` locks, checks the journal, calls the unchanged domain function, then creates the immutable tombstone, removes `draft.json`, and creates the journal entry.
- Tombstone payload contains the ratified `label` extension plus final revision/hash, reason, timestamp, origin, and idempotency stamp.
- Completed same-key calls replay; changed logical input conflicts; a fresh key reaches the reconstructed `abandoned` draft and returns `draft-not-open` without writing. An injected writer `"exists"` response maps to `immutable-file-exists` only as the seam case.

### TDD Cycle Evidence
| Tasks | RED | GREEN / TRIANGULATE / REFACTOR |
|---|---|---|
| 7.1–7.2 | New real-temp-dir test file failed: `3 failed`, each with `abandonDraft: not yet implemented (lands in U7)`. | Implemented the D1b normal sequence; focused run passed `3 passed (3)`. Sequence/payload case exercises all three ordered writes. |
| 7.3–7.4 | The same RED run covered replay, conflict, fresh-key domain-first refusal, and injected seam-exists mapping against the stub. | Completed-retry case triangulates identical, changed, and fresh keys; no refactor was needed after lint/typecheck. |

### Verification
- Baseline: `npm test` → **20 files, 233 tests passed**.
- Focused: `npx vitest run tests/adapters/fs-beacon-store/abandon.test.ts` → **1 file, 3 tests passed**.
- `npx tsc --noEmit` → exit 0; `npm run lint` → exit 0 (pre-existing boundaries deprecation warnings only); final `npm test` → **21 files, 236 tests passed**.
- Runtime harness: real `mkdtemp` project directories and `FsAtomicWriter`; writer-owned call observation proves tombstone → removal → journal ordering. No filesystem mocks.

### Files / boundary / status
- Changed: `src/adapters/fs-beacon-store/fs-beacon-store.ts`, `tests/adapters/fs-beacon-store/abandon.test.ts`, `tasks.md`, and this progress file. Existing parent-approved planning correction remains unchanged in `design.md`, `spec.md`, and `tasks.md`.
- Rollback: remove `abandonDraft`'s U7a body and the abandon test; revert only checkboxes 7.1–7.4 and this section. This does not touch U6 or the deferred U7b replay rows.
- Delivery: stacked-to-main, PR 7a boundary only; no commit or lifecycle action performed. Authored count versus `9736448`, including the existing planning correction and untracked abandon test: **321** (294 additions + 27 deletions; ≤400).
- Structured status consumed: `gentle-ai.sdd-status@2`, `applyState=ready`, `nextRecommended=apply`, `artifactStore=openspec`, repo-local `/home/pedro/pharos`; `actionContext.mode=repo-local`. No action-context or edit-root warning.

### Remaining delegated tasks (exact persisted unchecked lines)
- [ ] 7.5 RED: extend the test file — D1b's 3-row crash table: (a) crash after tombstone, before `draft.json` removal → same-key retry replays removal and journal completion before lookup, then returns the journal result; (b) crash after removal, before journal → replay writes the journal entry only, then returns that result; (c) crash after journal → complete, no action; confirm each fails before the corresponding `RecoverAction` rows exist. <!-- sdd-owner: implementation -->
- [ ] 7.6 GREEN: extend `reconcile.ts` with D1b's classification rows and `apply` actions (`removed-abandoned-draft-file`, `wrote-journal-entry`), wired into step (1a) for `abandonDraft`. <!-- sdd-owner: implementation -->
- [ ] 7.7 RED→GREEN: add the changed-input crash-retry case — after a committed tombstone but before its journal entry, the same key with changed logical input completes cleanup and writes the original journal entry before lookup, then returns `idempotency-key-conflict`; tombstone bytes remain unchanged. <!-- sdd-owner: implementation -->
- [ ] 7.8 Final verification: `npx vitest run tests/adapters/fs-beacon-store/abandon.test.ts`; `npm run lint`; `npx tsc --noEmit`; record the U7b authored count and stop for ask-on-risk before any overage. <!-- sdd-owner: implementation -->

Parent lifecycle: settlement and any commit/review/delivery activity are deferred to the parent.

---

## Work Unit U7b — D1b abandonment crash replay (tasks 7.5–7.8)

**Status**: complete; persisted checkboxes `7.5`–`7.8` are checked. Strict TDD mode.

### Completed behavior
- `applyPendingDraftReplays` treats a stamped tombstone as the recovery authority: with a missing journal, it removes a still-present `draft.json` and creates only the original journal entry; with no draft it creates the journal only; with a journal it does nothing.
- Every draft mutation's existing pre-lookup replay call now completes pending abandonment work too; `abandonDraft` is wired into that ordering before its own lookup.
- A same-key retry returns the recovered journal result; changed input completes the original cleanup/journal before returning `idempotency-key-conflict`; a fresh key returns `draft-not-open`. Tombstone bytes and existing journals are never replaced.

### TDD Cycle Evidence
| Tasks | Test file / layer | Safety net | RED | GREEN / triangulate / refactor |
|---|---|---|---|---|
| 7.5–7.6 | `abandon.test.ts` / real-filesystem integration | 3/3 focused tests passed | Added the two incomplete D1b windows plus changed-input retry; focused run was **3 failed, 3 passed**. Same-key retries returned refusals and changed input returned `draft-not-open`. The already-complete post-journal case was pre-existing and naturally passed; it is not claimed as RED. | Tombstone stamps now type their idempotency data and replay under the held lock before lookup. First GREEN run exposed an extra no-op `removeAtomic` call in the tombstone-only row; guarding removal on an existing draft produced **6/6**. |
| 7.7 | `abandon.test.ts` / real-filesystem integration | Covered by the same genuine RED run above | The changed-input assertion was part of that RED run, before the D1b replay implementation; it failed with `draft-not-open`. | Passes after original cleanup/journal replay, with byte-identical tombstone. |
| 7.5 triangulation | `abandon.test.ts` / real-filesystem integration | 6/6 focused tests passed | N/A — cross-mutation case triangulates the new generic helper behavior rather than claiming a redundant RED. | A `createDraft` after a tombstone crash completes the abandoned draft's replay before its own journal lookup; final focused run **7/7**. No refactor beyond the guarded cleanup. |

### Verification
- `npx vitest run tests/adapters/fs-beacon-store/abandon.test.ts` → **1 file, 7 tests passed**.
- `npm test` → **21 files, 240 tests passed**.
- `npm run lint` → exit 0; only pre-existing `eslint-plugin-boundaries` deprecation warnings.
- `npm run typecheck` → exit 0.
- `git diff --check` → exit 0.
- Runtime harness: real `mkdtemp` projects and writer-owned `FsAtomicWriter` crash observers. The two interrupted windows explicitly prove lock release; retries prove repeat convergence.

### Files / boundary / status
- Changed: `src/adapters/fs-beacon-store/reconcile.ts`, `src/adapters/fs-beacon-store/fs-beacon-store.ts`, `tests/adapters/fs-beacon-store/abandon.test.ts`, persisted U7b task checkboxes, and this appended evidence.
- No design deviation: tombstone precedence remains reconstruction authority; replay only removes mutable `draft.json` when present and uses exclusive journal creation.
- Rollback boundary: remove U7b's tombstone branch in `applyPendingDraftReplays`, its pre-lookup call in `abandonDraft`, and the four crash/retry tests; revert only checkboxes `7.5`–`7.8` and this section. Preserve U7a and all U8+ work.
- Delivery: stacked-to-main, PR 7b boundary only. U7b incremental authored count versus `/tmp/pharos-u7a-snapshot-og7w2o3w`: **221** (213 additions + 8 deletions across the five allowed files, including task/progress evidence); under the 400-line cap, so no ask-on-risk is needed.
- Structured status consumed: `gentle-ai.sdd-status@2`, `applyState=ready`, `nextRecommended=apply`, `artifactStore=openspec`, repo-local `/home/pedro/pharos`, `actionContext.mode=repo-local`, allowed root `/home/pedro/pharos`. No action-context or edit-root warning.

### Remaining tasks
- Delegated U7b tasks: none.
- U8+ remain intentionally unchecked and out of scope; no `recoverProject()` assembly, domain changes, or lifecycle actions were performed.

Parent lifecycle: settlement and any commit/review/delivery activity are deferred to the parent.

---

## U7b corrective rerun — project-global pre-lookup replay

**Status**: corrected and complete. The prior U7b completion claim is superseded by the confirmed cross-beacon failure and this corrective evidence. Persisted implementation checkboxes `7.6` and `7.8` were reset before correction and are checked again only after GREEN/final verification.

### Completed work
- Added a real-filesystem regression: A commits its tombstone under `abandon-key` and crashes before its journal; B's `createDraft` under that key now conflicts, A cleanup/journal converge, and A's same-key retry succeeds.
- Added U6 triangulation: a crashed `createDraft` stamp on A is replayed before B's `updateDraft` can claim its key.
- Added `applyPendingProjectDraftReplays`, which uses sorted, validated `listBeaconIds` and the existing per-beacon helper before the project-global journal lookup in `createDraft`, `updateDraft`, `forkDraft`, and `abandonDraft`.
- Amended only D1b, D1e, and data-flow wording: O(all beacons/drafts), unrelated-corruption throw scope, and no repair policy for historical committed collisions are explicit.

### TDD Cycle Evidence
| Task | Test file / layer | Safety net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|
| 7.6 corrective | `abandon.test.ts` / real-filesystem integration | 7/7 focused | **1 failed, 7 passed**: B `createDraft(K)` incorrectly returned `ok: true` after A's tombstone-before-journal crash. | 8/8 after project-level wrapper. | 9/9: crashed U6 create stamp blocks B `updateDraft(K)`. | Small shared wrapper; no further refactor needed. |
| 7.8 | same | 9/9 focused | N/A — final verification task. | Focused/full/static commands passed. | Covered by the two independent cross-beacon entrypoints. | Clean. |

### Verification
- `npx vitest run tests/adapters/fs-beacon-store/abandon.test.ts` → 1 file, **9/9**.
- `npm test` → 21 files, **242/242**.
- Independent final verification reproduced 9/9 focused and 242/242 full tests; `npm run lint`, `npm run typecheck`, `npm run build`, and `git diff --check` exited 0 (existing lint deprecations only). The six authorized legacy ownership-marker normalizations preserve task text and states; all 136 checkbox markers now validate.

### Boundary, status, and remaining work
- Delivery boundary remains U7b / stacked-to-main; final incremental count versus the immutable U7a snapshot is 358 authored lines (334 additions + 24 deletions), including legacy marker normalization, under 400. U7a is 321; sequential sum is 679, net HEAD diff is 671. No commit, review, receipt, or delivery action was performed. Runtime settlement belongs to the parent; U8+ remains deferred.
- Consumed authoritative `gentle-ai.sdd-status@2`: `applyState=ready`, `nextRecommended=apply`, OpenSpec repo-local `/home/pedro/pharos`, allowed root `/home/pedro/pharos`; no action-context warning. The status's `94/136` count is consistent after rechecking the two corrective task rows.
- Remaining delegated U7b tasks: none. Exact remaining change tasks are persisted as unchecked U8+ lines in `tasks.md`; they are outside this authorized correction.
- Rollback boundary: remove the project-level wrapper and four call-site substitutions, the two cross-beacon tests, this D1b/D1e/data-flow amendment, and this correction section; retain U7a and all U8+ work.

---

## Work Unit U8a — approval transaction and crash recovery (tasks 8.1–8.10)

**Status**: blocked by the explicit 400-authored-line slice cap after completing only tasks `8.1`–`8.4`; their persisted checkboxes are checked. Tasks `8.5`–`8.10` remain unchecked and were not started. Strict TDD mode.

### Completed tasks and verification
- [x] 8.1 RED — new approval integration test failed against the U7b stub with `Error: approveDraft: not yet implemented (lands in U8)`.
- [x] 8.2 GREEN — lock-held pre-lookup replay, journal replay/conflict, persisted-beacon read, and the unchanged domain approval now re-verify the current draft hash before any version write. Focused test: `1 passed`.
- [x] 8.3 RED — commit-point test failed before projection: the active-window observation was `undefined` because no `active.json` write occurred.
- [x] 8.4 GREEN — writes `semantics.json` → `manifest.json` → `active.json` (commit) → closed `draft.json` → journal. The writer callback re-reads the store after the active rename and observes `ver_1` active before the final two writes. Focused test: `2 passed`.

### TDD Cycle Evidence
| Tasks | Test file / layer | Safety net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|
| 8.1–8.2 | `approval.test.ts` / real-filesystem integration | `npm test` baseline: 21 files, 242 tests passed | 1 failed: pre-U8 stub threw `approveDraft: not yet implemented` | 1/1 passed after lock/read/domain hash gate | Changed persisted draft content plus absent version artifacts exercise a distinct refusal/no-write branch | Used existing envelope helpers; no behavior-only refactor needed |
| 8.3–8.4 | `approval.test.ts` / real-filesystem integration | 1/1 focused passing | 1 failed: no active-window observation before projection | 2/2 passed after ordered projection | Asserts all five writes and an independently re-read active version during the post-swap/pre-close window | Corrected semantics projection to `project(draft.content)` so valid normalized content serializes |

### Verification
- `npx vitest run tests/adapters/fs-beacon-store/approval.test.ts` → 1 file, **2/2 passed**.
- `npm run lint` → exit 0; pre-existing `eslint-plugin-boundaries` deprecation warnings only.
- `npx tsc --noEmit` → exit 0.
- `npm test` → 22 files, **244/244 passed**.
- `git diff --check` → exit 0.
- Runtime harness: real `mkdtemp` directories, real `FsAtomicWriter`, and a writer callback immediately after `active.json` atomic materialization; no filesystem mocks.

### Workload / blocking decision
The current bounded candidate is **236 authored lines** before this progress section (`228` additions, `8` deletions: `155` new approval-test lines; tracked source/task delta `73` additions plus `8` deletions). The still-unstarted crash-before-swap/orphan/later-approval/replay-5–6 work requires further independent real-filesystem crash fixtures and D1 replay logic; completing it in this slice would exceed the 400-line cap. No code-golfing, behavior compression, U8b adoption work, or delivery action was attempted.

**Decision needed before apply can resume**: approve one further cohesive split of U8a (`8.1`–`8.4` retained as the first boundary, `8.5`–`8.10` as a later boundary) or explicitly grant `size:exception` for U8a. Current delivery topology remains `stacked-to-main`; no commit/PR was created.

### Files and rollback boundary
- Changed: `src/adapters/fs-beacon-store/fs-beacon-store.ts`, `tests/adapters/fs-beacon-store/approval.test.ts`, persisted task checkboxes `8.1`–`8.4`, and this progress section.
- Rollback: revert `approveDraft` to its U7b stub; delete `approval.test.ts`; revert only checkboxes `8.1`–`8.4` and this section. U1–U7b are untouched.
- Structured status consumed: `gentle-ai.sdd-status@2`, authoritative OpenSpec, `dependencies.apply=ready`, `nextRecommended=apply`, `actionContext.mode=repo-local`, allowed root `/home/pedro/pharos`; no action-context or edit-root warnings. Parent-owned attempt authority was consumed only as context; no token is recorded here.

### Remaining delegated tasks (exact persisted unchecked lines)
- [ ] 8.5 RED: extend the test file — an `InjectedCrash` after step 3 completes (both `semantics.json`/`manifest.json` present) but before step 4's rename: the new version's manifest/semantics exist, but `active.json` does not reference it and the draft is not closed (`fs-beacon-store` R5 S2, literal); `recoverProject()`'s scan (stub call into `reconcile.ts`, full method lands in U9) classifies it `aborted`, never active (`beacon-store-recovery` R2 S1); confirm it fails. <!-- sdd-owner: implementation -->
- [ ] 8.6 GREEN: confirm 8.5 passes against the write sequence from 8.4 plus U5's existing orphan classification (no change expected beyond wiring the real `approveDraft` writes into the fixtures the scan already reads). <!-- sdd-owner: implementation -->
- [ ] 8.7 RED: extend the test file — a *later*, successful `approveDraft` on a different draft does not resurrect the orphan from 8.5: the orphan stays unreferenced and unreported as active (`beacon-store-recovery` R2 S2); confirm it fails before the walk correctly excludes it under a second committed root. <!-- sdd-owner: implementation -->
- [ ] 8.8 GREEN: confirm 8.7 passes (D1's committed-set closure already excludes it by construction — no orphan is ever *pointed at*). <!-- sdd-owner: implementation -->
- [ ] 8.9 RED: extend the test file — an `InjectedCrash` after step 4 (`active.json` swapped) but before the draft close: the previously approved draft ends up `closed` and exactly one journal entry exists after `recoverProject()` (stub, full method in U9), and no second version was created (`beacon-store-recovery` R3 S1); running the replay a second time changes nothing further (R3 S2); confirm both fail before D1's replay-5–6 rows exist. <!-- sdd-owner: implementation -->
- [ ] 8.10 GREEN: extend `reconcile.ts` with D1's version-scoped classification table (aborted / replay-5–6 / replay-6-only / complete rows) and wire `apply`'s `closed-draft`/`wrote-journal-entry` actions into `approveDraft`'s step (1a). <!-- sdd-owner: implementation -->

---

## U8 delivery split — superseded decision

The prior U8a note asking for a further split is superseded only for delivery planning by the user-approved three-slice boundary: U8a1 (8.1–8.4, complete), U8a2 (8.5–8.10, this section), and U8b (8.11–8.17, deferred). Strategy is `ask-on-risk`, resolved by explicit split; topology is `stacked-to-main`. No U8b behavior was started.

## Work Unit U8a2 — approval crash classification and replay (8.5–8.10)

**Status**: complete. Persisted task checkboxes 8.5–8.10 are checked. Strict TDD; authoritative `gentle-ai.sdd-status@2` was consumed (`applyState=ready`, repo-local root and allowed edit root `/home/pedro/pharos`, no warnings). Parent-owned attempt authority was not acquired, reset, or settled here.

### Completed work
- [x] 8.5–8.6: a real writer crash after `manifest.json` leaves both immutable artifacts, no active pointer, an open draft, and `scanBeacon` classification `orphanVersionIds: ["ver_1"]`.
- [x] 8.7–8.8: a subsequent successful approval of a second draft activates only `ver_2`; the crashed `ver_1` remains excluded from reconstructed versions and orphan-classified.
- [x] 8.9–8.10: an active-swap crash replays through the locked pre-lookup hook: it closes an open draft then creates the missing journal entry, or creates only that entry if the draft was already closed. A second replay adds neither a version nor a journal entry.

### TDD Cycle Evidence
| Tasks | Test / layer | Safety net | RED | GREEN / triangulation | Refactor |
|---|---|---|---|---|---|
| 8.5–8.8 | `approval.test.ts` / real-filesystem integration | 2/2 focused | The new crash-before-swap and non-resurrection tests were already green (4/4): U8a1's write ordering and U5's rooted walk already satisfied these no-code GREEN confirmations, so no behavior was regressed merely to manufacture RED. | Distinct no-active-pointer and later-committed-root fixtures pass. | None needed. |
| 8.9–8.10 | same | 4/4 focused | 5-test run: 1 failed, open draft after active-swap crash. Triangulation run: 6 tests, 2 failed (open-draft and closed-draft/missing-journal windows). | 6/6 after D1 replay 5–6 wiring; both crash windows plus second-run convergence pass. | None needed. |

### Verification and boundary
- Focused: `npx vitest run tests/adapters/fs-beacon-store/approval.test.ts` → **6 passed (6)**.
- Static: `npm run lint`, `npx tsc --noEmit`, and `git diff --check` → exit 0 (lint emitted only pre-existing `eslint-plugin-boundaries` deprecation warnings).
- Runtime harness: real `mkdtemp` projects and `FsAtomicWriter`; injected post-materialization crashes, no filesystem mocks.
- Files: `tests/adapters/fs-beacon-store/approval.test.ts`, `src/adapters/fs-beacon-store/reconcile.ts`, persisted `tasks.md`, and this progress file. No `recoverProject()` public/report surface was added; U9 still owns that assembly. The U8a2 tests exercise its designated `reconcile.ts` scan/apply stub.
- Workload: U8a2 incremental implementation is 138 approval-test lines plus 58 replay-source lines; task/progress evidence remains below the 400-new-authored-line cap. PR boundary: U8a2 only, stacked-to-main; no commit or delivery action.
- Rollback: remove U8a2's crash/replay tests and `applyPendingApprovalReplay`, then revert only 8.5–8.10 checkboxes and this section; retain U8a1.

### Remaining tasks (deferred U8b, exact persisted lines)
- [ ] 8.11 RED: extend the test file — **the D6b RED test named by this run's instructions**: an `InjectedCrash` after `manifest.json` lands, then an *unrelated* successful `approveDraft` on a different draft advances `active.json`, then the same-key retry of the crashed approval: assert `stale-attempt-artifact`, **not** `immutable-file-exists` and not a throw, and that a fresh `versionId` under a fresh key then succeeds (D6b's normal-interleaving fix, DEF-2 MAJOR); confirm it fails against a byte-identity probe before implementing the field-partitioned comparison. <!-- sdd-owner: implementation -->
- [ ] 8.12 GREEN: implement D6b's adoption probe at step (2a) of the envelope — after the domain call returns `ok`, before any write, resolve each write-once artifact's stamp against the current call per the 6-outcome table (absent → ordinary write; differing `key_hash` → `immutable-file-exists`; same `key_hash`, differing `input_hash` → `idempotency-key-conflict`; same `key_hash`/`input_hash`, input-determined fields equal, aggregate-derived fields equal → adopt; same `key_hash`/`input_hash`, input-determined equal, aggregate-derived differ → `stale-attempt-artifact`; same `key_hash`/`input_hash`, an input-determined field differs → throw `BeaconStoreCorruptionError`). Partition `manifest.json`'s fields exactly per D6b's table (`local_number`, `supersedes_version`, `approved_revision` are aggregate-derived; everything else named is input-determined); `semantics.json`'s entire body is input-determined. <!-- sdd-owner: implementation -->
- [ ] 8.13 RED→GREEN: add the `approved_revision` regression test D6b's own remediation names — a crashed `approveDraft(K)` with `manifest.json` carrying `approved_revision: 3`, followed by a legal `updateDraft` on the same draft with byte-identical content (revision now 4, `reviewedHash` still matching), followed by the same-key retry of `K`: assert `stale-attempt-artifact`, never a throw. <!-- sdd-owner: implementation -->
- [ ] 8.14 RED→GREEN: add the same-key-identical-adoption test — a crashed `approveDraft(K)` retried with the exact same input (no intervening mutation) adopts silently and resumes from the next unwritten artifact, producing exactly one version (`beacon-store-port` R2 S1, exercised end-to-end here). <!-- sdd-owner: implementation -->
- [ ] 8.15 RED: extend the test file — `fs-beacon-store` R3 S1, literal: a *genuine second write* to an existing `manifest.json` (a different transaction, different `key_hash`, targeting an existing version directory) returns a refusal and the original `manifest.json` bytes are unchanged; confirm it is distinguished from the adoption case in 8.14 (different `key_hash` → `immutable-file-exists`, not adopt). <!-- sdd-owner: implementation -->
- [ ] 8.16 GREEN: confirm 8.15 passes against 8.12's probe. <!-- sdd-owner: implementation -->
- [ ] 8.17 Final verification: `npx vitest run tests/adapters/fs-beacon-store/approval.test.ts`; `npm run lint`; `npx tsc --noEmit`. If this unit's authored diff exceeds 400 lines, apply the pre-agreed relief order (i)/(ii) from the forecast, or record a `size:exception`. <!-- sdd-owner: implementation -->
