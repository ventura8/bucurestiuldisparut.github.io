# Testing Strategy Skill

How every file of **Historic City Map** reaches 90 % or more per file (lines and branches), and how behaviour is proven from the outside. Background: `docs/research/design-review-testability.md` §3–§4; how to run the tiers: `docs/TESTING.md`.

## Tiers

| Tier | Runner | Covers | Where |
| --- | --- | --- | --- |
| Unit (node) | Vitest 5, `environment: 'node'` | `@hcm/shared` (schemas, i18n, logging, geo), engine core against FakeMap, admin state machines, pure functions handlers | `packages/<pkg>/test/**/*.test.ts` |
| Component (browser) | Vitest 5 browser mode, `@vitest/browser-playwright`, headless Chromium | Lit components of `@hcm/ui` (the kit and the viewer elements of `packages/ui/src/viewer/`, axe WCAG 2.2 AA through `@hcm/test-support/axe`), later the admin UI and the Mapbox adapter against the real `mapbox-gl@3.32.0` (needs the `engine-browser` project, CR-2) | `packages/ui/test` |
| Functions | Vitest node, handlers with injected fakes; triggers through v2 `.run(event)`; adapters with msw | every handler, trigger, adapter and the composition root `deps.ts` | `functions/test` (M2) |
| Rules | Vitest node under `firebase emulators:exec --project demo-hcm`, `@firebase/rules-unit-testing` | Firestore and Storage rules: allow and deny per role, field validation, size and type limits | `firebase/rules-tests` (M2) |
| Scripts | pytest, branch coverage | `scripts/ci/*.py` | `scripts/ci/tests` |
| CLI tools (JavaScript) | Vitest node, the CLI run as a child process with `process.execPath` | `scripts/seed/migrate-legacy.mjs`, `packages/ui/scripts/gen-theme.mjs` (their logic is TypeScript tested in its package) | `packages/shared/test/cli` until the `tools` project exists (`docs/research/DECISIONS-for-review.md` §9) |
| Static site build | Vitest node from its own `scripts/site/vitest.config.ts` (gate `site-unit`) until the `tools` project exists | `scripts/site/src` (page, CSP, `config.js` parser, manifest, build, CLI), the committed `site.json`/`config.js`/manifests, the generated pages checked with the html-validate library | `scripts/site/test` |
| Pipeline | pytest in the GDAL image, synthetic world and scans, hypothesis (`ci` profile, derandomised) | `pipeline/src/hcm_pipeline` | `pipeline/tests/{unit,integration,synthetic}` (M3) |
| E2E | Playwright 1.64 + `@axe-core/playwright` against the built sites (`dist/e2e-site`) and the mock APIs (`e2e/mock-apis/`); the emulators join with the admin (M2) | the scenario registry `e2e/scenarios.json`: harness and smoke, functional matrix, tour (11 viewports × light/dark × RO/EN), a11y specials, no-WebGL; Firefox/WebKit admin forms and pipeline compose later | `e2e/` (tiers in `e2e/projects.ts`, `E2E_TIER`) |

E2E does **not** count toward the per-file coverage gate; unit and browser tests carry every file, which keeps the gate deterministic.

## Seams and fakes (mock only external boundaries)

- **Map**: the engine core sees only the `MapPort` interface (`packages/engine/src/map/map-port.ts`); `packages/engine/src/map/mapbox-adapter.ts` is the only file that touches Mapbox GL, through the page's global `mapboxgl` and a structural type (`packages/engine/src/map/mapbox-types.ts`), never an import. Core tests drive a recording `FakeMap`, adapter tests a fake `mapboxgl` (`FakeMapboxGl`), both from `@hcm/test-support/fake-map` (`packages/test-support/src/fake-map.ts`, a subpath so `functions/test` without DOM types never loads it), and assert their calls.
- **Viewer elements**: unit tests replace the kit elements with doubles (`packages/ui/test/viewer/doubles.ts`) and drive a `FakeStore`; `packages/ui/test/viewer/kit-integration.test.ts` runs the viewer with the real kit, which is where stacking and focus bugs between the two show. Test photos come from `seed/bucharest/derived/` through the Vitest server, so no test reaches the network.
- **Engine mount**: `packages/engine/src/mount.ts` is DOM-free behind `MountEnvironment`; `packages/engine/test/mount.test.ts` and `mount-browser.test.ts` drive it in node with a fake page.
- **Network**: msw `setupServer(...handlers)` with `onUnhandledRequest: 'error'`; the handlers in `@hcm/test-support` (USGS, Mapbox, STAC, Nominatim, AI) read the same JSON fixtures as the e2e mock server and the Python tests, so API shapes have one source of truth.
- **Cloud services over REST**: Cloud Run Admin v2 and Secret Manager are called with `fetch`, never gRPC, so msw covers them; tokens come from a `TokenProvider` port.
- **Ports** for everything else: `SecretStore`, `JobRunner`, `UsgsM2M`, `MapboxApi`, `BlobStore`, `Clock`, `Geocoder`, `AuthPort`. Owned modules are never `vi.mock`ed; owned ports get small fake classes passed in.
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
- Test images are built in memory (`packages/shared/test/fixtures/png.ts` writes a grey PNG with `node:zlib`), never committed as binaries.
- Coverage counts every `??`, `||`, `&&` operand and ternary as a branch (and ESLint's `complexity` also counts default parameters): a fallback that cannot happen (a regex group that always matches, the first element of a non-empty array) is an uncovered branch. Use `String(match[1])` or a typed tuple instead of `?? ''`.
- The GDAL base image preloads tcmalloc into every process and Chromium aborts under it; the quality image sets `LD_PRELOAD=""`.
- Lit's Node build shims `customElements`, so modules that register elements also load in node tests; it logs "Lit is in dev mode", which is harmless.
- typescript-eslint's `no-unused-vars` does not exempt `_`-prefixed parameters: omit unused parameters instead.
- A browser crash in the container writes `core.<pid>` into the repository root (git-ignored); delete it.
- Mapbox GL 3.32 asks a `mapbox://sprites/…` sprite for `iconset.pbf` as well as `sprite.json`/`.png`, and draws a 256 px raster source at zoom 14 with zoom-15 tiles: the e2e mock answers both (an empty icon set), and specs never assume a tile zoom.
- Playwright's text locators (`getByText`, `hasText`) skip `<noscript>` content; locate a no-script note with CSS (`noscript p[lang="ro"]`).
- Map pixel probes read a screenshot pixel (`probePixel` in `e2e/support/site.ts`) against the solid colours of `e2e/fixtures/world.ts`; probe away from the tile's top-left corner, where the z/x/y label is drawn.
- Vitest browser mode's `toHaveTextContent` failed on a live region whose text also held a button label, and never matched a RegExp in the iframe: assert `element.textContent` with `toContain`, or a string.
- On a cold Vite cache the browser project re-optimises dependencies mid-run ("Vite unexpectedly reloaded a test", "Multiple versions of Lit loaded"); `npm ci` empties the cache, so CI always starts cold. The fix (`optimizeDeps.include` in `vitest.config.ts`, ask first) is `docs/research/DECISIONS-for-review.md` §14; a rerun on the warm cache passes meanwhile.
- The viewer smoke (`S-V16-HAPPY`) fails on any console error, which is how a kit `styleMap` (a CSP violation) and the engine's missing `fonts/` (three 404s) were found: unit tests cannot see the page's CSP or the built `dist/`.
