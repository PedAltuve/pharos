# Tasks: Semantic Projection Core (Slice A)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines (authored) | ~775 (production ~343 + tests ~430 + package.json ~1); package-lock.json delta (~20, generated) excluded from authored count but included in snapshot/receipt validation |
| 400-line budget risk | High (~1.9x the 400-line budget) |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (A1, types+equal, ~223) -> PR 2 (A2, normalize+arbitraries, ~301) -> PR 3 (A3, project+properties, ~250) — sequential/chained because A2 imports `types.ts` from A1 and A3 imports `normalize.ts` from A2 |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending — operator chooses stacked-to-main, feature-branch-chain, or size-exception at the guard; these tasks present the numbers, not the decision |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 (A1) | Frozen type model + structural-equality predicate | PR 1 | `npx vitest run tests/domain/semantics/equal.test.ts` | N/A — pure in-process TypeScript, no I/O (design Threat Matrix: N/A) | Revert `index.ts` to `export {};`; delete `types.ts`, `equal.ts`, `equal.test.ts` |
| 2 (A2) | Declared-default/null table + keying normalizers + shared test arbitraries | PR 2 (base = PR 1 branch, or independent if stacked) | `npx vitest run tests/domain/semantics/normalize.test.ts` | N/A — pure in-process TypeScript | Delete `normalize.ts`, `arbitraries.ts`, `normalize.test.ts`; revert `package.json`/`package-lock.json` fast-check devDep; `npm ci` |
| 3 (A3) | Schema-independent projection allowlist + fast-check property coverage | PR 3 (base = PR 2 branch) | `npx vitest run tests/domain/semantics/project.test.ts tests/domain/semantics/project.properties.test.ts` | N/A — pure in-process TypeScript | Delete `project.ts`, `project.test.ts`, `project.properties.test.ts` |

## Phase 1: Slice A1 — Types + Equality (PR 1)

- [x] 1.1 RED: write `tests/domain/semantics/equal.test.ts` — reflexivity, equivalent migration, non-equivalent migration, `-0 === 0` leaf equality, keyed-vs-ordered checkpoints never equal. Hand-written literal fixtures, no dependency on `project`. Confirm it fails (no exports yet).
- [x] 1.2 GREEN: create `src/domain/semantics/types.ts` — complete frozen type model (`SemanticValue` through `SemanticBundle`/`SemanticProjection` and the `SemanticSource` input contract) per design Interfaces/Contracts, landed whole.
- [x] 1.3 GREEN: create `src/domain/semantics/equal.ts` — `deepEqual` (recursive, `===` on leaves, no `Object.is`), `projectionsEqual`, `isMigrationEquivalent`.
- [x] 1.4 GREEN: update `src/domain/semantics/index.ts` barrel to export `types.ts` + `equal.ts` (replace `export {};`).
- [x] 1.5 Confirm `tests/domain/semantics/equal.test.ts` passes: `npx vitest run tests/domain/semantics/equal.test.ts`.
- [x] 1.6 Run `npm run lint`; confirm `src/domain/semantics/` boundary stays green.

## Phase 2: Slice A2 — Normalization (PR 2)

- [x] 2.1 Add `fast-check` devDependency to `package.json`/`package-lock.json` (`npm install --save-dev fast-check`).
- [x] 2.2 RED: write `tests/domain/semantics/normalize.test.ts` defaults/null cases, table-driven `it.each` over `FIELD_DECLARATIONS`. Confirm fails (no `normalize.ts` yet).
- [x] 2.3 GREEN: create `src/domain/semantics/normalize.ts` — `FieldDeclaration<T>`, the full `FIELD_DECLARATIONS` table (13 entries per design), `resolveDeclared<T>(raw, declaration)`. Note: `resolveDeclared`'s exported signature may be tightened with overloads during apply (e.g. narrowing by `nullHasDomainMeaning`) without counting as a design deviation — the design's generic signature is a floor, not a ceiling.
- [x] 2.4 RED: extend `normalize.test.ts` with keying cases — `toKeyed` from array and object form, id/key-mismatch throws, duplicate-key throws. Confirm fails.
- [x] 2.5 GREEN: extend `normalize.ts` with `toKeyed` + part normalizers (variables, outcomes, allowedVariation, prohibitedRegressions, checkpoint expectations, entry-point query, per-variable constraints keyed by `kind`) and `normalize(source): SemanticBundle`.
- [x] 2.6 Create `tests/domain/semantics/arbitraries.ts` — shared fast-check generators (`arbVariable`, `arbSource`, etc.) and path get/set helpers over `FIELD_DECLARATIONS` keys. The get/set helpers MUST address entries inside keyed `Record`s (e.g. `variable.constraints["<kind>"].value`), not only dotted top-level paths — property 3 in Slice A3 enumerates paths inside keyed collections.
- [x] 2.7 In `normalize.test.ts`, add direct unit tests exercising the path get/set helpers from `arbitraries.ts` (beyond the `FIELD_DECLARATIONS` table-driven cases), so A2 ships no dead test code ahead of A3 consuming them in properties.
- [x] 2.8 Confirm `normalize.test.ts` passes: `npx vitest run tests/domain/semantics/normalize.test.ts`.
- [x] 2.9 Run `npm run lint`; confirm boundary stays green.

## Phase 3: Slice A3 — Projection + Properties (PR 3)

- [x] 3.1 RED: write `tests/domain/semantics/project.test.ts` **inclusion** cases — full-bundle projection from a rich fixture; assert the ten allowed fields appear in normalized form. Confirm fails (no `project.ts` yet).
- [x] 3.2 GREEN (deliberately naive, tautology-trap staging): create `src/domain/semantics/project.ts` with `project(source)` that copies the source wholesale (no allowlist). Confirm inclusion suite passes.
- [x] 3.3 RED: extend `project.test.ts` with **exclusion** cases — fixture also carries identities, local address/title, schema version, approval metadata, artifact refs, secret contents, runtime-resolved values, setup mechanics, readiness-validation results; assert none appear and the projection's key set equals exactly the ten allowed keys. Run and confirm this FAILS against step 3.2's naive copy (trap check: if it passes here, fix the fixture/assertion before proceeding — it proves nothing).
- [x] 3.4 GREEN: convert `project.ts` from copy to the real allowlist assembly of the ten included fields via `normalize()`. Confirm exclusion suite passes.
- [x] 3.5 RED: extend `project.test.ts` with ordered-vs-default-keyed checkpoint cases. Confirm fails.
- [x] 3.6 GREEN: wire the `NormalizedCheckpoints` discriminated-union branch into `project.ts`/`normalize.ts`. Confirm passes.
- [x] 3.7 Confirm `project.test.ts` passes in full: `npx vitest run tests/domain/semantics/project.test.ts`.
- [x] 3.8 RED: create `tests/domain/semantics/project.properties.test.ts` with the three fast-check properties (keyed-order insensitivity; omitted == explicit default, table-driven over `FIELD_DECLARATIONS`; null only where declared, using `arbitraries.ts` get/set helpers including paths inside keyed Records). Run once; these should already pass given the GREEN steps above — the mandatory vacuous-property guard in 3.9 substitutes for a RED failure here.
- [x] 3.9 Vacuous-property guard, run once per property before shipping: for **keyed-order insensitivity**, temporarily revert `toKeyed` to an order-sensitive construction, run the property suite, confirm it FAILS, then restore and re-confirm green; for **omitted == explicit default**, temporarily revert `resolveDeclared` to skip default resolution, run, confirm FAILS, restore, re-confirm green; for **null only where declared**, temporarily revert `resolveDeclared`'s `nullHasDomainMeaning` branch to always resolve to default, run, confirm FAILS, restore, re-confirm green.
- [x] 3.10 Confirm `project.properties.test.ts` passes in full: `npx vitest run tests/domain/semantics/project.properties.test.ts`.
- [x] 3.11 Run `npm run lint`; confirm boundary stays green.

## Phase 4: Final Verification (sequential, after A1+A2+A3 land)

- [x] 4.1 Run full `npm test` — `equal.test.ts`, `normalize.test.ts`, `project.test.ts`, `project.properties.test.ts` all green.
- [x] 4.2 Run `npm run build` — exits 0.
- [x] 4.3 Run `npm run lint` — exits 0, no boundary violations.
- [x] 4.4 Run `npm run typecheck` — exits 0.
- [x] 4.5 Confirm `tests/architecture/boundaries.test.ts` (read-only) still passes — `src/domain/semantics/` imports nothing external, no `node:*` built-in.
- [x] 4.6 Confirm `openspec/config.yaml` (read-only) was NOT modified — no config changes in this change.
