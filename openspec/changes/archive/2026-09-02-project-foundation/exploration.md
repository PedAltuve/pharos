# Exploration: project-foundation

Bootstrap the greenfield Pharos repository into a buildable, testable TypeScript project enforcing the approved hexagonal architecture, so every subsequent change can follow strict TDD.

> Engram counterpart: topic `sdd/project-foundation/explore` (observation id 2008). This file mirrors that content per the hybrid artifact-store convention.

## Current State

- Greenfield repo: no `package.json`, no `src/`, no `node_modules`. Only `PHAROS.md`, `docs/`, an `openspec/` skeleton (`config.yaml`, `changes/archive/.gitkeep`), `.atl/`, `.codegraph/`, and `.gitignore` (currently ignores only `.atl/`).
- Approved technical design (`docs/technical-design-v1.md` §1, §2, §12) fixes: Node >= 20 LTS, TypeScript strict ESM, single npm package `pharos` with committed `package-lock.json`; hexagonal layout `src/{domain,application,adapters,cli,shared}`; dependency rule `cli -> application -> domain`, domain imports nothing outward (no Node `fs`, no Playwright types); testing strategy calls for pure domain unit tests, property-based tests for semantic projection, a shared port contract-test suite, and CLI integration tests over JSON envelopes.
- Prior sdd-init decision gate (`sdd-init/pharos`, `sdd/pharos/testing-capabilities`): zero projects discovered -> `strict_tdd` forced to `false` (fails closed) even though the user-level preference is `true`. Re-enabling `strict_tdd` requires this change to establish `package.json` plus a real workspace-level `test_command`.
- Unit test runner is explicitly an open decision the technical design deferred; must be settled here.

## Affected Areas (files this change will create — none exist yet)

- `package.json`, `package-lock.json` (committed, no lifecycle scripts) — root project manifest and pinned deps.
- `tsconfig.json` (+ a `tsconfig.build.json` for emit) — strict ESM Node 20 compiler config.
- `eslint.config.js` (flat config) + `.prettierrc` — lint/format, and the seat for the dependency-rule plugin.
- `vitest.config.ts` — test runner config.
- `src/domain/{beacon,semantics,verification,evidence,staleness,ports}/index.ts` — placeholder barrels only, pure layer.
- `src/application/index.ts`, `src/adapters/{fs-beacon-store,fs-evidence-store,playwright,engram-discovery}/index.ts`, `src/cli/index.ts`, `src/shared/index.ts` — placeholder barrels only.
- `.gitignore` — needs `node_modules/`, `dist/`, coverage output added (must NOT ignore `package-lock.json`).

## Approaches

### 1. Test runner: Vitest vs node:test

- **Vitest** — Pros: zero-config strict ESM/TS via esbuild transform, fast import-graph-aware watch mode (important for strict TDD's red-green-refactor loop), built-in coverage (v8) and snapshots, works with fast-check with no special integration (fast-check is a plain assertion library, runner-agnostic). Cons: pulls in Vite/esbuild as devDependencies; does not type-check by default (needs a separate `tsc --noEmit`, which the scripts contract requires anyway). Effort: Low.
- **node:test** — Pros: ships in Node itself, no runner devDependency. Cons: Node 20 (the design's floor) has no native TS type-stripping (that landed in Node 22.6+/23) — running TS tests on Node 20 still needs a loader (`tsx`/`ts-node`), which erases the "zero dependency" advantage; weaker watch mode (reruns broadly, not import-graph-scoped); no built-in snapshot/coverage ergonomics comparable to Vitest. Effort: Low but weaker DX.
- fast-check compatibility is identical under both (it has zero test-runner coupling), so it is not a differentiator.
- **Recommendation: Vitest** (+ `@vitest/coverage-v8`). On a Node 20 floor, node:test's main selling point does not materialize, while Vitest gives the fastest, most zero-config strict-TDD loop.

### 2. Hexagonal dependency-rule enforcement: eslint-plugin-boundaries vs dependency-cruiser vs tsconfig project references

- **eslint-plugin-boundaries** — Pros: in-editor, pre-commit feedback (fails before CI); one flat-config file expresses both layer-to-layer direction (`cli -> application -> domain`) and banning `node:fs`/`playwright` imports from `domain` via `element-types`/`disallow` rules. Cons: one more eslint plugin; boundary `type` patterns need care. Effort: Low.
- **dependency-cruiser** — Pros: richer analysis (orphan modules, circular deps, graph visualization). Cons: feedback is post-hoc via a separate CLI/script, not inline; another config surface on top of eslint, which is still needed for general TS lint rules anyway. Effort: Low-Medium, partly redundant.
- **tsconfig project references** — Pros: zero extra dependency, strongest guarantee (compile error) for cross-package import direction. Cons: does not by itself block stdlib/npm imports like `node:fs` inside domain (references only gate package-to-package imports), so eslint `no-restricted-imports` would still be needed for that half of the rule; heavier setup more suited to a real multi-package monorepo than this single npm package. Effort: Medium, and still incomplete alone.
- **Recommendation: eslint-plugin-boundaries** layered on a typescript-eslint flat config, because it is the only single tool that covers both halves of the dependency rule (layer direction AND banning Node/Playwright imports from domain) with immediate feedback. dependency-cruiser can be added later if real orphan/cycle problems appear.

### 3. Toolchain minimalism

- tsconfig: `target: ES2022`, `module`/`moduleResolution: NodeNext`, `strict: true`, `verbatimModuleSyntax: true`, `declaration: true`, `outDir: dist`.
- Build — tsc-only vs tsup: this package is ESM-only (no dual CJS/ESM need, which is tsup's main advantage) and is a CLI, not a bundle-shipped library, so **recommend tsc-only** (`tsc -p tsconfig.build.json`); revisit tsup only if build speed becomes a real problem.
- Lint/format — eslint+prettier vs biome: biome has no plugin API equivalent to eslint-plugin-boundaries, so choosing biome would still require installing ESLint just for the architecture rule — forfeiting the "one tool" benefit and leaving two config surfaces. **Recommend eslint (flat config) + typescript-eslint + eslint-plugin-boundaries + prettier**, since ESLint is already required by decision 2.

### 4. Directory skeleton

Exact `technical-design-v1.md` §2 layout, barrel-only placeholder files (e.g. `export {};` or a documented empty marker), no domain/application/adapter/cli logic. No root `src/index.ts` needed yet (entry point is `src/cli/index.ts`, wired to `bin` in a later change). Effort: Low.

### 5. npm scripts contract

| Script | Command |
|---|---|
| `test` | `vitest run` |
| `test:watch` | `vitest` |
| `build` | `tsc -p tsconfig.build.json` |
| `lint` | `eslint .` |
| `typecheck` | `tsc --noEmit` |

These exact names/commands are what `openspec/config.yaml` apply/verify `test_command`/`build_command` must reference to re-enable `strict_tdd: true` per the existing `sdd/pharos/testing-capabilities` record.

## Recommendation

Vitest for the test runner (Node 20 floor removes node:test's zero-dependency advantage; fast-check is runner-agnostic either way). eslint-plugin-boundaries for the hexagonal dependency rule (only tool covering both layer-direction and Node/Playwright-import bans with inline feedback). tsc-only build + eslint/typescript-eslint/prettier (not biome, since biome cannot replace the boundaries plugin). Exact §2 directory skeleton with placeholder barrels only. The five npm scripts above as the fixed contract for later SDD phases.

## Out of Scope

Any domain type, port interface, or business logic; CLI commands; Playwright integration; CI pipelines; publishing config.

## Risks

- If the Node floor later moves to 22.6+, node:test's native TS-stripping becomes viable and the runner choice could be revisited — not a blocker now.
- eslint-plugin-boundaries config is easy to get subtly wrong (e.g. allowing `application` to import `adapters` by omission); sdd-tasks should include a deliberately-wrong-import fixture to prove the rule actually fires, otherwise enforcement is unverified.
- `.gitignore` must gain `node_modules/`, `dist/`, coverage output, but `package-lock.json` must stay committed per design §1 — an implementer must not blanket-ignore it.
- Vitest is the only non-Node-builtin devDependency chain (`vitest` -> `vite` -> esbuild) introduced at this stage; acceptable since these are devDependencies only, never shipped in the published package.
- This change must ship zero domain/application/adapter/cli logic; sdd-tasks should keep every task scoped to config/skeleton/scripts only.

## Ready for Proposal

Yes. The one item sdd-init flagged as unresolved (test runner) is now resolved with rationale (Vitest), the dependency-rule enforcement mechanism is resolved (eslint-plugin-boundaries), and toolchain/skeleton/scripts are fully specified. No remaining product-level ambiguity, only now-settled implementation decisions.
