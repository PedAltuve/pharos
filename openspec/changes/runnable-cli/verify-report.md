```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:f2fd4bd7eaaf463faa257abf08b8089e1ad5af9e6319d9500e49be02652a685f
verdict: pass_with_warnings
blockers: 0
critical_findings: 0
requirements: 9/9
scenarios: 10/10
test_command: npm test
test_exit_code: 0
test_output_hash: sha256:1ab2771c3646500f38ffa62df348cd8d4417b155e29b49f58ad13d6a79eb90b0
build_command: npm run build
build_exit_code: 0
build_output_hash: sha256:9a7b581687e6658fe0477421daba6a5a0f4e5ae253c2c562a298e3e8dc2eb7e9
```


## Verification Report — runnable-cli

### Change

`runnable-cli` — first runnable/distributable `pharos` CLI boundary (root `--help`/`--version`/unknown-command handling only, no product commands).

### Mode

Full spec-driven verification: proposal, spec, design, and tasks all present and read. Apply-progress read from Engram (`sdd/runnable-cli/apply-progress`, observation #2477); note on staleness below.

### Task Completeness

All 12 tasks in `openspec/changes/runnable-cli/tasks.md` are checked `[x]` (Phase 1: 1.1–1.2; Phase 2: 2.1–2.4; Phase 3: 3.1–3.3; Phase 4: 4.1–4.3). Tasks.md itself documents a "Review-budget decision resolved" note recording a maintainer-selected chained-PR split (stacked-to-main) and states Phase 4 completed after that decision.

**Finding (informational, non-blocking):** The Engram `apply-progress` artifact (observation #2477) is stale — it was written mid-implementation and states "Phase 4 ... NOT started" and "apply STOPPED". The actual worktree state (tasks.md, source, tests, passing full gate) shows Phase 4 is complete and matches the orchestrator's session facts (12/12 tasks, `allComplete: true`). Recommend the orchestrator update/overwrite the Engram apply-progress topic with a final-state save so future readers are not misled by the stale mid-flight snapshot.

### Build, Test, and Gate Evidence (independently re-run, not assumed)

| Command | Result |
|---|---|
| `npm ci` | exit 0, 184 packages installed, 0 vulnerabilities |
| `npm test` | exit 0 — 29 files / 283 tests passed |
| `npm run build` | exit 0 |
| `npm run lint` | exit 0 (only pre-existing `eslint-plugin-boundaries` v6→v7 migration warnings, unrelated to this change) |
| `npm run typecheck` | exit 0 |
| `npx vitest run tests/architecture/boundaries.test.ts` | exit 0 — 4/4 passed |

### Runtime CLI Evidence (independently executed against built `dist/cli/index.js`)

| Check | Result |
|---|---|
| `head -c 21 dist/cli/index.js` | exact bytes `#!/usr/bin/env node\n`, immediately followed by code (no blank line, no BOM) |
| `node dist/cli/index.js --version` | stdout `0.0.0\n`, exit 0 — matches `package.json` version |
| `node dist/cli/index.js --help` | usage block identifying `pharos`, lists `-V, --version` / `-h, --help` only, no `Commands:` section, no forbidden product vocabulary | 
| `node dist/cli/index.js beacon` | stderr `unknown command 'beacon'`, exit 2 |
| `rg "^import" src/cli/*.ts` | `program.ts` imports only `node:module`, `commander`; `index.ts` imports only `./program.js` — matches hexagonal boundary constraint (point 4 of the verification focus) |

### Packaging Evidence (independently executed, not assumed)

| Check | Result |
|---|---|
| `npm pack --dry-run --json --ignore-scripts` (parsed programmatically) | 171 entries; every entry is `package.json`, `README.md`, `LICENSE`, or under `dist/` — no `src/`, `tests/`, `openspec/`, coverage, or tool-config path present |
| Real `npm pack` + offline `--ignore-scripts` install into a fresh temp consumer | tarball `pharos-0.0.0.tgz`; `node_modules/.bin/pharos --version` → `0.0.0` exit 0; `--help` → correct usage output exit 0 |

### Spec Compliance Matrix

9 requirements / 10 scenarios counted from `openspec/changes/runnable-cli/specs/cli/spec.md`.

| Requirement | Scenario | Status | Evidence |
|---|---|---|---|
| Runnable root executable | Installed package runs the root executable | PASS | `tests/cli/distribution.test.ts` "installs the packed archive and runs the installed executable" (passing) + independent real pack/install re-run above |
| Root help is truthful and minimal | User requests help | PASS | `tests/cli/program.test.ts` `--help` test (forbidden-vocabulary + no-`Commands:` assertions) + `tests/cli/distribution.test.ts` built-entry `--help` test + independent CLI run above |
| Version has one source of truth | User requests version | PASS | `tests/cli/program.test.ts` "loads the real version from the installed package manifest" + distribution/installed-shim version tests + independent CLI run above |
| Unknown command behavior | User invokes a product command before it exists | PASS | `tests/cli/program.test.ts` "rejects 'beacon'" + distribution built-entry `beacon` test + independent CLI run above |
| Distributable package contents and installability | Packed archive contains the executable target | PASS | `tests/cli/distribution.test.ts` "packs a dry-run archive..." + independent programmatic pack-JSON parse above |
| Distributable package contents and installability | Packed package is installable | PASS | `tests/cli/distribution.test.ts` "installs the packed archive..." + independent real pack/install re-run above |
| Runtime and toolchain contract is preserved | Manifest and lockfile are reproducible | PASS | `npm ci` re-run (exit 0, resolves pinned `commander@14.0.1`) + `tests/cli/distribution.test.ts` manifest-contract test |
| Exact script surface and no lifecycle hooks | Script contract is inspected | PASS | `tests/cli/distribution.test.ts` "declares the exact publishable manifest contract" + manual `package.json` read (exactly 5 scripts, no lifecycle hooks, no `main`/`exports`) |
| Documentation states the implemented boundary accurately | Developer follows documented usage | PASS (see WARNING) | No repo-owned automated test executes README's documented commands. I manually followed every README example verbatim during this verification (`npm ci && npm run build`; `node dist/cli/index.js --help`/`--version`; `npm pack` + offline install + `pharos --version`) and every example matched its documented claim exactly. Design.md's testing strategy scopes automated coverage to `program.test.ts`/`distribution.test.ts` only and does not plan a README-execution test — this appears to be a deliberate design choice, not an implementation gap. |
| Product commands remain absent | Root command catalogue is checked | PASS | `tests/cli/program.test.ts` "registers zero subcommands" + independent `--help`/`beacon` runs confirm only `-V`/`-h` options exist |

### Design Coherence

| Design decision | Status | Evidence |
|---|---|---|
| `createRequire(import.meta.url)` version loading, single source of truth | Match | `src/cli/program.ts:1,13,33-46` |
| `exitOverride()` | Match | `src/cli/program.ts:64` |
| Injected writers (`writeOut`/`writeErr`) via `configureOutput` | Match | `src/cli/program.ts:49-50,59-63` |
| Shebang is the first bytes of `dist/cli/index.js` | Match | `od -c` byte check: `#!/usr/bin/env node\n` exact, no BOM |
| Exact `commander@14.0.1` pin in `dependencies` | Match | `package.json` dependencies block |
| `bin`/`files` exactly as designed | Match | `bin: {"pharos": "dist/cli/index.js"}`, `files: ["dist/", "README.md", "LICENSE"]` — byte-identical to design.md §5 |
| Exactly five scripts, no lifecycle hooks | Match | `package.json` scripts block; `distribution.test.ts` asserts absence of `prepare`/`prepack`/`postpack`/`prepublish`/`postinstall` |
| No `main`/`exports` | Match | Absent from `package.json` |
| `runCli` catches only `CommanderError`, non-Commander errors rethrown to `index.ts`'s own catch | Match | `src/cli/program.ts:86-94`, `src/cli/index.ts:4-9` |
| Unsupported input handled as internal root operand, not a fake subcommand | Match | `src/cli/program.ts:65-75` |

No design deviations found.

### Chained-PR Split Viability (verification focus point 5)

Planned split per `tasks.md`: PR A = commander pin + `src/cli/program.ts` + `src/cli/index.ts` + `tests/cli/program.test.ts` (targets `master`); PR B = manifest `bin`/`files` + `tests/cli/distribution.test.ts` + README (targets PR A's branch), `stacked-to-main` topology.

**I independently built an isolated scratch tree reproducing exactly the PR A end state** (package.json with `private: true` retained, no `bin`/`files`, only `commander@14.0.1` added to `dependencies`; `program.ts`, `index.ts`, `program.test.ts` present; `distribution.test.ts` absent) and ran the full gate against it:

| Command (PR-A-only scratch tree) | Result |
|---|---|
| `npm ci` | exit 0 |
| `npm test` | exit 0 — 28 files / 278 tests passed (283 − 5 `distribution.test.ts` tests, as expected) |
| `npm run build` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |
| `node dist/cli/index.js --version` / `beacon` | `0.0.0` exit 0 / `unknown command 'beacon'` exit 2 |

**PR A stands on its own and is fully green**, including with `package.json` still carrying `private: true` and no `bin`/`files` — confirmed directly, not assumed.

Line counts (authored, additions+deletions, excluding `package-lock.json` and OpenSpec):

- PR A: `src/cli/program.ts` (95 new) + `tests/cli/program.test.ts` (157 new) + `src/cli/index.ts` diff (9 ins/1 del) + `package.json` commander-only line (1 ins) ≈ **263 lines** — under the 400-line budget.
- PR B: `tests/cli/distribution.test.ts` (184 new) + `package.json` remaining diff (`private` removal + `bin`/`files`, ≈7 lines) + `README.md` diff (31 ins/1 del) ≈ **223 lines** — under the 400-line budget.
- Total authored across both slices ≈ 486 lines, consistent with the orchestrator's ~481 estimate and with `tasks.md`'s recorded 451-line pre-split overage; splitting at this boundary is necessary (single-PR would exceed budget) and sufficient (both slices clear it independently).

Both slices are independently deliverable, independently green, and each stay under the 400-line review budget. No further slicing is required.

### Issues

**CRITICAL**: None.

**WARNING**:
1. No automated test executes the README's documented usage examples; documentation accuracy currently relies on manual verification (performed successfully during this phase) rather than a regression-guarded test. A future change could silently invalidate a README claim without CI catching it. This matches design.md's explicit test-file scope (`program.test.ts`, `distribution.test.ts` only), so it is not a deviation from the approved design — flagging it as a residual documentation-drift risk for future changes.
2. The Engram `apply-progress` artifact (#2477) is stale relative to the actual completed Phase 4 state; recommend the orchestrator refresh it so future sessions do not read a mid-flight snapshot as current.

**SUGGESTION**: None.

### Verdict

**PASS WITH WARNINGS** — every spec requirement and scenario is satisfied by real, independently re-executed runtime evidence; no design deviation found; all 12 tasks are genuinely complete; the planned chained-PR split (PR A / PR B) is verified viable, with PR A independently confirmed to stand alone and pass its full gate, and both slices confirmed under the 400-line budget. The two WARNINGs above are non-blocking process/documentation-drift notes, not implementation defects.
