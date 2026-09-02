# Archive Report: Semantic Projection Hashing

## Status

**PASS** — change archived after successful canonical OpenSpec sync.

## Artifacts read

- `proposal.md`
- `specs/semantic-projection-hashing/spec.md`
- `specs/project-toolchain/spec.md`
- `design.md`
- `tasks.md`
- `apply-progress.md`
- `verify-report.md`
- `sync-report.md`
- `state.yaml`
- `openspec/config.yaml`
- current canonical specs under `openspec/specs/`

## Sync

- New canonical spec: `openspec/specs/semantic-projection-hashing/spec.md`
- Modified canonical spec: `openspec/specs/project-toolchain/spec.md`, requirement `Directory Skeleton Matches Design`
- ADDED capability: `semantic-projection-hashing`
- MODIFIED requirement: `project-toolchain / Directory Skeleton Matches Design`
- REMOVED requirements: none
- Same-domain active change warnings: none found
- Destructive merge approval: not applicable; no REMOVED requirements or large replacement beyond the explicitly requested ratified requirement

## Completion and verification

- Persisted implementation tasks: 23/23 complete; no unchecked `- [ ]` implementation task boxes remain.
- Verification: PASS, 7/7 requirements, 12/12 scenarios.
- Evidence revision: `sha256:84dd445b0b973643f1d5d417f6d024903f1b15f7dd96754e7665a2df57cbed80`
- Focused adapter tests: 5/5; full suite: 79/79; all five npm scripts passed.
- One non-blocking suggestion remains: redundant adapter-local canonicalizer retyping. Existing ESLint boundaries deprecation warnings are pre-existing.
- Receipt-driven review was opt-in and was not enabled.

## Status and action context

- Artifact store: hybrid; OpenSpec authoritative, Engram mirror.
- Active change: `semantic-projection-hashing`; archive ready; no blocked reasons.
- Workspace: isolated authorized worktree `/home/pedro/pharos-worktrees/semantic-projection-hashing`.
- No implementation, test, package, docs outside the ratified change surfaces, frozen Slice A files, predecessor artifacts, or main workspace were altered.

## Delivery decision

The pre-decision staged snapshot contained 1,212 changed lines: 166 implementation lines, 12 generated lockfile lines, and approximately 1,034 OpenSpec/archive lines. After the `ask-on-risk` guard surfaced this post-archive total, the operator explicitly approved `size:exception` to preserve the ratified single-PR delivery.

## Archive path

`openspec/changes/archive/2026-09-02-semantic-projection-hashing/`
