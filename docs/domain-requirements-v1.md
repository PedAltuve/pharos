# Pharos v1 Domain Product Requirements

Pharos v1 lets an individual developer turn a demonstrated browser journey into approved, durable product intent and then establish repeatable verification without giving an agent authority to redefine that intent.

## Decision summary and reader guide

This is a domain PRD for human review, not a technical design or implementation specification.

| Review area | Product decision |
|---|---|
| Authority | An operator approves exact Beacon semantics; agents and adapters do not. |
| Identity | Projects and Beacons have opaque stable identities; names and locations may change. |
| Versioning | A Beacon may have multiple mutable drafts; approval assigns an immutable monotonic Beacon version while preserving exactly one active version. |
| v1 semantic scope | Operator-visible side effects remain stateful/stateless, and annotations remain limited to the required semantic core. |
| Verification | Verified means one targeted success plus three consecutive stability successes for one exact binding. |
| Repair | At most one causal test-only repair is allowed, only for a confidently proven generated-test defect. |
| Storage | BeaconStore is canonical; evidence and discovery are separate concerns. |
| v1 adapter | Playwright with Chromium is supported, but no browser tool defines the domain model. |

Review the vocabulary and authority map first, then the lifecycle and status dimensions, then the invariants and acceptance scenarios. Mechanism choices are deliberately deferred.

## Product problem and v1 outcome

A coding agent can observe an application and produce a browser test, but it cannot safely decide which details express product intent. A journey that succeeds once is also not evidence of repeatability.

Pharos v1 MUST let a developer:

- demonstrate and annotate intended behavior while the target application is already running;
- approve an immutable semantic version without delegating approval authority;
- hand that meaning to any capable coding agent through a runtime-neutral contract;
- constrain generation and repair to designated test artifacts;
- classify execution outcomes without weakening approved intent; and
- preserve trustworthy history while limiting sensitive browser evidence.

The v1 outcome is a guided, resumable path:

```text
Associate project → record and annotate draft → approve exact semantics
→ validate readiness → hand off → generate test artifacts → run and classify
→ repair once only when eligible → establish repeatability → report next action
```

The lifecycle operations MUST also be available through composable machine-readable interactions. Exact commands and transport details are deferred.

## Scope and source precedence

This PRD consolidates `product-requirements-v1.md`, `beacon-trust-model.md`, and `beacon-storage-model.md`. Those documents override conflicts in the historical `PHAROS.md`.

In particular, canonical Beacons do not live in the target application repository, Pharos does not manage the application process, and agents do not repair application code through this workflow.

This document defines observable product meaning, lifecycle, authority, outcomes, refusal, recovery, evidence, and privacy. It does not select schemas, modules, layouts, algorithms, libraries, or transaction mechanisms.

## Ubiquitous language

| Term | Domain meaning |
|---|---|
| Project | A stable Pharos identity associated with mutable product context such as name, paths, remote, and base URL. |
| Beacon | A stable identity for one intended product journey, with a mutable title and version history. |
| Draft | An unfinished mutable candidate for a Beacon, with a stable draft ID, mutable human-readable label, revision, and the approved Beacon version and semantic hash from which it branched. A Beacon may have multiple drafts. |
| Side-effect class | The v1 operator-visible readiness distinction: stateful or stateless. Richer classifications are outside v1. |
| Semantic core annotation | Tool-independent intent, variables, actions, checkpoints, outcomes, allowed variation, and prohibited regressions required to approve a Beacon version. |
| Approved version | An immutable, monotonically numbered semantic version created only by approval. |
| Active version | The one approved version, if any, authoritative for future handoff, generation, and verification. |
| Superseded version | A historically valid approved version replaced as active by a later approval. |
| Revoked version | An approved version barred from future use while retained for history. |
| Semantic bundle | Approval-bound intent, variables, normalized actions, checkpoints, outcomes, variation, and prohibited regressions. |
| Semantic hash | A deterministic identity for the exact approval-bound semantic bundle. |
| Supporting artifact | A recording, trace, screenshot, generated test, or similar aid that is not canonical intent. |
| Operational readiness | Whether deterministic setup, isolation, dependencies, and execution prerequisites are declared and validated. |
| Staleness | A deterministic signal that an authoritative or derived binding may not match the requested operation. |
| Verification binding | The exact approved Beacon version, generated-test hash, environment profile, and execution profile. |
| Verification attempt | One targeted run followed by three consecutive stability runs for one unchanged binding. |
| Run record | An immutable structured execution outcome, classification, binding, and evidence reference. |
| Evidence | Diagnostic artifacts associated with a run and stored separately from Beacon semantics. |
| Disposition | An operator choice to keep active, revoke, or start a replacement draft, with a reason. |

## Domain boundaries and authority map

| Concern | Canonical authority | Non-authoritative inputs |
|---|---|---|
| Project and Beacon identity | BeaconStore | Names, paths, remotes, URLs, repository metadata |
| Beacon semantics and lifecycle | BeaconStore | Recordings, tests, evidence, agent memory |
| Approval and revocation | Explicit operator action recorded by BeaconStore | Agent requests and generated output |
| Active-version resolution | BeaconStore | Discovery records and inactive imports |
| Historical execution outcomes | Immutable run records | Later evidence deletion or current state |
| Diagnostic artifact bytes | EvidenceStore | Discovery summaries |
| Search and agent discovery | DiscoveryIndex, including optional Engram | Any claim of approval authority |
| Execution | Selected verification adapter | Adapter concepts redefining Beacon semantics |

BeaconStore MUST be external to the target application repository. EvidenceStore MUST remain separate. DiscoveryIndex MUST be derived, rebuildable, and non-authoritative.

Playwright with Chromium is the only browser adapter in v1. Domain contracts MUST remain independent of Playwright types, recordings, trace formats, selectors, and test APIs.

Approval records `operator_confirmed`: an explicit operator interaction occurred. Pharos MUST NOT present this as cryptographic proof of human identity.

## Identity and version lifecycle

### Stable identity and drafts

- A Project MUST have an opaque generated stable ID. Its name, path, remote association, and base URL MUST be mutable without changing identity.
- A Beacon MUST have an opaque generated stable ID. Its human-readable title MUST be mutable without changing identity.
- Identity MUST NOT depend on absolute path, repository name, remote URL, title, or base URL.
- A Beacon MAY have multiple unfinished mutable drafts.
- Every draft MUST have a stable draft ID, a mutable human-readable label, a revision, and the approved Beacon version and semantic hash from which it branched.
- A draft MUST NOT receive a monotonic approved version before approval.
- Every draft update MUST be bound to the revision being edited. A save against a stale revision MUST be rejected without overwriting the newer revision.
- After rejecting a stale save, Pharos MUST show that a newer revision exists and allow the actor to refresh or preserve their work as a separate draft or fork.
- Pharos MUST NOT automatically merge drafts or use last-write-wins in v1.
- Creating or editing any draft MUST NOT alter the current active approved version.
- Raw recordings MAY support a draft but MUST NOT become approved merely by existing.

### Approval-bound semantics

Approval MUST bind the exact semantic hash reviewed by the operator. The hash inputs MUST include:

- purpose, actor, entry point, intended outcomes, allowed variation, and prohibited regressions;
- normalized tool-independent journey actions and meaningful checkpoints; and
- variable names, classifications, constraints, secret-reference identifiers, and intentional non-sensitive examples.

The hash inputs MUST exclude secret contents, runtime-resolved values, raw Playwright recordings, traces, screenshots, and generated test code.

### Approval, activation, and revocation

On approval, Pharos MUST confirm the reviewed hash still matches the draft, assign the next monotonic immutable version, record `operator_confirmed`, activate that version, and atomically supersede the prior active version if one exists.

Exactly one approved version MAY be active for a Beacon ID. Approval MUST NOT expose two active versions or a partially activated replacement.

Approved semantic versions MUST be immutable. Any approval-bound change MUST create or update a draft and require new approval. Superseded versions MUST remain historically resolvable.

Revocation MUST require explicit operator disposition and a recorded reason. It MUST block future handoff, generation, and verification while preserving historical runs. Revoking the active version MUST NOT silently reactivate an older version.

## Status dimensions

Pharos MUST report separate dimensions and derive one clear next action without collapsing them.

| Dimension | Product question | Representative conditions | Next action |
|---|---|---|---|
| Authority | May this version authorize future work? | draft, active approved, superseded, revoked, imported inactive | approve, activate, select, or stop |
| Operational readiness | Can it run deterministically? | ready, setup required, validation failed | declare or repair setup, then validate |
| Staleness | Does a deterministic signal need disposition? | current, attention required, provenance broken | keep active, revoke, or draft replacement |
| Verification | What is proven for this binding? | not attempted, running, verified, failed, interrupted, evidence incomplete | run, resume, restart, inspect, or stop |

An approved stateful Beacon can be authoritative but not ready. A verified historical binding can belong to a superseded version.

Automatic staleness MUST use only deterministic signals: Beacon version or semantic-hash mismatch, generated-test hash mismatch, environment-profile mismatch, execution-profile mismatch, or broken provenance. A generic application-revision change MUST NOT automatically mark stale.

Behavioral inconsistency or deterministic staleness MUST pause the triggering operation. The operator MUST record a reason and choose to keep active, revoke, or start a replacement draft. Keeping active resolves authority disposition only; it MUST NOT manufacture readiness, provenance, evidence, or verification.

## End-to-end domain workflow

### 1. Associate and preflight

The operator associates a stable Project ID with mutable local context and explicitly chooses repository or external test mode. The target MUST be classified as local, test, or staging; production MUST be refused.

The application MUST already be running. Pharos MAY check reachability and prerequisites but MUST NOT start, supervise, or stop it. Linux and macOS are supported in v1.

### 2. Record and annotate

Recording and annotation MAY proceed while the application runs. The recording is supporting input, not authority. A Beacon MAY have multiple unfinished drafts, and the operator selects the draft being recorded or annotated.

V1 annotations are limited to the required semantic core: tool-independent intent, variables, actions, checkpoints, outcomes, allowed variation, and prohibited regressions. Sensitive values MUST remain references. Advanced annotation categories are deferred until concrete usage justifies them.

V1 uses only the stateful/stateless side-effect distinction for readiness. Richer operator-visible side-effect classifications are deferred beyond v1. Draft saves remain revision-bound and MUST follow the stale-save rejection, refresh, and fork behavior defined by the draft lifecycle.

### 3. Approve

Pharos presents the semantic candidate and exact hash for explicit operator approval. Agents MAY prepare or request approval but MUST NOT grant it. Approval creates and activates an immutable version; the existing active version remains unchanged until replacement approval succeeds.

### 4. Establish readiness

A stateful Beacon MAY be approved before setup is ready, but it MUST NOT be handed off, generated, or verified until a deterministic reset, fixture, or isolation strategy is declared and validated.

### 5. Hand off and generate

Pharos provides a runtime-neutral task contract bound to the exact active approved version and hash. The agent MAY modify only designated test artifacts and MUST NOT modify application code. Missing accessibility support, stable interaction surfaces, fixtures, or test hooks MUST stop as a blocker or separate proposal.

Repository or external test mode applies to future generation. A later mode change MUST NOT relocate, reinterpret, or rewrite existing tests or history; they retain their original mode.

### 6. Execute, classify, and repair

Execution starts an attempt for one exact binding. Every failure MUST be classified before repair.

One repair is allowed only when evidence confidently proves a generated-test defect. It MUST be one causal patch limited to designated test artifacts, followed by one rerun. Unknown or inconclusive classification MUST stop for human action and MUST NOT consume the allowance. Broader changes or multiple causal experiments MUST stop.

### 7. Establish verification

A binding becomes verified only after one successful targeted run and three additional consecutive successful stability runs. Any stability failure closes that attempt as failed. A later attempt MUST restart with a fresh targeted run and three new stability runs.

### 8. Interrupt and recover

After interruption, the operator MAY resume or restart only when the exact binding is unchanged and completed run records remain intact. The disposition and reason MUST be recorded. Otherwise restart is mandatory.

Resume MUST continue from the next required run; it MUST NOT repeat completed runs while presenting them as new evidence.

### 9. Report and retain

Pharos reports authority, readiness, staleness, verification, binding identity, outcomes, classifications, repair use, evidence availability, and one next action. Historical outcomes MUST remain stable when current authority, configuration, test mode, or evidence availability changes.

## Normative invariants

1. Project and Beacon identities MUST be opaque, generated, stable, and independent of mutable associations.
2. A Beacon MAY have multiple unfinished mutable drafts; each MUST preserve its stable draft ID, mutable label, revision, and approved-version/hash branch origin.
3. Draft updates MUST be revision-bound. Stale saves MUST be rejected without overwrite and offer refresh or preservation as a separate draft or fork; v1 MUST NOT auto-merge drafts or use last-write-wins.
4. Draft work MUST NOT affect the active version; approval MUST assign the next monotonic version, and activation with prior-version supersession MUST be atomic.
5. Approved semantics MUST be immutable; semantic change MUST require approval of a new version.
6. Approval MUST bind the exact semantic hash and record `operator_confirmed` without overstating identity assurance.
7. Secret contents and runtime-resolved values MUST NOT enter canonical semantics; recordings, evidence, and tests MUST NOT become approval authority.
8. Revocation MUST prevent future use and preserve historical runs.
9. Generic application revisions MUST NOT create automatic staleness; inconsistency and deterministic staleness MUST pause for operator disposition.
10. Authority, readiness, staleness, and verification MUST remain distinct and produce one clear next action.
11. Stateful Beacons MUST NOT proceed to handoff, generation, or verification without validated deterministic setup or isolation.
12. V1 operator-visible side-effect classification MUST remain stateful/stateless, and v1 annotations MUST remain limited to the required semantic core.
13. Generation and repair MUST touch only designated test artifacts; Pharos MUST NOT repair application code.
14. Unknown classification MUST stop without consuming the repair allowance.
15. Eligible repair MUST be one causal patch and one rerun; unbounded loops MUST NOT occur.
16. Verification MUST bind exact approved version, test hash, environment profile, and execution profile.
17. Verified MUST require one targeted success plus three consecutive stability successes; any stability failure MUST fail the attempt.
18. Resume MUST require an unchanged binding and intact completed run records.
19. Divergent import resolution MUST show the required compact authority-impact comparison, default safely to a new Beacon ID, avoid auto-merge, and preserve displaced history in auditable quarantine.
20. Migration MUST preserve approval only with deterministic proof of normalized semantic equivalence.
21. Evidence deletion or corruption MUST NOT rewrite an intact historical outcome.
22. Canonical Beacons MUST remain outside target repositories, and DiscoveryIndex MUST NOT override BeaconStore.
23. Production execution and automatic approval MUST be refused in v1.

## Outcome and failure taxonomy

### Operation outcomes

| Outcome | Meaning | Product response |
|---|---|---|
| Succeeded | The operation completed under its binding. | Record result and next action. |
| Refused | A known invariant or v1 boundary prohibits it. | Name the rule without mutation. |
| Failed | It ran but missed its required outcome. | Record classification, evidence availability, and recovery. |
| Inconclusive | Evidence cannot support a confident claim. | Require human action; preserve repair allowance. |
| Interrupted | Completion is unknown or deliberately stopped. | Preserve records and offer valid resume or mandatory restart. |

### Failure classifications

| Classification | Meaning | Repair eligibility |
|---|---|---|
| Generated-test defect | The derived test incorrectly expresses intact approved semantics. | Eligible only when confidently proven. |
| Application behavior inconsistency | Observed behavior conflicts with approved intent. | No test repair; pause for disposition. |
| Environment failure | The declared target or execution environment cannot support the run. | No test repair unless separately proven test-caused. |
| Data/setup failure | Deterministic prerequisites were absent, invalid, or ineffective. | Restore readiness. |
| Provenance or binding failure | Required identity, hash, profile, or source relationship is broken. | Restore provenance or restart. |
| Unsupported operation | The request crosses a v1 boundary. | Refuse. |
| Unknown | Evidence cannot confidently assign causality. | Stop inconclusive; allowance remains unused. |

A passing rerun MUST NOT erase the original failure, classification, evidence references, or repair use.

## Import and migration rules

- Import MUST validate integrity and approval semantics before local eligibility.
- A valid imported approval MUST retain its original approval and assurance semantics and be eligible without re-approval.
- Import MUST NOT strengthen `operator_confirmed` or activate any version automatically; explicit local activation is required.
- Divergent local and imported histories for the same Beacon ID MUST quarantine the import.
- Before operator resolution, Pharos MUST show a compact authority-impact comparison containing:
  - semantic differences;
  - local and imported approval and assurance semantics;
  - the history divergence point;
  - affected drafts, generated tests, and verification bindings; and
  - the exact authority and history effect of each available disposition.
- The comparison MUST support an authority decision without requiring a complete run-by-run history dump.
- Quarantine resolution MUST offer keep local, replace, or import under a new Beacon ID; histories MUST NOT auto-merge.
- Import under a new Beacon ID MUST be the safe default disposition.
- If the operator chooses replacement, local authority MUST change as disclosed, while displaced local history remains quarantined and auditable; it MUST NOT be silently deleted.
- Resolution MUST preserve immutable historical run references and record the operator decision.
- Migration MAY preserve approval only with deterministic proof of normalized semantic equivalence.
- Without that proof, migration MUST preserve history and create a new draft requiring approval.

## Evidence and privacy rules

- Full failure evidence MUST be retained until explicit deletion; structured immutable run records MUST remain afterward.
- Records MUST mark deleted, unavailable, missing, or corrupt evidence without rewriting an intact outcome.
- Claims requiring artifact inspection MUST be blocked when required evidence is incomplete.
- Evidence availability MUST remain separate from historical run outcome.
- Authenticated journeys and sensitive variables MUST default to structured failure summaries.
- Full traces and screenshots for sensitive journeys MUST require explicit project opt-in with persistent exposure warnings.
- Semantic redaction MUST NOT be presented as evidence redaction.
- Sensitive values MUST remain references; secret contents and resolved runtime values MUST never become canonical semantics.

## Observable acceptance scenarios

### 1. Happy path and replacement authority

**Given** an active approved Beacon, validated readiness, and a running non-production target<br>
**When** an agent changes only designated test artifacts and the binding completes one targeted success plus three consecutive stability successes<br>
**Then** Pharos MUST report that exact binding as verified and preserve all four runs. Creating or editing a later replacement draft MUST leave this active version unchanged until replacement approval atomically activates the next version and supersedes it.

### 2. Approval candidate changes

**Given** an operator reviewed one semantic hash<br>
**When** the draft changes before approval is recorded<br>
**Then** Pharos MUST refuse approval for the reviewed hash and require review of the new exact semantics.

### 3. Stateful approval without readiness

**Given** a stateful draft with complete intent but no validated reset, fixture, or isolation strategy<br>
**When** the operator approves it and requests handoff, generation, or verification<br>
**Then** approval MUST remain valid, readiness MUST remain blocked, and the later operation MUST stop with setup validation as the next action.

### 4. Staleness and application revision

**Given** an active version<br>
**When** its version, semantic hash, test hash, environment profile, execution profile, or provenance deterministically mismatches the request<br>
**Then** Pharos MUST pause for reasoned disposition. If only the generic application revision changed, Pharos MUST NOT automatically mark stale.

### 5. Eligible repair and unknown cause

**Given** a targeted run failure<br>
**When** evidence confidently proves one generated-test defect<br>
**Then** one causal designated-test patch and one rerun MAY occur. If causality is unknown, Pharos MUST stop inconclusive without consuming the allowance; application, nondesignated, broad, or multi-patch repair MUST be refused.

### 6. Stability failure restarts proof

**Given** a targeted success and fewer than three completed stability successes<br>
**When** a stability run fails<br>
**Then** Pharos MUST fail the attempt, and any later attempt MUST begin with a fresh targeted run and three new consecutive stability runs.

### 7. Interrupted attempt

**Given** an interrupted attempt<br>
**When** the exact binding is unchanged and completed records are intact<br>
**Then** the operator MAY resume from the next required run or restart, with recorded reason. A changed binding or damaged records MUST force restart.

### 8. Revocation

**Given** an active approved version with historical runs<br>
**When** the operator revokes it with a reason<br>
**Then** future handoff, generation, and verification MUST be blocked while historical outcomes remain unchanged; no older version becomes active silently.

### 9. Import and divergence

**Given** a valid imported approval for a Beacon ID whose local and imported histories diverge<br>
**When** the operator resolves the quarantined import<br>
**Then** Pharos MUST first show the compact comparison of semantic differences, both approval and assurance semantics, the divergence point, affected drafts, generated tests, verification bindings, and each disposition's exact authority and history effect, without requiring a complete run-by-run dump. Import under a new Beacon ID MUST be the safe default. Keep local, replace, and new-ID resolution MUST NOT auto-merge histories; replacement MUST change local authority as disclosed while keeping displaced local history quarantined and auditable rather than silently deleting it. Any imported version that becomes locally eligible MUST preserve its original assurance, require no re-approval, and remain inactive until explicit local activation.

### 10. Migration equivalence

**Given** an approved version requiring schema migration<br>
**When** normalized semantic equivalence cannot be proven deterministically<br>
**Then** Pharos MUST preserve the historical version and create a new draft requiring approval.

### 11. Evidence deletion and sensitive defaults

**Given** an immutable failed run<br>
**When** its evidence is explicitly deleted<br>
**Then** the outcome MUST remain unchanged, evidence MUST be marked unavailable, and artifact-inspection claims MUST be blocked. For sensitive journeys without opt-in, only structured failure summaries MUST be retained by default.

### 12. Unsupported target or edit scope

**Given** a production target or a proposal to modify application code during generation or repair<br>
**When** the operation is requested<br>
**Then** Pharos MUST refuse it without changing Beacon authority or consuming repair allowance.

### 13. Test mode changes prospectively

**Given** existing tests and history in repository or external mode<br>
**When** the project changes mode<br>
**Then** future generation MUST use the new mode while existing tests and history retain their original mode and meaning.

### 14. Broken evidence does not rewrite history

**Given** an intact structured historical outcome and later missing or corrupt evidence<br>
**When** the run is inspected<br>
**Then** Pharos MUST show the original outcome and a separate evidence-incomplete condition, and MUST refuse claims that require the unavailable artifacts.

### 15. Concurrent edits to the same draft

**Given** two actors opened the same draft revision<br>
**When** the first actor saves a newer revision and the second actor saves against the now-stale revision<br>
**Then** Pharos MUST preserve the first save, reject the stale save without overwrite, show that a newer revision exists, and allow the second actor to refresh or preserve their work as a separate draft or fork. Pharos MUST NOT automatically merge the edits or resolve them with last-write-wins.

## Explicit non-goals

Pharos v1 does not provide:

- application process management, production execution, or application repair;
- automatic approval, cryptographic human identity proof, or unbounded loops;
- dependency installation or scaffolding inside target repositories;
- Firefox, WebKit, Windows, mobile matrices, or visual baseline management;
- a requirement for MCP or a specific coding-agent runtime;
- multi-agent orchestration, centralized team administration, or cloud execution;
- canonical Beacon storage in target repositories, Engram authority, or a Git-backed BeaconStore;
- production credential management;
- richer operator-visible side-effect classifications beyond stateful/stateless;
- advanced annotation categories beyond the required semantic core; or
- Homebrew distribution.

## Deferred product extensions

- Richer operator-visible side-effect classifications are explicitly post-v1; v1 keeps only the stateful/stateless distinction.
- Advanced annotation categories are explicitly post-v1 and require concrete usage evidence before product scope is expanded beyond the required semantic core.

## Technical-design handoff

Technical design MUST preserve these invariants and scenarios while choosing the mechanisms deliberately deferred here:

- exact commands, prompts, exit codes, and machine-readable envelopes;
- identifier formats and repository identity filename;
- schema fields, serialization, normalized journey vocabulary, and canonicalization;
- hashing algorithms and libraries;
- filesystem layout, transactions, locking, recovery, and concurrency, including revision-bound draft saves and refresh-or-fork conflict presentation;
- divergent-import comparison presentation and quarantine mechanics;
- portable bundle format and evidence storage mechanics;
- module boundaries, package choices, and CLI framework;
- browser-adapter interfaces and Playwright implementation details; and
- compatibility policy across Pharos, Playwright, Chromium, and supported runtimes.

The design must show how each invariant is enforced and each scenario remains observable without making adapter artifacts canonical domain meaning. It MUST preserve multiple draft identities and branch origins, reject stale revisions without overwrite, avoid automatic draft merges and last-write-wins, and keep displaced replacement history quarantined and auditable.
