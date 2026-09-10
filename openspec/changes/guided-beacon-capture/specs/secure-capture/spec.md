# Secure Capture Specification

## Purpose

Record browser interactions as recoverable, supporting capture data while keeping secrets out of promoted artifacts and Beacon semantics.

## Requirements

### Requirement: Record and Resolve a Recoverable Capture Session

The command MUST be exactly `pharos capture record`. It MUST require valid project context, allocate a unique capture ID, and persist that identity with a `running` state before launching the recorder. After recorder exit, post-exit scanning MUST drive the session to a terminal `promoted` or `rejected` result; a successful recorder exit MUST NOT remain as an ambiguous unscanned completion. Failed or interrupted sessions MUST remain inspectable but MUST NOT be eligible for annotation. Recording MUST NOT create a Beacon draft.

#### Scenario: Recorder completes and scan promotes

- GIVEN valid non-production context and available recorder prerequisites
- WHEN the operator completes recording, the recorder exits successfully, and post-exit scanning passes
- THEN Pharos returns the capture ID with terminal `promoted` status and the capture is eligible for annotation

#### Scenario: Recorder prerequisite is unavailable

- GIVEN valid context but an unavailable browser or recorder prerequisite
- WHEN recording starts
- THEN the already-persisted session is marked failed, the command returns an actionable non-success outcome, and no Beacon draft is created

#### Scenario: Recording is interrupted

- GIVEN a persisted `running` capture session
- WHEN the recorder or command is interrupted
- THEN the session is marked interrupted, staged bytes are not promoted, annotation is refused, and no Beacon draft is created

#### Scenario: Scan rejects a completed recording

- GIVEN a recorder session that exited successfully
- WHEN post-exit scanning detects sensitive content or cannot safely promote the raw capture
- THEN the session reaches terminal `rejected` status, annotation is refused, and no Beacon draft is created

### Requirement: Enforce Predeclared Secret Sources and Safe Promotion

The system MUST require secret-source references to be declared before recording, stage raw recorder output restrictively, scan it after recorder exit, and promote it only when the scan passes. Secret-source references MAY be persisted as capture metadata, but resolved secret values MUST exist only transiently for scanning and MUST never be persisted, logged, or returned.

#### Scenario: Scan passes

- GIVEN all secret-source references were declared before recording
- WHEN the raw capture passes the post-exit sensitivity scan
- THEN the capture is promoted as supporting data associated with the capture ID, persisted references remain available for lineage, and resolved secret values are absent from persisted, logged, and returned results

#### Scenario: Secret is detected

- GIVEN a capture containing a detected sensitive value
- WHEN the post-exit scan runs
- THEN Pharos rejects the capture, deletes staged bytes, retains only non-sensitive rejection metadata, exposes no resolved secret value, and gives the operator a clear rerun action

#### Scenario: Secret declaration is late or incomplete

- GIVEN secret sources were not declared before recording or required declaration is incomplete
- WHEN recording is requested
- THEN recording is refused before recorder launch and no capture or Beacon is promoted

### Requirement: Keep Raw Capture Non-Authoritative

Raw recorder data MUST remain supporting data and MUST be excluded from `SemanticSource`, semantic hashing, and BeaconStore-owned Beacon content.

#### Scenario: Capture association is inspected

- GIVEN a promoted capture associated with a Beacon
- WHEN the association is displayed
- THEN the recording is labeled supporting and non-authoritative and cannot alter the Beacon semantic hash

### Requirement: Make Capture Completion and Retry Idempotent

A repeated completion, scan, promotion, or retry for the same capture MUST converge on one capture outcome; conflicting reuse of a capture ID or idempotency key MUST be refused without creating a Beacon.

#### Scenario: Retry interrupted post-exit processing

- GIVEN a capture whose recorder exited successfully but whose post-exit processing did not reach a terminal state
- WHEN the operator retries post-exit processing with the same request identity
- THEN processing resumes or replays to one terminal `promoted` or `rejected` result without duplicating promoted capture data
