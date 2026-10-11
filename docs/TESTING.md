# Testing

How **Historic City Map** is tested: the tiers, the fakes and seams, the emulators, the scenario registry and the per-file coverage gate. The agent-facing rules are in [.agent/skills/quality/testing_strategy_skill.md](../.agent/skills/quality/testing_strategy_skill.md) and [.agent/skills/quality/e2e_scenario_matrix_skill.md](../.agent/skills/quality/e2e_scenario_matrix_skill.md); the design behind them is [research/design-review-testability.md](research/design-review-testability.md).

Every tier runs **inside the quality image** (`hcm-quality:local`), never on the host: Node 24, JDK 21 for the emulators, Chromium, Firefox and WebKit for Playwright, GDAL for the pipeline.

## Tiers

| Tier | Runner | What it proves | Status |
| --- | --- | --- | --- |
| Unit | Vitest 5 (node) | shared schemas, i18n, logging; engine core against FakeMap; admin state machines; function handlers with fake ports | running (shared, engine, admin) |
| Component | Vitest 5 browser mode, headless Chromium (`@vitest/browser-playwright`) | Lit components with real custom elements, shadow DOM, focus and accessibility trees; the Mapbox adapter against the real `mapbox-gl` | running (ui) |
| Functions | Vitest (node), handlers with fakes, triggers through v2 `.run()`, adapters with a fake `fetch` or the Firestore emulator | every function and adapter, failure shapes of USGS and Mapbox | running (`setup-status`); more functions in M2 |
| Rules | Vitest under the Firestore and Storage emulators, `@firebase/rules-unit-testing` | allow and deny for every role and path, field validation, limits; rule coverage (`rules-coverage` gate) | running |
| Scripts | pytest with branch coverage (in `static` and `tests`) | the CI tooling in `scripts/ci` | running |
| Pipeline | pytest in the GDAL image with a synthetic world and scans | georeferencing within tolerance, failure paths, determinism | scaffold; steps in M3 |
| End to end | Playwright 1.64 + axe under the emulators and mock APIs | every row of the scenario registry, layout and accessibility at 11 viewports, light and dark, RO and EN | harness smoke running (V00); tiers in M1 |

E2E does not count toward per-file coverage: unit and component tests carry every file, which keeps the gate deterministic.

## Running the tests

```bash
PIPELINE_STAGE=tests bash scripts/ci/run-all-checks.sh     # Vitest (all projects, under the emulators) + rule coverage + pytest, with coverage
PIPELINE_STAGE=e2e bash scripts/ci/run-all-checks.sh       # the scenario registry check, then every Playwright spec
```

One project or file while iterating:

```bash
docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp/hcm-home -v "$PWD:$PWD" -w "$PWD" hcm-quality:local \
  bash -c 'mkdir -p $HOME && npx vitest run --project ui'
docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp/hcm-home -v "$PWD:$PWD" -w "$PWD" hcm-quality:local \
  bash -c 'mkdir -p $HOME && python3 -m pytest scripts/ci/tests/test_pipeline.py'
docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp/hcm-home -v "$PWD:$PWD" -w "$PWD" hcm-quality:local \
  bash -c 'mkdir -p $HOME && cd e2e && npx playwright test --grep @S-V00-HAPPY'
```

Vitest projects are declared in `vitest.config.ts` (one row per workspace): shared, ui (Chromium), engine, admin, functions and rules. `npm test` runs them all under `firebase emulators:exec` (the `rules` project and the Firestore adapter test need the emulators); `npm run test:unit` runs Vitest alone, which is enough for one project such as `--project ui`.

## Fakes and seams

Only external boundaries are faked; owned modules are never mocked.

- **Map**: the engine core talks to a `MapPort`; tests use a recording `FakeMap` from `@hcm/test-support`. Only the Mapbox adapter touches `mapbox-gl`, and it is tested in Chromium with a local minimal style (slot layers) and solid-colour synthetic tiles, telemetry and token checks off.
- **HTTP**: msw handlers in `@hcm/test-support` for USGS M2M, Mapbox, Earth Search STAC, Nominatim and the AI endpoint, with `onUnhandledRequest: 'error'`. The same JSON fixtures feed the e2e mock server and the Python tests.
- **Google Cloud**: Cloud Run Admin and Secret Manager are called over REST, so msw covers them; credentials come from a `TokenProvider` port.
- **Ports**: `SecretStore`, `JobRunner`, `UsgsM2M`, `MapboxApi`, `BlobStore`, `Clock`, `Geocoder`, `AuthPort` get small fake classes by dependency injection.
- **Time**: an injected clock, Vitest fake timers, Playwright `page.clock`; no sleeps, no wall clock.
- **Python**: a fake USGS M2M server on `127.0.0.1:0` with scenario state; synthetic GeoTIFFs per test in `tmp_path`; `monkeypatch.setattr`.
- **Test credentials encode the scenario** (`e2e-ok`, `e2e-m2m-pending`, `e2e-bad`, `sk.e2e-trial`, `sk.e2e-missing-scopes`, `pk.e2e-fake-token`): generated values, never real tokens, not JWT-shaped.

## Network isolation

- pytest blocks every non-loopback socket (`scripts/ci/tests/conftest.py`).
- Chromium starts with host-resolver rules that resolve only loopback.
- Playwright installs a firewall route first (`e2e/support/test.ts`, automatic in every spec): any host outside `127.0.0.1` and `localhost` is aborted, recorded and fails the test at teardown. From M1, Mapbox GL JS and its CSS are served from `node_modules`, `api.mapbox.com` from fixtures, `events.mapbox.com` returns 204 and is counted. This proves the viewer never calls Firestore and never reaches real Mapbox or Google.

## Emulators

- firebase-tools 15.33.0 on JDK 21; the emulator JARs are in the image (`FIREBASE_EMULATORS_PATH`).
- Project **`demo-hcm`**: the `demo-` prefix guarantees no real resource is touched and no login is needed.
- `firebase emulators:exec --project demo-hcm --only <services> "<command>"` wraps a test run; e2e uses auth, firestore, storage, functions (from the `functions/dist` artifact) and hosting (the built admin with its CSP headers).
- Tests isolate data per test (city id `e2e-w{worker}-{test}`, unique Auth users) and seed through the Admin SDK.

## Scenario registry

`e2e/scenarios.json` lists every behaviour (viewer V, admin A, pipeline P) and, for each, at least one happy and one bad scenario with its id (`S-V01-HAPPY`, `S-V01-BAD-MANIFEST404`), what it asserts, its tier and milestone, and its status (`planned` until the tagged test is green, then `exists`). Playwright tests carry the id as a tag (`@S-...`), pytest tests a `Scenarios: S-...` docstring line. The `e2e-matrix` static gate (`scripts/ci/check_e2e_matrix.py check`) cross-checks rows and tests in both directions and fails when `docs/E2E_SCENARIOS.md` is out of date; `python3 scripts/ci/check_e2e_matrix.py write` regenerates it. Its `## Counts` section is the only place that states test counts.

## E2E today

- Workspace `e2e/` (`@hcm/e2e`, `@playwright/test@1.64.0`), config `e2e/playwright.config.ts`, run by the `playwright` gate (`npm run test:e2e`) after the `e2e-matrix` check in the `e2e` stage.
- One project, `smoke-chromium` (1440×900, `ro-RO`, `Europe/Bucharest`): headless Chromium with `--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist` (WebGL2 without a GPU) and host-resolver rules that resolve only loopback. `forbidOnly`; in CI one retry with `failOnFlakyTests`, so a flaky test still fails.
- Fixtures (`e2e/support/test.ts`, automatic): the firewall above and a console guard that fails a test on any console error or uncaught page error. Specs import `test` and `expect` from there, never from `@playwright/test`; a bad path that provokes a block or an error on purpose claims it with `firewall.take()` or `consoleErrors.take()` and asserts what it got.
- The harness smoke `e2e/specs/smoke.spec.ts` (behaviour V00): a static page at the loopback origin `http://127.0.0.1:4310` (fulfilled by the spec; M1 adds the `webServer` for the built site) renders a WebGL2 clear that reads back the expected pixel, and a fetch of `api.mapbox.com` is aborted, recorded by the firewall and seen by the console guard.
- `E2E_SHARD=index/total` (forwarded by `run-all-checks.sh`, set by the CI matrix) shards the run. Reports: `reports/junit/e2e.xml`, `reports/playwright/` (HTML), `reports/test-results/` (traces of failed tests).

## E2E tiers (M1)

- **Functional matrix** at compact 360, medium 768 and large 1440 in Romanian, plus English and dark variants.
- **Tour** over 11 viewports (320×568 to 3840×2160, including 915×412 landscape) × light and dark × RO and EN: axe, no horizontal overflow, no overlap, no clipped text, 48 px touch targets on compact, visible focus, ARIA snapshots, the i18n leak check.
- **Accessibility specials**: reduced motion, forced colours; **no WebGL**; **Firefox and WebKit** for admin forms; the **pipeline** compose tier.
- **Admin-input budget**: fills, clicks and file inputs per flow against a declared maximum.
- **Map-instance counter**: one map per page view.
- **Visual baselines**: a small, budgeted subset, recorded only inside the image, reviewed by the `golden-reviewer` subagent.

## Coverage gate

- **90 % or more per file**, lines and branches, for every language; Vitest also enforces functions and statements (`perFile: true`, 90/90/90/90). Python uses branch coverage with `fail_under = 90` (`.coveragerc`).
- Scored the Sonar way: `(covered lines + covered conditions) / (lines + conditions)`. The `coverage` gate (`scripts/ci/check_coverage.py`, after Vitest and pytest in the `tests` stage) reads its scope from `sonar-project.properties`, fails on any file below the bar, a measured file missing from the reports, or a stale entry, and writes `reports/coverage/summary.md` and the coverage and branches badges in `.github/badges/`.
- Exclusions only for generated files or files without runtime behaviour; never to pass. Re-export-only `index.ts` files have no statements and count as covered.

## Conventions

- Tests live in `test/` beside `src/` (never colocated), so Sonar sources and tests stay disjoint.
- Names: `happyPath_…` / `badPath_…` in TypeScript, `test_happy_path_…` / `test_bad_path_…` in Python.
- Assert what the user sees (text, ARIA, a pixel probe, a recorded request), never only "no crash".
- No `.only`, `.skip`, `xfail` or skip markers; the suppression gate rejects them.
- A bug a test finds goes into [LESSONS.md](LESSONS.md).
