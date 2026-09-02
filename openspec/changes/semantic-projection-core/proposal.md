# Proposal: Semantic Projection Core (Slice A)

## Intent

Pharos binds approval to *semantics*, not to file bytes: two contracts that mean the same journey must be provably the same, and any change to meaning must break that identity. Today `src/domain/semantics/` is an empty barrel, so nothing enforces that rule. This change lands the pure-domain semantic core — type model, normalization, projection, and the structural-equality predicate that implements migration equivalence (lifecycle spec §5) — so approval, staleness, and migration work built later has one authoritative definition of "same meaning".

Slice A of an operator-ratified two-change split. Slice B (`semantic-projection-hashing`) adds the `Hasher` port and JCS/SHA-256 adapter on top.

## Scope

### In Scope

- `src/domain/semantics/types.ts` — `SemanticBundle` model (keyed vs ordered collections per lifecycle §4).
- `src/domain/semantics/normalize.ts` — declared-default resolution, ordering rules, null semantics.
- `src/domain/semantics/project.ts` — schema-independent projection builder (hash-input inclusions/exclusions).
- `src/domain/semantics/equal.ts` — deep structural equality = migration equivalence.
- `src/domain/semantics/index.ts` — public barrel.
- `tests/domain/semantics/` — unit + fast-check property suites (strict TDD, RED first).
- `package.json` / `package-lock.json` — `fast-check` as **devDependency only**.

### Out of Scope

- `Hasher` port, `src/adapters/hashing/`, `canonicalize` dependency, `sha256:<hex>` identity — **all Slice B**.
- `docs/technical-design-v1.md` §2 amendment and the `project-toolchain` MODIFIED delta — **Slice B**.
- Any runtime dependency; any file outside `src/domain/semantics/`, `tests/domain/semantics/`, `package.json`, `package-lock.json`.
- Store persistence, approval workflow, CLI, Playwright, Ajv wiring, migration tooling beyond the predicate.

## Capabilities

### New Capabilities
- `semantic-projection`: normalization and schema-independent projection of a contract into a `SemanticBundle`, plus the structural-equality predicate defining migration equivalence.

### Modified Capabilities
None. (`project-toolchain`'s skeleton requirement is amended in Slice B, not here.)

## Approach

Pure hand-written TypeScript — no npm import is legal inside `src/domain/**` (`boundaries/external` `disallow: ["*"]`). Normalization resolves declared defaults, then projection emits only hash-input fields: journey actions ordered; checkpoints keyed by default and ordered only when explicitly declared ordered; variables/outcomes/allowed-variation/prohibited-regressions keyed by logical identity. `null` is meaningful only where the schema declares it. Equality is `deepEqual(projection(a), projection(b))` — no crypto, no port, no I/O. Input is assumed already schema-validated; the first caller must uphold that.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/domain/semantics/` | New | types, normalize, project, equal, barrel (~320 lines) |
| `tests/domain/semantics/` | New | unit + property suites (~290 lines) |
| `package.json`, `package-lock.json` | Modified | `fast-check` devDependency |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| ~610 authored lines exceeds the 400-line review budget | High | Stated openly now; `sdd-tasks` forecast triggers the `ask-on-risk` stop with real numbers and the operator chooses chained PRs or `size:exception`. **Do not trim strict-TDD coverage to fit.** |
| Type model churns when Slice B or `application/` consumes it | Medium | Design phase pins `VariableClassification`, `NormalizedConstraint`, and entry-point normalization before apply |
| Projection drifts from docs' inclusion/exclusion lists | Medium | Spec scenarios derive directly from lifecycle §4–§5 and domain-requirements approval-bound semantics |
| Null-semantics property needs a field-declaration fixture | Low | Minimal fixture built inside this change |

## Rollback Plan

Purely additive. Rollback = delete `src/domain/semantics/*` (restore `index.ts` to `export {};`), delete `tests/domain/semantics/`, revert `package.json` and `package-lock.json`, run `npm ci`. No consumers exist yet, no data migration, no runtime dependency to unwind.

## Dependencies

- `fast-check` (devDependency, new).
- Existing workspace from archived `project-foundation`: Vitest, ESLint boundaries, strict ESM TypeScript.
- Slice B depends on this change; this change depends on nothing pending.

## Success Criteria

- [ ] `npm test`, `npm run lint`, `npm run typecheck`, `npm run build` all exit `0`.
- [ ] `tests/architecture/boundaries.test.ts` stays green — `src/domain/semantics/` imports nothing external.
- [ ] Property: permuting keyed-collection entry order yields identical projections.
- [ ] Property: omitted value projects identically to its explicit declared default.
- [ ] Property: `null` is preserved as distinct only in fields whose declaration gives it domain meaning.
- [ ] The equality predicate reproduces the lifecycle spec §5 migration-equivalence scenarios (equivalent and non-equivalent).
- [ ] Every production line was preceded by a failing test (strict TDD).
