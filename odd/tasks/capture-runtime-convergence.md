# Capture Runtime Convergence

## Objective

Make guided capture converge safely after recorder crashes, cancellation, external signals, and concurrent recovery without duplicating a live child or misreporting a successful terminal result.

## Problem and Why

The merged Slice 4 implementation can retain an orphaned `running` session forever, wait indefinitely for a recorder that ignores `SIGINT`, misclassify unsolicited child signals as operator cancellation, and race between durable resolution recording and terminal completion. These defects can create zombie captures that cannot be retried or recovered.

## Scope

Included:

- Persist and probe sufficient recorder ownership/liveness evidence for `running` recovery.
- Transition a provably orphaned `running` session to durable `interrupted` state.
- Add bounded `SIGINT` → `SIGTERM` → `SIGKILL` cancellation escalation.
- Distinguish operator-requested cancellation from unsolicited child signals.
- Make cancellation notification mandatory at the recorder port boundary.
- Make completion converge atomically or idempotently for the same durable resolution.
- Add deterministic crash, process-control, and concurrency tests.

Excluded:

- Staging-path/layout extraction, terminal predicate cleanup, comment relocation, invalid sentinel cleanup, and read-helper consolidation; tracked separately in issue #72.
- Guided annotation, public CLI registration, browser installation, production-target contact, or later lifecycle workflows.
- Commit, push, pull request, or merge unless separately authorized.

## Constraints

- Issue-first authority: approved issue #71 (`https://github.com/PedAltuve/pharos/issues/71`).
- Branch: `fix/capture-runtime-convergence`, based on merged `origin/master`.
- Hexagonal boundaries remain intact; domain/application code stays free of Node adapters.
- No real browser, target, or external repository interaction in tests.
- One writer at a time; no parallel writes in this worktree.
- About 400 authored diff lines per task is an advisory planning heuristic, never a reason to omit tests or compress code.
- RDD remains candidate-scoped and does not authorize delivery.

## TDD

- Mode: strict TDD enabled.
- Source: `openspec/config.yaml` (`strict_tdd: true`, `rules.apply.tdd: true`).
- Runner: `npm test` via Vitest.
- Every implementation task must record observed RED, GREEN, and REFACTOR evidence.

## Tasks

- [x] **CRT-1 — Recover orphaned running captures.** Define and persist safe recorder ownership/liveness evidence, preserve live-child refusal, and terminalize a provably absent child as `interrupted` with crash/retry tests.
  - Checks: focused application/CaptureStore tests; no duplicate spawn; repeated recovery converges; no unsafe PID-only assumption.
  - Outcome: persisted PID-only evidence is probed conservatively; absence terminalizes through durable `interrupt/signal`, while any live or reused PID refuses replay and is never killed.
- [x] **CRT-2 — Bound cancellation and preserve signal provenance.** Make abort subscription mandatory, implement deterministic SIGINT/SIGTERM/SIGKILL escalation with bounded waits, and propagate operator cancellation versus unsolicited signal distinctly.
  - Checks: focused recorder/application tests for pre-spawn abort, post-spawn abort, ignored signals, external signal, normal exit, and cleanup of listeners/timers.
  - Outcome: terminal results remain independent of stalled persistence, while a potentially live child cannot return until safe PID evidence is durable; failed persistence retains an in-flight durability barrier.
- [x] **CRT-3 — Make terminalization concurrency converge.** Prevent the `recordResolution`/`finishResolution` interleaving from returning an illegal transition when the same durable resolution already completed.
  - Checks: deterministic latch-based interleaving test; same resolution replays terminal result; conflicting resolution still refuses; crash recovery remains intact.
  - Outcome: `finishResolution()` now returns an already terminal session after idempotently verifying or repairing its request completion journal; non-terminal and conflicting transitions still refuse.
- [x] **CRT-4 — Verify the integrated correction.** Run focused suites, full hermetic tests, lint, typecheck, build, and diff checks; inspect changed scope against issue #71 and confirm issue #72 cleanup work did not drift in.
  - Checks: all commands observed and recorded; every failed, skipped, or pending check disclosed.
  - Outcome: independent verification passed all seven acceptance criteria, 122 focused tests, 468 full tests, lint, typecheck, build, diff-check, and scope audit with no issue #72 drift.

## Acceptance Criteria

1. A retried `running` capture with a provably live owned child is not respawned.
2. A retried or recovered `running` capture with a provably absent child reaches durable `interrupted` and later retries converge.
3. Cancellation cannot wait forever for a non-cooperative recorder.
4. Operator cancellation and unsolicited signal termination persist distinct reasons.
5. Cancellation implementations must provide post-spawn notification.
6. Concurrent same-resolution completion returns the same terminal result; conflicting completion remains rejected.
7. Default verification stays hermetic and green.

## Progress

- 2026-09-16: review findings independently validated against merged Slice 4 code and tests.
- 2026-09-16: created correction issue #71 and cleanup issue #72; issue #71 approved.
- 2026-09-16: created `fix/capture-runtime-convergence` from merged `origin/master`.
- 2026-09-16: completed CRT-1 with strict TDD. Running sessions persist only safe PID evidence; absent PIDs converge to interrupted, and live/reused PIDs remain conservatively non-actionable.
- 2026-09-16: completed CRT-2 with strict TDD. Cancellation now escalates only against the owned child, is bounded, and distinguishes operator cancellation from unsolicited process signals.
- 2026-09-16: completed CRT-3 with strict TDD. Terminal completion now converges after concurrent recovery and repairs the terminal-before-journal crash window.
- 2026-09-16: CRT-4 command suite passed, but independent inspection failed acceptance criteria 3 and 4; CRT-2 was reopened for four recorder ordering regressions.
- 2026-09-16: two bounded correction rounds fixed persistence coordination, observer-failure containment, and same-turn event provenance; final CRT-4 verification passed.
- 2026-09-16: native four-lens review required one bounded correction: retain a durability barrier whenever the owned child may still be live.
- 2026-09-16: bounded correction passed independent verification within 54/120 diff lines; 124 focused and 470 full tests passed.

## Verification Evidence

CRT-1 evidence:

- RED: four intended focused regressions failed for live replay respawn, absent-PID recovery, missing store persistence, and missing adapter start evidence.
- GREEN/REFACTOR: `npm test -- tests/application/record-capture.test.ts tests/adapters/fs-capture-store tests/adapters/playwright/playwright-recorder.test.ts` passed 3 files / 103 tests; parent repeated the same command with 103/103 passing.
- `npm run lint`, `npm run typecheck`, and `git diff --check` passed.
- CRT-1 delta reported by the writer: +196/-6 across the nine authorized source/test paths.
- Remaining explicit risk: a crash between child spawn and PID persistence cannot be proven safe; it refuses automatic replay rather than killing or duplicating a possibly live child.

CRT-2 evidence:

- RED: eight focused expectations failed before production edits for mandatory subscription, bounded escalation, final non-exit, cleanup, and signal provenance.
- GREEN/REFACTOR: `npm test -- tests/adapters/playwright/playwright-recorder.test.ts tests/application/record-capture.test.ts` passed 2 files / 27 tests; parent repeated the command with 27/27 passing.
- `npm run lint`, `npm run typecheck`, and `git diff --check` passed; typecheck initially exposed TS18048 and passed after an explicit active-child guard.
- Default escalation uses `SIGINT`, `SIGTERM`, and `SIGKILL` with 1,000 ms per stage; tests inject deterministic 50 ms delays.
- Final bounded non-exit returns `capture-process-still-active` without terminalizing the persisted `running` session.

CRT-3 evidence:

- RED: two new focused regressions failed with `capture-illegal-transition` when retrying terminal completion.
- GREEN/REFACTOR: `npm test -- tests/adapters/fs-capture-store/fs-capture-store.test.ts tests/application/record-capture.test.ts` passed 2 files / 102 tests; parent repeated the command with 102/102 passing.
- `npm run lint`, `npm run typecheck`, and `git diff --check` passed.
- A controlled interleaving proves recovery can complete after the durable decision and before the original finish; both callers observe the same terminal session.
- A terminal-before-journal retry repairs/verifies request completion, while `recordResolution()` remains strict and conflicting/status-incompatible resolutions still refuse.
- CRT-3 delta: +63/-0; cumulative source/test/task worktree delta before final verification is +544/-88 plus the ODD task document.

CRT-4 first-pass evidence:

- All commands passed: focused 110/110, full suite 40 files / 456 tests, lint, typecheck, build, and diff-check.
- Verification still failed: cancellation escalation was blocked while `onStarted()` awaited, exit observation began too late, a late abort could overwrite unsolicited-signal provenance, and invalid-PID exit rejection was unobserved.
- No issue #72 cleanup drift was found.
- Required correction tests: abort during pending `onStarted()`, exit/signal during pending `onStarted()`, deterministic exit-versus-abort ordering, and invalid-PID/error handling.

CRT-2 correction evidence:

- First correction replaced callback recording with a two-phase `RecorderRun`, attached exit observation synchronously, and added pending-persistence and fast-completion tests.
- Second verification found an application listener-registration gap; a focused correction added immediate abort observation and raced recorder completion with persistence and abort.
- Third verification found safe-PID observer rejection and same-turn provenance defects; the final adapter correction fails closed on unverified exit and serializes stop observation by microtask order.
- Parent spot checks passed after every correction; final recorder/application focused suite passed 39/39.

CRT-4 final evidence:

- `npm test -- tests/application/record-capture.test.ts tests/adapters/fs-capture-store tests/adapters/playwright/playwright-recorder.test.ts`: PASS, 3 files / 124 tests.
- `npm test`: PASS, 40 files / 470 tests; hermetic.
- `npm run lint`, `npm run typecheck`, `npm run build`, and `git diff --check`: PASS.
- Final tracked source/test delta before this task-document update: +987/-105 across nine files.
- Failed checks: none. Skipped checks: none. Pending verification checks: none.
- Residual fail-closed limits: spawn-to-PID-persistence crash cannot prove safe replay; live/reused PID remains non-actionable; persistence operations are not cancellable but cannot regress terminal state.
- Cleanup issue #72 scope was not implemented.

## Next Step

Continue native lineage `review-f04019940bb352b9` with the verified bounded correction. Commit, push, PR, and merge remain separately authorized delivery actions.
