# Exploration: semantic-projection (covers slices core + hashing)

Semantic projection and hashing core for `src/domain/semantics/`. This exploration was run for the whole area and, per the operator's split decision (2026-09-02), delivers as TWO changes: **A `semantic-projection-core`** (this change) and **B `semantic-projection-hashing`** (depends on A; will reference this same exploration).

> Engram counterpart: topic `sdd/semantic-projection/explore` (observation id 2040). This file mirrors that content per the hybrid artifact-store convention.

## Current State

- `src/domain/semantics/index.ts` and `src/domain/ports/index.ts` are placeholder barrels (`export {};`) — no real code yet.
- Workspace bootstrapped (change `project-foundation`, archived 2026-09-02): TS 6.0.3 strict/ESM, Vitest 4.1.11, ESLint 10.9.1 + eslint-plugin-boundaries 7.2.0, `npm test` = `vitest run`, `strict_tdd: true`.
- Boundary enforcement (`eslint.config.base.js`): matrix `domain -> domain, shared`; `shared -> shared` only. `boundaries/external` with `disallow: ["*"]` plus scoped `no-restricted-imports` mean **no npm package of any kind — `canonicalize`, `fast-check` (prod code), anything — may be imported from `src/domain/**` or `src/shared/**`.** Only pure hand-written TS is allowed there.
- Archived ADR (project-foundation design, "shared is a pure leaf"): SHA-256 cannot use `node:crypto` from shared/domain — `Hasher` port in `domain/ports`, adapter elsewhere. The same constraint applies transitively to any canonicalization library.
- No runtime `dependencies` yet; `fast-check` not installed.
- `tests/` mirrors `src/` (precedent: `tests/architecture/boundaries.test.ts`); port contract suites live under `tests/` per technical-design §12.

## Authoritative constraints (from docs)

- **Hash inputs** (domain-requirements "Approval-bound semantics" + lifecycle spec §4): purpose, actor, entry point, intended outcomes / allowed variation / prohibited regressions, normalized tool-independent journey actions (ORDERED array), meaningful checkpoints (ordered only when explicitly declared ordered), variable names/classifications/constraints/secret-reference identifiers/non-sensitive examples, stateful/stateless classification + deterministic isolation/reset intent.
- **Hash exclusions**: Project/Beacon/draft/version identities, local addresses/titles, contract schema versions, approval/lifecycle metadata, supporting-artifact references, secret contents, runtime-resolved values, raw recordings/traces/screenshots/generated test code, setup mechanics, readiness-validation results.
- **Ordering**: journey actions ordered; explicitly-ordered checkpoints ordered; variables/outcomes/prohibited-regressions/allowed-variation and other keyed declarations compared by logical identity (order-insensitive) — keyed objects/maps, not arrays.
- **Defaults/nulls**: omitted value === explicit default (resolve declared defaults before projection); `null` distinct only where the schema explicitly gives it domain meaning.
- **Migration equivalence** (lifecycle spec §5): interpret source via its schema, target via its schema, normalize both to the projection, require exact equality. Technical-design §7 frames it as `hash(projection(a)) === hash(projection(b))`, but §5's literal wording compares the projections themselves — pure `deepEqual(projection(a), projection(b))` needs no crypto and no port. The persisted `sha256:<hex>` is a separate, port-dependent, derived identity artifact computed at approval time.
- Canonical bytes are used only "at hash/compare time" (technical-design §7) — stored files stay pretty-printed JSON, so JCS serialization lives entirely inside the Hasher adapter, never in domain.

## Approaches

### 1. `canonicalize` npm package behind the Hasher port (adapter-only) — RECOMMENDED
- Domain never touches JCS. Port: `hash(value: JsonValue): string` (sync; CPU-bound). Adapter (`src/adapters/hashing/`): `canonicalize(value)` → UTF-8 bytes → `node:crypto` SHA-256 → `sha256:<hex>`.
- Pros: RFC 8785 correctness delegated to a spec-conformant, independently tested, zero-dep ~200-line library (handles ECMAScript number serialization — `-0`, precision, `1e21` thresholds — and string escaping per RFC 8785 §3.2.2.2/3.2.3, exactly the categories hand-rolled implementations get wrong). Domain stays 100% pure. Reuses the archived Hasher-port ADR pattern, widened from raw bytes to a `JsonValue` canonicalized internally (avoids a second "Canonicalizer" port).
- Cons: adds the first runtime dependency; hash-stability property tests must exercise the REAL adapter (not a domain fake) to catch actual JCS conformance bugs.
- Effort: Low.

### 2. Hand-roll JCS in pure TS inside domain/shared
- Legal under the boundary rule (algorithm, not import), but RFC 8785 has real edge cases (UTF-16 code-unit key sorting, ECMAScript ToString number formatting, integer-like string keys reordering ahead of insertion order — directly relevant since variable/outcome/checkpoint keys are logical-identity strings). Highest correctness risk for no architectural benefit, since the port exists anyway for `node:crypto`.
- Effort: Medium-High.

## fast-check integration (Vitest 4)

Runner-agnostic; plain `fc.assert(fc.property(...))` inside `it`/`test`, devDependency only. Properties → arbitraries:
1. **Ordering insensitivity of keyed collections** (pure domain): permute variables/outcomes/regressions/variation entry order; assert equal projections.
2. **Omitted == explicit default** (pure domain): generate omitted-form, derive explicit-default form; assert equal projections.
3. **Hash stability across serialization orders** (adapter/integration — Slice B): same logical bundle, different key insertion orders; assert same `sha256:<hex>` through the real adapter.
4. **Null semantics only where declared** (pure domain): needs a minimal contract field-declaration fixture (which fields give `null` domain meaning) built in this change.

## Semantic bundle type model (to be pinned in design)

```
SemanticBundle {
  purpose: string
  actor: string
  entryPoint: NormalizedEntryPoint
  variables: Record<VariableKey, VariableDecl>        // keyed
  actions: OrderedJourneyAction[]                     // ordered
  checkpoints: keyed by default; ordered array only when explicitly declared ordered (operator-ratified ruling)
  outcomes: Record<OutcomeKey, OutcomeDecl>
  allowedVariation: Record<VariationKey, VariationDecl>
  prohibitedRegressions: Record<RegressionKey, RegressionDecl>
  readinessIntent: { classification: "stateful" | "stateless"; isolationIntent: NormalizedIsolationIntent }
}
VariableDecl { name, classification, constraints?, secretReferenceId?, nonSensitiveExample? }
```

Exact `VariableClassification` values, `NormalizedConstraint` shape, and entry-point normalization are design-phase work — not to be re-decided during apply.

## Hasher port shape (Slice B)

```ts
// src/domain/ports
export interface Hasher {
  hash(value: JsonValue): string; // "sha256:<hex>"
}
```
`sha256:` prefix construction lives only in the adapter; domain treats the hash as an opaque (optionally branded `SemanticHash`) string.

## Split decision (operator-ratified 2026-09-02)

**Two changes.**

### Slice A — `semantic-projection-core` (this change): pure domain, no port, no dependency
| File | Est. lines |
|---|---|
| src/domain/semantics/types.ts | ~90 |
| src/domain/semantics/normalize.ts | ~110 |
| src/domain/semantics/project.ts | ~70 |
| src/domain/semantics/equal.ts | ~40 |
| src/domain/semantics/index.ts | ~10 |
| tests/domain/semantics/normalize.test.ts | ~90 |
| tests/domain/semantics/project.test.ts | ~140 |
| tests/domain/semantics/equal.test.ts | ~60 |
| **Total** | **~610** (≈320 production + ≈290 tests) |

Near/over the 400 budget on its own — the review workload guard fires at tasks time with real numbers (chained PRs vs `size:exception`, operator decides then).

### Slice B — `semantic-projection-hashing` (depends on A)
| File | Est. lines |
|---|---|
| src/domain/ports/index.ts (Hasher) | ~15 |
| src/adapters/hashing/jcs-sha256-hasher.ts | ~40 |
| src/adapters/hashing/index.ts | ~10 |
| package.json (+canonicalize dep, +fast-check devDep lands with A) | ~4 |
| tests/adapters/hashing/jcs-sha256-hasher.test.ts | ~110 |
| **Total** | **~189** |

## Orchestrator rulings (settled before propose — do not reopen)

1. **Migration equivalence = deep structural equality of projections** (lifecycle §5 literal wording; the hash remains the approval-bound fingerprint computed via port at approval time).
2. **Checkpoints default keyed; ordered only when explicitly declared ordered** (lifecycle §4 literal wording).
3. **`src/adapters/hashing/` is approved as a new adapter directory**: docs/technical-design-v1.md §2 will be amended within Slice B, with a MODIFIED delta on the project-toolchain spec's skeleton requirement.

## Out of scope

Store persistence, approval workflow, CLI, Playwright adapter, migration tooling beyond the equality predicate. Slice A additionally excludes: Hasher port, hashing adapter, `canonicalize` dependency.

## Risks

- Property-test line counts are forecasts; fast-check suites are inherently verbose.
- This change assumes an already-schema-validated bundle as input (Ajv wiring is a later decision); the first caller (`application/`, future change) must uphold that.
- Slice A's estimate (~610) sits over the 400 budget — expected `ask-on-risk` stop at tasks/apply boundary.

## Ready for Proposal

Yes — all open decisions ruled or user-ratified. `sdd-propose` may lock scope for `semantic-projection-core`.
