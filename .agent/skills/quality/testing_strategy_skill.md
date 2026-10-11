# Testing Strategy Skill

How every file of **Historic City Map** reaches 90 % or more per file (lines and branches), and how behaviour is proven from the outside. Background: `docs/research/design-review-testability.md` §3–§4; how to run the tiers: `docs/TESTING.md`.

## Tiers

| Tier | Runner | Covers | Where |
| --- | --- | --- | --- |
| Unit (node) | Vitest 5, `environment: 'node'` | `@hcm/shared` (schemas, i18n, logging, geo), engine core against FakeMap, admin state machines, pure functions handlers | `packages/<pkg>/test/**/*.test.ts` |
| Component (browser) | Vitest 5 browser mode, `@vitest/browser-playwright`, headless Chromium | Lit components of `@hcm/ui`, engine and admin UI, the Mapbox adapter against the real `mapbox-gl@3.32.0` with a local style and synthetic tiles | `packages/ui/test`, later engine and admin `test/` |
| Functions | Vitest node, handlers with injected fakes; triggers through v2 `.run(event)`; adapters with msw | every handler, trigger, adapter and the composition root `deps.ts` | `functions/test` (M2) |
| Rules | Vitest node under `firebase emulators:exec --project demo-hcm`, `@firebase/rules-unit-testing` | Firestore and Storage rules: allow and deny per role, field validation, size and type limits | `firebase/rules-tests` (M2) |
| Scripts | pytest, branch coverage | `scripts/ci/*.py` | `scripts/ci/tests` |
| CLI tools (JavaScript) | Vitest node, the CLI run as a child process with `process.execPath` | `scripts/seed/migrate-legacy.mjs`, `packages/ui/scripts/gen-theme.mjs` (their logic is TypeScript tested in its package) | `packages/shared/test/cli` until the `tools` project exists (`docs/research/DECISIONS-for-review.md` §9) |
| Pipeline | pytest in the GDAL image, synthetic world and scans, hypothesis (`ci` profile, derandomised) | `pipeline/src/hcm_pipeline` | `pipeline/tests/{unit,integration,synthetic}` (M3) |
| E2E | Playwright 1.64 + `@axe-core/playwright`, emulators + mock APIs | the scenario registry `e2e/scenarios.json`: functional matrix, tour (11 viewports × light/dark × RO/EN), a11y specials, no-WebGL, Firefox/WebKit admin forms, pipeline compose | `e2e/` (harness smoke since M0, tiers from M1) |

E2E does **not** count toward the per-file coverage gate; unit and browser tests carry every file, which keeps the gate deterministic.

## Seams and fakes (mock only external boundaries)

- **Map**: the engine core sees only the `MapPort` interface (`packages/engine/src/map/map-port.ts`, M1); `packages/engine/src/map/mapbox-adapter.ts` is the only file that touches `mapbox-gl` (dependency-cruiser rule `only-the-map-adapter-imports-mapbox`). Core tests drive a recording `FakeMap` from `@hcm/test-support` and assert its calls.
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
