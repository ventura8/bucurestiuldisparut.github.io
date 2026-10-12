# E2E Scenario Matrix Skill

Every user-visible behaviour of **Historic City Map** has at least one **happy** and one **bad** scenario, registered in `e2e/scenarios.json` before the behaviour counts as done. The registry was seeded from `docs/research/design-review-testability.md` §4.5 (viewer V01–V18, admin A01–A21, pipeline P01–P02) plus the consent and crash-reporting behaviours of `docs/research/PLAN.md` → *Addendum 2* (V19, V20, A22) and the M1 contracts of `docs/research/M1-interfaces.md` §9 (the embed API V21, and rows for engine compatibility, the legacy hash, markup in About, a photo without bearing and a mismatched `cityId`), plus PLAN Addendum 3: live overlay opacity (V22), overlay opacity in the URL hash (V23, which took over the two `op=` rows of V05) and points of interest (V24), served from the e2e fixture manifest of `docs/research/M1-interfaces.md` §10.

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
2. A test names its scenarios: Playwright with `{ tag: '@S-...' }`, pytest with a docstring line `Scenarios: S-..., S-...`. Test files are searched under `e2e/`, `pipeline/tests/`, `functions/test/` and `firebase/rules-tests/`.
3. The `e2e-matrix` gate (`python3 scripts/ci/check_e2e_matrix.py check`) works in both directions: every named id is registered, every `exists` row is named by a test, no `planned` row is (flip it to `exists`), ids are unique, every behaviour has a happy and a bad row, and `docs/E2E_SCENARIOS.md` is current. After any registry or tag change run `python3 scripts/ci/check_e2e_matrix.py write` in the image and commit the regenerated doc.
4. A new behaviour takes the next free id in `behaviours`, whatever a brief called it (Addendum 3's V21–V23 became V22–V24 because V21 already existed); say so in the task's notes.
5. Assert what the user sees (text, ARIA, a pixel probe, a recorded request); drive the app from outside; mock only external boundaries (Mapbox, USGS, STAC, Nominatim, AI, the network), never an owned module; no network, no sleeps, no wall clock.
6. Format the registry with Prettier (4 spaces) and keep every row on the schema above. Titles and `asserts` are copied verbatim into the Markdown tables of `docs/E2E_SCENARIOS.md`: describe markup in words (no raw `<tag>`), or markdownlint rejects the generated doc.
7. A bug a scenario found goes into `docs/LESSONS.md` with the row id that now pins it.
8. The tour tier checks layout, axe and ARIA snapshots on every screen and state; it backs V15, V18 and A21 but does not replace their functional rows.

## Tiers and projects (M1)

The projects are built by `e2e/projects.ts` and chosen with `E2E_TIER` (comma-separated tiers; unset or `all` runs every tier). Every project runs Chromium under SwiftShader behind the host-resolver rules and depends on `setup` (`e2e/setup/fixture.setup.ts`: the fixture manifest validates, both servers answer, the built site serves the fixture).

- **`smoke`**: `harness` (`e2e/specs/harness/`: WebGL2, the firewall, Mapbox GL drawing the mock tiles), `smoke-c360` and `smoke-l1440` (`e2e/specs/smoke/`: the viewer boots with one map load).
- **`fn`**, the functional matrix (`e2e/specs/viewer/`, `e2e/specs/starter-kit/`): `fn-c360-ro`, `fn-m768-ro`, `fn-l1440-ro`, plus `fn-l1440-en` (option `lang: 'en'`) and `fn-c360-dark`.
- **`tour`**: 11 viewports (320×568 to 3840×2160, including 915×412 landscape) × light/dark × RO/EN, `tour-<viewport>-<scheme>-<lang>`, specs in `e2e/tour/*.tour.ts`.
- **`a11y`**: `a11y-reduced-motion`, `a11y-forced-colors` (specs in `e2e/a11y/`); **`nogl`**: `--disable-3d-apis`, spec `e2e/specs/viewer/no-webgl.spec.ts` (the functional projects ignore it).
- Planned: **Firefox and WebKit** for admin forms and the **pipeline** compose tier (M2, M3).

The world the specs run in:

- **Servers** (`webServer`, `e2e/mock-apis/main.ts`): the built sites `dist/e2e-site` on `127.0.0.1:4310` (as GitHub Pages serves them) and the mock APIs on `127.0.0.1:4311`. `npm run build:site:e2e` (gate `e2e-build`) builds the engine and both sites first.
- **Network** (`e2e/support/network.ts`): loopback passes; the mocked hosts of `e2e/mock-apis/hosts.ts` (`api.mapbox.com`, `events.mapbox.com`, the GA4 and Firebase hosts, `cdn.jsdelivr.net`, `tiles.e2e.test`, `telemetry.e2e.test`) are forwarded to the mock APIs and recorded per test; anything else is blocked and fails the test. WebSockets follow the same rule.
- **Mock APIs** (`e2e/mock-apis/router.ts`): Mapbox GL JS 3.32.0 from the pinned npm package (so Subresource Integrity holds), a minimal Standard-like basemap (`style.ts`: a fragment with the `show3dObjects` schema and the `bottom`/`middle`/`top` slots), TileJSON and solid-colour tiles generated with sharp (`tiles.ts`), generated SDF box glyphs (`glyphs.ts`), an empty sprite and icon set, map sessions, `events.mapbox.com` and analytics beacons (204), the crash endpoint. `GET /__calls?test=<id>&host=<host>` lists the recorded calls (the `mockApis` fixture reads them), `POST /__reset` forgets them.
- **The e2e world** (`e2e/fixtures/world.ts`): ports, the test values (`pk.e2e-fake-token`, `G-E2E0000000`), the synthetic layers and their colours (`ventura86.e2e-1966` red, the xyz layer `e2e-1980` green, a broken tileset whose tiles answer 404), the basemap background. Pixel probes (`probePixel`, `isColour` in `e2e/support/site.ts`) compare against these colours.
- **The fixture manifest** (`e2e/fixtures/manifest.ts`, `docs/research/M1-interfaces.md` §10): the Bucharest seed, the two synthetic layers, the POI set `scripts/seed/e2e-pois.json`, the e2e crash endpoint; `{ analytics: true }` adds a GA4 measurement id. A bad-path spec serves a broken copy with `page.route` on the site's `data/manifest.json`.
- **Fixtures** (`e2e/support/test.ts`): `firewall`, `consoleErrors` and `placeholderGuard` (automatic, checked at teardown); `instrumentation` (the map-instance counter and the engine's `hcm-*` events, from an init script); `mockApis`; `axe` (WCAG 2.0 A/AA, 2.1 AA, 2.2 AA); `inputBudget` (admin flows, checked at teardown); the worker option `lang`.

## Status today

The harness (`V00`: `S-V00-HAPPY`, `S-V00-BAD-BLOCKED-HOST`, `S-V00-HAPPY-MOCK-MAP`, `S-V00-BAD-UNMOCKED-PATH`), the viewer smoke (`S-V16-HAPPY`), the page without JavaScript (`S-V01-BAD-NO-JAVASCRIPT`) and the page's CSP (`S-V16-BAD-INLINE-SCRIPT`) exist; every other product row is `planned` until the viewer behaviour and its spec land. The `e2e` stage runs `e2e-matrix`, `e2e-build` and `playwright` (`quality/pipeline_skill.md` → *Stages*).

Writing a spec: import `test` and `expect` from `../../support/test.js`, never from `@playwright/test` (only the `setup` project, which opens no page, uses Playwright's own), so the network rules and the guards are always on. Open a site with `sitePath('bucharest', { lang })`; a page-level `page.route` wins over the context routes and scripts one response; a bad path that provokes a block or a console error on purpose claims it with `firewall.take()` or `consoleErrors.take()` and asserts what it got. Playwright's text locators skip `<noscript>` content: locate those paragraphs with CSS (`noscript p[lang="ro"]`).
