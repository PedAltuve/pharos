# Guided Beacon Capture — Implementation Tasks

Implement only the selected journey: `pharos init → pharos capture record → pharos capture annotate <capture-id> → pharos beacon inspect <beacon-id>`. Intermediate slices are review units, not supported partial releases.

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | 9,650–13,450 authored additions + deletions across seven cohesive slices |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 contracts/probe → PR 2 project context → PR 3 capture storage → PR 4 recorder security → PR 5 annotation → PR 6 CLI adapters → PR 7 public integration |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

Decision needed before apply: No — the maintainer explicitly accepted `size:exception` for all seven slices
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High — accepted via `size:exception`

### Selected split and size decision

This retains the selected seven-slice split and is the one permitted slicing pass. The listed ports, adapters, schemas, failure-injection suites, integration coverage, and documentation make every cohesive slice exceed the 400-line review budget. Do not code-golf or split these units again merely to reach the budget. The maintainer selected `stacked-to-main` and explicitly accepted `size:exception` for all seven over-budget cohesive slices before apply.

| Slice | Production estimate | Test estimate | Schemas/docs/config/package estimate | Total | Budget outcome |
|---|---:|---:|---:|---:|---|
| 1. Contracts and public-CLI probe | 500–650 | 500–700 | 250–400 | 1,250–1,750 | `size:exception` accepted |
| 2. Project context and initialization | 700–950 | 650–900 | 25–75 | 1,375–1,925 | `size:exception` accepted |
| 3. Capture lifecycle storage | 900–1,150 | 900–1,250 | 25–75 | 1,825–2,475 | `size:exception` accepted |
| 4. Recorder and sensitivity gate | 650–850 | 700–950 | 25–75 | 1,375–1,875 | `size:exception` accepted |
| 5. Annotation and draft association | 750–1,000 | 750–1,050 | 25–75 | 1,525–2,125 | `size:exception` accepted |
| 6. CLI adapters and composition | 650–900 | 650–900 | 25–75 | 1,325–1,875 | `size:exception` accepted |
| 7. Public registration, journey, and README | 200–300 | 650–900 | 125–225 | 975–1,425 | `size:exception` accepted |

Production includes source additions and compatible extraction work. Test includes unit, contract, failure-injection, integration, and fixture changes. The third component includes JSON schemas, README, package scripts/lockfile, and configuration where applicable. Totals are additions plus deletions and deliberately include tests and generated lockfile changes.

## Dependency diagram

```text
1 contracts + opt-in public Playwright probe
  └─> 2 project context + home/association store
        └─> 3 capture session store + promotion/recovery
              └─> 4 recorder + secret resolution/scanner
                    └─> 5 annotation + exactly-once draft association
                          └─> 6 unregistered CLI adapters/envelopes
                                └─> 7 📍 register complete journey + in-process journey harness + README
```

All slices depend on runnable CLI base `a6d9f70` and preserve `FsBeaconStore`, `SemanticSource`, `project()`, and `JcsSha256Hasher`. The selected topology is `stacked-to-main`; no implementation task itself creates a commit, branch, or pull request.

## Test-execution boundary

- **Default hermetic suite:** `npm test` (and every focused command below) MUST exclude the real Playwright probe. It MUST NOT download a browser, start Playwright, contact a target, or depend on host browser/TTY state.
- **Opt-in real public-CLI probe:** `PLAYWRIGHT_CONTRACT=1 npm run test:playwright-contract`. Slice 1 adds this script to run only `tests/contracts/playwright/public-cli-contract.probe.ts`; this filename is outside the default Vitest test glob.
- **Opt-in prerequisites:** the exact pinned direct Playwright package is installed, its matching Chromium browser was preinstalled by an operator (not by npm scripts or the probe), an interactive TTY is available, and the probe can use only its controlled loopback fixture URL. It never uses `npx`, `npm exec`, a deep import, a runtime install, or a production target.
- **Packaged executable coverage:** `tests/cli/distribution.test.ts` exercises only safely observable package behavior—shebang/bin, `--version`, `--help`, command grammar, exit-2 invalid invocations, and precondition refusals that occur before recorder launch. It MUST NOT use a fake recorder, a test-only shipped hook, a browser, or a target.
- **Full fake-backed journey:** `tests/integration/guided-beacon-capture-program.test.ts` invokes `createProgram` and the command-composition harness in-process with real temporary stores/hasher and test-local fake ports (including `Recorder`). This is the sole full-journey fake boundary; it is not a packaged child-process test and introduces no hidden production injection mechanism.

## Shared apply gates

Each focused command below is run as RED (expected failure for the missing behavior), GREEN (pass), TRIANGULATE (pass with a materially different failure/retry/success case), and REFACTOR (still pass). After each slice REFACTOR, run `npm test && npm run lint && npm run typecheck && npm run build`. Use fixed clock, ID, process, prompt, filesystem, and secret fakes at application boundaries. No slice may mutate an external target repository or add approval, readiness, task packaging, generated tests, run/evidence/verification, production capture, target control, or MCP behavior.

## 1. Contracts, schemas, and bounded public Playwright probe

**Start:** Runnable CLI base with no guided-capture contracts or direct runtime dependencies.
**Finish:** Pure project/capture ports and v1 ingress schemas exist; direct exact dependencies and an explicitly opt-in public Playwright probe establish only documented facts.
**Rollback boundary:** Remove only `src/domain/project/**`, `src/domain/capture/**`, the named new ports/schemas/tests, and Slice 1 package entries; existing Beacon semantics and storage remain untouched.
**Focused command:** `npm test -- tests/domain/project tests/domain/capture tests/contracts/schemas`.

- [x] **RED:** Add failing contract/schema tests in `tests/domain/project/**`, `tests/domain/capture/**`, and `tests/contracts/schemas/**` for closed v1 discriminators, required fields, safe typed refusals, generated-ID shape, `promoted`-only eligibility, and the frozen `SemanticSource`/`SemanticProjection` boundary. **Evidence:** RED then GREEN/TRIANGULATE/REFACTOR with `npm test -- tests/domain/project tests/domain/capture tests/contracts/schemas`; rollback: delete only the Slice 1 contract/schema test additions. <!-- sdd-owner: implementation -->
- [x] **GREEN:** Add `src/domain/project/**`, `src/domain/capture/**`, and `src/domain/ports/{clock,id-generator,project-context-store,capture-store,recorder,secret-resolver,sensitivity-scanner,contract-validator}.ts` plus `src/contracts/schemas/{project-init,capture-annotation,cli-envelope}.schema.json`; keep Node, Ajv, Clack, Playwright, and filesystem types outside ports. **Evidence:** pass the Slice 1 focused command, then retain a failing unknown-field fixture for TRIANGULATE and refactor only shared types; rollback: remove only these new contracts/ports/schemas. <!-- sdd-owner: implementation -->
- [x] **TRIANGULATE:** Add distinct invalid fixtures for production, incomplete annotation, invalid isolation, duplicate declarations, selector/code/path tokens, literal-secret placeholders, and oversized machine input; prove ingress neither maps semantics nor calls `BeaconStore.createDraft`. **Evidence:** `npm test -- tests/domain/project tests/domain/capture tests/contracts/schemas` passes these cases before REFACTOR; rollback: remove only the added fixtures/assertions. <!-- sdd-owner: implementation -->
- [x] **REFACTOR:** Add exact pins for `playwright`, Ajv 8, and `@clack/prompts` in `package.json`/`package-lock.json`; add `test:playwright-contract` and `tests/contracts/playwright/public-cli-contract.probe.ts`, ensuring default `npm test` cannot discover or execute the probe. **Evidence:** default `npm test` remains hermetic. The opt-in probe evidence claims only executed declared-bin/public-help checks; missing-browser, TTY, and signal behavior are explicit skips because the required operator-preinstalled matching Chromium and interactive TTY were not used. **Rollback:** remove only Slice 1 pins, script, lockfile entries, and probe. <!-- sdd-owner: implementation -->

## 2. Application-owned project context and initialization

**Start:** Slice 1 contracts exist; no persisted project routing exists.
**Finish:** `InitializeProject` and the application-owned context store safely create/replay non-production context and path association without target-repository writes.
**Rollback boundary:** Remove only `src/application/initialize-project.ts`, `src/adapters/fs-project-context-store/**`, narrowly extracted `src/adapters/fs-project/**` compatibility helpers, and their tests; inert Pharos-home files are not destructively removed.
**Focused command:** `npm test -- tests/application/initialize-project.test.ts tests/adapters/fs-project-context-store tests/adapters/fs-project`.

- [x] **RED:** Add `tests/application/initialize-project.test.ts` for local/test/staging creation, production and invalid-URL refusal, same-request replay, different-input conflict, and absence of Beacon/capture side effects. **Evidence:** RED then GREEN/TRIANGULATE/REFACTOR with `npm test -- tests/application/initialize-project.test.ts tests/adapters/fs-project-context-store tests/adapters/fs-project`; rollback: remove only this test's Slice 2 cases. <!-- sdd-owner: implementation -->
- [x] **GREEN:** Implement `src/application/initialize-project.ts` and its normalization seam using injected clock, ID generator, project store, and canonical association path; allow only absolute home overrides or supported defaults. **Evidence:** focused command passes creation/replay cases before distinct filesystem failure cases are added; rollback: remove only the new use case/normalization code. <!-- sdd-owner: implementation -->
- [x] **TRIANGULATE:** Add `tests/adapters/fs-project-context-store/**` and `tests/adapters/fs-project/**` for 0700/0600 modes, write-once journal recovery, canonical longest-path selection, explicit-ID mismatch, symlink/path containment refusal, and byte-identical external fixture repository. **Evidence:** focused command passes success, conflict, and injected permission/rename/fsync/lstat/realpath failures; rollback: remove only the new adapter fixtures and tests. <!-- sdd-owner: implementation -->
- [x] **REFACTOR:** Implement `src/adapters/fs-project-context-store/**` and only compatibility-preserving atomic/lock/containment helpers in `src/adapters/fs-project/**`; preserve existing `src/adapters/fs-beacon-store/**` behavior and tests. **Evidence:** focused command and the shared full gate pass after fixture deduplication; rollback: revert only this store/helper extraction, leaving existing BeaconStore unchanged. <!-- sdd-owner: implementation -->

## 3. Recoverable CaptureStore lifecycle and safe promotion storage

**Start:** A project resolves to a safe store root; no capture persistence exists.
**Finish:** A dedicated `CaptureStore` owns sessions, journals, staging, promoted artifacts, associations, and recovery outside `BeaconStore`.
**Rollback boundary:** Remove only `src/adapters/fs-capture-store/**`, Slice 3 `src/application/record-capture.ts` scaffolding, compatible shared helpers, and their tests; promoted supporting artifacts and terminal metadata remain inert.
**Focused command:** `npm test -- tests/adapters/fs-capture-store tests/application/record-capture.test.ts tests/adapters/fs-beacon-store/recover.test.ts tests/adapters/fs-beacon-store/concurrency.test.ts`.

- [x] **RED:** Add lifecycle-table tests under `tests/adapters/fs-capture-store/**` for legal `running → post_exit → resolving → promoted|rejected` and `running → resolving → failed|interrupted` transitions, illegal-transition refusal, and non-promoted annotation refusal. **Evidence:** RED then GREEN/TRIANGULATE/REFACTOR with the Slice 3 focused command; rollback: remove only the lifecycle-table additions. <!-- sdd-owner: implementation -->
- [x] **GREEN:** Implement `src/adapters/fs-capture-store/**` with project lock, request journal, private staging, safe terminal serialization, promoted-artifact references, and forward/reverse association records outside `SemanticSource` and `FsBeaconStore`. **Evidence:** focused command passes lifecycle persistence before crash cases; rollback: remove only CaptureStore source and its Slice 3 wiring. <!-- sdd-owner: implementation -->
- [x] **TRIANGULATE:** Add failure-injection coverage for crashes before/after session writes, resolution decisions, exclusive materialization, stage unlink, and journal completion; cover same-key replay/conflict, modes, symlink substitution, stale/live temp files, and no raw bytes after reject/fail/interruption. **Evidence:** Slice 3 focused command proves recovery completes only a durable decision and a second recovery is a no-op; rollback: remove only failure-injection fixtures/tests. <!-- sdd-owner: implementation -->
- [x] **REFACTOR:** Extract only shared atomic/lock helpers required by both filesystem stores with compatibility exports, retaining existing BeaconStore recovery/concurrency coverage. **Evidence:** Slice 3 focused command and shared full gate pass with no overwrite of a promoted destination; rollback: revert only the helper extraction and CaptureStore changes. <!-- sdd-owner: implementation -->

## 4. Recorder process control and secret-sensitive promotion gate

**Start:** CaptureStore transitions and recovery exist; no recorder, resolver, or scanner adapter exists.
**Finish:** `RecordCapture` resolves declared sources transiently, drives only the documented Playwright public CLI through an owned process, and safely promotes or terminalizes capture data.
**Rollback boundary:** Remove only `src/application/record-capture.ts`, `src/adapters/playwright/**`, `src/adapters/secret-resolution/**`, `src/adapters/sensitivity/**`, and their tests; CaptureStore records stay non-authoritative.
**Focused command:** `npm test -- tests/application/record-capture.test.ts tests/adapters/playwright tests/adapters/secret-resolution tests/adapters/sensitivity`.

- [x] **RED:** Add `tests/application/record-capture.test.ts` requiring declared `--secret-source env:NAME` or `--no-secret-sources`, transient resolution before allocation/spawn, persisted `running` before prerequisite outcome, and no secret leakage for missing/empty sources. **Evidence:** RED then GREEN/TRIANGULATE/REFACTOR with the Slice 4 focused command; rollback: remove only these application tests. <!-- sdd-owner: implementation -->
- [x] **GREEN:** Implement `src/application/record-capture.ts` and `src/adapters/secret-resolution/env-secret-resolver.ts`; bind replay identity to context/input references rather than resolved values and dispose values after terminalization. **Evidence:** focused command passes declared-source and replay cases before process/scanner edge cases; rollback: remove only these application/resolver files. <!-- sdd-owner: implementation -->
- [x] **TRIANGULATE:** Add adapter tests in `tests/adapters/playwright/**`, `tests/adapters/secret-resolution/**`, and `tests/adapters/sensitivity/**` for the Slice 1 documented arg vector, `shell: false`, no download/install, inherited TTY/stdout isolation, cancellation/non-zero/spawn cases, encoded canary values, scan failure, staged symlink/mutation, and pre-existing destination. **Evidence:** Slice 4 focused command passes without a real browser, target, or opt-in probe; rollback: remove only these fake-process/scanner tests. <!-- sdd-owner: implementation -->
- [x] **REFACTOR:** Implement `src/adapters/playwright/playwright-recorder.ts` solely from the opt-in documented contract and `src/adapters/sensitivity/literal-sensitivity-scanner.ts`; persist a durable scan decision before exclusive promotion or cleanup and return only stable safe metadata. **Evidence:** Slice 4 focused command and shared full gate pass for cancellation, rejection, recovery retry, one terminal capture, no Beacon call, and no target mutation; rollback: remove only recorder/scanner source and Slice 4 helpers. <!-- sdd-owner: implementation -->

## 5. Guided annotation, semantic mapping, and exactly-once draft association

**Start:** A promoted capture can be read but cannot create a Beacon.
**Finish:** Validated tool-neutral annotation creates exactly one revision-1 `open` draft and a durable supporting association without changing canonical semantics.
**Rollback boundary:** Remove only `src/application/{annotate-capture,inspect-beacon-draft}.ts`, `src/application/annotation/**`, `src/adapters/validation/**`, association additions, and tests; valid drafts already created remain ordinary open drafts.
**Focused command:** `npm test -- tests/application/annotate-capture.test.ts tests/application/inspect-beacon-draft.test.ts tests/application/annotation tests/adapters/validation tests/integration/annotation-association.test.ts`.

- [ ] **RED:** Add validation/policy tests in `tests/adapters/validation/**` and `tests/application/annotation/**` for malformed versions, extra fields, missing semantic core, invalid isolation/references, Playwright/selector/code/absolute-path semantic policy, invalid entry points, literal canary secrets, and logical-ID uniqueness. The policy MUST return structured refusal before normalization or a draft call; JSON Schema `uniqueItems` remains limited to byte-identical declarations. **Evidence:** RED then GREEN/TRIANGULATE/REFACTOR with the Slice 5 focused command; rollback: remove only these tests/fixtures. <!-- sdd-owner: implementation -->
- [ ] **GREEN:** Implement `src/adapters/validation/ajv-contract-validator.ts` and `src/application/annotation/{policy,mapper}.ts` with strict Ajv 2020-12; map only approved fields to unchanged `SemanticSource`, then call existing `project()` and `JcsSha256Hasher`. **Evidence:** focused command passes valid mapping while title, contract, capture, request, and artifact data remain outside projection; rollback: remove only validator/mapper source. <!-- sdd-owner: implementation -->
- [ ] **TRIANGULATE:** Add paired interactive-shaped/noninteractive fixtures, stateless/stateful cases, secret-reference checks, semantic hash vectors, and `tests/integration/annotation-association.test.ts` crash windows before claim, after claim/createDraft/reverse-link, and before commit. **Evidence:** Slice 5 focused command proves invalid input never calls `BeaconStore.createDraft`, and retries/conflicts differ materially; rollback: remove only integration fixtures/tests. <!-- sdd-owner: implementation -->
- [ ] **REFACTOR:** Implement `src/application/{annotate-capture,inspect-beacon-draft}.ts` durable claim → unchanged namespaced `BeaconStore.createDraft` → association completion, including hash/revision/open agreement and read-only authority-labeled inspection. **Evidence:** Slice 5 focused command and shared full gate pass for exactly-once recovery, cross-project forgery refusal, and supporting/non-authoritative capture labels; rollback: remove only use cases/association changes, never delete valid drafts. <!-- sdd-owner: implementation -->

## 6. CLI adapters, envelopes, and unregistered command builders

**Start:** Use cases are testable through injected ports but unavailable through Commander.
**Finish:** Builders, prompt/input adapters, composition, envelopes, and exit mapping are testable in-process but not registered as a partial public workflow.
**Rollback boundary:** Remove only `src/cli/{composition,envelope,exit-codes}.ts`, `src/cli/commands/**`, `src/cli/prompts/**`, and their tests; domain/application/storage state remains inert.
**Focused command:** `npm test -- tests/cli/composition.test.ts tests/cli/envelope.test.ts tests/cli/exit-codes.test.ts tests/cli/commands tests/cli/prompts`.

- [ ] **RED:** Add failing `tests/cli/{composition,envelope,exit-codes}.test.ts` for the fixed v1 envelope, one stdout JSON object, exit taxonomy 0/1/2/3/4/5/10, redaction, separated human diagnostics, and an explicit mapping test from domain validator `{rule,field,keyword}` to CLI envelope `{rule,category,field}`. **Evidence:** RED then GREEN/TRIANGULATE/REFACTOR with the Slice 6 focused command; rollback: remove only these CLI-unit tests. <!-- sdd-owner: implementation -->
- [ ] **GREEN:** Implement `src/cli/{composition,envelope,exit-codes}.ts` with injectable command composition that resolves home and builds existing/new adapters without exposing adapter paths. **Evidence:** focused command passes envelopes and typed mappings before command grammar cases; rollback: remove only these CLI composition files. <!-- sdd-owner: implementation -->
- [ ] **TRIANGULATE:** Add `tests/cli/commands/**` and `tests/cli/prompts/**` for exact common/options, capped single-read input, malformed UTF-8/JSON/discriminator/TTY-stdin refusal, no prompt/mutation in noninteractive mode, prompt cancellation, and identical interactive-shaped/JSON contracts. **Evidence:** Slice 6 focused command passes success, known refusal, unmodeled throw, and cancellation fakes; rollback: remove only builder/prompt tests. <!-- sdd-owner: implementation -->
- [ ] **REFACTOR:** Implement unregistered `src/cli/commands/{init,capture-record,capture-annotate,beacon-inspect}.ts` and `src/cli/prompts/**`, keeping Clack out of domain/application and record interactive-only. **Evidence:** Slice 6 focused command and shared full gate pass with no command registration, target mutation, or prohibited lifecycle wording; rollback: remove only command-builder/prompt code. <!-- sdd-owner: implementation -->

## 7. Register the complete public journey, in-process harness, and README

**Start:** Complete command builders exist but root `pharos` exposes only bootstrap help/version.
**Finish:** Exactly the four selected commands are registered; the in-process composition harness proves the full fake-backed journey; package coverage stays safe; README makes only truthful open-draft claims.
**Rollback boundary:** Unregister only these four commands and remove Slice 7 composition/journey/README claims; do not rewrite valid drafts or delete supporting captures.
**Focused command:** `npm test -- tests/cli/program.test.ts tests/cli/distribution.test.ts tests/integration/guided-beacon-capture-program.test.ts`.

- [ ] **RED:** Replace only obsolete catalogue assertions in `tests/cli/program.test.ts` and `tests/cli/distribution.test.ts` with failing expectations for root help/bare invocation listing exactly `init`, `capture record`, `capture annotate <capture-id>`, and `beacon inspect <beacon-id>`, while preserving exact version, shebang, package bin, and unknown command/option exit 2. **Evidence:** RED then GREEN/TRIANGULATE/REFACTOR with the Slice 7 focused command; rollback: remove only Slice 7 package/program assertions. <!-- sdd-owner: implementation -->
- [ ] **GREEN:** Register only the four complete builders in `src/cli/program.ts` and wire `src/cli/index.ts`/`src/cli/composition.ts` once, retaining Commander normalization and typed product exits without aliases or later-lifecycle vocabulary. **Evidence:** focused command passes registration and safe packaged checks before full in-process journey coverage; rollback: unregister only these builders and revert Slice 7 wiring. <!-- sdd-owner: implementation -->
- [ ] **TRIANGULATE:** Add `tests/integration/guided-beacon-capture-program.test.ts` that calls `createProgram`/composition in-process with temporary real ProjectContextStore/CaptureStore/FsBeaconStore/JcsSha256Hasher and a test-local fake `Recorder`; cover init → promoted capture/no Beacon → one open draft/hash → read-only inspection plus refusal/retry/recovery variants. **Evidence:** Slice 7 focused command passes with no packaged child process, browser, target, or test-only shipped hook; rollback: remove only this harness/test-local fakes and journey tests. <!-- sdd-owner: implementation -->
- [ ] **REFACTOR:** Update only relevant `README.md` command/status sections after the harness is green: document the selected four-command non-production open-draft journey, secret-source prerequisite, supporting/non-authoritative recording, opt-in browser prerequisite, and excluded approval/readiness/generation/run/evidence/verification claims. **Evidence:** Slice 7 focused command and shared full gate pass; separately confirm `npm test` remains hermetic and the real probe runs only via `PLAYWRIGHT_CONTRACT=1 npm run test:playwright-contract`; rollback: revert only Slice 7 README and public registration/harness changes. <!-- sdd-owner: implementation -->

## Delivery note

The maintainer explicitly accepted `size:exception` for all seven slices and selected `stacked-to-main`. This acceptance permits apply under the review-workload guard but does not authorize commit, push, pull request creation, publishing, or later-lifecycle scope.

## Slice 1 review corrections

Bounded pre-merge correction to the existing Slice 1 contracts, domain boundary types, and package assets only. It does not implement Slices 2–7 runtime functionality.

- [x] **RED:** Add failing schema, package-distribution, project-context, and capture-port contract assertions for strict top-level variable references, structural tokens, byte-identical declaration duplicates, project normalization/refusals, branded IDs/conflicts, capture barrel exports, and packaged schema assets. **Evidence:** `npm test -- tests/contracts/schemas/contracts.test.ts tests/domain/project/contracts.test.ts tests/domain/capture/contracts.test.ts tests/cli/distribution.test.ts` failed before implementation: 3 files/6 assertions failed (variable shape, structural token, URL normalization/refusal, and both package-asset assertions). **Rollback:** remove only these correction assertions. <!-- sdd-owner: implementation -->
- [x] **GREEN:** Implement only the schema, pure project/capture/port type, and build-copy changes required by the correction; preserve ordinary nested JSON objects and leave selector semantics to Slice 5. **Evidence:** the focused correction command passed: 4 files, 24 tests. **Rollback:** revert only these correction source and packaging changes. <!-- sdd-owner: implementation -->
- [x] **TRIANGULATE:** Prove materially distinct valid/invalid variable, token, duplicate-declaration, URL/timestamp, ID, and installed-package schema-asset cases. **Evidence:** focused correction command passed (4 files, 24 tests), including complete/malformed variable references, structural token versus slash/parenthesis syntax, exact versus logical-ID duplicate declarations, normalized/credentialed/no-host URLs, canonical timestamps, branded type assertions, all three installed-consumer schema assets, and the retained executable shim/help/version checks. **Rollback:** remove only the extra correction fixtures/assertions. <!-- sdd-owner: implementation -->
- [x] **REFACTOR:** Remove the tautological unused draft spy, clarify Slice 1 evidence and future Slice 5/6 ownership, and keep correction tests readable without semantic-policy implementation. **Evidence:** focused correction suite (4 files, 24 tests), `npm test` (32 files, 302 tests), lint, typecheck, build, `git diff --check`, and dry-run pack all passed. The restored readable baseline installs the packed package into a temporary offline consumer and verifies installed schema readability plus the executable shebang, shim, help, and version. Runtime harness is N/A because this pure/package correction must not launch Playwright/Chromium, use a TTY, or contact a target. **Rollback:** revert only the correction files. <!-- sdd-owner: implementation -->
