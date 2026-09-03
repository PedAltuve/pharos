# Beacon Store Recovery Specification

## Purpose

Defines the post-crash reconcile scan (`recoverProject()` / `reconcile()`), the classification of orphaned approval artifacts, and the idempotent replay of approval steps 5–6 after a crash following the `active.json` commit point. Exposed for a future CLI trigger; this capability specifies the scan itself, not the CLI.

## Requirements

### Requirement: Reconcile Scan Is Exposed as a Store Method

`FsBeaconStore` MUST expose a `recoverProject()` (or equivalently named `reconcile()`) method that scans a project's on-disk state and returns a report, without requiring any CLI. The scan MUST be safe to run repeatedly and MUST NOT modify or delete any write-once file that already exists. Completing pending approval work, as the replay requirement below mandates, MAY create files that do not yet exist.
(Previously: the scan "MUST NOT mutate any write-once file". That wording, read together with the scenario below, contradicted this capability's own replay requirement, which obliges the first scan of a replay-pending project to write. Amended to distinguish modifying an existing immutable file — still forbidden — from creating a missing one.)

#### Scenario: Recovery scan runs without a CLI

- GIVEN a project directory with no interrupted transaction
- WHEN `recoverProject()` is called directly against `FsBeaconStore`
- THEN it returns a report with no artifacts requiring attention, and no on-disk file is modified

#### Scenario: Repeated scans converge

- GIVEN a project directory in any state
- WHEN `recoverProject()` is called twice in succession
- THEN the first call performs only actions that complete a mutation already committed before the scan began, the second call performs no such action and changes no reconstructable on-disk content, and both reports describe an equivalent post-scan state

Time-based housekeeping of temporary files left behind by an interrupted write is excluded from this convergence assertion: whether such a file has aged past the store's staleness threshold depends on elapsed time rather than on committed state, so it MAY be swept by a later call and not an earlier one. Such a file is never reconstructable content, so sweeping it cannot change any reconstructed `Beacon`.

(Previously, in two successive forms. Originally: "both calls return an equivalent report and neither call changes on-disk content", scoped to "any state" — unsatisfiable for a replay-pending project, where the replay requirement obliges the first call to write. Then: "the first call performs at most the pending replay work the replay requirement mandates" — too narrow, because reconcile also completes abandonment cleanup and revocation-pointer clearing, which that requirement does not mention; paired with "no action at all", which no implementation can guarantee for age-gated temporary-file sweeping. Amended to the convergence property actually intended: completion of already-committed mutations converges, and clock-dependent housekeeping is explicitly out of scope.)

#### Scenario: A scan of a project needing no work writes nothing

- GIVEN a project directory with no interrupted transaction and no pending replay
- WHEN `recoverProject()` is called any number of times
- THEN no on-disk file is created, modified, or deleted, including the lock file

### Requirement: A Crash Before the Commit Point Is Classified as an Orphan, Never Auto-Activated

A version directory whose `manifest.json`/`semantics.json` exist but which `active.json` does not reference, and for which no journal entry records the corresponding mutation as committed, MUST be classified by `recoverProject()` as an aborted approval artifact. The scan MUST report it and MUST NOT cause it to become active, directly or indirectly.

#### Scenario: Orphan version is reported, not activated

- GIVEN a version directory left by a crash injected before the `active.json` swap
- WHEN `recoverProject()` is called
- THEN the report lists that version as an orphaned/aborted artifact, and `active.json` still does not reference it

#### Scenario: A later successful approval does not resurrect the orphan

- GIVEN an orphan version reported by a prior scan
- WHEN a subsequent `approveDraft` call successfully activates a different version
- THEN the orphan remains unreferenced and unreported as active

### Requirement: A Crash After the Commit Point Replays Steps 5–6 Idempotently

When `active.json` already references a version whose corresponding draft has not been marked closed and whose journal entry has not been written, `recoverProject()` or the next mutating call touching that Beacon MUST complete the remaining approval work: closing the draft and writing the journal entry. Completion MUST be idempotent — closing an already-closed draft or writing an already-present journal entry MUST NOT be attempted a second time, and no duplicate version or duplicate journal entry MAY result.

The exact on-disk algorithm used to detect "activation committed, closure/journal pending" is a design-phase decision, not specified here. This requirement pins only the observable outcome.

#### Scenario: Draft closure and journal entry are completed after a step-4-and-later crash

- GIVEN a crash injected after `active.json` is swapped but before the draft is closed
- WHEN `recoverProject()` is called
- THEN the previously approved draft ends up `closed`, exactly one journal entry exists for that approval, and no second version was created

#### Scenario: Replay is safe to run more than once

- GIVEN the completed-replay state from the previous scenario
- WHEN `recoverProject()` is called again
- THEN the draft remains `closed` exactly once and no duplicate journal entry is written
