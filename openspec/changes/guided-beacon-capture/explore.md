# Exploration: guided Beacon capture

## Recommendation

Deliver the first usable path as **one vertical capability**, not another bootstrap slice:

```text
pharos init
  → pharos capture record
  → pharos capture annotate <capture-id>
  → pharos beacon inspect <beacon-id>
```

`capture record` launches the human-facing Playwright Inspector/codegen recorder through its documented public CLI, but saves only a **CaptureSession** and raw recording as a supporting artifact. `capture annotate` is the authority boundary for construction: it asks for the complete semantic core, validates it, and then creates an `open` draft through the existing `FsBeaconStore`, returning the new Beacon ID. `beacon inspect` proves the resulting persisted draft and clearly labels the recording as non-authoritative. Approval, task handoff, test generation, execution, evidence, and verification remain out of scope.

This is a real capture outcome, but it is unlikely to remain within the 400-line review budget once process control, project association, prompts, runtime validation, storage, CLI wiring, and tests are included. The proposal must surface an **ask-on-risk delivery decision** rather than disguising the work as one small change.

## Repository findings

| Area | Implemented now | Missing for this outcome |
|---|---|---|
| CLI | `src/cli/program.ts` exposes only help/version; tests explicitly require zero subcommands and reject `pharos beacon`. | Command tree, dependency composition, JSON/human envelopes, exit mapping, test seams. |
| Domain semantics | `src/domain/semantics/` normalizes a tool-neutral `SemanticSource`; `JcsSha256Hasher` supplies JCS/SHA-256. | Runtime contract/schema validation and an application-layer mapper from prompts to `SemanticSource`. |
| Beacon lifecycle | Draft revisions, approval/revocation, and semantic-hash recheck are implemented in `src/domain/beacon/`. | ID generation, clock, and a use case that selects project/draft context. |
| Canonical draft persistence | `FsBeaconStore` has atomic, locked, idempotent draft/approval persistence under a caller-selected `projectRoot`; it deliberately leaves `project.json` alone. | Project-context ownership, Pharos-home resolution, capture-session/supporting-artifact storage, and CLI wiring. |
| Playwright/prompt/schema adapters | `src/adapters/playwright/`, `src/application/`, and `src/adapters/fs-evidence-store/` are empty barrels. | Recorder process adapter, guided prompt adapter, schema validator, and tests. |
| Dependencies | Direct runtime dependencies are only `commander` and `canonicalize`. | Direct, pinned runtime dependencies for Playwright, `@clack/prompts`, and Ajv (if selected); current transitive lockfile entries are not an API contract. |

The README is stale: it calls semantic projection/hashing and Beacon storage “planned,” while current source and canonical OpenSpec specs show a working semantic core, Beacon lifecycle, JCS/SHA-256 adapter, and filesystem BeaconStore. Conversely, the technical design's recorder, project configuration, application services, and CLI product commands are still planned.

Repository evidence only was used. Open-web research was not selected; public Playwright API/CLI details beyond the repository's stated `playwright codegen` contract should be confirmed during implementation only if needed.

## Proposed journey and contracts

### `pharos init`

Create external project context, never application code or a Beacon:

- generate and display opaque `project_id`;
- collect explicit environment class (`local`, `test`, or `staging`), base URL, project name, and repository/external test mode;
- reject `production`; do not start or stop the application;
- persist versioned `ProjectContext` at the application-owned location associated with `<pharos-home>/store/<project_id>/project.json`; this remains outside `FsBeaconStore` ownership;
- associate the current project through an external path map. A repository marker is optional and explicit, never silently written. Commands also accept/select the stable project ID when the path association is unavailable.

### `pharos capture record`

Resolve project context; refuse unsupported environment/missing context; create a `CaptureSession` before launch so interruption is inspectable. Invoke the resolved, pinned Playwright package's documented recorder CLI (the repository design calls this `playwright codegen`) using `child_process.spawn`, inherited interactive TTY, Chromium, the configured base URL, and a CaptureStore-owned output path such as `captures/<capture-id>/journey.spec.ts`.

On normal recorder completion, atomically mark the session `recorded`; on non-zero exit or interruption, preserve a `failed`/`interrupted` session and next action. The raw TypeScript recording is supporting data only: it is not parsed into domain actions, placed in `SemanticSource`, hashed, or treated as approval authority.

### `pharos capture annotate <capture-id>`

Load the selected recorded session and run a Clack-guided semantic questionnaire. Require:

- title, purpose, actor, origin-relative entry point;
- one or more human-described, tool-neutral ordered actions (not locators/codegen statements);
- at least one meaningful checkpoint;
- outcomes, allowed variation, and prohibited regressions;
- variables with classifications, constraints, and secret references rather than secret values; and
- explicit stateful/stateless class; stateful input additionally requires isolation strategy and scope.

Validate a versioned JSON representation before mapping it to the existing `SemanticSource`, compute its projection/hash with `JcsSha256Hasher`, and call `FsBeaconStore.createDraft` with an idempotency key. The generated Beacon/draft IDs must conform to the adapter's existing safe-ID rules. Record the capture-to-draft association outside the semantic bundle. A successful command prints the Beacon ID, draft ID, revision `1`, semantic hash, and `inspect` next action.

### `pharos beacon inspect <beacon-id>`

Read through `FsBeaconStore.getBeacon`, render the open draft's semantic fields, revision, hash, and associated CaptureSession status/reference. It MUST label raw recording and capture metadata as supporting/non-authoritative, show no approved version, and never imply approval or verification.

## Boundaries and trust model

| Data | Owner and location | Included in semantic hash? |
|---|---|---|
| Project identity/context and association | Application-level ProjectContext / external path map | No |
| Raw codegen output and capture lifecycle | New CaptureStore under Pharos home | No |
| Draft semantic core and lifecycle | Existing `FsBeaconStore` | Yes, via existing projection/hasher |
| Approval, task package, generated test, runs, evidence | Existing/future dedicated lifecycle services | Out of scope |

The CaptureStore must not be retrofitted into `BeaconStore`, and no Playwright type, selector, trace format, absolute path, or resolved secret may enter `SemanticSource`. This preserves the domain/adapter boundary enforced by ESLint and the product rule that supporting artifacts cannot override canonical Beacon semantics.

## Alternatives considered

| Decision | Recommended | Alternative | Why not the alternative |
|---|---|---|---|
| Recorder integration | Spawn the resolved public Playwright recorder CLI with inherited TTY. | Drive a browser from a Node Playwright API. | It does not provide the selected human Inspector/codegen experience and would couple capture control to adapter internals. |
| Tool resolution | Use the installed, pinned Pharos Playwright package; make browser installation a clear prerequisite/error. | `npx` implicit resolution/download. | It weakens controlled dependency/browser provenance and conflicts with explicit browser installation in the product design. |
| Before annotation | Persist a CaptureSession, then create a draft only after complete annotation. | Create an empty/partial Beacon draft in `record`. | Current `Draft.content: SemanticSource` already requires purpose, actor, entry point, actions, and readiness intent; a partial draft would either lie about semantics or require a domain-model expansion. |
| Semantic action source | Human maps the recording into tool-neutral actions during annotation. | Parse generated `.spec.ts` into actions. | Codegen syntax/selectors are adapter artifacts, parsing is brittle, and inferred semantics would undermine human authority. |
| Capture persistence | Separate CaptureStore with an explicit association. | Put recording paths/content in `SemanticSource` or `FsBeaconStore` lifecycle files. | It pollutes approval-bound semantics and violates the existing store's narrowly defined responsibility. |
| Association | External path map plus explicit optional marker and stable `--project` selection. | Always write `.pharos/project.json` in the target repository. | External mode must not modify the target repository; silent marker writes are not justified for capture. |
| Prompt/validation | `@clack/prompts` plus direct Ajv validation of versioned input contracts. | Ad hoc `readline` and TypeScript-only casts. | The technical design selects Clack/Ajv; prompt input is untrusted at runtime and drafts need inspectable, versioned contracts. |

## Risks, gaps, and decisions to resolve

1. **Budget risk — high.** This vertical slice needs new runtime dependencies, process/lifecycle handling, project and capture persistence, prompts, schemas, CLI composition, and focused tests. Estimate is materially above 400 changed lines. Under `ask-on-risk`, proposal must ask whether to split by a user-visible vertical boundary; no chain strategy is selected here.
2. **Sensitive recording handling — blocking design detail.** Product requirements prohibit secret values in canonical semantics and require raw recording to be sanitized or rejected before approval; technical design additionally says sanitization occurs before annotation completes. A recorder starts before variable secret references are known. Decide whether annotation first declares secret sources and scans against resolved values, whether record performs a separate sensitivity declaration, and what is retained on rejection. Do not silently retain a sensitive raw recording as safe.
3. **Schema contract absent.** `SemanticSource` has TypeScript types but no runtime version/schema interpreter; Ajv and formal semantic-input schemas are absent. The first slice needs a narrow versioned contract without redefining the frozen semantic projection.
4. **Project identity is unfinished.** Technical design selects UUIDv7-style IDs and a marker/map strategy, whereas the existing filesystem adapter accepts generic safe caller IDs. The application layer must generate opaque IDs and prevent user labels from becoming authority identifiers.
5. **CLI compatibility.** Current CLI tests intentionally assert product commands are absent. Replacing that bootstrap contract is expected, but new command tests must preserve `--help`, `--version`, meaningful errors, and non-interactive behavior.
6. **Operational prerequisites.** Chromium availability, reachable target, recorder exit/interruption, and a terminal capable of interaction must produce explicit outcomes. This slice must not claim preflight, test-mode compatibility, readiness, or verification beyond capture.
7. **Existing design ambiguity.** `docs/technical-design-v1.md` is explicitly a draft and describes `pharos start`, `project.json`, recorder sanitization, and `@clack/prompts` as decisions, while no application/config/Playwright code exists. The proposal should treat the domain/lifecycle requirements as authoritative and confine this change to the selected capture workflow.

## Minimum coherent acceptance outcome

- Given a fresh external Pharos home and a running non-production target, `pharos init` persists explicit project context and reports its stable ID without touching target application code.
- Given that context and an installed Chromium-capable Playwright runtime, `pharos capture record` opens the human recorder and persists a recoverable CaptureSession plus raw supporting artifact; no Beacon exists yet.
- Given a recorded session, `pharos capture annotate <capture-id>` rejects incomplete semantic core, invalid stateful isolation, and literal secret input; valid answers create one revision-1 open draft through `FsBeaconStore` and return its Beacon ID.
- Given that draft, `pharos beacon inspect <beacon-id>` shows its semantic hash, capture association, and `draft` authority state, and never reports approval, task readiness, generated tests, evidence, or verification.
- Given production configuration, absent context, a recorder failure, or interrupted capture, commands preserve inspectable state where applicable and return an actionable non-success outcome without creating an approved Beacon.

## Readiness for proposal

**Conditionally ready.** The user-selected outcome, boundaries, and non-goals are sufficiently sharp for a proposal. The proposal must first carry the review-budget risk to the user and explicitly choose the sensitive-recording flow; it must not add approval, handoff, generated tests, execution, verification, or application modifications merely to make capture appear complete.
