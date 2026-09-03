# Proposal: fs-beacon-store (Slice D) — canonical on-disk Beacon store

**Change**: `fs-beacon-store` · **Phase**: propose · **Store**: hybrid (this file authoritative) · **Handoff**: confirmed (G0–G7)

## Intent

Beacon aggregates land in Slice C but exist only in memory. Nothing persists them, so no Beacon survives process exit. Slice D lands the canonical store defined in `docs/technical-design-v1.md` §4–§5.

Success: every Beacon shape round-trips through disk unchanged; a crash mid-approval never silently activates a version; write-once files refuse a second write as a value; mutations serialize under an advisory lock; a repeated idempotency key replays instead of duplicating.

## Scope

### In Scope

- `BeaconStore` port in `src/domain/ports/` — domain-owned types only, no `node:*` leakage.
- Disk-level refusal union, port-owned alongside the interface (**G4**).
- Caller-supplied idempotency key on every mutating port method; journal fully wired, not dormant (**G3**).
- `FsBeaconStore` implementing the ratified §4 layout and the §5 six-step approval transaction, with the `active.json` swap as commit point.
- Adapter-internal atomic-write seam: tmp → fsync → rename → fsync parent dir (explore Approach 2).
- Advisory per-project lockfile, hand-rolled via `fs.open` `wx` plus liveness check — **zero new dependencies** (**G1**).
- `recoverProject()` / `reconcile()` scan exposed for a future CLI (**G2**).
- Write-once immutability enforced by `wx` exclusive create.
- Shared port-contract test suite plus fs-specific temp-dir, crash-injection, concurrency, and determinism tests.

### Out of Scope

- Ajv / JSON-Schema validation-on-read and contract-version preservation (**G5**).
- `project.json` — outside the port contract despite sharing the directory tree (**G7**).
- New production dependencies. `package.json` stays at exactly one: `canonicalize@2.1.0`. §1's stack table is direction, not a per-slice obligation (**G6**).
- `fs-evidence-store`; verification/attempt state machine; staleness and dispositions; `runs/`, `attempts/`, `quarantine/`; application use cases; CLI (including `pharos status`); bundle export/import; Engram discovery.

## Capabilities

### New Capabilities

- `beacon-store-port`: technology-neutral persistence contract — method surface, idempotency-key parameter, refusal vocabulary, revision-bound update semantics.
- `fs-beacon-store`: on-disk layout mapping, atomic write protocol, write-once immutability, advisory locking, approval transaction ordering.
- `beacon-store-recovery`: post-crash reconcile scan, orphan-artifact classification, idempotent replay of approval steps 5–6.

### Modified Capabilities

- None. `project-toolchain` states no dependency-count requirement, so **G6** is a proposal constraint, not a spec delta.

## Approach

Explore Approach 2, unchanged. `FsBeaconStore` stays focused on domain-shape-to-file-layout transaction orchestration and delegates the one load-bearing durability invariant to a small internal seam. The seam exists so §12's crash-injection tests can interrupt a write mid-flight without `vi.mock("node:fs/promises")`, and it is reusable by the future `fs-evidence-store`.

Journal detection (**G3**) is inferred from on-disk state: the key file records the JCS hash of the canonical logical input; a matching hash returns the committed result, a differing hash refuses. `recoverProject()` (**G2**) reads the same state to classify orphans — a version directory with no `active.json` reference and no journal commit is reported as aborted and never activated.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/domain/ports/beacon-store.ts` | New | Port interface, idempotency-key type |
| `src/domain/ports/beacon-store-refusals.ts` | New | Disk-level refusal union |
| `src/domain/ports/index.ts` | Modified | Barrel exports |
| `src/adapters/fs-beacon-store/` | New | Replaces `export {};` placeholder — store, seam, lock, journal, recovery |
| `tests/contract/beacon-store/` | New | Shared port-contract suite |
| `tests/adapters/fs-beacon-store/` | New | Temp-dir, crash, concurrency, determinism |
| `package.json` | Unchanged | No new dependency (**G6**) |

## Size Forecast (revised upward — mandatory)

Explore estimated ~1200–2000+ lines **before** the operator widened scope. **G2** adds a recovery scan (~120–200 source, ~150–250 tests). **G3** wires idempotency through every mutating method (~80–150 source, ~150–250 tests) and inflates each write path.

| Band | Authored lines |
|---|---|
| Revised nominal | **~1700–2600** |
| Calibrated (Slice C undershot 1.6–2.1x) | **plan for ~2600–3200** |

**400-line budget risk: High** (4–8x). Chained delivery must be planned from design time.

### Proposed work units — 10 (explore suggested 8)

1. `BeaconStore` port + refusal vocabulary + idempotency-key types (pure).
2. Atomic-write seam + crash-injection tests.
3. Advisory lock (`wx` + liveness, stale breaking) + tests.
4. Journal store primitives + hash-match/hash-conflict semantics + tests.
5. `FsBeaconStore` read paths (`get`, `list`, `getActiveVersion`).
6. Beacon + draft create/update write paths, revision-bound.
7. Draft abandonment (tombstone) + write-once immutability enforcement.
8. Approval transaction, six steps, `active.json` commit point — highest risk.
9. Revocation + `recoverProject()` reconcile scan.
10. Shared port-contract suite + concurrency/determinism sweep.

**Why 10, not 8**: explore's 8 units excluded recovery entirely (**G2** reversed that) and treated the journal as unwired primitives (**G3** reversed that). Wiring idempotency into every mutating path pushes explore's single draft-write unit and its approval unit past the budget individually, so draft writes split into create/update versus abandon-plus-immutability, and recovery joins revocation as a new unit. `chain_strategy` is **not** selected here.

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| 4–8x review-budget overrun | High | 10 bounded work units above; chained PRs decided before apply |
| Replay-detection algorithm underspecified in ratified §5 | Med | Design phase must state the on-disk inference rule explicitly before any code |
| Hand-rolled lock liveness check is subtly wrong (stale PID reuse, clock skew) | Med | Isolate in unit 3 with dedicated concurrency tests; v1 profile is single-developer |
| `recoverProject()` semantics invented rather than derived | Med | Constrain to the two ratified crash scenarios; report, never auto-activate |
| Unsorted `readdir` order leaking into recovery semantics | Low | Determinism tests in unit 10; sort before any semantic use |
| Prototype-shadowing path segments in directory-to-`Record` mapping | Low | Apply `getOwn()` discipline at the mapping boundary |

## Rollback Plan

Slice D is purely additive: no existing behavior changes. Per work unit, revert the unit's PR. Whole-slice rollback restores `src/adapters/fs-beacon-store/index.ts` to `export {};`, deletes the new `src/domain/ports/beacon-store*.ts` files, reverts the ports barrel, and drops the new test directories. `package.json` is untouched, so no dependency rollback exists. Slices A–C keep passing throughout because nothing imports the new port yet.

## Dependencies

- Slice C (`beacon-core`) specs — already promoted to `openspec/specs/`.
- Slice B `Hasher` / `JcsSha256Hasher` for JCS hashing at compare time.
- No external dependency. No research lane (**G0**).
- Informational: `openspec/changes/beacon-core/` is unarchived and native status reports `blocked(edit_authority_missing)`. Not a technical blocker for Slice D.

## Success Criteria

- [ ] `BeaconStore` port compiles with zero `node:*` imports; boundary lint passes.
- [ ] Every Beacon, Draft, and Version variant round-trips disk unchanged.
- [ ] A second write to `manifest.json`, `semantics.json`, `revocation.json`, or `tombstone.json` returns a refusal value, not a silent overwrite.
- [ ] Crash injection before the `active.json` swap leaves an orphan that `recoverProject()` reports and never activates.
- [ ] Crash injection after the swap replays steps 5–6 idempotently.
- [ ] A repeated idempotency key with a matching input hash returns the committed result; a differing hash is refused.
- [ ] Interleaved in-process mutations serialize under the lock; a stale lock is broken only after the liveness check.
- [ ] The shared port-contract suite runs green against `FsBeaconStore`.
- [ ] `package.json` still lists exactly one production dependency.
