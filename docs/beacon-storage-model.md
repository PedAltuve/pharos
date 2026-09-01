# Beacon Storage Model

Pharos stores Beacons outside the application repository. Storage is provider-based, works without Engram, and preserves the trust and lifecycle rules defined in [`beacon-trust-model.md`](beacon-trust-model.md).

## Decision summary

| Topic | Decision |
|---|---|
| Canonical location | Beacon artifacts live outside the application repository. |
| v1 semantic storage | External filesystem-backed `BeaconStore`. |
| v1 evidence storage | External content-addressed `EvidenceStore`. |
| Engram | Optional discovery and agent-context integration, not canonical approval authority. |
| Portability | Beacon versions can be exported and imported as portable bundles. |
| Future team storage | A dedicated Git repository is the first planned alternative backend. |
| Application repository | Contains at most a stable Pharos project identity and non-secret configuration. |

This supersedes the current statement in `PHAROS.md` that the application repository's `.pharos` directory is the workflow source of truth. That document must be revised before implementation.

## Storage boundaries

Pharos separates three responsibilities:

```text
BeaconStore       → immutable semantic bundles and approvals
EvidenceStore     → traces, screenshots, videos, and logs
DiscoveryIndex    → searchable summaries and agent context
```

These responsibilities may use different providers. A discovery provider cannot become approval authority merely because it can locate a Beacon.

## BeaconStore

`BeaconStore` is the canonical source for:

- Beacon identity and versions;
- approval-bound semantic artifacts;
- semantic hashes;
- lifecycle state;
- approval and revocation records;
- active-version resolution; and
- references to supporting evidence.

Every provider must enforce the Pharos domain rules:

- approved versions are immutable;
- one Beacon ID has at most one active approved version;
- approving a new version atomically supersedes the previous active version;
- semantic changes create a new draft version;
- revoked versions cannot be used for future generation or verification; and
- historical run references remain resolvable.

A conceptual provider interface is:

```ts
interface BeaconStore {
  getVersion(
    projectId: string,
    beaconId: string,
    version: number,
  ): Promise<BeaconVersion>;

  getActiveVersion(
    projectId: string,
    beaconId: string,
  ): Promise<BeaconVersion | null>;

  saveDraft(candidate: BeaconDraft): Promise<BeaconVersion>;
  approve(request: ApprovalRequest): Promise<BeaconVersion>;
  revoke(request: RevocationRequest): Promise<BeaconVersion>;

  listVersions(
    projectId: string,
    beaconId: string,
  ): Promise<BeaconVersionSummary[]>;
}
```

This interface is conceptual. Exact method names and transaction semantics remain to be designed.

## EvidenceStore

`EvidenceStore` owns potentially large or nondeterministic artifacts:

- Playwright traces;
- screenshots;
- videos;
- console logs;
- network diagnostics; and
- generated reports.

Evidence should be content-addressed where practical. Beacon manifests and run results reference evidence by digest and storage reference.

Evidence bytes are not part of the Beacon's semantic approval hash. Their own hashes may still be recorded to detect corruption or substitution.

Retention, redaction, encryption, and garbage-collection policies remain unresolved.

## DiscoveryIndex

`DiscoveryIndex` helps humans and agents find relevant Beacons. It may contain:

- Beacon ID and active version;
- lifecycle status;
- semantic hash;
- purpose and short summary;
- covered actors, routes, or product capabilities;
- canonical store reference; and
- timestamps useful for discovery.

Discovery data is derived and may be rebuilt. Pharos must resolve the referenced version from `BeaconStore` and verify its semantic hash before generation or execution.

A stale, missing, or conflicting discovery record cannot override canonical Beacon state.

## Engram integration

Engram is an optional `DiscoveryIndex` provider. It improves cross-session and agent discovery but is not required to use Pharos.

A conceptual Engram observation is:

```yaml
beacon_id: quote-happy-path
version: 1
status: approved
semantic_hash: sha256:<digest>
store_reference: pharos://<project-id>/quote-happy-path/1
summary: Guest completes the approved quote journey
```

Engram should store summaries, decisions, hashes, and canonical references. It should not be required to store complete immutable bundles or large binary evidence.

Engram observations are discovery hints, not approval records. An agent finding a Beacon through Engram must still load and verify it through Pharos.

## Default external filesystem layout

The proposed v1 layout follows the operating system's user-data convention. On Linux, the root should honor `XDG_DATA_HOME`.

```text
$XDG_DATA_HOME/pharos/
  projects/
    <project-id>/
      beacons/
        quote-happy-path/
          versions/
            0001/
              manifest.json
              beacon.yaml
              acceptance.yaml
              checkpoints.yaml
              journey.spec.ts
          current
      evidence/
        sha256/
          <content-hash>
```

Equivalent platform-appropriate data directories should be used on macOS and Windows.

The `current` representation must be portable across supported platforms. Whether it is a text pointer, manifest entry, or filesystem link remains unresolved.

## Application repository identity

The tested application repository may contain a small, stable identity document such as:

```yaml
version: 1
project_id: 01JPHAROS...
```

Its purpose is to associate different clones and worktrees with the same Pharos project. It must not contain:

- absolute local paths;
- credentials;
- access tokens;
- machine-specific configuration; or
- approval authority.

Local Pharos configuration maps the project identity to a selected store and credentials. Shared provider locations may be declared separately when they contain no secrets.

The exact filename, project-ID format, and configuration precedence remain unresolved.

## Portable bundles

Pharos must support exporting and importing a complete Beacon version without requiring its original provider.

A portable bundle should contain:

- the semantic bundle;
- canonical manifest;
- semantic hash;
- lifecycle and approval record;
- evidence references;
- schema versions; and
- optionally embedded supporting evidence.

Import must verify hashes before accepting the bundle. Importing an approved version must preserve its recorded assurance semantics; it must not silently upgrade `operator_confirmed` into a stronger assurance level.

The archive format and filename extension remain unresolved.

## Planned providers

### v1

- external filesystem `BeaconStore`;
- content-addressed filesystem `EvidenceStore`;
- optional Engram `DiscoveryIndex`; and
- portable export/import.

### After v1

- dedicated Git repository `BeaconStore` for team sharing and review history;
- S3-compatible `EvidenceStore` for remote evidence; and
- stronger approval providers where required.

Multiple providers must not force the Pharos domain to support the least common denominator. Each provider should declare capabilities and fail explicitly when a required lifecycle or consistency guarantee is unavailable.

## Open questions

1. Canonical semantic bundle format and hashing rules.
2. Filesystem transaction and crash-recovery behavior.
3. Project identity format and repository filename.
4. Store configuration precedence and provider selection.
5. Portable bundle archive format.
6. Evidence retention, redaction, encryption, and garbage collection.
7. Git repository provider transaction semantics.
8. Behavior when the configured store is unavailable.
9. Conflict handling when two machines create drafts concurrently.
10. Discovery-index reconciliation and removal of stale entries.

## Next decision

Define the Beacon lifecycle state machine and its atomic storage requirements. Those requirements determine what every `BeaconStore` provider must guarantee.
