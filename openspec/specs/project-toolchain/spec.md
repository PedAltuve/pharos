# Project Toolchain Specification

## Purpose

Defines the buildable, testable, boundary-enforced TypeScript workspace contract for Pharos: the npm script surface, the machine-enforced hexagonal dependency rule, the directory skeleton, version-control hygiene, and the strict-TDD re-enablement condition. Contains zero domain/application/adapter/cli business logic.

## Requirements

### Requirement: Workspace Bootstrap and Script Contract

The system MUST provide a `package.json` with a committed `package-lock.json`, an `engines.node` floor of `>=20`, ESM module type, and no npm lifecycle scripts (`preinstall`/`postinstall`/etc.). The system MUST expose exactly five npm scripts — `test`, `test:watch`, `build`, `lint`, `typecheck` — each of which SHALL exit `0` on a correctly bootstrapped clone with no source changes.

#### Scenario: Fresh clone bootstraps successfully

- GIVEN a fresh clone of the repository on Node >= 20
- WHEN `npm ci` is run, followed by `npm test`, `npm run build`, `npm run lint`, and `npm run typecheck`
- THEN every command exits `0`

#### Scenario: No lifecycle scripts execute on install

- GIVEN the committed `package.json`
- WHEN `npm ci` runs
- THEN no `preinstall`, `install`, or `postinstall` script executes, because none is defined

### Requirement: Hexagonal Dependency Rule Enforcement

The system MUST machine-enforce the dependency rule `cli -> application -> domain` via an ESLint flat config using `eslint-plugin-boundaries`. `domain` MUST NOT import `node:fs`, any Playwright package, or any `adapters`/`cli` module. `application` MUST NOT import `adapters` or `cli` modules directly.

#### Scenario: Lint fails on domain importing node:fs

- GIVEN a file under `src/domain/**` that adds `import { readFileSync } from "node:fs"`
- WHEN `npm run lint` is run
- THEN it exits non-zero and reports a boundaries violation for that file

#### Scenario: Lint fails on application importing adapters

- GIVEN a file under `src/application/**` that imports from `src/adapters/**`
- WHEN `npm run lint` is run
- THEN it exits non-zero and reports a boundaries violation for that file

#### Scenario: Lint passes once the violation is reverted

- GIVEN either proof-fixture violation above has been reverted
- WHEN `npm run lint` is run
- THEN it exits `0`

### Requirement: Directory Skeleton Matches Design

The system MUST create the directory skeleton exactly as specified in `docs/technical-design-v1.md` §2 (`src/domain/{beacon,semantics,verification,evidence,staleness,ports}`, `src/application`, `src/adapters/{fs-beacon-store,fs-evidence-store,playwright,engram-discovery}`, `src/cli`, `src/shared`). Every file in the skeleton MUST be a placeholder barrel containing no business logic.

#### Scenario: Skeleton matches design exactly

- GIVEN the bootstrapped repository
- WHEN the `src/` tree is compared against `docs/technical-design-v1.md` §2
- THEN every listed directory exists and no extra top-level module directory exists

#### Scenario: Barrels contain no logic

- GIVEN any file under `src/**/index.ts`
- WHEN its contents are inspected
- THEN it contains only a placeholder export (e.g. `export {};`) and no runtime logic, types, or I/O

### Requirement: Version Control Hygiene

The system MUST keep `package-lock.json` tracked in version control. The system MUST ignore `node_modules/`, `dist/`, and coverage output directories via `.gitignore`.

#### Scenario: Lockfile stays tracked

- GIVEN the updated `.gitignore`
- WHEN `git check-ignore package-lock.json` is run
- THEN it reports the file as NOT ignored

#### Scenario: Build and dependency artifacts are ignored

- GIVEN `node_modules/`, `dist/`, and a coverage output directory exist locally
- WHEN `git status` is run
- THEN none of those paths appear as untracked or trackable

### Requirement: Strict TDD Re-enablement

The system MUST update `openspec/config.yaml` so that `rules.apply.test_command` and `rules.verify.test_command` reference `npm test`, `rules.apply.build_command`/`rules.verify.build_command` reference `npm run build`, `projects` lists the bootstrapped workspace, and `strict_tdd` is `true`.

#### Scenario: Config records real commands after bootstrap

- GIVEN the workspace has been bootstrapped per this spec
- WHEN `openspec/config.yaml` is read
- THEN `test_command` is `npm test`, `build_command` is `npm run build`, `projects` is non-empty, and `strict_tdd` is `true`

#### Scenario: strict_tdd never flips before a real test_command exists

- GIVEN no workspace-level test command exists yet
- WHEN `openspec/config.yaml` is evaluated
- THEN `strict_tdd` MUST remain `false` until this change lands a real `test_command`
