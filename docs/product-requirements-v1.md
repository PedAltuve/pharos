# Pharos v1 Product Requirements

Pharos v1 enables an individual developer working with coding agents to demonstrate a browser journey, approve its intended meaning, and obtain repeatable Playwright verification without surrendering product intent to the agent.

## Product decision

Pharos is not an autonomous browser-testing agent and is not a test-code generator. It is a human-guided workflow that preserves approved intent, gives coding agents a tool-neutral task contract, and verifies the resulting test through a controlled browser runner.

The first release proves one complete outcome:

```text
Record
  → annotate
  → approve
  → hand off to coding agent
  → generate Playwright test
  → execute
  → classify and repair once if needed
  → establish repeatability
```

## Primary user

The primary v1 user is an **individual developer working with coding agents**.

The user may work in a JavaScript/TypeScript repository with an existing Playwright setup, or may want Pharos isolated from a repository that uses another language or should not be modified.

Team governance, centralized administration, and shared organizational approval are not v1 drivers.

## User problem

A coding agent can explore an application and produce a browser test, but it cannot safely infer which observed details express product intent and which are incidental. A one-time successful browser interaction is also not repeatable proof.

The developer needs to:

- demonstrate the intended journey once;
- explain what matters about that journey;
- preserve an immutable approved version of that meaning;
- give any capable coding agent a portable test-creation contract;
- prevent the agent from changing application behavior during generation;
- execute the resulting test repeatedly; and
- retain enough evidence to understand failure without storing unnecessary browser data.

## Product principles

1. **Human intent is authoritative.** Agents prepare and implement; they do not approve.
2. **Exploration is not verification.** A browser interaction becomes proof only through controlled repeatable execution.
3. **Contracts are tool-independent.** Playwright is the v1 adapter, not the Pharos domain model.
4. **Approved meaning is immutable.** Semantic changes create a new version.
5. **Application code is outside generation scope.** Missing testability support becomes a blocker or separate proposal.
6. **Canonical storage is explicit.** Search indexes and agent memory cannot override Beacon state.
7. **Trust claims are honest.** v1 approval is operator-confirmed, not cryptographically human-verified.
8. **The target application repository remains optional.** Pharos can operate without adding Node or test configuration to it.

## v1 user journey

### 1. Initialize

The developer runs:

```bash
pharos start
```

When project configuration is absent, Pharos guides initialization.

The developer chooses one test mode:

- **Repository mode** — generated tests live in the application repository and use its existing Playwright installation.
- **External mode** — generated tests and the Playwright runtime live in Pharos-managed external storage.

Pharos records a stable project identity without placing Beacons, evidence, credentials, absolute paths, or approval authority in the application repository.

### 2. Preflight

Before recording or verification, Pharos confirms that:

- the configured target environment is `local`, `test`, or `staging`;
- the configured base URL is reachable;
- Chromium is available;
- the selected test mode is usable; and
- repository mode has an existing compatible Playwright setup.

Pharos v1 does not start, supervise, or stop the target application. The application must already be running.

When repository mode lacks Playwright, Pharos stops with an actionable error. v1 does not install or scaffold Playwright inside the application repository.

### 3. Record

Pharos launches Playwright's visual recorder for Chromium. The developer performs the intended journey and may add Playwright-supported visibility, text, and input-value assertions.

The recording is a demonstration, not an approved Beacon or final test.

### 4. Annotate

After recording, Pharos runs a guided CLI questionnaire. It may open Playwright traces, screenshots, or accessibility context for visual reference, but stores semantic answers in tool-independent structures.

Approval requires this semantic core:

- purpose;
- actor;
- entry point;
- required outcomes;
- at least one meaningful checkpoint;
- variable classifications; and
- prohibited regressions.

Advanced annotations may remain optional in v1.

### 5. Approve

The guided workflow validates the semantic core, computes the semantic hash, saves a draft, and stops at the approval boundary.

Approval requires a separate interactive operator command:

```bash
pharos beacon approve <beacon-id>
```

Approval binds the semantic bundle and records `operator_confirmed` assurance. It does not claim cryptographic proof that a human controlled the terminal.

Approved versions are immutable. Approving a new version atomically supersedes the previous active approved version. A Beacon ID has at most one active approved version.

Revocation requires operator confirmation and a reason. It blocks future use while preserving historical run records.

### 6. Hand off

Pharos creates an agent-neutral, versioned task package:

```bash
pharos agent task <beacon-id> --format json
```

The task package binds to the exact approved Beacon version and semantic hash. It contains the semantic contract, recording context, required edit scope, execution instructions, and expected result shape.

No direct Codex, Claude Code, Pi, OpenCode, or other runtime integration is required in v1. An MCP adapter is deferred.

### 7. Generate

The developer's chosen coding agent writes the Playwright test.

During generation, the agent may change only designated test artifacts. It must not modify application code. Missing accessibility names, stable selectors, test-support hooks, or deterministic setup become explicit blockers or separate proposals.

Generated test code is normal application-owned test code in repository mode. In external mode, it is Pharos-managed test code executed through Pharos.

### 8. Execute and classify

Pharos executes the targeted test and stores a structured result.

If the first generated test fails:

1. the failure is classified;
2. the agent may perform one bounded repair limited to test artifacts; and
3. Pharos performs one rerun.

The workflow stops when the failure is caused by the application, environment, data setup, missing testability support, ambiguous intent, or an unsuccessful repair. Pharos does not loop until green.

### 9. Establish repeatability

A test reaches verified status only after:

1. one successful targeted run; and
2. three additional consecutive successful stability runs.

Any stability-run failure prevents verified status and must be classified.

### 10. Report

Pharos reports:

- Beacon ID, version, and semantic hash;
- generated test location and hash;
- target environment classification;
- browser and relevant runtime versions;
- initial and stability-run outcomes;
- failure classifications;
- repair outcome, when used;
- retained evidence references; and
- whether human action is required.

## Functional requirements

### CLI and workflow

Pharos must provide a guided, resumable `pharos start` command backed by independently callable operations.

The planned v1 command surface is:

```text
pharos start [beacon-id]
pharos init
pharos status [beacon-id]

pharos beacon record <beacon-id>
pharos beacon annotate <beacon-id>
pharos beacon inspect <beacon-id>
pharos beacon approve <beacon-id>
pharos beacon revoke <beacon-id>

pharos agent task <beacon-id> --format json
pharos run <beacon-id>
pharos browser install
```

Exact naming remains subject to technical design, but the lifecycle operations must remain independently accessible. Agent-facing and CI-facing commands must support stable machine-readable output and meaningful exit codes.

The guided command must never bypass approval or silently infer an operator decision.

### Test modes

#### Repository mode

- Tests live in a configured path inside the application repository.
- The repository owns its Playwright dependency and configuration.
- Pharos detects compatibility before recording or generation.
- Missing configuration produces an actionable error.
- Pharos does not bootstrap repository dependencies in v1.

#### External mode

- Tests live in external Pharos-managed storage.
- Pharos owns the compatible Playwright runtime.
- The target application repository receives no test dependency or generated test files.
- External tests still bind to the stable Pharos project identity and approved Beacon version.

The test-mode choice is made during initialization and stored as project configuration. It is not silently defaulted based on application language.

### Browser and platform support

Pharos v1 supports:

- Chromium only;
- Linux; and
- macOS.

Firefox, WebKit, Windows, cross-browser matrices, mobile viewport verification, and visual baseline management are post-v1 capabilities.

### Environment safety

Pharos v1 supports explicitly classified:

- local;
- test; and
- staging environments.

Production environments are unsupported. Environment classification must be explicit and cannot be inferred solely from URL shape.

### Authentication and sensitive data

Authenticated journeys are supported only with dedicated test credentials.

Beacon contracts store references to sensitive values, such as environment-variable names or test-data identifiers, never the values themselves. Raw recording output containing sensitive literals must be sanitized or rejected before approval.

Pharos warns that screenshots, traces, DOM snapshots, and logs may contain sensitive rendered content. Semantic redaction does not imply evidence redaction.

Reusable browser session secrets are not canonical Beacon data in v1.

### Stateful journeys

Each Beacon declares its side-effect classification.

A stateful journey cannot reach verified status without a deterministic strategy such as:

- reset or preparation command;
- test-support API;
- fixture;
- unique-data isolation; or
- equivalent deterministic setup implemented by the test.

The strategy remains framework-neutral but must be declared and validated.

Real payments, production email delivery, and other irreversible external effects are outside the supported v1 workflow.

### Evidence

By default:

- failed runs retain traces, screenshots, relevant logs, and diagnostics;
- successful runs retain structured result summaries; and
- all evidence references bind to the originating run.

Evidence storage is separate from the semantic approval hash. Evidence files may have independent content hashes for integrity.

### Storage

Pharos stores canonical Beacons outside the application repository through a provider-based architecture:

```text
BeaconStore       → semantic bundles, versions, approval, lifecycle
EvidenceStore     → traces, screenshots, videos, logs
DiscoveryIndex    → optional searchable metadata and agent context
```

v1 provides:

- external filesystem `BeaconStore`;
- content-addressed filesystem `EvidenceStore`;
- portable Beacon export/import; and
- optional Engram discovery integration.

Engram is never required and is not canonical approval authority. A dedicated Git repository store is post-v1.

See [`beacon-storage-model.md`](beacon-storage-model.md).

### Trust and lifecycle

The v1 trust and versioning requirements are defined in [`beacon-trust-model.md`](beacon-trust-model.md).

Canonical storage providers must preserve lifecycle invariants atomically. Search indexes, memory observations, project-local pointers, and generated tests cannot override canonical status.

## Non-functional requirements

### Portability

- Beacon, task-package, result, evidence-manifest, and approval schemas must not depend on Playwright-specific types.
- Playwright-specific data remains behind the verification adapter.
- Paths and user-data locations must follow Linux and macOS conventions.
- Project identity must remain stable across clones and worktrees without relying on absolute paths.

### Reproducibility

Every run must identify:

- Beacon version and semantic hash;
- test hash;
- Pharos version;
- Playwright version;
- Chromium version;
- target environment classification;
- relevant configuration identity; and
- execution outcomes.

### Reliability

- Interrupted workflows must remain inspectable and resumable.
- Storage transitions must not leave approved versions partially written.
- Commands must fail explicitly when canonical state or dependencies are unavailable.
- No command may claim verified status after partial, skipped, or unclassified execution.

### Security

- Production targeting is unsupported.
- Secrets are referenced, not stored in semantic artifacts.
- Approval and revocation remain explicit operator interactions.
- Agent-facing task packages never grant approval authority.
- Imported portable bundles require hash verification.

### Distribution

Pharos v1 uses npm for development and canonical distribution.

Requirements include:

- explicitly controlled runtime and development dependency versions;
- committed `package-lock.json`;
- `npm ci` in CI;
- no required package-install lifecycle script for Pharos;
- trusted npm publishing and provenance where supported; and
- explicit Chromium installation through `pharos browser install`.

Homebrew distribution is post-v1.

## v1 non-goals

Pharos v1 does not include:

- direct coding-agent runtime integrations;
- MCP server integration;
- autonomous Beacon approval;
- cryptographic human identity proof;
- application process management;
- automatic Playwright installation inside target repositories;
- application-code modification during test generation;
- automatic application repair;
- unbounded test-repair loops;
- production execution;
- real credential or reusable session-secret storage;
- Firefox, WebKit, or Windows support;
- dedicated visual annotation UI;
- visual baseline management;
- cloud execution;
- multi-agent orchestration;
- database-backed run history;
- centralized team administration; or
- a Git-backed BeaconStore.

## v1 release acceptance

Pharos v1 is complete only when the full record-to-verification workflow succeeds against two reference applications.

### Reference A: repository mode

A JavaScript or TypeScript application with an existing Playwright setup must demonstrate:

- initialization without Pharos installing dependencies;
- repository-local generated test output;
- Beacon storage outside the application repository;
- operator-confirmed approval;
- agent-neutral task-package generation;
- bounded test-only repair behavior;
- one initial pass and three consecutive stability passes; and
- structured reporting with failure-only diagnostic evidence.

### Reference B: external mode

A non-JavaScript application must demonstrate:

- no Node, TypeScript, Playwright, or generated-test configuration added to the application repository;
- external test storage and Pharos-managed Playwright execution;
- the same Beacon, approval, handoff, verification, and evidence contracts as repository mode; and
- deterministic state handling for a stateful journey.

### Cross-cutting acceptance

Both references must prove that:

- production environments are rejected;
- Chromium is the only available browser;
- the application must already be running;
- sensitive variables are represented by references rather than values;
- an agent cannot approve through the agent task interface;
- approved semantic content cannot mutate in place;
- revocation blocks future use without rewriting historical results;
- interrupted workflows can be inspected and resumed; and
- all machine-readable outputs validate against versioned schemas.

## Open product questions

The following questions may be resolved during specification and technical design without reopening the v1 product boundary:

1. Exact CLI command names and interactive copy.
2. Minimum supported Node.js version.
3. Project identity filename and identifier format.
4. Exact side-effect classifications.
5. Standard failure taxonomy and exit-code mapping.
6. Which advanced annotation fields remain optional.
7. Evidence retention duration and garbage-collection defaults.
8. How the CLI selects among multiple unfinished Beacon drafts.
9. Portable bundle archive format and extension.
10. Version compatibility policy across Pharos, Playwright, and Chromium.

## Planning sequence

Implementation must not begin directly from this PRD. The next artifacts are:

```text
Domain specification
  → lifecycle and schema specification
  → technical design
  → implementation tasks
  → implementation
```

The domain specification must define observable behavior and acceptance scenarios before the technical design selects modules, libraries, or storage mechanics.
