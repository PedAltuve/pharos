# Tasks: Project Foundation

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | ~298 (design estimate, 16 files) |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|---|
| 1 | Bootstrap manifest + config | PR 1 | `npm ci` | N/A — config only, no runtime yet | delete `package.json`, `package-lock.json`, `tsconfig*.json`, `vitest.config.ts` |
| 2 | Boundary rule + proof test | PR 1 | `npm test -- tests/architecture/boundaries.test.ts` | ESLint Node API run inside the test | delete `eslint.config*.js`, `tests/architecture/`, `tests/fixtures/` |
| 3 | Directory skeleton barrels | PR 1 | `npm run typecheck` | N/A — barrels have no runtime logic | delete `src/**` |
| 4 | VCS hygiene + formatting | PR 1 | `git check-ignore package-lock.json` (expect not-ignored) | N/A — git metadata only | revert `.gitignore`; delete `.prettierrc`/`.prettierignore` |
| 5 | `openspec/config.yaml` re-enablement | PR 1 | manual read of `openspec/config.yaml` | N/A — process config, not application runtime | revert `openspec/config.yaml` |

## Phase 1: Workspace Bootstrap and Script Contract
**Requirement**: Workspace Bootstrap and Script Contract

- [x] 1.1 Create `package.json`: name `pharos`, version `0.0.0`, `"private": true` (deliberate-temporary — removed by a future release change adding `bin`/`files` per technical-design §1), `type: module`, `engines.node >=20`, no lifecycle scripts, exactly five scripts: `test`, `test:watch`, `build`, `lint`, `typecheck`.
- [x] 1.2 Run `npm i -D --save-exact typescript @types/node vitest @vitest/coverage-v8 eslint @eslint/js typescript-eslint eslint-plugin-boundaries prettier`; commit `package-lock.json`.
- [x] 1.3 Create `tsconfig.json` — strict, NodeNext, `verbatimModuleSyntax`, `noEmit`.
- [x] 1.4 Create `tsconfig.build.json` extending `tsconfig.json` (`noEmit: false`, `declaration`, `rootDir: src`, `outDir: dist`).
- [x] 1.5 Create `vitest.config.ts` (node env, `tests/**/*.test.ts`, v8 coverage, threshold 0).

## Phase 2: Hexagonal Dependency Rule Enforcement — TDD anchor
**Requirement**: Hexagonal Dependency Rule Enforcement

- [x] 2.1 (parallel) Create fixtures: `tests/fixtures/boundaries/src/domain/uses-node-fs.ts` (imports `node:fs`), `tests/fixtures/boundaries/src/application/uses-adapters.ts` (imports `src/adapters/**`), `tests/fixtures/boundaries/src/adapters/fs-beacon-store/index.ts` (allowed-import target for the previous fixture).
- [x] 2.2 RED: write `tests/architecture/boundaries.test.ts` — each fixture must yield >=1 boundaries error; accept either `no-restricted-imports` OR `boundaries/external` for the domain/node:fs case, and `boundaries/element-types` for the application/adapters case. Run `npm test`, confirm it FAILS (no base config exists yet).
- [x] 2.3 GREEN: create `eslint.config.base.js` (~75 lines — largest single authored file) with `boundaries/elements`, the element-types allow matrix, external-import ban, and `no-restricted-imports`. Run `npm test`, confirm it PASSES. **Deviation**: installed `eslint-plugin-boundaries@7.2.0` requires element patterns without a trailing `/*` (e.g. `**/src/domain/**`, not `**/src/domain/**/*`) and drops the deprecated `mode: "full"` option — the design snippet's pattern shape silently misclassified files placed directly in a layer folder (not nested one level deeper) as `isUnknown`, producing 0 lint messages. Confirmed via direct `@boundaries/elements` matcher probing. Kept the legacy `boundaries/element-types`/`boundaries/external` rule names (deprecated but functional, emits build-time deprecation warnings on `npm test`/`npm run lint`) to satisfy task 2.2's literal ruleId acceptance; a future toolchain change should migrate to `boundaries/dependencies` with `policies`.
- [x] 2.4 Create `eslint.config.js` = `[...base, { ignores: ["dist/**", "coverage/**", "tests/fixtures/**"] }]`.
- [x] 2.5 Design-risk guard: comment out the boundaries rule in `eslint.config.base.js`, run `npm test`, confirm the proof test FAILS; restore the rule, run `npm test` again, confirm it PASSES. Both runs confirmed.

## Phase 3: Directory Skeleton
**Requirement**: Directory Skeleton Matches Design

- [x] 3.1 Create 13 placeholder barrels (`export {};` only; compare against `docs/technical-design-v1.md` §2, read-only): `src/domain/{beacon,semantics,verification,evidence,staleness,ports}/index.ts`, `src/application/index.ts`, `src/adapters/{fs-beacon-store,fs-evidence-store,playwright,engram-discovery}/index.ts`, `src/cli/index.ts`, `src/shared/index.ts`. **Note**: fixed 5 pre-existing `tsc --noEmit` errors in `tests/architecture/boundaries.test.ts` surfaced once `src/` existed and typecheck ran against the full include set — added a `@ts-expect-error` for the untyped JS config import and a defined-check for `noUncheckedIndexedAccess` on the ESLint results array.

## Phase 4: Version Control Hygiene and Formatting
**Requirement**: Version Control Hygiene

- [x] 4.1 Update `.gitignore`: add `node_modules/`, `dist/`, `coverage/`, `*.tsbuildinfo`, recommended `.codegraph/`; never add `package-lock.json`.
- [x] 4.2 Create `.prettierrc`, `.prettierignore`.
- [x] 4.3 Verify: `git check-ignore package-lock.json` reports NOT ignored (exit 1, confirmed); `git status` shows `node_modules/` absent from untracked output (ignored); `dist/`/`coverage/` re-verified in Phase 5.1 once `npm run build`/coverage actually produce those directories.

## Phase 5: Verification

- [x] 5.1 Fresh-clone bootstrap: `npm ci && npm test && npm run build && npm run lint && npm run typecheck`; confirm every command exits `0`. All five confirmed exit 0. `dist/` produced by build confirmed ignored by `git status`.
- [x] 5.2 Real-src failure mode (spec scenario, not just the programmatic fixture proof): temporarily add `import { readFileSync } from "node:fs";` to `src/domain/beacon/index.ts`, run `npm run lint`, confirm non-zero exit reporting a boundaries/`no-restricted-imports` violation; revert the import, run `npm run lint` again, confirm exit `0`. Confirmed: exit 1 with both `no-restricted-imports` and `boundaries/external` violations reported; reverted, exit 0.

## Phase 6: Strict TDD Re-enablement
**Requirement**: Strict TDD Re-enablement

- [x] 6.1 Edit `openspec/config.yaml`: `strict_tdd: true`; rewrite `strict_tdd_note` to record that `project-foundation` landed the workspace test command; `projects: [{ name: pharos, path: ".", language: typescript, test_command: "npm test", build_command: "npm run build" }]`; `rules.apply.tdd: true`, `rules.apply.test_command: "npm test"`; `rules.verify.test_command: "npm test"`, `rules.verify.build_command: "npm run build"`; update the `context` block's `Testing:` line to Vitest + `@vitest/coverage-v8`.

## Orchestrator Handoff (not an agent task)

- Update Engram `sdd/pharos/testing-capabilities` after Phase 6 lands — this is the orchestrator's responsibility, not `sdd-apply`.
