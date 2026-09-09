# Fs Beacon Store Specification

## Purpose

Defines `FsBeaconStore`, the filesystem implementation of the `BeaconStore` port: the on-disk directory layout, the universal atomic write protocol, write-once immutability enforcement, the advisory per-project lock, and the ordered approval transaction with `active.json` as the commit point.

## Requirements

### Requirement: On-Disk Layout Matches the Ratified Storage Contract

`FsBeaconStore` MUST persist each project's Beacon data under `<pharos-home>/store/<project_id>/` exactly as `docs/technical-design-v1.md` §4 defines: `lock`, `journal/idempotency/<key-hash>.json`, and `beacons/<beacon_id>/{beacon.json, active.json, drafts/<draft_id>/{draft.json, tombstone.json}, versions/<version_id>/{manifest.json, semantics.json, revocation.json}}`. `project.json` under the same project directory MUST NOT be read or written by `FsBeaconStore`.

#### Scenario: Beacon round-trips through disk unchanged

- GIVEN a `Beacon` with drafts and an active version
- WHEN it is persisted and then re-read through `FsBeaconStore`
- THEN the reconstructed `Beacon` is structurally identical to the original

#### Scenario: project.json is untouched by the store

- GIVEN a project directory containing `project.json`
- WHEN any `BeaconStore` port method runs against that project
- THEN `project.json`'s bytes are unchanged

### Requirement: Every File Write Follows the Universal Atomic Write Protocol

Every Beacon-state file `FsBeaconStore` writes, mutable or immutable, MUST follow: write to `<name>.tmp.<random>` in the same directory, `fsync` the temp file, atomically materialize it at the final name, then `fsync` the parent directory. For a mutable file, that materialization MUST be `rename`. For a write-once file it MUST instead be an atomic operation that fails when the destination already exists, since `rename` always replaces its destination and therefore cannot enforce the write-once requirement below. No write path MAY skip `fsync`, and no Beacon-state file MAY be written directly at its final path.

The advisory lock file and any liveness-probe file are process-coordination artifacts, not Beacon state, and are exempt from this protocol: they MAY be created with a single exclusive-create open.

(Previously: the requirement mandated `rename` for every file without exception. Two contradictions followed. First, `rename` silently replaces an existing destination on POSIX and Node exposes no `RENAME_NOREPLACE`, so mandating it for write-once paths made this requirement and the write-once requirement below jointly unsatisfiable. Second, mandating a temp-plus-rename sequence for the lock contradicted the ratified decision that the lock is acquired by a single exclusive-create open. Amended to state the invariant that was actually intended — no reader ever observes a partially written file, and a write-once path never silently overwrites — while leaving the materialization primitive to the design.)

#### Scenario: A write is never observable half-complete

- GIVEN a write to any store file
- WHEN the write is interrupted before the rename step
- THEN no file exists at the final path with partial content — either the prior committed content remains, or nothing does

### Requirement: Write-Once Files Refuse a Second Write

`manifest.json`, `semantics.json`, `revocation.json`, `tombstone.json`, and each journal entry file MUST be created via an exclusive-create write. A second attempt to write to a path that already holds one of these files MUST return a refusal value and MUST NOT overwrite the existing content.

#### Scenario: Second write to manifest.json is refused

- GIVEN a version directory whose `manifest.json` already exists
- WHEN `FsBeaconStore` attempts to write `manifest.json` again for that version
- THEN it returns a refusal value and the original `manifest.json` bytes are unchanged

#### Scenario: Second abandonment preserves the tombstone

- GIVEN a draft already abandoned with a written `tombstone.json`
- WHEN abandonment is attempted again with a fresh idempotency key
- THEN the domain returns `draft-not-open` before any tombstone write, and the original `tombstone.json` is unchanged

### Requirement: One Advisory Lock Serializes Mutations Per Project

`FsBeaconStore` MUST acquire a single advisory lockfile per project before any mutating operation and release it after. Read operations (`getBeacon`, `listBeacons`, `getActiveVersion`) MUST NOT require the lock. A lock held by a dead process MUST be broken only after a liveness check confirms the holder is no longer alive; a live holder's lock MUST NOT be broken.

#### Scenario: Interleaved mutations serialize

- GIVEN two mutating calls issued concurrently against the same project
- WHEN both attempt to acquire the lock
- THEN one completes its full write sequence before the other's mutation begins

#### Scenario: Stale lock from a dead process is broken

- GIVEN a lockfile left by a process confirmed no longer alive
- WHEN a new mutating call attempts to acquire the lock
- THEN the stale lock is broken and the new call proceeds

#### Scenario: Live lock is not broken

- GIVEN a lockfile held by a currently live process
- WHEN a new mutating call attempts to acquire the lock
- THEN it waits or refuses per the store's wait policy, and does not break the live lock

### Requirement: Approval Executes as Six Ordered Steps With active.json as Commit Point

`approveDraft` MUST execute, in order: (1) acquire the project lock, (2) re-verify the reviewed hash still matches the draft's current revision, (3) write `semantics.json` then `manifest.json` for the new version, (4) atomically swap `active.json` to the new version, (5) mark the approved draft closed and write the journal entry, (6) release the lock. Step 4 MUST be the sole commit point: no step before it MAY leave any observable trace that the version is active, and no step after it MAY be skipped once step 4 completes.

#### Scenario: Hash re-verification failure stops before any version file is written

- GIVEN a draft whose content changed after the operator's reviewed hash was computed
- WHEN `approveDraft` re-verifies the hash at step 2
- THEN it refuses, and no `semantics.json` or `manifest.json` is written for the attempted version

#### Scenario: Crash before active.json swap leaves no active trace

- GIVEN a crash injected after step 3 completes but before step 4's rename
- WHEN the store state is inspected afterward
- THEN the new version's `manifest.json` and `semantics.json` exist on disk, but `active.json` does not reference the new version, and the draft is not closed

#### Scenario: active.json swap is the observable activation moment

- GIVEN step 4's rename has completed
- WHEN `getActiveVersion` is called before steps 5–6 run
- THEN it returns the new version as active
