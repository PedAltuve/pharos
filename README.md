# Pharos

**Product vision — human-guided, agent-assisted browser testing.** Pharos is intended to let a developer demonstrate a journey, preserve its approved meaning as an immutable **Beacon**, and let coding agents create durable Playwright tests without authority to redefine product intent.

> Pharos is the lighthouse. A Beacon is the trusted signal.
>
> **Current milestone:** the implemented CLI ends at a non-production revision-1 `open` Beacon draft. Approval, generated tests, execution or evidence collection, and verification are product goals, not current capabilities.

## Why

A coding agent can click through an application and produce a browser test, but it cannot safely decide which observed details express product intent and which are incidental. A journey that succeeds once is not proof of repeatability either. Pharos separates the two things agents conflate:

| Humans own in the product vision | Agents would execute in the product vision |
|---|---|
| Intent, demonstration, approval | Test specification and generation |
| What must remain true | Controlled, repeatable verification |
| Reviewing meaningful changes | Failure diagnosis and classification |

## How it works

The intended product workflow is:

```text
Record journey → annotate intent → approve Beacon (immutable version)
→ hand off tool-neutral contract → agent generates Playwright test
→ execute → classify failures → repair once if proven test defect
→ 1 targeted pass + 3 stability passes = verified
```

That workflow is a product target, not a claim about the current CLI. The implemented guided milestone stops after recording a supporting capture, annotating it into one `open` draft, and inspecting the associated authority-labeled records.

Product design rules include:

- Approved Beacons would be human-owned and never updated silently.
- Exploration would not constitute verification; repeatable tests with explicit assertions would be required.
- Agents would modify designated test artifacts only, never application code.
- No loop-until-green: bounded classification and at most one repair.

## Status

**Guided open-draft journey available for non-production projects.** Pharos can initialize a local project context, record a supporting capture, annotate that promoted capture, and inspect the resulting revision-1 `open` Beacon draft. The capture is supporting and non-authoritative; only the annotated Beacon semantics are authoritative.

| Milestone | State |
|---|---|
| Product, domain, and lifecycle specifications | ✅ Done ([docs/](docs/)) |
| Technical design | ✅ Done ([docs/technical-design-v1.md](docs/technical-design-v1.md)) |
| Toolchain + hexagonal skeleton | ✅ Done |
| Guided non-production open-draft CLI journey | ✅ Done |
| Approval/readiness, generated tests, execution/evidence, and verification claims | Explicitly excluded |

## Command line

The supported public journey is exactly:

```text
pharos init
pharos capture record
pharos capture annotate <capture-id>
pharos beacon inspect <beacon-id>
```

`init` accepts only non-production project contexts and stores Pharos-owned context, capture, association, and Beacon data under the selected Pharos home. It does not mutate the target repository. Promoted supporting capture artifacts are retained; this milestone provides no automatic retention cleanup.

`capture record` requires an explicit secret declaration before recording: use one or more `--secret-source env:NAME` values or explicitly pass `--no-secret-sources`. Real recording is interactive: it requires a TTY plus the separately installed Playwright browser prerequisite. The default test suite is hermetic and does not launch a browser, contact a target, or run the opt-in Playwright contract probe.

Use non-interactive JSON input for initialization and annotation. A promoted capture alone creates no Beacon; annotation creates one revision-1 `open` draft, which `beacon inspect` returns together with its supporting/non-authoritative capture association.

Packaging never triggers a build, so build explicitly before packing or installing locally:

```bash
npm ci
npm run build
```

Run the built entry directly:

```bash
node dist/cli/index.js --help
node dist/cli/index.js --version
```

Or pack and install it into a throwaway project to exercise the real `pharos` shim:

```bash
npm pack
npm install --ignore-scripts ./pharos-0.0.0.tgz
npx pharos --version
```

This CLI does not provide approval or readiness decisions, generated tests, execution or evidence collection, or verification claims.

## Development

Requires Node.js >= 20.

```bash
npm ci
npm test        # vitest run
npm run build   # tsc
npm run lint    # eslint (hexagonal boundaries enforced)
npm run typecheck
```

The architecture is hexagonal and machine-enforced: `src/domain` is pure (no Node builtins, no Playwright), dependencies flow `cli → application → domain`, and `tests/architecture/boundaries.test.ts` proves the lint rule actually fires. Development follows spec-driven development; change history lives under [`openspec/`](openspec/).

## Documentation

| Document | Contents |
|---|---|
| [PHAROS.md](PHAROS.md) | Original product vision and workflow |
| [docs/product-requirements-v1.md](docs/product-requirements-v1.md) | v1 product requirements |
| [docs/domain-requirements-v1.md](docs/domain-requirements-v1.md) | Domain model, invariants, acceptance scenarios |
| [docs/lifecycle-and-schema-specification-v1.md](docs/lifecycle-and-schema-specification-v1.md) | Lifecycle and logical-schema decisions |
| [docs/technical-design-v1.md](docs/technical-design-v1.md) | Stack, module architecture, storage, CLI design |

## License

[MIT](LICENSE)
