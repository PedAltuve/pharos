# Guided Semantic Annotation Specification

## Purpose

Turn a human-authored, tool-neutral annotation of a promoted capture into exactly one ordinary open Beacon draft through the existing semantic and draft contracts.

## Requirements

### Requirement: Require a Promoted Capture and Complete Semantic Core

`pharos capture annotate <capture-id>` MUST resolve the capture by ID, require a terminal `promoted` capture and valid project context, and collect complete tool-neutral meaning for purpose, actor, actions, checkpoints, outcomes, variation, prohibited regressions, variables, and state-isolation intent.

#### Scenario: Missing or rejected capture

- GIVEN an unknown, interrupted, failed, or sensitive-rejected capture ID
- WHEN annotation is requested
- THEN the command returns an actionable non-success outcome and creates no Beacon

#### Scenario: Incomplete annotation

- GIVEN a promoted capture and omitted required semantic answers
- WHEN annotation is submitted
- THEN validation reports the missing semantics and no Beacon draft is created

### Requirement: Validate Human Input Before Draft Creation

The system MUST reject literal secret values and invalid state-isolation input, and MUST validate the semantic result before invoking draft creation.

#### Scenario: Literal secret appears in annotation

- GIVEN an annotation containing a resolved secret value
- WHEN validation runs
- THEN annotation is rejected, the value is not persisted into semantic content, and no Beacon is created

#### Scenario: Invalid isolation input

- GIVEN state-isolation input that violates the accepted contract
- WHEN annotation is submitted
- THEN the command returns a specific validation refusal and creates no Beacon

### Requirement: Annotation Is the Sole Beacon-Creation Boundary

Successful annotation MUST create exactly one revision-1 `open` Beacon draft using the existing Beacon semantic projection, hash, and draft persistence contracts; recording, scanning, and inspection MUST NOT create drafts.

#### Scenario: Valid annotation creates the first draft

- GIVEN one promoted capture and a complete valid tool-neutral annotation
- WHEN annotation succeeds
- THEN exactly one persisted Beacon draft is created with revision 1 and status `open`, its semantic hash is returned with the Beacon ID, and the capture association is supporting metadata

#### Scenario: Repeated annotation is retried

- GIVEN a successful annotation request is retried with the same capture and request identity
- WHEN the retry is processed
- THEN it returns the existing Beacon identity and does not create a second revision-1 draft

#### Scenario: Conflicting retry

- GIVEN an existing successful annotation identity
- WHEN a retry supplies different semantic input
- THEN the retry is refused as a conflict and the existing Beacon remains unchanged

### Requirement: Preserve Authority and Scope Boundaries

The created Beacon semantic content MUST contain human-authored tool-neutral meaning only; it MUST NOT contain raw recorder data, selectors, Playwright types, absolute paths, or resolved secret values, and the workflow MUST NOT claim approval, readiness, execution, evidence, or verification.

#### Scenario: Forbidden recorder details are supplied as annotation input

- GIVEN an annotation includes a recorder-specific selector, Playwright type, or absolute path
- WHEN semantic validation runs
- THEN validation refuses the annotation, reports that the input is forbidden, and creates no Beacon; caller input MUST NOT be silently stripped into a draft

### Requirement: Support Interactive and Noninteractive Annotation

Interactive mode MUST guide the operator through required semantic answers, while JSON or noninteractive mode MUST accept explicit complete input and return stable machine-readable validation or success data without prompting. The command MUST be exactly `pharos capture annotate <capture-id>`.

#### Scenario: Noninteractive input is complete

- GIVEN explicit valid noninteractive annotation input
- WHEN `pharos capture annotate <capture-id>` runs
- THEN it returns structured Beacon ID, revision, status, hash, and capture association

#### Scenario: Noninteractive input is incomplete

- GIVEN noninteractive annotation missing a required field
- WHEN annotation runs
- THEN it returns structured validation errors and creates no Beacon
