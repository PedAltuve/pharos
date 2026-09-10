# Exploration: runnable-cli

**Change**: `runnable-cli`  
**Phase**: explore  
**Project**: pharos  
**Artifact store**: OpenSpec  
**Status**: complete — ready for proposal

## Confirmed slice

Deliver the smallest runnable distribution surface only:

- an installable/executable `pharos` npm CLI;
- `pharos --help` and `pharos --version`;
- the required package metadata, lockfile, build/package workflow, tests, and concise user-facing documentation;
- no Beacon workflows, application use cases, storage wiring, browser installation, or product command.

The CLI must remain a composition-boundary module (`src/cli/`), but this slice need not compose any adapter because it has no product command.

## Repository findings

- `package.json` is strict ESM (`"type": "module"`), Node `>=20`, version `0.0.0`, and currently `"private": true`. It has no `bin`, package entry metadata, or CLI dependency. `package-lock.json` is committed and uses lockfile v3.
- `npm run build` runs `tsc -p tsconfig.build.json`. The build emits `src/**` to `dist/**`, preserving the entry path as `dist/cli/index.js`; it also emits declarations and source maps. `dist/` is ignored, so release/packing must build before packing rather than commit generated files.
- `src/cli/index.ts` is exactly `export {};`; `src/application/index.ts` is also a placeholder. The existing fs store and hashing adapters are real but are intentionally out of scope for this bootstrap CLI.
- The architecture permits `cli` to import application, adapters, domain, and shared; no import is required here. `cli` is therefore the correct location for Node process concerns and the executable entry point. The boundary rule does not allow application to import cli or adapters.
- The technical design selects npm distribution and Commander CLI parsing. Commander is not installed, while `@clack/prompts`, Playwright, and Ajv are likewise planned but unrelated to this slice.
- Vitest runs Node-environment tests from `tests/**/*.test.ts`. Existing tests use direct source imports with `.js` specifiers, async setup/cleanup where needed, and no current subprocess-test precedent. A CLI integration test may appropriately add a narrow Node child-process boundary to execute the built entry point.
- README presently labels Pharos “not usable yet” and lists the CLI as planned. It already documents `npm ci`, test, build, lint, and typecheck. It needs a narrowly truthful runnable-CLI note and invocation examples, not a claim that Beacon workflows exist.

## Packaging constraints

1. The npm `bin` mapping must point `pharos` to the compiled ESM entry (`dist/cli/index.js`), not TypeScript source. The entry must retain a Node shebang so the installed bin is executable through npm’s generated shims.
2. A distributable manifest needs to cease being private and identify the published artifact. At minimum, retain name/version/license/type/engines and add the bin mapping and an explicit publish allowlist containing the compiled output and normal package documents. Metadata should be accurate and limited to known project facts; do not invent repository URLs, author values, or release policy.
3. The package contents must be validated after a clean build (for example, `npm run build` followed by `npm pack --dry-run`) so the bin target is present in the tarball. No generated `dist/` files should be committed.
4. `openspec/specs/project-toolchain/spec.md` requires exactly the five existing npm scripts and no install lifecycle scripts. Preserve that contract: the existing `build` script is the package-preparation step; do not add `start`, `prepare`, `prepack`, or install hooks unless a later proposal deliberately modifies that canonical spec.
5. Product requirements require explicitly controlled dependency versions, a committed lockfile, `npm ci` in CI, and no required package-install lifecycle scripts. If Commander is installed, it must be an exact runtime dependency with its generated lockfile update.

## Recommended implementation shape

Use Commander, as selected by `docs/technical-design-v1.md`, solely to construct the root program with the package name, a short truthful description, `--help`, and `--version` sourced from package metadata. Keep construction testable separately from process execution when practical; the executable `src/cli/index.ts` should be the thin shebang-bearing entry that parses `process.argv`.

This makes `--help` and `--version` conventional CLI behavior while adding no domain or workflow surface. It also avoids hard-coding the displayed version in TypeScript: package metadata remains the release authority. Unknown commands/options should follow Commander’s normal usage-error behavior, but no new command is in scope.

## Likely edit surfaces

| Path | Expected change | Purpose |
|---|---|---|
| `package.json` | Modify | Publish/bin metadata; exact Commander runtime dependency; preserve five-script contract |
| `package-lock.json` | Regenerate | Lock the approved runtime dependency and manifest root metadata |
| `src/cli/index.ts` | Replace placeholder | Shebang-bearing compiled executable entry |
| `src/cli/*.ts` (if needed) | Add | Small, testable root-program factory; no product commands |
| `tests/cli/**/*.test.ts` | Add | CLI integration/manifest behavior tests |
| `README.md` | Modify | Accurate installation/build and `--help`/`--version` use |
| `openspec/changes/runnable-cli/**` | Add later | Proposal/spec/design/tasks artifacts only after this phase |

No changes are expected in `src/domain/**`, `src/application/**`, `src/adapters/**`, the filesystem store, product/domain requirements, or the technical-design command catalogue.

## Verification plan

- Unit-level test of root-program metadata/options if a program factory is introduced.
- Integration tests execute the compiled entry with `--help` and `--version`, asserting successful exit, the `pharos` usage/version output, and no Beacon command implication. Build first within the test setup or make the build-and-execute contract an explicit integration verification step.
- Assert the package manifest maps `pharos` to the compiled bin and that the package archive generated after `npm run build` includes that target.
- Run `npm test`, `npm run build`, `npm run lint`, and `npm run typecheck`; inspect `npm pack --dry-run` after the build.

## Scope and risks

The slice should fit well within the 400 changed-line review budget: a tiny CLI entry/program, a small focused test suite, manifest/lockfile changes, and README correction. The generated lockfile is review noise but required. No chained delivery is indicated.

Primary risk is accidentally treating the first executable as a partial product command or wiring the fs store; explicitly exclude all workflows. A second risk is violating the canonical five-script/no-lifecycle contract while trying to automate packing. Keep packaging as an explicit release/verification sequence using the existing build script.

## Open questions

None blocking. The confirmed product decision fixes the scope, and existing design selects Commander. The proposal should explicitly record that the existing five-script contract is preserved and that build-before-pack is the distribution procedure.

## Exploration method

Repository and OpenSpec evidence only; external research was not invoked. `.codegraph/` was absent in the supplied worktree. The available execution surface exposed no CodeGraph or shell initialization command, so filesystem reads/searches were used after that failed availability check.
