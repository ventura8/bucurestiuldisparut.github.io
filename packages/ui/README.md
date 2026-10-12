# `@hcm/ui`: the Material 3 Expressive kit

The component kit shared by the viewer engine and the admin: Lit 3 custom elements without decorators, `hcm-` tags,
Material 3 with the M3 Expressive update, adaptive to the box it is given. The contract (tags, properties, events,
slots) is `docs/research/M1-interfaces.md` §5.1; the additions made while building it are change request CR-12 there.
The viewer's own elements live in `src/viewer/` (engine-ui workstream) and are not described here.

## Elements

Every element has an idempotent `defineHcm<Name>(registry = customElements)` that also registers the elements it
renders; `defineUiKit(registry)` registers all of them. Every event is a bubbling, composed `CustomEvent`. Strings are
passed in already localized (the kit has no catalogue of its own).

| Tag | Role, keyboard and events |
| --- | --- |
| `hcm-icon` | Material Symbols Rounded ligature from the bundled subset; `filled` uses the FILL axis; a name outside the subset draws nothing. |
| `hcm-button` | M3 Expressive small button (40 px in a 48 px target): `filled`, `tonal`, `outlined`, `text`; the slot is the name. |
| `hcm-icon-button` | `label` is the name; `toggle` makes it `aria-pressed` and fires `hcm-change` `{selected}`; `variant` `standard`, `filled`, `tonal`, `outlined`. |
| `hcm-fab` | `small` 40, `medium` 56 (M3 FAB), `large` 96 px; `extended` shows the label. |
| `hcm-fab-menu` | FAB with `aria-haspopup="menu"`; arrows, Home, End, Esc; `hcm-select` `{value}`, `hcm-toggle` `{open}`. |
| `hcm-switch` | `role="switch"`; `hcm-change` `{checked}`; the selected handle shows a check mark. |
| `hcm-slider` | `role="slider"` with `aria-valuetext`; arrows ±step, PageUp/PageDown ±a tenth, Home/End; `hcm-input` per frame or key, `hcm-change` on release. |
| `hcm-chip` | Filter chip, `aria-pressed`; `hcm-change` `{selected}`. |
| `hcm-segmented-button` | Radio group with one Tab stop and wrapping arrows; `hcm-change` `{value}`. Segments are as wide as their labels and wrap a long label in a narrow container. |
| `hcm-card`, `hcm-list`, `hcm-list-item` | Containers; an `interactive` list item is a button. |
| `hcm-sheet` | `bottom` (handle: tap cycles peek, half, full; ArrowUp/ArrowDown; drag snaps or closes) or `side`; `modal` adds a scrim and a Tab trap; focus moves in on open and back on close; `hcm-close`, `hcm-detent-change`. |
| `hcm-dialog` | Native modal `<dialog>`; Tab wraps; Esc, close button and scrim close it with `returnValue` `cancel`, `close`, `scrim`; `close(value)` for actions; `fullscreen`. |
| `hcm-snackbar` | Always-present polite live region; timeout pauses on hover and focus; `hcm-action`, `hcm-dismiss` `{reason}`. |
| `hcm-progress`, `hcm-loading-indicator` | `role="progressbar"`; the Expressive loading indicator morphs, and only pulses under reduced motion. |
| `hcm-toolbar` | Floating toolbar, `role="toolbar"`, one Tab stop, arrows of its `orientation`, Home and End. |
| `hcm-consent-banner` | Non-modal region; Accept and Decline look the same; `hcm-consent` `{decision}`. |
| `hcm-overlay-list` | The live-transparency list of PLAN Addendum 3 (switch and 0–100 % slider per overlay, group headings, polite announcements). |

## Theme

- `applyTheme(target, tokens, mode, highContrast)` (`src/theme/apply.ts`) writes the scheme's `--md-sys-color-*` tokens
  plus every system token into one constructable stylesheet per target, through the CSSOM (no inline style, so the strict
  CSP holds and a token value cannot escape its declaration). `system` follows `prefers-color-scheme`; every mode follows
  `prefers-contrast: more`; `prefers-reduced-motion: reduce` turns the spatial springs off. `clearTheme` removes it.
- `src/theme/system.ts`: the shape scale (with 20, 32 and 48 px), the type scale and its emphasized weights, the
  Expressive springs as Google's web cubic-bezier curves, elevation shadows and state-layer opacities, from
  `@material/web@2.5.0` `tokens/versions/latest` (design system 34.0.21).
- `src/theme/baseline.ts`: the precomputed theme of the default seed, for the viewer's loading and error states before
  a manifest arrives (the viewer never ships the colour library).
- `@hcm/ui/dynamic-color`: `themeFromSeed(seed, variant)` with `tonalSpot` (default), `expressive` or `vibrant`.

## Fonts and icons

- `fonts/`: Roboto Flex (weight axis, `latin` and `latin-ext`) and a Material Symbols Rounded subset that holds only the
  ligatures of `ICONS` (`src/icons.ts`: the kit's icons plus `POI_ICONS`). Licences: `fonts/LICENSES.md`.
- Rebuild after changing `ICONS`, and verify, in the quality image:

  ```bash
  npm run fonts:build --workspace @hcm/ui   # HarfBuzz subset, wght 400 / GRAD 0 / opsz 24 pinned, FILL kept
  npm run fonts:check --workspace @hcm/ui   # byte-identical rebuild and every name shapes to one glyph
  ```

- `installFonts(document, baseUrl)` registers the faces with `document.fonts` (namespaced families `HCM Roboto Flex`
  and `HCM Material Symbols Rounded`): the kit's only global side effect, needed because `@font-face` inside a shadow
  root is ignored. `loadIconFont(document)` resolves when the icon font can be drawn (POI icons on the map).

## Layout

`WindowClassController` measures its host with a `ResizeObserver` (never the viewport, so an embedded map adapts to its
box), re-renders on a class change and reflects `window-class` and `height-class` attributes. Width classes are M3's
(`compact` < 600, `medium` < 840, `expanded` < 1200, `large` < 1600, `extra-large`); height classes `compact` < 480,
`medium` < 900, `expanded`. `atLeast()` and `onlyWindowClass()` give the same breakpoints to `@container` rules.

## Decisions

- **No `@m3e/web` or `@material/web` runtime.** Both were checked on npm on 2026-10-12 (`@m3e/web` 2.10.0, MIT, one
  maintainer, no `sideEffects` field, pulls `@floating-ui/dom`, `composed-offset-position` and `tslib`; `@material/web`
  2.5.0 is in maintenance mode and its Expressive components are "Labs", not for production). The contract needs
  behaviour neither documents (`aria-valuetext` and PageUp/PageDown on the slider, per-frame input coalescing, detents),
  and the engine is an embed with a 150 KB gzip budget, so every element is written in Lit with Google's token values
  (the research's option b). The `hcm-*` API stays the seam if a library is adopted later.
- **Inline styles only through the CSSOM.** The city page's CSP has no `'unsafe-inline'` for styles, and Lit's
  `styleMap` writes a `style` attribute on its first render, which that CSP refuses (found by the viewer smoke in the
  M1 integration). Every element sets custom properties with the `cssProperties` directive
  (`src/components/css-properties.ts`), which uses `style.setProperty` and removes a property a later render drops.
- **Font tooling is npm, not Python**: `harfbuzzjs` (WASM) subsets and shapes, `wawoff2` decodes and encodes WOFF2;
  both run in the quality image with nothing added to it.

## Tests

Vitest browser mode (Chromium), one file per element under `test/components/`: roles and names through `page.getByRole`,
real key presses and clicks through `userEvent`, synthetic pointer events for drags, fake timers for the snackbar, and
`axeViolations` from `@hcm/test-support/axe` (WCAG 2.2 AA rules) on every element. `test/helpers.ts` renders into a host
themed with the baseline theme and the real fonts.
