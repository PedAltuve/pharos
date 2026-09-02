# Proposal: Semantic Projection Hashing (Slice B)

## Intent

Add deterministic approval-time fingerprinting for the semantic projections delivered by Slice A. The domain will expose an opaque `Hasher` port, while a hashing adapter will apply RFC 8785 JSON Canonicalization Scheme (JCS) and SHA-256 so logically identical JSON values produce the same `sha256:<hex>` identity regardless of object-key insertion order.

This is Slice B of the ratified semantic-projection split. It depends on Slice A at required base `e37b903` and consumes the frozen `SemanticProjection`/`SemanticBundle` contract unchanged.

## Scope

### In Scope

- Add a `Hasher` port under `src/domain/ports/` with the contract `hash(value: JsonValue): string`.
- Keep the returned string opaque to the domain. Only the adapter may construct the `sha256:<hex>` representation.
- Add `src/adapters/hashing/` with an implementation that:
  1. canonicalizes the JSON value with an exact-pinned `canonicalize` runtime dependency;
  2. encodes the canonical string as UTF-8 bytes;
  3. computes SHA-256 with `node:crypto`; and
  4. returns `sha256:<lowercase-hex>`.
- Add adapter tests under `tests/adapters/hashing/` covering RFC 8785 known vectors and a `fast-check@4.9.0` property proving stability across JSON serialization and key-insertion orders through the real adapter.
- Amend `docs/technical-design-v1.md` §2 to list the `hashing/` adapter.
- Ship a MODIFIED delta for capability `project-toolchain` so its exact-skeleton requirement recognizes `src/adapters/hashing/`.
- Add the exact-pinned `canonicalize` dependency and generated `package-lock.json` update. Reuse the already-installed exact-pinned `fast-check@4.9.0` devDependency.

### Non-Goals

- Do not change the frozen `SemanticProjection` or `SemanticBundle` types from Slice A, wrap projections, add fields, or introduce a serialization shim.
- Do not change `isMigrationEquivalent`; migration equivalence remains pure structural equality, including the existing leaf-level `===` ruling.
- Do not add approval orchestration, persistence, staleness handling, migration runners, CLI commands, or application-layer wiring.
- Do not hash raw contracts, recordings, traces, screenshots, generated tests, secrets, runtime-resolved values, or other data excluded by semantic projection.
- Do not restructure unrelated adapters or weaken domain boundary enforcement.
- Do not modify any artifact under `openspec/changes/semantic-projection-core/`.

## Capabilities

### New Capabilities

- `semantic-projection-hashing`: deterministically canonicalize JSON-safe semantic projections and produce an opaque SHA-256 fingerprint through a domain port and adapter.

### Modified Capabilities

- `project-toolchain`: extend the ratified exact directory skeleton to include `src/adapters/hashing/`, aligned with the corresponding technical-design §2 amendment.

## Accepted Amendment

The addition of `src/adapters/hashing/` and the matching `docs/technical-design-v1.md` §2 plus `project-toolchain` specification updates are explicitly ratified. The amendment is narrow: it recognizes the hashing adapter in the documented and tested skeleton without changing the hexagonal dependency direction or permitting Node/npm imports inside `src/domain/**`.

## Approach

The `Hasher` contract belongs in the domain because approval workflows need a fingerprinting capability but MUST NOT know its algorithm, prefix, canonicalization library, or Node implementation. The adapter owns all mechanism: JCS serialization, UTF-8 encoding, SHA-256, and string construction.

The existing Slice A projection is already JSON-shaped and canonical by construction. It can be passed to the port without changing its frozen type model. JCS provides deterministic object-key ordering at hash time, while arrays retain their semantic order. The adapter property test must exercise the real canonicalization and crypto path rather than a fake.

Hashing remains separate from comparison: approval-time code may persist the resulting fingerprint in a later change, but migration equivalence continues to compare projections structurally and does not depend on crypto availability or collision assumptions.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `src/domain/ports/` | Modified | Add and export the opaque `Hasher` contract and JSON-safe input type contract |
| `src/adapters/hashing/` | New | RFC 8785 canonicalization and Node SHA-256 adapter |
| `tests/adapters/hashing/` | New | RFC vectors plus insertion/serialization-order property tests |
| `package.json`, `package-lock.json` | Modified | Exact-pinned `canonicalize`; generated lockfile delta |
| `docs/technical-design-v1.md` §2 | Modified | Add `hashing/` to the adapter list |
| `openspec/changes/semantic-projection-hashing/specs/project-toolchain/spec.md` | New delta | Modify the exact-skeleton requirement to recognize `hashing/` |

## Dependencies

- Slice A `semantic-projection-core`, merged at required base `e37b903`.
- Frozen Slice A `SemanticProjection`/`SemanticBundle` types, consumed unchanged.
- Node.js `>=20` and `node:crypto` in the adapter only.
- Exact-pinned `canonicalize` runtime dependency.
- Existing exact-pinned `fast-check@4.9.0` devDependency and Vitest test harness.

## Workload and Delivery Forecast

One PR is ratified for this slice. The forecast is approximately **189 authored lines**, comfortably below the 400-line review budget. The `package-lock.json` delta is generated and is not counted as authored code. If task-level planning discovers a material increase beyond the budget, the existing `ask-on-risk` delivery guard still applies before implementation.

## Risks

| Risk | Likelihood | Mitigation |
|---|---:|---|
| Canonicalization or UTF-8 handling produces a non-portable digest | Low | Test RFC 8785 known vectors and hash the canonical string's explicit UTF-8 bytes |
| Object insertion order leaks into fingerprints | Low | Run a `fast-check@4.9.0` stability property through the real adapter across reordered serialization inputs |
| Domain becomes coupled to SHA-256 or Node APIs | Low | Keep algorithm, prefix construction, `canonicalize`, and `node:crypto` entirely inside the adapter; preserve boundary lint checks |
| The documented skeleton and toolchain capability drift | Low | Land the ratified technical-design amendment and MODIFIED `project-toolchain` delta in the same PR |
| Unsupported non-JSON values reach the canonicalizer | Low | Keep the port input JSON-safe and test adapter behavior against the accepted JSON domain; upstream schema interpretation remains responsible for producing valid semantic projections |
| Exact-pinned runtime dependency introduces supply-chain or maintenance exposure | Low | Pin the package version exactly, commit the generated lockfile, and keep the dependency behind one adapter |

## Rollback Plan

Rollback the single PR: remove the hashing adapter, its tests, and the `Hasher` port export; remove `canonicalize` from `package.json` and regenerate/revert `package-lock.json`; revert the technical-design §2 amendment and the `project-toolchain` delta. No approval workflow or persistence consumer is added in this slice, so rollback requires no data migration and does not affect Slice A's projection or structural equality behavior.

## Success Criteria

- [ ] The domain exposes `Hasher.hash(value: JsonValue): string` and treats the return value as opaque.
- [ ] The adapter alone constructs `sha256:<lowercase-hex>` from RFC 8785 canonical UTF-8 bytes using `node:crypto` SHA-256.
- [ ] RFC 8785 known-vector tests pass through the real adapter.
- [ ] A `fast-check@4.9.0` property proves equal hashes for logically identical JSON values reconstructed through different serialization and key-insertion orders.
- [ ] `SemanticProjection` and `SemanticBundle` remain byte-for-byte unchanged from Slice A.
- [ ] `isMigrationEquivalent` remains structural equality with `===` at primitive leaves and does not call the hasher.
- [ ] `docs/technical-design-v1.md` §2 and the MODIFIED `project-toolchain` delta both recognize `src/adapters/hashing/`.
- [ ] `canonicalize` is exact-pinned and `package-lock.json` records the generated dependency graph.
- [ ] `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build` exit `0`.
- [ ] Strict TDD evidence shows failing adapter/contract tests before production implementation.
- [ ] Delivery remains one PR within the approximately 189-authored-line forecast, subject to the 400-line `ask-on-risk` guard.

## Proposal Question Round

Skipped by confirmed pre-proposal handoff. The operator already ratified the slice boundary, adapter placement, toolchain amendment, equality behavior, dependency/test strategy, and single-PR forecast; no product decision remains open in this phase.
