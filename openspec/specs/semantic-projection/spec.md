# Semantic Projection Specification

## Purpose

Pharos binds approval to semantics, not to file bytes. This capability provides the pure-domain type model, normalization, and schema-independent projection that turn a schema-validated contract into a `SemanticBundle`, plus the structural-equality predicate that implements migration equivalence (lifecycle spec §5). No hashing, port, or runtime dependency belongs to this capability.

## Requirements

### Requirement: Projection Inclusion

The system MUST project a schema-validated contract into a `SemanticBundle` containing only: purpose, actor, entry point, ordered journey actions, checkpoints (keyed by default, ordered only when explicitly declared ordered), keyed variables (name, classification, constraints, secret-reference IDs, non-sensitive examples), keyed outcomes, allowed variation, prohibited regressions, and the stateful/stateless classification with its deterministic isolation/reset intent.

#### Scenario: Full bundle projection

- GIVEN a schema-validated contract declaring purpose, actor, entry point, ordered actions, keyed checkpoints, variables, outcomes, allowed variation, prohibited regressions, and readiness intent
- WHEN it is projected
- THEN the resulting `SemanticBundle` MUST contain exactly those fields in normalized form

#### Scenario: Explicitly ordered checkpoints preserved as ordered

- GIVEN a contract declaring its checkpoints ordered
- WHEN it is projected
- THEN the checkpoints MUST appear as an ordered sequence in the projection

#### Scenario: Default keyed checkpoints

- GIVEN a contract that does not declare its checkpoints ordered
- WHEN it is projected
- THEN the checkpoints MUST appear as a keyed, order-insensitive collection

### Requirement: Projection Exclusion

The system MUST NOT include in the `SemanticBundle`: Project/Beacon/draft/version identities, local addresses/titles, contract schema versions, approval/lifecycle metadata, supporting-artifact references, secret contents, runtime-resolved values, setup mechanics, or readiness-validation results.

#### Scenario: Excluded fields dropped

- GIVEN a schema-validated contract carrying identity fields, local address/title, schema version, approval metadata, supporting-artifact references, secret contents, runtime-resolved values, setup mechanics, and readiness-validation results alongside semantic fields
- WHEN it is projected
- THEN none of the excluded fields MUST appear anywhere in the resulting `SemanticBundle`

### Requirement: Normalization Before Comparison

The system MUST resolve declared defaults before normalization, MUST treat an omitted value and its explicit declared default as equivalent, and MUST preserve `null` as distinct only where a field's declaration gives `null` domain meaning. Keyed collections MUST compare by logical identity regardless of document order; ordered collections MUST preserve declared order.

#### Scenario: Omitted equals explicit default

- GIVEN two contracts identical except one omits a field with a declared default and the other states that default explicitly
- WHEN both are projected
- THEN the two projections MUST be equal

#### Scenario: Null preserved only where declared

- GIVEN a field whose declaration gives `null` domain meaning, set to `null`, and a second field without such a declaration also set to `null`
- WHEN projected
- THEN the first `null` MUST be preserved distinctly and the second MUST resolve per its declared default

#### Scenario: Keyed reordering does not change projection

- GIVEN two contracts differing only in the document order of a keyed collection's entries
- WHEN both are projected
- THEN the resulting projections MUST be equal

### Requirement: Migration Equivalence

The system MUST implement migration equivalence as exact structural equality between two normalized `SemanticBundle` projections: source interpreted via its schema, target interpreted via its schema, both normalized, and equality decided without hashing or I/O.

#### Scenario: Equivalent migration

- GIVEN a source contract and a target contract expressing the same schema-independent meaning under different schemas
- WHEN each is interpreted via its own schema and projected
- THEN the equality predicate MUST report true, preserving approval per lifecycle §5

#### Scenario: Non-equivalent migration

- GIVEN a source projection and a target projection differing in any included field
- WHEN compared
- THEN the equality predicate MUST report false, requiring a new draft

### Requirement: Domain Purity

The implementation MUST live entirely under `src/domain/semantics` and MUST NOT import any external package or any `node:*` built-in module.

#### Scenario: Boundary lint stays green

- GIVEN the implementation of `src/domain/semantics`
- WHEN `npm run lint` runs
- THEN it MUST exit 0 with no boundary violations reported for that directory

### Requirement: Property-Based Coverage

The three pure-domain properties — keyed-order insensitivity, omitted-equals-default equivalence, and null-only-where-declared — MUST be verified with property-based tests using `fast-check` as a devDependency.

#### Scenario: Property suites pass

- GIVEN the fast-check property suites for keyed-order insensitivity, omitted/default equivalence, and null-only-where-declared
- WHEN `npm test` runs
- THEN all three properties MUST pass across generated inputs
