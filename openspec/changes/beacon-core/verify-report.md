```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:195699e9e7863cce3801b3b3e461c67ec73d80374a863407f5288c65645df33c
verdict: pass
blockers: 0
critical_findings: 0
requirements: 14/14
scenarios: 25/25
test_command: npm test
test_exit_code: 0
test_output_hash: sha256:9cbf76a525c12ae1fd3141a9561d02d065596df79ba7c314ad3374f916d50d3c
build_command: npm run build
build_exit_code: 0
build_output_hash: sha256:9a7b581687e6658fe0477421daba6a5a0f4e5ae253c2c562a298e3e8dc2eb7e9
```

## Verification Report

**Change**: beacon-core
**Version**: N/A
**Mode**: Strict TDD (final re-verify, post-remediation-rebase)
**Branch verified**: `change/beacon-core-c2c` at `f266ca7`
**Required base**: `582fc1f` (master, untouched)
**Evidence revision derivation**: `sha256(commit:f266ca7...326e1|test:<test_output_hash>|build:<build_output_hash>)`, recorded above.

### Context

This is the FINAL verify after an operator review found 3 code blockers against the ratified `beacon-core` spec text. Specs were amended (`beacon-draft-lifecycle` 7 req/12 scen, `beacon-version-lifecycle` 6 req/10 scen, `project-toolchain` 1 req/3 scen — totals 14 req/25 scenarios, confirmed by direct file count of `### Requirement:`/`#### Scenario:` headings across the three spec files) and 4 operator-ratified remediation fixes were woven into the original stacked commits by interactive rebase:

1. Stale-origin gate is plain inequality (`draft.origin.branchedFromVersion !== beacon.activeVersionId`) — both null directions are stale.
2. `getOwn` own-property helper (`src/domain/beacon/records.ts`, `Object.hasOwn` guard) routes all 10 caller-supplied-id lookups against `Record`-shaped stores.
3. `resolveActiveVersion` throws when the resolved record's embedded `versionId` differs from the `activeVersionId` lookup key.
4. `abandonDraft` takes a `Hasher` as a third parameter and records `finalHash: hasher.hash(project(draft.content))` in the tombstone.

Rebuilt stack (nothing pushed, `master` untouched at `582fc1f`): `bf058ff → 8753c38 → ac48d48 → 5b8a495 (new branch change/beacon-core-c2a1) → 7893900 → d389973+f7cadf4 (C2b, size:exception re-ratified at 611) → 312696b` (C2c) + artifacts commit `f266ca7` (docs-only).

### Remediated Defects — In-Depth Verification

Each of the 3 original blockers plus the finalHash/Hasher addition was independently re-executed in this session with an isolated `vitest -t` filter to confirm each covering test passes standalone, not merely inside the full suite.

#### 1. Stale-origin gate: plain inequality (both null directions refuse)

`src/domain/beacon/approval.ts:45`:
```ts
const isStaleOrigin = draft.origin.branchedFromVersion !== beacon.activeVersionId;
```
Reproduction — stale-origin with `activeVersionId: null` (the original bug: the shipped `activeVersionId !== null && branchedFromVersion !== activeVersionId` guard evaluated `false` here and wrongly treated the draft as fresh):

Test: `approval.test.ts:241` — `"refuses stale-origin-not-acknowledged when activeVersionId is null and the draft recorded a branch origin (post-revocation)"`. Isolated run this session:
```
$ npx vitest run tests/domain/beacon/approval.test.ts -t "activeVersionId is null and the draft recorded a branch origin"
Tests  1 passed | 15 skipped (16)
```
Result: `{ ok: false, error: { rule: "stale-origin-not-acknowledged", ... } }` — refuses correctly. ✅ COMPLIANT — the exact reproduction from the operator review now refuses as required.

The orthogonal direction (null origin, non-null active) is also covered by `approval.test.ts:276` and was confirmed vacuous against the actual shipped bug via fault injection (`isStaleOrigin = false` forced, genuine failure, reverted) — see apply-progress.md task 14.2 and the "TDD Evidence" section below; this direction was already correctly handled by the pre-remediation guard, and the test is retained for spec-pinning per explicit operator instruction, not because it exposes a second bug.

#### 2. `getOwn` own-property helper at all 10 lookup sites

`src/domain/beacon/records.ts`:
```ts
export function getOwn<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}
```
Grep-confirmed 10 call sites, matching the design's exhaustive touch-point table exactly: `drafts.ts` (createDraft, updateDraft, forkDraft ×2, abandonDraft = 5), `approval.ts` (draft lookup, duplicate-version-id check, prior-active supersession lookup = 3), `active-version.ts` (1), `revocation.ts` (1). No bare `beacon.drafts[...]` / `beacon.versions[...]` index lookups remain anywhere in `src/domain/beacon/`.

Reproduction — `createDraft` with `draftId: "toString"`:

Test: `drafts.test.ts:159` — `"accepts a prototype-shadowing draftId, not refused as a duplicate"`. Isolated run:
```
$ npx vitest run tests/domain/beacon/drafts.test.ts -t "accepts a prototype-shadowing draftId"
Tests  1 passed | 21 skipped (22)
```
Result: `result.ok === true`, one open draft keyed `"toString"` — succeeds, not fabricated from `Object.prototype.toString`. ✅ COMPLIANT.

Reproduction — `forkDraft` with `sourceDraftId: "toString"` and no own entry:

Test: `drafts.test.ts:424` — `"refuses draft-not-found for a prototype-shadowing sourceDraftId with no own entry, without fabricating a source"`. Isolated run:
```
$ npx vitest run tests/domain/beacon/drafts.test.ts -t "refuses draft-not-found for a prototype-shadowing sourceDraftId"
Tests  1 passed | 21 skipped (22)
```
Result: `{ ok: false, error: { rule: "draft-not-found", draftId: "toString" } }` — refuses `draft-not-found` without fabricating a source from the prototype method. ✅ COMPLIANT.

The 10th touch point (`approval.ts:93`, the supersession branch's prior-active lookup) was a design-table misassignment corrected in C2c (Phase 15 of `tasks.md`): the design attributed it to C2b, but that code path does not exist until C2c's supersession branch. `getOwn` is confirmed present at that exact line (read directly above). Its accompanying test (`approval.test.ts:499`, `"supersedes a prior active version keyed by a prototype-shadowing id (getOwn routing)"`) is documented and empirically confirmed vacuous by construction (own-property reads already shadow the prototype, and the pre-existing `priorActive.status === "active"` guard independently rejects any stray prototype hit) — recorded as deliberate ADR-12 domain-wide-convention completeness, not a live bug, in `apply-progress.md` Phase 15 with a full before/after test-count trace (16/16 unchanged by the fix).

#### 3. `resolveActiveVersion` throws on key-vs-embedded-`versionId` mismatch

`src/domain/beacon/active-version.ts:16-19`:
```ts
if (version.versionId !== beacon.activeVersionId) {
  throw new Error(
    `Corrupt active pointer: stored version at key "${beacon.activeVersionId}" carries embedded versionId "${version.versionId}"`,
  );
}
```
Reproduction — a version stored under key `"ver_A"` whose embedded `versionId` is `"ver_B"`:

Test: `active-version.test.ts:89` — `"throws when the resolved record's embedded versionId differs from the lookup key"`. Isolated run:
```
$ npx vitest run tests/domain/beacon/active-version.test.ts -t "embedded versionId differs from the lookup key"
Tests  1 passed | 4 skipped (5)
```
Result: `resolveActiveVersion(beacon)` throws `Error` — matches the spec's `Version identity mismatch throws` scenario exactly (store corruption, not an expected `Result` refusal, per ADR 5/13). ✅ COMPLIANT.

#### 4. `abandonDraft` takes a `Hasher` and records `finalHash`

`src/domain/beacon/drafts.ts:124-152`: `abandonDraft(beacon, cmd, hasher)` computes `finalHash: hasher.hash(project(draft.content))` before dropping `content`. Test: `drafts.test.ts:441` — `"discards content but keeps lineage and records finalHash when abandoning an open draft"`, included in the full suite run below (10/10 files green). Design ADR 10 widened to cover abandonment; `Draft`'s `abandoned` member in `types.ts` carries `finalHash: string`, matching the amended spec's `Beacon and Draft Are Closed, Caller-Identified` requirement and the `Abandonment records the semantic hash of the final content` scenario. ✅ COMPLIANT.

**Verdict on all 4 remediations**: all 4 confirmed present in source and independently re-executed against the original operator-review reproductions in this session — every reproduction now behaves exactly as ratified, with no regression to the 3 unaffected admission-check paths.

### Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 109 |
| Tasks complete | 107 |
| Tasks incomplete | 2 (`8.10`, `16.6` — force-push of rebased branches, explicitly deferred to the orchestrator's delivery step per the "Remediation delivery boundary" section; delivery actions are out of SDD implementation-task scope) |

Both incomplete items are delivery/push mechanics, not spec-covering implementation work; no spec requirement or scenario depends on them. Classified WARNING, not CRITICAL, consistent with the Decision Gates distinction between core and cleanup/delivery tasks.

### Stack Integrity

| Check | Result |
|---|---|
| 9-commit stack in order (`bf058ff → 8753c38 → ac48d48 → 5b8a495 → 7893900 → d389973 → f7cadf4 → 312696b → f266ca7`) | ✅ Confirmed via `git log --oneline master..change/beacon-core-c2c` |
| Branch parent chain (`git merge-base`) matches the described stack exactly | ✅ `merge-base(582fc1f, c1a)=582fc1f`; `merge-base(c1a,c1b)=bf058ff`; `merge-base(c1b,c1c)=8753c38`; `merge-base(c1c,c2a1)=ac48d48`; `merge-base(c2a1,c2a)=5b8a495`; `merge-base(c2a,c2b)=7893900`; `merge-base(c2b,c2c)=f7cadf4` — all 7 checks pass |
| `master` untouched at `582fc1f` | ✅ `git rev-parse master` = `582fc1f0787c1e27500eed25753b602e0829b2ee` |
| Conventional Commits, no AI attribution | ✅ All 9 commits authored by `Pedro Altuve <paltuveg@gmail.com>`; `feat(beacon):`/`test(beacon):`/`docs(openspec):` prefixes throughout; grep for `co-authored\|claude\|anthropic\|generated` across all 9 commit messages found nothing |
| Artifacts commit (`f266ca7`) is docs-only and contains exactly `openspec/changes/beacon-core/**` + the three promoted spec dirs | ✅ `git show --stat f266ca7`: 14 files, all under `openspec/changes/beacon-core/` (11 files) and `openspec/specs/{beacon-draft-lifecycle,beacon-version-lifecycle,project-toolchain}/spec.md` (3 files); zero `src/`/`tests/` files touched |
| Frozen-dir diff vs `582fc1f` (`src/domain/semantics/`, `src/domain/ports/`, `src/adapters/`, `src/application/`, `src/cli/`) at the final tip `f266ca7` | ✅ Empty, exit 0 |

### Line Accounting (matches the operator-ratified table exactly)

| Unit | Command | Result | Budget status |
|---|---|---:|---|
| C1a | `git diff --shortstat 582fc1f bf058ff -- src tests` | 356 (354+2) | Under 400 |
| C1b | `git diff --shortstat bf058ff 8753c38 -- src tests` | 230 (227+3) | Under 400 |
| C1c | `git diff --shortstat 8753c38 ac48d48 -- src tests` | 327 (325+2) | Under 400 |
| C2a-1 | `git diff --shortstat ac48d48 5b8a495 -- src tests` | 258 (252+6) | Under 400 |
| C2a-2 | `git diff --shortstat 5b8a495 7893900 -- src tests` | 286 (284+2) | Under 400 |
| C2b (base) | `git diff --shortstat 7893900 d389973 -- src tests` | 573 (572+1) | Feeds cumulative below |
| C2b (cumulative) | `git diff --shortstat 7893900 f7cadf4 -- src tests` | 611 (610+1) | `size:exception`, re-ratified at 611 |
| C2c | `git diff --shortstat f7cadf4 312696b -- src tests` | 222 (219+3) | Under 400 |

`package-lock.json` excluded per instruction; `git diff --stat 582fc1f f266ca7 -- package-lock.json` is empty (no lockfile drift across the entire remediation). All 8 unit-level counts are byte-identical to `apply-progress.md`'s "Final per-unit authored-line accounting" table — independently reproduced in this session, not merely re-read.

### Empirical Execution (this session, on `f266ca7`)

**`npm test`**: ✅ exit 0
```
Test Files  10 passed (10)
     Tests  128 passed (128)
```
`test_output_hash`: `sha256:9cbf76a525c12ae1fd3141a9561d02d065596df79ba7c314ad3374f916d50d3c` — 128/128, matching the expected count exactly (117 prior + 1 new touch-point test in C2c's Phase 15 + 10 additional stale-origin/getOwn/finalHash remediation tests across the stack: net +11 over the prior verify's 117).

**`npm run lint`**: ✅ exit 0 (only pre-existing `eslint-plugin-boundaries` v6/v7 deprecation warnings, no lint errors)

**`npm run typecheck`**: ✅ exit 0 (`tsc --noEmit`, no output)

**`npm run build`**: ✅ exit 0 (`tsc -p tsconfig.build.json`, no output)
`build_output_hash`: `sha256:9a7b581687e6658fe0477421daba6a5a0f4e5ae253c2c562a298e3e8dc2eb7e9` (unchanged from the prior verify — build produces no stdout on a clean compile in either run, hash is of the empty combined stdout/stderr stream)

**`npx vitest run tests/architecture/boundaries.test.ts`**: ✅ 2/2 passed

**Frozen-dir diff vs `582fc1f`** (`src/domain/semantics/`, `src/domain/ports/`, `src/adapters/`, `src/application/`, `src/cli/`): ✅ empty, exit 0

### Spec Compliance Matrix — Full Mapping Against the Amended Specs (14 req / 25 scenarios)

**beacon-draft-lifecycle (7 requirements / 12 scenarios)**

| Requirement | Scenario | Test | Status |
|---|---|---|---|
| Generic Result Refusal Carrier | Refusal is a value, not a throw | Cross-cutting — every refusal test in `drafts.test.ts`/`approval.test.ts`/`revocation.test.ts` asserts `{ ok: false, error }` synchronously (e.g. `drafts.test.ts:136`) | ✅ COMPLIANT (unchanged) |
| Beacon and Draft Are Closed, Caller-Identified | Abandonment records the semantic hash of the final content | `drafts.test.ts:441` | ✅ COMPLIANT (**amended** — see remediation §4) |
| Record Lookups Use Own-Property Semantics (**new requirement**) | createDraft accepts a prototype-shadowing id | `drafts.test.ts:159` | ✅ COMPLIANT (**new** — see remediation §2) |
| Record Lookups Use Own-Property Semantics | forkDraft refuses a prototype-shadowing id with no own entry | `drafts.test.ts:424` | ✅ COMPLIANT (**new** — see remediation §2) |
| createDraft Adds an Open Draft | First draft on a Beacon with no active version | `drafts.test.ts:114` | ✅ COMPLIANT (unchanged) |
| createDraft Adds an Open Draft | Duplicate draft id is refused | `drafts.test.ts:136` | ✅ COMPLIANT (unchanged) |
| updateDraft Is Revision-Bound | Stale save is refused without overwrite | `drafts.test.ts:232` | ✅ COMPLIANT (unchanged) |
| updateDraft Is Revision-Bound | Update against a closed draft is refused | `drafts.test.ts:297` | ✅ COMPLIANT (unchanged) |
| forkDraft Preserves Lineage | Fork after a rejected stale save | `drafts.test.ts:343` | ✅ COMPLIANT (unchanged) |
| forkDraft Preserves Lineage | Fork of an abandoned draft is refused | `drafts.test.ts:409` | ✅ COMPLIANT (unchanged) |
| abandonDraft Tombstones an Open Draft | Abandonment discards content but keeps lineage | `drafts.test.ts:441` | ✅ COMPLIANT (unchanged; extended with `finalHash`) |
| abandonDraft Tombstones an Open Draft | Double abandonment is refused | `drafts.test.ts:471` | ✅ COMPLIANT (unchanged) |

12/12 scenarios compliant.

**beacon-version-lifecycle (6 requirements / 10 scenarios)**

| Requirement | Scenario | Test | Status |
|---|---|---|---|
| Version Is a Closed Union | Local numbers are monotonic per Beacon | `approval.test.ts:675` (property 5) + `approval.test.ts:458` (supersession) | ✅ COMPLIANT (unchanged) |
| approveDraft Re-Verifies the Reviewed Hash | Recomputed hash mismatch refuses approval | `approval.test.ts:179` | ✅ COMPLIANT (unchanged) |
| Stale-Origin Approval Requires Explicit Acknowledgment | Stale origin without acknowledgment is refused | `approval.test.ts:206` | ✅ COMPLIANT (unchanged) |
| Stale-Origin Approval Requires Explicit Acknowledgment | Stale origin with acknowledgment proceeds | `approval.test.ts:339` | ✅ COMPLIANT (unchanged, remediated in a prior verify pass) |
| Stale-Origin Approval Requires Explicit Acknowledgment | Null active version is stale relative to any recorded branch origin (**new scenario**) | `approval.test.ts:241` | ✅ COMPLIANT (**new** — see remediation §1) |
| Approval Returns One Atomic Beacon | Approval supersedes the prior active version | `approval.test.ts:458` | ✅ COMPLIANT (unchanged) |
| revokeVersion Works on Any Approved Version | Revoking the active version clears the pointer | `revocation.test.ts:108` | ✅ COMPLIANT (unchanged) |
| revokeVersion Works on Any Approved Version | Double revocation is refused | `revocation.test.ts:183` | ✅ COMPLIANT (unchanged) |
| resolveActiveVersion Is a Pure Lookup | No active version resolves to null | `active-version.test.ts:57` | ✅ COMPLIANT (unchanged) |
| resolveActiveVersion Is a Pure Lookup | Version identity mismatch throws (**new scenario**) | `active-version.test.ts:89` | ✅ COMPLIANT (**new** — see remediation §3) |

10/10 scenarios compliant.

**project-toolchain (1 requirement / 3 scenarios)** — structural requirement, verified by directory inspection rather than a unit test (consistent with prior verify passes):

| Scenario | Evidence | Status |
|---|---|---|
| Architectural module directories match the ratified design | `find src -maxdepth 3 -type d` lists exactly the design's directories; no extra module root | ✅ COMPLIANT (unchanged) |
| Existing module barrels may expose ratified behavior | `src/domain/beacon/index.ts` and `src/shared/index.ts` are real barrels (no longer `export {};`), confirmed by direct read | ✅ COMPLIANT (unchanged) |
| Beacon Core lands without adding directories | `git diff --stat 582fc1f f266ca7 -- src/` confined to 11 files under `src/domain/beacon/*` and `src/shared/*`; zero new directories | ✅ COMPLIANT (unchanged) |

3/3 scenarios compliant.

**Total: 25/25 scenarios compliant, 14/14 requirements fully satisfied. 0 UNTESTED, 0 FAILING.**

### TDD Evidence — Vacuous Records Confirmed as Deliberate Spec-Pinning

Per `apply-progress.md`, every RED/GREEN cycle for the new remediation tests is documented with genuine failure evidence, including two explicitly-vacuous cases that were NOT silently accepted:

1. **Task 14.2** (second null-direction stale-origin test, `approval.test.ts:276`): documented in `apply-progress.md` lines ~89-106 as vacuous against the actual pre-fix code (the shipped guard already handled this direction correctly), confirmed via fault injection (`isStaleOrigin = false` forced, genuine failure, reverted), and explicitly recorded as required by an orchestrator instruction for symmetric spec-pinning rather than exposing a live bug — not silently added.
2. **Phase 15.2** (C2c `getOwn` touch-point regression test, `approval.test.ts:499`): documented in `apply-progress.md`'s "Phase 15" section with a full empirical trace — the new test was run against the pre-fix bare-index code FIRST and passed immediately (16/16, unchanged), root-caused (own-property reads already shadow the prototype; the `priorActive.status === "active"` guard independently rejects any stray prototype hit), then the fix was applied and rerun with zero test-count or pass/fail change — applied for ADR 12's domain-wide-convention completeness mandate, not for an observable behavior fix.

Both are recorded with concrete before/after evidence in `apply-progress.md`, matching this skill's Strict TDD discipline: a vacuous test is disclosed and justified, not hidden as a false RED→GREEN.

All other remediation RED steps (drafts.test.ts:159/424, approval.test.ts:241, active-version.test.ts:89) genuinely failed pre-fix, per the concrete assertion-error/behavior traces recorded in `apply-progress.md` (Phases 9, 11, 13, 14).

No `.skip`/`.todo`/`.only` in any test file (re-scanned this session, none found). No tautologies, ghost loops, or orphan-empty-collection patterns found across `tests/domain/beacon/` (re-scanned this session).

### Design Fidelity

All ADR rows referenced by the remediation (5, 10, 11, 12, 13) are confirmed present in the landed code:
- ADR 11 (stale-origin plain inequality): `approval.ts:45` — confirmed by direct read.
- ADR 12 (`getOwn` domain-wide convention, 10-site exhaustive table): confirmed by grep — exactly 10 call sites, matching the table in `design.md`, with the C2c touch-point misassignment correction documented and independently confirmed (the code exists only in C2c's supersession branch, not C2b).
- ADR 13 (identity-mismatch throw scoped only to `resolveActiveVersion`, not `revokeVersion`/`approveDraft`): confirmed — `revocation.ts` and `approval.ts` use `getOwn` but do not add an identity check; only `active-version.ts` does.
- ADR 10 widened (Hasher for `abandonDraft`): confirmed — `abandonDraft(beacon, cmd, hasher)` signature and `finalHash` computation in `drafts.ts`.
- ADR 5 extended: confirmed — the throw text in `active-version.ts` distinguishes the pre-existing "corrupt pointer, absent/non-active" case from the new identity-mismatch case.

### Purity / Boundary Audit

| Check | Result |
|---|---|
| No `node:*` / external imports in `src/domain` or `src/shared` | ✅ Confirmed by `tests/architecture/boundaries.test.ts` (2/2) |
| Frozen dirs zero-diff vs `582fc1f` | ✅ Re-confirmed this session at the final tip `f266ca7` |
| Changed paths confined to scope | ✅ `src/domain/beacon/*`, `src/shared/*`, `tests/domain/beacon/*`, plus the docs-only `openspec/changes/beacon-core/**` artifacts commit |

### Issues Found

**CRITICAL**: None.

**WARNING**:
1. Tasks `8.10` and `16.6` (force-push each rebased branch) remain unchecked — explicitly deferred to the orchestrator's delivery step per the "Remediation delivery boundary" section of `tasks.md`. No spec requirement or scenario depends on this; local rebuilt tips are ahead of their `origin/change/beacon-core-*` remotes and nothing has been force-pushed, so no data-loss risk exists at this state. Not a blocker for archive; the orchestrator should push before merging.

**SUGGESTION**:
1. (Carried forward) `tasks.md` continues to bundle multiple scenarios under a single "Maps to" line for some phases; per-scenario subtask lines would make future coverage gaps easier to catch at task-authoring time, as this run's own history demonstrates (the original missing acknowledged-stale-origin test, and the design-table `getOwn` touch-point misassignment, were both caught only at verify/apply time rather than at task authoring).

### Verdict

**PASS** — 0 CRITICAL, 0 WARNING blockers to archive (1 informational WARNING on deferred force-push, non-blocking). 128/128 tests, lint, typecheck, build, boundaries, and 9-commit stack integrity (including the docs-only artifacts commit) all pass. Branch parent chain independently confirmed via `git merge-base` at every stack transition. Line accounting independently reproduced and matches `apply-progress.md` exactly, including the operator-ratified C2b `size:exception` at 611. All 4 remediation fixes (plain-inequality stale-origin gate, 10-site `getOwn` own-property routing, `resolveActiveVersion` identity-mismatch throw, `abandonDraft` `Hasher`/`finalHash`) are confirmed present in source and independently re-executed in isolation against the exact operator-review reproductions, with all 4 now refusing/throwing/succeeding correctly. 25/25 scenarios compliant against the amended specs, 14/14 requirements fully satisfied. Both documented-vacuous remediation tests are recorded with genuine before/after empirical evidence, not silently accepted. Clear to archive.
