```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:1384f0d31fcbd8338467f09aefe20d5ec883b8c2c09436659f02383afe33288a
verdict: pass_with_warnings
blockers: 0
critical_findings: 0
requirements: 12/12
scenarios: 25/25
test_command: npm test
test_exit_code: 0
test_output_hash: sha256:0a7f43565f7580b6a365647ce4652a5b192664c0bfff604e3aad0ea877dd45b4
build_command: npm run build
build_exit_code: 0
build_output_hash: sha256:de4e24ced30c856d1521275999f910ae3e490960c1576b8f7c3d2326d76e8cd9
```

# Verify Report: fs-beacon-store

## Verdict

**Status: PASS (warnings only).** The implementation at `08b8c6c660f7f30dbaca6a3c4ee8fe8448811c98` satisfies the three change specs, the ratified design, all implementation tasks, strict-TDD verification, and the review-workload boundary. There are no archive blockers. Run SDD sync before archive.

## Structured status and action context

- Consumed parent-provided `gentle-ai.sdd-status` schema v2 for unambiguous change `fs-beacon-store`.
- Authoritative store: `openspec`; task progress `136/136`; apply state `all_done`; verify was `ready`; blocked reasons were empty.
- `actionContext.mode=repo-local`, workspace root `/home/pedro/pharos`, and effective verify edit scope was only `openspec/changes/fs-beacon-store/verify-report.md`.
- Verified root `/home/pedro/pharos` and assigned branch `test/fs-beacon-store-u11`.
- Implementation ownership is proven under the workspace: 13 production and 18 test paths belong to the declared change surfaces. The only current verification write is this report.
- Pre-existing working-tree state retained untouched: modified `tasks.md` and `apply-progress.md`, plus untracked `.gentle-ai-instance` files under `beacon-core` and `fs-beacon-store`.

## Task completion

- Parsed `tasks.md`: **136 total, 136 checked, 0 unchecked**.
- Exact unchecked implementation task lines: **none** (`grep -nE '^\s*- \[ \]' ...` returned no matches).
- Every task marker carries `sdd-owner: implementation` (136 markers).
- Proposal success-criterion checkbox text remains documentary, not an implementation task list; each criterion is independently satisfied below.

## Spec coverage: 25/25 scenarios

All referenced tests passed in the 18-file focused run and the 27-file full run.

| Spec scenario | Independent passing trace |
|---|---|
| Port R1 S1 | `tests/architecture/boundaries.test.ts` — zero Node imports / clean port lint |
| Port R1 S2 | `tests/architecture/boundaries.test.ts` — exactly 9 lifecycle methods |
| Port R2 S1 | shared contract and `approval.test.ts` — identical-key replay |
| Port R2 S2 | shared contract and `draft-writes.test.ts` — changed-input conflict |
| Port R3 S1 | `lock.test.ts` — bounded `lock-unavailable` value |
| Port R3 S2 | `read.test.ts` — absent beacon returns `beacon-not-found` |
| Port R4 S1 | `draft-writes.test.ts` — stale revision preserves draft and journal absence |
| FS R1 S1 | `determinism.test.ts` — full lifecycle disk round-trip |
| FS R1 S2 | `determinism.test.ts` — `project.json` unchanged across all 9 methods |
| FS R2 S1 | `atomic-writer.test.ts` — interrupted write preserves prior or absent final bytes |
| FS R3 S1 | `approval.test.ts` — genuine second manifest write refused, bytes unchanged |
| FS R3 S2 | `abandon.test.ts` — fresh-key second abandonment preserves tombstone |
| FS R4 S1 | `concurrency.test.ts` — full mutation sequences serialize |
| FS R4 S2 | `lock.test.ts` — confirmed-dead same-host lock breaks immediately |
| FS R4 S3 | `lock.test.ts` — live lock is not broken |
| FS R5 S1 | `approval.test.ts` — reviewed-hash mismatch writes no version artifacts |
| FS R5 S2 | `approval.test.ts` — pre-swap crash leaves inactive orphan/open draft |
| FS R5 S3 | `approval.test.ts` — active swap is observable commit point |
| Recovery R1 S1 | `recover.test.ts` — direct clean recovery returns empty report |
| Recovery R1 S2 | `recover.test.ts` — U6–U9 committed replay windows converge |
| Recovery R1 S3 | `recover.test.ts` — repeated clean recovery creates no lock/probe |
| Recovery R2 S1 | `reconcile-walk.test.ts` and `approval.test.ts` — orphan reported/excluded |
| Recovery R2 S2 | `approval.test.ts` — later approval does not resurrect orphan |
| Recovery R3 S1 | `approval.test.ts` — post-swap replay closes and journals exactly once |
| Recovery R3 S2 | `approval.test.ts` — second replay performs no duplicate write |

## Design and implementation coherence

**PASS.** CodeGraph was present, current, and used before filesystem structural checks. Source inspection and tests confirm:

- D1/D1b–D1e: rooted committed-chain walk, total draft reconstruction, and replay windows are implemented in `reconcile.ts`.
- D2: direct-`wx` lock, positive-PID/hostname routing, filesystem age gate, backoff, and nonce release are implemented.
- D3/D4: the seven-member disk refusal union is port-owned; documented refusals are values and corruption remains adapter throws.
- D5/D5b: mutable rename, write-once hard-link exclusivity, fsync boundaries, and two-phase lock-free/locked recovery are implemented.
- D6/D6b: raw UTF-8 key hash, logical input hash builders, deterministic K1/K2 serialization, and six-outcome approval adoption are implemented.
- D7–D10: provenance-aware id validation, prototype-safe records, deterministic ordering, unreachable `project.json`, and bootstrap ordering are covered.
- Port has exactly 3 reads + 6 mutations, all type-only imports, and `recoverProject()` exists only on `FsBeaconStore`.
- Adapter import audit found **0** invalid imports: all are `node:*` or relative. `package.json` contains exactly `canonicalize@2.1.0`; package manifests have zero Slice-D diff.
- Protected Slice A–C paths have zero diff from `ca9e385`.

## Strict TDD compliance

`openspec/config.yaml` has `strict_tdd: true`. Global strict-TDD verify guidance was loaded.

| Check | Result | Details |
|---|---|---|
| TDD evidence reported | PASS | 14 `TDD Cycle Evidence` sections cover implementation units and U11 verification |
| Reported test files exist | PASS | 18/18 unique reported test paths exist |
| RED evidence | PASS | Historical RED observations are recorded per implementation unit; no-code confirmations and verification-only U11 are explicitly disclosed rather than fabricated |
| GREEN still true | PASS | 18 focused files / 144 tests and full 27 files / 270 tests pass now |
| Triangulation | PASS | Crash windows, replay/conflict variants, lock states, lifecycle methods, and 25 scenarios have distinct cases |
| Safety nets | PASS | Apply evidence records prior suites for modified files; current full suite remains green |

**TDD compliance: 6/6 checks passed.**

### Test layer distribution

| Layer | Tests | Files | Tools |
|---|---:|---:|---|
| Unit/structural | 28 | 5 | Vitest, TypeScript, ESLint, fast-check |
| Integration | 116 | 13 | Vitest with real `mkdtemp` filesystem and crash/lock seams |
| E2E | 0 | 0 | Not applicable |
| **Focused total** | **144** | **18** | |

No filesystem mocks, browser, HTTP, CSS, or implementation-detail UI assertions are involved.

### Assertion quality

No tautologies, ghost loops, smoke-only tests, CSS assertions, or mock-heavy files were found. Two non-blocking type-only no-throw assertions should be strengthened if those tests are revisited:

| File:line | Assertion | Finding | Severity |
|---|---|---|---|
| `tests/adapters/fs-beacon-store/reconcile-walk.test.ts:131` | `resolves.toBeDefined()` | Legal duplicate-`supersedes_version` case verifies only non-throw, not reconstructed values | WARNING |
| `tests/adapters/fs-beacon-store/reconcile-walk.test.ts:139` | `resolves.toBeDefined()` | Duplicate-`local_number` case verifies only non-throw, not reconstructed values | WARNING |

These are not scenario gaps: adjacent rooted-walk tests assert concrete committed/orphan/status values.

### Changed-file coverage

Command coverage remained green at 270/270. Weighted line coverage for executable changed production files is **92.93% (828/891)**; no executable changed file is below 80% line coverage. Configured threshold is 0.

| File | Line % | Branch % | Uncovered lines | Rating |
|---|---:|---:|---|---|
| `atomic-writer.ts` | 95.35 | 83.33 | 83, 100 | Excellent |
| `corruption.ts` | 100.00 | N/A | — | Excellent |
| `fs-beacon-store.ts` | 89.26 | 78.14 | 92, 101-102, 113, 160, 324, 362, 389, 422, 449, 457, 473, 482, 508, 511, 528, 536, 573, 576, 579, 593, 602, 634, 637, 683, 686, 700, 708, 720 | Acceptable |
| `journal.ts` | 95.45 | 93.33 | 123 | Excellent |
| `layout.ts` | 94.44 | 88.24 | 29, 68 | Acceptable |
| `lock.ts` | 84.62 | 67.57 | 34, 78, 85, 139, 169-170, 172, 193-194, 201-202, 206, 215-216, 218, 235 | Acceptable |
| `reconcile.ts` | 95.60 | 86.71 | 133, 176, 189, 224, 248, 407, 483, 488, 518, 549-550 | Excellent |
| `records.ts` | 100.00 | 100.00 | — | Excellent |
| `serialization.ts` | 98.74 | 92.52 | 29, 139 | Excellent |
| type-only ports / barrels | N/A | N/A | no executable lines | N/A |

### Quality metrics

- Linter: PASS, no errors; emitted only existing `eslint-plugin-boundaries` deprecation warnings.
- Type checker: PASS, no output.
- Build: PASS.

## Review workload and delivery boundary

- Forecast required chained PRs with `stacked-to-main`; first-parent history confirms sequential merges through U2/U4/U5/U6/U7b/U8b/U9b/U10.
- Apply evidence records bounded splits for oversized units. Every delivered slice is at or below 400 changed lines except U3.
- U3's 438 source/test lines (538 including evidence) have an explicit operator-approved `size:exception` with cap 550 in `apply-progress.md`.
- U11 changed only `tasks.md` and `apply-progress.md`; verification changed only this report.
- Target implementation surface from `ca9e385..HEAD`: **31 paths, 6,240 additions + 1 deletion = 6,241 changed lines** (13 production, 18 tests), delivered in review-bounded slices rather than one PR.
- `.github/ISSUE_TEMPLATE/feature.yml` is the only base-to-HEAD path outside the declared change surfaces. History assigns it to standalone commit `5a5e726 chore(github): add feature issue form`; it is unrelated inherited mainline history, not FsBeaconStore scope creep.

## Rollback proof

**PASS.** `ca9e385` is an ancestor. Read-only `git diff HEAD ca9e385` proves rollback deletes the ten fs-adapter source files and both new port files; `git show ca9e385:src/adapters/fs-beacon-store/index.ts` is `export {};`; the base ports barrel exports only `Hasher` and `JsonValue`; both new port paths are absent at the base. This independently resolves the informational native-review warning about rollback evidence.

## Commands and exact results

| Command | Result |
|---|---|
| `codegraph status` | exit 0; 77 files / 749 nodes / 3,306 edges; index up to date |
| `codegraph explore "FsBeaconStore beacon store implementation architecture dependencies tests"` | exit 0; current source/call-path evidence returned |
| `npx vitest run tests/contract/beacon-store/ tests/adapters/fs-beacon-store/ tests/architecture/boundaries.test.ts tests/domain/ports/beacon-store-refusals.test.ts` | exit 0; 18 files, 144 tests passed |
| `npm test` | exit 0; 27 files, 270 tests passed |
| `npm run test:watch -- --run` | exit 0; 27 files, 270 tests passed |
| `npm run build` | exit 0; `tsc -p tsconfig.build.json` |
| `npm run lint` | exit 0; no errors, boundaries deprecation warnings only |
| `npm run typecheck` | exit 0; `tsc --noEmit` |
| `npm test -- --coverage` | exit 0; 27 files / 270 tests; 92.41% statements, 84.30% branches, 99.44% functions, 92.74% lines overall |
| `git diff --exit-code ca9e385..HEAD -- src/domain/beacon/ src/domain/semantics/ src/domain/ports/hasher.ts src/domain/ports/json-value.ts src/adapters/hashing/` | exit 0; zero protected-path diff |
| dependency assertion (`Object.keys(dependencies)===1 && canonicalize==="2.1.0"`) | exit 0 |
| `git diff --exit-code ca9e385..HEAD -- package.json package-lock.json` | exit 0 |
| corrected Node adapter-import audit | exit 0; `invalid_imports=0` |
| `git diff --check` | exit 0 |

One non-authoritative shell helper for the import audit failed before correction:

```text
printf 'Adapter import specifiers:\n'; grep -RhoE 'from\s+["'"'][^"'"']+["'"']|import\s+["'"'][^"'"']+["'"']' src/adapters/fs-beacon-store --include='*.ts' | sed -E 's/.*["'"']([^"'"']+)["'"'].*/\1/' | sort -u; printf '\nInvalid adapter imports:\n'; bad=0; while IFS= read -r spec; do case "$spec" in node:*|./*|../*) ;; *) echo "$spec"; bad=1;; esac; done < <(grep -RhoE 'from\s+["'"'][^"'"']+["'"']|import\s+["'"'][^"'"']+["'"']' src/adapters/fs-beacon-store --include='*.ts' | sed -E 's/.*["'"']([^"'"']+)["'"'].*/\1/' | sort -u); echo "invalid_import_exit=$bad"; exit $bad
```

It exited 2 with a shell quoting syntax error; no product command failed. The corrected Node audit listed every import and returned `invalid_imports=0`.

`npm ci` was not rerun because the verify delegation authorizes only the report write; dependency integrity was instead checked from the existing lockfile/manifests and all required runners passed.

## Process and cleanup evidence

- After verification, `ps -C node` reported no Node/Vitest process.
- No `/tmp/pharos-*` or `/tmp/vitest-*` directory remained.
- Build/coverage outputs are ignored; tracked status remained limited to the pre-existing task/apply artifact changes plus this report.
- Parent attempt token `sha256:636f79a21ee6760dbae6e08c6aedcf7d491f5fb2920b2b774df089e412508e10` was not acquired, settled, reset, rescoped, or persisted by verify.

## Blockers and next step

**Exact blockers: none.** Warnings are the two narrow no-throw assertions and non-blocking boundaries deprecations. Verification is ready for **SDD sync**, then archive.
