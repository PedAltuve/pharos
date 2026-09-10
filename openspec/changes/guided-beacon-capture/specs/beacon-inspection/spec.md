# Beacon Draft Inspection Specification

## Purpose

Expose the resulting open Beacon draft and its lineage without changing state or implying approval or verification.

## Requirements

### Requirement: Inspect an Open Draft Read-Only

The command MUST be exactly `pharos beacon inspect <beacon-id>` and MUST display the persisted Beacon semantic content, Beacon ID, revision, status, semantic hash, and associated capture ID without mutating the Beacon or capture.

#### Scenario: Inspect created draft

- GIVEN a Beacon created by successful annotation
- WHEN the operator inspects its Beacon ID
- THEN the command shows revision 1, status `open`, semantic hash, authoritative semantic content, and capture association

#### Scenario: Unknown Beacon

- GIVEN an unknown Beacon ID
- WHEN inspection is requested
- THEN the command returns an actionable not-found outcome and changes nothing

### Requirement: Label Authority and Non-Goals Explicitly

Inspection MUST identify Beacon semantic content as authoritative for the draft and raw capture data as supporting and non-authoritative, and MUST NOT report approval, readiness, generation, execution, evidence, or verification.

#### Scenario: Human inspection

- GIVEN a persisted open draft with an associated capture
- WHEN a human views inspection output
- THEN authority labels are visible and no excluded lifecycle claim is presented

#### Scenario: JSON inspection

- GIVEN JSON or noninteractive inspection mode
- WHEN inspection succeeds
- THEN the structured result includes explicit status and authority fields and omits approval or verification claims

### Requirement: Inspection Is Idempotent and Cancellation-Safe

Repeated inspection MUST return the same persisted identifiers and hash, and cancellation or interruption during inspection MUST leave the Beacon and capture unchanged.

#### Scenario: Repeated inspection

- GIVEN an unchanged open draft
- WHEN it is inspected multiple times
- THEN each result reports the same Beacon ID, revision, status, hash, and capture ID

#### Scenario: Inspection is interrupted

- GIVEN an inspection in progress
- WHEN the operator cancels it
- THEN the command returns a non-success interruption outcome and performs no mutation
