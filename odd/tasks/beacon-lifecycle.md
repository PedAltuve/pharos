# Operator-confirmed Beacon lifecycle

## Objective

Complete GitHub issue #77 with the smallest public lifecycle slice after the guided open-draft journey: explicit operator approval of exact Beacon semantics, truthful lifecycle status, and reasoned revocation of the active immutable version.

## Problem

The public CLI currently ends at an authoritative but mutable revision-1 `open` Beacon draft. The domain and filesystem store already support immutable approval, active-version replacement, recovery, idempotency, and revocation, but operators cannot invoke those transitions or inspect their authority truthfully through the CLI.

## Why now

PR #76 merged the filesystem lifecycle hardening needed for safe reuse. Approval is the next authority boundary in the documented v1 journey and must land before readiness, handoff, generation, execution, evidence, repair, or verification.

## Delivery identity

- GitHub issue: `#77` — `[Feature]: Add operator-confirmed Beacon lifecycle commands`
- Issue state: open
- Issue labels: `enhancement`, `status:approved`
- Branch: `feat/beacon-lifecycle`
- Base: merged `origin/master` at `87cb3d418a019cb5546793c69c186087ecb1bb3b`

## Scope

### Included

- `pharos beacon approve <beacon-id>` as a TTY-only operator action.
- Recompute and present the exact association-bound semantic hash before confirmation.
- Approval of exactly one unambiguous open draft; never silently choose among multiple open drafts.
- Creation and activation of an immutable version through the canonical `BeaconStore` port.
- `pharos status <beacon-id>` as a mutation-free lifecycle read.
- Separate status dimensions: truthful authority plus explicit `unavailable` values for readiness, staleness, and verification in this milestone.
- `pharos beacon revoke <beacon-id>` as a TTY-only action against the active version.
- Revocation reason policy selected by the user: trim whitespace and require a non-empty value, with no product-level maximum length.
- Explicit revocation confirmation; immutable history stays resolvable and no older version is reactivated.
- CLI help, machine-safe envelopes, tests, and README updates matching implemented behavior.

### Out of scope

- Readiness declaration or validation.
- Agent handoff or task packages.
- Generated tests, browser execution, evidence, classification, repair, or verification.
- Cryptographic operator identity.
- Target-repository mutation.
- Automatic historical-version activation.
- Multi-draft management commands; approval must refuse ambiguity rather than invent selection policy.

## Constraints

- Preserve hexagonal boundaries: CLI → application → domain; domain remains pure.
- `BeaconStore` remains canonical authority; captures and associations are supporting records.
- Approval must bind the exact reviewed semantic hash and record `operator_confirmed` without overstating identity assurance.
- Non-TTY approval and revocation must refuse before lifecycle mutation.
- Repeated status reads must be mutation-free except existing store recovery semantics already documented and tested.
- Preserve filesystem store idempotency and recovery behavior from issue #72 / PR #76.
- Do not touch the target application, launch browsers, contact product targets, or add dependencies unless separately justified.
- Keep technical artifacts and public CLI copy in English.
- Review-size heuristic: aim for roughly 400 authored diff lines per task, but preserve coherent behavior, tests, and documentation over cosmetic line limits.

## Test mode

- Strict TDD: enabled.
- Source: `openspec/config.yaml` (`strict_tdd: true`, `rules.apply.tdd: true`).
- Runner: `npm test` (Vitest).
- Every behavior task must report observed RED, GREEN, TRIANGULATE where useful, and REFACTOR evidence. Never invent RED evidence.

## Tasks

### BL-1 — Lifecycle application core

- [x] Add failing domain/application tests for the missing lifecycle behavior and refusals.
- [x] Validate revocation reasons by trimming and rejecting empty/whitespace-only values without imposing a maximum.
- [x] Add version-ID generation support using existing ID conventions.
- [x] Implement approval orchestration that resolves the Beacon/capture association, recomputes the exact semantic hash, refuses missing/mismatched/closed/ambiguous draft state, and calls `BeaconStore.approveDraft` only after receiving an operator-confirmed request.
- [x] Implement mutation-free lifecycle status derived from canonical Beacon state, with authority separated from unavailable readiness/staleness/verification dimensions.
- [x] Implement active-version revocation orchestration with trimmed non-empty reason and canonical store persistence.
- [x] Export new application use cases without weakening layer boundaries.
- [x] Run focused domain/application tests and record RED/GREEN/refactor evidence.

Acceptance:

- Hash or association mismatch never approves.
- Closed, absent, or ambiguous open-draft state is refused without mutation.
- Approval produces one immutable active version through `BeaconStore`.
- Status truthfully distinguishes open draft, active approved, and revoked/no-active authority states.
- Revocation rejects empty/whitespace-only reasons and persists the trimmed non-empty reason.
- Revoking active authority leaves no active version and never reactivates history.
- Sequential and concurrent retries with the same request key replay the first persisted approval/revocation despite regenerated output IDs or timestamps.
- Expected draft revision and exactly-one-open-draft admission are checked inside the locked approval transition.
- Active-only revocation checks the expected active version inside the locked transition and never returns a stale global no-active claim.

### BL-2 — TTY lifecycle commands

- [x] Add failing CLI tests for approval, status, and revocation command behavior.
- [x] Add bounded prompt seams for exact-hash approval confirmation and reasoned revocation confirmation.
- [x] Register `pharos beacon approve <beacon-id>`, `pharos status <beacon-id>`, and `pharos beacon revoke <beacon-id>` in composition/program wiring.
- [x] Refuse approval and revocation in non-TTY mode before lifecycle mutation.
- [x] Render status dimensions and next action without claiming readiness, staleness evaluation, or verification.
- [x] Preserve safe human/JSON envelopes, exit mapping, and secret-safe rendering.
- [x] Run focused CLI tests and record RED/GREEN/refactor evidence.

Acceptance:

- Approval shows the exact recomputed hash before explicit confirmation.
- Cancellation and non-TTY execution are mutation-free refusals.
- Revocation obtains a non-empty reason and separate explicit confirmation before persistence.
- Status is read-only and machine-safe.
- CLI help exposes only implemented lifecycle commands.

### BL-3 — Integrated journey and truthful documentation

- [x] Add an integrated real-store journey: initialize → record/annotate fixture path → approve → status → revoke → status.
- [x] Prove approval/revocation persistence, immutable history, active-pointer clearing, and repeated status-read stability.
- [x] Update `README.md` current milestone, command list, exclusions, and claims.
- [x] Run focused lifecycle suites.
- [x] Run `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`, and `git diff --check`.
- [x] Obtain independent verification as required by the native candidate-risk assessment.
- [ ] Run native review at the complete candidate boundary when authorized; record the actual outcome without treating it as delivery authorization.

Acceptance:

- The public journey works through revocation using the real filesystem store without browser or target access.
- Documentation matches exactly what the CLI implements.
- All required checks pass, or any blocker is recorded honestly and the task remains open.

## Verification commands

Focused commands may be refined after the implementation map establishes exact new filenames, but must remain within these suites:

```bash
npm test -- tests/domain/beacon tests/application tests/cli/commands tests/cli/program.test.ts tests/integration
npm test
npm run lint
npm run typecheck
npm run build
git diff --check
```

The default suite must remain hermetic: no browser launch, no product-target contact, and no dependency installation.

## Progress

- 2026-09-22: PR #76 merge confirmed at `87cb3d4`; no open issues or PRs existed before this feature.
- 2026-09-22: Read-only repository mapping confirmed approval/status/revocation as the next coherent vertical slice and identified reusable domain/store/CLI primitives.
- 2026-09-22: User selected trimmed non-empty revocation reasons with no maximum length.
- 2026-09-22: Issue #77 was created from the repository feature form, read back successfully, and explicitly approved by the ADMIN actor with `status:approved` while preserving `enhancement`.
- 2026-09-22: Clean worktree `/home/pedro/pharos-worktrees/beacon-lifecycle` created from merged `origin/master`; root checkout's pre-existing `.gitignore` modification remains untouched.
- 2026-09-22: An initial dependency install ran in the root checkout by mistake; diagnosis proved it added only ignored `node_modules/` content and changed no tracked file. Dependencies were then installed in the lifecycle worktree with browser download disabled.
- 2026-09-22: BL-1's first implementation pass added lifecycle use cases, reason validation, version IDs, and focused coverage. After two authorized fixture corrections, focused tests, lint, typecheck, and diff-check passed.
- 2026-09-22: Independent verification rejected BL-1 despite green commands. Store-level replay identity is not preserved by application-generated IDs/timestamps; approval's association/cardinality checks race persistence; and active-version selection races revocation. BL-1 remains open until these authority-transition defects are corrected and independently reverified.
- 2026-09-22: Read-only remediation mapping selected one coherent correction: use the idempotency key as request-stable identity; exclude generated outputs from journal request hashes; enforce approval revision/cardinality and expected-active revocation under the existing project lock; preserve capture associations outside BeaconStore; and add no general transaction framework. No product decision is required.
- 2026-09-22: The first atomicity remediation passed 76 focused tests, lint, typecheck, and diff-check, but fresh independent re-verification still failed. Revocation continued to pre-read/short-circuit active state before store replay; approval revision remained optional for direct store callers; null-active revocation could return a stale refusal; deterministic approval/revocation concurrency and new-method recovery proof were missing; and one adoption fixture weakened a prior stale-attempt assertion.
- 2026-09-22: The second remediation made revision mandatory, carried nullable expected-active snapshots into locked replay/validation, restored D6b stale-artifact precedence, and added deterministic concurrency/recovery proofs. Writer checks reached 85 focused tests and the parent spot-check passed. Final independent re-verification still found one status bug (`abandoned-only` was mislabeled revoked) plus three missing exact sequential/null-mismatch assertions; all other historical blockers closed.
- 2026-09-22: The final bounded correction added truthful `no-authority` status plus exact sequential approval/revocation replay and expected-null/current-active mismatch proofs. Fresh independent verification passed all BL-1 criteria and closed all fourteen historical blockers; BL-1 is complete.
- 2026-09-22: BL-2's first implementation passed 104 focused tests, lint, typecheck, and diff-check. Independent verification found one blocker: production Clack lifecycle prompts default to stdout, so interactive `--format json` can be contaminated before the final machine envelope. All authority, cancellation, status, wiring, and boundary criteria otherwise passed.
- 2026-09-22: The bounded prompt-stream correction routed all lifecycle Clack frames to stderr and added production-bridge assertions. Fresh independent verification passed all BL-2 authority, refusal, status, stream, grammar, composition, exit, and boundary criteria; BL-2 is complete.
- 2026-09-22: BL-3's first implementation added the hermetic real-store journey and truthful README; 687 tests and all static/build gates passed. Independent verification still rejected three proof gaps: the semantic-hash assertion was circular, only one version existed so older-version non-reactivation was not exercised, and the help test removed guards for still-excluded later lifecycle commands.
- 2026-09-22: Final proof corrections added a literal semantic digest oracle, real older-version non-reactivation, and narrowed help guards. Independent complete-candidate verification passed BL-1/BL-2/BL-3 with 688 tests and every static/build gate green.
- 2026-09-22: Native reliability review found two critical retry short-circuits before store replay. A bounded ~70-line TDD correction closed application approval retry and CLI revocation retry; 689 tests and every static/build gate passed. Native targeted validation then failed with `schema-incompatible`, and fresh status no longer recognized the correction lineage; no native approval is claimed.

## Verification evidence

- Writer verification: 6 focused files / 30 tests passed; `npm run lint`, `npm run typecheck`, and `git diff --check` passed.
- Parent spot check: `npm run typecheck` passed.
- Independent BL-1 verification: **FAIL** on three blocking lifecycle defects:
  1. sequential and concurrent retries are not application-idempotent because generated version IDs/timestamps are not request-stable and completed state returns before store replay;
  2. association revision plus exactly-one-open-draft approval checks are outside the atomic store transition;
  3. active-version selection and revocation are separate, permitting a concurrent approval to leave a newer active version while the application reports none.
- Atomicity remediation writer verification: 11 focused files / 76 tests passed; `npm run lint`, `npm run typecheck`, and `git diff --check` passed.
- Parent post-remediation spot check: `npm run typecheck` passed.
- Fresh independent atomicity re-verification: **FAIL** because active-state pre-reading still bypasses canonical replay and locked null-state validation, `expectedRevision` is optional, deterministic concurrency/recovery coverage is missing, and one prior recovery assertion was weakened.
- Second remediation writer verification: 12 focused files / 85 tests passed; `npm run lint`, `npm run typecheck`, and `git diff --check` passed.
- Parent second-remediation spot check: `npm run typecheck` passed.
- Final BL-1 independent re-verification: **FAIL** only because abandoned-only Beacons were falsely reported as revoked, sequential approval replay lacked an exact regenerated-output proof, sequential revocation replay used partial rather than exact canonical assertions, and expected-null/current-active mismatch lacked direct coverage. Fourteen focused files / 90 tests and all static checks passed.
- Final bounded writer verification: 4 focused files / 29 tests passed; `npm run lint`, `npm run typecheck`, and `git diff --check` passed.
- Parent final BL-1 spot check: `npm run typecheck` passed.
- Final independent BL-1 verification: **PASS** — 14 files / 94 tests passed; lint, typecheck, and diff-check passed; all BL-1 acceptance criteria and historical blockers closed with no tool-output contamination or scope leakage.
- BL-2 writer verification: 12 focused files / 104 tests passed; `npm run lint`, `npm run typecheck`, and `git diff --check` passed.
- Parent BL-2 spot check: `npm run typecheck` passed.
- Independent BL-2 verification: **FAIL** only because production lifecycle prompt frames write to stdout and can precede a JSON envelope; all other BL-2 criteria passed.
- Prompt-stream correction verification: 4 files / 33 tests passed; lint, typecheck, and diff-check passed.
- Parent post-correction spot check: `npm run typecheck` passed.
- Final independent BL-2 verification: **PASS** — 13 files / 105 tests plus lint, typecheck, and diff-check passed; production lifecycle prompt frames are isolated to stderr while final envelopes remain on stdout.
- BL-3 writer verification: focused journey 2 files / 3 tests plus full 63 files / 687 tests passed; lint, typecheck, build, and diff-check passed.
- Parent BL-3 spot check: `npm run build` passed.
- Independent complete-candidate verification: **FAIL** only because exact semantic hash used a circular SUT-derived comparison, no older version existed to prove non-reactivation, and help guards for still-excluded later lifecycle commands were removed. All command gates passed.

## Next step

Resolve the unavailable native correction validation by starting a fresh review for the corrected candidate (including intended untracked paths), or record review unavailable and follow the risk-gated fallback. Stop before commit/push/PR unless the user explicitly authorizes delivery.
