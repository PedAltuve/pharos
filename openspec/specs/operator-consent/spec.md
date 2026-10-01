# Host-Relayed Operator Consent Specification

## Purpose

Enable agent-safe Beacon preparation and status while keeping approval and revocation decisions in a human-invoked Pi TUI. This slice applies to non-production projects. `operator_confirmed` records a host-relayed interaction, not proof of a person's identity; malicious arbitrary same-user process access is outside v1 scope.

## Requirements

### Requirement: Agent-visible commands cannot decide

The production CLI MUST expose project-associated `beacon prepare approve|revoke` and `beacon consent-status` with one nonsecret JSON envelope. It MUST NOT register direct Beacon approval/revocation, decline, grant submission, or consent completion commands. A selected project ID MUST NOT override an unassociated or differently associated cwd for consent operations.

#### Scenario: Agent attempts a legacy authority command

- GIVEN a project with a pending request
- WHEN an agent invokes `pharos beacon approve` or `pharos beacon revoke`, even through a PTY
- THEN the command is unavailable and cannot change Beacon authority

### Requirement: One exact, expiring decision binding

A version-1 request MUST bind a project, Beacon, request ID, challenge and expiry. Non-stale approval MUST additionally bind the open draft, expected revision and semantic hash; revocation MUST bind the expected active version and normalized nonempty reason. A stale-origin approval MUST use the separate version-2 request and grant, binding those draft fields plus `staleOriginAcknowledged: true`, the reviewed current active version ID and semantic hash (both `null` when there is no active version), and a domain-separated comparison digest. A version-1 stale-origin grant MUST NOT authorize approval. Preparation proposes the acknowledgement but MUST NOT treat it as consent. The host MUST validate the current active version's stored semantic projection against its approval hash, display its complete comparison with the draft projection (or an explicit no-active case) in visible numbered review pages before offering fixed Approve/Decline choices, and recheck the signed snapshot under the Beacon approval lock before writing artifacts. Sensitive approval-bound fields MUST show whether they changed without disclosing their values; the host MUST confirm the pre-signature review still equals what was displayed. Missing, changed or corrupt comparison material MUST refuse rather than silently compare with another version. Unknown versions and changed bindings MUST NOT authorize mutation.

#### Scenario: Draft changes after preparation

- GIVEN a pending approval request for one draft revision and hash
- WHEN that draft changes before completion
- THEN the authority transition refuses without activating a version

### Requirement: Only host-verified consent changes authority

The Pi adapter MUST register a human-invoked slash command, not a model-callable consent tool. It MUST refuse non-TUI invocation. After an explicit Approve choice it MAY sign the exact request with an in-memory Ed25519 key whose public key is trusted for that project. The store MUST verify the signature and active public key before the durable claim. A bare boolean, model argument, actor label, unsigned grant or arbitrary request ID MUST NOT suffice. The private key and signed grant MUST NOT appear in agent-visible commands, tools, results, session entries or repository configuration.

#### Scenario: A model submits a confirmation boolean

- GIVEN a pending request with no verified signed grant
- WHEN model-controlled input claims the operator confirmed
- THEN no Beacon authority is created or revoked

### Requirement: Decline, expiry and conflicts fail closed

Decline MUST be terminal for that request and MUST NOT mutate Beacon authority. Expired pending requests MUST NOT be newly claimed. A changed action, signer, project, Beacon or state snapshot MUST refuse; a new request is required for a changed intended action.

#### Scenario: A declined request is replayed

- GIVEN a terminally declined request
- WHEN an approval grant or recovery request refers to it
- THEN completion refuses without mutation

### Requirement: Verified claims recover without new authority

A verified claim MUST durably fix the exact signed grant and immutable action command before the Beacon mutation. The host-only runtime MAY resume the persisted command after interruption, including after expiry or key rotation, but MUST NOT return the stored grant through Pi or CLI. The separate TUI-only recovery command MUST show the original public request and require Resume rather than silently acting; pending, declined, legacy and unverified claims MUST NOT be resumed. For a version-2 stale claim, recovery MUST revalidate and show the original trusted comparison, including when the new version has already committed and its reviewed predecessor is now superseded. It MUST distinguish a mutation still pending from one already committed; it MUST NOT reinterpret a different active version as the reviewed predecessor. Same-input terminal replay MUST return the original result without a second mutation.

#### Scenario: Pi exits after claim but before mutation

- GIVEN a verified durable claim whose original signing key was subsequently retired
- WHEN a fresh Pi TUI session displays the original request and the operator selects Resume
- THEN the host completes the exact persisted action once, or returns its already persisted terminal result, without emitting the signed grant
