---
name: e2e-scenarios
description: Write, extend, audit or debug Historic City Map end-to-end scenarios - the registry e2e/scenarios.json (viewer V, admin A, pipeline P; a happy and a bad row per behaviour, ids like S-V01-HAPPY and S-V01-BAD-MANIFEST404), Playwright 1.64 tiers under the Firebase emulators (demo-hcm) and mock APIs, the network firewall, the map-instance counter, axe and the layout tour, and the admin-input budget. Use whenever a user-visible behaviour is added or changed, before closing a feature task, or when a scenario fails.
---

# End-to-End Scenarios Skill

Every user-visible behaviour has at least one happy and one bad row in `e2e/scenarios.json` and, once implemented, a Playwright test tagged with the row id. Rules and format: `.agent/skills/quality/e2e_scenario_matrix_skill.md`; tiers and fakes: `.agent/skills/quality/testing_strategy_skill.md`, `docs/TESTING.md`. Test counts live only in the `## Counts` section of the generated `docs/E2E_SCENARIOS.md`.

## Commands

```bash
IMG="docker run --rm -u $(id -u):$(id -g) -e HOME=/tmp/hcm-home -v $PWD:$PWD -w $PWD hcm-quality:local"
$IMG bash -c 'mkdir -p $HOME && python3 scripts/ci/check_e2e_matrix.py check'   # the e2e-matrix static gate
$IMG bash -c 'mkdir -p $HOME && python3 scripts/ci/check_e2e_matrix.py write'   # regenerate docs/E2E_SCENARIOS.md
PIPELINE_STAGE=e2e bash scripts/ci/run-all-checks.sh     # e2e-matrix, e2e-build (engine + dist/e2e-site), every Playwright tier
E2E_TIER=smoke,fn PIPELINE_STAGE=e2e bash scripts/ci/run-all-checks.sh   # some tiers: smoke, fn, tour, a11y, nogl
$IMG bash -c 'mkdir -p $HOME && npm run --silent build:site:e2e'   # rebuild the e2e sites after an engine change
$IMG bash -c 'mkdir -p $HOME && cd e2e && npx playwright test --grep @S-V00-HAPPY'   # one scenario by its tag
```

## Adding or changing a scenario

1. Find the behaviour id (`V..`, `A..`, `P..`) in `behaviours`; a new behaviour gets the next id and a name.
2. Add or edit the rows: `S-<id>-HAPPY` and one `S-<id>-BAD-<SLUG>` per bad case, with exactly the fields `id`, `behaviour`, `area`, `path`, `title`, `asserts` (what the user sees), `tier`, `status` and optional `notes` (the milestone); any other field fails the gate.
3. Write the test with `{ tag: '@S-...' }` (pytest: a `Scenarios: S-...` docstring line); assert text, ARIA, a pixel probe or a recorded request, never "no crash"; mock only external boundaries; no sleeps or wall clock (`page.clock`).
4. When a test names the row, set `status: "exists"` (the gate refuses a `planned` row that a test names).
5. Format the JSON with Prettier in the image (`npx prettier --write e2e/scenarios.json`), regenerate `docs/E2E_SCENARIOS.md` with `check_e2e_matrix.py write`, then run the `static` stage.
6. A bug the scenario found goes into `docs/LESSONS.md` with the row id.

## Fixtures every e2e test gets

Specs import `test` and `expect` from `e2e/support/test.ts` (`../../support/test.js` from `e2e/specs/<tier>/`), never from `@playwright/test`. Projects and tiers: `e2e/projects.ts`; the servers, the mock APIs and the fixture manifest: `.agent/skills/quality/e2e_scenario_matrix_skill.md` → *Tiers and projects*.

- Network (`e2e/support/network.ts`): loopback passes, the mocked hosts (Mapbox, GA4/Firebase, jsDelivr, the e2e tile and telemetry hosts) are answered by the mock APIs and recorded per test, anything else is aborted, recorded and fails the test at teardown; it proves the viewer never calls Firestore and never reaches real Mapbox or Google. A `page.route` wins over it; a bad path that expects a block claims it with `firewall.take()`.
- Console guard: any console error or uncaught page error fails the test (claim an expected one with `consoleErrors.take()`).
- Placeholder guard: visible `undefined`, `null`, `NaN`, `[object Object]` or an unfilled `{param}` (shadow roots and accessible names included) fails the test.
- `instrumentation.read(page)`: the map-instance counter (one map per view; compare creates the second lazily and destroys it) and the engine's `hcm-*` events. `mockApis.calls(host)` and `mockApis.mapLoadEvents()`: what this test sent to the mock APIs.
- `axe.violations()`: WCAG 2.0 A/AA, 2.1 AA, 2.2 AA (the tour and a11y tiers).
- `inputBudget.flow(name, limit)`: fills, clicks and file inputs per admin flow against a declared maximum (M2).
- Planned with the admin tiers (M2): the Firebase emulators and data isolation per test (city id `e2e-w{worker}-{test}`, unique Auth users) instead of global resets.
