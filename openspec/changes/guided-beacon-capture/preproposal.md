# Pre-proposal state: Guided Beacon Capture

## Confirmed product decisions

- Outcome: deliver a real persisted Beacon draft through `pharos init → pharos capture record → pharos capture annotate <capture-id> → pharos beacon inspect <beacon-id>`.
- Capture UX: Playwright Inspector/codegen followed by guided semantic annotation in the CLI.
- Authority boundary: raw recording is supporting data; only validated tool-neutral semantic input enters the Beacon draft and semantic hash.
- Non-goals: approval, agent handoff, generated tests, execution, evidence, and verification.
- Method: SDD/OpenSpec, automatic phase execution after product decisions are confirmed.

## Repository evidence

- Repository-only exploration is complete in `explore.md`.
- Existing Beacon domain, semantic projection/hash, and `FsBeaconStore` are implemented.
- Application services, project context, CaptureStore, prompt/schema adapters, Playwright integration, and product CLI commands are missing.
- Native SDD status recommends `propose` with no native blockers.

## Resolved pre-proposal decisions

1. **Research is unselected.** Repository evidence is sufficient; no external evidence lane blocks proposal.
2. **Sensitive recordings use staging with a promotion gate.** Before recording, the operator declares secret sources. Raw output is created under restrictive staging permissions, scanned after recorder exit, and promoted to supporting storage only when it passes. Detection rejects promotion, deletes the staged raw file, and retains non-sensitive rejection metadata so the operator can rerun. No staged or rejected bytes enter `SemanticSource`, the semantic hash, or BeaconStore.
3. **Delivery is one stacked milestone using `stacked-to-main`.** The maintainer chose sequential integration of dependency-ordered internal slices into `main`, while deferring the public usability claim until the final slice completes `init → capture record → capture annotate → beacon inspect`. Honest task estimates showed that every cohesive slice exceeds 400 lines, and the maintainer explicitly accepted `size:exception` for all seven slices before apply.
4. **Entity-correct command vocabulary.** Capture operations use the `capture` namespace because only a CaptureSession exists before annotation. Successful annotation creates the first Beacon draft and returns the Beacon ID used by `beacon inspect`.

## Proposal gate

`status: ready`

Product decisions are confirmed, evidence references are repository-local and valid, research is unselected, and OpenSpec is ready for `sdd-proposal`.
