# Pharos v1 Technical Design (Draft)

This document selects the mechanisms deliberately deferred by the domain PRD and the lifecycle/schema specification. Those documents remain authoritative for behavior; this one decides how that behavior is implemented.

Inputs, in precedence order:

1. `domain-requirements-v1.md`
2. `lifecycle-and-schema-specification-v1.md`
3. `product-requirements-v1.md`
4. `PHAROS.md` (historical)

Status: **draft for review**. Sections marked `[decide]` contain choices made in this draft that had no prior explicit approval.

---

## 1. Stack

| Concern | Choice |
|---|---|
| Runtime | Node.js >= 20 LTS `[decide]` |
| Language | TypeScript, strict mode, ESM |
| Distribution | npm package `pharos` with committed `package-lock.json` |
| Browser adapter | Playwright Test + Chromium only |
| CLI parsing | Commander |
| Interactive prompts | `@clack/prompts` |
| Schema validation | JSON Schema draft 2020-12, validated with Ajv |
| Canonicalization | RFC 8785 (JCS) |
| Hashing | SHA-256 |
| Locking | `proper-lockfile`-style project lock |

No package-install lifecycle scripts. Chromium is installed only through `pharos browser install`.

---

## 2. Module architecture

Single npm package, hexagonal boundaries enforced by directory structure and lint rules (no runtime framework).

```text
src/
  domain/            # pure: no I/O, no Node APIs beyond data structures
    beacon/          # identity, drafts, versions, approval, revocation
    semantics/       # semantic projection, normalization, hashing rules
    verification/    # binding, attempt state machine, run outcomes
    evidence/        # logical evidence references
    staleness/       # deterministic signals and dispositions
    ports/           # BeaconStore, EvidenceStore, DiscoveryIndex,
                     # VerificationAdapter, RecorderAdapter, Clock, IdGenerator
  application/       # use cases: one module per lifecycle operation
                     # (associateProject, saveDraft, approveVersion, revokeVersion,
                     #  createTaskPackage, runVerification, resumeAttempt,
                     #  recordDisposition, importBundle, exportBundle, ...)
  adapters/
    fs-beacon-store/     # canonical store, atomicity, journal, locking
    fs-evidence-store/   # content-addressed evidence objects
    playwright/          # recorder + runner + evidence collection
    engram-discovery/    # optional, non-authoritative
    hashing/            # RFC 8785 canonicalization + SHA-256
  cli/               # Commander commands, clack flows, output envelopes
  shared/            # result types, error taxonomy, canonical JSON utils
```

Dependency rule: `cli → application → domain`. Adapters implement `domain/ports` and are wired in a composition root inside `cli/`. The domain never imports adapters, Playwright types, or Node `fs`.

Rationale: the domain PRD requires contracts independent of Playwright and storage mechanics; a pure domain package makes that a compile-time property and keeps strict TDD cheap.

---

## 3. Identifiers

- UUIDv7, lowercase, with a typed prefix: `proj_`, `bcn_`, `drf_`, `ver_`, `run_`, `att_`, `env_`, `exe_`, `evd_`, `bnd_`.
- Encoding: prefix + UUIDv7 canonical hex form (`bcn_0190f3c2-...`). `[decide]`
- UUIDv7 gives time-ordered directory listings without a coordination service; the prefix makes every log line and error self-describing.
- Portable version IDs are `ver_` IDs. Local version numbers are plain monotonic integers assigned per Beacon by the store and never renumbered.

### Project identity in the target repository

`[decide]` The target repository MAY contain a single marker file:

```text
.pharos/project.json
{
  "version": 1,
  "project_id": "proj_0190f3c2-..."
}
```

- It carries identity only: no Beacons, evidence, credentials, absolute paths, or approval authority.
- It keeps identity stable across clones and worktrees.
- When the repository must remain untouched (external-mode reference B), the marker is optional: the global store also maintains a `paths → project` association map, and `pharos` resolves identity by walking up from cwd. The marker file wins over the map when both exist and agree; a mismatch is a refusal, never a silent pick.

---

## 4. Canonical storage layout

Pharos home directory `[decide]`:

- Linux: `$XDG_DATA_HOME/pharos` (default `~/.local/share/pharos`)
- macOS: `~/Library/Application Support/pharos`

```text
<pharos-home>/
  store/
    <project_id>/
      project.json               # mutable context: name, base URL, test mode, env profiles
      lock                       # mutation lock (advisory, stale-detected)
      journal/
        idempotency/<key-hash>.json
      beacons/
        <beacon_id>/
          beacon.json            # identity + mutable title
          active.json            # { "active_version": "ver_..." } or absent
          drafts/
            <draft_id>/
              draft.json         # mutable, carries "revision": n and branch origin
              tombstone.json     # written on abandonment, draft.json removed
          versions/
            <version_id>/
              manifest.json      # IMMUTABLE: identity, local number, hashes, approval,
                                 # provenance (approved draft id + revision), schema versions
              semantics.json     # IMMUTABLE: approval-bound semantic bundle
              revocation.json    # IMMUTABLE once written
      attempts/
        <attempt_id>/attempt.json
      runs/
        <run_id>/run.json        # IMMUTABLE run record
      dispositions/
        <disposition_id>.json    # IMMUTABLE staleness/keep-active records
      quarantine/
        <import_id>/...          # divergent imports, untouched bundles + comparison
  evidence/
    objects/sha256/<aa>/<hash>   # content-addressed bytes, shared
    manifests/<run_id>.json      # logical evidence references for one run
  external-tests/
    <project_id>/                # external mode: package.json, playwright config, tests/
  cache/
```

Key properties:

- Everything immutable is a file that is written once and never rewritten. Immutability is an enforcement rule of `fs-beacon-store`, not a hope.
- `active.json` is the only pointer file; swapping it is the atomic activation/supersession step.
- Logical evidence lives in per-run manifests; physical bytes are content-addressed and deduplicated. Deleting a run's evidence marks references unavailable in the manifest and garbage-collects objects only when no manifest still references them — exactly the deletion isolation the lifecycle spec requires.

---

## 5. Atomicity, locking, recovery

### Write protocol

Every file write: write to `<name>.tmp.<random>` in the same directory → `fsync` → `rename` → `fsync` parent directory. Rename on the same filesystem is atomic on Linux and macOS.

### Approval sequence (the critical transaction)

1. Acquire project lock.
2. Re-verify the reviewed semantic hash still matches the draft revision (refuse otherwise).
3. Write `versions/<version_id>/semantics.json`, then `manifest.json` (atomic writes).
4. Swap `active.json` to the new version (single atomic rename — this is the commit point).
5. Mark the approved draft closed (provenance retained), write journal entry.
6. Release lock.

Crash before step 4: an orphan version directory with no `active.json` reference and no journal commit → recovery marks it as an aborted approval artifact and reports it; it never becomes active silently. Crash after step 4: activation happened; steps 5–6 are replayed idempotently on next command (`pharos status` performs recovery scanning).

### Locking

One advisory lockfile per project serializes all mutations. Reads are lock-free (immutable files make this safe). Stale locks are broken after a liveness check. This is sufficient for the v1 single-developer profile; real edit conflicts are handled logically by draft revisions and idempotency keys, not by the lock.

### Idempotency journal

`journal/idempotency/<sha256(key)>.json` stores: the key, the JCS hash of the canonical logical input, and the committed result reference. Same key + same input hash → return committed result. Same key + different hash → `refused`. Journal entries are written inside the mutation's lock scope, after the commit point.

---

## 6. Draft revisions and conflicts

- `draft.json` carries `revision` (integer, starts at 1) plus branch origin (`branched_from_version`, `branched_from_hash`, optional `forked_from_draft`).
- Every save carries `expected_revision`. Mismatch → the save is rejected without touching the file, and the CLI presents exactly the two exits the spec defines: refresh onto the current revision, or preserve the work as a new fork draft.
- Abandonment replaces `draft.json` with `tombstone.json` (draft ID, origin, final revision + hash, timestamps, reason).

---

## 7. Canonicalization, semantic hash, schemas

### Canonical bytes

All hashed artifacts are canonicalized with RFC 8785 (JCS) and hashed with SHA-256. Hash strings are `sha256:<hex>`. JCS is used only at hash/compare time; stored files are pretty-printed JSON for inspectability.

### Semantic projection

The semantic hash is computed over a schema-independent projection object built by the domain:

1. Interpret the draft/version content using its declared contract schema version.
2. Resolve declared defaults (omitted == explicit default; `null` only meaningful where the schema declares it).
3. Order-sensitive collections (journey actions, explicitly ordered checkpoints) become arrays; order-insensitive keyed collections (variables, outcomes, prohibited regressions, allowed variation) become objects keyed by logical identity.
4. Exclude everything the lifecycle spec excludes: identities, addresses, titles, schema versions, approval metadata, supporting-artifact references, secrets, runtime-resolved values.
5. Include the stateful/stateless classification and deterministic isolation/reset intent; exclude setup mechanics and validation results.

Migration equivalence is literally `hash(projection(source, source_schema)) === hash(projection(target, target_schema))`.

### Contract schemas

Each contract type is versioned independently: `"contract": "pharos.beacon-semantics/1"`, `pharos.version-manifest/1`, `pharos.task-package/1`, `pharos.run-record/1`, `pharos.evidence-manifest/1`, `pharos.bundle-manifest/1`, etc. JSON Schemas ship inside the package and validate every read and write. An unknown newer contract version triggers the preserve-but-block-authority behavior from the lifecycle spec.

---

## 8. CLI

### Command surface

As planned in the product PRD (`pharos start|init|status`, `pharos beacon record|annotate|inspect|approve|revoke`, `pharos agent task`, `pharos run`, `pharos browser install`), plus:

- `pharos beacon draft list|fork|abandon` — multi-draft management the domain requires.
- `pharos bundle export|import` — portable bundles.
- `pharos attempt resume|restart` — interrupted-attempt recovery.

### Output envelopes

Every command supports `--format json` emitting one envelope on stdout:

```json
{
  "contract": "pharos.cli-envelope/1",
  "command": "beacon.prepare",
  "outcome": "succeeded",
  "data": {},
  "errors": [],
  "next_action": { "command": "host-decision-required", "reason": "Present the exact request in a trusted interactive host" }
}
```

Human output goes to stderr in JSON mode. Guided flows (`pharos start`) persist a resumable cursor in the store so interruption is inspectable and resumable.

### Exit codes `[decide]`

| Code | Meaning |
|---|---|
| 0 | succeeded |
| 1 | failed (ran, missed required outcome) |
| 2 | usage / invalid invocation |
| 3 | refused (invariant or v1 boundary) |
| 4 | inconclusive (human action required) |
| 5 | interrupted |
| 10 | internal error |

### Operator consent (implemented HRC slice; not the planned CLI catalog above)

The agent-visible CLI provides `beacon prepare` and `beacon consent-status` for public, project-scoped request preparation and inspection only. It registers no grant, decline, or completion command. The legacy `beacon approve`/`beacon revoke` command routes have been retired from production registration; planned `record|annotate`, task, run, and bundle commands in this section are not claims of current availability.

The runtime-neutral request binds project, Beacon, request ID and expiring challenge to either draft ID/revision/semantic hash (plus required stale-origin acknowledgement) or expected active version and normalized revocation reason. A human invokes the Pi `pharos-consent` command in interactive TUI; it displays the exact public request, offers fixed Approve/Decline choices, keeps an Ed25519 signer in memory, and calls the host-only in-process runtime. Public-key trust is project-bound; private key and signed grant are not returned in agent-visible CLI envelopes. The host runtime is not a model tool and does not itself attest who invoked it. A verified claim durably fixes the action command before the locked Beacon mutation; the separate TUI-only `/pharos-consent-recover` displays the original public request and resumes that claim after process restart while the host runtime loads the persisted signed grant internally. Terminal results and same-input replay require no new approval and cannot authorize another mutation. Unknown contract versions, changed binding/state, expired or declined pending requests refuse without mutation. Assurance remains `operator_confirmed`, not proof of human identity or protection against an arbitrary malicious same-user process.

---

## 9. Playwright adapter

- **Recorder**: launches Playwright codegen against the configured base URL, captures the raw recording as a supporting artifact attached to the draft. Recordings are sanitized (secret-literal scan against declared secret references) before annotation can complete.
- **Runner**: executes the targeted test via Playwright Test with a JSON reporter; parses results into domain `RunRecord`s. Trace/screenshot/video retention follows the evidence defaults (full evidence on failure, structured summary on success, sensitive journeys default to summaries only).
- **Repository mode**: uses the repo's own Playwright installation after a compatibility preflight (version within the supported range, config present). Pharos never installs anything into the repo.
- **External mode**: `external-tests/<project_id>/` is a Pharos-owned npm project with pinned Playwright; generated tests live and run there.
- All Playwright-specific data (trace paths, selector text, reporter payloads) stays inside the adapter; the domain sees only tool-neutral contracts.

### Compatibility policy `[decide]`

Each Pharos release declares a supported Playwright semver range and a Chromium provenance (the Playwright-bundled build). The execution profile records the policy-relevant semantics (adapter contract version, browser family, headless mode). Exact observed versions go into each run record. A version change marks a binding stale only when it leaves the declared supported range.

---

## 10. Verification engine

The attempt state machine lives in the domain:

```text
created → targeted_running → targeted_passed → stability_running(1..3)
        → verified | failed | interrupted | inconclusive
```

- One active attempt per exact binding, enforced by the store under the project lock.
- Stateful isolation scopes are declared strings with declared overlap semantics (equal scope = overlap; `*` overlaps all) `[decide]`; overlapping scopes serialize.
- Every run is committed as an immutable `run.json` before the state machine advances — resume can then continue from the next required run without re-presenting completed runs.
- Repair: one causal patch, limited to designated test artifacts (enforced by diff scope check against the task package's edit scope), closes the attempt and opens the single linked successor attempt per the lifecycle spec.

---

## 11. Portable bundles, import, quarantine

`[decide]` Bundle format: a zip archive with extension `.pharosbundle` containing `bundle-manifest.json` (contract versions, content hashes) plus the exported immutable records and optional evidence manifests. Zip gives random-access verification before extraction; every entry is hash-verified against the manifest before anything touches the store.

Import pipeline: verify hashes → validate schemas → detect history relationship (fast-forward, identical, divergent) → divergent goes to `quarantine/<import_id>/` untouched, with a generated authority-impact comparison JSON that the CLI renders compactly. Resolution dispositions (keep local / replace / new Beacon ID, default new ID) are recorded as immutable disposition records; replaced local history moves into quarantine, never deleted.

---

## 12. Testing strategy

Strict TDD throughout.

- **Domain**: pure unit tests; property-based tests for the semantic projection (ordering insensitivity, default resolution, hash stability).
- **Ports**: one shared contract-test suite per port, run against every adapter implementation (fs stores now, git store post-v1) — the suite encodes the atomicity, immutability, and idempotency invariants, including crash-injection tests around the approval sequence.
- **CLI**: integration tests over the JSON envelopes and exit codes.
- **Acceptance**: the two reference applications (repository mode + external mode) automate the v1 release acceptance checklist.

---

## 13. Open items for review

1. Node >= 20 LTS floor.
2. `.pharos/project.json` as the repo identity marker + path-map fallback.
3. Exit-code table.
4. `.pharosbundle` zip format.
5. Isolation-scope overlap semantics (exact-match + wildcard) — richer matching deferred.
6. Evidence garbage-collection trigger (explicit `pharos evidence gc` only in v1; no automatic retention timer).
