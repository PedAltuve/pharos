# Archive Report: Beacon Core (Slice C)

**Change**: beacon-core  
**Date**: 2026-09-02  
**Project**: pharos  
**Artifact Store**: hybrid (openspec + Engram)

## Executive Summary

Beacon Core change has been fully planned, implemented, verified, and archived. All 61 implementation tasks completed; verification passed (PASS verdict, 13/13 requirements, 21/21 scenarios, 117/117 tests, 0 CRITICAL findings). Six chained PRs stacked to master branch, pending operator green light for delivery. Spec deltas merged into main specs; change folder retained in active directory for operator-owned delivery commit per hybrid-mode archive policy.

## Final Verification Status

**Verdict**: PASS ✅

- Requirements: 13/13 compliant
- Scenarios: 21/21 compliant
- Tests: 117/117 passed (10 files)
- Build/Lint/Typecheck: All exit 0
- Stack integrity: 8 commits (0e923d2 → e115d1c → 2244cac → ea01c9b → abfecaa → 11c5936 → 84f6635 → 222b24e)
- Master base: 582fc1f untouched
- Critical findings: 0

**Remediation**: First verify FAILED with 1 CRITICAL (scenario "Stale origin with acknowledgment proceeds" untested). Remediated by commit `84f6635` (38-line test-only addition); C2c rebased onto remediated C2b tip. Full evidence recorded in `verify-report.md`.

## Implementation Summary

**Authored lines**: 1,962 (15 files, 2 deletions)  
**Calibrated band**: 2,420–3,180 lines (under band ✅)  
**Units**: 6 chained PRs (C1a/C1b/C1c/C2a-split/C2b+remediation/C2c)  
**Size exception**: C2b + remediation = 545 lines (pre-authorized)

**Capabilities delivered**:
- `beacon-draft-lifecycle`: Draft creation, revision-bound updates, forking, abandonment; refusals as values
- `beacon-version-lifecycle`: Approval with hash re-verification, monotonic numbering, supersession, revocation, active-version resolution
- `project-toolchain`: Generalized skeleton requirement to any accepted change's ratified behavior

## Spec Sync Operations

| Spec | Action | Details |
|------|--------|---------|
| `beacon-draft-lifecycle` | Created | Copied from delta to `openspec/specs/beacon-draft-lifecycle/spec.md`; 6 requirements / 10 scenarios |
| `beacon-version-lifecycle` | Created | Copied from delta to `openspec/specs/beacon-version-lifecycle/spec.md`; 6 requirements / 8 scenarios |
| `project-toolchain` | Modified | Applied delta to generalize "Skeleton Matches Design" requirement; added Beacon Core example scenario; 5 requirements / 13 scenarios total |

**Merge verification**: Empty diff confirms byte-identity for new spec copies. Modified spec changes tracked via Edit operations.

## Archive Contents

Retained in active directory (not moved to archive folder per operator delivery plan):

- ✅ `proposal.md` — change intent, scope, approach, risks
- ✅ `specs/` — delta specs (beacon-draft-lifecycle, beacon-version-lifecycle, project-toolchain)
- ✅ `design.md` — technical approach, ADRs, interfaces, testing strategy
- ✅ `tasks.md` — 61/61 tasks complete, phase boundaries, rollback procedures
- ✅ `apply-progress.md` — work-unit landing, test evidence, proof of TDD discipline
- ✅ `verify-report.md` — PASS verdict, compliance matrix, remediation evidence
- ✅ `state.yaml` — phase tracking and dependency metadata
- ✅ `archive-report.md` (this file) — final state record

## Source of Truth Updated

Main specs now reflect all ratified behavior from Beacon Core:

- `openspec/specs/beacon-draft-lifecycle/spec.md` ✅ — new, 6 requirements, 10 scenarios
- `openspec/specs/beacon-version-lifecycle/spec.md` ✅ — new, 6 requirements, 8 scenarios
- `openspec/specs/project-toolchain/spec.md` ✅ — updated, 5 requirements, 13 scenarios (includes new Beacon Core scenario)

## Final Stack at Close

**Branch**: change/beacon-core-c2c  
**Commits** (8 total, master untouched at 582fc1f):
1. `0e923d2` — C1a: Result, Beacon/Draft types, createDraft (293 lines)
2. `e115d1c` — C1b: updateDraft with revision discipline (198 lines)
3. `2244cac` — C1c: forkDraft, abandonDraft (277 lines)
4. `ea01c9b` — C2a-1: Version model, relief (ii) split (258 lines)
5. `abfecaa` — C2a-2: revokeVersion, resolveActiveVersion (232 lines)
6. `11c5936` — C2b: approveDraft with hash binding and port composition (507 lines, size:exception)
7. `84f6635` — C2b+r1: Remediation test for stale-origin acknowledgment (38 lines, vacuous-guard RED confirmed)
8. `222b24e` — C2c: Supersession, monotonic numbering (186 lines, rebased onto remediated C2b)

**Delivery ready**: 6 chained PRs (stacked-to-main) for operator review and merge.

## SDD Cycle Completion

| Phase | Status | Artifacts | Observation IDs |
|-------|--------|-----------|-----------------|
| Explore | done | sdd/beacon-core/explore | (Engram) |
| Research | skipped | — | — |
| Pre-Proposal | confirmed | sdd/beacon-core/pre-proposal | (Engram) |
| Proposal | done | sdd/beacon-core/proposal | (Engram) |
| Spec | done | sdd/beacon-core/spec | (Engram) |
| Design | done | sdd/beacon-core/design | (Engram) |
| Tasks | done | sdd/beacon-core/tasks | (Engram) |
| Apply | done | sdd/beacon-core/apply-progress | (Engram) |
| Verify | done | sdd/beacon-core/verify-report | (Engram) |
| Archive | done | sdd/beacon-core/archive-report | (Engram) |

## Key Learnings

1. Remediation via test-only commit after verify FAIL is effective; RED/GREEN/vacuous-guard discipline catches untested scenarios early.
2. Relief mechanisms (split work units, size:exception) scaled to deliver a large pure-domain change under high budget risk.
3. Delta specs generalize naturally to future slices; project-toolchain requirement now covers any accepted change's ratified behavior, not just Slice A/B.
4. Hybrid archive (openspec specs + Engram artifacts) maintains both source-of-truth ecosystem and structured traceability; no byte duplication, no model-routed copying.

## Delivery Status

**Operator green light required before**: Git push, PR creation, merge to master.  
**Folder move to archive**: Pending-delivery — operator will move `openspec/changes/beacon-core/` to `openspec/changes/archive/2026-09-02-beacon-core/` as part of the final delivery chore commit, mirroring Slice A archive workflow.

**All SDD gates passed. Ready for operator delivery.**

## Post-Review Remediation Addendum (2026-09-02)

The figures above describe the pre-review state and are superseded by this addendum and `verify-report.md`.

An operator review after the first delivery confirmed 3 code blockers (stale-origin null-direction bypass, prototype-key record corruption, unverified version identity in `resolveActiveVersion`) and ratified 4 corrections, including `finalHash` in abandonment tombstones per the lifecycle doc. Specs were amended (now 14 requirements / 25 scenarios), the design gained ADR rows 11-13 (plain-inequality gate, domain-wide `getOwn` own-property lookups, identity-throw scoping), and the fixes were woven into the original commits by a bottom-up rebase.

Final state:

- Stack: master `582fc1f` → c1a `bf058ff` (356) → c1b `8753c38` (230) → c1c `ac48d48` (327) → c2a1 `5b8a495` (258, new branch — PR split) → c2a `7893900` (286) → c2b `d389973`+`f7cadf4` (611, operator-re-ratified size:exception) → c2c `312696b` (222) + docs commits `f266ca7`, `4ba3bd4`.
- Verification: PASS — 14/14 requirements, 25/25 scenarios, 128/128 tests, 0 CRITICAL; every original blocker re-reproduced and confirmed fixed in isolation.
- Delivery: 7 chained PRs stacked to master (C2a split into two); OpenSpec artifacts committed in-stack at `f266ca7`.
- Tasks: 108 total (61 original + 47 remediation), all complete except the force-push tasks executed by the orchestrator at delivery.
