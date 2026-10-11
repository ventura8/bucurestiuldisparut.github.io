# E2E Scenario Matrix Skill

Every user-visible behaviour of **Historic City Map** has at least one **happy** and one **bad** scenario, registered in `e2e/scenarios.json` before the behaviour counts as done. The registry was seeded from `docs/research/design-review-testability.md` §4.5 (viewer V01–V18, admin A01–A21, pipeline P01–P02) plus the consent and crash-reporting behaviours of `docs/research/PLAN.md` → *Addendum 2* (V19, V20, A22) and the M1 contracts of `docs/research/M1-interfaces.md` §9 (the embed API V21, and rows for engine compatibility, the overlay and legacy hashes, markup in About, a photo without bearing and a mismatched `cityId`).

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
4. Assert what the user sees (text, ARIA, a pixel probe, a recorded request); drive the app from outside; mock only external boundaries (Mapbox, USGS, STAC, Nominatim, AI, the network), never an owned module; no network, no sleeps, no wall clock.
5. Format the registry with Prettier (4 spaces) and keep every row on the schema above. Titles and `asserts` are copied verbatim into the Markdown tables of `docs/E2E_SCENARIOS.md`: describe markup in words (no raw `<tag>`), or markdownlint rejects the generated doc.
6. A bug a scenario found goes into `docs/LESSONS.md` with the row id that now pins it.
7. The tour tier checks layout, axe and ARIA snapshots on every screen and state; it backs V15, V18 and A21 but does not replace their functional rows.

## Tiers and projects (M1)

- **Functional matrix**: `fn-c360-ro`, `fn-m768-ro`, `fn-l1440-ro`, plus `fn-l1440-en` and `fn-c360-dark`.
- **Tour**: 11 viewports (320×568 to 3840×2160, including 915×412 landscape) × light/dark × RO/EN.
- **A11y specials**: reduced motion, forced colours; **no-WebGL**; **Firefox and WebKit** for admin forms.
- **Pipeline** (compose): the worker against the emulators and the mock M2M server.
- **Admin-input budget** fixture: counts fills, clicks and file inputs per flow (Mapbox setup at most 2 inputs, importing a free scene at most 2 clicks).
- **Map-instance counter**: exactly one map load per page view; swipe compare creates the second map lazily and destroys it.

## Status today

Only the harness smoke exists: behaviour `V00` (`S-V00-HAPPY`, `S-V00-BAD-BLOCKED-HOST`) in `e2e/specs/smoke.spec.ts` proves the e2e preconditions (SwiftShader WebGL2, the firewall and console-guard fixtures of `e2e/support/test.ts`); every product row is `planned` until M1. The `e2e` stage runs `e2e-matrix` and `playwright` (`quality/pipeline_skill.md` → *Stages*).

Writing a spec: import `test` and `expect` from `../support/test.js`, never from `@playwright/test`, so the firewall and the console guard are always on. Mock an external host with `page.route` or `context.route` (registered later, so it wins over the firewall); a bad path that provokes a block or a console error on purpose claims it with `firewall.take()` or `consoleErrors.take()` and asserts what it got. Pages under test come from a loopback origin (`baseURL` `http://127.0.0.1:4310`); M1 adds the `webServer` that serves the built site.
