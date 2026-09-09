# Beacon Store Port Specification

## Purpose

Defines the technology-neutral persistence contract for the `Beacon` aggregate: the port method surface, the caller-supplied idempotency-key parameter on every mutating method, the port-owned disk-level refusal vocabulary, and revision-bound update semantics against persisted state. The port describes an interface only, with domain-owned types; `src/adapters/fs-beacon-store` implements it.

## Requirements

### Requirement: Port Method Surface Covers the Full Beacon Lifecycle

The `BeaconStore` port MUST expose exactly one method per Beacon lifecycle operation: `getBeacon`, `listBeacons`, and `getActiveVersion` as read operations; `createDraft`, `updateDraft`, `forkDraft`, `abandonDraft`, `approveDraft`, and `revokeVersion` as mutating operations. Every method signature MUST be expressible using domain-owned types only (`Beacon`, `Draft`, `Version`, the port's own refusal union, `Result`, `Promise`); no `node:*` type MAY appear in the port module.

#### Scenario: Port compiles with zero Node imports

- GIVEN the `BeaconStore` port module
- WHEN its imports are inspected
- THEN no `node:*` module is imported, and the boundary lint rule for `src/domain/**` passes

#### Scenario: Every mutating operation is represented

- GIVEN the six Beacon lifecycle mutations already defined by `beacon-draft-lifecycle` and `beacon-version-lifecycle`
- WHEN the `BeaconStore` interface is inspected
- THEN each mutation has exactly one corresponding port method, and no additional mutating method exists

### Requirement: Every Mutating Method Accepts a Caller-Supplied Idempotency Key

Each of `createDraft`, `updateDraft`, `forkDraft`, `abandonDraft`, `approveDraft`, and `revokeVersion` MUST accept a caller-supplied idempotency key as a required parameter. A call repeating a previously used key with a logically identical input MUST return the previously committed result without re-executing the mutation. A call repeating a key with a logically different input MUST be refused.

#### Scenario: Repeated key with identical input replays

- GIVEN a prior successful `approveDraft` call committed under idempotency key `K`
- WHEN `approveDraft` is called again with key `K` and the same logical input
- THEN the store returns the previously committed result and does not create a second version

#### Scenario: Repeated key with different input is refused

- GIVEN a prior successful call committed under idempotency key `K`
- WHEN the same method is called again with key `K` but a different logical input
- THEN the store returns a refusal and performs no mutation

### Requirement: Disk-Level Refusals Are Port-Owned

The port module MUST define a closed refusal union for disk-only failure modes unreachable by the pure domain: at minimum, lock acquisition failure, an idempotency-key conflict, an immutable-file-already-exists condition, and a not-found condition for beacons and versions addressed by id. Every refusable port method MUST return `Promise<Result<T, BeaconStoreRefusal>>` and MUST NOT throw for any documented refusal.

#### Scenario: Lock acquisition failure is a value, not a throw

- GIVEN the project lock is held and cannot be acquired within the store's wait policy
- WHEN a mutating method is called
- THEN it resolves to `{ ok: false, error }` with a lock-related refusal, and does not throw

#### Scenario: Not-found is a value

- GIVEN no beacon exists with the requested `beaconId`
- WHEN `getBeacon` is called
- THEN it resolves to `{ ok: false, error }` with a not-found refusal

### Requirement: updateDraft Is Revision-Bound Against Persisted State

`updateDraft` MUST accept `expectedRevision` and refuse without mutation when it does not equal the persisted draft's current `revision`, mirroring the pure domain's revision-bound semantics but validated against the on-disk record rather than an in-memory value.

#### Scenario: Stale persisted revision is refused

- GIVEN a persisted draft at `revision: 2`
- WHEN `updateDraft` is called with `expectedRevision: 1`
- THEN it resolves to `{ ok: false, error }` with a stale-revision refusal, and the persisted draft is unchanged
