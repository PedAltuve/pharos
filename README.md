# Pharos

**Human-guided, agent-assisted browser testing.** A developer demonstrates the intended user journey once, approves its meaning as an immutable **Beacon**, and any coding agent can turn it into durable, repeatable Playwright tests — without the authority to redefine what the product is supposed to do.

> Pharos is the lighthouse. A Beacon is the trusted signal.

## Why

A coding agent can click through an application and produce a browser test, but it cannot safely decide which observed details express product intent and which are incidental. A journey that succeeds once is not proof of repeatability either. Pharos separates the two things agents conflate:

| Humans own | Agents execute |
|---|---|
| Intent, demonstration, approval | Test specification and generation |
| What must remain true | Controlled, repeatable verification |
| Reviewing meaningful changes | Failure diagnosis and classification |

## How it works

```text
Record journey → annotate intent → approve Beacon (immutable version)
→ hand off tool-neutral contract → agent generates Playwright test
→ execute → classify failures → repair once if proven test defect
→ 1 targeted pass + 3 stability passes = verified
```

Core rules:

- Approved Beacons are human-owned and never updated silently.
- Exploration is not verification — only repeatable tests with explicit assertions prove behavior.
- Agents modify designated test artifacts only, never application code.
- No loop-until-green: bounded classification and at most one repair.

## Status

**Early development — not usable yet.** The domain is fully specified and the workspace foundation is in place; the implementation is being built change by change.

| Milestone | State |
|---|---|
| Product, domain, and lifecycle specifications | ✅ Done ([docs/](docs/)) |
| Technical design | ✅ Done ([docs/technical-design-v1.md](docs/technical-design-v1.md)) |
| Toolchain + hexagonal skeleton | ✅ Done |
| Semantic projection and hashing (domain core) | 🔜 Next |
| Beacon/evidence stores, verification engine, CLI, Playwright adapter | Planned |

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
