# Beacon Trust Model

This document defines the initial trust and approval model for Pharos Beacons. It records decisions made during product planning and distinguishes them from unresolved design questions.

## Decision summary

| Topic | Decision |
|---|---|
| Verification engine | Pharos contracts remain tool-independent; Playwright is the only v1 adapter. |
| Approval scope | Approval binds the Beacon's semantic bundle. |
| Supporting evidence | Traces and screenshots are referenced but are not approval-critical bytes. |
| Versioning | Approved Beacon versions are immutable. |
| Semantic changes | Any approval-bound change creates a new draft version requiring approval. |
| Current HRC approval method | Agent-safe CLI preparation/status; human-invoked Pi TUI decision and host-only signed completion. |
| v1 assurance | Approval means `operator_confirmed`, not cryptographically human-verified. |
| Agent role | Agents may prepare and request approval, but must not grant approval. |

## Trust boundary

A Beacon represents a human-approved example of intended product behavior. Pharos must preserve the distinction between:

1. an agent preparing an approval candidate;
2. an operator reviewing and approving that candidate; and
3. a deterministic verification engine executing tests derived from it.

The current host-relayed workflow protects the supported model/tool protocol: model text and agent-visible CLI commands cannot submit a decision or grant. It does not prove the identity of a human or resist a malicious process with arbitrary same-user shell/process access. A TUI choice is not cryptographic human attestation.

Pharos must describe this honestly. The v1 assurance level is **operator-confirmed**.

## Approval scope

Approval binds the Beacon's semantic bundle:

- purpose and human intent;
- actor and entry point;
- variables and their classifications;
- required outcomes;
- allowed variation;
- prohibited regressions;
- checkpoints;
- acceptance contract; and
- recorded journey.

These artifacts define what the approved demonstration means. Their exact approval-bound contents must be represented by a deterministic semantic hash.

### Supporting evidence

Raw traces, screenshots, and similar recording artifacts support review and diagnosis, but their exact bytes are not approval-critical. They may contain nondeterministic metadata or be regenerated without changing the approved meaning.

The approval manifest should reference supporting evidence and may record its hashes for integrity. A supporting-evidence change alone must not create a new semantic Beacon version.

## Versioning and immutability

An approved Beacon version is immutable.

When any approval-bound semantic artifact changes:

1. the approved version remains unchanged;
2. Pharos creates a new draft version;
3. the new version receives a new semantic hash; and
4. the new version requires explicit approval.

Historical verification runs must continue to reference the exact Beacon version and semantic hash against which they executed.

Pharos must distinguish at least these conditions:

- **draft** — not yet approved;
- **approved** — immutable and available as an authoritative input;
- **superseded** — historically valid but replaced by a newer approved version;
- **revoked** — no longer trusted as an authoritative input; and
- **stale** — potentially inconsistent with the current application or derived artifacts, without implying that its historical approval was invalid.

The precise lifecycle transitions remain to be specified.

## Interactive approval workflow

The current HRC workflow (not the historical standalone CLI proposal) is:

```text
Agent or operator prepares candidate
              ↓
Pharos computes the reviewed semantic hash
              ↓
Agent requests approval
              ↓
Operator invokes Pi pharos-consent in an interactive TUI
              ↓
Pi displays the exact pending action and fixed choices
              ↓
Operator chooses Approve or Decline
              ↓
Pharos records operator-confirmed approval
```

The agent-visible CLI exposes only preparation and status. The Pi command refuses non-TUI invocation; its in-memory signer and project-bound public trust support a host-only grant path, not a model-callable decision route. A decline is terminal; signed completion is bound to the displayed request and guarded by durable claim/replay and fresh-state checks. If a Pi process stops after a verified claim, the separate TUI-only `/pharos-consent-recover` displays its original public request and resumes the persisted action without returning the stored signed grant. This boundary must not be described as protection against arbitrary same-user process control.

A conceptual approval record is:

```yaml
approval:
  method: host_relayed
  assurance: operator_confirmed
  semantic_hash: sha256:<digest>
  actor: null # no verified operator identity in the current host-relayed path
  approved_at: <timestamp>
```

A future identity provider is not part of the current assurance; canonical semantic hashing is defined by the semantic-projection specification.

## Agent policy

Agents may:

- create or update draft Beacon candidates;
- compute and present semantic differences;
- request human approval;
- generate specifications and tests from approved versions; and
- report when approval is missing, stale, revoked, or invalid.

Agents must not:

- grant Beacon approval;
- claim that an interactive prompt proves human identity;
- modify an approved Beacon version;
- silently replace approval-bound artifacts;
- carry approval forward to changed semantic content; or
- weaken the acceptance contract to match current application behavior.

These are workflow rules in v1. Stronger enforcement requires an approval mechanism whose signing authority is unavailable to the agent.

## Approval provider boundary

Approval should be modeled as an extensible provider rather than hard-coded as a permanent local CLI mechanism.

The current HRC provider is the Pi host-relayed path with `operator_confirmed` assurance. Other providers remain future work.

Possible future providers include:

- SSH or GPG signatures;
- hardware-backed signatures;
- GitHub or GitLab review approval; and
- organization-specific approval services.

Each provider must declare its assurance semantics. Pharos must not flatten different methods into a generic `human_verified: true` field.

## Verification-engine independence

The trust model belongs to the Pharos domain, not to Playwright.

```text
Beacon and acceptance contracts
              ↓
      Pharos trust model
              ↓
     Verification adapter
              ↓
          Playwright v1
```

Playwright is the only verification adapter planned for v1. Beacon, specification, evidence, result, versioning, and approval schemas must remain independent of Playwright so that future adapters can implement the same domain contracts without redefining trust.

## Open questions

The following decisions remain unresolved:

1. Exact lifecycle states and permitted transitions.
2. Canonical serialization and semantic hashing rules.
3. Stronger operator identity attestation beyond `operator_confirmed`.
4. Storage layout for immutable Beacon versions.
5. Authority models for future providers beyond the current consent-bound revocation reason.
6. Expiry policy for future providers beyond the current expiring challenge.
7. How stale Beacons are detected without revoking historical approval.
8. How derived specifications and tests bind to a Beacon version.
9. Which evidence metadata is retained, redacted, or excluded from version control.
10. Migration behavior when Beacon schema versions change.

## Next decision

Specify the Beacon lifecycle state machine, including who may initiate each transition and whether superseding or revoking an approved version requires the same authority as approval.
