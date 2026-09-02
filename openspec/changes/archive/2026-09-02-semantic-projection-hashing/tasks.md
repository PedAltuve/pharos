# Tasks: Semantic Projection Hashing (Slice B)

## Review Workload Forecast

| Field                   | Value                                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Estimated changed lines | ~189 authored additions + deletions; generated `package-lock.json` delta excluded from authored count but included in review snapshot |
| 400-line budget risk    | Low                                                                                                                                   |
| Chained PRs recommended | No                                                                                                                                    |
| Suggested split         | Single cohesive PR/work-unit commit: contract, adapter, tests, dependency, and narrow docs/toolchain alignment                        |
| Delivery strategy       | ask-on-risk                                                                                                                           |
| Chain strategy          | N/A (single PR)                                                                                                                       |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: N/A (single PR)
400-line budget risk: Low

## Scope and edit authority

- [x] Restrict implementation edits to the explicitly allowed surfaces: `src/domain/ports/json-value.ts`, `src/domain/ports/hasher.ts`, `src/domain/ports/index.ts`, `src/adapters/hashing/**`, `tests/adapters/hashing/**`, `package.json`, generated `package-lock.json`, `docs/technical-design-v1.md` §2, this change's files under `openspec/changes/semantic-projection-hashing/`, and task/apply evidence. <!-- sdd-owner: implementation -->
- [x] Prove that apply does not edit `src/domain/semantics/**`, `src/application/**`, `src/cli/**`, or any path under `openspec/changes/semantic-projection-core/**`; reject unrelated adapter, persistence, migration, approval, and CLI changes. <!-- sdd-owner: implementation -->
- [x] Preserve one coherent Slice B work-unit commit containing implementation, tests, documentation, and generated dependency metadata; define rollback as removing the listed hashing/port/test/docs/dependency surfaces without reverting Slice A. <!-- sdd-owner: implementation -->

## 1. RED — establish immutable baseline and failing contracts

- [x] Before any production edit, record required-base `e37b903` byte checks for `src/domain/semantics/types.ts`, `src/domain/semantics/equal.ts`, and the complete `openspec/changes/semantic-projection-core/` directory, plus baseline hashes and byte-level results; record the initial changed-path list. <!-- sdd-owner: implementation -->
- [x] Add `tests/adapters/hashing/jcs-sha256-hasher.test.ts` with failing focused adapter/port/type imports and a cast-free `SemanticProjection` call through `Hasher`; run `npm test -- tests/adapters/hashing/jcs-sha256-hasher.test.ts` and `npm run typecheck` before creating `json-value.ts`, `hasher.ts`, or the adapter, and preserve the failure evidence. <!-- sdd-owner: implementation -->
- [x] Keep the RED test scope limited to the allowed hashing test path and ensure no test or production change touches frozen Slice A files or predecessor artifacts. <!-- sdd-owner: implementation -->

## 2. GREEN — ports, temporary path, and dependency

- [x] Create `src/domain/ports/json-value.ts` with type-only relative imports and `JsonValue = SemanticValue | SemanticProjection`; create `src/domain/ports/hasher.ts` with opaque synchronous `hash(value: JsonValue): string`; replace `src/domain/ports/index.ts` with type-only exports and no external imports. <!-- sdd-owner: implementation -->
- [x] Add `src/adapters/hashing/index.ts` and `jcs-sha256-hasher.ts` as real barrels/adapter surfaces; keep Node/npm imports and any `sha256:` construction exclusively in the adapter, with no domain-to-adapter runtime dependency. <!-- sdd-owner: implementation -->
- [x] Use a minimal temporary order-sensitive SHA-256 path only to make the initial contract/prefix smoke test executable; do not treat it as finished behavior. <!-- sdd-owner: implementation -->
- [x] Install exactly `canonicalize@2.1.0` as a runtime dependency with npm's exact-save operation and generated lockfile; preserve exact `fast-check@4.9.0` without hand-editing `package-lock.json`. <!-- sdd-owner: implementation -->

## 3. RED → GREEN — conformance and real adapter behavior

- [x] Add independently authored RFC 8785 §3.2.2 and §3.2.3 known-vector inputs, canonical strings, and hard-coded `sha256:<lowercase-hex>` UTF-8 oracles; add an array-order example proving `[1, 2]` and `[2, 1]` differ. <!-- sdd-owner: implementation -->
- [x] Add the non-vacuous `fast-check@4.9.0` property through the real adapter: generate JSON-safe values with at least two non-index root keys, serialize/parse, recursively reverse object insertion order while preserving array order, assert serialized strings differ and parsed values are deeply equal, then assert equal fingerprints. <!-- sdd-owner: implementation -->
- [x] Run the focused suite against the temporary implementation and capture the expected failure showing object-order instability; repair the RED setup if the property is vacuous or passes for the wrong reason. <!-- sdd-owner: implementation -->
- [x] Replace the temporary path with `canonicalize(value)` → explicit `Buffer.from(canonical, "utf8")` → `createHash("sha256")` → lowercase hex → adapter-only `sha256:`; narrow `undefined` to a throwing `TypeError` without fallback serialization. <!-- sdd-owner: implementation -->
- [x] Run `npm test -- tests/adapters/hashing/jcs-sha256-hasher.test.ts` and `npm run typecheck`; require the RFC, property, array, prefix, and cast-free port proofs to pass. <!-- sdd-owner: implementation -->

## 4. TRIANGULATE — architecture, documentation, and toolchain alignment

- [x] Verify `src/domain/ports/**` has only relative type-only imports, the adapter imports the domain port, and no domain module imports Node, npm packages, or the adapter; confirm `canonicalize`, `node:buffer`, `node:crypto`, and `sha256:` are confined to `src/adapters/hashing/**` except expected test assertions. <!-- sdd-owner: implementation -->
- [x] Run unchanged architecture boundary coverage, including `tests/architecture/boundaries.test.ts`, through `npm run lint` and `npm test`; do not weaken or rewrite the boundary test. <!-- sdd-owner: implementation -->
- [x] Amend only `docs/technical-design-v1.md` §2 with the `hashing/` adapter entry after `engram-discovery/`; perform structural documentation readback. <!-- sdd-owner: implementation -->
- [x] Confirm this change's already-authored `project-toolchain` MODIFIED delta exactly aligns with the technical-design skeleton, permits ratified real barrels, and does not reintroduce placeholder-only requirements or alter predecessor artifacts. <!-- sdd-owner: implementation -->

## 5. REFACTOR — final verification and work-unit evidence

- [x] Remove all temporary order-sensitive implementation, keep reorder helpers test-only, normalize the two real barrels, and run formatting/check-only normalization without changing frozen or unauthorized paths. <!-- sdd-owner: implementation -->
- [x] From a clean dependency state, run `npm ci`, then all five scripts exactly: `npm test`, `npm run test:watch -- --run`, `npm run build`, `npm run lint`, and `npm run typecheck`; record each exit result and the focused test result. <!-- sdd-owner: implementation -->
- [x] Re-run required-base `git diff --exit-code e37b903 -- src/domain/semantics/types.ts`, `... -- src/domain/semantics/equal.ts`, and `... -- openspec/changes/semantic-projection-core/`; compare final frozen-file hashes/bytes and final changed paths against the baseline. <!-- sdd-owner: implementation -->
- [x] Record boundary proof, clean-lockfile proof, authored additions+deletions (excluding generated lockfile), complete generated-file snapshot identity, rollback evidence, and confirmation that the work remains within the ~189-line forecast and below 400 authored lines; stop and ask under `ask-on-risk` if it would exceed the budget. <!-- sdd-owner: implementation -->

## Delivery boundary

Delivery actions (commit, push, PR creation, and lifecycle gates) remain outside SDD implementation task completion. No review actor or post-apply lifecycle task is included because receipt-driven development is opt-in and currently disabled.
