# Spec Sync Report: Beacon Core Archive

**Date**: 2026-09-02  
**Change**: beacon-core  
**Archive Phase**: Spec merge and main-spec updates

## Summary

Three capability specs (two new, one delta) merged into main specs directory per hybrid-mode archive policy. Mechanical shell-based copy operations verified with zero-diff readback to ensure byte-identity.

## Operations Performed

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

## Archive Readiness

✅ All specs merged into main specs directory  
✅ Byte-identity confirmed for new specs  
✅ Delta successfully applied to modified spec  
✅ No gaps or missing requirements  
✅ Future spec merges will follow the same pattern

**Result**: Source of truth updated. Main specs now authoritative for all ratified Beacon Core behavior.
