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
PIPELINE_STAGE=e2e bash scripts/ci/run-all-checks.sh     # e2e-matrix, e2e-build (stamped), every push's tiers (every scenario row)
PIPELINE_STAGE=e2e bash scripts/ci/e2e-split.sh          # the same, the Playwright run split with the NUC (ssh nuc), one merged verdict
PIPELINE_STAGE=tour-matrix bash scripts/ci/run-all-checks.sh   # the tour's other 35 projects (in `all` and nightly)
E2E_TIER=smoke,fn PIPELINE_STAGE=e2e bash scripts/ci/run-all-checks.sh   # some tiers: admin, smoke, a11y, nogl, tour, tour-matrix, fn
$IMG bash -c 'mkdir -p $HOME && npm run --silent build:site:e2e'   # rebuild the e2e sites after an engine change
$IMG bash -c 'mkdir -p $HOME && cd e2e && npx playwright test --grep @S-V00-HAPPY'   # one scenario by its tag
```

## Adding or changing a scenario

1. Find the behaviour id (`V..`, `A..`, `P..`) in `behaviours`; a new behaviour gets the next id and a name.
2. Add or edit the rows: `S-<id>-HAPPY` and one `S-<id>-BAD-<SLUG>` per bad case, with exactly the fields `id`, `behaviour`, `area`, `path`, `title`, `asserts` (what the user sees), `tier`, `status` and optional `notes` (the milestone); any other field fails the gate.
3. Write the test with `{ tag: '@S-...' }` (a Vitest test of `functions/test/` or `firebase/rules-tests/`: the tag in its title, or in the case's name of an `it.each`; pytest: a `Scenarios: S-...` docstring line); assert text, ARIA, a pixel probe or a recorded request, never "no crash"; mock only external boundaries; no sleeps or wall clock (`page.clock`); web-first assertions only (`toHaveCount`, `expect.poll`), never a one-shot `count()` or `allTextContents()` in a plain `expect`.
4. When a test names the row, set `status: "exists"` (the gate refuses a `planned` row that a test names).
5. Format the JSON with Prettier in the image (`npx prettier --write e2e/scenarios.json`), regenerate `docs/E2E_SCENARIOS.md` with `check_e2e_matrix.py write`, then run the `static` stage.
6. With parallel agents (the M2c editors: `docs/research/M2c-interfaces.md` §11.2), edit only the rows of your own behaviours, add a new row right after your behaviour's last one, and add a new screen's states to your area's marked section of `ADMIN_STATES` in `e2e/tour/states.ts`.
7. A bug the scenario found goes into `docs/LESSONS.md` with the row id.

## Fixtures every e2e test gets

Specs import `test` and `expect` from `e2e/support/test.ts` (`../../support/test.js` from `e2e/specs/<tier>/`), never from `@playwright/test`. Projects and tiers: `e2e/projects.ts`; the servers, the mock APIs and the fixture manifest: `.agent/skills/quality/e2e_scenario_matrix_skill.md` → *Tiers and projects*.

- Network (`e2e/support/network.ts`): loopback passes, the mocked hosts (Mapbox, GA4/Firebase, jsDelivr, the e2e tile and telemetry hosts) are answered by the mock APIs and recorded per test, anything else is aborted, recorded and fails the test at teardown; it proves the viewer never calls Firestore and never reaches real Mapbox or Google. A `page.route` wins over it; a bad path that expects a block claims it with `firewall.take()`.
- Console guard: any console error or uncaught page error fails the test (claim an expected one with `consoleErrors.take()`).
- Placeholder guard: visible `undefined`, `null`, `NaN`, `[object Object]` or an unfilled `{param}` (shadow roots and accessible names included) fails the test.
- `instrumentation.read(page)`: the map-instance counter (one map per view; compare creates the second lazily and destroys it) and the engine's `hcm-*` events. `mockApis.calls(host)` and `mockApis.mapLoadEvents()`: what this test sent to the mock APIs.
- `axe.violations({ include, skipRules, tags })`: WCAG 2.0 A/AA, 2.1 AA, 2.2 AA by default; `css-orientation-lock` and axe's CSSOM preload are off because the page CSP refuses the `<style>` they write.
- The generic checkers of every tour state (`e2e/support/state-check.ts` → `expectStateSound(page, { id, lang, announcements, escape })`): `assertLayoutSound` (`layout.ts`: occlusion at five points of every control, nothing usable outside an open modal, no overlap of floating chrome (the open FAB menu may cover only the map's content and the two top docks), 8 px between floating touch targets on compact and medium, nothing cut off or partly off screen, no sideways scroll, one uncovered Mapbox logo and attribution, no clipped or overlapping text) and `assertAccessible` (`a11y.ts`: axe with best practices, target sizes (a `touch-target` ring is hit-tested, never read from its computed 48 px), one full Tab round with 3:1 rings that nothing clips, non-text contrast in the scheme and in high contrast, landmarks, announcements, text spacing, reflow at 320 px). Soft assertions; violations land in `layout-a11y-violations.jsonl` of the test's output and an outlined screenshot is attached. Check a settled state: wait for what opens on its own after a load (Setup's open card), and hold a timed snackbar open by pointing at it. A new screen or state joins the inventory `e2e/tour/states.ts` (viewer: a state and a journey that visits it, checked as the module loads; admin: `ADMIN_STATES` and an `expectStateSound` call in its spec). `HCM_STATE_SCREENSHOTS=<folder>` saves every checked state for a visual audit (`e2e/support/state-shots.ts`, `docs/TESTING.md` → *Review screenshots*): look at the contact sheets, and give each defect the checkers missed a check of its own. Probes are `function` declarations installed once per page as a library (`libraryScript`, `callInPage`) and called by name; their unit tests are `e2e/test/` (Vitest project `e2e-support`, 90 % per file).
- Helpers (`e2e/support/`): `viewer.ts` (open a site and wait for `hcm-ready` and an idle map, serve a changed manifest, the menu, the Layers panel, sliders and switches by their localized names, the controller, the hash, the window class: `isDocked` and `closeModalSheet`, so no spec body branches, which `eslint-plugin-playwright` refuses), `map.ts` (pixel probes over a 7 × 7 median, `blend`, where a coordinate is drawn, rendered features, the basemap configuration; read from the live map the instrumentation keeps, never driving it), `layout.ts` (the generic checker above, plus the functional specs' own helpers: overflow, overlaps of chosen boxes, what is on top, the focus ring), `i18n.ts` (raw message keys, English in a Romanian page). Expected texts come from the catalogues (`t(lang, key)`), so one spec runs in both languages.
- A changed manifest starts from `siteManifestData()` (`e2e/fixtures/manifest.ts`: what the built site serves, with its `media/` image paths); the fixture data itself has the seed's `derived/` paths.
- `inputBudget.flow(name, limit)`: fills, clicks and file inputs per admin flow against a declared maximum (M2).
- Admin to viewer (behaviour A41, `e2e/admin/specs/flows/`): save in an editor, `awaitManifest` reads the manifest the emulators built from the public bucket, `openPublicViewer` serves exactly that to the built site (its `config.js` routed to the project's city) and the spec asserts what a visitor sees. Type, then click Save, as a person does; claim a refused write's 403 with `consoleErrors.takeMatching`. More pitfalls: `.agent/skills/quality/e2e_scenario_matrix_skill.md`.
- Planned with the admin tiers (M2b): the Firebase emulators (the Functions emulator loads `functions/dist/` and reaches the fake upstreams through `HCM_UPSTREAM_BASE`), the fake upstreams' hosts in the admin projects' network (`upstreamHosts()`), and data isolation per test (city id `e2e-w{worker}-{test}`, unique Auth users) instead of global resets. The backend's own rows already run on the `functions` and `rules` tiers.
