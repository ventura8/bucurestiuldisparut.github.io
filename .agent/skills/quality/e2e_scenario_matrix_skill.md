# E2E Scenario Matrix Skill

Every user-visible behaviour of **Historic City Map** has at least one **happy** and one **bad** scenario, registered in `e2e/scenarios.json` before the behaviour counts as done. The registry was seeded from `docs/research/design-review-testability.md` §4.5 (viewer V01–V18, admin A01–A21, pipeline P01–P02) plus the consent and crash-reporting behaviours of `docs/research/PLAN.md` → *Addendum 2* (V19, V20, A22) and the M1 contracts of `docs/research/M1-interfaces.md` §9 (the embed API V21, and rows for engine compatibility, the legacy hash, markup in About, a photo without bearing and a mismatched `cityId`), plus PLAN Addendum 3: live overlay opacity (V22), overlay opacity in the URL hash (V23, which took over the two `op=` rows of V05) and points of interest (V24), served from the e2e fixture manifest of `docs/research/M1-interfaces.md` §10; and the M2 backend contracts of `docs/research/M2-interfaces.md` §6 (refined A01–A07, A20 and A22 rows, edit history and revert A23, the crash reporting endpoint A24); and the M2b admin contracts of `docs/research/M2b-interfaces.md` §5 (refined A04, A07 and A22 rows; bootstrap mode before Blaze A25, deployment detection and the automatic owner claim A26, Google OAuth scopes A27, the legacy Bucharest import A28, navigation and layout A29, minimum admin input A30).

This file holds the rules; it never states test counts. Counts appear only in the `## Counts` section of `docs/E2E_SCENARIOS.md`, generated from the registry by `python3 scripts/ci/check_e2e_matrix.py write`.

## Registry format

`e2e/scenarios.json` is one object. `scenarios` is the list the `e2e-matrix` gate checks; `behaviours` names each behaviour id with its area, milestone and source (documentation for people and agents; the gate ignores it).

```json
{
    "id": "S-V01-BAD-MANIFEST404",
    "behaviour": "V01",
    "area": "viewer",
    "path": "bad",
    "title": "Manifest 404 shows a localized error with Retry",
    "asserts": "manifest 404 -> localized error message and a Retry button",
    "tier": "e2e-viewer",
    "status": "planned",
    "notes": "Milestone M1."
}
```

| Field | Meaning |
| --- | --- |
| `id` | `S-<behaviour>-HAPPY` for the happy row (`S-<behaviour>-HAPPY-<SLUG>` when a behaviour has more than one), `S-<behaviour>-BAD-<SLUG>` for each bad case; upper case letters, digits and dashes |
| `behaviour` | `V01`…, `A01`…, `P01`…; one behaviour stays in one area |
| `area` | `viewer`, `admin`, `starter-kit`, `pipeline`, `functions` or `rules` |
| `path` | `happy` or `bad` |
| `title` | the test title |
| `asserts` | what the user sees when it passes; never "no crash" |
| `tier` | `e2e-viewer`, `e2e-admin`, `e2e-starter-kit`, `e2e-pipeline`, `functions` or `rules` |
| `status` | `planned` until a test names the id, then `exists` |
| `notes` | optional: the milestone that delivers it, caveats |

Any other row field fails the gate. The allowed values are the tuples in `scripts/ci/check_e2e_matrix.py` (`AREAS`, `TIERS`).

## Rules

1. A behaviour change edits its rows and its tests in the same task. A new behaviour gets a new id (and an entry in `behaviours`) with at least one happy and one bad row.
2. A test names its scenarios: Playwright with `{ tag: '@S-...' }`, a Vitest test of `functions/test/` or `firebase/rules-tests/` with `@S-...` in its title (the gate matches the tag anywhere in a test file; in an `it.each`, put it in the case's name), pytest with a docstring line `Scenarios: S-..., S-...` (matched only at the start of a line). A row and the tags that name it land in the same change: the gate refuses a tag on an unknown or `planned` row, and an `exists` row without a tag. Test files are searched under `e2e/`, `pipeline/tests/`, `functions/test/` and `firebase/rules-tests/`.
3. The `e2e-matrix` gate (`python3 scripts/ci/check_e2e_matrix.py check`) works in both directions: every named id is registered, every `exists` row is named by a test, no `planned` row is (flip it to `exists`), ids are unique, every behaviour has a happy and a bad row, and `docs/E2E_SCENARIOS.md` is current. After any registry or tag change run `python3 scripts/ci/check_e2e_matrix.py write` in the image and commit the regenerated doc.
4. A new behaviour takes the next free id in `behaviours`, whatever a brief called it (Addendum 3's V21–V23 became V22–V24 because V21 already existed; the M2 brief's A22 history and A23 crash endpoint became A23 and A24 because A22 was the analytics card; the M2b brief's bootstrap, OAuth, import and input-budget behaviours became A25–A30); say so in the task's notes.
5. Assert what the user sees (text, ARIA, a pixel probe, a recorded request); drive the app from outside; mock only external boundaries (Mapbox, USGS, STAC, Nominatim, AI, the network), never an owned module; no network, no sleeps, no wall clock. Use web-first assertions (`toHaveCount`, `toContainText`, `expect.poll`): `count()`, `allTextContents()` or `getAttribute()` inside a plain `expect` reads once and races the render after `hcm-ready`.
6. Format the registry with Prettier (4 spaces) and keep every row on the schema above. Titles and `asserts` are copied verbatim into the Markdown tables of `docs/E2E_SCENARIOS.md`: describe markup in words (no raw `<tag>`), or markdownlint rejects the generated doc.
7. A bug a scenario found goes into `docs/LESSONS.md` with the row id that now pins it.
8. The tour tier checks layout, axe and ARIA snapshots on every screen and state; it backs V15, V18 and A21 but does not replace their functional rows.

## Tiers and projects (M1)

The projects are built by `e2e/projects.ts` and chosen with `E2E_TIER` (comma-separated tiers; unset or `all` runs every tier). Every project runs Chromium under SwiftShader behind the host-resolver rules and depends on `setup` (`e2e/setup/fixture.setup.ts`: the fixture manifest validates, both servers answer, the built site serves the fixture).

- **`smoke`**: `harness` (`e2e/specs/harness/`: WebGL2, the firewall, Mapbox GL drawing the mock tiles), `smoke-c360` and `smoke-l1440` (`e2e/specs/smoke/`: the viewer boots with one map load).
- **`fn`**, the functional matrix (`e2e/specs/viewer/`, `e2e/specs/starter-kit/`): `fn-c360-ro`, `fn-m768-ro`, `fn-l1440-ro`, plus `fn-l1440-en` (option `lang: 'en'`) and `fn-c360-dark`.
- **`tour`**: 11 viewports (320×568 to 3840×2160, including 915×412 landscape) × light/dark × RO/EN, `tour-<viewport>-<scheme>-<lang>` (120 s per test: a 3840 px frame under SwiftShader is slow), `e2e/tour/viewer.tour.ts`: home, focus and the open menu, a historical year and the Layers panel, a photo, the lightbox and the photo list, a POI and About, Bucharest today (no layers, consent), the error card, a toast. Every state: axe, no horizontal scroll, with a map exactly one visible Mapbox logo and one attribution with nothing on top of them (Mapbox's own, or the viewer's copy in the legal bar or at the foot of About while a modal surface covers the map), the usable `[data-layout-check]` controls (plus the menu button and the logo and attribution; `visibleBoxes(…, { usable: true })` leaves out what a modal makes inert) apart and on screen, menu items on screen, no clipped text (screen-reader-only text excepted), 48 px touch targets on compact, no message key or English text in a Romanian page; the first Tab shows a focus ring; a partial ARIA snapshot of the landmarks (entries quoted as YAML, since a name may hold a colon). Tags `S-V15-HAPPY`, `S-V18-HAPPY`, `S-V18-HAPPY-MODAL-STATES`. Under 8 workers the 2560 and 3840 projects can miss the boot toast or `hcm-ready` within 15 s (SwiftShader at 4K); they pass with 4 workers.
- **`a11y`**: `a11y-reduced-motion` runs `e2e/a11y/reduced-motion.spec.ts`, `a11y-forced-colors` runs `e2e/a11y/forced-colors.spec.ts` (each project its own file: the emulation is what the spec checks); **`nogl`**: `--disable-3d-apis`, spec `e2e/specs/viewer/no-webgl.spec.ts` (the functional projects ignore it). Under forced colours axe's colour rules judge the author's colours, which the browser replaces, so the spec measures the painted text against its painted background instead.
- **`admin`** (M2b, `docs/TESTING.md` → *The admin tier*): `admin-setup`, `admin-harness` (`e2e/admin/harness/`, behaviour A00), `admin-c360-ro`, `admin-m768-ro`, `admin-l1440-ro`, `admin-l1440-en` (`e2e/admin/specs/`: the owner's smoke, the stranger, the owner's whole Setup Assistant journey `journey.spec.ts`), one worker each and a lease across projects; the admin server (`127.0.0.1:4312`) and the emulators start only for this tier.
- Planned: **Firefox and WebKit** for the admin's forms, the admin tour (A21) and the **pipeline** compose tier (M2c, M3).

The world the specs run in:

- **Servers** (`webServer`, `e2e/mock-apis/main.ts`): the built sites `dist/e2e-site` on `127.0.0.1:4310` (as GitHub Pages serves them) and the mock APIs on `127.0.0.1:4311`. `npm run build:site:e2e` (gate `e2e-build`) builds the engine and both sites first.
- **Network** (`e2e/support/network.ts`): loopback passes; the mocked hosts of `e2e/mock-apis/hosts.ts` (`api.mapbox.com`, `events.mapbox.com`, the GA4 and Firebase hosts, `cdn.jsdelivr.net`, `tiles.e2e.test`, `telemetry.e2e.test`) are forwarded to the mock APIs and recorded per test; anything else is blocked and fails the test. WebSockets follow the same rule.
- **Mock APIs** (`e2e/mock-apis/router.ts`): Mapbox GL JS 3.32.0 from the pinned npm package (so Subresource Integrity holds), a minimal Standard-like basemap (`style.ts`: a fragment with the `show3dObjects` schema, the `bottom`/`middle`/`top` slots and Standard's Mapbox and OpenStreetMap attribution; the style id `e2e-plain` is the same style without the fragment and the schema), TileJSON and solid-colour tiles generated with sharp (`tiles.ts`), generated SDF box glyphs (`glyphs.ts`), an empty sprite and icon set, map sessions, `events.mapbox.com` (204), the Firebase web config and Installations, a stand-in gtag.js that turns every GA4 event into a recorded `g/collect` beacon (`gtag.ts`; like gtag.js its `dl` falls back to `location.href` and it writes `_ga` and `_ga_<container>` while consent is granted), the crash endpoint. `GET /__calls?test=<id>&host=<host>` lists the recorded calls (the `mockApis` fixture reads them), `POST /__reset` forgets them.
- **Fake upstreams** (`@hcm/test-support/fakes/http`): `e2e/mock-apis/main.ts` passes `createUpstreamExtension()` to `startMockApis` as a `MockExtension`, whose routes answer first: requests forwarded as `/h/<host><path>` for the Google Cloud, Mapbox Tokens and Tilesets, USGS M2M and Nominatim hosts, one world per `x-hcm-test` partition, with the control endpoints `/__upstream/{calls,scenario,fail,snapshot,scenarios,reset}?test=<id>` (`docs/TESTING.md` → *Fake upstreams*). The viewer projects keep today's firewall; the admin projects (`forwardUpstreams`) add `upstreamHosts()` and the `authorization` header (CR-M2-21), and the Functions emulator reaches the same server through `HCM_UPSTREAM_BASE` (CR-M2-22; its calls land in the shared partition `''`, the server's world, until CR-M2b-3).
- **The e2e world** (`e2e/fixtures/world.ts`): ports, the test values (`pk.e2e-fake-token`, `G-E2E0000000`, the Firebase app ids `E2E_FIREBASE_APP`), the synthetic layers and their colours (`ventura86.e2e-1966` red, the xyz layer `e2e-1980` green, a broken tileset whose tiles answer 503: Mapbox GL treats a 404 tile as "no imagery here" and never reports it), the basemap background. Pixel probes (`probeArea` in `e2e/support/map.ts`: the median of a small square; `blend` for a translucent overlay) compare against these colours; a probe sits in an empty corner of the city (`15/44.37000/25.97000`) or next to a known feature, and polls until the map shows the change. `pixelsOfColour` counts the pixels of one colour in a square, for an icon glyph that a median would average away. Every probe is a Playwright screenshot, and a screenshot waits for the page's fonts: a spec that holds a font request (`S-V24-BAD-ICON-FONT-LATE`) reads the held state from `document.fonts.check` and probes only after the release.
- **The fixture manifest** (`e2e/fixtures/manifest.ts`, `docs/research/M1-interfaces.md` §10): the Bucharest seed, the two synthetic layers, the POI set `scripts/seed/e2e-pois.json`, the e2e crash endpoint; `{ analytics: true }` adds a GA4 measurement id. A spec that needs another manifest changes a copy of `siteManifestData()` (what the built site serves, with its `media/` image paths; `{ layers: false }`, `{ pois: false }`, `{ analytics: true }`) and serves it with `serveManifest` (`page.route` on the site's `data/manifest.json`).
- **Fixtures** (`e2e/support/test.ts`): `firewall`, `consoleErrors` and `placeholderGuard` (automatic, checked at teardown); `instrumentation` (the map-instance counter and the engine's `hcm-*` events, from an init script); `mockApis`; `axe` (WCAG 2.0 A/AA, 2.1 AA, 2.2 AA); `inputBudget` (admin flows, checked at teardown); the worker option `lang`.

## Status today

Every viewer and starter-kit row exists (`e2e/specs/viewer/*.spec.ts`, `e2e/specs/starter-kit/`, `e2e/a11y/`, the tour) except swipe compare (V06, M4). The M2 backend rows on the `functions` tier (A01–A03, A06, A08, A10, A20, A23, A24: named by `functions/test/**`) and the `rules` row `S-A23-BAD-CLIENT-WRITE` (`firebase/rules-tests/test/history.test.ts`) exist; of the `e2e-admin` rows, the A00 harness, `S-A01-HAPPY`, `S-A01-BAD-STRANGER` and the rows the owner's journey names (`e2e/admin/specs/journey.spec.ts`: A04, A05, A06, A07, A22, A25, A26, A27, A28, A30) exist since M2b (one worker, emptied emulators per test, Google's consent replaced by a stand-in page of the mock APIs, "not deployed yet" simulated at the network edge; `docs/research/M2b-interfaces.md` §6); the other admin rows wait for their specs and the M2c screens, `S-A20-BAD-NO-APP-CHECK` with them (App Check is enforced on the HTTP path, which `.run()` skips); the pipeline rows join in M3. The `e2e` stage runs `e2e-matrix`, `e2e-build` and `playwright` (`quality/pipeline_skill.md` → *Stages*); the matrix gate also reads the tour's tags (`e2e/*.tour.ts`).

Writing a spec: import `test` and `expect` from `../../support/test.js`, never from `@playwright/test` (only the `setup` project, which opens no page, uses Playwright's own), so the network rules and the guards are always on. Open a site with `openViewer(page, { lang, hash })` (it waits for `hcm-ready` and an idle map) or `sitePath('bucharest', { lang })`; find controls by role and their catalogue text (`t(lang, key)`); a page-level `page.route` wins over the context routes and scripts one response; a bad path that provokes a block or a console error on purpose claims it with `firewall.take()` or `consoleErrors.take()` and asserts what it got. A behaviour of one window class sets its viewport in the test (`page.setViewportSize`) instead of being skipped elsewhere.

Pitfalls the M2b admin specs met:

- The admin's polls run on `page.clock`: install it, then `resume()` so the Firebase SDK's own timers run, and jump to the next poll with `fastForward`; never leave the clock paused under the SDK.
- An allowance of `setupBudget.inputs(step, allowance)` counts only on the flow's first use: declare a bad path's extra inputs there.
- A card that turns green opens the next step: a spec that still needs it reopens it with `SetupPage.show(step)` (navigation, not counted).
- Clear an injected upstream failure only after the step finished with it (wait for **Retry what failed** to be enabled), or the run may already succeed.
- A deep link opens a provider's tab that the firewall would block: answer its host with `standInProviderPages` and close the tab (`followDeepLink`).
- Resizing for a capture re-creates the Setup cards (one column versus list and detail): state that must survive lives in the controller.

Pitfalls the M1 specs met:

- Playwright's text locators skip `<noscript>` content: locate those paragraphs with CSS (`noscript p[lang="ro"]`).
- A modal sheet's or dialog's content is slotted, not a descendant of its `role="dialog"` box in the DOM: assert the dialog by role, then find its content inside the viewer element (`viewer(page).locator('hcm-about-dialog')`).
- A modal sheet makes the map and its menu inert on compact and medium windows: close it before using the menu; its height and slide transitions move the drag handle, so wait for `getAnimations()` to end before clicking or dragging it.
- Mapbox GL renders a hidden source's attribution only while a layer of it is visible; it hides the whole control (`mapboxgl-attrib-empty`) instead of clearing the text.
- A hash change on the same page does not reload it (`page.goto` with only another hash): reload or open another path when the next state needs a fresh boot.
- `page.clock.install()` fakes the timers of the page (the manifest timeout) but would also freeze Mapbox's rendering: use it only where no map is expected.
