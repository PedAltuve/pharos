# Design: Project Foundation

> Engram counterpart: topic `sdd/project-foundation/design` (hybrid store).

## Technical Approach

Bootstrap a single ESM npm package `pharos` whose toolchain *is* the architecture enforcement. Four config files carry the whole change: `tsconfig*.json` (strict NodeNext type safety), `eslint.config.*` (hexagonal dependency rule from `docs/technical-design-v1.md` §2, machine-enforced), `vitest.config.ts` (the `test_command` that unblocks `strict_tdd`), and `package.json` (the five-script contract). `src/` is 13 one-line barrels. The only real code shipped is a Vitest test that lints deliberately-wrong fixtures and asserts the boundary rule fires — it proves the linter, the runner, and the rule in one artifact.

## Architecture Decisions

### Decision: Exact devDependency pinning

| Option | Tradeoff |
|---|---|
| Caret ranges | Manifest drifts on `npm install`; lint/compiler output that gates strict TDD can change without a commit |
| **Exact versions (`--save-exact`)** | Toolchain bumps are explicit, reviewable commits; cost is manual updates (Renovate later) |

**Choice**: exact, no range prefix, on every devDependency. Floors the implementer must satisfy at bootstrap: `eslint >=9` (flat config required), `typescript >=5.5`, `vitest >=2`. Resolved versions come from `npm i -D --save-exact` at implementation time — do not invent version numbers.

**devDependencies**: `typescript`, `@types/node`, `vitest`, `@vitest/coverage-v8`, `eslint`, `@eslint/js`, `typescript-eslint`, `eslint-plugin-boundaries`, `prettier`. No `eslint-config-prettier` (ESLint 9 + typescript-eslint ship no formatting rules, so there is no conflict to disable). No runtime `dependencies` yet.

### Decision: `cli` MAY import `adapters`

The spec restricts only `domain` (no `node:*`, Playwright, `adapters`, `cli`) and `application` (no `adapters`, `cli`). §2 places the composition root **inside `cli/`**, wiring adapters into ports — so `cli -> adapters` is required, not a leak. Forbidding it would make §2 unimplementable. No spec scenario changes.

### Decision: `shared` is a pure leaf, banned from external imports like `domain`

`shared` is importable by every layer including `domain`, and imports nothing internal. Because `domain` depends on it, `shared` inherits `domain`'s purity: the same external/`node:*` ban applies. **Consequence**: SHA-256 (§1) cannot use `node:crypto` from `shared`; it must land as a `Hasher` port in `domain/ports` with an adapter implementation. Alternative rejected: letting `shared` use builtins, which smuggles Node APIs into `domain` transitively.

### Decision: non-type-checked typescript-eslint

`tseslint.configs.recommended`, not `recommendedTypeChecked`. Type-aware linting duplicates `npm run typecheck` and requires every linted file to sit in a tsconfig project — which the proof fixtures deliberately do not. Revisit if a type-aware rule becomes necessary.

### Decision: tests live in `tests/`, not colocated

§12 requires one shared port contract-test suite reused across adapter implementations, which cannot be colocated by construction. Colocated `*.test.ts` would also add files to `src/` that §2 does not list, breaking the spec scenario "skeleton matches design exactly". `tests/` mirrors the layer names.

### Decision: proof fixtures linted via the ESLint Node API

The fixture tree mirrors `src/` under `tests/fixtures/boundaries/src/**`, so element patterns are written `**/src/<layer>/**` and classify both trees identically. `eslint.config.js` globally ignores `tests/fixtures/**` (keeping `npm run lint` green); the test imports the **un-ignored** shared array from `eslint.config.base.js` and lints the fixtures programmatically. Rejected: a child-process `eslint --no-ignore` run (slower, and introduces a subprocess boundary this change otherwise does not have).

## File Contents

**`package.json`** — `"name": "pharos"`, `"version": "0.0.0"`, `"private": true`, `"type": "module"`, `"engines": { "node": ">=20" }`, no `bin`, **no lifecycle scripts**.

| Script | Command |
|---|---|
| `test` | `vitest run` |
| `test:watch` | `vitest` |
| `build` | `tsc -p tsconfig.build.json` |
| `lint` | `eslint .` |
| `typecheck` | `tsc --noEmit` |

Exactly five, per spec — no `format` script; Prettier runs from the editor or `npx prettier --write .`.

**`tsconfig.json`** (typecheck + editor; covers `src`, `tests`, `vitest.config.ts`):

```jsonc
{
  "compilerOptions": {
    "target": "ES2022", "lib": ["ES2022"], "types": ["node"],
    "module": "NodeNext", "moduleResolution": "NodeNext",
    "strict": true, "noUncheckedIndexedAccess": true, "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true, "verbatimModuleSyntax": true,
    "isolatedModules": true, "esModuleInterop": true, "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "noEmit": true
  },
  "include": ["src/**/*.ts", "tests/**/*.ts", "vitest.config.ts"],
  "exclude": ["dist", "node_modules", "tests/fixtures"]
}
```

**`tsconfig.build.json`** — `declaration` is deliberately absent from the base so `tsc --noEmit` never collides with it:

```jsonc
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false, "declaration": true, "declarationMap": true,
    "sourceMap": true, "rootDir": "src", "outDir": "dist"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["tests", "**/*.test.ts"]
}
```

**`vitest.config.ts`**:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      reportsDirectory: "coverage",
      include: ["src/**/*.ts"],
    },
  },
});
```

No coverage thresholds: `src/` is empty barrels, so any threshold > 0 fails. Matches `coverage_threshold: 0`.

**`eslint.config.base.js`** — shared array; `eslint.config.js` is `[...base, { ignores: ["dist/**", "coverage/**", "tests/fixtures/**"] }]`.

```js
settings: {
  "boundaries/elements": [
    { type: "shared",      mode: "full", pattern: "**/src/shared/**/*" },
    { type: "domain",      mode: "full", pattern: "**/src/domain/**/*" },
    { type: "application", mode: "full", pattern: "**/src/application/**/*" },
    { type: "adapters",    mode: "full", pattern: "**/src/adapters/**/*" },
    { type: "cli",         mode: "full", pattern: "**/src/cli/**/*" },
  ],
}
```

Allowed-dependency matrix (`boundaries/element-types`, `default: "disallow"`):

| from | allow |
|---|---|
| `cli` | `cli`, `application`, `adapters`, `domain`, `shared` |
| `application` | `application`, `domain`, `shared` |
| `adapters` | `adapters`, `domain`, `shared` |
| `domain` | `domain`, `shared` |
| `shared` | `shared` |

External-import ban — two rules, because `boundaries/external` may treat `node:*` builtins as out of scope:

```js
"boundaries/external": ["error", { default: "allow",
  rules: [{ from: ["domain", "shared"], disallow: ["*"] }] }],
// plus, scoped to **/src/{domain,shared}/**/*.ts:
"no-restricted-imports": ["error", { patterns: [{ group: ["node:*"],
  message: "domain/shared must stay pure; put Node APIs behind a domain port." }] }],
```

`boundaries/external` covers `playwright` and every npm package; `no-restricted-imports` deterministically covers `node:fs` and every other builtin.

**Barrels** — every `src/**/index.ts` is exactly `export {};` and nothing else. 13 files: `domain/{beacon,semantics,verification,evidence,staleness,ports}`, `application`, `adapters/{fs-beacon-store,fs-evidence-store,playwright,engram-discovery}`, `cli`, `shared`. No container-level `domain/index.ts` or `adapters/index.ts`.

**`.gitignore`** additions: `node_modules/`, `dist/`, `coverage/`, `*.tsbuildinfo`. Recommended: `.codegraph/` (local index). **Never** add `package-lock.json`.

**`openspec/config.yaml`** edits: `strict_tdd: true`; rewrite `strict_tdd_note` to record that `project-foundation` landed the workspace test command; `projects: [{ name: pharos, path: ".", language: typescript, test_command: "npm test", build_command: "npm run build" }]`; `rules.apply.tdd: true`; `rules.apply.test_command: "npm test"`; `rules.verify.test_command: "npm test"`; `rules.verify.build_command: "npm run build"`; `coverage_threshold: 0` (unchanged); update the `context` block's `Testing:` line to Vitest + `@vitest/coverage-v8`.

## Data Flow

```
npm run lint ──> eslint.config.js ──> [base config + ignore tests/fixtures] ──> src/**  (must pass)
npm test     ──> vitest ──> tests/architecture/boundaries.test.ts
                              │
                              └─> ESLint Node API(baseConfig = eslint.config.base.js)
                                    └─> tests/fixtures/boundaries/src/** (must report errors)
```

## File Changes

| File | Action | Authored lines (est.) |
|---|---|---|
| `package.json` | Create | 35 |
| `package-lock.json` | Create | *generated — excluded* |
| `tsconfig.json` | Create | 30 |
| `tsconfig.build.json` | Create | 15 |
| `vitest.config.ts` | Create | 18 |
| `eslint.config.base.js` | Create | 75 |
| `eslint.config.js` | Create | 10 |
| `.prettierrc` | Create | 7 |
| `.prettierignore` | Create | 5 |
| `src/**/index.ts` (13 barrels) | Create | 13 |
| `tests/architecture/boundaries.test.ts` | Create | 45 |
| `tests/fixtures/boundaries/src/domain/uses-node-fs.ts` | Create | 5 |
| `tests/fixtures/boundaries/src/application/uses-adapters.ts` | Create | 6 |
| `tests/fixtures/boundaries/src/adapters/fs-beacon-store/index.ts` | Create | 3 |
| `.gitignore` | Modify | 6 |
| `openspec/config.yaml` | Modify | 25 |
| | **Total** | **~298** |

Under the 400-line budget. **Stated assumption**: `package-lock.json` is generated, not authored, and is excluded from review-line accounting while remaining committed and part of snapshot identity. SDD process artifacts under `openspec/changes/project-foundation/` are likewise treated as process documents, not reviewed source.

## Interfaces / Contracts

The only authored contract is the proof test:

```ts
// tests/architecture/boundaries.test.ts
const eslint = new ESLint({ overrideConfigFile: true, baseConfig, cwd: repoRoot });
// each fixture MUST produce >= 1 error from the enforced-boundary rule set:
//   domain/uses-node-fs.ts      -> "no-restricted-imports" or "boundaries/external"
//   application/uses-adapters.ts -> "boundaries/element-types"
```

## Testing Strategy

| Layer | What to test | Approach |
|---|---|---|
| Architecture | Both halves of the dependency rule actually fire | Vitest + ESLint Node API over `tests/fixtures/boundaries/**` |
| Unit | None yet | `src/` is barrels only; domain unit + property tests arrive with real domain code (§12) |
| Integration | Fresh-clone bootstrap | Manual `npm ci && npm test && npm run build && npm run lint && npm run typecheck` in verify |

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary. The programmatic-ESLint decision above deliberately keeps it that way (a `child_process` fixture runner would have introduced one).

## Migration / Rollout

No migration required. Purely additive except `.gitignore` and `openspec/config.yaml`; rollback is deleting the new files and restoring those two.

## Open Questions

- [ ] Does `boundaries/external` classify `node:*` builtins as external? Unresolved by inspection; mitigated by shipping `no-restricted-imports` alongside it, and the RED fixture settles it empirically at implementation time.
- [ ] Exact resolved devDependency versions — deliberately deferred to `npm i -D --save-exact` at bootstrap.
