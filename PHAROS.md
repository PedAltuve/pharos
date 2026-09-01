# Pharos

**Pharos** is a human-guided, agent-assisted browser testing workflow.

Its purpose is to let a human demonstrate the intended user experience once, preserve that demonstration as an approved **Beacon**, and let coding agents convert it into durable, repeatable end-to-end tests.

> Pharos is the lighthouse. A Beacon is the trusted signal.

Pharos is designed to work with coding agents such as Codex, Claude Code, OpenCode, Pi, or any other tool capable of reading repository instructions, running shell commands, and using Playwright or browser automation tools.

---

## Core principle

A browser agent clicking through an application once is not sufficient proof that a feature works.

Pharos separates four things:

1. **Human intent** — what the user is trying to accomplish.
2. **Human demonstration** — one approved example of the correct path.
3. **Acceptance contract** — what must remain true even if the interface changes.
4. **Executable verification** — repeatable Playwright tests with explicit assertions.

The target workflow is:

```text
Application discovery
        ↓
Human records Beacon
        ↓
Human annotates intent
        ↓
Agent creates test specification
        ↓
Agent writes durable Playwright tests
        ↓
Playwright executes verification
        ↓
Agent diagnoses failures
        ↓
Human reviews meaningful changes
```

---

# Terminology

## Pharos

The overall workflow and tooling.

Pharos owns:

- Beacon recording
- test specifications
- acceptance contracts
- browser exploration
- executable tests
- verification runs
- evidence collection
- failure classification
- baseline updates

## Beacon

A human-approved example of intended behavior.

A Beacon is not just a raw recording. It contains:

- the recorded journey
- the purpose of the journey
- meaningful checkpoints
- required outcomes
- representative versus required values
- allowed variation
- prohibited regressions

## Journey

The sequence of actions performed by the human.

Example:

```text
Open quote page
Select destination
Choose policy
Enter traveller details
Select deductible
Submit email
Reach confirmation
```

## Acceptance contract

The semantic rules that determine whether the journey still works.

Example:

```yaml
required_outcomes:
  - quote_created
  - price_displayed
  - traveller_details_preserved
  - confirmation_reached

allowed_variation:
  - wording
  - layout
  - non-essential step ordering

prohibited_regressions:
  - hidden_price
  - lost_form_data
  - inaccessible_controls
```

## Evidence

Artifacts produced by a verification run:

- Playwright trace
- screenshots
- video
- console output
- network failures
- test report
- structured result

---

# Recommended repository structure

```text
.pharos/
  config.yaml
  instructions.md

  schemas/
    beacon.schema.json
    test-spec.schema.json
    result.schema.json

  beacons/
    quote-happy-path/
      beacon.yaml
      journey.spec.ts
      acceptance.yaml
      checkpoints.yaml
      trace.zip
      screenshots/

  specs/
    quote-happy-path.yaml

  runs/
    2026-08-06T142700-quote-happy-path/
      result.json
      report.md
      trace.zip
      console.log
      network.json
      screenshots/
      video/

  scripts/
    discover-app
    start-app
    stop-app
    prepare-test-data
    reset-test-data
    record-beacon
    run-test
    run-flake-check
    collect-evidence

tests/
  e2e/
    quote-happy-path.spec.ts

playwright.config.ts
AGENTS.md
CLAUDE.md
```

The `.pharos` directory is the workflow source of truth.

The Playwright test suite remains ordinary test code inside `tests/e2e`.

---

# Initial setup

Install Playwright:

```bash
npm install -D @playwright/test
npx playwright install
```

Optional browser tooling for agents:

- Playwright MCP for browser interaction and accessibility snapshots
- Chrome DevTools MCP for console, network, and performance inspection

Initialize the directory structure:

```bash
mkdir -p \
  .pharos/{schemas,beacons,specs,runs,scripts} \
  tests/e2e
```

---

# Minimal configuration

Create `.pharos/config.yaml`:

```yaml
version: 1

application:
  name: my-app
  base_url: http://localhost:3000
  start_command: bin/dev
  stop_command: null

playwright:
  config: playwright.config.ts
  test_directory: tests/e2e
  browser: chromium
  trace: retain-on-failure
  screenshot: only-on-failure
  video: retain-on-failure

commands:
  prepare_data: .pharos/scripts/prepare-test-data
  reset_data: .pharos/scripts/reset-test-data
  run_test: .pharos/scripts/run-test
  run_flake_check: .pharos/scripts/run-flake-check

selectors:
  priority:
    - role
    - label
    - placeholder
    - text
    - test_id
    - css

verification:
  repeat_critical_tests: 5
  require_trace_on_failure: true
  require_failure_classification: true
  allow_automatic_beacon_updates: false
```

---

# Playwright configuration

Example `playwright.config.ts`:

```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,

  reporter: [
    ["list"],
    ["html", { outputFolder: ".pharos/playwright-report", open: "never" }],
    ["json", { outputFile: ".pharos/latest-result.json" }],
  ],

  use: {
    baseURL: process.env.PHAROS_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
```

---

# Recording a Beacon

A Beacon starts with a human-run Playwright recording.

Example command:

```bash
npx playwright codegen \
  --output .pharos/beacons/quote-happy-path/journey.spec.ts \
  http://localhost:3000/quotes/new
```

The human performs the intended flow and closes the browser when finished.

The resulting recording is only a demonstration. It must not be treated as the final test without review.

After recording, create `.pharos/beacons/quote-happy-path/beacon.yaml`:

```yaml
version: 1

id: quote-happy-path
name: Guest completes a quote
status: approved

purpose:
  A guest user obtains a valid travel insurance quote.

entry_point:
  path: /quotes/new

actor:
  type: guest

recording:
  file: journey.spec.ts
  recorded_by: human
  recorded_at: 2026-08-06T14:27:00+01:00

variables:
  destination:
    recorded_value: Portugal
    classification: representative
    alternatives_allowed: true

  traveller_count:
    recorded_value: 2
    classification: required_scenario
    alternatives_allowed: false

  email:
    recorded_value: e2e-guest@example.test
    classification: test_data
    alternatives_allowed: true

required_outcomes:
  - quote_is_created
  - selected_policy_is_preserved
  - traveller_details_are_preserved
  - calculated_price_is_visible
  - confirmation_is_reached

allowed_variation:
  - button_wording
  - visual_layout
  - non-essential_screen_order

prohibited_regressions:
  - price_hidden_before_submission
  - traveller_data_lost_on_back_navigation
  - inaccessible_form_controls
  - silent_server_error

human_notes:
  - Selecting Portugal is representative; other supported destinations should work.
  - Two travellers is required for this Beacon because it verifies repeated traveller fields.
  - The total price must be visible before collecting the email address.
```

---

# Beacon checkpoints

Create `.pharos/beacons/quote-happy-path/checkpoints.yaml`:

```yaml
version: 1

checkpoints:
  - id: policy-selected
    after_action: select_policy
    expected:
      selected_policy_preserved: true
      next_step_visible: true

  - id: traveller-details-entered
    after_action: complete_traveller_details
    expected:
      traveller_count: 2
      all_required_fields_complete: true

  - id: price-visible
    after_action: select_deductible
    expected:
      calculated_price_visible: true
      price_non_empty: true

  - id: confirmation
    after_action: submit_email
    expected:
      confirmation_visible: true
      quote_persisted: true
```

Checkpoints should represent meaningful product states, not every click.

---

# Acceptance contract

Create `.pharos/beacons/quote-happy-path/acceptance.yaml`:

```yaml
version: 1

contract:
  required_outcomes:
    - quote_is_created
    - calculated_price_is_visible
    - confirmation_is_reached

  invariants:
    - traveller_details_survive_back_navigation
    - selected_policy_remains_selected
    - form_controls_have_accessible_names

  allowed_variation:
    - button_copy
    - visual_spacing
    - page_layout
    - representative_destination

  prohibited:
    - removing_assertions_to_make_the_test_pass
    - force_clicking_through_broken_ui
    - arbitrary_sleep_calls
    - silently_updating_the_beacon
    - accepting_a_single_retry_as_stability
```

---

# Test specification

The agent converts the Beacon into a semantic test specification before writing or modifying test code.

Create `.pharos/specs/quote-happy-path.yaml`:

```yaml
version: 1

id: quote-happy-path
source_beacon: quote-happy-path
priority: critical

scope:
  include:
    - guest_quote_flow
    - repeated_traveller_fields
    - price_visibility
    - browser_back_navigation

  exclude:
    - payment
    - production_email_delivery

preconditions:
  - application_running
  - active_policy_exists
  - prices_exist_for_destination
  - test_database_reset

steps:
  - action: visit
    target: /quotes/new

  - action: select_destination
    value: representative_supported_destination

  - action: select_policy
    value: valid_active_policy

  - action: select_traveller_count
    value: 2

  - action: enter_traveller_details
    value: valid_test_data

  - action: select_deductible
    value: valid_option

  - action: assert_price_visible

  - action: navigate_back

  - action: assert_traveller_details_preserved

  - action: continue_forward

  - action: submit_email
    value: e2e-guest@example.test

assertions:
  - quote_created
  - policy_preserved
  - traveller_details_preserved
  - price_visible
  - confirmation_reached

required_evidence:
  - test_result
  - trace_on_failure
  - screenshot_on_failure
```

---

# Durable Playwright test

The final test should be normal Playwright code.

Example:

```ts
import { expect, test } from "@playwright/test";

const scenario = {
  destination: "Portugal",
  travellers: [
    { age: 35, citizenship: "Venezuela" },
    { age: 34, citizenship: "Venezuela" },
  ],
  email: "e2e-guest@example.test",
};

test.describe("Beacon: guest quote", () => {
  test.beforeEach(async ({ request }) => {
    const response = await request.post("/test-support/scenarios/guest-quote");
    expect(response.ok()).toBeTruthy();
  });

  test("guest completes the approved quote journey", async ({ page }) => {
    await page.goto("/quotes/new");

    await page
      .getByRole("combobox", { name: /destination/i })
      .selectOption({ label: scenario.destination });

    await page.getByRole("button", { name: /continue/i }).click();

    await page
      .getByRole("radio", { name: /standard policy/i })
      .check();

    await page
      .getByRole("button", { name: /2 travellers/i })
      .click();

    for (let index = 0; index < scenario.travellers.length; index += 1) {
      const traveller = scenario.travellers[index];
      const section = page.getByRole("group", {
        name: new RegExp(`traveller ${index + 1}`, "i"),
      });

      await section.getByLabel(/age/i).fill(String(traveller.age));
      await section
        .getByLabel(/citizenship/i)
        .selectOption({ label: traveller.citizenship });
    }

    await page.getByRole("button", { name: /continue/i }).click();

    await page
      .getByRole("radio", { name: /deductible/i })
      .first()
      .check();

    await expect(page.getByTestId("quote-total")).toBeVisible();
    await expect(page.getByTestId("quote-total")).not.toHaveText("");

    await page.goBack();

    await expect(page.getByLabel(/citizenship/i).first()).toHaveValue("VE");

    await page.getByRole("button", { name: /continue/i }).click();
    await page.getByLabel(/email/i).fill(scenario.email);
    await page.getByRole("button", { name: /save quote/i }).click();

    await expect(
      page.getByRole("heading", { name: /quote saved/i }),
    ).toBeVisible();
  });
});
```

---

# Selector rules

Agents must prefer selectors in this order:

1. `getByRole`
2. `getByLabel`
3. `getByPlaceholder`
4. `getByText`, only when unambiguous
5. `getByTestId`
6. CSS selectors as a last resort

Avoid brittle selectors such as:

```ts
page.locator("div:nth-child(3) > div > button");
```

If a stable selector does not exist, the agent should prefer improving application accessibility or adding a stable `data-testid` rather than generating fragile selectors.

---

# Agent workflow

Agents must follow this sequence for E2E work.

## 1. Read the request

Classify the work as one or more of:

- new feature verification
- regression test
- bug reproduction
- smoke test
- visual regression
- accessibility check
- cross-browser validation
- performance investigation

## 2. Inspect the project

Determine:

- application framework
- development command
- base URL
- test command
- database reset strategy
- seed strategy
- authentication mechanism
- existing E2E framework
- existing fixtures
- relevant routes
- CI behavior

Do not invent missing commands.

## 3. Check for a Beacon

Search `.pharos/beacons` for an approved Beacon matching the requested flow.

If a Beacon exists:

- treat it as the primary example of intended behavior
- read its annotations
- distinguish required values from representative values
- preserve its invariants
- do not overwrite it automatically

If no Beacon exists:

- create a provisional test specification
- mark uncertain behavior explicitly
- request a human recording when product intent cannot be inferred safely

## 4. Explore the application

Use Playwright MCP, Playwright codegen, or another browser interface to inspect the current behavior.

Exploration is research, not final verification.

Record discrepancies between:

- Beacon behavior
- acceptance contract
- current implementation

Do not silently modify assertions because the application behaves differently.

## 5. Create or update the test specification

Write a semantic test specification under `.pharos/specs`.

The specification must contain:

- preconditions
- actor
- steps
- assertions
- exclusions
- required evidence
- source Beacon

## 6. Write the Playwright test

Generate durable test code under `tests/e2e`.

The test must:

- use stable selectors
- include explicit assertions
- avoid arbitrary sleeps
- avoid force clicks unless justified and documented
- reset or prepare deterministic test data
- verify outcomes rather than only navigation

## 7. Run the targeted test

Example:

```bash
npx playwright test tests/e2e/quote-happy-path.spec.ts
```

## 8. Classify failures

Every failed run must be classified as one of:

- application defect
- test defect
- environment defect
- data setup defect
- flaky behavior
- stale Beacon
- stale specification
- ambiguous behavior
- unknown

Do not weaken assertions before classification.

## 9. Repair

Depending on classification:

- fix application code
- fix test code
- fix data setup
- update environment configuration
- propose a Beacon update
- ask for human review

## 10. Re-run

Run the targeted test again.

For critical journeys, run a flake check:

```bash
npx playwright test \
  tests/e2e/quote-happy-path.spec.ts \
  --repeat-each=5
```

Then run the related E2E suite.

## 11. Save evidence

Store the verification result under `.pharos/runs`.

## 12. Report

The agent must state:

- what was tested
- which Beacon was used
- what passed
- what failed
- how failures were classified
- which files changed
- where evidence was saved
- whether human review is required

---

# Failure classification format

Example `.pharos/runs/<run-id>/result.json`:

```json
{
  "version": 1,
  "beacon": "quote-happy-path",
  "test": "tests/e2e/quote-happy-path.spec.ts",
  "status": "failed",
  "classification": "application_defect",
  "summary": "Quote total was not visible before email submission.",
  "assertion": "expected quote-total to be visible",
  "observed": "quote-total container existed but had no text",
  "console_errors": [],
  "failed_requests": [
    {
      "url": "/quotes/123/price",
      "status": 500
    }
  ],
  "evidence": {
    "trace": "trace.zip",
    "screenshots": ["screenshots/failure.png"],
    "video": "video/test.webm"
  },
  "human_review_required": false
}
```

---

# Rules for agents

Place these rules in `.pharos/instructions.md` and reference them from `AGENTS.md`, `CLAUDE.md`, or equivalent agent configuration files.

```text
Pharos browser testing rules

1. Browser exploration is not final verification.
2. Only repeatable Playwright tests with explicit assertions may verify behavior.
3. Approved Beacons are human-owned artifacts.
4. Never overwrite an approved Beacon automatically.
5. Do not delete or weaken assertions merely to make a test pass.
6. Do not use arbitrary sleep calls.
7. Do not increase timeouts before investigating the cause.
8. Do not use force clicks to bypass broken or inaccessible UI.
9. Do not treat a passing retry as proof that a flaky test is stable.
10. Distinguish representative values from required values.
11. Preserve discrepancies between the Beacon and the implementation.
12. Classify failures before modifying code or tests.
13. Prefer deterministic setup through fixtures, APIs, tasks, or test-support endpoints.
14. Store traces, screenshots, and reports for failed runs.
15. Report uncertainty explicitly.
```

---

# Example AGENTS.md integration

Add this to the repository `AGENTS.md`:

```md
## Browser and E2E testing

This repository uses Pharos for human-guided browser testing.

For any browser, E2E, regression, or user-journey task:

1. Read `.pharos/instructions.md`.
2. Read `.pharos/config.yaml`.
3. Search `.pharos/beacons` for an approved Beacon.
4. Create or update a semantic test specification under `.pharos/specs`.
5. Use Playwright for durable verification.
6. Save evidence under `.pharos/runs`.
7. Never update an approved Beacon without explicit human approval.
```

---

# Deterministic data setup

Browser tests are only reliable when application state is controlled.

Prefer one of these approaches:

## Test-support API

Example:

```text
POST /test-support/reset
POST /test-support/scenarios/guest-quote
POST /test-support/scenarios/verified-user
```

A setup endpoint may return useful identifiers:

```json
{
  "scenario": "guest_quote",
  "policyId": "pol_123",
  "email": "e2e-guest@example.test"
}
```

The endpoint must only be available in E2E or test environments.

## Framework tasks

For Rails:

```bash
RAILS_ENV=test bin/rails e2e:reset
RAILS_ENV=test bin/rails e2e:seed[guest_quote]
```

## Direct fixtures

Use factories, fixtures, or setup scripts where available.

Do not create every prerequisite through the browser unless the prerequisite itself is part of the journey being tested.

---

# What belongs in E2E tests

Use E2E tests for behavior visible to the user:

- navigation
- forms
- validation
- authentication
- browser history
- dynamic UI behavior
- accessibility
- responsive interaction
- error states
- final user outcomes

Use lower-level tests for internal rules:

```text
Pricing formula                 → unit/model test
Price shown after selection     → E2E test

Policy eligibility calculation  → unit/service test
Ineligible option is blocked     → E2E test
```

E2E tests should cover confidence-critical journeys, not duplicate the entire lower-level suite.

---

# Updating a Beacon

Approved Beacons must never be updated silently.

When current behavior differs from the Beacon, classify the discrepancy:

- valid UI evolution
- product regression
- stale Beacon
- ambiguous

Suggested workflow:

```bash
pharos beacon compare quote-happy-path
```

Example output:

```text
Differences detected:

1. Button changed
   Previous: Continue
   Current: Next

2. New intermediate screen
   Path: /quotes/step/trip-dates

3. Required outcome preserved
   Quote can still be completed

4. Invariant violated
   Price is no longer visible before email collection
```

A human may then approve a new Beacon version.

Recommended version history:

```text
.pharos/beacons/quote-happy-path/
  versions/
    001/
    002/
  current -> versions/002
```

---

# Proposed CLI design

A custom CLI is optional for the first version. Shell scripts are sufficient initially.

Possible future commands:

```bash
pharos init

pharos beacon record quote-happy-path
pharos beacon inspect quote-happy-path
pharos beacon approve quote-happy-path
pharos beacon compare quote-happy-path
pharos beacon update quote-happy-path

pharos spec create quote-happy-path
pharos spec validate quote-happy-path

pharos explore quote-happy-path
pharos generate quote-happy-path
pharos run quote-happy-path
pharos diagnose quote-happy-path
pharos verify quote-happy-path
pharos report quote-happy-path

pharos status
pharos runs
```

Possible minimal implementation stack:

- TypeScript
- Commander.js or Clipanion
- Playwright Test
- YAML
- JSON Schema
- SQLite or JSONL for run history

---

# Minimal first milestone

The first usable version of Pharos should support:

1. Recording a human journey with Playwright codegen.
2. Saving a Beacon YAML file.
3. Saving checkpoints and an acceptance contract.
4. Letting an agent read the Beacon.
5. Generating a durable Playwright test.
6. Running that test.
7. Saving trace and screenshots on failure.
8. Classifying the failure.
9. Preventing automatic Beacon updates.

Do not build multi-agent orchestration initially.

The workflow should remain portable across agents.

---

# Recommended implementation order

## Phase 1 — Repository convention

- create `.pharos`
- add `config.yaml`
- add `instructions.md`
- add `AGENTS.md` integration

## Phase 2 — Human Beacon recording

- add `record-beacon` script
- use Playwright codegen
- save journey and metadata
- manually write Beacon annotations

## Phase 3 — Durable verification

- generate semantic test specification
- write Playwright test
- run test
- store evidence

## Phase 4 — Failure diagnosis

- collect console output
- collect failed requests
- classify failures
- create structured reports

## Phase 5 — CLI

- implement `pharos beacon record`
- implement `pharos run`
- implement `pharos verify`
- implement `pharos report`

## Phase 6 — Advanced capabilities

- ARIA snapshots
- visual baselines
- cross-browser verification
- mobile viewport verification
- CI integration
- test generation from existing Beacons
- Beacon versioning
- stale Beacon detection

---

# Final invariant

The most important rule in Pharos is:

> A human demonstration teaches the agent what good looks like. Only a controlled, repeatable test proves that it still works.

