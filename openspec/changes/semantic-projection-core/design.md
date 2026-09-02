# Design: Semantic Projection Core (Slice A)

## Technical Approach

**Canonical by construction.** Instead of normalizing a value and then teaching the comparator (and, in Slice B, the canonicalizer) how to forgive representation differences, the projection type itself admits only one representation of a given meaning. Consequences that fall out of that single rule:

- The `SemanticBundle` has **zero optional properties** — absence is `null` (where declared meaningful) or the resolved declared default. `undefined` is not JSON, and JCS drops `undefined`-valued keys, so an optional property would give one meaning two canonicalizations.
- Order-insensitive collections are `Record<string, T>` objects, so document order is not representable and cannot leak into the value.
- Equality is therefore a plain recursive compare — no undefined-vs-absent rule, no key sorting, no special cases (spec: *Normalization Before Comparison*, *Migration Equivalence*).
- Every leaf is `string | number | boolean | null | array | plain object`. Slice B can hand `SemanticProjection` straight to a JCS canonicalizer with no shim.

Three files carry three spec requirements: `normalize.ts` = *how a value is canonicalized*, `project.ts` = *which fields are included* (the allowlist, and the only place exclusion lives), `equal.ts` = *migration equivalence*. `types.ts` is declaration-only and erases at build.

## Architecture Decisions

### Decision: Input is a schema-interpreted `SemanticSource`, not a schema document

**Choice**: `project()` consumes `SemanticSource` — an already-validated, already-schema-interpreted object with no `contract`/`version`/`id` field in its core, plus a `[k: string]: unknown` index signature that admits the excluded fields real callers carry.
**Alternatives**: (a) consume the raw contract document and branch on schema version; (b) a closed type with no index signature.
**Rationale**: (a) would make a *schema-independent* projection schema-dependent — the exact property migration equivalence needs. Mapping `pharos.beacon-semantics/N` onto `SemanticSource` belongs to the future `application/` interpreter; the domain never sees a version. (b) would make dropping excluded fields a type fiction — the index signature makes exclusion an observable, testable runtime behavior.

### Decision: `VariableClassification` is a closed union; `NormalizedConstraint.kind` is an open string

**Choice**: `"representative" | "required_scenario" | "test_data"` (snake_case, verbatim from PHAROS.md); constraint `kind` is `string`.
**Alternatives**: open string for classification; a per-kind discriminated union for constraints; a `sensitive`/`non_sensitive` classification member.
**Rationale**: classification is a *product-fixed* v1 vocabulary (domain-requirements: "v1 annotations remain limited to the required semantic core"); adding a member is an approval-bound semantic change that *should* break the domain build and force reapproval. Constraint vocabulary is *schema-owned* — a closed union there would re-couple the projection to a schema. The domain compares constraints, never evaluates them, so `{ kind, value }` is the minimal comparable form. Sensitivity is structural, not a classification: a variable is sensitive iff `secretReferenceId !== null` (domain-requirements: "Sensitive values MUST remain references").

### Decision: keyed collections are `Record<string, T>`, never sorted arrays

**Choice**: `Record` keyed by logical identity for variables, outcomes, allowed variation, prohibited regressions, checkpoint expectations, entry-point query, and per-variable constraints (keyed by `kind`, at most one per kind). Isolation scope uses `SemanticKeySet = Readonly<Record<string, true>>`.
**Alternatives**: arrays sorted by a canonical key.
**Rationale**: sorting would force the domain to own a total order over strings — the UTF-16-vs-code-point trap the exploration rejected when it declined to hand-roll JCS. `Record` also makes duplicate identities unrepresentable in the output. Equality never observes key order, and Slice B's JCS sorts keys at hash time, so no sorting duty exists anywhere in domain.

### Decision: checkpoints are a discriminated union, not an array plus a flag

**Choice**: `{ ordering: "keyed"; entries: Record<...> } | { ordering: "ordered"; entries: readonly [...] }`.
**Alternatives**: always an array with `ordered: boolean`.
**Rationale**: lifecycle §4 makes keyed the default and ordered an explicit declaration. The union makes order-insensitivity a *type-level* fact — reordering a keyed set literally cannot change the value — and an ordered bundle can never structurally equal a keyed one, which is the correct semantics for free.

### Decision: `SemanticProjection` is an unversioned alias of `SemanticBundle` — FROZEN for Slice B

**Choice**: `export type SemanticProjection = SemanticBundle;` No envelope, no format-version token.
**Alternatives**: `{ projection: "pharos.semantic-projection/1"; bundle: ... }`.
**Rationale**: a version token inside the hashed value reintroduces a version into hashed meaning (lifecycle §4 excludes contract schema versions) and would make every contract non-equivalent across a projection-format bump. **Slice B MUST consume this type unchanged** — no wrapping, no added field, no serialization shim.

### Decision: default/null resolution is driven by a data table, not by scattered `??`

**Choice**: `FIELD_DECLARATIONS`, a `Readonly<Record<string, FieldDeclaration<...>>>` where `FieldDeclaration<T> = { declaredDefault: T; nullHasDomainMeaning: boolean }`, applied by one `resolveDeclared(raw, declaration)`.
**Alternatives**: inline defaulting at each call site.
**Rationale**: lifecycle §4 makes "declared default" and "null has domain meaning" *field-level declarations*, so they belong in a declaration table. It also lets the null-semantics property test enumerate the table, so adding a field automatically extends property coverage.

Rule: `undefined` → `declaredDefault`; `null` → `nullHasDomainMeaning ? null : declaredDefault`; otherwise the value. Reference contrast pair used by the spec scenario *Null preserved only where declared*: `entryPoint.query` (`null` = no declared query constraint, distinct from `{}` = must be empty) vs `variable.constraints` (`null` has no meaning → resolves to `{}`).

### Decision: primitive equality uses `===`, not `Object.is`

**Choice**: `===` for leaves.
**Rationale**: RFC 8785 serializes `-0` as `0`, so `Object.is` would report two values unequal that Slice B hashes identically — a silent divergence between the equality predicate and the approval-bound hash. `NaN` and `Infinity` are not representable in JSON and cannot reach a projection.

### Decision: duplicate logical identity throws

**Choice**: `toKeyed` throws a plain `Error` on a duplicate key (array-form input, or an entry whose declared `id`/`name` disagrees with its record key).
**Rationale**: last-wins would silently collapse two variables into one and change approved meaning. Throwing is pure, costs ~2 lines, and needs no npm. Beyond the spec's 12 scenarios — covered by a unit test.

## Data Flow

```
  contract document (pharos.beacon-semantics/N)
          │   [upstream, NOT this change: Ajv validation + schema interpretation]
          ▼
   SemanticSource ──────────────────────────────────────────────┐
   optionals · nulls · array|object keyed forms · excluded fields │
          │                                                       │
          ▼  normalize.ts                                         │
   FIELD_DECLARATIONS + resolveDeclared  →  defaults, null semantics
   toKeyed / ordered part normalizers    →  Record | array
          │                                                       │
          ▼  project.ts  (ALLOWLIST — the only place exclusion lives)
   SemanticProjection  =  SemanticBundle   [FROZEN for Slice B]  ←┘
   no optional props · JSON leaves only · canonical by construction
          │
          ├──▶ equal.ts   projectionsEqual(a, b) / isMigrationEquivalent(a, b) → boolean
          │
          └──▶ [Slice B]  Hasher port → JCS + SHA-256 → "sha256:<hex>"
```

## File Changes

| File | Action | Description | Est. lines |
|------|--------|-------------|-----------|
| `src/domain/semantics/types.ts` | Create | Pinned type model + `SemanticSource` input contract | ~110 |
| `src/domain/semantics/normalize.ts` | Create | `FIELD_DECLARATIONS`, `resolveDeclared`, `toKeyed`, part normalizers | ~120 |
| `src/domain/semantics/project.ts` | Create | Allowlist assembly of the ten included fields | ~55 |
| `src/domain/semantics/equal.ts` | Create | `deepEqual`, `projectionsEqual`, `isMigrationEquivalent` | ~40 |
| `src/domain/semantics/index.ts` | Modify | Barrel replaces `export {};` (all tests import through it) | ~18 |
| `tests/domain/semantics/arbitraries.ts` | Create | Shared fast-check generators + path get/set helpers | ~95 |
| `tests/domain/semantics/normalize.test.ts` | Create | Defaults, null table, keying from both forms, duplicate guard | ~85 |
| `tests/domain/semantics/project.test.ts` | Create | Inclusion, exclusion, ordered vs keyed checkpoints | ~120 |
| `tests/domain/semantics/project.properties.test.ts` | Create | The three fast-check properties | ~75 |
| `tests/domain/semantics/equal.test.ts` | Create | Equivalent / non-equivalent migration, reflexivity | ~55 |
| `package.json` | Modify | `fast-check` devDependency | ~1 |
| `package-lock.json` | Modify | Generated (fast-check is zero-dep) | ~20 (excluded from authored count) |

**Authored total ≈ 775 changed lines** (~343 production + ~430 tests + 1), revising the exploration's ~610 upward: that estimate omitted the `SemanticSource` input contract, the `arbitraries.ts` module, and the separate property-suite file. **This is ~1.9× the 400-line review budget.** The guard forecast and `Decision needed before apply` lines belong to `sdd-tasks`; this design supplies the numbers and a chained-PR split that keeps every slice autonomous and under budget:

| Slice | Contents | Est. |
|---|---|---|
| A1 | `types.ts` (complete — the frozen contract must land whole), `index.ts`, `equal.ts`, `equal.test.ts` | ~223 |
| A2 | `normalize.ts`, `arbitraries.ts`, `normalize.test.ts`, `fast-check` devDep | ~301 |
| A3 | `project.ts`, `project.test.ts`, `project.properties.test.ts` | ~250 |

## Interfaces / Contracts

```ts
// src/domain/semantics/types.ts — FROZEN inter-slice contract.

export type SemanticValue =
  | string | number | boolean | null
  | readonly SemanticValue[]
  | { readonly [key: string]: SemanticValue };

export type SemanticKeySet = Readonly<Record<string, true>>;

export type VariableClassification = "representative" | "required_scenario" | "test_data";
export type SideEffectClass = "stateful" | "stateless";

export interface NormalizedConstraint {
  readonly kind: string;          // schema-owned vocabulary; domain compares, never evaluates
  readonly value: SemanticValue;
}

export interface VariableDecl {
  readonly name: string;                                        // equals its key
  readonly classification: VariableClassification;
  readonly constraints: Readonly<Record<string, NormalizedConstraint>>;  // keyed by kind
  readonly secretReferenceId: string | null;                    // non-null ⇒ sensitive
  readonly nonSensitiveExample: SemanticValue | null;
}

export interface NormalizedActor {
  readonly type: string;                    // e.g. "guest"
  readonly identityRef: string | null;      // reference only; never credentials
}

export interface NormalizedEntryPoint {
  readonly path: string;                    // origin-relative; host/port are runtime-resolved
  readonly query: Readonly<Record<string, string>> | null;  // null ⇒ unconstrained; {} ⇒ must be empty
  readonly fragment: string | null;
}

export type NormalizedActionValue =
  | { readonly kind: "literal"; readonly value: SemanticValue }
  | { readonly kind: "variable"; readonly variable: string };

export interface OrderedJourneyAction {
  readonly action: string;                  // tool-independent intent verb, e.g. "select_policy"
  readonly target: string | null;           // logical token or route — never a selector/locator
  readonly value: NormalizedActionValue | null;
}

export interface NormalizedCheckpoint {
  readonly id: string;
  readonly afterAction: string | null;
  readonly expectations: Readonly<Record<string, SemanticValue>>;
}

export type NormalizedCheckpoints =
  | { readonly ordering: "keyed"; readonly entries: Readonly<Record<string, NormalizedCheckpoint>> }
  | { readonly ordering: "ordered"; readonly entries: readonly NormalizedCheckpoint[] };

export interface KeyedDeclaration { readonly id: string; readonly description: string | null; }
export type OutcomeDecl = KeyedDeclaration;
export type VariationDecl = KeyedDeclaration;
export type RegressionDecl = KeyedDeclaration;

export interface NormalizedIsolationIntent {
  readonly strategy: string;        // intent token, never an executable command (mechanics excluded)
  readonly scope: SemanticKeySet;   // overlap = key intersection (lifecycle §7)
}

export interface ReadinessIntent {
  readonly sideEffectClass: SideEffectClass;
  readonly isolation: NormalizedIsolationIntent | null;   // null legal only for stateless
}

export interface SemanticBundle {
  readonly purpose: string;
  readonly actor: NormalizedActor;
  readonly entryPoint: NormalizedEntryPoint;
  readonly actions: readonly OrderedJourneyAction[];        // ordered
  readonly checkpoints: NormalizedCheckpoints;
  readonly variables: Readonly<Record<string, VariableDecl>>;
  readonly outcomes: Readonly<Record<string, OutcomeDecl>>;
  readonly allowedVariation: Readonly<Record<string, VariationDecl>>;
  readonly prohibitedRegressions: Readonly<Record<string, RegressionDecl>>;
  readonly readinessIntent: ReadinessIntent;
}

export type SemanticProjection = SemanticBundle;   // FROZEN — Slice B consumes unchanged
```

```ts
// Input contract. Schema-interpreted upstream; carries excluded fields that project() drops.
export type SemanticSource = SemanticSourceCore & { readonly [excludedField: string]: unknown };

export type SourceDeclarationList =
  | readonly (string | { readonly id: string; readonly description?: string | null })[]
  | Readonly<Record<string, { readonly description?: string | null }>>;

export interface SemanticSourceCore {
  readonly purpose: string;
  readonly actor: { readonly type: string; readonly identityRef?: string | null };
  readonly entryPoint: {
    readonly path: string;
    readonly query?: Readonly<Record<string, string>> | null;
    readonly fragment?: string | null;
  };
  readonly actions: readonly {
    readonly action: string;
    readonly target?: string | null;
    readonly value?: NormalizedActionValue | SemanticValue | null;
  }[];
  readonly checkpoints?: {
    readonly ordered?: boolean | null;        // declared default: false ⇒ keyed
    readonly entries: readonly SourceCheckpoint[] | Readonly<Record<string, SourceCheckpoint>>;
  } | null;
  readonly variables?: readonly SourceVariable[] | Readonly<Record<string, SourceVariable>> | null;
  readonly outcomes?: SourceDeclarationList | null;
  readonly allowedVariation?: SourceDeclarationList | null;
  readonly prohibitedRegressions?: SourceDeclarationList | null;
  readonly readinessIntent: {
    readonly sideEffectClass: SideEffectClass;
    readonly isolation?: { readonly strategy: string; readonly scope?: readonly string[] | null } | null;
  };
}
```

```ts
// src/domain/semantics/normalize.ts — the declaration table
export interface FieldDeclaration<TValue> {
  readonly declaredDefault: TValue;
  readonly nullHasDomainMeaning: boolean;
}
export const FIELD_DECLARATIONS = {
  "actor.identityRef":             { declaredDefault: null,    nullHasDomainMeaning: true  },
  "entryPoint.query":              { declaredDefault: null,    nullHasDomainMeaning: true  },
  "entryPoint.fragment":           { declaredDefault: null,    nullHasDomainMeaning: true  },
  "checkpoints.ordered":           { declaredDefault: false,   nullHasDomainMeaning: false },
  "variable.constraints":          { declaredDefault: {},      nullHasDomainMeaning: false },
  "variable.secretReferenceId":    { declaredDefault: null,    nullHasDomainMeaning: true  },
  "variable.nonSensitiveExample":  { declaredDefault: null,    nullHasDomainMeaning: false },
  "action.target":                 { declaredDefault: null,    nullHasDomainMeaning: false },
  "action.value":                  { declaredDefault: null,    nullHasDomainMeaning: false },
  "checkpoint.afterAction":        { declaredDefault: null,    nullHasDomainMeaning: false },
  "declaration.description":       { declaredDefault: null,    nullHasDomainMeaning: false },
  "readinessIntent.isolation":     { declaredDefault: null,    nullHasDomainMeaning: true  },
  "isolation.scope":               { declaredDefault: {},      nullHasDomainMeaning: false },
} as const;

export function resolveDeclared<T>(raw: T | null | undefined, d: FieldDeclaration<T | null>): T | null;
export function normalize(source: SemanticSource): SemanticBundle;

// src/domain/semantics/project.ts
export function project(source: SemanticSource): SemanticProjection;

// src/domain/semantics/equal.ts
export function projectionsEqual(a: SemanticProjection, b: SemanticProjection): boolean;
export function isMigrationEquivalent(source: SemanticProjection, target: SemanticProjection): boolean;
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit — `equal.test.ts` | Migration equivalence (equivalent + non-equivalent), reflexivity, `-0 === 0`, keyed vs ordered checkpoints never equal | Hand-written literal projections; no dependency on `project` |
| Unit — `normalize.test.ts` | `resolveDeclared` across the table, keying from array *and* object form, id/key mismatch and duplicate throw | Table-driven `it.each` over `FIELD_DECLARATIONS` |
| Unit — `project.test.ts` | Full-bundle inclusion; exclusion of identities/address/schema version/approval metadata/artifact refs/secret contents/runtime values/setup mechanics/readiness results; ordered vs default-keyed checkpoints | One rich fixture carrying excluded fields; assert the projection's key set equals the ten allowed keys and deep-scan for excluded tokens |
| Property — `project.properties.test.ts` | Keyed-order insensitivity; omitted == explicit default; null only where declared | `fc.assert(fc.property(...))` inside `it`, runner-agnostic |
| Architecture (existing) | `src/domain/semantics/` imports nothing external | `tests/architecture/boundaries.test.ts` stays green; `npm run lint` exits 0 |

Concrete fast-check patterns:

1. **Keyed-order insensitivity** — `fc.uniqueArray(arbVariable, { selector: v => v.name }).chain(entries => fc.tuple(fc.constant(entries), fc.shuffledSubarray(entries, { minLength: entries.length, maxLength: entries.length })))`, then assert `projectionsEqual(project(withVariables(a)), project(withVariables(b)))`.
2. **Omitted == explicit default** — one arbitrary emits the omitted form and derives the explicit form by writing each `FIELD_DECLARATIONS[path].declaredDefault` at `path`; assert the two projections are equal. Table-driven, so a new field is covered automatically.
3. **Null only where declared** — `fc.constantFrom(...Object.keys(FIELD_DECLARATIONS))` × `arbSource()`; set the path to `null`, then assert the projected value is `null` when `nullHasDomainMeaning`, else deep-equals `declaredDefault`. Path get/set helpers live in `arbitraries.ts`, never in `src/`.

### Strict-TDD ordering (RED first, for `sdd-tasks`)

1. RED `equal.test.ts` → GREEN minimal `types.ts` + `equal.ts` + barrel. `types.ts` emits nothing at build, so it is introduced in the GREEN step of the first test that needs it; it is never untested production code.
2. RED `normalize.test.ts` defaults/null → GREEN `FieldDeclaration`, `FIELD_DECLARATIONS`, `resolveDeclared`.
3. RED `normalize.test.ts` keying + duplicate/mismatch guard → GREEN `toKeyed` + part normalizers.
4. RED `project.test.ts` **inclusion** → GREEN a deliberately naive `project` that *copies the source*.
5. RED `project.test.ts` **exclusion** → this must fail against step 4's copy; GREEN converts `project` to the allowlist. **Trap: writing the allowlist at step 4 makes the exclusion test pass on arrival, which proves nothing.**
6. RED ordered-vs-keyed checkpoint tests → GREEN the checkpoint union branch.
7. Install `fast-check` (devDependency), then RED the three properties → GREEN. **A property that passes on first run must be validated by temporarily reverting the corresponding normalizer and confirming it fails; do not ship a vacuous property.**

All tests import through `src/domain/semantics/index.js`, so the barrel is exercised everywhere and needs no dedicated suite.

## Threat Matrix

N/A — no routing, shell command, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary. This slice is pure in-process TypeScript with no I/O, no npm import in `src/`, and no runtime dependency.

## Migration / Rollout

No migration required. Purely additive: no consumer exists yet, no persisted data, no runtime dependency. Rollback per the proposal (restore `index.ts` to `export {};`, delete the new files, revert `package.json`/`package-lock.json`, `npm ci`).

## Open Questions

- [ ] None blocking. Two items are deliberately deferred, not unresolved: the `pharos.beacon-semantics/N` → `SemanticSource` interpreter (future `application/` change, which must uphold the already-validated precondition), and constraint-kind vocabulary governance (schema-owned by design).
