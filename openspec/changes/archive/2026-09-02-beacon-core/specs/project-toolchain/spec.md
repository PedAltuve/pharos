# Delta for Project Toolchain

## MODIFIED Requirements

### Requirement: Directory Skeleton Matches Design

The system MUST create exactly the architectural module directories and top-level module roots specified in `docs/technical-design-v1.md` §2: `src/domain/{beacon,semantics,verification,evidence,staleness,ports}`, `src/application`, `src/adapters/{fs-beacon-store,fs-evidence-store,playwright,engram-discovery,hashing}`, `src/cli`, and `src/shared`. This requirement governs directory placement and MUST NOT require modules or their barrel files to remain placeholders once they contain ratified behavior landed by an accepted change.
(Previously: the wording named only "ratified Slice A or Slice B behavior," which did not cover the Beacon Core capability's `src/domain/beacon/` and `src/shared/` barrels; the requirement is generalized to any accepted change's ratified behavior so it does not need editing again per slice.)

#### Scenario: Architectural module directories match the ratified design

- GIVEN the repository at the ratified Slice A base with the Slice B hashing amendment
- WHEN the `src/` tree is compared against `docs/technical-design-v1.md` §2
- THEN every listed architectural module directory exists, including `src/adapters/hashing/`, and no extra architectural module directory or top-level module root exists

#### Scenario: Existing module barrels may expose ratified behavior

- GIVEN a module directory containing ratified implementation from any accepted change, including `src/domain/beacon/` and `src/shared/` from Beacon Core
- WHEN its `index.ts` barrel is inspected
- THEN the barrel MAY export that module's ratified public behavior, while hexagonal dependency boundaries remain enforced

#### Scenario: Beacon Core lands without adding directories

- GIVEN the Beacon Core change fills `src/domain/beacon/` and `src/shared/` with pure domain code
- WHEN the `src/` tree is compared against `docs/technical-design-v1.md` §2
- THEN no new architectural module directory or top-level module root is added
