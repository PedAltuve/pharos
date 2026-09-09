# Beacon Version Lifecycle Specification

## Purpose

Model pure approval, supersession, revocation, and active-version resolution over the `Beacon` and `Draft` types from `beacon-draft-lifecycle`. Approval re-verifies the operator-reviewed semantic hash on demand through `project()` and the `Hasher` port; nothing is cached. No I/O, no `node:*` import, no external package, and no `Clock`/`IdGenerator` port.

## Requirements

### Requirement: Version Is a Closed Union

`Version` MUST be a closed union discriminated by `status`: `active`, `superseded` (adds `supersededBy`, `supersededAt`), or `revoked` (adds `revocation: RevocationRecord`). Every `Version` MUST carry `versionId`, a monotonic `localNumber`, `approval: ApprovalRecord`, and `provenance: VersionProvenance`. No nullable status flag MAY substitute for the union, so a revoked version without a `RevocationRecord` is unrepresentable.

`ApprovalRecord` MUST carry `approvedAt`, `reviewedHash`, and `staleOriginAcknowledged: boolean`. `VersionProvenance` MUST carry `approvedDraftId`, `approvedRevision`, and `branchedFromVersion: string | null`. `RevocationRecord` MUST carry `revokedAt` and `reason`.

#### Scenario: Local numbers are monotonic per Beacon

- GIVEN a Beacon with versions numbered 1 and 2
- WHEN a third version is approved
- THEN its `localNumber` is 3, independent of any other Beacon's numbering

### Requirement: approveDraft Re-Verifies the Reviewed Hash

`approveDraft` MUST accept the draft to approve, a caller-supplied `versionId`/`approvedAt`, the operator-`reviewedHash`, a `staleOriginAcknowledged` flag, and a `Hasher`. It MUST recompute `hasher.hash(project(draft.content))` and refuse when that differs from `reviewedHash`, mutating nothing. It MUST refuse when the draft is not `open`.

#### Scenario: Recomputed hash mismatch refuses approval

- GIVEN an open draft whose content changed after the operator reviewed `reviewedHash`
- WHEN `approveDraft` recomputes the hash via `project()` and the `Hasher`
- THEN it returns `{ ok: false }` and the Beacon is unchanged

### Requirement: Stale-Origin Approval Requires Explicit Acknowledgment

When the draft's `origin.branchedFromVersion` differs from the Beacon's current `activeVersionId`, `approveDraft` MUST refuse unless `staleOriginAcknowledged` is `true`. This is a boolean gate only; no semantic comparison of the divergence is performed by the domain.

#### Scenario: Stale origin without acknowledgment is refused

- GIVEN a draft branched from a version that is no longer active
- WHEN `approveDraft` is called with `staleOriginAcknowledged: false`
- THEN it returns `{ ok: false }` and the Beacon is unchanged

#### Scenario: Stale origin with acknowledgment proceeds

- GIVEN the same stale-origin draft
- WHEN `approveDraft` is called with `staleOriginAcknowledged: true` and a matching reviewed hash
- THEN approval proceeds to supersession and activation

#### Scenario: Null active version is stale relative to any recorded branch origin

- GIVEN a draft with `origin.branchedFromVersion: "ver_old"` on a Beacon with `activeVersionId: null` (e.g., after revocation)
- WHEN `approveDraft` is called with `staleOriginAcknowledged: false`
- THEN it returns `{ ok: false }` with `stale-origin-not-acknowledged`, and the Beacon is unchanged

### Requirement: Approval Returns One Atomic Beacon

On success, `approveDraft` MUST return a single new `Beacon` in which: a new `active` `Version` is appended with the next monotonic `localNumber`; any prior `active` version becomes `superseded` (`supersededBy` set to the new `versionId`); the approved draft becomes `closed`, retaining its content as provenance; and `activeVersionId` points at the new version. No intermediate or partially-activated state MAY be observable.

#### Scenario: Approval supersedes the prior active version

- GIVEN a Beacon with `activeVersionId: "ver_1"`
- WHEN a new draft is approved as `ver_2`
- THEN the returned Beacon has `ver_1` as `superseded`, `ver_2` as `active`, and `activeVersionId: "ver_2"`

### Requirement: revokeVersion Works on Any Approved Version

`revokeVersion` MUST accept any `versionId` regardless of `active` or `superseded` status and transition it to `revoked` with a `RevocationRecord`. It MUST refuse when the version does not exist or is already `revoked`.

#### Scenario: Revoking the active version clears the pointer

- GIVEN `activeVersionId: "ver_2"`
- WHEN `revokeVersion` is called with `"ver_2"`
- THEN the returned Beacon has `ver_2` as `revoked` and `activeVersionId: null`, with no older version auto-reactivated

#### Scenario: Double revocation is refused

- GIVEN `ver_1` already `revoked`
- WHEN `revokeVersion` is called with `"ver_1"` again
- THEN it returns `{ ok: false }` and the Beacon is unchanged

### Requirement: resolveActiveVersion Is a Pure Lookup

`resolveActiveVersion` MUST return the `Version` matching `activeVersionId`, or `null` when `activeVersionId` is `null`. It MUST NOT mutate the Beacon. The resolved record's embedded `versionId` MUST equal the `activeVersionId` key used to look it up; a mismatch MUST throw, since it signals store corruption rather than an expected refusal.

#### Scenario: No active version resolves to null

- GIVEN a Beacon with `activeVersionId: null`
- WHEN `resolveActiveVersion` is called
- THEN it returns `null`

#### Scenario: Version identity mismatch throws

- GIVEN a Beacon whose `versions` map stores a record under key `"ver_A"` whose embedded `versionId` is `"ver_B"`
- WHEN `resolveActiveVersion` is called with `activeVersionId: "ver_A"`
- THEN it throws, since the key/identity mismatch is store corruption, not an expected refusal
