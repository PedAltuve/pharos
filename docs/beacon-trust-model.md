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
| v1 approval method | Approval is granted through an explicit interactive CLI workflow. |
| v1 assurance | Approval means `operator_confirmed`, not cryptographically human-verified. |
| Agent role | Agents may prepare and request approval, but must not grant approval. |

## Trust boundary

A Beacon represents a human-approved example of intended product behavior. Pharos must preserve the distinction between:

1. an agent preparing an approval candidate;
2. an operator reviewing and approving that candidate; and
3. a deterministic verification engine executing tests derived from it.

The v1 workflow protects against accidental or silent approval. It does not prove that a human, rather than a sufficiently privileged agent, controlled the terminal. A TTY prompt is an interaction boundary, not cryptographic human attestation.

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

The proposed v1 workflow is:

```text
Agent or operator prepares candidate
              ↓
Pharos computes semantic diff and hash
              ↓
Agent requests approval
              ↓
Operator runs interactive approval command
              ↓
CLI presents semantic summary and exact hash
              ↓
Operator explicitly confirms
              ↓
Pharos records operator-confirmed approval
```

The approval command should not provide a routine noninteractive bypass. This reduces accidental agent approval, but it must not be presented as a security boundary against an agent that controls the operator's terminal or credentials.

A conceptual approval record is:

```yaml
approval:
  method: local_interactive
  assurance: operator_confirmed
  semantic_hash: sha256:<digest>
  actor: <operator identity>
  approved_at: <timestamp>
```

The actor identity source and canonical hashing rules remain to be specified.

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

The initial provider is:

```text
local-interactive → operator-confirmed assurance
```

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
3. Source of the local operator identity.
4. Storage layout for immutable Beacon versions.
5. Revocation authority and required reason metadata.
6. How approval requests expire or become invalid.
7. How stale Beacons are detected without revoking historical approval.
8. How derived specifications and tests bind to a Beacon version.
9. Which evidence metadata is retained, redacted, or excluded from version control.
10. Migration behavior when Beacon schema versions change.

## Next decision

Specify the Beacon lifecycle state machine, including who may initiate each transition and whether superseding or revoking an approved version requires the same authority as approval.
