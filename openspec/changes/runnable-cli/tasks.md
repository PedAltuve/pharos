# Tasks: Runnable CLI

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~350-450 (excludes generated `package-lock.json` and SDD artifacts) |
| 400-line budget risk | Medium |
| Chained PRs recommended | No |
| Suggested split | Single PR, 4 work-unit commits; fallback split at commit boundary 2/3 if actual diff exceeds 400 |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Medium

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Pin `commander`, regenerate lockfile | PR 1 | `npm ci` | N/A — no runtime code yet | Revert dependency entries in `package.json`/`package-lock.json` |
| 2 | `program.ts`/`index.ts` root CLI + source tests | PR 1 | `npx vitest run tests/cli/program.test.ts` | `node dist/cli/index.js --help` | Remove `program.ts`, restore `index.ts` placeholder, delete test file |
| 3 | Distributable manifest + packaging tests | PR 1 | `npx vitest run tests/cli/distribution.test.ts` | `npm pack --dry-run --json`, temp install `--help`/`--version` | Restore `private: true`, remove `bin`/`files`, delete test file |
| 4 | README truthful usage | PR 1 | N/A — docs only | N/A — docs only | Revert `README.md` hunk |

## Phase 1: Dependency Foundation

- [x] 1.1 `npm install --save-exact commander@14.0.1`; adds `commander` to `package.json` and regenerates `package-lock.json`.
- [x] 1.2 Confirm `npm ci` resolves the pinned dependency.

## Phase 2: Core CLI — TDD

- [x] 2.1 RED: add `tests/cli/program.test.ts` covering: injected `--version` output; real-loader version matches manifest version; `--help`/no-args identify `pharos`, no `Commands:`/product vocabulary; zero registered commands; `beacon` exits 2, stderr `unknown command 'beacon'`; bad option/excess operand exits 2. Run `npx vitest run tests/cli/program.test.ts`; confirm all fail.
- [x] 2.2 GREEN: add `src/cli/program.ts` exporting `loadPackageVersion`, `createProgram`, `runCli` — `createRequire` version load, `exitOverride()`, injected writers, internal unsupported-operand handling.
- [x] 2.3 GREEN: replace `src/cli/index.ts` placeholder with the shebang-first entry calling `runCli(process.argv)`, setting `process.exitCode`, catching non-`CommanderError` failures as `pharos: internal error` / status 10.
- [x] 2.4 Run `npx vitest run tests/cli/program.test.ts`; confirm all pass. Refactor for clarity only, no behavior change.

## Phase 3: Distribution & Packaging — TDD

- [x] 3.1 RED: add `tests/cli/distribution.test.ts` (one temp dir, `afterAll` cleanup) covering: clean build emits `dist/cli/index.js` with exact shebang; built entry runs `--help`/`--version`/`beacon` with correct streams/statuses; manifest has exactly five scripts, no `private`/lifecycle hooks, correct `type`/`engines`/`license`/`bin`/`files`/exact `commander` pin; `npm pack --dry-run --json --ignore-scripts` output has `package.json`/`README.md`/`LICENSE`/`dist/cli/index.js`, no source/test/OpenSpec/coverage path; offline `--ignore-scripts` install into a temp consumer runs the `pharos` shim `--help`/`--version`. Run the suite; confirm it fails.
- [x] 3.2 GREEN: update `package.json` — remove `private`, add `bin: {"pharos": "dist/cli/index.js"}` and `files: ["dist/", "README.md", "LICENSE"]`; keep scripts and the Commander pin unchanged.
- [x] 3.3 Run `npx vitest run tests/cli/distribution.test.ts`; confirm it passes end to end. If the cumulative diff nears 400 lines, split commit 3 (distribution tests + manifest) into a follow-up PR before merging.

## Phase 4: Documentation & Final Verification

- [x] 4.1 Update `README.md`: runnable bootstrap CLI, `npm ci`/`npm run build` before pack/install, `pharos --help`/`--version` as the complete surface, explicit no-product-workflow notice.
- [x] 4.2 Confirm `tests/architecture/boundaries.test.ts` (read-only) still passes; `src/cli/` imports only `commander` and repo `package.json`.
- [x] 4.3 Run the full gate: `npm ci`, `npm test`, `npm run build`, `npm run lint`, `npm run typecheck`; all must pass.

> **Review-budget decision resolved**: work units 1-3 reached 451 authored changed lines, over the 400-line budget. The maintainer selected a chained-PR split at work-unit boundary 2/3 with `stacked-to-main` topology. PR A (dependency pin + `program.ts`/`index.ts` + `program.test.ts`, ~266 lines) targets `master`; PR B (manifest `bin`/`files` + `distribution.test.ts` + README, ~215 lines) targets PR A's branch. Both slices are under budget. Phase 4 completed after the decision; the attempt ledger was reset under that maintainer scope decision and re-acquired for `runnable-cli-phase4-docs-and-gate`.
>
> Final gate: `npm ci` clean, `npm test` 29 files / 283 tests passed, `npm run build` exit 0, `npm run lint` exit 0, `npm run typecheck` exit 0. Documented README examples verified end to end: `npm pack` emits `pharos-0.0.0.tgz` and an offline `--ignore-scripts` install exposes a working `pharos` shim reporting version `0.0.0`.
