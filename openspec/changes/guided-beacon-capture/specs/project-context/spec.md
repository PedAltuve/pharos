# Project Context Specification

## Purpose

Provide stable, explicit context for guided capture without modifying target repositories or allowing production capture.

## Requirements

### Requirement: Initialize Explicit Project Context

The system MUST let an operator initialize and persist a stable project identity, repository or external mode, target URL, and supported non-production environment classification.

#### Scenario: Initialize repository mode

- GIVEN a supported non-production target and a repository project
- WHEN the operator runs `pharos init` with the required project choices
- THEN the system persists project context, reports the stable project ID, and does not create a Beacon

#### Scenario: Initialize external mode without repository mutation

- GIVEN a target repository that is external to the Pharos project
- WHEN the operator initializes external mode
- THEN Pharos persists the association in application-owned context and leaves the target repository unchanged

### Requirement: Reject Unsafe or Ambiguous Context

The system MUST refuse initialization or capture when required context is missing, the environment is production, or the selected target cannot be classified as supported non-production.

#### Scenario: Production is selected

- GIVEN an initialization request classified as production
- WHEN the operator submits it
- THEN the command returns a non-success actionable refusal and persists no capture or Beacon draft

#### Scenario: Missing project selection

- GIVEN no unambiguous project context is available
- WHEN a capture command is requested
- THEN the command returns a non-success request to initialize or explicitly select a project and creates no Beacon

### Requirement: Separate Human and Machine Outcomes

Interactive commands MUST guide a human through required choices and failures, while JSON or noninteractive mode MUST return stable machine-readable success or refusal data without interactive prompts.

#### Scenario: Noninteractive initialization lacks required input

- GIVEN noninteractive mode and an omitted required project choice
- WHEN initialization runs
- THEN it returns a structured refusal identifying the missing input and does not guess a project
