# Archive Report: Beacon Core (Slice C)

**Change**: beacon-core  
**Date**: 2026-09-02  
**Project**: pharos  
**Artifact Store**: hybrid (openspec + Engram)

> **Historical snapshot notice:** The sections before the post-review addendum preserve the 2026-09-02 pre-delivery record. They are superseded by the final reconciliation below and do not claim that the active change folder has been archived.

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
- Delivery: PRs #6, #7, #8, #13, #14, #16, and #17 are merged; no remote `change/beacon-core-*` refs remain.
- Tasks: 109/109 complete after stale force-push rows 8.10 and 16.6 were reconciled as obsolete/completed; no force-push is claimed.

## Final Reconciliation (2026-09-09)

- Final evidence is PASS: 14/14 requirements, 25/25 scenarios, 128/128 tests, and zero CRITICAL findings or delivery blockers.
- The historical force-push deferrals are superseded by merged-PR and absent-remote-ref evidence, not by an asserted force-push event.
- The active `openspec/changes/beacon-core/` folder has not been moved; the intended `openspec/changes/archive/2026-09-02-beacon-core/` destination does not yet exist.
- This reconciliation records delivery completion only. It does not perform or authorize archive, review, commit, push, or PR actions.

## Final Archive Execution

**Archive status**: PASS — authoritative OpenSpec archive completed.

**Structured status consumed**:

```json
{
  "schemaName":"gentle-ai.sdd-status",
  "schemaVersion":2,
  "changeName":"beacon-core",
  "artifactStore":"openspec",
  "taskProgress":{"total":109,"complete":109,"remaining":0},
  "applyState":"all_done",
  "dependencies":{"apply":"all_done","verify":"all_done","sync":"all_done","archive":"ready"},
  "nextRecommended":"archive",
  "blockedReasons":[],
  "actionContext":{"mode":"repo-local","workspaceRoot":"/home/pedro/pharos","allowedEditRoots":["/home/pedro/pharos"]}
}
```

The action context authorized the archive path: it is inside the workspace and the
allowed edit root. No workspace-planning restriction applied.

### Artifacts read

- `proposal.md`
- `specs/beacon-draft-lifecycle/spec.md`
- `specs/beacon-version-lifecycle/spec.md`
- `specs/project-toolchain/spec.md`
- `design.md`
- `tasks.md`
- `apply-progress.md`
- `verify-report.md`
- `sync-report.md`
- `state.yaml`
- `archive-report.md`
- `openspec/config.yaml`

The persisted tasks artifact was re-read immediately before this report write and
folder move: 109/109 implementation task markers are checked; no `- [ ]` markers
remain. No stale-checkbox repair was performed.

### Canonical spec validation

Sync was already complete; no archive-time sync fallback was needed or performed.

| Domain | Validation | Result |
|---|---|---|
| `beacon-draft-lifecycle` | Change copy and canonical copy byte-identical; 7 requirements / 12 scenarios | PASS |
| `beacon-version-lifecycle` | Change copy and canonical copy byte-identical; 6 requirements / 10 scenarios | PASS |
| `project-toolchain` | The MODIFIED `Directory Skeleton Matches Design` requirement and its three scenarios match the canonical requirement block; unrelated canonical requirements were preserved | PASS |

**Promoted canonical paths validated, not overwritten**:

- `openspec/specs/beacon-draft-lifecycle/spec.md`
- `openspec/specs/beacon-version-lifecycle/spec.md`
- `openspec/specs/project-toolchain/spec.md`

No destructive merge was performed. Therefore there were no removed-line counts,
destructive approvals, or merge blockers. The archive rule in `openspec/config.yaml`
requires a warning before destructive deltas; that rule was satisfied by confirming
that the canonical state already matched the completed sync.

**Synced requirement names**:

- ADDED: `Generic Result Refusal Carrier`; `Beacon and Draft Are Closed, Caller-Identified`; `Record Lookups Use Own-Property Semantics`; `createDraft Adds an Open Draft`; `updateDraft Is Revision-Bound`; `forkDraft Preserves Lineage`; `abandonDraft Tombstones an Open Draft`; `Version Is a Closed Union`; `approveDraft Re-Verifies the Reviewed Hash`; `Stale-Origin Approval Requires Explicit Acknowledgment`; `Approval Returns One Atomic Beacon`; `revokeVersion Works on Any Approved Version`; `resolveActiveVersion Is a Pure Lookup`.
- MODIFIED: `Directory Skeleton Matches Design`.
- REMOVED: none.

There were no other active same-domain changes. The archived historical
`project-toolchain` deltas were not active competing changes.

### Moved and preserved paths

The complete active directory was physically moved without deleting or staging
provider metadata:

`openspec/changes/beacon-core/` →
`openspec/changes/archive/2026-09-02-beacon-core/`

Moved paths:

- `openspec/changes/archive/2026-09-02-beacon-core/.gentle-ai-instance`
- `openspec/changes/archive/2026-09-02-beacon-core/proposal.md`
- `openspec/changes/archive/2026-09-02-beacon-core/specs/beacon-draft-lifecycle/spec.md`
- `openspec/changes/archive/2026-09-02-beacon-core/specs/beacon-version-lifecycle/spec.md`
- `openspec/changes/archive/2026-09-02-beacon-core/specs/project-toolchain/spec.md`
- `openspec/changes/archive/2026-09-02-beacon-core/design.md`
- `openspec/changes/archive/2026-09-02-beacon-core/tasks.md`
- `openspec/changes/archive/2026-09-02-beacon-core/apply-progress.md`
- `openspec/changes/archive/2026-09-02-beacon-core/verify-report.md`
- `openspec/changes/archive/2026-09-02-beacon-core/sync-report.md`
- `openspec/changes/archive/2026-09-02-beacon-core/state.yaml`
- `openspec/changes/archive/2026-09-02-beacon-core/archive-report.md`

The unrelated untracked provider metadata at
`openspec/changes/archive/2026-09-09-fs-beacon-store/.gentle-ai-instance` was
left untouched. No product or test files were altered, and no commit, push, PR,
or review actor was run.

### Verification and changed-line accounting

- Final evidence: PASS; 14/14 requirements, 25/25 scenarios, 128/128 tests,
  zero blockers, zero CRITICAL findings.
- Implementation authored-line accounting: C1a 356, C1b 230, C1c 327,
  C2a-1 258, C2a-2 286, C2b 611 (`size:exception`, operator-ratified), and
  C2c 222; total 2,290 authored lines across the final unit diffs.
- Reconciliation accounting before archive: 184 lines across five artifact files
  (`apply-progress.md`, `archive-report.md`, `state.yaml`, `sync-report.md`,
  `tasks.md`), 100 insertions and 84 deletions. This archive action added no
  canonical spec changes and performed a directory move preserving file contents.

### Remaining changes and risks

No active OpenSpec change directories remain after the move. The next change in
sequence is already archived independently and was not modified. Risks are limited
to historical wording in superseded sections of the audit artifacts (including
older task/verify counts); the final reconciliation and this section are
authoritative. Provider metadata preservation was explicitly checked.

**Memory observation IDs**: none — native status selected file-backed OpenSpec as
the authoritative store for this phase.

**Exact next recommendation**: `none — archive complete; continue from
openspec/changes/archive/2026-09-02-beacon-core/ and do not rerun sdd-archive.`
