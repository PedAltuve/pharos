# Delta for Project Toolchain

## MODIFIED Requirements

### Requirement: Directory Skeleton Matches Design

The system MUST create exactly the architectural module directories and top-level module roots specified in `docs/technical-design-v1.md` §2: `src/domain/{beacon,semantics,verification,evidence,staleness,ports}`, `src/application`, `src/adapters/{fs-beacon-store,fs-evidence-store,playwright,engram-discovery,hashing}`, `src/cli`, and `src/shared`. This requirement governs directory placement and MUST NOT require modules or their barrel files to remain placeholders once they contain ratified Slice A or Slice B behavior.
(Previously: The exact adapter skeleton did not include `src/adapters/hashing/`, and the requirement incorrectly required every skeleton file to remain a placeholder barrel.)

#### Scenario: Architectural module directories match the ratified design

- GIVEN the repository at the ratified Slice A base with the Slice B hashing amendment
- WHEN the `src/` tree is compared against `docs/technical-design-v1.md` §2
- THEN every listed architectural module directory exists, including `src/adapters/hashing/`, and no extra architectural module directory or top-level module root exists

#### Scenario: Existing module barrels may expose ratified behavior

- GIVEN a module directory containing ratified Slice A or Slice B implementation
- WHEN its `index.ts` barrel is inspected
- THEN the barrel MAY export that module's ratified public behavior, while hexagonal dependency boundaries remain enforced
