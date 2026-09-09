# Spec Sync Report: Beacon Core Archive

**Date**: 2026-09-02  
**Change**: beacon-core  
**Archive Phase**: Spec merge and main-spec updates

## Historical Sync Snapshot (superseded)

The 2026-09-02 operations below are preserved as historical evidence. Their pre-remediation counts are superseded by the final reconciliation; they do not describe the current verification totals or delivery state.

## Operations Performed (historical)

### 1. Create `openspec/specs/beacon-draft-lifecycle/spec.md`

**Source**: `openspec/changes/beacon-core/specs/beacon-draft-lifecycle/spec.md`  
**Operation**: Mechanical copy (shell `cp`)  
**Verification**: Empty diff ✅  
**Content**: 6 requirements / 10 scenarios  
**Status**: ✅ Complete

Capabilities:
- Generic Result Refusal Carrier
- Beacon and Draft Are Closed, Caller-Identified
- createDraft Adds an Open Draft
- updateDraft Is Revision-Bound
- forkDraft Preserves Lineage
- abandonDraft Tombstones an Open Draft

### 2. Create `openspec/specs/beacon-version-lifecycle/spec.md`

**Source**: `openspec/changes/beacon-core/specs/beacon-version-lifecycle/spec.md`  
**Operation**: Mechanical copy (shell `cp`)  
**Verification**: Empty diff ✅  
**Content**: 6 requirements / 8 scenarios  
**Status**: ✅ Complete

Capabilities:
- Version Is a Closed Union
- approveDraft Re-Verifies the Reviewed Hash
- Stale-Origin Approval Requires Explicit Acknowledgment
- Approval Returns One Atomic Beacon
- revokeVersion Works on Any Approved Version
- resolveActiveVersion Is a Pure Lookup

### 3. Apply Delta to `openspec/specs/project-toolchain/spec.md`

**Source Delta**: `openspec/changes/beacon-core/specs/project-toolchain/spec.md`  
**Operation**: Edit-based merge (2 replacements)  
**Verification**: File updated, no byte truncation ✅  
**Status**: ✅ Complete

**Changes**:
1. **Requirement description generalization** (line 49)
   - **Old**: "...ratified Slice A or Slice B behavior"
   - **New**: "...ratified behavior landed by an accepted change"
   - **Rationale**: Generalize to any future slice without re-editing

2. **Scenario "Existing module barrels may expose ratified behavior"** (line 60)
   - **Old**: "...ratified Slice A or Slice B implementation"
   - **New**: "...ratified implementation from any accepted change, including `src/domain/beacon/` and `src/shared/` from Beacon Core"
   - **Rationale**: Concrete example for clarity

3. **New scenario added**: "Beacon Core lands without adding directories"
   - **Scenario**: Verify no new architectural directories created by Beacon Core
   - **Rationale**: Compliance gate for directory-skeleton invariant

## Spec Merge Totals

| Spec | Type | Requirements | Scenarios | Status |
|------|------|---|---|---|
| beacon-draft-lifecycle | NEW | 6 | 10 | ✅ |
| beacon-version-lifecycle | NEW | 6 | 8 | ✅ |
| project-toolchain | MODIFIED | 5 | 13 | ✅ |
| **Totals** | | **17 new/modified** | **31 new/modified** | **Complete** |

## Verification Summary

**New spec copies**:
```
$ diff -r openspec/changes/beacon-core/specs/beacon-draft-lifecycle/spec.md openspec/specs/beacon-draft-lifecycle/spec.md
(no differences reported)

$ diff -r openspec/changes/beacon-core/specs/beacon-version-lifecycle/spec.md openspec/specs/beacon-version-lifecycle/spec.md
(no differences reported)
```

**Modified spec**:
- `project-toolchain/spec.md`: 2 requirement/scenario rewrites + 1 new scenario
- No byte loss or truncation
- Lines 49 and 60 edited in place
- New scenario inserted at lines 64-70

## Final Reconciliation (2026-09-09)

The historical sync snapshot above is superseded by final evidence:

- Final verification is PASS: 14/14 requirements, 25/25 scenarios, and 128/128 tests.
- There are zero CRITICAL findings and zero delivery blockers.
- Delivery PRs #6, #7, #8, #13, #14, #16, and #17 are merged; no remote `change/beacon-core-*` refs remain.
- Stale force-push rows 8.10 and 16.6 are reconciled as obsolete/completed delivery work; this report does not claim a force-push occurred.
- The change remains active pending a separate archive action; the intended archive destination does not yet exist.

**Result**: Promoted specs remain the source of truth for ratified Beacon Core behavior; this report records final evidence without performing an archive move.
