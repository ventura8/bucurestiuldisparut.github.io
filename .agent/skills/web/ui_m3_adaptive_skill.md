# UI: Material 3 Adaptive Skill

The component kit `@hcm/ui` (`packages/ui`), shared by the engine and the admin: Lit 3 custom elements, Material 3 with M3 Expressive, adaptive to every window size. Since M1 it holds the kit's 19 elements (`packages/ui/src/components/`, all registered by `defineUiKit()`), the theme (`packages/ui/src/theme/`: dynamic colour, `applyTheme`, the system tokens, `BASELINE_THEME`), the window-class layout (`packages/ui/src/layout/window-class.ts`), the self-hosted fonts (`packages/ui/src/fonts/`, `packages/ui/fonts/`) and, under the ownership override, the viewer's elements (`packages/ui/src/viewer/`) and, since M2b, the admin's (`packages/ui/src/admin/`: shell, auth panels, Setup cards). The package guide is `packages/ui/README.md` (elements, theme, fonts, layout, *Decisions*); the component contract is `docs/research/M1-interfaces.md` §5 with change request CR-12.

## Lit without decorators

Decorators are banned by ESLint (their helpers show up as uncovered branches, and Vite 8's transform support is unclear). The pattern, as in `hcm-hello`:

```ts
export const HCM_EXAMPLE_TAG = 'hcm-example';

export class HcmExample extends LitElement {
    static override readonly properties = { label: { type: String } };

    static override readonly styles = css`
        :host {
            display: block;
        }
    `;

    declare label: string;

    constructor() {
        super();
        this.label = '';
    }

    override render(): TemplateResult {
        return html`<span>${this.label}</span>`;
    }
}

/** Registers the element once; calling it again is a no-op. */
export function defineHcmExample(registry: CustomElementRegistry = customElements): void {
    if (registry.get(HCM_EXAMPLE_TAG) === undefined) {
        registry.define(HCM_EXAMPLE_TAG, HcmExample);
    }
}
```

- `static override readonly properties`, `declare` fields, defaults in the constructor (`useDefineForClassFields: true`).
- An idempotent `define…()` function taking the registry (tests pass their own); the element prefix is always `hcm-`; add the tag to `HTMLElementTagNameMap`.
- Styles in a `static override readonly styles` built with Lit's `css` tag (linted by stylelint through `postcss-lit`); colours only from tokens.

## Material 3

- Every element is written in Lit with Google's M3 token values. `@m3e/web` 2.10.0 and `@material/web` 2.5.0 were checked in M1 and not adopted: the contract needs what neither documents (`aria-valuetext` and PageUp/PageDown on the slider, one input event per frame while dragging, sheet heights) and the embed's gzip budget argued against them (`packages/ui/README.md` → *Decisions*).
- **Colour**: `@material/material-color-utilities@0.4.0` (SpecVersion 2025, TonalSpot) generates the light, dark and high-contrast `--md-sys-color-*` tokens (53 per scheme) from the city's seed colour: `themeFromSeed` in `packages/ui/src/theme/dynamic-color.ts`, imported as `@hcm/ui/dynamic-color` (a separate entry point, so the main entry and every node test of the engine and admin never load the colour library) (also `contrastRatio`, `contrastIssues`; an invalid seed falls back to `DEFAULT_SEED_COLOR`). The tokens are precomputed into the manifest (the admin, or `node packages/ui/scripts/gen-theme.mjs --seed '#8B5E3C'`), so the viewer never ships the colour library. Unit tests require WCAG 4.5 for every text pair in the standard schemes and 7 in the high-contrast ones for a set of hard seeds; axe checks contrast per theme in the tour tier.
- The library's ESM files import without file extensions: fine for Vite and Vitest, but plain Node needs the resolve hook the CLI scripts register (`scripts/seed/migrate-legacy.mjs`).
- **Shape and motion**: the M3 shape scale, spring-derived motion curves; `prefers-reduced-motion` disables fly animations.
- **Fonts**: self-hosted Roboto Flex (`latin`, `latin-ext`, weight axis) and a Material Symbols Rounded subset holding only the names of `ICONS` (`packages/ui/src/icons.ts`: the kit's, the viewer's and every `POI_ICONS` name); never Google Fonts (GDPR). The families are namespaced (`HCM Roboto Flex`, `HCM Material Symbols Rounded`: `TEXT_FONT_FAMILY`, `ICON_FONT_FAMILY`) and registered through `document.fonts` by `installFonts(document, baseUrl)`, the kit's only global side effect (an `@font-face` inside a shadow root is ignored, an injected stylesheet would break the CSP). An icon used anywhere is first added to `UI_ICONS`, then `npm run fonts:build --workspace @hcm/ui` rebuilds the subset; the static gate `fonts` (`fonts:check`) fails when the committed files differ or a name does not shape to one glyph. The engine build copies `packages/ui/fonts/` to `dist/fonts/`.
- **Inline styles only through the CSSOM**: never Lit's `styleMap` (ESLint refuses its import) or a `style=${…}` binding (the e2e console guard catches it). Their first render writes a `style` attribute, which the city page's CSP (`style-src` without `'unsafe-inline'`) refuses, so a kit slider or progress bar logged a CSP violation in the viewer smoke. Use the element directive `cssProperties({...})` (`packages/ui/src/components/css-properties.ts`), which sets and removes custom properties with `style.setProperty`. Lit's own styles use adopted stylesheets, which the CSP allows.
- **Stacking**: the viewer sets `--hcm-sheet-z-index` so the kit's modal sheets cover its floating controls; the open FAB menu sits above the consent banner and the snackbar. The modal sheets and the lightbox are positioned against the viewer's modal layer, which ends above the legal bar (the Mapbox logo and attribution, z-index 32), so no modal surface covers them; About uses the native `<dialog>` (top layer) and carries its own copy at its foot.
- **Never lay out on `:host` what a page can undo**: a page's style on the element (`hcm-map-viewer { display: block }`) beats the component's `:host` rule, so a grid or flex layout lives on an inner wrapper (the viewer's `.viewer`); `:host` keeps only what may be overridden (`docs/LESSONS.md` #23).
- **The kit's snackbar positions itself** at the bottom of its positioned container (`:host { position: absolute; bottom: 16px }`): an app that docks it elsewhere sets `position: static` on it from outside (the viewer's top toast dock), or it lands off screen.
- **Text on a fixed backdrop**: the lightbox scrim is dark in every theme, so no theme colour is drawn on it directly: its header and error message sit on `surface-container` with `on-surface` text, its arrows are tonal icon buttons. Colours stay tokens (stylelint forbids hex and named colours). The scrim is opaque (a translucent one let the photo sheet and the menu show around the photo), and the stage's single track is `minmax(0, 1fr)`: an image's percentage `max-block-size` inside an `auto` grid track resolves against its own height, so a landscape photo on a short window was cropped instead of fitted.

## Adaptive layout

- Window classes are measured on the **host element** with container queries and a `ResizeObserver` (which also calls `map.resize()`), not on the viewport: compact below 600, medium 600–839, expanded 840–1199, large 1200–1599, extra-large from 1600 (`'extra-large'`); compact height below 480 for landscape phones (`WINDOW_CLASS_BREAKPOINTS`, `windowClassFor`, `isCompactHeight`, `WindowClassController`).
- Touch targets at least 48 dp (`TOUCH_TARGET_MIN_PX`), safe areas, `dvh`, logical properties. A control drawn smaller (the slider's 4 px handle, the timeline's 40 px thumb) gets the `touch-target` class and the kit's `touchTarget` styles (a 48 × 48 `::after`); a link of a list is 48 px tall (`detailStyles`); a link inside a sentence is exempt (WCAG 2.5.8).
- Floating controls carry `data-layout-check="<name>"` (the viewer's timeline, note, chip, menu, consent banner and toast): the tour checks that no two overlap and that each stays on screen. On compact the "photos near this year" chip sits a row above the menu button; on a landscape phone the FAB menu is at most `--hcm-fab-menu-max-block-size` tall and its items continue in a second column (a scrolling menu would not be keyboard-reachable). The menu docks on the leading edge there and sets `--hcm-fab-menu-align: flex-start`, so the FAB and its items line up on that edge: aligned to the end, the wider wrapped menu moved the FAB from under the finger. A control must never move when it is tapped (the tour cannot see this: check the screenshots).
- Romanian labels are long: a control's width comes from its content and its container, never an equal share. `hcm-segmented-button` segments are content-sized (`flex: 1 1 auto`), never wider than their container, and a long label wraps inside a taller segment instead of scrolling the page sideways; at compact width the About dialog drops the theme icons (only the check mark stays). A layout test measures label heights and the container's `scrollWidth` (`packages/ui/test/components/segmented-button.test.ts`).
- A sibling margin of a shared style (`detailStyles`' `.details li + li`) must not reach a list laid out by a grid or flex `gap`: the margin adds to the gap and pushes every later item down (the POI sheet's second photo thumbnail sat 4 px lower; `docs/LESSONS.md` #22). Reset it in the component and measure the items' edges in a unit test.
- Navigation: bottom sheet and navigation bar on compact, side sheet and rail from medium; no drawer.
- The admin (`packages/ui/src/admin/`, entry `@hcm/ui/admin`, M2b): a navigation bar on compact windows, a collapsed rail from medium, the expanded rail (labels beside the icons, not modal) from large, and on a landscape phone (compact height) a rail with the account button at its foot and no top bar; the snackbar sits fixed above the bar. The Setup page is one column below 840 px and list and detail from there (the detail at most 840 px wide); it follows only its own width class and applies a change on the next animation frame, because changing its layout from the `ResizeObserver` callback resized what it observed (`docs/LESSONS.md` 45). A card re-created by a layout change keeps nothing of its own: typed fields live in the controller's state.
- The tour tier (`e2e/tour/viewer.tour.ts`) checks every screen at 11 viewports, light and dark, RO and EN: no horizontal overflow, no overlap of `[data-layout-check]` elements, no clipped labels (decorative icon ligatures and screen-reader-only `.visually-hidden` text excepted), 48 px touch targets on compact, visible focus, axe, the i18n leak check.

## Accessibility

- Every interactive element has a role and an accessible name; keyboard order follows the visual order; focus returns to the opener when a dialog or lightbox closes.
- Move the focus before announcing an action: a menu closes and focuses its button, then fires `hcm-select`, because whoever reacts records the focused element as the opener (a vanished menu item left the focus on `<body>`; `docs/LESSONS.md` #12).
- Never disable or remove the control that has the focus without moving the focus first: Chromium drops it to `<body>`, where Esc and the arrow keys no longer reach the dialog (the lightbox's Next button on the last photo; `docs/LESSONS.md` #19).
- Every modal (native `hcm-dialog`, a modal `hcm-sheet`, the lightbox) traps Tab with `trapTab`; Shift+Tab on the focused container itself wraps to the last control, so a modal that focuses its container on open is never left backwards.
- A live region exists, empty, before the text it announces: one created together with its text is not announced. `hcm-snackbar` keeps a visually hidden polite region and fills it with the message alone `ANNOUNCE_DELAY_MS` after it shows (`docs/LESSONS.md` #20); the overlay list's region is always rendered.
- Forced colours stay readable; nothing is conveyed by colour alone.
- Tests: Vitest browser mode with `page.getByRole`, keyboard interaction, RO and EN strings, window-class variants, reduced motion (`quality/testing_strategy_skill.md`).
