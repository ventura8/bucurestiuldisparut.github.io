# Testing Strategy Skill

How every file of **Historic City Map** reaches 90 % or more per file (lines and branches), and how behaviour is proven from the outside. Background: `docs/research/design-review-testability.md` §3–§4; how to run the tiers: `docs/TESTING.md`.

## Tiers

| Tier | Runner | Covers | Where |
| --- | --- | --- | --- |
| Unit (node) | Vitest 5, `environment: 'node'` | `@hcm/shared` (schemas, i18n, logging, geo), engine core against FakeMap, the admin's DOM-free logic (boot, auth, the Setup controller and flows, the Google REST clients over the fake upstreams, the provisioner, the import) over fakes of its ports (`packages/admin/test/app/fakes.ts`, `packages/admin/test/setup/harness.ts`, `packages/admin/test/provision/world.ts`), pure functions handlers | `packages/<pkg>/test/**/*.test.ts` |
| Component (browser) | Vitest 5 browser mode, `@vitest/browser-playwright`, headless Chromium (projects `ui` and `engine-browser`; their npm dependencies pre-bundled by `optimizeDeps`) | Lit components of `@hcm/ui` (the kit and the viewer elements of `packages/ui/src/viewer/`, axe WCAG 2.2 AA through `@hcm/test-support/axe`), the admin's elements of `packages/ui/src/admin/` over a fake app and a recording Setup port, later the Mapbox adapter against the real `mapbox-gl@3.32.0` (needs the `engine-browser` project, CR-2) | `packages/ui/test` |
| Functions | Vitest node under the emulators (`npm test`): handlers with injected fakes or the real Firestore, Auth and Storage adapters on the emulators; triggers and callables through v2 `.run()`; REST adapters over the fake upstreams and the shared fixtures | every handler, trigger, adapter, the callable plumbing (`functions/src/api/`), the composition root `deps.ts` and the exports (`functions/test/index.test.ts` against the registry) | `functions/test` |
| Rules | Vitest node under `firebase emulators:exec --project demo-hcm`, `@firebase/rules-unit-testing` | Firestore and Storage rules: every persona × collection × operation, each `CLIENT_WRITES` field, value checks, the 1000-expression budget, indexes, `firebase.json` and `.firebaserc` | `firebase/rules-tests` |
| Scripts | pytest, branch coverage | `scripts/ci/*.py` | `scripts/ci/tests` |
| CLI tools (JavaScript) | Vitest node (the `tools` project), the CLI run as a child process with `process.execPath` | `scripts/seed/migrate-legacy.mjs` (on the real city seed and generated images), `packages/ui/scripts/gen-theme.mjs` (their logic is TypeScript tested in its package) | `scripts/seed/test`, `packages/ui/scripts/test` |
| Static site build | Vitest node (the `tools` project of the root `vitest.config.ts`, `scripts/site/src` in the coverage scope) | `scripts/site/src` (page, CSP, `config.js` parser, manifest, build, CLI), the committed `site.json`/`config.js`/manifests, the generated pages checked with the html-validate library | `scripts/site/test` |
| Pipeline | pytest in the GDAL image, synthetic world and scans, hypothesis (`ci` profile, derandomised) | `pipeline/src/hcm_pipeline` | `pipeline/tests/{unit,integration,synthetic}` (M3) |
| E2E | Playwright 1.64 + `@axe-core/playwright` against the built sites (`dist/e2e-site`) and the mock APIs (`e2e/mock-apis/`); the emulators, the admin server and Google's consent stand-in join for the admin tier (M2b) | the scenario registry `e2e/scenarios.json`: harness and smoke, functional matrix, tour (11 viewports × light/dark × RO/EN), a11y specials, no-WebGL; Firefox/WebKit admin forms and pipeline compose later | `e2e/` (tiers in `e2e/projects.ts`, `E2E_TIER`) |

E2E does **not** count toward the per-file coverage gate; unit and browser tests carry every file, which keeps the gate deterministic.

## Seams and fakes (mock only external boundaries)

- **Map**: the engine core sees only the `MapPort` interface (`packages/engine/src/map/map-port.ts`); `packages/engine/src/map/mapbox-adapter.ts` is the only file that touches Mapbox GL, through the page's global `mapboxgl` and a structural type (`packages/engine/src/map/mapbox-types.ts`), never an import. Core tests drive a recording `FakeMap`, adapter tests a fake `mapboxgl` (`FakeMapboxGl`), both from `@hcm/test-support/fake-map` (`packages/test-support/src/fake-map.ts`, a subpath so `functions/test` without DOM types never loads it), and assert their calls.
- **Viewer elements**: unit tests replace the kit elements with doubles (`packages/ui/test/viewer/doubles.ts`) and drive a `FakeStore`; `packages/ui/test/viewer/kit-integration.test.ts` runs the viewer with the real kit, which is where stacking and focus bugs between the two show. Test photos come from `seed/bucharest/derived/` through the Vitest server, so no test reaches the network.
- **Engine mount**: `packages/engine/src/mount.ts` is DOM-free behind `MountEnvironment`; `packages/engine/test/mount.test.ts` and `mount-browser.test.ts` drive it in node with a fake page.
- **Network**: a recording fake `fetch` passed in (the manifest loader, telemetry, every REST adapter of the functions) and, in e2e, the mock APIs. The upstream answers are one JSON file per call and outcome in `@hcm/test-support/api-fixtures` (`fixture`, `fixtureBody`, `fixtureResponse`; `{{name}}` placeholders; Google-key and access-token shapes assembled at run time). `createFakeFetch(handler)` records every call and rejects an unanswered one like a network failure; `routeTable([route(method, url, operation, answer)])` builds small upstreams for one adapter test; `createUpstreamFakes()` is a whole fake world (Google OAuth, Resource Manager, IAM, Billing, Budgets, Service Usage, Firebase Management, Secret Manager, Cloud Run, Cloud Tasks, Storage, Error Reporting, Mapbox, USGS M2M, Nominatim) with `scenario(name)`, `fail(service, mode)`, `state`, `calls`, `snapshot()`. Over HTTP, `startUpstreamServer` and `createUpstreamExtension()` (`@hcm/test-support/fakes/http`) serve the same world per test partition (`x-hcm-test`) with `/__upstream/…` control endpoints; the Functions emulator reaches them through `functions/src/adapters/emulator-fetch.ts`. Scenario credentials: `GOOGLE_TOKENS`, `MAPBOX_TOKENS`, `USGS_CREDENTIALS`. msw only if a test cannot inject `fetch`. The functions' in-memory port fakes (`createFakeDocumentStore` validating like the adapter, `createFakeAuthAdmin`, `createFakeBlobStore`, `createFakeTaskQueue`, `createFakeImageProcessor`, the Google, Mapbox and USGS ports, `testRuntimeConfig()`; each with `recorder.failNext`) live in `functions/test/support/`; fn-content's folders keep local copies with a movable clock (CR-M2-25, a mechanical follow-up).
- **Cloud services over REST**: Cloud Run Admin v2, Secret Manager, Resource Manager, Firebase Management and Error Reporting are called with `fetch`, never gRPC, so a fake `fetch` covers them; tokens come from a `TokenProvider` port (Resource Manager in `admin.claim` uses the caller's own token instead).
- **Ports** for everything else (`functions/src/ports/`): `DocumentStore`, `AuthAdmin`, `SecretStore`, `GoogleIam`, `FirebaseManagement`, `ErrorReporter`, `TaskQueue`, `BlobStore`, `ImageProcessor`, `MapboxApi`, `UsgsApi`, `Clock`; later `CloudRunJobs` and `Geocoder`. Owned modules are never `vi.mock`ed; owned ports get small fakes passed in. External libraries at the edge (`google-auth-library`, `firebase-functions/logger`) may be replaced with `vi.mock` in the composition root's test.
- **Time**: an injected `Clock`, `vi.useFakeTimers()`, Playwright `page.clock`. No sleeps, no wall clock.
- **Python**: `monkeypatch.setattr`, never global `sys.modules` mocks; the fake USGS M2M server on `127.0.0.1:0` with scenario state and `/__reset`; synthetic GeoTIFFs created per test in `tmp_path`.
- **Logging**: tests capture log output with `createRecordingSink()` from `@hcm/test-support`.

## Network isolation

- Python: `scripts/ci/tests/conftest.py` blocks every non-loopback socket.
- Chromium (Vitest browser and Playwright): `--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost`.
- Playwright: a firewall route aborts every host outside the allowlist and fails the test; it proves the viewer never calls `firestore.googleapis.com` and never reaches real Mapbox or Google.
- **Test credentials encode the scenario** and are generated test values, never real ones: USGS `e2e-ok`, `e2e-m2m-pending`, `e2e-bad`; Mapbox `sk.e2e-trial`, `sk.e2e-missing-scopes`; `pk.e2e-fake-token`. They are not JWT-shaped, so gitleaks stays quiet.

## Writing a test

1. Name it `happyPath_<behaviour>` or `badPath_<behaviour>` (TypeScript), `test_happy_path_<behaviour>` or `test_bad_path_<behaviour>` (Python).
2. Assert what the user sees: DOM text, ARIA role and name, a pixel probe on the map, a fake's recorded call. "It did not throw" is not an assertion.
3. Lit components: ``render(html`<hcm-...>`, host)`` in browser mode; locate with `page.getByRole`; check keyboard behaviour, RO and EN strings, window-class variants and reduced motion.
4. Cover a failure branch by causing the failure from outside (a 404 manifest, a revoked token, a 503 from USGS), not by calling a private function.
5. A user-visible behaviour also gets its happy and bad rows in `e2e/scenarios.json` (`quality/e2e_scenario_matrix_skill.md`).
6. A bug the test found goes into `docs/LESSONS.md`.

## Coverage rules

- **90 % or more per file**, lines and branches (Vitest also functions and statements), scored the Sonar way: `(covered lines + covered conditions) / (lines + conditions)`.
- Vitest's `coverage.include` lists each package's `src` explicitly; Vitest 5 never adds unlisted files.
- Re-export-only files (`packages/*/src/index.ts`) have no executable statements: v8 reports 0 of 0, which passes; the `coverage` gate (`scripts/ci/check_coverage.py`) treats a file with nothing to cover as covered.
- Exclusions only for generated files or files without runtime behaviour; `sonar.coverage.exclusions` stays empty.
- No decorators in Lit code: their helpers show up as uncovered branches.

## Gotchas found so far

- zod 4 reports a missing enum or literal as `invalid_value`, not `invalid_type`: `validate` passes `reportInput: true` and treats an issue whose `input` is `undefined` as `validation.required`.
- Test images are built in memory (`scripts/seed/test/png.ts` writes a grey PNG with `node:zlib`), never committed as binaries.
- Coverage counts every `??`, `||`, `&&` operand and ternary as a branch (and ESLint's `complexity` also counts default parameters): a fallback that cannot happen (a regex group that always matches, the first element of a non-empty array) is an uncovered branch. Use `String(match[1])` or a typed tuple instead of `?? ''`.
- The GDAL base image preloads tcmalloc into every process and Chromium aborts under it; the quality image sets `LD_PRELOAD=""`.
- Lit's Node build shims `customElements`, so modules that register elements also load in node tests; it logs "Lit is in dev mode", which is harmless.
- typescript-eslint's `no-unused-vars` does not exempt `_`-prefixed parameters: omit unused parameters instead.
- A browser crash in the container writes `core.<pid>` into the repository root (git-ignored); delete it.
- Mapbox GL 3.32 asks a `mapbox://sprites/…` sprite for `iconset.pbf` as well as `sprite.json`/`.png`, and draws a 256 px raster source at zoom 14 with zoom-15 tiles: the e2e mock answers both (an empty icon set), and specs never assume a tile zoom.
- Playwright's text locators (`getByText`, `hasText`) skip `<noscript>` content; locate a no-script note with CSS (`noscript p[lang="ro"]`).
- Map pixel probes read a screenshot square (`probeArea` in `e2e/support/map.ts`, the per-channel median of 7 × 7 CSS px, so a tile's z/x/y label or an antialiased edge does not decide) against the solid colours of `e2e/fixtures/world.ts`, and poll until the map shows the change (paint updates land one animation frame later). A translucent overlay is the linear blend of the overlay at 100 % and the map without it (`blend`): measure both ends under whatever covers the map (a modal sheet's scrim) and compare the middle. Where a coordinate is drawn comes from the live map (`screenPointOf`), never from hand-computed pixels; Mapbox zoom levels are 512 px tiles (0.4265 m per CSS px at zoom 17 in Bucharest).
- Mapbox GL treats a 404 tile as "no imagery here" and fires no `error` event: a tile outage in a test answers 5xx (the e2e broken tileset answers 503).
- Vitest browser mode's `toHaveTextContent` failed on a live region whose text also held a button label, and never matched a RegExp in the iframe: assert `element.textContent` with `toContain`, or a string.
- On a cold Vite cache a browser project re-optimises dependencies mid-run ("Vite unexpectedly reloaded a test", "Multiple versions of Lit loaded"); `npm ci` empties the cache, so CI always starts cold. `vitest.config.ts` pre-bundles `BROWSER_TEST_DEPS` for both browser projects (`DECISIONS-for-review.md` §14): a new Lit directive or browser-test dependency joins that list in the same change.
- firebase-admin's Google clients probe the GCE metadata server (a network call; `MetadataLookupWarning ... ETIMEDOUT`), which also pushed emulator tests past their 10-second hook timeouts on a busy machine: `scripts/ci/run-emulated-tests.sh` exports `METADATA_SERVER_DETECTION=none`.
- Real sharp on generated images: hand-made PNG headers test the pixel limit (never decoded) and broken pixels; incompressible test data comes from hash output (an LCG modulo 64 compresses well); the Storage emulator ignores `ifGenerationMatch`, so the conflict mapping is unit-tested.
- Prettier's line breaks pushed the fake upstreams past `max-lines-per-function`; a service's routes are built by helper functions.
- The viewer smoke (`S-V16-HAPPY`) fails on any console error, which is how a kit `styleMap` (a CSP violation) and the engine's missing `fonts/` (three 404s) were found: unit tests cannot see the page's CSP or the built `dist/`.
- The engine's browser project (`packages/engine/test/browser/`) runs what the Mapbox adapter takes from the page on a real Chromium (animation frames, ResizeObserver, the sprite canvas, the WebGL 2 probe), never a real map: a Mapbox map load is billed, and the e2e tier runs the real `mapbox-gl` behind its firewall.
- The `tools` project gives each test 30 s (`testTimeout`): its tests start Node processes and the admin build copies the 46 MB of legacy originals while every other project runs; in the old standalone `site-unit` run the 5 s default held, in the shared run one test timed out on a busy machine.
- The Firestore emulator's delete-all answers 409 ABORTED ("Transaction lock timeout") while a background function of the previous admin test still holds a lock; the admin tier's reset tries it up to three times (`docs/LESSONS.md` #49).
- A snackbar closes itself 6 s after it shows: a spec that waits for something slow first (the map settling at 4K) focuses its close button at once, which keeps it open; not a hover, whose wait for stable frames can outlast the 6 s on a loaded 4K page (`docs/LESSONS.md` #50).
