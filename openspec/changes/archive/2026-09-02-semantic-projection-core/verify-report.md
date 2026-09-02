```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:d7fe0303e57172ff47cdac6cec1da3715ae2759bc08e93327e6731cb4fa7679c
verdict: pass
blockers: 0
critical_findings: 0
requirements: 6/6
scenarios: 11/11
test_command: npm test
test_exit_code: 0
test_output_hash: sha256:c665c60537f43766dadae4b4e1852b87a97b29e7d021676a7ed64bbae46d6801
build_command: npm run build
build_exit_code: 0
build_output_hash: sha256:9a7b581687e6658fe0477421daba6a5a0f4e5ae253c2c562a298e3e8dc2eb7e9
```

## Verification Report

**Change**: semantic-projection-core
**Version**: N/A (Slice A of a two-slice split; successor `semantic-projection-hashing`)
**Mode**: Strict TDD

### Completeness
| Metric | Value |
|--------|-------|
| Tasks total | 32 |
| Tasks complete | 32 |
| Tasks incomplete | 0 |

Note: `apply` phase and `state.yaml` recorded "30/30" — the actual checkbox count in `tasks.md` is 32 (Phase 1: 6, Phase 2: 9, Phase 3: 11, Phase 4: 6). This is a cosmetic count discrepancy in the apply summary only; every one of the 32 checkboxes is `[x]` and matches completed code. Not a blocker.

### Build & Tests Execution
**Build**: PASSED (`npm run build` → `tsc -p tsconfig.build.json`, exit 0)

**Tests**: PASSED — 74/74 (`npm test` → `vitest run`, 5 test files, exit 0)

**Additional gate commands** (config `openspec/config.yaml` lists test/build only; lint/typecheck run per orchestrator instruction and spec Requirement: Domain Purity):
- `npm run lint` → exit 0 (eslint-plugin-boundaries prints pre-existing deprecation warnings about its own config API, unrelated to this change and not new; zero lint errors)
- `npm run typecheck` → `tsc --noEmit`, exit 0

**Coverage**: Not available — no coverage tool configured in this project; skipped per graceful-degradation rule (informational, not a failure).

### Spec Compliance Matrix (11 scenarios, verified against `openspec/changes/semantic-projection-core/specs/semantic-projection/spec.md` on branch `change/semantic-projection-core-a3` @ 25614de)

| # | Requirement | Scenario | Test | Result |
|---|-------------|----------|------|--------|
| 1 | Projection Inclusion | Full bundle projection | `tests/domain/semantics/project.test.ts > project — inclusion > projects the ten allowed fields in normalized form` | COMPLIANT |
| 2 | Projection Inclusion | Explicitly ordered checkpoints preserved as ordered | `project.test.ts > ordered vs default-keyed checkpoints > preserves declared-ordered checkpoints as an ordered sequence` | COMPLIANT |
| 3 | Projection Inclusion | Default keyed checkpoints | `project.test.ts > ordered vs default-keyed checkpoints > defaults undeclared checkpoints to a keyed, order-insensitive collection` | COMPLIANT |
| 4 | Projection Exclusion | Excluded fields dropped | `project.test.ts > project — exclusion > drops identities, local address/title, schema version, approval metadata, artifact refs, secret contents, runtime-resolved values, setup mechanics, and readiness-validation results` (scans serialized output for 12 excluded tokens + asserts exact 10-key allowlist) | COMPLIANT |
| 5 | Normalization Before Comparison | Omitted equals explicit default | `project.properties.test.ts > omitted == explicit default` (fast-check property, table-driven over all 13 `FIELD_DECLARATIONS` paths) + `normalize.test.ts` `describe.each` unit cases | COMPLIANT |
| 6 | Normalization Before Comparison | Null preserved only where declared | `project.properties.test.ts > null only where declared` (pipeline property + domain-independent `resolveDeclared` property) + `normalize.test.ts > declared-null contrast pair` | COMPLIANT |
| 7 | Normalization Before Comparison | Keyed reordering does not change projection | `project.properties.test.ts > keyed-order insensitivity` (fast-check `uniqueArray` + `shuffledSubarray`) | COMPLIANT |
| 8 | Migration Equivalence | Equivalent migration | `equal.test.ts > isMigrationEquivalent > reports true for a source and target expressing the same schema-independent meaning` | COMPLIANT |
| 9 | Migration Equivalence | Non-equivalent migration | `equal.test.ts > isMigrationEquivalent > reports false for a source and target differing in an included field` | COMPLIANT |
| 10 | Domain Purity | Boundary lint stays green | `npm run lint` exit 0; `rg` scan of `src/domain/semantics/*.ts` confirms zero `node:*`/npm imports (only relative `./types.js` imports) | COMPLIANT |
| 11 | Property-Based Coverage | Property suites pass | `project.properties.test.ts` — all 3 fast-check properties execute inside `npm test`'s 74/74 passing run; `fast-check@4.9.0` present as devDependency in `package.json` | COMPLIANT |

**Compliance summary**: 11/11 scenarios compliant

### Correctness (Static Evidence)
| Requirement | Status | Notes |
|------------|--------|-------|
| Projection Inclusion | Implemented | `project.ts` → `normalize()` assembles exactly the 10 `SemanticBundle` fields |
| Projection Exclusion | Implemented | `project.ts` is an allowlist (`return normalize(source)`); no source spread reaches the result — `SemanticSource`'s `[excludedField: string]: unknown` index signature never leaks |
| Normalization Before Comparison | Implemented | `FIELD_DECLARATIONS` (13 entries) + `resolveDeclared` centralize default/null resolution; `toKeyed` makes keyed collections `Record`-typed (order unrepresentable) |
| Migration Equivalence | Implemented | `equal.ts` `deepEqual` — recursive, `===` on leaves (not `Object.is`), no hashing/I/O |
| Domain Purity | Implemented | `src/domain/semantics/*.ts` imports only sibling `./*.js` relative modules |
| Property-Based Coverage | Implemented | `fast-check@4.9.0` devDependency; 3 properties in `project.properties.test.ts` |

### Coherence (Design) — 8 ADRs in `design.md`
| Decision | Followed? | Notes |
|----------|-----------|-------|
| `SemanticSource` input (schema-interpreted, not raw contract) with index signature | Yes | `types.ts` `SemanticSourceCore & { [excludedField: string]: unknown }`; exclusion test proves the index-signature fields never reach output |
| `VariableClassification` closed union; `NormalizedConstraint.kind` open string | Yes | `types.ts` line 14-17 closed union of 3 literals; `NormalizedConstraint.kind: string` |
| Keyed collections are `Record<string, T>`, never sorted arrays | Yes | `variables`, `outcomes`, `allowedVariation`, `prohibitedRegressions`, checkpoint `entries` (keyed branch), `constraints`, `isolation.scope` all typed `Record`/`SemanticKeySet` |
| Checkpoints are a discriminated union (`ordering: "keyed" \| "ordered"`) | Yes | `NormalizedCheckpoints` union in `types.ts`; `normalizeCheckpoints` in `normalize.ts` implements both branches |
| `SemanticProjection` is a FROZEN unversioned alias of `SemanticBundle` | Yes | `types.ts` line 101: `export type SemanticProjection = SemanticBundle; // FROZEN — Slice B consumes unchanged` |
| Default/null resolution driven by `FIELD_DECLARATIONS` table, not scattered `??` | Yes | 13-entry table + single `resolveDeclared` function; every normalizer calls it |
| Primitive equality uses `===`, not `Object.is` | Yes | `equal.ts` line 35: `return a === b;`; `equal.test.ts` covers `-0 === 0` explicitly |
| Duplicate logical identity throws | Yes | `toKeyed` throws `Error` on duplicate key (array form) or id/key mismatch (object form); covered by 4 dedicated `normalize.test.ts` cases |

**Zero optional properties in output family**: confirmed — `SemanticBundle` and every nested output interface (`NormalizedActor`, `NormalizedEntryPoint`, `OrderedJourneyAction`, `NormalizedCheckpoint`, `VariableDecl`, `KeyedDeclaration`, `NormalizedIsolationIntent`, `ReadinessIntent`) declare all fields non-optional (`readonly`, no `?`); absence is represented only via `null` or a resolved default.

### TDD Compliance
| Check | Result | Details |
|-------|--------|---------|
| TDD Evidence reported | Present (prose form) | Engram observation 2050 (`apply-progress`) documents RED/GREEN sequencing per phase and the mandatory 3.9 vacuous-property guard sweep, though not as a literal markdown table |
| All tasks have tests | Yes | 32/32 tasks; every GREEN task has a corresponding test file (`equal.test.ts`, `normalize.test.ts`, `project.test.ts`, `project.properties.test.ts`) |
| RED confirmed (tests exist) | Yes | All 5 test files exist and were confirmed present in the working tree |
| GREEN confirmed (tests pass) | Yes | 74/74 pass on live re-run in this verify session |
| Triangulation adequate | Yes | Multiple test cases per behavior (e.g. inclusion + exclusion + ordered/keyed for projection; equivalent/non-equivalent + reflexivity for equality) |
| Safety Net for modified files | Yes | `index.ts` (only modified, non-new file) re-exports all 4 modules; barrel exercised by every test import |

**TDD Compliance**: 6/6 checks passed

### Assertion Quality
No violations found. Reviewed all 5 test files (`equal.test.ts`, `normalize.test.ts`, `project.test.ts`, `project.properties.test.ts`, `arbitraries.ts`) for tautologies, orphan empty checks, ghost loops, ratio issues, and smoke-test-only patterns.

Notable positive finding: `project.properties.test.ts`'s "null only where declared" test includes a second, domain-independent property directly against `resolveDeclared` with a synthetic non-null default — added specifically because the primary `FIELD_DECLARATIONS`-driven property was structurally unable to distinguish "null preserved because meaningful" from "null happens to equal a coincidentally-null default" (every `nullHasDomainMeaning: true` entry's `declaredDefault` is also `null`). This is documented reasoning against a real vacuity risk, not a vacuous test.

**Assertion quality**: All assertions verify real behavior

### Property Coverage (per orchestrator instruction — no re-run of destructive revert probes)
The three fast-check properties (`keyed-order insensitivity`, `omitted == explicit default`, `null only where declared`) exist in `project.properties.test.ts`, execute inside the 74/74 passing `npm test` run confirmed live in this session, and their vacuous-guard evidence (task 3.9: temporarily reverting `toKeyed`, `resolveDeclared`'s default resolution, and `resolveDeclared`'s `nullHasDomainMeaning` branch, confirming each reverted variant genuinely FAILS the property, then restoring) is documented in Engram observation 2050 (`sdd/semantic-projection-core/apply-progress`), including two real vacuous-test bugs found and fixed during that sweep (`withVariables` array-vs-object form; the synthetic `resolveDeclared` strengthening described above). No destructive probes were re-run against committed code in this verify session, per the orchestrator's explicit instruction that apply + gate-validator evidence suffices.

### Chained-Slice Integrity
| Slice | Commit | Files touched |
|-------|--------|----------------|
| A1 | `6518796` | `src/domain/semantics/equal.ts`, `src/domain/semantics/index.ts`, `src/domain/semantics/types.ts`, `tests/domain/semantics/equal.test.ts` — 360 lines, 4 files, no A2/A3 files present |
| A2 | `7bdb003` | `package-lock.json`, `package.json`, `src/domain/semantics/index.ts`, `src/domain/semantics/normalize.ts`, `tests/domain/semantics/arbitraries.ts`, `tests/domain/semantics/normalize.test.ts` — 894 lines, 6 files, no A3 files (`project.ts`/`project.test.ts`/`project.properties.test.ts`) present |

Verified via `git show --stat` on both commits: each slice boundary contains only its own declared files, confirming independent buildability per the chained-PR delivery strategy. A3 (`9078ec2` + `25614de`) was not independently re-diffed in this verify pass — its content is exercised in full by the live `npm test`/`build`/`lint`/`typecheck` run against current HEAD.

### Issues Found
**CRITICAL**: None
**WARNING**:
1. Count reconciliation — `state.yaml`/apply-progress reported "30/30 tasks"; the actual `tasks.md` checkbox count is 32/32. All 32 are `[x]` and match code; this is a bookkeeping discrepancy in the apply summary text only, not a functional gap. Recommend the archive phase note the corrected count (32) in any downstream summary.
2. Count reconciliation — `state.yaml`'s `spec` phase entry records "12 scenarios"; the spec file as retrieved in this verify session contains 11 `#### Scenario:` headings. All 11 are covered by passing tests. Recommend correcting the stored count before/at archive.
3. `npm run lint` prints six `eslint-plugin-boundaries` deprecation warnings about its own rule/option naming (`element-types` → `dependencies`, `rules` → `policies`, etc.). These are pre-existing project-level ESLint config warnings unrelated to `semantic-projection-core`'s code; exit code is 0 and no lint errors were introduced by this change. Flagged as a SUGGESTION-adjacent WARNING only because it is unaddressed technical debt in shared config, not because this change caused it.

**SUGGESTION**:
1. `apply-progress`'s TDD evidence is documented in narrative form (Engram observation 2050) rather than as a literal per-task markdown table. Content is complete and cross-verified against the actual RED/GREEN artifacts, but a future apply phase could emit the table format directly for faster machine verification.

### Verdict
PASS
All 32/32 tasks complete, all 11/11 spec scenarios covered by passing tests verified live (74/74), build/lint/typecheck all exit 0, all 8 design ADRs followed, chained-slice file boundaries verified clean via `git show --stat`; two informational count-reconciliation discrepancies noted for archive but neither is a functional or spec-compliance gap.
