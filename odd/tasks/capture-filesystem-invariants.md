# Capture filesystem and lifecycle invariants

## Objective

Complete GitHub issue #72 by giving capture staging layout, terminal-state classification, malformed request identity, replay documentation, and hardened file reading clear reusable owners without changing supported capture behavior.

## Problem

Capture filesystem and lifecycle invariants are duplicated across adapters and application code. CaptureStore validates a pathname through one file handle and later reopens it for digesting, leaving a replacement window. Request parsing fabricates `cap_invalid` even when the real capture identity is known, and one replay-identity comment documents the wrong helper.

## Why

The shipped guided capture path must remain fail-closed under symlink and pathname-replacement attempts. Consolidating these invariants reduces divergent security behavior while preserving the existing public CLI and capture lifecycle.

## Scope

Included:

- Centralize staging-path construction in a neutral adapter boundary.
- Remove the unused exported staging-path helper.
- Reuse one domain terminal-state predicate where existing semantics are equivalent.
- Preserve fail-closed validation for raw persisted capture records.
- Move replay-identity documentation to `sameRequest()`.
- Carry the known capture identity through malformed request parsing instead of fabricating `cap_invalid`.
- Consolidate handle-bound no-symlink reads and digesting.
- Close CaptureStore's pathname-replacement window.
- Preserve behavior with focused filesystem and lifecycle tests.

Excluded:

- Recorder crash recovery, cancellation escalation, signal taxonomy, or terminalization concurrency changes.
- Public CLI behavior, guided annotation, browser installation, or target contact.
- Broad filesystem abstraction or unrelated refactoring.
- Association/recovery sentinels outside malformed request completion parsing.
- Commit, push, pull request, publication, or merge without separate authorization.

## Constraints

- Work only in `/home/pedro/pharos-worktrees/capture-filesystem-invariants` on branch `fix/capture-filesystem-invariants`.
- Preserve hexagonal boundaries; Node path/filesystem logic must not enter the domain layer.
- Preserve the default hermetic test suite; do not launch a browser or contact a target.
- Strict TDD is enabled by `openspec/config.yaml` (`strict_tdd: true`, `rules.apply.tdd: true`).
- Test runner: `npm test` (`vitest run`). Record observed RED before implementation, then GREEN and REFACTOR evidence.
- Treat roughly 400 authored changed lines per task as an advisory review heuristic, never as a reason to omit correctness or tests.

## Tasks

### CFI-1 — Consolidate capture layout and handle-bound reads

- [x] Add focused tests that fail before implementation for the shared layout and/or CaptureStore pathname-replacement behavior.
- [x] Introduce a neutral adapter-level capture-layout boundary.
- [x] Migrate CaptureStore, the literal sensitivity scanner, and the Playwright recorder to the shared staging layout.
- [x] Remove the scanner-local unused exported path helper.
- [x] Consolidate handle-bound no-symlink file reading/digesting.
- [x] Ensure CaptureStore never reopens a validated pathname before hashing/promoting it.
- [x] Pass the focused adapter suite.

Checks:

```bash
npm test -- tests/adapters/sensitivity/literal-sensitivity-scanner.test.ts tests/adapters/playwright/playwright-recorder.test.ts tests/adapters/fs-capture-store/fs-capture-store.test.ts
```

### CFI-2 — Consolidate lifecycle classification and known request identity

- [x] Add focused tests that fail before implementation for the domain terminal predicate and real capture identity on malformed request completion.
- [x] Add and export the domain terminal-state predicate.
- [x] Reuse it only where semantics are equivalent in application and adapter code.
- [x] Preserve closed validation of malformed or nonterminal persisted records.
- [x] Move replay-identity documentation to `sameRequest()`.
- [x] Carry the known capture identity into malformed request parsing and remove only the authorized `cap_invalid` sentinel.
- [x] Pass the focused lifecycle suite.

Checks:

```bash
npm test -- tests/domain/capture/contracts.test.ts tests/application/record-capture.test.ts tests/adapters/fs-capture-store/fs-capture-store.test.ts
```

### CFI-3 — Verify the complete candidate

- [x] Confirm issue #72 acceptance criteria against the final diff.
- [x] Run the full test suite.
- [x] Run lint, typecheck, build, and whitespace checks.
- [x] Record actual changed paths and review workload.
- [x] Run the configured native review path for the complete candidate and resolve only authorized findings.
- [x] Record final evidence and remaining delivery actions accurately.

Checks:

```bash
npm test
npm run lint
npm run typecheck
npm run build
git diff --check
```

## Acceptance criteria

- Staging layout has one production owner and no unused exported path helper.
- Terminal-state checks reuse a domain predicate where semantically equivalent without weakening persisted-record validation.
- Replay-identity documentation describes `sameRequest()` rather than secret-reference equality.
- Malformed request records return the real known capture identity and never fabricate an invalid branded ID in the authorized path.
- CaptureStore file verification uses a handle-bound read/digest primitive and fails closed under symlink and replacement attempts.
- Existing focused and full hermetic tests remain green with no observable product behavior change.

## Progress

- Exploration mapped the affected symbols and existing regression coverage.
- Forecast: approximately 220–350 authored lines across two reviewable implementation tasks; no chained PR expected.
- CFI-1 is complete: staging paths now have one adapter owner; scanner, recorder, and CaptureStore use it; handle-bound reads and post-link identity checks close the authorized replacement window.
- CFI-2 is complete: terminal status has one domain owner, trusted lifecycle branches reuse it, raw request JSON remains independently validated, replay identity is documented at `sameRequest()`, and malformed request completion uses the known capture identity.
- CFI-3 is complete: technical verification passed and native review closed approved without a correction transition.

## Verification evidence

### CFI-1

- RED: `npm test -- tests/adapters/capture-layout/capture-layout.test.ts` failed because the expected `capture-layout` module did not exist.
- GREEN: the same focused command passed 2 tests after implementation.
- TRIANGULATE/REFACTOR: the focused adapter suite passed 3 files / 136 tests after adding post-link replacement coverage and cleanup.
- Worker verification: focused adapter suite passed 136 tests; `git diff --check` passed.
- Parent spot check: focused adapter suite passed 3 files / 136 tests.
- Browser and target contact were not performed.

### CFI-2

- RED: `npm test -- tests/domain/capture/contracts.test.ts` failed 9 assertions with `TypeError: isTerminalCaptureStatus is not a function`.
- GREEN: the same command passed 19 tests after implementation.
- TRIANGULATE/REFACTOR: the focused lifecycle suite passed 3 files / 165 tests; malformed persisted-session and nonterminal-completion coverage remained green.
- Worker verification: focused lifecycle suite passed 165 tests; `git diff --check` passed.
- Parent spot check: focused lifecycle suite passed 3 files / 165 tests.
- Browser and target contact were not performed.

### CFI-3 technical verification

- Initial independent verification found TS2724 because `Stats` was imported from `node:fs/promises`; tests, typecheck, and build failed, while lint and whitespace passed.
- The one-line correction imports `Stats` from `node:fs`; parent spot checks passed typecheck and whitespace.
- Fresh independent verification passed: 55 test files / 634 tests / 0 skipped, lint, typecheck, build, and `git diff --check`.
- All issue #72 acceptance criteria passed source, test, and diff inspection.
- Product/test workload: 10 paths, +269/-109, 378 lines of churn. Final ODD document: 1 path, +156. Complete working tree: 11 paths, +425/-109, 534 lines of churn.
- Git status remained unchanged with 8 tracked modifications, 3 intended untracked paths, and no staged paths.
- Browser, probe, and target contact were not performed.

### Native review

- Lineage `review-61bbaad48f762f15` reviewed the complete 11-path candidate at high risk across risk, resilience, readability, and reliability lenses.
- Native review closed `approved` and acknowledgement completed; no correction transition was opened.
- Five findings were explicitly informational/non-blocking: two about the scanner's before-open hook naming/behavior, two duplicate handle-leak advisories for exceptional `handle.stat()` failure after open, and one stale workload-metrics suggestion.
- Per the approved closure, those advisories are separate later work and do not reopen this candidate.
- This final administrative evidence update changes only the ODD task document after approval; product and test files remain byte-identical to the reviewed candidate.

### Delivery

- The user authorized delivery through pull request creation without merge.
- GitHub issue #72 was approved with `status:approved` while preserving `enhancement`.
- Product and tests were committed as `d903b92` (`fix(capture): consolidate filesystem and lifecycle invariants`). One cohesive product commit preserves the reviewed candidate boundary and avoids splitting shared CaptureStore changes; its 378 lines of product/test churn remain below the advisory task heuristic.
- Fresh committed-tree verification passed the focused 2-, 136-, and 165-test suites; the full 55-file / 634-test suite; lint; typecheck; build; and `git diff --check origin/master...HEAD`.
- Branch `fix/capture-filesystem-invariants` was pushed with local and remote product commit identities matching.
- Pull request #76 was opened against `master` with exactly `type:bug`: https://github.com/PedAltuve/pharos/pull/76.
- This ODD document is committed separately as administrative evidence; it does not alter the independently verified product/test tree.

## Next step

Pull request #76 is open for maintainer review. Merge requires separate authorization.
