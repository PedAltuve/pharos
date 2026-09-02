# Apply Progress: Semantic Projection Hashing

## Status

- Phase: apply complete; implementation remains uncommitted as instructed.
- Work unit: `slice-b-hashing` (single authorized implementation writer).
- Delivery boundary: one cohesive PR/work unit; commit, push, PR, review, verify, and archive remain parent-owned/deferred.
- Workload: low risk; 189-line forecast; 400-line budget not exceeded.

## Completed implementation tasks

All implementation-owned task rows are checked in `tasks.md` immediately after completion. The completed work includes:

- Required-base baseline and final byte/hash checks for the frozen Slice A files and predecessor OpenSpec directory.
- Strict-TDD RED contract test, GREEN opaque port and adapter smoke path, conformance RED, real JCS/SHA-256 GREEN path, triangulation, documentation alignment, normalization, and final verification.
- `JsonValue = SemanticValue | SemanticProjection`, opaque type-only `Hasher`, and type-only port barrel exports.
- `JcsSha256Hasher` using exact `canonicalize@2.1.0`, explicit UTF-8 bytes, `node:crypto` SHA-256, lowercase hex, adapter-only `sha256:` construction, and defensive `undefined` `TypeError` handling.
- RFC 8785 §3.2.2 and §3.2.3 hard-coded canonical-string/digest vectors, array-order example, and non-vacuous `fast-check@4.9.0` recursive insertion-order property through the real adapter.
- Narrow §2 technical-design amendment and confirmation of the existing `project-toolchain` MODIFIED delta.

## TDD Cycle Evidence

| Cycle | Evidence |
|---|---|
| RED 1 | Before production files existed, `npm test -- tests/adapters/hashing/jcs-sha256-hasher.test.ts` exited `1` with missing `src/adapters/hashing/index.js`; `npm run typecheck` exited `2` with missing adapter and port exports. |
| GREEN 1 | After the ports, barrels, and temporary order-sensitive SHA-256 adapter were added, focused tests passed (`1` file, `1` test) and `npm run typecheck` exited `0`. |
| RED 2 | After RFC vectors, array example, and property were added, the temporary adapter focused suite failed `3` of `5`: both RFC fingerprints and the recursive order-stability property. The property reported a concrete non-vacuous counterexample with reversed object order. |
| GREEN 2 | After exact-installing `canonicalize@2.1.0` and replacing temporary serialization with canonicalize → UTF-8 `Buffer` → SHA-256, focused tests passed (`1` file, `5` tests) and typecheck exited `0`. |
| TRIANGULATE | `npm run lint` exited `0`; `npm test` exited `0` with `6` files and `79` tests, including unchanged `tests/architecture/boundaries.test.ts`. The project-toolchain delta and docs skeleton were read back. |
| REFACTOR | Prettier normalization was run on changed source/test/docs/task files. `npm ci` then completed successfully; all final checks below passed. No temporary order-sensitive production code remains. |

## Verification evidence

- Focused GREEN: `npm test -- tests/adapters/hashing/jcs-sha256-hasher.test.ts` — exit `0`, 5 tests passed.
- Clean dependency install: `npm ci` — exit `0`, 183 packages added, audit found 0 vulnerabilities.
- `npm test` — exit `0`, 6 files / 79 tests passed.
- `npm run test:watch -- --run` — exit `0`, 6 files / 79 tests passed.
- `npm run build` — exit `0`.
- `npm run lint` — exit `0`; only existing eslint-plugin-boundaries deprecation warnings were emitted.
- `npm run typecheck` — exit `0`.

## Boundary and scope evidence

- `src/domain/ports/**` contains only relative `import type` dependencies; its barrel uses only `export type`.
- The adapter imports the domain port; no domain module imports an adapter, Node API, or npm runtime dependency.
- `canonicalize`, `node:buffer`, `node:crypto`, and `sha256:` occur in production only under `src/adapters/hashing/**`; test prefix assertions and independent test oracles are the only test references.
- `tests/architecture/boundaries.test.ts` was unchanged and remained green through the full suite and lint.
- `project-toolchain/spec.md` was not rewritten; its existing MODIFIED delta includes `src/adapters/hashing/` and permits ratified real barrels.
- No application, CLI, persistence, migration, unrelated adapter, or predecessor artifact was edited.

## Frozen/base evidence

Before editing, required-base checks against `e37b903` all exited `0`: `git diff --exit-code e37b903 -- src/domain/semantics/types.ts`, the matching `equal.ts` check, and the complete `openspec/changes/semantic-projection-core/` check. Initial status showed only the pre-existing untracked change directory.

Final checks repeated the same three commands and all exited `0`. Frozen hashes remained identical:

- `src/domain/semantics/types.ts`: `4d308371cf668ae8e9605866e3333ab07fbf49a28d04abff430fb407716d86df` (baseline and final).
- `src/domain/semantics/equal.ts`: `7ad8521e42a5e704a3e9c5a7ff87d528895062dd97471c2bee279f071b831d3b` (baseline and final).
- Required-base predecessor tree snapshot: `462aca07bf9980cb388e344fef93852f10e6f63396964c12a72d728831d3d138`; final diff remained empty.

`git diff --check` exited `0`. Final changed paths are limited to `docs/technical-design-v1.md`, `package.json`, generated `package-lock.json`, the two port files and port barrel, `src/adapters/hashing/{index.ts,jcs-sha256-hasher.ts}`, the hashing adapter test, and this change's existing tasks/state/progress artifacts. Proposal, spec, and design files were pre-existing and not edited during apply.

## Dependency and budget evidence

- `package.json` has runtime `canonicalize: "2.1.0"`; exact `fast-check: "4.9.0"` is unchanged.
- `package-lock.json` was generated by npm and was excluded from authored-line counting.
- Authored implementation delta is 166 additions/deletions across code, tests, docs, and package metadata before generated lockfile/evidence bookkeeping; it is below both the approximately 189-line forecast and the 400-line budget. No compression or quality reduction was used.
- Rollback boundary: remove `src/adapters/hashing/`, `src/domain/ports/{json-value.ts,hasher.ts}`, hashing tests, the `canonicalize` dependency and generated lockfile delta, the port exports, and the single docs §2 line. Slice A semantics, equality, application, CLI, persistence, and predecessor artifacts remain intact.

## Remaining tasks

None. Every implementation-owned checkbox in the persisted tasks artifact is marked `- [x]`. Parent-owned delivery/lifecycle actions remain outside this phase.

## Structured status consumed

Consumed authoritative status: active change `semantic-projection-hashing`; `nextRecommended=apply`, `dependencies.apply=ready`, no blocked reasons; hybrid artifact store with OpenSpec authoritative; strict TDD active with `npm test`; isolated worktree is the authorized workspace root and allowed edit surfaces were supplied. No action-context warning was present. No attempt was acquired or settled by this executor, and no review actor or delivery gate was started.
