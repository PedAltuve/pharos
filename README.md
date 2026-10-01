# Pharos

**Product vision — human-guided, agent-assisted browser testing.** Pharos is intended to let a developer demonstrate a journey, preserve its approved meaning as an immutable **Beacon**, and let coding agents create durable Playwright tests without authority to redefine product intent.

> Pharos is the lighthouse. A Beacon is the trusted signal.
>
> **Current milestone:** for non-production projects, the CLI prepares and inspects Beacon consent; the local Pi adapter presents the exact request to a human in its TUI and completes approval or revocation. Readiness, handoff, generation, execution, evidence, repair, and verification are unavailable.

## Why

A coding agent can click through an application and produce a browser test, but it cannot safely decide which observed details express product intent and which are incidental. A journey that succeeds once is not proof of repeatability either. Pharos separates the two things agents conflate:

| Humans own in the product vision | Agents would execute in the product vision |
|---|---|
| Intent, demonstration, approval | Test specification and generation |
| What must remain true | Controlled, repeatable verification |
| Reviewing meaningful changes | Failure diagnosis and classification |

## How it works

The implemented boundary stops at the Beacon lifecycle: initialize a project, record and annotate a supporting capture, inspect the `open` draft, prepare consent, obtain a human decision in Pi, inspect consent and Beacon status, and optionally revoke through the same consent flow. Handoff, generated tests, and repeatable verification are future product goals.

Product design rules include:

- Approved Beacons are operator-confirmed immutable versions and are never updated silently.
- Exploration would not constitute verification; repeatable tests with explicit assertions would be required.
- Agents would modify designated test artifacts only, never application code.
- No loop-until-green: bounded classification and at most one repair.

## Status

**Host-relayed Beacon lifecycle for non-production projects.** Pharos can initialize a local project context, record a supporting capture, annotate it into one revision-1 `open` draft, and prepare approval or revocation for a human Pi TUI decision. The capture is supporting and non-authoritative; an approved immutable Beacon version is the active authority.

| Milestone | State |
|---|---|
| Product, domain, and lifecycle specifications | ✅ Done ([docs/](docs/)) |
| Technical design | ✅ Done ([docs/technical-design-v1.md](docs/technical-design-v1.md)) |
| Toolchain + hexagonal skeleton | ✅ Done |
| Guided non-production approval, status, and revocation lifecycle | ✅ Done |
| Readiness/handoff/generation/execution/evidence/repair/verification | Explicitly unavailable |

## Command line

The supported sequence (replace IDs with the returned values; choose a fresh `req_` ID for each action) is:

```text
pharos init
pharos capture record
pharos capture annotate <capture-id>
pharos beacon inspect <beacon-id>
pharos beacon prepare approve <beacon-id> --request-id <req_id> --format json
/pharos-consent <req_id>                         # human in interactive Pi TUI
pharos beacon consent-status <req_id> --format json
pharos status <beacon-id> --format json
pharos beacon prepare revoke <beacon-id> --request-id <new_req_id> --reason "Reason for revocation" --format json
/pharos-consent <new_req_id>                     # human in interactive Pi TUI
pharos beacon consent-status <new_req_id> --format json
pharos status <beacon-id> --format json
```

Run `pharos` commands through the local CLI; enter `/pharos-consent` in Pi, not in a shell. Preparation returns `host-decision-required` and the public exact binding, not authority. Pi displays that binding and offers fixed **Approve** / **Decline** choices; it refuses non-TUI use. Inspect consent status after the decision or an uncertain outcome before taking further action. Decline never mutates Beacon authority.

`init` accepts only non-production project contexts and stores Pharos-owned context, capture, association, and Beacon data under the selected Pharos home. It does not mutate the target repository. Promoted supporting capture artifacts are retained; this milestone provides no automatic retention cleanup.

`capture record` requires an explicit secret declaration before recording: use one or more `--secret-source env:NAME` values or explicitly pass `--no-secret-sources`. Real recording is interactive: it requires a TTY plus the separately installed Playwright browser prerequisite. The default test suite is hermetic and does not launch a browser, contact a target, or run the opt-in Playwright contract probe.

Use non-interactive JSON input for initialization and annotation. A promoted capture alone creates no Beacon; annotation creates one revision-1 `open` draft, which `beacon inspect` returns together with its supporting/non-authoritative capture association.

Approval binds the project, Beacon, draft revision and semantic hash to the request. If a draft's origin is stale, preparation proposes the required acknowledgement without granting it; Pi warns that selecting Approve acknowledges the divergence. Revocation binds the expected active version and normalized non-empty reason. `status` is read-only and reports `open-draft`, `active-approved`, `revoked-no-active`, or `no-authority`; readiness, staleness, and verification remain `unavailable`. Revocation clears active authority without reactivating an older version.

The old TTY `beacon approve` / `beacon revoke` routes are not registered in the supported CLI grammar. Historical internal builders do not make them supported commands. No model-callable tool can choose or submit consent; `operator_confirmed` records a host-relayed decision, **not proof of human identity**. Malicious arbitrary same-user shell/process access is outside this protocol's threat model.

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

For the separate, unpublished Pi adapter, see [local build and installation](integrations/pi/README.md); building the root CLI alone does not install it. Neither workflow supports production targets, readiness decisions, handoff, generated tests, execution, evidence, repair, or verification, and neither mutates the target repository. No delivery or commit is implied.

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
