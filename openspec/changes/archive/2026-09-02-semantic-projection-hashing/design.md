# Design: Semantic Projection Hashing (Slice B)

## Design summary

Slice B adds one pure domain port and one Node adapter. Consumers depend on `Hasher.hash(value: JsonValue): string`; only `JcsSha256Hasher` knows about RFC 8785, SHA-256, UTF-8, `canonicalize`, or the `sha256:` representation. The frozen Slice A projection is accepted directly, without changing or wrapping `SemanticProjection`, `SemanticBundle`, or `src/domain/semantics/types.ts`.

The implementation remains one reviewable PR at approximately 189 authored changed lines, excluding the generated `package-lock.json` delta. It adds no application wiring, persistence, CLI behavior, migration behavior, or approval orchestration.

## Ratified constraints

The following inputs are fixed and are not reopened by this design:

- Required base: `e37b903` from Slice A.
- `SemanticProjection = SemanticBundle` remains byte-for-byte unchanged in `src/domain/semantics/types.ts`.
- `isMigrationEquivalent` remains recursive structural equality with `===` at primitive leaves and never calls a hasher.
- The domain receives and returns an opaque string contract; the adapter alone selects JCS, SHA-256, lowercase hexadecimal, and `sha256:`.
- `src/domain/**` remains free of Node and npm imports.
- `src/adapters/hashing/`, the matching `docs/technical-design-v1.md` §2 line, and the `project-toolchain` exact-skeleton amendment are ratified.
- Nothing under `openspec/changes/semantic-projection-core/` may change.

## Architecture and data flow

```text
SemanticProjection ──assignable to──> JsonValue
                                      │
                                      v
                              Hasher.hash(value)
                                      │ implemented by
                                      v
                           JcsSha256Hasher (adapter)
                                      │
                    canonicalize(value) using RFC 8785
                                      │ canonical string
                                      v
                            Buffer.from(text, "utf8")
                                      │ bytes
                                      v
                 createHash("sha256").update(bytes).digest("hex")
                                      │ lowercase hex
                                      v
                              `sha256:${digest}`
```

The dependency direction is `adapter -> domain/ports -> domain/semantics` and is type-only between the two domain modules. There is no runtime import from domain code to an adapter and no runtime dependency introduced into `src/domain/**`.

## Domain contract and TypeScript assignability

### Exact location and exports

`JsonValue` lives in `src/domain/ports/json-value.ts`. `Hasher` lives in `src/domain/ports/hasher.ts`. The public domain-port barrel is `src/domain/ports/index.ts`:

```ts
// src/domain/ports/json-value.ts
import type {
  SemanticProjection,
  SemanticValue,
} from "../semantics/types.js";

export type JsonValue = SemanticValue | SemanticProjection;

// src/domain/ports/hasher.ts
import type { JsonValue } from "./json-value.js";

export interface Hasher {
  hash(value: JsonValue): string;
}

// src/domain/ports/index.ts
export type { Hasher } from "./hasher.js";
export type { JsonValue } from "./json-value.js";
```

### Why `JsonValue` is not a duplicated recursive index-signature type

`SemanticValue` already defines the generic recursive JSON-safe value vocabulary. However, `SemanticBundle` is an interface with named properties and intentionally has no string index signature. Under strict TypeScript, that interface is not assignable to a standalone `{ readonly [key: string]: JsonValue }` union member even though every declared property is JSON-safe. Adding an index signature or changing the interface to a type alias would violate the frozen Slice A contract.

`JsonValue = SemanticValue | SemanticProjection` resolves that language-level mismatch explicitly:

- generic JSON scalars, arrays, and records use the existing `SemanticValue` definition;
- the frozen projection is admitted directly as the approval-time hashing input;
- no cast, clone, wrapper, serialization shim, or edit to `types.ts` is required at a consumer call site;
- both imported names are types, so `json-value.ts` emits no runtime dependency;
- all admitted projection fields are JSON-safe by the frozen Slice A ADR and upstream schema-validation precondition.

The adapter test file includes a compile-time assignment/call proof that a `SemanticProjection` can be passed directly to a `Hasher` without `as`, `unknown`, or conversion. `npm run typecheck` is the authoritative evidence for this proof; Vitest transpilation alone is not.

`number` is understood in its JSON-safe sense: finite numbers only. TypeScript cannot exclude `NaN` and infinities from `number`; upstream schema interpretation owns that precondition, as ratified in Slice A. This slice does not add a second validator.

## Source layout

| File | Responsibility |
|---|---|
| `src/domain/ports/json-value.ts` | Export the JSON-safe input union while explicitly admitting the frozen `SemanticProjection` interface. Type-only imports only. |
| `src/domain/ports/hasher.ts` | Declare the synchronous, opaque `Hasher.hash(value: JsonValue): string` port. |
| `src/domain/ports/index.ts` | Type-only exports for `Hasher` and `JsonValue`; replaces the bootstrap placeholder barrel with a real public barrel. |
| `src/adapters/hashing/jcs-sha256-hasher.ts` | Implement JCS canonicalization, explicit UTF-8 byte conversion, Node SHA-256, lowercase-hex digest, and adapter-only prefix construction. |
| `src/adapters/hashing/index.ts` | Export `JcsSha256Hasher`; this is a real Slice B barrel, not a placeholder. |
| `tests/adapters/hashing/jcs-sha256-hasher.test.ts` | Compile-time port/projection compatibility, RFC vectors, object-order property, array-order example, prefix shape, and real-adapter coverage. |
| `package.json` | Add exact runtime dependency `"canonicalize": "2.1.0"`; retain exact `"fast-check": "4.9.0"`. |
| `package-lock.json` | npm-generated lockfile update; never hand-edit. |
| `docs/technical-design-v1.md` | One-line §2 architecture amendment adding `hashing/`. |

No root adapter barrel or application/composition-root export is added because no consumer wiring belongs to this slice.

## Adapter contract and algorithm

`JcsSha256Hasher` is a stateless class implementing `Hasher`. Its implementation order is fixed:

```ts
const canonical = canonicalize(value);
if (canonical === undefined) {
  throw new TypeError("Canonicalization failed for a JSON-safe value");
}
const bytes = Buffer.from(canonical, "utf8");
const digest = createHash("sha256").update(bytes).digest("hex");
return `sha256:${digest}`;
```

Imports are limited to:

- default `canonicalize` from exact-pinned `canonicalize@2.1.0`;
- `Buffer` from `node:buffer`;
- `createHash` from `node:crypto`;
- type-only `Hasher` and `JsonValue` from `../../domain/ports/index.js`.

The `canonicalize@2.1.0` declaration permits `undefined` as a result because the library also accepts values outside the JSON data model. A valid `JsonValue` must not reach that branch, but the adapter narrows the result and fails closed with `TypeError` if the dependency reports the impossible state. It MUST NOT hash an empty string, fall back to `JSON.stringify`, coerce the result, or silently omit data. Tests do not forge an invalid `JsonValue` merely to cover this defensive branch.

The adapter remains synchronous because canonicalization and hashing are local CPU operations. The returned string is opaque outside the adapter; consumers must not parse it or branch on its prefix.

## Dependency update

Run npm's exact-save operation for `canonicalize@2.1.0`, producing:

```json
"dependencies": {
  "canonicalize": "2.1.0"
}
```

`canonicalize` is a runtime dependency, not a devDependency. `fast-check` remains the already-installed exact devDependency at `4.9.0`. `package-lock.json` is regenerated by npm from `package.json`; its generated changed lines are excluded from the authored-line forecast but included in the complete review snapshot.

## Test design

### RFC 8785 vectors

The test table contains two independently specified RFC examples inline, with source-section comments:

1. RFC 8785 §3.2.2 serialization sample: literals, ECMAScript number rendering, escaped/control and Unicode string content, and object-member sorting.
2. RFC 8785 §3.2.3 property-order sample: the published UTF-16 property-name ordering set, including control, ASCII, Latin, Euro, emoji, and Hebrew keys.

Each row contains the RFC input value, the RFC-published canonical string, and a hard-coded `sha256:<lowercase-hex>` expected fingerprint. During RED setup, each digest constant is derived once from the published canonical UTF-8 bytes with a direct `node:crypto` one-off command and then committed as test data. The expectation itself MUST NOT call `canonicalize`, `JcsSha256Hasher`, or `JSON.stringify` to construct the oracle. The real adapter hashes the original, deliberately non-canonical insertion order and is compared to the hard-coded fingerprint. Keeping the published canonical string beside the constant makes transcription and review possible without making the production canonicalizer its own oracle.

A focused example separately proves array semantics: hashes for `[1, 2]` and `[2, 1]` differ.

### Non-vacuous `fast-check@4.9.0` property

The property uses the real `JcsSha256Hasher`, not a fake port. A recursive `fc.letrec` arbitrary produces JSON-safe scalars, arrays, and objects. Object keys are prefixed with `k:` so they are never ECMAScript array-index keys; the root is forced to contain at least two distinct keys. Nested arrays keep their generated order.

A test-only helper rebuilds the complete value recursively:

- scalar/null: return unchanged;
- array: map each element recursively in the same index order; never reverse or sort the array;
- object: recurse into every value, then insert entries into a fresh object in reverse `Object.entries` order.

For every generated value, the property:

1. serializes and parses the original value;
2. recursively rebuilds all objects with reversed insertion order;
3. serializes the rebuilt value and parses it again;
4. asserts the two serialized strings differ (guaranteed by the non-index, two-key root), proving the transformation is not vacuous;
5. asserts the parsed values are deeply equal, which also proves arrays retained element order;
6. passes both parsed values through the real adapter and asserts equal fingerprints.

The property runs with Vitest/fast-check's normal deterministic failure reporting and does not replace the two RFC examples. If it unexpectedly passes against the temporary order-sensitive RED implementation, the RED step is invalid and must be repaired before production JCS code is written.

### Compile-time and boundary assertions

The same test file assigns the real adapter to `Hasher` and calls a `Hasher`-typed function with a `SemanticProjection` parameter directly. No cast is allowed in that proof. `npm run typecheck` must fail if the `JsonValue` union or barrel exports stop admitting the frozen projection.

Existing `tests/architecture/boundaries.test.ts` remains unchanged and continues proving the lint boundary fails for a domain `node:*` import. The production adapter imports domain types and Node/npm mechanisms in the allowed direction. No test imports `canonicalize` into domain code.

## Strict-TDD implementation sequence

1. **RED — public contract:** create the adapter test import and compile-time `SemanticProjection -> Hasher.hash` proof before `json-value.ts`, `hasher.ts`, or the hashing adapter exists. Record the failing focused test/typecheck output.
2. **GREEN — smallest contract path:** add the two domain-port files/barrel and a temporary simplest order-sensitive SHA-256 adapter sufficient for the contract/prefix smoke case. Domain files contain only type declarations and relative type-only imports.
3. **RED — canonical behavior:** add the RFC rows, array-order example, and the recursive fast-check property. Confirm the focused suite fails specifically because object insertion order leaks through the temporary serializer; confirm the property's serialized-string inequality witness is active.
4. **GREEN — real mechanism:** exact-install `canonicalize@2.1.0`, replace the temporary serialization with `canonicalize -> Buffer.from(..., "utf8") -> createHash("sha256") -> lowercase hex -> adapter-only prefix`, and add the defensive `undefined` branch. Run the focused adapter suite to green.
5. **REFACTOR:** keep the recursive reorder helper test-only, remove all temporary order-sensitive code, normalize exports, and run formatting before final verification. Do not alter the frozen semantics files while refactoring.
6. **Documentation/toolchain alignment:** add only the §2 `hashing/` line and verify the already-authored `project-toolchain` delta semantics. Passive documentation readback, not a fabricated behavior test, is the proportional check.

No production implementation is committed in a RED state. Tests and the behavior they verify remain in the same work-unit commit.

## Technical-design and project-toolchain alignment

### `docs/technical-design-v1.md` §2

Add exactly one adapter entry after `engram-discovery/`:

```text
    hashing/            # RFC 8785 canonicalization + SHA-256
```

Do not rewrite §2, move hashing into `semantics/` or `shared/`, or edit other technical-design sections in this slice.

### Corrected delta semantics

The `project-toolchain` MODIFIED requirement is interpreted as an architectural-directory contract, not as a perpetual bootstrap-content contract:

- the exact architectural directory set now includes `src/adapters/hashing/`;
- no additional top-level architectural root is introduced;
- `src/domain/semantics/index.ts` is already a real Slice A barrel;
- `src/domain/ports/index.ts` and `src/adapters/hashing/index.ts` become real Slice B barrels;
- those barrels may export ratified behavior and MUST NOT be rejected for no longer containing only `export {};`;
- all hexagonal import-boundary rules remain unchanged.

The delta supersedes the stale bootstrap-era sentence in the base capability that required every `index.ts` to remain a placeholder. Implementation must not reintroduce a test that scans all barrels for `export {};`.

## Verification and evidence

### Focused checks

- Focused RED/GREEN: `npm test -- tests/adapters/hashing/jcs-sha256-hasher.test.ts`.
- Type compatibility: `npm run typecheck` includes both `src/**` and `tests/**`.
- Dependency boundary: `npm run lint`, plus the existing architecture boundary tests in `npm test`.
- Dependency lock consistency: a clean `npm ci` followed by the checks below.

### All five npm script checks

Every script in the fixed toolchain contract is exercised in a bounded form and must exit `0`:

1. `npm test`
2. `npm run test:watch -- --run` (bounded one-shot execution of the watch-script entry point)
3. `npm run build`
4. `npm run lint`
5. `npm run typecheck`

`npm ci` is an additional clean-lockfile prerequisite, not a sixth package script.

### Frozen and scope byte checks

Before and after the implementation work unit, preserve base bytes with these checks against required base `e37b903`:

```sh
git diff --exit-code e37b903 -- src/domain/semantics/types.ts
git diff --exit-code e37b903 -- src/domain/semantics/equal.ts
git diff --exit-code e37b903 -- openspec/changes/semantic-projection-core/
```

The first check proves the entire frozen type file—including `SemanticProjection = SemanticBundle`—is unchanged. The second proves migration equivalence remains independent of hashing. The third proves the predecessor's OpenSpec artifacts were not edited. Also inspect the final changed-path list and reject application, persistence, CLI, migration-runner, or unrelated adapter paths.

### Boundary proof

The final evidence must show:

- `npm run lint` exits `0` on the real source tree;
- `npm test` keeps `tests/architecture/boundaries.test.ts` green, proving a domain `node:*` import would be rejected;
- imports in `src/domain/ports/**` are relative and type-only;
- `canonicalize`, `node:buffer`, `node:crypto`, and `sha256:` occur only under `src/adapters/hashing/**` (tests may reference the expected output prefix);
- the adapter imports the domain port, and no domain module imports the adapter.

## Work units, forecast, and rollback

| Work unit | Cohesive contents | Authored forecast | Independent rollback |
|---|---|---:|---|
| 1. Hashing contract and adapter | Port types/barrel, real adapter/barrel, exact dependency and lockfile, RFC/property/array/type tests | ~175 lines, plus generated lockfile | Remove `src/adapters/hashing/`, remove `src/domain/ports/{json-value,hasher}.ts`, restore the ports placeholder barrel, remove adapter tests and `canonicalize`, regenerate/revert the lockfile. Slice A behavior remains intact. |
| 2. Architecture alignment | One §2 line and review of the already-present `project-toolchain` delta | ~14 lines including SDD/task evidence allocation | Revert the §2 line and this change's delta integration; no runtime or data rollback. |

Total forecast: approximately **189 authored additions plus deletions**, excluding generated `package-lock.json`. Both work units fit one ratified PR and tell one Slice B story; tests stay with implementation. If task planning or application forecasts more than 400 authored changed lines, stop under `ask-on-risk` before apply rather than compressing tests or documentation.

## Migration, security, and operational impact

There is no migration or persisted data. The adapter hashes only caller-supplied JSON-safe semantic values and performs no I/O. It does not ingest secrets, raw contracts, traces, screenshots, generated tests, runtime-resolved values, or any excluded semantic data. Supply-chain exposure is limited to exact-pinned, adapter-only `canonicalize@2.1.0`; Node provides the cryptographic implementation.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| TypeScript rejects `SemanticProjection` as a recursive indexed JSON object | Explicitly include the frozen projection in `JsonValue`; enforce a cast-free compile-time call proof. |
| The canonicalizer's `undefined` return type is ignored | Narrow explicitly and throw; never hash fallback bytes. |
| A property passes without changing representation | Force at least two non-index root keys and assert serialized strings differ for every case. |
| Recursive reordering accidentally changes array meaning | Map arrays in original index order and assert deep equality before comparing hashes. |
| Domain acquires runtime coupling | Type-only relative imports in ports; npm/Node imports and prefix stay in the adapter; lint and architecture tests prove the boundary. |
| Base skeleton language rejects real Slice A/Slice B barrels | Apply the MODIFIED delta as directory semantics and explicitly retire placeholder-only content semantics for ratified modules. |
| Scope drifts into predecessor artifacts or migration equality | Base-relative byte checks for `types.ts`, `equal.ts`, and the complete predecessor OpenSpec directory. |

## Open questions

None. All product and architectural forks relevant to Slice B were ratified before this phase.