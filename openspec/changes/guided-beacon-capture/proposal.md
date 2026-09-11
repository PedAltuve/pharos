# Guided Beacon Capture

> **Status:** Planned. This proposal describes a future milestone; it does not claim these commands or capabilities are implemented.

## Intent

Deliver the first end-to-end workflow that turns a human-recorded browser journey into one persisted, inspectable, `open` Beacon draft:

```text
pharos init
  → pharos capture record
  → pharos capture annotate <capture-id>
  → pharos beacon inspect <beacon-id>
```

Playwright Inspector/codegen provides the human capture experience. Guided CLI annotation supplies the tool-neutral meaning that becomes authoritative Beacon content. Capture commands remain under the `capture` namespace because no Beacon exists before successful annotation; that command returns the newly created Beacon ID for inspection.

## Current gap

Pharos already has Beacon lifecycle semantics, canonical semantic projection and hashing, and filesystem draft persistence. It does not yet connect those capabilities to a usable product workflow: project context, secure recorder capture, guided annotation, runtime validation, capture-to-draft association, inspection, and the corresponding CLI commands are missing.

As a result, an operator cannot currently record a journey and finish with a persisted Beacon draft without constructing the surrounding data and integrations manually.

## Target users and situations

This milestone serves an operator defining a browser journey against a running `local`, `test`, or `staging` application. The operator needs the recorder for concrete interaction capture, then a guided flow for expressing purpose, actor, actions, checkpoints, outcomes, variation, prohibited regressions, variables, and state-isolation intent without encoding Playwright details into the Beacon.

Production capture is not supported.

## Scope

### In scope

- Initialize stable Pharos project context for repository or external test modes without modifying an external target repository.
- Record a browser journey through Playwright Inspector/codegen and persist its capture lifecycle as supporting data.
- Require secret sources to be declared before recording; write raw output to restrictive staging, scan it after recorder exit, and promote it only when the scan passes.
- Retain only non-sensitive rejection metadata when sensitive data is detected, deleting rejected staged bytes.
- Guide the operator through complete, tool-neutral semantic annotation and validate it before draft creation.
- Make annotation the sole draft-creation authority boundary.
- Create exactly one revision-1 `open` Beacon draft through the existing Beacon persistence and semantic hash contracts.
- Inspect the draft, its semantic hash, and its capture association while clearly labeling capture data as supporting and non-authoritative.
- Provide actionable outcomes for missing context, unsupported environments, recorder failure or interruption, invalid annotation, and rejected sensitive capture.

### Out of scope

- Beacon approval or approval workflows, revocation UI, and readiness claims.
- Agent handoff or task packaging.
- Generated tests, journey execution, evidence collection, or verification.
- MCP integration.
- Writing markers, configuration, tests, or other files into a target repository when operating in external mode.
- Treating raw recorder output, selectors, Playwright types, absolute paths, or resolved secret values as canonical semantics.

## Capabilities and spec deltas

| Planned capability | Delta |
|---|---|
| Project context initialization | Add a user-visible initialization contract for stable project identity, explicit non-production environment classification, target URL, and repository/external mode. |
| Secure guided recording | Add a capture-session lifecycle around Playwright Inspector/codegen, including predeclared secret sources, restrictive staging, post-exit scanning, promotion on pass, and safe rejection on detection. |
| Guided semantic annotation | Add a validated questionnaire that maps human answers to the existing tool-neutral semantic model and creates an `open` draft only after the semantic core is complete. |
| Beacon draft inspection | Add a read-only view of the persisted open draft, semantic hash, and capture association, with explicit authority labels and no implication of approval or verification. |
| Existing Beacon semantics and storage | Reuse the existing semantic projection/hash and `FsBeaconStore` draft contracts without adding recorder data to `SemanticSource`, its hash, or BeaconStore ownership. |

The resulting delta specs should define observable behavior and authority boundaries. Prompt mechanics, schema library choice, process abstractions, storage layout details, and command composition belong in design unless already constrained by the confirmed security and product decisions above.

## User-visible success criteria

- From a fresh Pharos home and a running non-production target, `pharos init` persists project context, reports a stable project ID, and leaves an external target repository unchanged.
- `pharos capture record` opens Playwright Inspector/codegen, returns a capture ID, and records a recoverable capture session; recording alone does not create a Beacon draft.
- A passing sensitivity scan promotes the raw recording as supporting data. A detection rejects the capture, deletes staged bytes, retains only non-sensitive rejection metadata, and gives the operator a clear rerun path.
- `pharos capture annotate <capture-id>` rejects incomplete semantics, literal secret values, and invalid state-isolation input. Valid annotation creates exactly one persisted revision-1 `open` draft with a semantic hash and returns its Beacon ID.
- `pharos beacon inspect <beacon-id>` shows the open draft's semantic content, identifiers, revision, hash, and capture association while identifying the recording as non-authoritative.
- The completed journey ends with one persisted open Beacon draft and never reports approval, task readiness, generated tests, evidence, execution, or verification.
- Missing context, production configuration, unavailable recorder prerequisites, recorder failure, and interruption return actionable non-success outcomes without creating an approved Beacon.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Recorder output captures sensitive values. | Predeclare secret sources; isolate raw bytes in restrictive staging; scan only after exit; promote only on pass; delete rejected bytes and retain only non-sensitive metadata. |
| Recorder artifacts are mistaken for canonical intent. | Keep capture storage and associations outside `SemanticSource`, semantic hashing, and BeaconStore; label them supporting/non-authoritative in inspection. |
| Partial or inferred semantics create misleading drafts. | Create no draft during recording; require complete, validated, human-authored tool-neutral annotation before draft creation. |
| Failure or interruption leaves ambiguous state. | Persist an inspectable capture lifecycle and return a clear status and next action without implying success. |
| Project association modifies an external repository. | Keep external association application-owned and require explicit project selection when path association is unavailable. |
| The milestone exceeds the 400-line review budget. | Deliver it as a stacked milestone with bounded review slices; intermediate slices must not claim the product outcome is usable. |
| Base CLI work changes underneath this milestone. | Build on the pinned runnable CLI dependency and keep this proposal separate from the existing runnable-CLI change. |

## Rollback

The milestone can be rolled back by withdrawing the new command surfaces and capture/project integrations while leaving existing Beacon domain, semantic hashing, and `FsBeaconStore` contracts unchanged. Any drafts already created remain ordinary valid `open` drafts; supporting capture data remains non-authoritative and can follow its own retention policy. The proposal introduces no approval-state migration and no required modification to target repositories.

## Dependencies

- Runnable CLI base at commit `a6d9f70`. This milestone depends on that head and must not modify the existing runnable-CLI change.
- Existing Beacon lifecycle, semantic projection/hash, and `FsBeaconStore` behavior.
- A usable Playwright Inspector/codegen runtime and browser installation for human capture.
- A running supported non-production target.
- Repository evidence in `explore.md`; external research was explicitly unselected.

## Likely affected areas

- CLI command tree, user-facing output, and failure mapping.
- Application orchestration for initialization, recording, annotation, and inspection.
- Project-context and capture-session persistence owned outside BeaconStore.
- Playwright recorder integration and process lifecycle handling.
- Guided prompts, runtime input validation, and semantic mapping.
- Integration with existing semantic hashing and filesystem Beacon draft persistence.
- Focused command, persistence, validation, failure-path, and security tests during implementation.

These are impact areas, not low-level implementation commitments.

## Delivery framing

Treat this as one `stacked-to-main` product milestone whose only usable outcome is the completed `init → capture record → capture annotate → beacon inspect` journey. Each intermediate PR is an internal, dependency-ordered review unit, not a releasable claim that guided Beacon capture works. The maintainer explicitly accepted `size:exception` for all seven cohesive slices after the honest task forecast exceeded the review budget.
