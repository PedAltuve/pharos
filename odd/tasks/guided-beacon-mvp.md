# Guided Beacon MVP

## Objective

Deliver the first usable Pharos workflow:

```text
pharos init
  → pharos capture record
  → pharos capture annotate <capture-id>
  → pharos beacon inspect <beacon-id>
```

The workflow ends with one persisted revision-1 `open` Beacon draft. It does not claim approval, generated tests, execution evidence, or verification.

## Problem

Remote `master` contains the Beacon domain, semantic hashing, filesystem Beacon persistence, project initialization, recoverable capture storage, and secure Playwright recording, but the public CLI exposes only `--help` and `--version`. A user cannot currently turn a promoted capture into an inspectable Beacon draft.

## Why

Completing the guided workflow creates the smallest coherent product milestone that can be exercised by an operator. It also provides the foundation for later approval, generation, execution, evidence, diagnosis, and stability capabilities without prematurely exposing partial commands.

## Scope

### In scope

- Validate guided annotations and map only approved tool-neutral fields into the existing semantic model.
- Create exactly one open Beacon draft from a promoted capture and durably associate both records.
- Inspect the draft, hash, revision, status, and supporting capture association with explicit authority labels.
- Add CLI composition, command builders, prompt/input adapters, stable envelopes, redaction, and typed exit mapping.
- Register exactly `init`, `capture record`, `capture annotate <capture-id>`, and `beacon inspect <beacon-id>`.
- Prove the fake-backed full journey with real temporary stores and update truthful README guidance.

### Out of scope

- Beacon approval, revocation UI, or readiness claims.
- Test generation, browser-test execution, evidence collection, failure classification, or stability passes.
- Production capture, target repository mutation, MCP integration, publishing, commits, pushes, or pull requests.
- Cleanup tracked separately in GitHub issue #72 unless it is strictly required by the MVP behavior.

## Constraints

- Preserve hexagonal dependency boundaries and existing Beacon semantic/storage contracts.
- Raw Playwright output remains supporting and non-authoritative; it must never enter `SemanticSource` or its hash.
- Invalid annotation must be refused before normalization or `BeaconStore.createDraft`.
- Strict TDD is enabled by project configuration. Runner: `npm test` (Vitest).
- For each behavior task, observe RED, GREEN, TRIANGULATE, and REFACTOR evidence.
- The default test suite must remain hermetic and must not launch a browser or contact a target.
- Preserve the user's modified `.gitignore` in `/home/pedro/pharos`; implementation occurs in `/home/pedro/pharos-worktrees/guided-beacon-mvp` from remote master `363e071`.
- Use `openspec/changes/guided-beacon-capture/{proposal,design,tasks}.md` as the existing requirement/design source without selecting a new SDD run.

## Tasks

- [x] **GBM-1 — Annotation and draft association**
  - Add strict annotation validation and semantic policy mapping.
  - Implement exactly-once `AnnotateCapture` recovery across claim, draft creation, reverse-link, and completion crash windows.
  - Implement authority-labeled read-only draft inspection with hash/status/revision agreement checks.
  - Focused check: `npm test -- tests/application/annotate-capture.test.ts tests/application/inspect-beacon-draft.test.ts tests/application/annotation tests/adapters/validation tests/integration/annotation-association.test.ts`.
  - Full checks: `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`, `git diff --check`.

- [x] **GBM-2 — CLI adapters and composition**
  - Add stable CLI envelopes, redaction, typed exit taxonomy, and domain-to-CLI refusal mapping.
  - Add injectable composition plus command and prompt/input adapters.
  - Keep the builders unregistered until the complete workflow is ready.
  - Focused check: `npm test -- tests/cli/composition.test.ts tests/cli/envelope.test.ts tests/cli/exit-codes.test.ts tests/cli/commands tests/cli/prompts`.
  - Full checks: `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`, `git diff --check`.

- [x] **GBM-3 — Public guided journey**
  - Register exactly the four selected command surfaces.
  - Add the fake-backed in-process integration journey using real temporary stores and a test-local fake recorder.
  - Retain packaged executable coverage and hermetic defaults.
  - Update README status and command documentation to claim only the open-draft workflow.
  - Focused check: `npm test -- tests/cli/program.test.ts tests/cli/distribution.test.ts tests/integration/guided-beacon-capture-program.test.ts`.
  - Full checks: `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`, `git diff --check`.

- [x] **GBM-4 — Final candidate verification**
  - Reconcile all task outcomes and proof.
  - Run the final full verification suite and package/distribution checks applicable to the completed CLI.
  - Run the configured native candidate review at the deliverable boundary.
  - Record every failed, skipped, unavailable, or pending check without claiming delivery.

## Acceptance criteria

- A fresh non-production project context can be initialized without mutating the target repository.
- Recording alone creates no Beacon draft.
- A promoted capture plus valid guided annotation creates exactly one revision-1 open draft with a stable semantic hash.
- Retries and supported crash recovery converge without duplicate drafts or cross-project association.
- Inspection clearly separates authoritative Beacon semantics from supporting capture data.
- The public executable exposes only the four selected product commands plus root help/version behavior.
- Invalid input, cancellation, prerequisite failure, and internal failure return the documented stable envelope and exit taxonomy without sensitive output.
- `npm test`, lint, typecheck, build, and `git diff --check` pass on the final candidate; the default suite stays browser-free.

## Progress

- 2026-09-17: User selected the guided MVP as the immediate target.
- 2026-09-17: Created clean worktree `feat/guided-beacon-mvp` from remote master `363e071`; preserved the stale dirty checkout unchanged.
- 2026-09-17: Initial GBM-1 implementation added validation, mapping, draft association, inspection, and 9 focused tests. Writer checks passed, but independent verification blocked completion on semantic-value field injection, incomplete tool/path policy, and missing crash-window/disposal evidence.
- 2026-09-17: First bounded correction closed semantic wrapper injection, core recovery/replay behavior, and inspection identity checks, expanding focused coverage to 17 tests. Fresh verification still found incomplete compound/attribute/UNC/tool-call detection, false rejection of ordinary prose punctuation, and missing metadata-invariance plus mismatch-disposal proof.
- 2026-09-17: Second bounded correction closed metadata/hash invariance, disposal, inspection mismatch coverage, and preserved ordinary punctuation prose, expanding focused coverage to 22 tests. Final verification still found systematic classifier false negatives for dotted Playwright calls, additional CSS/XPath shapes, embedded absolute paths, and control-flow code.
- 2026-09-18: Systematic classifier correction closed the recorded corpus, but independent adversarial verification found broader grammar gaps (`APIRequestContext`, generic CSS selectors, unbraced/call code, `C:/` and `~user/` paths) plus one false positive for spaced-slash prose. All non-classifier invariants were independently closed.
- 2026-09-18: Grammar-family and selector-list corrections closed the remaining API, CSS, XPath, path, and compact-code cases without rejecting controlled prose. Final independent GBM-1 verification passed with no blockers or advisories; GBM-1 is complete.
- 2026-09-18: Initial GBM-2 implementation added private CLI adapters and 25 focused tests; all writer gates passed. Independent verification blocked completion because production command wiring erased concrete request types, exit codes were not propagated, redaction covered only part of the envelope, JSON throws escaped the envelope, prompt/input helpers were not wired to complete commands, and format/TTY/home preconditions were incomplete.
- 2026-09-18: First GBM-2 correction added typed command requests, exit seams, broader redaction, exception handling, and command input wiring, expanding focused coverage to 38 tests. Fresh independent verification found all six groups still partially open at production boundaries: runtime ID/discriminator validation, usage exit 2, embedded-location/rule redaction, render/serialization catches, streaming file input plus production prompt composition, and actual TTY/home-option integration.
- 2026-09-18: Subsequent boundary corrections closed production composition, runtime validation, usage normalization, safe total rendering, bounded input, TTY/home wiring, and schema/runtime envelope alignment. Final independent GBM-2 verification passed with no blockers or advisories; GBM-2 is complete with private unregistered builders.
- 2026-09-18: GBM-3 registered the exact four-command public journey, added real-store/test-local-fake integration coverage, fixed explicit no-secret-source handling, removed the test-only command replacement hook, proved exact hash agreement through recovery/replay/inspection, and made README claims truthful. Independent verification passed with no blockers or advisories; GBM-3 is complete.
- 2026-09-18: Final native review found selector-policy gaps, secret-bearing object-key traversal, and missing human-mode continuation/inspection data. Two bounded TDD corrections closed those findings while retaining safe bounded rendering and prose controls.
- 2026-09-18: Native targeted validation was unavailable twice because `review.capture-validation` reconciliation returned `schema-incompatible` and the bound correction lineage became unavailable. No native approval was claimed; high-risk independent fallback verification passed the corrected 622-test candidate with no technical blockers.
- 2026-09-18: GBM-4 completed verification and recorded all unavailable/skipped checks. The candidate remains uncommitted and undelivered; OpenSpec status metadata remains unchanged because no new SDD run was selected.

## Verification evidence

- Initial writer verification: focused suite passed (5 files, 9 tests); full suite passed (46 files, 528 tests); lint, typecheck, build, and `git diff --check` passed.
- Native assessment was unavailable (`risk: unassessable`), so independent verification ran under the high-risk fallback.
- First correction verification: focused suite passed (5 files, 17 tests); full suite passed (46 files, 536 tests); lint, typecheck, build, and `git diff --check` passed.
- Fresh independent verification closed wrapper injection, durable recovery/replay, inspection identity agreement, and lifecycle compatibility, but kept GBM-1 blocked because:
  1. Compound/attribute selectors, standalone Playwright calls, and UNC paths can still enter semantics.
  2. Broad punctuation matching rejects legitimate prose containing semicolons or braces.
  3. Hash invariance across capture/request/artifact metadata and disposal on the draft-association-mismatch branch are not behaviorally proven.
- Second correction verification: focused suite passed (5 files, 22 tests); full suite passed (46 files, 541 tests); lint, typecheck, build, and `git diff --check` passed.
- The systematic correction retained 5 files/22 focused tests and 46 files/541 full tests with lint, typecheck, build, and diff-check passing.
- Independent adversarial verification confirmed the previous corpus now passes and every non-classifier requirement remains closed, but found additional classifier blockers: omitted Playwright types, generic CSS grammar, unbraced/control-free calls, `C:/` and named-home paths, and false rejection of `Choose yes / no`.
- Final GBM-1 verification after grammar-family and selector-list corrections: focused suite passed (5 files, 22 tests); full suite passed (46 files, 541 tests); lint, typecheck, build, and `git diff --check` passed. Independent verifier reported PASS with no blockers or advisories.
- Initial GBM-2 writer verification: focused suite passed (5 files, 25 tests); full suite passed (51 files, 566 tests); lint, typecheck, build, and `git diff --check` passed.
- Independent GBM-2 verification found six blocker groups: concrete request/result wiring, process exit propagation/refusal mapping, full-envelope recursive redaction, JSON exception normalization, command-level input/prompt integration, and production precondition/grammar enforcement.
- First correction writer verification: focused suite passed (6 files, 38 tests); full suite passed (52 files, 579 tests); lint, typecheck, build, and `git diff --check` passed.
- Fresh independent verification confirmed partial progress but kept all six groups open due to production integration and boundary gaps, with no unrelated new blocker class.
- Final GBM-2 verification after boundary and schema alignment: schema/envelope/boundary suite passed (3 files, 55 tests); focused CLI suite passed (6 files, 66 tests); full suite passed (53 files, 612 tests); lint, typecheck, build, and `git diff --check` passed. Independent verifier reported PASS with no blockers or advisories.
- Final GBM-3 verification: focused public journey suite passed (5 files, 47 tests); full suite passed (54 files, 616 tests); lint, typecheck, build, and `git diff --check` passed. Independent verifier confirmed exact registration, package safety, no-source handling, real-store journey, test-local fakes, exact hash agreement, README truthfulness, and hermetic defaults with no blockers or advisories.
- Initial GBM-4 verification passed 616 tests, lint, typecheck, build, distribution/package checks, and diff checks across 38 candidate files; native review then required corrections for selector filtering and default human success observability.
- First correction passed 618 tests and all static/package gates within 47 correction lines. Native targeted validation was unavailable with a `schema-incompatible` reconciliation, so the corrected candidate was reviewed afresh.
- The fresh review required a second bounded correction for omitted selector families, secret-bearing JSON keys, and human Beacon inspection output. The correction passed 622 tests and all gates within 158 correction lines.
- Final independent high-risk fallback verification passed: focused 28 tests, full 54 files/622 tests, lint, typecheck, build, distribution integration, package dry-run, and `git diff --check`. Browser/probe and live-target checks were intentionally skipped; native approval remained unavailable; commit, push, publish, and delivery were not performed.

## Next step

Await explicit human direction for delivery preparation. No commit, push, pull request, publication, or merge has been authorized.
