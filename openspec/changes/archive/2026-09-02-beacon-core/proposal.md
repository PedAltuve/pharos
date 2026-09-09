# Proposal: Beacon Core (Slice C)

## Intent

Slices A/B can project and fingerprint semantics, but nothing models *what* is versioned: `src/domain/beacon/` is still a placeholder, so no draft can be saved, approved, or revoked. This change lands the pure Beacon aggregate so every lifecycle invariant in `domain-requirements-v1.md` and `lifecycle-and-schema-specification-v1.md` §1–3 is expressible and testable with zero I/O.

## Scope

### In Scope

C1 — Beacon + Draft lifecycle (no `Hasher`):

- `Beacon`, `DraftOrigin`, and a `Draft` closed union (`open` / `closed` / `abandoned`); `Draft.content` is `SemanticSource`.
- `createDraft`; `updateDraft` (revision-bound, stale save refused without mutation); `forkDraft`; `abandonDraft` tombstone.
- Generic `Result<T, E>` in `src/shared/` as the refusal carrier.

C2 — Version lifecycle:

- `Version` closed union (active / superseded / revoked) plus `ApprovalRecord`, `VersionProvenance`, `RevocationRecord`.
- `approveDraft`: re-verify the operator-reviewed hash via `project()` + `Hasher`; stale-origin boolean gate requiring explicit acknowledgment; monotonic local numbering; supersession, draft closure, and active-pointer move returned as one new `Beacon`.
- `revokeVersion` (any approved version; revoking the active one leaves `activeVersionId: null`); `resolveActiveVersion`.
- Vitest unit and property coverage under `tests/domain/beacon/`.

### Out of Scope

- `Clock` / `IdGenerator` ports — ids and timestamps are caller-supplied strings.
- Cached projections or hashes on drafts.
- Rich stale-origin impact comparison (future application/CLI slice).
- `fs-beacon-store` and atomic-rename persistence (Slice D), verification, evidence, staleness, application use cases, CLI.
- Any change to the frozen Slice A/B types.

## Capabilities

### New Capabilities

- `beacon-draft-lifecycle`: Beacon identity plus draft creation, revision-bound saving, forking, and abandonment, with refusals as values.
- `beacon-version-lifecycle`: approval with semantic-hash re-verification, monotonic numbering, atomic supersession, revocation, and active-version resolution.

### Modified Capabilities

- `project-toolchain`: generalize the skeleton requirement's "ratified Slice A or Slice B behavior" wording so the `src/domain/beacon/` and `src/shared/` barrels may export this slice. No new directories.

## Approach

Closed discriminated unions replace nullable flags, so impossible states (a revoked version without a revocation record, an abandoned draft with content) are unrepresentable. Refusals are returned `Result` values, never exceptions. Each function takes the aggregate plus explicit ids/timestamps and returns a new immutable `Beacon`; domain atomicity means one returned value, disk atomicity stays Slice D's. `Hasher` is consumed only at approval.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `src/domain/beacon/` | New | Types, draft lifecycle, approval, revocation, active-version resolution |
| `src/shared/` | New | Generic `Result<T, E>` |
| `tests/domain/beacon/` | New | Unit and property suites |
| `src/domain/semantics/`, `src/domain/ports/` | Read-only | `project()`, `SemanticSource`, `Hasher` consumed unchanged |
| `openspec/specs/project-toolchain` | Modified delta | Skeleton wording generalized |

## Workload and Delivery Forecast

Slice A's comparable pure-domain scope reached ~775 authored lines against the 400-line budget. Budget risk is therefore assumed High. Plan chained PRs C1 → C2, ratified against the exact `sdd-tasks` forecast under `ask-on-risk`; C2 may need a further split.

## Dependencies

- Merged Slices A/B at base `582fc1f`; frozen `SemanticSource` / `project()`; the `Hasher` port; Vitest and exact-pinned `fast-check@4.9.0`.

## Risks

| Risk | Likelihood | Mitigation |
|---|---:|---|
| Line budget overrun beyond C1/C2 | High | Forecast exact counts at design; chain or split further before apply |
| Approval logic drifts from the hash it re-verifies | Med | Recompute from `Draft.content` at approval; no cached derived state |
| Supersession leaves two active versions or a dangling pointer | Med | One function returns the whole next `Beacon`; property tests on the active pointer |
| Stale-origin gate grows into presentation logic | Low | Domain exposes a boolean plus required acknowledgment only |
| `Result<T, E>` shape misfits later slices | Low | Keep it minimal and generic in `src/shared/` |

## Rollback Plan

Revert the chained PRs in reverse order (C2 then C1) and restore `src/domain/beacon/index.ts` and `src/shared/index.ts` to `export {};`, plus the `project-toolchain` delta. No consumer, persistence, or migration exists yet, so rollback is source-only and leaves Slices A/B untouched.

## Success Criteria

- [ ] Draft and Version states are closed unions; no nullable status flags.
- [ ] A stale `updateDraft` refuses and returns the draft unmutated.
- [ ] `approveDraft` refuses when the recomputed hash differs from the reviewed hash.
- [ ] Stale-origin approval requires explicit acknowledgment.
- [ ] Approval returns one `Beacon` with the new active version, the prior one superseded, and the draft closed.
- [ ] Revoking the active version leaves `activeVersionId: null` with no auto-reactivation.
- [ ] `src/domain/beacon/` and `src/shared/` import nothing outside `domain`/`shared`; lint boundary checks pass.
- [ ] `npm test`, `npm run lint`, `npm run typecheck`, `npm run build` exit `0`, with strict-TDD RED evidence before each implementation.

## Proposal Question Round

Skipped by confirmed pre-proposal handoff (2026-09-02): the operator ratified the C1/C2 split, port deferral, `SemanticSource` draft content, boolean stale-origin gate, and shared `Result<T, E>`. No product decision remains open.
