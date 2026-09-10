# Proposal: Runnable CLI

## Intent

Establish Pharos's first real npm distribution boundary without implying that any Beacon or browser-testing workflow is implemented. After this change, a built package exposes an installable `pharos` executable with conventional `--help` and `--version` behavior. This gives developers and release maintainers a truthful, testable package/CLI foundation on which later product commands can be added.

## Proposal question round

Interactive questions were intentionally skipped because the pre-proposal handoff records the product decision and states that repository evidence is sufficient. The questions that would ordinarily shape this proposal are already answered as follows:

- **What problem is solved now?** Pharos has a designed CLI boundary but no executable or distributable package surface; this change makes that boundary real before product workflows are introduced.
- **Who is this slice for?** Developers and release maintainers building, installing, and validating the package, not end users attempting Beacon workflows.
- **What is the first useful product slice?** Only the root `pharos` executable, `--help`, and `--version`, together with the metadata, tests, packaging checks, and concise documentation needed to distribute them safely.
- **Which invariants must remain intact?** The exact five npm scripts, absence of install lifecycle scripts, strict ESM/Node >=20 contract, hexagonal module boundaries, committed lockfile, and ignored generated `dist/` output.
- **What is the main tradeoff?** The package becomes runnable while the product remains intentionally incomplete, so all output and documentation must avoid suggesting that any real Pharos command or workflow is available.

No unresolved product assumption requires another question round.

## Scope

### In scope

- Replace the `src/cli/` placeholder with a thin, shebang-bearing ESM executable entry and a small root-program construction seam where useful for testing.
- Use Commander, as selected by the approved technical design, for conventional root help, version output, and usage-error handling.
- Source the displayed CLI version from package metadata so `package.json` remains the release authority rather than duplicating the version in TypeScript.
- Update `package.json` from a private workspace manifest to accurate distributable metadata, including a `pharos` bin mapping to `dist/cli/index.js` and an explicit package-content allowlist for compiled output and normal package documents.
- Add Commander as an exactly pinned runtime dependency and update the committed npm lockfile accordingly.
- Add focused tests for root CLI behavior, compiled execution, manifest/bin correctness, and package contents/installability.
- Verify packaging only after a clean build, including that the packed artifact contains the compiled bin target and that an installed package exposes a working `pharos` executable.
- Update the README with a narrowly truthful status statement and concise build/install and `pharos --help` / `pharos --version` examples.

### Out of scope

- Beacon recording, annotation, inspection, approval, revocation, or draft workflows.
- Application use cases, composition of adapters, filesystem/evidence-store wiring, and persistence behavior.
- Playwright, Chromium/browser installation, prompts, schema validation, or other planned runtime dependencies.
- Any real product subcommand, JSON output envelope, guided flow, or expansion of the future command catalogue.
- Publishing a release or defining release automation/policy.
- Adding npm scripts, `prepare`, `prepack`, or any install lifecycle hook.
- Committing generated `dist/` files.

## Approach

1. Keep the executable at the existing composition boundary under `src/cli/`, with the Node shebang preserved in the compiled `dist/cli/index.js` entry targeted by npm's `bin` mapping.
2. Construct a minimal Commander root program named `pharos`, with a short description and version read from package metadata. Parse `process.argv` only in the thin executable entry so behavior can be tested without introducing application or adapter wiring.
3. Make the manifest distributable while retaining the existing name, version, license, ESM mode, and Node engine floor. Pin Commander exactly as a runtime dependency and regenerate lockfile v3 metadata.
4. Preserve the canonical five-script contract. Package preparation and verification remain explicit commands: run the existing build, then inspect/package with `npm pack --dry-run` (and a temporary packed-package install where required by tests); do not automate this through lifecycle scripts.
5. Test both user-visible behavior and the distribution boundary: successful help/version execution, version agreement with package metadata, bin mapping to compiled output, tarball inclusion of that target, and executability after installation.
6. Adjust README claims so the bootstrap CLI is described as runnable while all product workflows remain clearly unavailable.

## Affected Areas

- `package.json`: publishability, bin/files metadata, and exact Commander runtime dependency; the five existing scripts remain unchanged.
- `package-lock.json`: root package metadata and the locked Commander dependency.
- `src/cli/`: executable entry and, if useful, a minimal testable program factory.
- `tests/cli/`: focused root behavior and packaging/install verification.
- `README.md`: accurate CLI status and usage instructions.

No domain, application, adapter, storage, Playwright, or OpenSpec baseline requirement is expected to change in this proposal.

## Risks and Mitigations

- **Broken package distribution:** An incorrect bin path, omitted compiled file, or lost shebang could produce a package that builds but cannot run after installation. Mitigate with clean-build archive inspection and temporary installation/execution coverage.
- **Violation of the toolchain contract:** Convenience lifecycle scripts could silently expand the canonical script surface or execute during install. Mitigate by retaining exactly the current five scripts and keeping build-before-pack explicit.
- **Version drift:** Hard-coded CLI output could disagree with package metadata. Mitigate by treating the manifest version as the sole source of truth and testing agreement.
- **Premature product claims:** Help text or README wording could imply usable Beacon workflows. Mitigate by exposing no product command and explicitly describing this as a distribution/bootstrap surface.
- **Dependency or lockfile drift:** A ranged runtime dependency or stale lockfile would weaken reproducibility. Mitigate by pinning Commander exactly and committing the generated lockfile update.
- **Packaging metadata affects downstream distribution:** Removing `private` and defining package contents changes what can be packed or published. Mitigate with a narrow allowlist, dry-run inspection, and no release publication in this change.

## Rollback

If the package or executable proves unsafe to distribute, revert the manifest's distributable/bin/files metadata, restore the private package state and `src/cli/index.ts` placeholder, remove Commander and its lockfile entries, and revert the CLI tests and README claims. Because generated `dist/` output is not committed, no build artifacts require repository cleanup. If an artifact has already been published externally, deprecate that immutable version and publish a corrected version rather than attempting to replace it; release execution itself remains outside this change.

## Success Criteria

- A clean `npm ci` followed by `npm run build` emits `dist/cli/index.js` with a usable executable entry.
- Installing the built/packed package exposes a `pharos` command that exits successfully for `--help` and `--version`.
- Help output identifies `pharos` and describes only the root bootstrap CLI; it advertises no Beacon, storage, browser, or other product command.
- Version output exactly matches the version in `package.json`.
- `npm pack --dry-run` after the build includes the compiled bin target and only the intended distributable files; `dist/` remains ignored and uncommitted.
- `package.json` maps `pharos` to `dist/cli/index.js`, includes an exactly pinned Commander runtime dependency, and still exposes exactly `test`, `test:watch`, `build`, `lint`, and `typecheck` with no install lifecycle scripts.
- `package-lock.json` remains committed and consistent with the manifest.
- `npm test`, `npm run build`, `npm run lint`, and `npm run typecheck` all pass.
- README usage is concise and truthful about the runnable CLI and the continued absence of product workflows.
