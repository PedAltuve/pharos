# Proposal: Project Foundation

Bootstrap the greenfield Pharos repo into a buildable, testable, boundary-enforced TypeScript project so every later change can run strict TDD.

> Engram counterpart: topic `sdd/project-foundation/proposal` (hybrid store).

## Intent

No `package.json`, no `src/`, no test runner exists. `sdd-init` therefore forced `strict_tdd: false` (fails closed) despite the user preference being `true`. Until a real workspace `test_command` exists, no subsequent change can be developed test-first or verified. This change removes that blocker and installs the hexagonal dependency rule from `docs/technical-design-v1.md` §2 as an executable check rather than a documented intention.

## Scope

### In Scope
- `package.json` + committed `package-lock.json`; Node >= 20, ESM, no lifecycle scripts.
- `tsconfig.json` (strict, NodeNext, `verbatimModuleSyntax`) + `tsconfig.build.json`.
- Vitest + `@vitest/coverage-v8`; `vitest.config.ts`.
- ESLint flat config: typescript-eslint + `eslint-plugin-boundaries` encoding `cli -> application -> domain` and banning `node:*`/Playwright imports from `domain`; Prettier.
- Directory skeleton per design §2, placeholder barrels only.
- `.gitignore`: add `node_modules/`, `dist/`, coverage. `package-lock.json` stays tracked.
- Scripts contract: `test`, `test:watch`, `build`, `lint`, `typecheck`.
- Update `openspec/config.yaml` with real `test_command`/`build_command`, populate `projects`, re-enable `strict_tdd`.

### Out of Scope
- Any domain type, port interface, or business logic.
- CLI commands, `bin` wiring, Playwright integration, Ajv/JCS wiring.
- CI pipelines, publishing/release config, dependency-cruiser.

## Capabilities

### New Capabilities
- `project-toolchain`: buildable/testable workspace contract — script names, Node floor, and machine-enforced hexagonal dependency rule.

### Modified Capabilities
- None.

## Approach

Adopt the exploration's settled decisions verbatim: Vitest (Node 20 has no native TS stripping, so `node:test` gains no zero-dependency advantage); `eslint-plugin-boundaries` (only single tool covering both halves of the dependency rule with inline feedback); tsc-only build (ESM-only CLI, no dual-format need); ESLint+Prettier over Biome (Biome cannot host the boundaries rule).

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `package.json`, `package-lock.json` | New | Manifest, pinned deps, scripts |
| `tsconfig*.json` | New | Strict ESM typecheck + emit |
| `eslint.config.js`, `.prettierrc` | New | Lint, format, dependency rule |
| `vitest.config.ts` | New | Test runner |
| `src/{domain,application,adapters,cli,shared}/**` | New | Placeholder barrels only |
| `.gitignore` | Modified | Ignore build/deps, keep lockfile |
| `openspec/config.yaml` | Modified | Real commands, `strict_tdd: true` |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Boundaries config silently permissive (e.g. `application` -> `adapters` allowed by omission) | Med | Ship a deliberately-wrong-import proof fixture; `lint` MUST fail on it and pass once removed |
| `.gitignore` blanket-ignores `package-lock.json` | Low | Explicit task assertion that the lockfile stays tracked |
| Vitest pulls a Vite/esbuild chain | Low | devDependencies only, never published |
| Scaffolding drifts into real logic | Low | Barrels export nothing; scope gate in tasks |

## Rollback Plan

Purely additive except `.gitignore` and `openspec/config.yaml`. Revert = delete the new files and restore those two files (config.yaml back to `strict_tdd: false`, empty commands). No data, schema, or consumer migration.

## Dependencies

- Node >= 20 LTS and npm on the developer machine. Registry access for first `npm install`.

## Size Estimate

Well under the 400-line review budget: config files plus one-line barrels, roughly 150-250 authored lines. **Assumption stated explicitly:** `package-lock.json` is generated, not authored, and is excluded from review-line accounting by convention while remaining committed and part of snapshot identity.

## Success Criteria

- [ ] On a fresh clone with Node >= 20: `npm ci` then `npm test`, `npm run build`, `npm run lint`, `npm run typecheck` all exit 0.
- [ ] `npm run lint` fails on a `domain` file importing `node:fs`, Playwright, or an outward layer; passes once reverted.
- [ ] `src/` matches design §2 exactly and contains zero business logic.
- [ ] `package-lock.json` is committed; `node_modules/`, `dist/`, coverage are ignored.
- [ ] `openspec/config.yaml` records `test_command: npm test`, `build_command: npm run build`, and `strict_tdd: true`.
