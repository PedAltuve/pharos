# CLI and Package Distribution Specification

## Purpose

Define the minimal runnable and distributable Pharos CLI boundary without implying that any product workflow is implemented.

## Requirements

### Requirement: Runnable root executable

The package MUST provide an executable named `pharos` through its npm `bin` mapping to the compiled `dist/cli/index.js` entry. The compiled entry MUST be executable by Node.js and MUST preserve a Node shebang.

#### Scenario: Installed package runs the root executable

- GIVEN the package has been built, packed, and installed in a temporary consumer project
- WHEN the consumer invokes `pharos --help`
- THEN the command MUST exit successfully
- AND the command MUST execute the packaged compiled entry

### Requirement: Root help is truthful and minimal

The root command MUST provide conventional `--help` output identifying `pharos` and describing only the bootstrap CLI surface. Help MUST NOT advertise Beacon, browser, storage, recording, annotation, approval, revocation, draft, JSON, or other product workflows.

#### Scenario: User requests help

- GIVEN the `pharos` executable is available
- WHEN the user invokes `pharos --help`
- THEN help text MUST be printed successfully
- AND it MUST identify the root `pharos` command
- AND it MUST list no product subcommands

### Requirement: Version has one source of truth

The CLI MUST display the version from the package metadata, with `package.json` as the sole release authority. The version MUST NOT be duplicated as a separately maintained TypeScript CLI constant.

#### Scenario: User requests version

- GIVEN the installed package metadata declares a version
- WHEN the user invokes `pharos --version`
- THEN the command MUST exit successfully
- AND its version output MUST exactly match the package metadata version

### Requirement: Unknown command behavior

The root CLI MUST reject unsupported commands using conventional usage-error behavior and MUST NOT make an unsupported command appear available.

#### Scenario: User invokes a product command before it exists

- GIVEN no product subcommands are implemented
- WHEN the user invokes `pharos beacon` or another unsupported command
- THEN the command MUST fail with a non-success status
- AND the output MUST indicate that the command is unknown or unsupported

### Requirement: Distributable package contents and installability

The package manifest MUST describe a distributable package rather than a private workspace, retain accurate package name, version, license, strict ESM, and Node engine metadata, map `pharos` to `dist/cli/index.js`, and use an explicit contents allowlist that includes the compiled CLI and normal package documents while excluding unrelated source, tests, and generated development artifacts. A clean build followed by packing MUST produce an installable archive containing the mapped executable target.

#### Scenario: Packed archive contains the executable target

- GIVEN a clean build has completed
- WHEN the package is inspected with `npm pack --dry-run`
- THEN the archive contents MUST include `dist/cli/index.js`
- AND the archive MUST include the package documents required by its metadata
- AND generated `dist/` output MUST remain ignored and uncommitted in the repository

#### Scenario: Packed package is installable

- GIVEN the dry-run contents are valid and the package is packed
- WHEN the archive is installed in a temporary consumer project
- THEN npm MUST expose the `pharos` executable
- AND the installed executable MUST successfully support `--help` and `--version`

### Requirement: Runtime and toolchain contract is preserved

The package MUST retain strict ESM mode and the Node.js `>=20` engine contract. Commander MUST be an exactly pinned runtime dependency. The committed lockfile MUST remain consistent with the package manifest.

#### Scenario: Manifest and lockfile are reproducible

- GIVEN the repository contains the package manifest and committed lockfile
- WHEN dependencies are installed with `npm ci`
- THEN installation MUST resolve the pinned Commander runtime dependency
- AND the package MUST retain its declared Node.js and ESM requirements

### Requirement: Exact script surface and no lifecycle hooks

The package MUST expose exactly these five npm scripts: `test`, `test:watch`, `build`, `lint`, and `typecheck`, with no additional script names. It MUST NOT add `prepare`, `prepack`, `postpack`, `prepublish`, `postinstall`, or any other npm lifecycle hook.

#### Scenario: Script contract is inspected

- GIVEN `package.json` is read
- WHEN its scripts and lifecycle fields are inspected
- THEN the script names MUST be exactly the five canonical scripts
- AND no install or packaging lifecycle hook MUST be present
- AND build-before-packaging MUST remain an explicit maintainer action

### Requirement: Documentation states the implemented boundary accurately

The README MUST state that the bootstrap `pharos` executable is runnable and MUST provide concise build/install and `pharos --help` / `pharos --version` examples. It MUST clearly state that product workflows and subcommands are not yet available.

#### Scenario: Developer follows documented usage

- GIVEN a developer reads the README
- WHEN the developer follows its build/install and root CLI examples
- THEN the examples MUST correspond to the implemented package behavior
- AND the documentation MUST make no claim that Beacon or other product workflows are available

### Requirement: Product commands remain absent

This change MUST implement no Beacon, browser-testing, persistence, evidence-store, guided-flow, JSON-envelope, or other product command. The root executable MUST remain limited to help, version, and conventional unsupported-command handling.

#### Scenario: Root command catalogue is checked

- GIVEN the built CLI is invoked without a supported root option
- WHEN its available command catalogue is inspected
- THEN no product command MUST be registered or advertised
- AND the CLI MUST communicate the intentionally incomplete product surface truthfully
