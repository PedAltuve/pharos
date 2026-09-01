# Pharos v1 Lifecycle and Schema Decisions

This document records the lifecycle and logical-schema decisions made after the domain PRD. It is not an implementation design, an executable schema, or an operation catalog.

The product requirements remain authoritative. This document only resolves the contract questions discussed during lifecycle/schema planning.

## 1. Approved-version identity

Every approved Beacon version MUST have:

- an immutable portable version ID;
- its approval-bound semantic hash; and
- a local human-facing address consisting of Project ID, Beacon ID, and local version number.

Approvals, runs, exports, imports, migrations, and historical references MUST bind the portable version ID.

The local address is for navigation inside one Pharos store. Import MAY assign a different local address without changing portable identity.

If imported version numbers collide with destination history, Pharos MUST:

- preserve every portable version ID;
- preserve the origin address as provenance;
- assign collision-free local monotonic version numbers; and
- never renumber existing local history.

Two versions with the same semantic hash do not automatically share identity, approval, authority, or trust.

## 2. Draft lifecycle

A Beacon MAY have multiple unfinished drafts.

Each draft MUST have:

- a stable draft ID;
- a mutable human-readable label;
- a revision;
- the approved portable version ID and semantic hash from which it branched; and
- fork provenance when created from another draft.

Draft updates MUST be revision-bound. A save against a stale revision MUST be rejected without overwriting the newer revision.

After a stale-save rejection, the actor MAY:

- refresh and apply the change to the current revision; or
- preserve the work as a separate draft or fork.

Pharos v1 MUST NOT automatically merge drafts or use last-write-wins.

### Stale-origin approval

If a draft branched from an older approved version after another draft activated a newer version, Pharos MUST require an explicit semantic comparison against the current active version before approval.

The operator MAY then:

- rebase the draft onto the current active version; or
- approve it as an intentional replacement with a recorded acknowledgment.

A stale branch origin does not invalidate the draft, but it prevents silent replacement of newer approved meaning.

### Approved drafts

Successful approval MUST close and retain the exact approved draft revision as immutable provenance.

Further changes require a new draft or fork. Other open drafts remain open and may become stale-origin drafts.

### Abandoned drafts

Abandonment MUST discard the mutable semantic content while retaining a metadata tombstone containing:

- draft ID;
- branch origin;
- final revision and semantic hash;
- timestamps; and
- abandonment reason.

An abandoned draft cannot be resumed or approved.

## 3. Approval, revocation, and staleness

Any approved version MAY be revoked, including active, superseded, and imported-inactive versions.

Revocation MUST:

- preserve historical approval and runs;
- prevent future activation, handoff, generation, and verification; and
- never reactivate an older version automatically.

Revoking the active version leaves the Beacon without an active version.

A `keep active` staleness disposition applies only to the exact signal and binding reviewed by the operator.

A different bound-input mismatch or newly observed inconsistency creates a new staleness signal. A prior disposition MUST NOT suppress it.

Keeping a version active changes no readiness, provenance, evidence, or verification fact.

## 4. Semantic hash boundary

The semantic hash identifies normalized meaning only.

It MUST exclude:

- Project, Beacon, draft, and approved-version identities;
- local addresses and titles;
- contract schema versions;
- approval and lifecycle metadata;
- supporting-artifact references;
- secret contents; and
- runtime-resolved values.

Identity and authority manifests bind semantic meaning to approved versions separately.

### Readiness intent

The semantic hash MUST include:

- stateful or stateless classification; and
- the required deterministic isolation or reset intent.

It MUST exclude executable setup mechanics and readiness-validation results.

Changing the classification or safety intent requires reapproval. Changing an equivalent operational implementation requires readiness revalidation, not a new Beacon version.

### Meaningful ordering

Ordering affects semantic meaning only where the domain declares it meaningful.

- Journey actions are ordered.
- Explicitly ordered checkpoints are ordered.
- Keyed variables, outcomes, prohibited regressions, and other order-insensitive declarations are compared by logical identity rather than document position.

Formatting or presentation reordering MUST NOT change semantic meaning.

### Defaults and nulls

Declared defaults MUST be resolved before semantic comparison and hashing.

An omitted value and the same explicitly written default are semantically equivalent.

`null` is distinct only when the field explicitly defines a domain meaning for null.

## 5. Contract versioning and compatibility

Each logical contract type MUST have its own schema version.

Bundle and compatibility manifests MUST declare the contract-version combination they require.

Concrete version syntax and validation tooling remain technical-design decisions.

### Unsupported newer schemas

When an older Pharos version encounters an approved Beacon using a newer unsupported schema, it MAY:

- preserve it safely;
- export it; and
- display limited metadata.

It MUST block:

- approval;
- activation;
- generation;
- verification; and
- migration-equivalence claims.

Pharos MUST NOT ignore unknown approval-bound meaning.

### Migration equivalence

A schema migration preserves approval only when deterministic normalization proves that source and target have exactly the same schema-independent semantic meaning.

The comparison MUST:

1. interpret the source using its schema;
2. interpret the target using its schema;
3. normalize both into the semantic projection; and
4. require exact equality.

Migration MUST NOT rewrite the immutable approved source representation or its historical schema facts.

If equivalence cannot be proven, migration produces a draft requiring approval.

## 6. Mutation retries

Every mutating lifecycle operation MUST use a stable idempotency key bound to its canonical logical input.

Retrying the same key with the same input returns the committed result.

Reusing the key with different input MUST be refused.

This rule prevents retries from creating duplicate versions, approvals, attempts, runs, imports, or dispositions.

The physical persistence and transaction mechanism remains a technical-design decision.

## 7. Verification concurrency and readiness

At most one active verification attempt MAY exist for an exact verification binding.

Different bindings may run concurrently only when their mutable-state isolation scopes are demonstrably distinct.

Each stateful readiness declaration MUST identify its isolation scope.

- Equal or overlapping scopes serialize.
- Distinct scopes may run concurrently.

The schema must make overlap deterministic. Locking and scheduling mechanics remain deferred.

## 8. Verification binding profiles

### Environment profile

The environment portion of a verification binding MUST use:

- a stable environment-profile ID; and
- an immutable revision/hash of its non-secret semantics.

Secret values and transient runtime resolutions are excluded from the binding and may be recorded safely per run when required.

Changing non-secret environment semantics creates a new profile revision. Rotating an equivalent secret value does not.

### Execution compatibility profile

A verification binding MUST identify compatibility-relevant Pharos, adapter, browser, and execution-contract semantics.

Exact observed runtime versions belong in each run record.

A tool-version change makes a binding stale only when the compatibility policy says execution meaning changed.

The exact compatibility policy remains technical-design work.

## 9. Repair and successor attempts

A repair changes the generated-test hash, so it cannot continue inside an attempt whose binding is immutable.

An eligible repair MUST:

1. close the original attempt;
2. create exactly one linked successor attempt bound to the repaired generated-test hash;
3. use the repair rerun as the successor attempt's targeted run; and
4. require three consecutive stability runs after that targeted success.

The original failure, classification, patch provenance, and attempt relationship MUST remain visible.

The one-repair allowance belongs to the complete generation/verification lineage. The successor attempt MUST NOT reopen repair budget.

## 10. Import authority

A valid imported approval retains its portable identity and original assurance semantics.

Local activation remains explicit.

Divergent imports follow the authority-impact comparison and quarantine rules already defined in the domain PRD.

Importing under a new Beacon ID remains the safe default.

## 11. Evidence identity and deletion

Logical evidence identity is distinct from any physical storage identity.

Deleting evidence for one run MUST mark only that logical evidence reference unavailable.

Even if an implementation shares stored bytes, deleting one logical evidence object MUST NOT change another evidence object's availability.

Physical deduplication, byte deletion, content addressing, and garbage collection remain technical-design decisions.

Evidence loss or deletion MUST NOT rewrite an intact historical run outcome.

## 12. Deferred technical decisions

This document does not choose:

- JSON, YAML, or another physical representation;
- a JSON Schema dialect;
- identifier encoding;
- canonical byte serialization;
- a hashing algorithm;
- file or directory layout;
- archive format;
- storage engine or provider mechanics;
- transaction, lock, or crash-recovery implementation;
- TypeScript interfaces or package libraries;
- CLI commands, wording, or exit-code numbers; or
- Playwright-specific contract types.

Those choices belong to technical design after these lifecycle and semantic rules are accepted.
