# Semantic Projection Hashing Specification

## Purpose

Provide deterministic, opaque fingerprints for JSON-safe semantic projections without coupling the domain to canonicalization, cryptographic algorithms, or runtime APIs.

## Requirements

### Requirement: Opaque Hasher Port

The domain MUST expose a `Hasher` port with the contract `hash(value: JsonValue): string`. The port MUST accept only JSON-safe values and MUST treat the returned string as opaque; it MUST NOT define or require a hash algorithm, canonicalization format, or string prefix.

#### Scenario: Domain hashes a JSON-safe value through the port

- GIVEN a JSON-safe semantic projection and a `Hasher` implementation
- WHEN the domain invokes `hash(projection)`
- THEN it receives a string without depending on the algorithm, prefix, canonicalization library, or runtime APIs

#### Scenario: Frozen Slice A contracts remain unchanged

- GIVEN the existing `SemanticProjection` and `SemanticBundle` contracts from Slice A
- WHEN the hashing capability is added
- THEN neither contract is changed, wrapped, or extended

### Requirement: Real Adapter Produces JCS SHA-256 Fingerprints

The hashing adapter MUST canonicalize each `JsonValue` using the exact-pinned `canonicalize` runtime dependency implementing RFC 8785 JSON Canonicalization Scheme, MUST encode the canonical string as UTF-8 bytes, MUST compute SHA-256 using `node:crypto`, and MUST construct the result as `sha256:<lowercase-hex>` within the adapter only.

#### Scenario: Logically equivalent objects have the same fingerprint

- GIVEN two JSON objects with identical members inserted in different orders
- WHEN each value is passed through the real hashing adapter
- THEN the adapter returns identical `sha256:<lowercase-hex>` strings

#### Scenario: Arrays retain semantic order

- GIVEN two JSON arrays containing the same elements in different orders
- WHEN each array is passed through the real hashing adapter
- THEN the adapter returns different fingerprints when the ordered values differ

#### Scenario: Prefix construction stays outside the domain

- GIVEN the domain `Hasher` port and the hashing adapter
- WHEN their source is inspected
- THEN `sha256:` construction and hexadecimal formatting appear only in the adapter, while the domain exposes only the opaque string contract

### Requirement: RFC 8785 Conformance Vectors

The hashing adapter MUST pass recognized RFC 8785 known-vector tests by hashing the canonical UTF-8 representation through the real adapter.

#### Scenario: RFC 8785 known vector produces the expected digest

- GIVEN an RFC 8785 known JSON input and its expected canonical representation and SHA-256 digest
- WHEN the input is hashed through the real adapter
- THEN the result equals the expected `sha256:<lowercase-hex>` fingerprint

### Requirement: Serialization-Order Stability Through the Real Adapter

The adapter test suite MUST use `fast-check@4.9.0` to verify, through the real canonicalization and cryptographic adapter path, that logically identical JSON values reconstructed through different serialization and object-key insertion orders receive the same fingerprint.

#### Scenario: Property-based reconstruction is stable

- GIVEN generated JSON-safe values containing reorderable object members
- WHEN equivalent values are serialized, parsed, and reconstructed with different key-insertion orders
- THEN the real adapter produces equal fingerprints for every generated case

### Requirement: Separation From Migration Equivalence

The hashing capability MUST NOT change `isMigrationEquivalent`; migration equivalence MUST remain structural equality, including `===` at primitive leaves, and MUST NOT require or invoke a hasher.

#### Scenario: Structural migration comparison remains independent

- GIVEN two semantic projections compared by `isMigrationEquivalent`
- WHEN the comparison runs with no hashing adapter available
- THEN it uses structural equality and completes without invoking a hasher

### Requirement: Boundary and Scope Preservation

The domain/shared import boundaries MUST remain strict: domain code MUST NOT import adapters, Node APIs, or npm runtime dependencies, and adapter-only canonicalization MUST remain exact-pinned. This capability MUST NOT add application, persistence, CLI, approval orchestration, or other out-of-scope wiring, and MUST NOT modify artifacts under `openspec/changes/semantic-projection-core/`.

#### Scenario: Domain boundary remains enforced

- GIVEN the domain port and the hashing adapter
- WHEN dependency-boundary checks run
- THEN domain code has no adapter, Node, or npm runtime imports, and the adapter contains the runtime-specific hashing mechanism

#### Scenario: Out-of-scope Slice A artifacts remain untouched

- GIVEN the completed hashing specification change
- WHEN the change contents are reviewed
- THEN no artifact under `openspec/changes/semantic-projection-core/` or application, persistence, CLI, approval, or migration implementation is changed
