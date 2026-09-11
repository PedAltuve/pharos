# Apply Progress — Guided Beacon Capture

## Scope and status

- **Work unit:** `slice-1-script-contract-correction` (maintainer-authorized narrower correction of Slice 1)
- **Delivery boundary:** Slice 1 only, `stacked-to-main`; accepted `size:exception` remains applicable. No commit, push, PR, publishing, browser install/launch, target contact, or external-repository modification was performed.
- **Status:** complete. The legacy distribution test now preserves exact package-script enforcement while including the required `test:playwright-contract` script. The unused `src/domain/index.ts` root barrel was deleted.

## Structured status consumed/produced

```yaml
schemaName: gentle-pi.sdd-status
changeName: guided-beacon-capture
artifactStore: openspec
nativeAttemptAcquire:
  state: proceed
  workUnit: slice-1-script-contract-correction
  token: parent-retained-not-read-or-persisted
planningHome:
  root: /home/pedro/pharos-worktrees/guided-beacon-capture
  changesDir: /home/pedro/pharos-worktrees/guided-beacon-capture/openspec/changes
changeRoot: /home/pedro/pharos-worktrees/guided-beacon-capture/openspec/changes/guided-beacon-capture
actionContext:
  mode: repo-local
  workspaceRoot: /home/pedro/pharos-worktrees/guided-beacon-capture
  allowedEditRoots:
    - /home/pedro/pharos-worktrees/guided-beacon-capture
  warnings: []
applyState: slice-1-complete
nextRecommended: parent-lifecycle
```

## Completed implementation tasks and checkbox evidence

The persisted task artifact was re-read after updating it. All four implementation-owned Slice 1 rows are visibly checked:

- RED — domain/schema contract tests for v1 discriminators, typed refusals, generated IDs, promoted-only eligibility, and the frozen semantic boundary.
- GREEN — pure project/capture concepts, ports, domain barrels, and JSON Schema 2020-12 contracts.
- TRIANGULATE — production, incomplete/oversized annotation, isolation, duplicate declaration, selector/path, secret-placeholder, and no-draft-operation fixtures.
- REFACTOR — exact pinned public-contract dependencies/probe and its required package script; correction additionally updated the exact distribution script list and removed the unused domain root barrel.

No Slice 2–7 task was started. There are no parent-owned task rows.

## Files changed

### Cumulative Slice 1 implementation

- `src/domain/project/**`, `src/domain/capture/**`
- `src/domain/ports/{clock,id-generator,project-context-store,capture-store,recorder,secret-resolver,sensitivity-scanner,contract-validator}.ts` and `src/domain/ports/index.ts`
- `src/contracts/schemas/{project-init,capture-annotation,cli-envelope}.schema.json`
- `tests/domain/project/contracts.test.ts`, `tests/domain/capture/contracts.test.ts`, `tests/contracts/schemas/contracts.test.ts`
- `package.json`, `package-lock.json`, `vitest.playwright-contract.config.ts`, `tests/contracts/playwright/public-cli-contract.probe.ts`

### This correction

- `tests/cli/distribution.test.ts` — preserves the exact script allowlist and adds `test:playwright-contract`.
- `src/domain/index.ts` — deleted; it had no callers/importers and is not required by Slice 1.
- `openspec/changes/guided-beacon-capture/tasks.md`
- `openspec/changes/guided-beacon-capture/apply-progress.md`

## TDD Cycle Evidence

| Cycle | RED | GREEN | TRIANGULATE | REFACTOR / result |
|---|---|---|---|---|
| Project/capture concepts and schemas | Focused contracts/schemas command failed before implementation because new domain modules and Ajv 8 were absent. | Smallest pure contracts/schemas passed. | Distinct isolation, secret-redaction, and unsafe-machine fixtures passed. | Strict-schema cleanup passed: 14 tests. |
| Opt-in public CLI contract | N/A: a separate public-package probe intentionally excluded from the default Vitest glob. | Direct declared-bin/public-help probe passed. | No browser or Chromium behavior is claimed. | Missing-browser, TTY, and signal behavior remain explicit host-prerequisite skips. |
| Script-contract correction | `npm test -- tests/cli/distribution.test.ts tests/domain/project tests/domain/capture tests/contracts/schemas` failed as expected: one old exact-list assertion rejected `test:playwright-contract` (18 passed, 1 failed). | Updating that existing expectation passed its focused distribution suite (5 tests). | Triangulation skipped: this is a single exact static manifest-list contract; the full focused command exercises it alongside three independent Slice 1 contract suites. | Deleted the unused root barrel; the required focused command passed (4 files, 19 tests). |

## Verification evidence

| Command | Result |
|---|---|
| `npm test -- tests/cli/distribution.test.ts tests/domain/project tests/domain/capture tests/contracts/schemas` | PASS after correction: 4 files, 19 tests. Its pre-correction RED run was 18 passed, 1 failed at the old exact script list. |
| `PLAYWRIGHT_CONTRACT=1 npm run test:playwright-contract` | PASS: 1 passed, 1 explicit skip. The probe only invokes public CLI help; no browser was installed or launched, no TTY/signal/missing-browser proof is claimed, and no target was contacted. |
| `npm test` | PASS: 32 files, 297 tests. The probe is not discovered by the default glob. |
| `npm run lint` | PASS; existing eslint-boundaries deprecation warnings only. |
| `npm run typecheck` | PASS. |
| `npm run build` | PASS. |
| `git diff --check` | PASS. |

## Design deviations and risks

- The prior script-contract correction had no production-contract deviation. The current bounded correction changes only the documented Slice 1 schema/domain/package boundary; no Slice 2–7 runtime behavior was added.
- The one-skip limitation remains explicit: browser launch, missing-browser diagnostics, and signal/TTY forwarding require an operator-preinstalled matching Chromium and interactive TTY. They were not run or claimed.
- Slice 2–7 remain out of scope and are deferred to their assigned work units.

## Workload / PR boundary

- **Boundary:** Slice 1 correction only; no commit or PR was created.
- **Delivery strategy:** `stacked-to-main`, accepted `size:exception`; no further slicing or delivery action is authorized here.
- **Rollback boundary:** restore the former exact script expectation and unused root barrel deletion only; no other Slice 1 behavior needs reversal.

## Remaining tasks

The following are the exact unchecked implementation-owned task rows persisted in `tasks.md`:
- [ ] **RED:** Add `tests/application/initialize-project.test.ts` for local/test/staging creation, production and invalid-URL refusal, same-request replay, different-input conflict, and absence of Beacon/capture side effects. **Evidence:** RED then GREEN/TRIANGULATE/REFACTOR with `npm test -- tests/application/initialize-project.test.ts tests/adapters/fs-project-context-store tests/adapters/fs-project`; rollback: remove only this test's Slice 2 cases. <!-- sdd-owner: implementation -->
- [ ] **GREEN:** Implement `src/application/initialize-project.ts` and its normalization seam using injected clock, ID generator, project store, and canonical association path; allow only absolute home overrides or supported defaults. **Evidence:** focused command passes creation/replay cases before distinct filesystem failure cases are added; rollback: remove only the new use case/normalization code. <!-- sdd-owner: implementation -->
- [ ] **TRIANGULATE:** Add `tests/adapters/fs-project-context-store/**` and `tests/adapters/fs-project/**` for 0700/0600 modes, write-once journal recovery, canonical longest-path selection, explicit-ID mismatch, symlink/path containment refusal, and byte-identical external fixture repository. **Evidence:** focused command passes success, conflict, and injected permission/rename/fsync/lstat/realpath failures; rollback: remove only the new adapter fixtures and tests. <!-- sdd-owner: implementation -->
- [ ] **REFACTOR:** Implement `src/adapters/fs-project-context-store/**` and only compatibility-preserving atomic/lock/containment helpers in `src/adapters/fs-project/**`; preserve existing `src/adapters/fs-beacon-store/**` behavior and tests. **Evidence:** focused command and the shared full gate pass after fixture deduplication; rollback: revert only this store/helper extraction, leaving existing BeaconStore unchanged. <!-- sdd-owner: implementation -->
- [ ] **RED:** Add lifecycle-table tests under `tests/adapters/fs-capture-store/**` for legal `running → post_exit → resolving → promoted|rejected` and `running → resolving → failed|interrupted` transitions, illegal-transition refusal, and non-promoted annotation refusal. **Evidence:** RED then GREEN/TRIANGULATE/REFACTOR with the Slice 3 focused command; rollback: remove only the lifecycle-table additions. <!-- sdd-owner: implementation -->
- [ ] **GREEN:** Implement `src/adapters/fs-capture-store/**` with project lock, request journal, private staging, safe terminal serialization, promoted-artifact references, and forward/reverse association records outside `SemanticSource` and `FsBeaconStore`. **Evidence:** focused command passes lifecycle persistence before crash cases; rollback: remove only CaptureStore source and its Slice 3 wiring. <!-- sdd-owner: implementation -->
- [ ] **TRIANGULATE:** Add failure-injection coverage for crashes before/after session writes, resolution decisions, exclusive materialization, stage unlink, and journal completion; cover same-key replay/conflict, modes, symlink substitution, stale/live temp files, and no raw bytes after reject/fail/interruption. **Evidence:** Slice 3 focused command proves recovery completes only a durable decision and a second recovery is a no-op; rollback: remove only failure-injection fixtures/tests. <!-- sdd-owner: implementation -->
- [ ] **REFACTOR:** Extract only shared atomic/lock helpers required by both filesystem stores with compatibility exports, retaining existing BeaconStore recovery/concurrency coverage. **Evidence:** Slice 3 focused command and shared full gate pass with no overwrite of a promoted destination; rollback: revert only the helper extraction and CaptureStore changes. <!-- sdd-owner: implementation -->
- [ ] **RED:** Add `tests/application/record-capture.test.ts` requiring declared `--secret-source env:NAME` or `--no-secret-sources`, transient resolution before allocation/spawn, persisted `running` before prerequisite outcome, and no secret leakage for missing/empty sources. **Evidence:** RED then GREEN/TRIANGULATE/REFACTOR with the Slice 4 focused command; rollback: remove only these application tests. <!-- sdd-owner: implementation -->
- [ ] **GREEN:** Implement `src/application/record-capture.ts` and `src/adapters/secrets/env-secret-resolver.ts`; bind replay identity to context/input references rather than resolved values and dispose values after terminalization. **Evidence:** focused command passes declared-source and replay cases before process/scanner edge cases; rollback: remove only these application/resolver files. <!-- sdd-owner: implementation -->
- [ ] **TRIANGULATE:** Add adapter tests in `tests/adapters/playwright/**` and `tests/adapters/sensitivity/**` for the Slice 1 documented arg vector, `shell: false`, no download/install, inherited TTY/stdout isolation, cancellation/non-zero/spawn cases, encoded canary values, scan failure, staged symlink/mutation, and pre-existing destination. **Evidence:** Slice 4 focused command passes without a real browser, target, or opt-in probe; rollback: remove only these fake-process/scanner tests. <!-- sdd-owner: implementation -->
- [ ] **REFACTOR:** Implement `src/adapters/playwright/playwright-recorder.ts` solely from the opt-in documented contract and `src/adapters/sensitivity/literal-sensitivity-scanner.ts`; persist a durable scan decision before exclusive promotion or cleanup and return only stable safe metadata. **Evidence:** Slice 4 focused command and shared full gate pass for cancellation, rejection, recovery retry, one terminal capture, no Beacon call, and no target mutation; rollback: remove only recorder/scanner source and Slice 4 helpers. <!-- sdd-owner: implementation -->
- [ ] **RED:** Add validation/policy tests in `tests/adapters/validation/**` and `tests/application/annotation/**` for malformed versions, extra fields, missing semantic core, invalid isolation/references, Playwright/selector/code/absolute-path semantic policy, invalid entry points, literal canary secrets, and logical-ID uniqueness. The policy MUST return structured refusal before normalization or a draft call; JSON Schema `uniqueItems` remains limited to byte-identical declarations. **Evidence:** RED then GREEN/TRIANGULATE/REFACTOR with the Slice 5 focused command; rollback: remove only these tests/fixtures. <!-- sdd-owner: implementation -->
- [ ] **GREEN:** Implement `src/adapters/validation/ajv-contract-validator.ts` and `src/application/annotation/{policy,mapper}.ts` with strict Ajv 2020-12; map only approved fields to unchanged `SemanticSource`, then call existing `project()` and `JcsSha256Hasher`. **Evidence:** focused command passes valid mapping while title, contract, capture, request, and artifact data remain outside projection; rollback: remove only validator/mapper source. <!-- sdd-owner: implementation -->
- [ ] **TRIANGULATE:** Add paired interactive-shaped/noninteractive fixtures, stateless/stateful cases, secret-reference checks, semantic hash vectors, and `tests/integration/annotation-association.test.ts` crash windows before claim, after claim/createDraft/reverse-link, and before commit. **Evidence:** Slice 5 focused command proves invalid input never calls `BeaconStore.createDraft`, and retries/conflicts differ materially; rollback: remove only integration fixtures/tests. <!-- sdd-owner: implementation -->
- [ ] **REFACTOR:** Implement `src/application/{annotate-capture,inspect-beacon-draft}.ts` durable claim → unchanged namespaced `BeaconStore.createDraft` → association completion, including hash/revision/open agreement and read-only authority-labeled inspection. **Evidence:** Slice 5 focused command and shared full gate pass for exactly-once recovery, cross-project forgery refusal, and supporting/non-authoritative capture labels; rollback: remove only use cases/association changes, never delete valid drafts. <!-- sdd-owner: implementation -->
- [ ] **RED:** Add failing `tests/cli/{composition,envelope,exit-codes}.test.ts` for the fixed v1 envelope, one stdout JSON object, exit taxonomy 0/1/2/3/4/5/10, redaction, separated human diagnostics, and an explicit mapping test from domain validator `{rule,field,keyword}` to CLI envelope `{rule,category,field}`. **Evidence:** RED then GREEN/TRIANGULATE/REFACTOR with the Slice 6 focused command; rollback: remove only these CLI-unit tests. <!-- sdd-owner: implementation -->
- [ ] **GREEN:** Implement `src/cli/{composition,envelope,exit-codes}.ts` with injectable command composition that resolves home and builds existing/new adapters without exposing adapter paths. **Evidence:** focused command passes envelopes and typed mappings before command grammar cases; rollback: remove only these CLI composition files. <!-- sdd-owner: implementation -->
- [ ] **TRIANGULATE:** Add `tests/cli/commands/**` and `tests/cli/prompts/**` for exact common/options, capped single-read input, malformed UTF-8/JSON/discriminator/TTY-stdin refusal, no prompt/mutation in noninteractive mode, prompt cancellation, and identical interactive-shaped/JSON contracts. **Evidence:** Slice 6 focused command passes success, known refusal, unmodeled throw, and cancellation fakes; rollback: remove only builder/prompt tests. <!-- sdd-owner: implementation -->
- [ ] **REFACTOR:** Implement unregistered `src/cli/commands/{init,capture-record,capture-annotate,beacon-inspect}.ts` and `src/cli/prompts/**`, keeping Clack out of domain/application and record interactive-only. **Evidence:** Slice 6 focused command and shared full gate pass with no command registration, target mutation, or prohibited lifecycle wording; rollback: remove only command-builder/prompt code. <!-- sdd-owner: implementation -->
- [ ] **RED:** Replace only obsolete catalogue assertions in `tests/cli/program.test.ts` and `tests/cli/distribution.test.ts` with failing expectations for root help/bare invocation listing exactly `init`, `capture record`, `capture annotate <capture-id>`, and `beacon inspect <beacon-id>`, while preserving exact version, shebang, package bin, and unknown command/option exit 2. **Evidence:** RED then GREEN/TRIANGULATE/REFACTOR with the Slice 7 focused command; rollback: remove only Slice 7 package/program assertions. <!-- sdd-owner: implementation -->
- [ ] **GREEN:** Register only the four complete builders in `src/cli/program.ts` and wire `src/cli/index.ts`/`src/cli/composition.ts` once, retaining Commander normalization and typed product exits without aliases or later-lifecycle vocabulary. **Evidence:** focused command passes registration and safe packaged checks before full in-process journey coverage; rollback: unregister only these builders and revert Slice 7 wiring. <!-- sdd-owner: implementation -->
- [ ] **TRIANGULATE:** Add `tests/integration/guided-beacon-capture-program.test.ts` that calls `createProgram`/composition in-process with temporary real ProjectContextStore/CaptureStore/FsBeaconStore/JcsSha256Hasher and a test-local fake `Recorder`; cover init → promoted capture/no Beacon → one open draft/hash → read-only inspection plus refusal/retry/recovery variants. **Evidence:** Slice 7 focused command passes with no packaged child process, browser, target, or test-only shipped hook; rollback: remove only this harness/test-local fakes and journey tests. <!-- sdd-owner: implementation -->
- [ ] **REFACTOR:** Update only relevant `README.md` command/status sections after the harness is green: document the selected four-command non-production open-draft journey, secret-source prerequisite, supporting/non-authoritative recording, opt-in browser prerequisite, and excluded approval/readiness/generation/run/evidence/verification claims. **Evidence:** Slice 7 focused command and shared full gate pass; separately confirm `npm test` remains hermetic and the real probe runs only via `PLAYWRIGHT_CONTRACT=1 npm run test:playwright-contract`; rollback: revert only Slice 7 README and public registration/harness changes. <!-- sdd-owner: implementation -->

## Slice 1 review corrections — current apply

Parent-provided `gentle-ai.sdd-status` v2 was consumed: change `guided-beacon-capture`; store `openspec`; `applyState: ready`; `nextRecommended: apply`; `dependencies.apply: ready`; action context `repo-local`, workspace/only allowed root `/home/pedro/pharos-worktrees/guided-beacon-capture`, warnings `[]`. The parent-acquired runtime token was not read, acquired, settled, reset, or persisted.

All four implementation-owned correction rows are visibly checked; no Slice 2–7 checkbox changed. The schema reserves top-level variable references, keeps nested ordinary JSON and byte-identical-only uniqueness, and defers selector semantics/logical-ID refusal to Slice 5. `createProjectContext` now normalizes safe HTTP(S) URLs, trims names, and requires canonical ISO timestamps; `ProjectRequestId`, `BeaconId`, and capture refusal exports have type coverage. Build copies three schemas to `dist/contracts/schemas`; package tests require all three in the dry-run file list, then install the packed archive into a temporary offline consumer and read all three schemas from `node_modules/pharos/`. The readable HEAD distribution baseline retains installed manifest/bin/shebang/shim/help/version coverage. The unused `vi.fn()` draft assertion was removed; prior probe evidence claims only declared-bin/public-help, with browser/TTY/signal skipped.

**This rerun changed only:** `tests/cli/distribution.test.ts`, `openspec/changes/guided-beacon-capture/tasks.md`, and this progress file. No file outside those allowed surfaces changed during this rerun; the other uncommitted Slice 1 correction paths pre-existed it. The final current worktree diff relative to `bf764da04118947ccf9f0e42a42c7d15866042d9`, including untracked `scripts/copy-contract-schemas.mjs`, is 204 additions + 75 deletions = 279 lines (within the 400-line budget). **Workload / PR boundary:** the bounded Slice 1 correction remains the one `stacked-to-main` work unit; no commit or PR was created.

### TDD Cycle Evidence

| Cycle | RED | GREEN | TRIANGULATE | REFACTOR / result |
|---|---|---|---|---|
| Slice 1 review corrections | `npm test -- tests/contracts/schemas/contracts.test.ts tests/domain/project/contracts.test.ts tests/domain/capture/contracts.test.ts tests/cli/distribution.test.ts` failed genuinely: 3 files, 6 failed assertions (variable shape, structural token, URL normalization/refusal, and two package-asset checks). | The same focused command passed: 4 files, 24 tests. | The same focused command passed materially distinct variable/token/declaration/URL/timestamp/typed-ID/installed-consumer-schema cases: 4 files, 24 tests. | A TypeScript narrowing cleanup in the distribution test was required after `npm run typecheck` reported `report` could be undefined. Focused suite then passed (4/24), followed by full verification. |
| Automatic-gate distribution regression rerun | Safety net: the regressed distribution suite passed 5/5. The restored installed-consumer schema assertion intentionally expected draft 2019-09 and failed 4 passed, 1 failed, proving it read the installed 2020-12 asset. | Correcting the expected 2020-12 draft passed the focused correction command: 4 files, 24 tests; no production file changed in this rerun. | The loop reads all three stable installed schema paths, while the retained installed executable assertions exercise manifest/bin/shebang/shim/help/version. | Restored the readable `bf764da` test baseline and layered only the schema-path/file-list/installed-read assertions; focused suite and full gates remain green. |

### Verification

| Command | Result |
|---|---|
| focused correction command | PASS: 4 files, 24 tests |
| `npm test` | PASS: 32 files, 302 tests |
| `npm run lint` | PASS; existing eslint-boundaries deprecation warnings only |
| `npm run typecheck` | PASS |
| `npm run build` | PASS; executes `tsc` then `scripts/copy-contract-schemas.mjs` |
| `git diff --check` | PASS |
| `npm pack --dry-run --json --ignore-scripts` | PASS; lists `dist/contracts/schemas/{project-init,capture-annotation,cli-envelope}.schema.json` |

**Runtime harness:** N/A—this pure/package correction did not launch Playwright/Chromium, use a TTY, contact a target, install repository dependencies, or install browsers. The temporary consumer performed only the required offline `npm install --ignore-scripts --offline --no-audit --no-fund --package-lock=false` of the just-packed archive; the parent token was untouched. **Boundary/rollback:** bounded Slice 1 correction only; revert its schema, project/capture/port types, copy/build step, tests, and evidence. No Slice 2–7 runtime behavior. **No commit:** no commit, push, amend, rebase, issue/PR edit, or publishing.

## Slice 2 apply — project context and initialization

### Structured status consumed

Parent-provided `gentle-ai.sdd-status` v2 was consumed as authoritative: change `guided-beacon-capture`; `artifactStore: openspec`; `applyState: ready`; `dependencies.apply: ready`; `nextRecommended: apply`; repository-local action context with workspace and only allowed edit root `/home/pedro/pharos-worktrees/guided-beacon-capture`; warnings `[]`. Parent-owned attempt authority for `slice-2-project-context-initialization` was not acquired, inspected, settled, reset, or persisted here.

### Completed tasks and persisted checkbox evidence

All four implementation-owned Slice 2 rows are now visibly `- [x]` in `tasks.md`:

- RED: application tests establish non-production creation, invalid/prod refusal, replay/conflict forwarding, and no Beacon/CaptureStore dependency.
- GREEN: `InitializeProject` constructs validated context with injected clock/IDs and delegates application-owned routing to the context store.
- TRIANGULATE: filesystem tests cover private modes, write-once recovery, conflict, canonical nested selection, external-byte preservation, symlink refusal, and injected chmod/rename/fsync/lstat/realpath/mkdir failures.
- REFACTOR: filesystem helpers centralize private directory, canonical-path, atomic private JSON, home resolution, and operation-observer seams. No `fs-beacon-store` source changed.

The persisted task artifact was re-read after all updates: Slice 2 has no unchecked row. Slices 3–7 remain the exact 20 unchecked implementation-owned rows already recorded verbatim in the `Remaining tasks` snapshot above and unchanged in `tasks.md`; no parent-owned rows exist.

### Files changed

- `src/application/initialize-project.ts`
- `src/adapters/fs-project/{index,home,filesystem}.ts`
- `src/adapters/fs-project-context-store/index.ts`
- `tests/application/initialize-project.test.ts`
- `tests/adapters/fs-project/fs-project.test.ts`
- `tests/adapters/fs-project-context-store/fs-project-context-store.test.ts`
- `openspec/changes/guided-beacon-capture/{tasks,apply-progress}.md`

### TDD Cycle Evidence

| Cycle | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|
| InitializeProject application use case | Required focused command failed with module-not-found for `initialize-project.js`. | Added the minimal injected use case; focused command passed, 1 file / 5 tests. | Local/test/staging creation plus production/invalid URL and store replay/conflict cases passed. | Kept the use case port-only; no Beacon/CaptureStore dependency. |
| Context store and home/filesystem adapters | Required focused command failed with both adapter modules missing. | Private context/journal/association materialization passed, 3 files / 12 tests. | Nested association, replay, mismatch, external byte identity, symlink refusal, and failure injection passed, 3 files / 19 tests. | Extracted narrow private-directory/canonical/atomic helpers; focused tests stayed green. |
| Filesystem failure seams | New chmod-injection test failed genuinely because the observer did not cover permission changes. | Added the `chmod` observer hook; focused adapter test passed, 8 tests. | Distinct lstat, realpath, mkdir, chmod, rename, and fsync injected failures are asserted. | The operation observer matches the existing atomic-writer test-observer pattern and remains adapter-local. |

### Verification

| Command | Result |
|---|---|
| `npm test -- tests/application/initialize-project.test.ts tests/adapters/fs-project-context-store tests/adapters/fs-project` | PASS: 3 files, 19 tests. RED evidence: initial app run failed for missing use case; adapter run failed for both missing adapters; chmod seam run failed 1/8 before its GREEN change. |
| `npm test` | PASS: 35 files, 321 tests; hermetic—no browser, TTY, target, external repository, or Playwright probe used. |
| `npm run lint` | PASS; existing eslint-boundaries deprecation warnings only. |
| `npm run typecheck` | PASS. |
| `npm run build` | PASS. |
| `git diff --check` | PASS. |

**Runtime harness:** N/A—Slice 2 is an injected application/filesystem boundary, not a registered CLI journey. Its real temporary-filesystem tests prove application-owned storage only; they neither launch a browser nor use a TTY, target, or external repository. **Deviation/advisories:** no design deviation. The Slice 1 project request-ID branding/distinction and schema-copy synchronization/staleness advisories remain carried forward and were not broadened. **Workload / PR boundary:** Slice 2 only, `stacked-to-main`, with the maintainer-accepted `size:exception`; no commit or PR was created. **Rollback boundary:** remove only the Slice 2 application/context-store/fs-project helpers and their tests; already-created Pharos-home context files remain inert and are not destructively removed. **No delivery actions:** no commit, push, PR/issue action, publishing, browser install/launch, target contact, or external repository modification occurred.

## Slice 2 replay correction — project context

### Structured status consumed

Parent-provided `gentle-ai.sdd-status` v2 was authoritative: change `guided-beacon-capture`, store `openspec`, `applyState: ready`, proposal/specs/design/tasks `all_done`, verify/archive blocked, and `nextRecommended: apply`. Action context was `repo-local` with workspace and only allowed root `/home/pedro/pharos-worktrees/guided-beacon-capture`; warnings were empty. Parent-owned correction-attempt authority for `slice-2-project-context-replay-correction` was neither acquired, inspected, settled, reset, nor persisted.

### Correction

`FsProjectContextStore.initialize()` now treats only `requestId`, `inputHash`, and canonical `associationPath` as durable replay identity. The generated `ProjectContext` is a proposal for an initial plan only, so a same-input retry returns the stored project ID/timestamp rather than conflicting when injected IDs or clock values advance. The pre-existing typed `project-request-conflict` remains for changed stable input. No port/domain signature changed. Initialization remains isolated to the Pharos home: no Beacon/CaptureStore dependency, association-path write, or external-target write was introduced.

### TDD Cycle Evidence

| Cycle | Evidence |
|---|---|
| RED | Added an application-to-real-filesystem regression with advancing injected project IDs and clock timestamps. `npm test -- tests/application/initialize-project.test.ts` failed genuinely: retry returned `project-request-conflict` instead of the original persisted context (1 failed, 5 passed). |
| GREEN | Removed generated-context equality from the durable replay comparison and documented the stable identity boundary. The required focused command passed: 3 files, 20 tests. |
| TRIANGULATE | Added the distinct advancing-fakes changed-`inputHash` retry case; it returns typed `project-request-conflict`. Focused command passed: 3 files, 21 tests. |
| REFACTOR | Extracted the advancing-fakes fixture helper in the application test; focused command remained green: 3 files, 21 tests. |

### Final verification

| Command | Result |
|---|---|
| `npm test -- tests/application/initialize-project.test.ts` | First invocation from the parent checkout found no matching test file (exit 1); rerun from the authoritative worktree produced the RED failure above. |
| `npm test -- tests/application/initialize-project.test.ts tests/adapters/fs-project-context-store tests/adapters/fs-project` | PASS after GREEN, TRIANGULATE, and REFACTOR: 3 files, 21 tests. |
| `npm test` | PASS: 35 files, 323 tests; hermetic. |
| `npm run lint` | PASS; existing eslint-boundaries deprecation warnings only. |
| `npm run typecheck` | PASS. |
| `npm run build` | PASS. |
| `git diff --check` | PASS. |

### Persisted task and delivery boundary

The four Slice 2 implementation-owned task rows remain visibly checked because their final evidence remains true. Slices 3–7 remain unchanged and unchecked; the exact persisted unchecked rows remain in the earlier `Remaining tasks` snapshot in this cumulative artifact. No parent-owned rows exist.

**Correction files:** `src/adapters/fs-project-context-store/index.ts`, `tests/application/initialize-project.test.ts`, and this progress artifact. `tasks.md` was re-read but did not require a checkbox edit. **Runtime harness:** N/A—no registered CLI or runtime boundary exists for this adapter/use-case correction. No browser/TTY/target/external repository was used. **Rollback boundary:** revert only the durable replay comparison/comment and advancing-fakes regression helper/tests; existing initial Slice 2 context-store behavior and any already-created Pharos-home files remain otherwise untouched. **Delivery boundary:** Slice 2 correction only, `stacked-to-main`, maintainer-accepted `size:exception`; no commit, push, PR/issue action, publication, install, browser launch, target contact, or external-repository modification occurred.

## Slice 2 independent-verifier remediation

### Structured status consumed

The parent-provided authoritative `gentle-ai.sdd-status@2` was consumed: change `guided-beacon-capture`; store `openspec`; proposal/specs/design/tasks done; `applyState: ready`; `dependencies.apply: ready`; `nextRecommended: apply`; repo-local action context with workspace and only allowed root `/home/pedro/pharos-worktrees/guided-beacon-capture`; warnings `[]`. Parent-owned attempt authority for `slice-2-independent-verifier-remediation` was not acquired, inspected, settled, reset, or persisted.

### Remediation completed

1. Private initialization-plan, association, and `project.json` state reads now reject symlinked/non-regular descendants. Existing-file adoption validates with `lstat`; reads validate then use a `O_NOFOLLOW` descriptor and require a regular file before parsing.
2. Explicit `resolveById(projectId, canonicalCurrentPath?)` verifies the persisted context embeds the selected ID and rejects a conflicting nearest current-path association with the existing `project-association-mismatch` refusal. Implicit longest-path routing still resolves the nearest association.
3. `InitializeProjectRequest` no longer accepts `inputHash`. The use case hashes normalized name, mode, environment, base URL, and association path through the injected `Hasher`; generated project ID and timestamp remain excluded. Changed semantic input under one request conflicts, while normalized equivalents replay.

### Persisted task evidence

`tasks.md` was re-read after this remediation. Its four implementation-owned Slice 2 rows remain visibly `- [x]`; their actual proof now covers descendant state-file symlinks, explicit-ID/current-path mismatch, and trusted request identity. No checkbox changed because no new Slice 2 task was completed, and Slices 3–7 remain unchecked. There are no parent-owned rows.

### TDD Cycle Evidence

| Finding | Layer / safety net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|
| Descendant state-file symlink | Temporary-filesystem adapter; pre-edit focused suite: 3 files, 21 tests PASS | New plan, association, and `project.json` symlink cases failed genuinely: 3 failures; each symlinked state path was accepted. | Added exclusive-existing-file validation and no-follow regular-file reads; focused adapter/application suite passed 23 tests. | The three distinct state locations all reject, rather than relying only on prior home-root coverage. | Kept the policy in shared private-state helpers so plan/association/context readers use one check; focused suite passed 32 tests. |
| Explicit project ID/path mismatch | Temporary-filesystem adapter; same safety net | New current-path association and substituted embedded-ID cases both failed genuinely, returning the wrong context. | Added explicit-path verification and embedded-ID agreement; focused suite passed 23 tests. | Covers both an otherwise-valid selected project under another association and a valid-shaped substituted `project.json`; implicit nested selection remains covered. | Extracted nearest-association lookup while retaining longest-path traversal; focused suite passed 32 tests. |
| Caller-controlled initialization identity | Application plus real temporary filesystem; same safety net | Four changed normalized semantic-field cases and caller-hash assertion failed genuinely (5 failures); association-path conflict already had real coverage. | Removed the caller field and derived identity after `createProjectContext`; focused suite passed 23 tests. | Added equivalent whitespace/trailing-slash normalization replay with advancing IDs/clocks; focused suite passed 32 tests. | Extracted `initializationInputHash` to make the excluded generated fields explicit; focused suite passed 32 tests. |

### Verification

| Command | Result |
|---|---|
| `npm test -- tests/application/initialize-project.test.ts tests/adapters/fs-project-context-store tests/adapters/fs-project` | PASS: 3 files, 32 tests. |
| `npm test` | PASS: 35 files, 334 tests; hermetic (no browser, TTY, target, or external repository). |
| `npm run lint` | PASS; existing eslint-boundaries deprecation warnings only. |
| `npm run typecheck` | PASS. |
| `npm run build` | PASS. |
| `git diff --check` | PASS. |

All eight intended untracked files were explicitly checked with `git diff --no-index --check` and for conflict/error markers; all passed. The runtime harness is N/A: this is an injected application/filesystem boundary and did not launch a CLI, browser, TTY, or target.

### Files, scope, and rollback

**Changed in this remediation:**

- `src/application/initialize-project.ts`
- `src/domain/ports/project-context-store.ts`
- `src/adapters/fs-project/filesystem.ts`
- `src/adapters/fs-project-context-store/index.ts`
- `tests/application/initialize-project.test.ts`
- `tests/adapters/fs-project-context-store/fs-project-context-store.test.ts`
- `openspec/changes/guided-beacon-capture/apply-progress.md`

No Slice 3–7 file or behavior was implemented. This remains the Slice 2 `stacked-to-main` work unit under the accepted `size:exception`; no commit, push, PR/issue edit, publication, install, browser launch, target contact, or external-repository modification occurred. **Rollback boundary:** revert only the listed remediation source/test changes; leave existing Pharos-home state inert and do not rewrite target repositories.
