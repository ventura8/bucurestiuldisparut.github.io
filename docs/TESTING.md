# Testing

How **Historic City Map** is tested: the tiers, the fakes and seams, the emulators, the scenario registry and the per-file coverage gate. The agent-facing rules are in [.agent/skills/quality/testing_strategy_skill.md](../.agent/skills/quality/testing_strategy_skill.md) and [.agent/skills/quality/e2e_scenario_matrix_skill.md](../.agent/skills/quality/e2e_scenario_matrix_skill.md); the design behind them is [research/design-review-testability.md](research/design-review-testability.md).

Every tier runs **inside the quality image** (`hcm-quality:local`), never on the host: Node 24, JDK 21 for the emulators, Chromium, Firefox and WebKit for Playwright, GDAL for the pipeline.

## Tiers

| Tier | Runner | What it proves | Status |
| --- | --- | --- | --- |
| Unit | Vitest 5 (node) | shared schemas (manifest v1, config, Firestore documents, localized validation), geo, the URL-hash codec, the Markdown subset, the legacy migration, i18n, logging; engine core against FakeMap, the Mapbox adapter against a fake `mapboxgl`, telemetry, the DOM-free `mount.ts`; admin state machines; function handlers with fake ports | running (shared, engine, admin) |
| CLI tools | Vitest 5 (node), the CLI started as a child process | `scripts/seed/migrate-legacy.mjs` (on generated images in a temporary folder) and `packages/ui/scripts/gen-theme.mjs`: output, exit status, usage errors | running (from `packages/shared/test/cli` until a `tools` project exists) |
| Component | Vitest 5 browser mode, headless Chromium (`@vitest/browser-playwright`) | Lit components with real custom elements, shadow DOM, focus and accessibility trees, axe WCAG 2.2 AA (the kit's 19 elements and the viewer's elements, with kit doubles and once with the real kit); dynamic colour with WCAG contrast checks; the bundled icon subset; later the Mapbox adapter against the real `mapbox-gl` (CR-2) | running (ui) |
| Functions | Vitest (node) under the Firestore, Auth and Storage emulators: handlers with fakes or the real adapters on the emulators, triggers and callables through v2 `.run()`, REST adapters over the fake upstreams | every function of the registry and every adapter, the failure shapes of Google, Mapbox and USGS, the composition root (`functions/test/deps.test.ts`) and the deploy surface (`functions/test/index.test.ts`: exactly the registry's names, each in `us-central1` with its instance cap and service account) | running: the eight M2 families (`admin`, `admins`, `history`, `telemetry`, `setup`, `publish`, `photos`, `ops`) |
| Rules | Vitest under the Firestore and Storage emulators, `@firebase/rules-unit-testing` | every persona × collection × operation (`matrix.test.ts`), each `CLIENT_WRITES` field allowed and every other schema field refused (`client-writes.test.ts`), complete schema-valid fixtures, the 1000-expression budget of the heaviest writes (`limits.test.ts`), the indexes, Storage uploads, `firebase.json` and `.firebaserc`; rule coverage (`rules-coverage` gate) | running (about 715 tests, 30 to 75 s) |
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

Vitest projects are declared in `vitest.config.ts` (one row per workspace): shared, ui (Chromium), engine, admin, functions and rules. `npm test` runs them all under `firebase emulators:exec` (the `rules` and `functions` projects need the emulators); `npm run test:unit` runs Vitest alone, which is enough for one project such as `--project ui`. `scripts/ci/run-emulated-tests.sh` sets `METADATA_SERVER_DETECTION=none`, so firebase-admin's Google clients never probe the GCE metadata server (a network call that also pushed emulator tests past their hook timeouts). The functions project alone:

```bash
docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp/hcm-home -v "$PWD:$PWD" -w "$PWD" hcm-quality:local \
  bash -c 'mkdir -p $HOME && npx firebase emulators:exec --project demo-hcm --only auth,firestore,storage \
  "METADATA_SERVER_DETECTION=none npx vitest run --project functions"'
```

## Fakes and seams

Only external boundaries are faked; owned modules are never mocked.

- **Map**: the engine core talks to a `MapPort`; tests use a recording `FakeMap` from `@hcm/test-support`. Only the Mapbox adapter touches `mapbox-gl`, and it is tested in Chromium with a local minimal style (slot layers) and solid-colour synthetic tiles, telemetry and token checks off.
- **HTTP**: a unit test injects a recording fake `fetch` (the engine's manifest loader and telemetry, the functions' adapters), and the e2e tier answers every mocked host from the mock APIs (`e2e/mock-apis/`). The upstream answers (Google Cloud, Mapbox, USGS M2M, Nominatim) are JSON fixtures in `@hcm/test-support/api-fixtures`, served by the fake upstreams of `@hcm/test-support/fakes` in process and over HTTP: see [Fake upstreams](#fake-upstreams) ([research/M2-interfaces.md](research/M2-interfaces.md) §7).
- **Google Cloud**: Cloud Run Admin, Secret Manager, Resource Manager, IAM, Cloud Billing, Service Usage, Firebase Management, Cloud Tasks and Error Reporting are called over REST, so a fake `fetch` covers them; credentials come from a `TokenProvider` port (the owner claim uses the caller's own token). The functions' handlers get in-memory port fakes (`functions/test/support/`).
- **Ports**: every outside service of the functions is a port (`functions/src/ports/`: `DocumentStore`, `AuthAdmin`, `SecretStore`, `GoogleIam`, `FirebaseManagement`, `ErrorReporter`, `TaskQueue`, `BlobStore`, `ImageProcessor`, `MapboxApi`, `UsgsApi`, `CloudRunJobs`, `Clock`) with an in-memory fake passed in by dependency injection ([Fake upstreams](#fake-upstreams)).
- **Time**: an injected clock, Vitest fake timers, Playwright `page.clock`; no sleeps, no wall clock.
- **Python**: a fake USGS M2M server on `127.0.0.1:0` with scenario state; synthetic GeoTIFFs per test in `tmp_path`; `monkeypatch.setattr`.
- **Test credentials encode the scenario** (`GOOGLE_TOKENS`, `MAPBOX_TOKENS` and `USGS_CREDENTIALS` of `@hcm/test-support/fakes`: `sk.e2e-bootstrap-all-scopes`, `sk.e2e-bootstrap-trial-account`, USGS `e2e-ok` and `e2e-m2m-pending`, the viewer's `pk.e2e-fake-token`): generated values, never real tokens, not JWT-shaped; a value shaped like a Google key or access token (`AIza…`, `ya29.…`) is assembled at run time, never written in a file.

## Fake upstreams

One set of answers for every tier: the adapter tests, the handler tests, the Playwright admin tier and, later, the Python tests read the same fixtures ([research/M2-interfaces.md](research/M2-interfaces.md) §7).

- **Fixtures** (`packages/test-support/src/api-fixtures/`, import `@hcm/test-support/api-fixtures`): one JSON file per upstream call and outcome, named `<service>/<operation>.<outcome>.json` (`mapbox/tokens.create.demo-account`, `usgs/login-token.html-403`, `google/error.service-disabled`). Each file is an envelope `{call, note?, status, headers?, body? | text?}`: `call` documents the request it answers, `body` is a JSON body, `text` a raw one (USGS's HTML error pages), neither for a 204. Strings may hold `{{name}}` placeholders, filled from `values.json` and the caller's values; `apiKey` is assembled at run time (`"AI" + "za" + "E2eFakeKey"` padded with `0` to 35 characters). `fixture(name, values)`, `fixtureBody(name, values)` and `fixtureResponse(name, {values, merge, body, status, headers})` read them; `FIXTURE_NAMES` lists them. A new file also gets its import and its entry in `catalog.ts`; `functions/test/support/api-fixtures.test.ts` fails when the catalogue misses a file, a placeholder stays unfilled, or a file holds a credential-shaped value.
- **Fake `fetch`** (`@hcm/test-support/fakes`): `createFakeFetch(handler)` records every call (`calls`, `callsTo('mapbox.tokens')`) and rejects a request no handler answers like a network failure (listed in `unhandled`), so an adapter that calls the wrong URL fails its test; `routeTable([route('POST', 'https://api.mapbox.com/tokens/v2/{user}', 'mapbox.tokens.create', answer)])` builds a handler (`{name}` is one path segment, so a Google custom verb such as `{service}:enable` still splits; `{name*}` takes the rest of the path); `jsonResponse` and `fixtureResponse` build the answers.
- **Fake upstreams** (`createUpstreamFakes()`): Google OAuth tokeninfo, Resource Manager (v1 and v3), IAM (service accounts, Workload Identity Federation), Cloud Billing, Billing Budgets, Service Usage, Firebase Management, Secret Manager, Cloud Run Admin v2, Cloud Tasks, the Cloud Storage bucket API, Error Reporting, Mapbox (Tokens v2, Tilesets v1, styles), USGS M2M (login, permissions, scene search, downloads) and Nominatim reverse, with state. A new world is a fresh Spark project (one open billing account, not linked; Spark APIs; one web app without Analytics; nothing provisioned), the Mapbox accounts of `MAPBOX_TOKENS` (a paid one, a demo one that cannot mint, one blocked on its billing information) and the USGS users of `USGS_CREDENTIALS`; Google APIs answer 401 without a bearer token, and enabling a billed API without billing answers Google's `UREQ_PROJECT_BILLING_NOT_FOUND`. A test changes the world with `scenario(name)` (`cloud-billing.enabled`, `usgs.m2mApproved`, `mapbox.upgraded`, `firebase-management.analyticsLinked`, `cloud-storage.publicAccessPrevented`, `google.provisioned`, ...; `scenarioNames` lists them), with `fail(service, mode)` (`unavailable`, `rateLimited`, `unauthorized`, `forbidden`, `apiDisabled`, `maintenance`; `null` clears) or through `state`, and asserts with `calls`, `snapshot()` and `secretValue(secretId)`.
- **Over HTTP** (`@hcm/test-support/fakes/http`, Node only): `startUpstreamServer({port, setup})` serves the same fakes on `127.0.0.1` for the Functions emulator or the Python tests, and `createUpstreamExtension()` plugs them into the e2e mock APIs (`e2e/mock-apis/main.ts`), which answer the extension's routes first and fall back to their own. A request arrives as `/h/<host><path>`; its `x-hcm-test` header picks the test's own world, so parallel tests never share state. Control endpoints take `?test=<id>`: `GET /__upstream/calls[&operation=]`, `POST /__upstream/scenario` `{"name"}`, `POST /__upstream/fail` `{"service", "mode"}`, `GET /__upstream/snapshot`, `GET /__upstream/scenarios`, `POST /__upstream/reset`. The browser firewall still forwards only the viewer's hosts; the admin tier adds `upstreamHosts()` when it lands, so a viewer spec that reached Google would still be blocked.
- **How the function tests use them**: the fn-admin tests run the real Firestore and Auth adapters on the emulators with a fresh named database per test (`functions/test/admin/world.ts`); the `setup.*` tests run the real REST adapters over `createUpstreamFakes()` with a per-test `intercept` (`functions/test/setup/world.ts`); the photos, publish and ops tests use in-memory documents, blobs and tasks with a movable clock (`functions/test/{photos,publish,ops}/`), real sharp on generated images (hand-made PNG headers for the pixel limit and for broken pixels), and the Storage adapter on the Storage emulator.
- **Port fakes** (`functions/test/support/`): `createFakeDocumentStore` (validates every read and write with its schema, `create` conflicts, queries with `where`/`orderBy`/`limit` that split valid from invalid documents, transactions that commit at once and refuse a read after a write, `contend(n)` to rerun `work`), `createFakeAuthAdmin`, `createFakeBlobStore` (create-only writes conflict), `createFakeTaskQueue` (an id is queued once), `createFakeSecretStore`, `createFakeCloudRunJobs`, `createFakeImageProcessor` with `fakeImage({...})` bytes, `createFakeGoogleIam`, `createFakeFirebaseManagement`, `createFakeErrorReporter`, `createFakeMapboxApi`, `createFakeUsgsApi` (the same scenario credentials) and `testRuntimeConfig()`. Each records its calls in a `PortRecorder` and fails on demand with `recorder.failNext(method, new UpstreamError(...))`.

## Network isolation

- pytest blocks every non-loopback socket (`scripts/ci/tests/conftest.py`).
- Chromium starts with host-resolver rules that resolve only loopback.
- Playwright decides every request of the browser context (`e2e/support/network.ts`, automatic in every spec): loopback passes; a mocked host (`api.mapbox.com`, `events.mapbox.com`, the GA4 and Firebase hosts, `cdn.jsdelivr.net`, `tiles.e2e.test`, `telemetry.e2e.test`) is forwarded to the mock APIs on `127.0.0.1:4311`, which serve Mapbox GL JS and its CSS from the pinned `mapbox-gl` package, a local style, generated tiles and glyphs, and count `events.mapbox.com` and analytics beacons; anything else is aborted, recorded and fails the test at teardown, WebSockets included. This proves the viewer never calls Firestore and never reaches real Mapbox or Google.

## Emulators

- firebase-tools 15.33.0 on JDK 21; the emulator JARs are in the image (`FIREBASE_EMULATORS_PATH`).
- Project **`demo-hcm`**: the `demo-` prefix guarantees no real resource is touched and no login is needed.
- `firebase emulators:exec --project demo-hcm --only <services> "<command>"` wraps a test run; e2e uses auth, firestore, storage, functions (from the `functions/dist` artifact) and hosting (the built admin with its CSP headers). **Always name the project**: `.firebaserc`'s `default` is the real `bucurestiul-disparut`, so a command without `--project demo-hcm` would start the emulators for it; `firebase/rules-tests/test/firebase-config.test.ts` fails when an npm script starts the emulators without it.
- In the Functions emulator (`FUNCTIONS_EMULATOR=true`) the composition root (`functions/src/deps.ts`) keeps secrets in memory and gives every REST adapter a `fetch` that reaches only the fake upstreams: `https://<host><path>` of Mapbox, USGS M2M or a `*.googleapis.com` API goes to `<HCM_UPSTREAM_BASE>/h/<host><path>` (`functions/src/adapters/emulator-fetch.ts`; a loopback base only), and everything else, or everything while `HCM_UPSTREAM_BASE` is unset, fails like a network error. Its Google token is a placeholder (the fakes accept any bearer token). The `x-hcm-test` partition of a callable's request is not forwarded yet: those calls share the partition `''` (CR-M2-22).
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
- The fake upstreams of `@hcm/test-support/fakes/http` extend the mock APIs (see [Fake upstreams](#fake-upstreams)): Google Cloud, Mapbox's Tokens and Tilesets APIs, USGS M2M and Nominatim, one world per test, with the `/__upstream/…` control endpoints.
- GA4 runs for real behind the mock APIs: the Firebase SDK, its web config and Installations, and a stand-in gtag.js (`e2e/mock-apis/gtag.ts`) that turns every logged event into a recorded `g/collect` beacon (scenarios V19). Like gtag.js, its page location (`dl`) falls back to `location.href` (with the hash) when the viewer sets none, and it writes `_ga` and `_ga_<container>` once consent is granted, so the specs see a hash leak and check that a withdrawal expires the cookies.
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
