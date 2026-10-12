# Testing

How **Historic City Map** is tested: the tiers, the fakes and seams, the emulators, the scenario registry and the per-file coverage gate. The agent-facing rules are in [.agent/skills/quality/testing_strategy_skill.md](../.agent/skills/quality/testing_strategy_skill.md) and [.agent/skills/quality/e2e_scenario_matrix_skill.md](../.agent/skills/quality/e2e_scenario_matrix_skill.md); the design behind them is [research/design-review-testability.md](research/design-review-testability.md).

Every tier runs **inside the quality image** (`hcm-quality:local`), never on the host: Node 24, JDK 21 for the emulators, Chromium, Firefox and WebKit for Playwright, GDAL for the pipeline.

## Tiers

| Tier | Runner | What it proves | Status |
| --- | --- | --- | --- |
| Unit | Vitest 5 (node) | shared schemas (manifest v1, config, Firestore documents, localized validation), geo, the URL-hash codec, the Markdown subset, the legacy migration, i18n, logging; engine core against FakeMap, the Mapbox adapter against a fake `mapboxgl`, telemetry, the DOM-free `mount.ts`; admin state machines; function handlers with fake ports | running (shared, engine, admin) |
| CLI tools | Vitest 5 (node), the CLI started as a child process | `scripts/seed/migrate-legacy.mjs` (on generated images in a temporary folder) and `packages/ui/scripts/gen-theme.mjs`: output, exit status, usage errors | running (from `packages/shared/test/cli` until a `tools` project exists) |
| Component | Vitest 5 browser mode, headless Chromium (`@vitest/browser-playwright`) | Lit components with real custom elements, shadow DOM, focus and accessibility trees, axe WCAG 2.2 AA (the kit's 19 elements and the viewer's elements, with kit doubles and once with the real kit); dynamic colour with WCAG contrast checks; the bundled icon subset; later the Mapbox adapter against the real `mapbox-gl` (CR-2) | running (ui) |
| Functions | Vitest (node), handlers with fakes, triggers through v2 `.run()`, adapters with a fake `fetch` or the Firestore emulator | every function and adapter, failure shapes of USGS and Mapbox | running (`setup-status`); more functions in M2 |
| Rules | Vitest under the Firestore and Storage emulators, `@firebase/rules-unit-testing` | allow and deny for every role and path, field validation, limits; rule coverage (`rules-coverage` gate) | running |
| Scripts | pytest with branch coverage (in `static` and `tests`) | the CI tooling in `scripts/ci` | running |
| Pipeline | pytest in the GDAL image with a synthetic world and scans | georeferencing within tolerance, failure paths, determinism | scaffold; steps in M3 |
| End to end | Playwright 1.64 + axe under the emulators and mock APIs | every row of the scenario registry, layout and accessibility at 11 viewports, light and dark, RO and EN | running for the viewer and the starter kit: harness (V00), smoke, the functional matrix V01–V25 (`e2e/specs/viewer/`, `e2e/specs/starter-kit/`), the tour, the a11y specials and no-WebGL; swipe compare (V06) waits for M4, the admin and pipeline rows for M2 and M3 |

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
- **HTTP**: today a unit test injects a recording fake `fetch` (the engine's manifest loader and telemetry, `functions/test/adapters/secret-store-rest.test.ts`), and the e2e tier answers every mocked host from the mock APIs (`e2e/mock-apis/`). Planned with the admin (M2): msw handlers in `@hcm/test-support` for USGS M2M, Mapbox, Earth Search STAC, Nominatim and the AI endpoint, with `onUnhandledRequest: 'error'`, fed by the same JSON fixtures as the e2e mock server and the Python tests.
- **Google Cloud**: Cloud Run Admin and Secret Manager are called over REST, so a fake `fetch` (msw from M2) covers them; credentials come from a `TokenProvider` port.
- **Ports**: `SecretStore`, `JobRunner`, `UsgsM2M`, `MapboxApi`, `BlobStore`, `Clock`, `Geocoder`, `AuthPort` get small fake classes by dependency injection.
- **Time**: an injected clock, Vitest fake timers, Playwright `page.clock`; no sleeps, no wall clock.
- **Python**: a fake USGS M2M server on `127.0.0.1:0` with scenario state; synthetic GeoTIFFs per test in `tmp_path`; `monkeypatch.setattr`.
- **Test credentials encode the scenario** (`e2e-ok`, `e2e-m2m-pending`, `e2e-bad`, `sk.e2e-trial`, `sk.e2e-missing-scopes`, `pk.e2e-fake-token`): generated values, never real tokens, not JWT-shaped.

## Network isolation

- pytest blocks every non-loopback socket (`scripts/ci/tests/conftest.py`).
- Chromium starts with host-resolver rules that resolve only loopback.
- Playwright decides every request of the browser context (`e2e/support/network.ts`, automatic in every spec): loopback passes; a mocked host (`api.mapbox.com`, `events.mapbox.com`, the GA4 and Firebase hosts, `cdn.jsdelivr.net`, `tiles.e2e.test`, `telemetry.e2e.test`) is forwarded to the mock APIs on `127.0.0.1:4311`, which serve Mapbox GL JS and its CSS from the pinned `mapbox-gl` package, a local style, generated tiles and glyphs, and count `events.mapbox.com` and analytics beacons; anything else is aborted, recorded and fails the test at teardown, WebSockets included. This proves the viewer never calls Firestore and never reaches real Mapbox or Google.

## Emulators

- firebase-tools 15.33.0 on JDK 21; the emulator JARs are in the image (`FIREBASE_EMULATORS_PATH`).
- Project **`demo-hcm`**: the `demo-` prefix guarantees no real resource is touched and no login is needed.
- `firebase emulators:exec --project demo-hcm --only <services> "<command>"` wraps a test run; e2e uses auth, firestore, storage, functions (from the `functions/dist` artifact) and hosting (the built admin with its CSP headers).
- Tests isolate data per test (city id `e2e-w{worker}-{test}`, unique Auth users) and seed through the Admin SDK.

## Scenario registry

`e2e/scenarios.json` lists every behaviour (viewer V, admin A, pipeline P) and, for each, at least one happy and one bad scenario with its id (`S-V01-HAPPY`, `S-V01-BAD-MANIFEST404`), what it asserts, its tier and milestone, and its status (`planned` until the tagged test is green, then `exists`). Playwright tests carry the id as a tag (`@S-...`), pytest tests a `Scenarios: S-...` docstring line. The `e2e-matrix` static gate (`scripts/ci/check_e2e_matrix.py check`) cross-checks rows and tests in both directions and fails when `docs/E2E_SCENARIOS.md` is out of date; `python3 scripts/ci/check_e2e_matrix.py write` regenerates it. Its `## Counts` section is the only place that states test counts.

## E2E today

- Workspace `e2e/` (`@hcm/e2e`: `@playwright/test@1.64.0`, `@axe-core/playwright@4.13.0`, `mapbox-gl@3.32.0` for the mock APIs, `sharp` for the tiles), config `e2e/playwright.config.ts`, projects `e2e/projects.ts`. The `e2e` stage runs `e2e-matrix`, then `e2e-build` (`npm run build:site:e2e`: the engine, then `dist/e2e-site/bucharest` with the e2e fixture manifest and `dist/e2e-site/starter-kit`), then `playwright` (`npm run test:e2e`).
- Two servers start first (`webServer`, `e2e/mock-apis/main.ts`, run by Node from TypeScript): the built sites on `http://127.0.0.1:4310` as GitHub Pages serves them, and the mock APIs on `http://127.0.0.1:4311` (`GET /__calls?test=<id>&host=<host>`, `POST /__reset`, `GET /__health`).
- Every project runs headless Chromium with `--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist` (WebGL2 without a GPU) and host-resolver rules that resolve only loopback, and depends on `setup` (`e2e/setup/fixture.setup.ts`: the fixture manifest validates, both servers answer, the site serves the fixture). `forbidOnly`; in CI one retry with `failOnFlakyTests`, so a flaky test still fails.
- Tiers (`E2E_TIER`, comma-separated; unset or `all` is every tier): `smoke` (`harness`, `smoke-c360`, `smoke-l1440`), `fn` (`fn-c360-ro`, `fn-m768-ro`, `fn-l1440-ro`, `fn-l1440-en`, `fn-c360-dark`), `tour` (`tour-<viewport>-<light|dark>-<ro|en>` over 11 viewports), `a11y` (`a11y-reduced-motion`, `a11y-forced-colors`), `nogl` (`--disable-3d-apis`).
- Fixtures (`e2e/support/test.ts`): the network rules above, a console guard (any console error or uncaught page error fails the test), a placeholder guard (visible `undefined`, `null`, `NaN`, `[object Object]` or an unfilled `{param}` fails it), the map-instance counter and the engine's `hcm-*` events (`instrumentation`), the mock APIs' record of the test's calls (`mockApis`, with `mapLoadEvents()`), axe (`axe.violations()`, WCAG 2.2 AA) and the admin-input budget (`inputBudget`). Specs import `test` and `expect` from there, never from `@playwright/test`; a bad path that provokes a block or an error on purpose claims it with `firewall.take()` or `consoleErrors.take()` and asserts what it got.
- The e2e world (`e2e/fixtures/world.ts`): two synthetic layers in solid colours (a `mapbox://` tileset and an `xyz` source) and the basemap background, which pixel probes (`probePixel` in `e2e/support/site.ts`) read back; the fixture manifest (`e2e/fixtures/manifest.ts`) adds them and the POI set `scripts/seed/e2e-pois.json` to the Bucharest seed.
- Specs: the harness (`e2e/specs/harness/`: WebGL2, the firewall, Mapbox GL drawing the mock tiles in the `middle` slot), the viewer smoke on c360 and l1440 (`e2e/specs/smoke/`: one map, one map load, `hcm-ready`, no other host), the functional matrix (`e2e/specs/viewer/*.spec.ts`: boot, layers and opacity, the timeline, photos and the lightbox, deep links and the hash, geolocation, language and theme, About, keyboard, responsive sheets and labels, the CSP, consent and GA4, crash reports, the embed API, POIs; `e2e/specs/starter-kit/`), the tour (`e2e/tour/viewer.tour.ts`), the a11y specials (`e2e/a11y/`) and no-WebGL (`e2e/specs/viewer/no-webgl.spec.ts`).
- Map assertions are pixel probes on the synthetic colours (`e2e/support/map.ts`: `probeArea`, `blend`, `expectColourAt`, `pixelsOfColour` for an icon glyph) and what the live Mapbox map reports about itself (where a coordinate is drawn, rendered features, the basemap configuration), read from the instrumentation's map instances and never used to drive the map.
- GA4 runs for real behind the mock APIs: the Firebase SDK, its web config and Installations, and a stand-in gtag.js (`e2e/mock-apis/gtag.ts`) that turns every logged event into a recorded `g/collect` beacon (scenarios V19).
- `E2E_SHARD=index/total` (set by the CI matrix) shards the run; `run-all-checks.sh` forwards it and `E2E_TIER`. Reports: `reports/junit/e2e.xml`, `reports/playwright/` (HTML), `reports/test-results/` (traces of failed tests).

## Static site build

- `scripts/site/` builds a city site from its folder (`sites/bucharest/`, `starter-kit/`: `site.json`, `config.js`, `site.css`): the page is generated (`scripts/site/src/page.ts`, no committed `.html` until DECISIONS §1 is approved) with a meta CSP from the site's manifest and configuration and Subresource Integrity for Mapbox GL JS; `config.js` is parsed, never run; the manifest gets the build's token and its photos under `data/media/`.
- Unit tests in `scripts/site/test` (gate `site-unit`, `npm run test:site`, its own Vitest configuration at 90 % per file): the generated pages pass the repository's `.htmlvalidate.json` through the html-validate library, every committed `site.json`, `config.js` and manifest validates, and every failure path is driven from outside (a missing engine build, a missing photo, a mismatched `cityId`, an output folder outside `dist/`).

## E2E tiers

- **Functional matrix** (`fn`): the viewer behaviours V01–V25 and the starter kit V17 on c360, m768 and l1440 (RO), l1440 (EN) and c360 (dark). Swipe compare (V06) joins in M4.
- **Tour** (`tour`) over 11 viewports (320×568 to 3840×2160, including 915×412 landscape) × light and dark × RO and EN (`e2e/tour/viewer.tour.ts`): eight states, each checked for axe, no horizontal overflow, no overlap of the `[data-layout-check]` controls and Mapbox's legal controls, controls and menu items on screen, no clipped text (screen-reader-only `.visually-hidden` text excepted), 48 px touch targets on compact, the i18n leak check (`e2e/support/i18n.ts`), plus a visible focus ring and a partial ARIA snapshot of the landmarks.
- **Accessibility specials** (`a11y`, `e2e/a11y/`): reduced motion (the camera jumps, the skeleton stands still), forced colours (painted text contrast, control edges, axe); **no WebGL** (`nogl`, `e2e/specs/viewer/no-webgl.spec.ts`).
- Still to fill: **Firefox and WebKit** for admin forms and the **pipeline** compose tier (M2, M3); **admin-input budget** flows (M2); **visual baselines**: a small, budgeted subset, recorded only inside the image, reviewed by the `golden-reviewer` subagent.

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
