# Archive Report: Semantic Projection Core (Slice A)

**Change**: `semantic-projection-core`
**Archive date**: 2026-09-02
**Project**: pharos
**Mode**: hybrid (openspec + engram)

## Change Summary

Slice A of an operator-ratified two-change split delivering the pure-domain semantic core for Pharos approval binding. This change lands the type model, normalization, projection, and structural-equality predicate that implement migration equivalence (lifecycle spec §5). Slice B (`semantic-projection-hashing`) will add the `Hasher` port and JCS/SHA-256 adapter.

**Scope**:
- `src/domain/semantics/` — types, normalize, project, equal, barrel (~320 lines)
- `tests/domain/semantics/` — unit + property suites (~290 lines)
- `package.json`, `package-lock.json` — `fast-check` devDependency

## Delivery

**Status**: COMPLETE — All 3 chained PRs merged into master e37b903

| PR | Slice | Commits | Description |
|----|-------|---------|-------------|
| #1 | A1 | `6518796` | Types + Structural Equality (223 lines) |
| #2 | A2 | `7bdb003` | Normalization + Arbitraries (301 lines) |
| #3 | A3 | `9078ec2`, `25614de`, `56cfe76` | Projection + Properties (250 lines) |

**Authored lines**: ~1643 (real delivery vs ~775 forecast; 2.1x due to estimation gap from changed-line budget semantics, not scope creep; two maintainer-approved objective resets by Pedro Altuve)

## Spec Compliance

**Main spec created**: `openspec/specs/semantic-projection/spec.md` (byte-identical promotion of delta)

**Requirements**: 6
**Scenarios**: 11 (per verify-report; earlier intermediate record said 12 — spec file is authoritative)

### Requirement Coverage

1. **Projection Inclusion** — COMPLIANT ✓
   - Full bundle projection (10 fields)
   - Explicitly ordered checkpoints preserved
   - Default keyed checkpoints

2. **Projection Exclusion** — COMPLIANT ✓
   - All excluded fields (identities, metadata, schema versions, secrets, runtime values, setup mechanics) dropped

3. **Normalization Before Comparison** — COMPLIANT ✓
   - Omitted equals explicit default
   - Null preserved only where declared
   - Keyed reordering does not change projection

4. **Migration Equivalence** — COMPLIANT ✓
   - Equivalent migration (same schema-independent meaning)
   - Non-equivalent migration (differing included fields)

5. **Domain Purity** — COMPLIANT ✓
   - No external imports, no `node:*` builtins
   - `npm run lint` exits 0

6. **Property-Based Coverage** — COMPLIANT ✓
   - All 3 fast-check properties in `project.properties.test.ts`
   - Vacuous-property guards executed with genuine RED evidence (task 3.9)

## Verification Results

**Verdict**: PASS (per `verify-report.md`)

| Metric | Value |
|--------|-------|
| Test count | 74/74 passing |
| Build | `npm run build` exit 0 |
| Lint | `npm run lint` exit 0 |
| Typecheck | `npm run typecheck` exit 0 |
| Scenario compliance | 11/11 COMPLIANT |
| Critical findings | 0 |
| Blockers | 0 |

**TDD Compliance**: 6/6 checks passed
- Every production line preceded by a failing test (strict TDD)
- All 32 tasks checked `[x]`
- RED/GREEN sequencing verified per phase
- Vacuous-property guard sweep completed (2 vacuous-test defects found and fixed during apply)

## Task Completion

**Total**: 32/32 complete

Note: `apply-progress` reported "30/30 tasks"; the actual `tasks.md` checkbox count is 32 (Phase 1: 6, Phase 2: 9, Phase 3: 11, Phase 4: 6). All 32 checkboxes are `[x]` and match completed code. This is a cosmetic count discrepancy in the apply summary only, not a functional gap. The archive phase records the corrected count: **32/32**.

### Task phases

| Phase | Goal | Status |
|-------|------|--------|
| 1 (A1) | Frozen type model + equality predicate | ✓ 6/6 |
| 2 (A2) | Default/null resolution + keying + arbitraries | ✓ 9/9 |
| 3 (A3) | Projection allowlist + property coverage | ✓ 11/11 |
| 4 | Final verification | ✓ 6/6 |

## Archive Contents

All artifacts copied mechanically with shell (`cp -R`); byte-identity verified via `diff -r`:

- ✅ `proposal.md` (5241 bytes)
- ✅ `specs/semantic-projection/spec.md` (5413 bytes, newly promoted to main)
- ✅ `design.md` (22007 bytes)
- ✅ `tasks.md` (8551 bytes) — 32/32 tasks complete
- ✅ `verify-report.md` (13629 bytes)
- ✅ `exploration.md` (9674 bytes)
- ✅ `state.yaml` (4198 bytes)

**Diff readback**: empty (no truncation, no alteration)

## Design Decisions Verified

All 8 ADRs in design.md followed:

1. ✓ `SemanticSource` input (schema-interpreted with index signature)
2. ✓ `VariableClassification` closed union; `NormalizedConstraint.kind` open string
3. ✓ Keyed collections are `Record<string, T>`, never sorted arrays
4. ✓ Checkpoints discriminated union (`ordering: "keyed" | "ordered"`)
5. ✓ `SemanticProjection` FROZEN unversioned alias of `SemanticBundle`
6. ✓ Default/null resolution driven by `FIELD_DECLARATIONS` table
7. ✓ Primitive equality uses `===`, not `Object.is`
8. ✓ Duplicate logical identity throws

## Issues & Reconciliations

### Warnings (non-blocking)

1. **Count reconciliation**: `state.yaml` and `apply-progress` recorded "30/30 tasks"; archive corrects to **32/32** (all `[x]` and verified in code).

2. **Spec scenario count**: Earlier intermediate record said "12 scenarios"; spec file contains **11** (all covered by passing tests). Archive records the correct count.

3. **Pre-existing ESLint deprecation**: `npm run lint` prints six `eslint-plugin-boundaries` deprecation warnings about its own config API (`element-types` → `dependencies`, `rules` → `policies`, etc.). Not introduced by this change; zero lint errors. Exit code 0. Classified as pre-existing project-level technical debt, not a defect in this change.

### No Critical Issues

Per verify-report: "CRITICAL: None". The change is production-ready.

## Follow-Up Items

### In Progress

**Slice B (`semantic-projection-hashing`)**: Started in parallel worktree by Pi agent
- Hasher port + JCS/SHA-256 adapter
- Technical design §2 amendment + MODIFIED project-toolchain delta
- Depends on this change; can only land after Slice A merges

### For Future Work

1. **Design-estimate calibration**: Canonical-by-construction normalization pipelines cost 2–3x naive line estimates (twice-observed: this change, plus prior project-foundation). Recommend adjusting TDD line budgets for pure-domain work in future SDD instances.

2. **Project-modernization follow-up**: Pre-existing `eslint-plugin-boundaries` rule-name deprecation warnings remain unfixed in `openspec/config.yaml`. Recommend as a separate project-foundation enhancement or project-toolchain MODIFIED delta.

## SDD Cycle Complete

✓ Proposed, specified, designed, tasked, implemented, verified, and archived.

**Source of truth updated**: `openspec/specs/semantic-projection/spec.md` now authoritative for this capability.

**Ready for**: Next change, or Slice B continuation.

## Artifact Store Persistence

This report mirrors to Engram topic key `sdd/semantic-projection-core/archive-report` (project: pharos) for persistent audit trail.

---

**Archive location**: `/home/pedro/pharos/openspec/changes/archive/2026-09-02-semantic-projection-core/`  
**Merged spec**: `/home/pedro/pharos/openspec/specs/semantic-projection/spec.md`
