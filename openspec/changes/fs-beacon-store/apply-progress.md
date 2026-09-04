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

**Status**: implementation complete. Tasks `5.1`–`5.17` are checked off in `tasks.md`, delivered as three stacked commits (5a, 5b, 5c) per the operator-ratified split.
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

