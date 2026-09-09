# Exploration: fs-beacon-store (Slice D) — canonical on-disk Beacon store

**Change**: `fs-beacon-store`
**Phase**: explore
**Date**: 2026-09-03
**Project**: pharos
**Artifact store**: hybrid (this file is authoritative; Engram mirror at topic `sdd/fs-beacon-store/explore`)
**Status**: done — NOT ready for proposal (7 open questions below must be resolved with the operator first)

## Current State

- `src/adapters/fs-beacon-store/index.ts` is the Slice A skeleton placeholder: `export {};`. Untouched by Slices A–C.
- `src/domain/ports/index.ts` exports only `Hasher` (`hasher.ts`) and `JsonValue` (`json-value.ts`). No `BeaconStore` port exists yet. No `Clock`/`IdGenerator` port exists — beacon-core (Slice C) explicitly deferred them: "ids and timestamps are caller-supplied strings" (`openspec/changes/beacon-core/proposal.md` Out of Scope).
- The Beacon aggregate Slice D must persist and reconstruct is fully landed: `Beacon { beaconId, title, drafts: Record<string, Draft>, versions: Record<string, Version>, activeVersionId }`; `Draft` is a 3-variant closed union (open/closed/abandoned; `abandoned` drops `content`, keeps `finalHash`); `Version` is a 3-variant closed union (active/superseded/revoked) carrying `ApprovalRecord`, `VersionProvenance`, `RevocationRecord`.
- `getOwn()` in `src/domain/beacon/records.ts` is the mandatory own-property lookup helper for any `Record`-keyed store. The fs adapter's directory-listing-to-record mapping should respect the same discipline conceptually: never trust a path segment that shadows `Object.prototype`.
- `src/shared/result.ts` exports the generic `Result<T, E>` used domain-wide. Nothing prevents adapter reuse, and it is the established convention for expected refusals, as opposed to thrown exceptions for programmer or corruption errors (for example `resolveActiveVersion`'s identity-mismatch throw).
- `eslint.config.base.js` (`boundaries/element-types`): `adapters` may import `adapters`, `domain`, `shared` only — never `application` or `cli`; `domain` may import only `domain` and `shared`. `no-restricted-imports` bans `node:*` inside `src/domain/**` and `src/shared/**` only. `src/adapters/**` is exactly where Node APIs are legal, as already used by `src/adapters/hashing/jcs-sha256-hasher.ts` (`node:crypto`, `node:buffer`). Proven by `tests/architecture/boundaries.test.ts` against `tests/fixtures/boundaries/**`.
- The ratified `project-toolchain` spec fixes the directory skeleton (`src/adapters/{fs-beacon-store,fs-evidence-store,playwright,engram-discovery,hashing}` and siblings). Slice D fills an existing directory and adds no new top-level module root.
- Testing convention: Vitest (`environment: "node"`), fast-check pinned at `4.9.0`, strict TDD (`openspec/config.yaml` `strict_tdd: true`), class-based adapter style (`JcsSha256Hasher implements Hasher`).
- Known issue, informational only and out of scope here: `openspec/changes/beacon-core/` is still present rather than archived, and native status reports `blocked(edit_authority_missing)`. It does not block Slice D technically, because the beacon-core specs are already promoted to `openspec/specs/`.

## On-Disk Contract (`docs/technical-design-v1.md` §4, ratified)

```
<pharos-home>/store/<project_id>/
  project.json                      # mutable, NOT Beacon data — recommend excluding from BeaconStore contract
  lock                              # mutation lock, advisory, stale-detected
  journal/idempotency/<key-hash>.json
  beacons/<beacon_id>/
    beacon.json                     # mutable: identity + mutable title
    active.json                     # mutable POINTER only: { "active_version": "ver_..." } or absent
    drafts/<draft_id>/
      draft.json                    # mutable, revision-bound overwrite
      tombstone.json                # written on abandonment; draft.json removed; then immutable
    versions/<version_id>/
      manifest.json                 # IMMUTABLE: identity, local number, hashes, approval, provenance, schema versions
      semantics.json                # IMMUTABLE: approval-bound semantic bundle
      revocation.json               # IMMUTABLE once written
```

File-kind classification:

- **Mutable**: `project.json`, `lock`, `beacon.json`, `active.json`, `draft.json`. Each rewrite must still be atomic (tmp + rename).
- **Write-once immutable**: `manifest.json`, `semantics.json`, `revocation.json`, `tombstone.json`, and each per-key journal entry.

Serialization: all stored files are pretty-printed JSON for inspectability. RFC 8785 (JCS) canonicalization is used only at hash and compare time, reusing Slice B's `Hasher` port with `JcsSha256Hasher` and Slice A's `project()`. It is never the stored byte format.

## Atomicity and Durability (§5, hard requirements)

- Universal write protocol for every file: write `<name>.tmp.<random>` in the same directory, `fsync` the file, `rename`, then `fsync` the parent directory.
- Approval sequence — the critical transaction, 6 steps:
  1. Acquire the project lock.
  2. Re-verify the reviewed hash still matches the draft revision.
  3. Write `semantics.json`, then `manifest.json` (atomic writes).
  4. Swap `active.json` — a single atomic rename, and **the commit point**.
  5. Mark the draft closed and write the journal entry.
  6. Release the lock.
- Crash before step 4: orphan version directory, no `active.json` reference, no journal commit. Recovery marks it an aborted artifact, reports it, and never silently activates it.
- Crash after step 4: activation already happened; steps 5–6 replay idempotently on the next command. The design names `pharos status` as the scan trigger, but the CLI does not exist yet (see Open Question 2).
- **Implementation freedom**: the exact tmp-name scheme, whether the recovery scan is a store method or a separate concern, and the exact lock representation.
- **Not free**: the tmp + fsync + rename + fsync-dir shape, and the approval step ordering.

## Journal

- One file per idempotency key, holding the key, the JCS hash of the canonical logical input, and a committed-result reference.
- Same key with the same hash returns the committed result; same key with a different hash is refused.
- Written inside the mutation's lock scope and strictly after the commit point (step 5, not steps 3–4).
- **Gap**: the "already committed, replay steps 5–6" detection algorithm is not specified beyond the two crash scenarios. It is most likely inferred from on-disk state (does `versions/<id>/manifest.json` already exist, does `active.json` already point at it), but the design does not say so.

## Locking

- One advisory lockfile per project serializes all mutations. Reads are lock-free, which is safe because everything except `active.json`, `draft.json`, and `beacon.json` is immutable, and the pointer read is atomic-rename-safe.
- Stale locks are broken after a liveness check, but the mechanism is unspecified: PID-alive check versus mtime staleness threshold.
- The v1 profile is single-developer. The lock does not arbitrate concurrent human edits — that is `expectedRevision` in `updateDraft`. It only prevents two local processes from interleaving raw writes.
- The failure and refusal surface for a failed lock acquisition is unspecified. Presumably a `refused` CLI outcome per §8's envelope contract, but no refusal token is named in the docs.

## Immutability Enforcement

- Load-bearing sentence from §4: "Everything immutable is a file that is written once and never rewritten. Immutability is an enforcement rule of `fs-beacon-store`, not a hope."
- The adapter must refuse — as a value, not silently — a second write to `manifest.json`, `semantics.json`, `revocation.json`, or `tombstone.json`.
- The mechanism is undecided by the docs. Two candidates:
  - (a) stat-before-write: race-prone on its own, but safe under the serializing lock.
  - (b) `fs.open` with the `wx` exclusive-create flag: OS-level and TOCTOU-proof. Recommended regardless of the lock, as defense in depth.
- This path is domain-unreachable in the pure happy path, because `approveDraft` already refuses `duplicate-version-id` in memory before reaching disk. The disk-level refusal is a defensive, corruption-adjacent case — for example two processes racing after a stale-lock break. That argues for treating it more like `resolveActiveVersion`'s corruption throw than a normal domain `Result` refusal, and it needs an explicit decision (Open Question 4).

## Error and Refusal Surface

- `Result<T, E>` in `src/shared/result.ts` is generic and reusable by adapters as-is. No change to the shared type is needed.
- New refusal and error vocabulary is required for disk-only failure modes the pure domain cannot express: lock-held / lock-timeout, immutable-file-already-exists, corrupt-active-pointer-on-disk, schema-validation-failure-on-read (Ajv — not yet a dependency and not yet wired anywhere), and unknown-newer-contract-version (preserve-but-block-authority, §7).
- Placement is undecided — see Open Question 4.

## Boundary Lint Constraints

- `adapters` may import `adapters`, `domain`, `shared`. `domain` may import only `domain`, `shared`. Enforced by `eslint-plugin-boundaries` in `eslint.config.base.js` and proven by `tests/architecture/boundaries.test.ts` against `tests/fixtures/boundaries/src/domain/uses-node-fs.ts` and `tests/fixtures/boundaries/src/application/uses-adapters.ts`.
- Practical consequence: the `BeaconStore` port interface itself must be expressible with domain-owned types only (`Beacon`, `Draft`, `Version`, a new refusal union, `Promise`, `Result`). No Node types may leak into a `src/domain/ports/beacon-store.ts`. `node:fs`, `node:path`, `node:os`, and `node:crypto` are legal only inside `src/adapters/fs-beacon-store/**`.

## Testing Strategy

- §12 explicitly plans a shared, adapter-agnostic **port contract test suite**: "one shared contract-test suite per port, run against every adapter implementation … encodes atomicity, immutability, and idempotency invariants, including crash-injection tests around the approval sequence." This is a deliverable distinct from `fs-beacon-store`-specific tests.
- New demands beyond the pure-domain Slices A–C:
  - Real temp directories (`node:fs/promises` with `node:os.tmpdir()` and `mkdtemp`), not an in-memory fs fake — atomicity guarantees are only meaningfully testable against real rename and fsync semantics.
  - Crash injection, which needs an injectable seam to interrupt the write sequence mid-flight.
  - Concurrency tests for the lock; in-process interleaved promises suffice for the v1 single-developer profile, so no real multi-process test is required.
  - Determinism: stable pretty-JSON round-trips, and nothing semantically significant may depend on unsorted `readdir` order (recovery scanning in particular).
- No new dependency is strictly required for the core write, lock, and journal mechanics — `node:fs/promises` and `node:crypto` are already in use. `proper-lockfile` and Ajv are both named in §1's stack table but neither is installed; `package.json` lists exactly one runtime dependency, `canonicalize@2.1.0`.

## Approaches Considered

### 1. Direct `node:fs/promises` calls inline in one `FsBeaconStore` class

Mirrors `JcsSha256Hasher`'s style exactly.

- **Pros**: simplest, fewest moving parts, no new internal abstraction.
- **Cons**: crash-injection testing requires brittle `vi.mock("node:fs/promises")` module mocking, diverging from the DI-friendly style Slices A–C established.
- **Effort**: Low.

### 2. Internal `AtomicFileWriter` / `FsGateway` seam injected into `FsBeaconStore` — RECOMMENDED

An adapter-internal seam (not a domain port) implementing tmp + fsync + rename + fsync-dir. Crash-injection tests wrap or fake this seam instead of mocking Node modules.

- **Pros**: directly serves §12's crash-injection requirement; isolates the one truly load-bearing invariant into a small, exhaustively tested unit; the seam is reusable by the future `fs-evidence-store` adapter, avoiding re-derivation of the write protocol.
- **Cons**: one more abstraction to design and test; possible over-engineering if plain module mocking proves adequate.
- **Effort**: Medium.

### 3. Journal-first / event-sourced store

Every mutation is journaled first, and `active.json` plus version files are derived by replay.

- **Pros**: theoretically the strongest crash-recovery story.
- **Cons**: contradicts the ratified §4/§5 design, which names `active.json` (not the journal) as "the only pointer file" and scopes the journal narrowly to idempotency-key replay. Re-litigates already-ratified technical design.
- **Effort**: High. **Not recommended** — out of contract with the ratified design; listed only to show the space was considered.

### Orthogonal locking sub-decision

Hand-roll a minimal `wx`-exclusive-create lockfile with a liveness check (zero new dependency, full control, more code and tests) versus adding `proper-lockfile` as a real dependency (less code, but no recorded operator approval for a second production dependency). Surfaced as Open Question 1 rather than picked silently.

## Recommendation

Approach 2: an internal atomic-write seam plus a new domain-owned `BeaconStore` port, with the refusal vocabulary living alongside it in `src/domain/ports/`, and the locking mechanism left as an explicit open question. This is the only approach that:

1. Satisfies §12's crash-injection testing requirement without brittle module mocking.
2. Keeps `FsBeaconStore` focused on domain-shape-to-file-layout transaction orchestration.
3. Sets up reuse for the future `fs-evidence-store` adapter.

## Proposed Scope Boundary

**In scope**: new `BeaconStore` domain port; new disk-level refusal vocabulary; `FsBeaconStore` implementing the full on-disk layout above; the atomic write protocol as a reusable seam; the advisory per-project lock with stale-lock breaking; the idempotency journal write and read primitives (not wired to a nonexistent CLI); immutability enforcement; a port-level contract test suite plus fs-specific tests covering temp directories, crash injection, concurrency, and determinism.

**Out of scope**: `fs-evidence-store`; the verification and attempt state machine; staleness and dispositions; `runs/`, `attempts/`, and `quarantine/`; application use cases; the CLI, including the `pharos status` recovery command; Ajv / JSON-Schema validation-on-read and contract-version preservation; portable bundle export and import; Engram discovery; `project.json` read and write, which belongs to an unmodeled project-configuration concern even though it shares the same directory tree.

## Size Forecast

Slice C's calibrated band (2420–3180 authored lines across 8 work units) is the best precedent, but Slice D is qualitatively different: I/O-heavy, a new port, a new refusal vocabulary, and a new shared contract-test suite.

| Unit | Source | Tests |
|---|---|---|
| Port + refusals | ~60–100 | — |
| Atomic-write seam | ~80–150 | ~150–250 |
| Lock | ~80–150 | ~100–200 |
| Journal | ~60–120 | ~100–150 |
| `FsBeaconStore` core | ~300–500+ | — |
| Port-contract + fs-specific suite | — | ~400–700+ |

**Total nominal estimate: ~1200–2000+ authored lines, 3–5x the 400-line review budget.** Slice C's own estimates undershot actuals by roughly 1.6–2.1x, so budget risk should be assumed **High** and chained PRs planned from the start.

Suggested work-unit boundaries for a future `sdd-tasks` chain:

1. `BeaconStore` port + refusal vocabulary (pure types).
2. Atomic-write seam + crash-injection tests.
3. Lock mechanism + tests.
4. Journal / idempotency + tests.
5. `FsBeaconStore` read paths (`get`, `list`, `getActiveVersion`).
6. `FsBeaconStore` draft-lifecycle write paths.
7. `FsBeaconStore` approval transaction + revocation — highest risk, "the critical transaction".
8. Port-contract shared test suite + final crash, concurrency, and determinism sweep.

## Risks

- Budget risk **High** (3–5x the 400-line guard), the same pattern as Slice C. Chained PRs must be planned from design time, not discovered late.
- The crash-recovery detection algorithm ("already committed, replay steps 5–6") is underspecified in the ratified design — risk of inventing behavior at implementation time that was never ratified.
- `proper-lockfile`-style locking and Ajv are both named in §1's stack table but absent from `package.json` — risk of silently adding an unapproved dependency, or silently not implementing what the stack table implies is required.
- Immutability-refusal and lock-failure refusal vocabularies do not exist anywhere yet — risk of inventing ad hoc error shapes that get re-litigated at spec or design time if not settled first.
- The unarchived `beacon-core` change folder does not block Slice D technically, since its specs are already promoted, but it is noted for orchestrator awareness.

## Open Questions — must be resolved with the operator before `sdd-propose`

1. **Locking implementation**: hand-roll a minimal advisory lockfile (no new dependency, more code to write and test) versus adding `proper-lockfile` or equivalent (matches §1's stack table literally, less code, but no operator decision on record approves a second production dependency beyond `canonicalize`).
2. **Crash-recovery scan ownership**: does Slice D's `FsBeaconStore` expose a `recoverProject()` / `reconcile()` method for a future CLI to call, or is crash-recovery scanning deferred wholesale to whichever slice builds the CLI, leaving Slice D able to produce orphaned artifacts after a crash with no way to inspect or repair them yet?
3. **Idempotency-key journal ownership**: does every mutating `BeaconStore` port method accept a caller-supplied idempotency key now (widest surface area, but idempotency handling is fully wired), or is the journal only a raw read/write primitive in Slice D with no port method exercising it (the journal directory exists but nothing uses it)?
4. **Refusal vocabulary placement**: port-owned in `src/domain/ports/` (more idiomatic hexagonal design, but couples the abstract port to the filesystem's failure taxonomy) versus adapter-owned in `src/adapters/fs-beacon-store/` (more flexible for the planned future Git-backed `BeaconStore` provider, but application code loses a stable type to pattern-match against without depending on a specific adapter).
5. **Ajv / JSON-Schema validation-on-read scope**: in Slice D (roughly doubles surface area — new dependency, schema authoring, versioning policy — on top of already-High budget risk), or explicitly deferred so Slice D reads and writes JSON with zero schema enforcement until a later slice?
6. **§1 stack-table bindingness** (umbrella question behind 1 and 5): is `docs/technical-design-v1.md` §1's stack table binding for Slice D, or aspirational and deferred to a later slice? Resolving this once avoids relitigating it twice.
7. **`project.json` boundary**: confirm or reject excluding `project.json` (mutable project-level config) from the `BeaconStore` port's contract, even though it shares the same `<project_id>/` directory tree, on the grounds that its content belongs to an unmodeled project-configuration concern rather than Beacon lifecycle.

## Ready for Proposal

**No.** The 7 open questions above must be resolved with the operator first. Once resolved, `sdd-propose` can proceed directly — no additional research lane appears necessary, since the ratified docs already answer nearly everything except these 7 points.
