# UI: Material 3 Adaptive Skill

The component kit `@hcm/ui` (`packages/ui`), shared by the engine and the admin: Lit 3 custom elements, Material 3 with M3 Expressive, adaptive to every window size. Since M1 it holds the kit's 19 elements (`packages/ui/src/components/`, all registered by `defineUiKit()`), the theme (`packages/ui/src/theme/`: dynamic colour, `applyTheme`, the system tokens, `BASELINE_THEME`), the window-class layout (`packages/ui/src/layout/window-class.ts`), the self-hosted fonts (`packages/ui/src/fonts/`, `packages/ui/fonts/`) and, under the ownership override, the viewer's elements (`packages/ui/src/viewer/`). The package guide is `packages/ui/README.md` (elements, theme, fonts, layout, *Decisions*); the component contract is `docs/research/M1-interfaces.md` §5 with change request CR-12.

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
- **Inline styles only through the CSSOM**: never Lit's `styleMap` or a `style=${…}` binding. Their first render writes a `style` attribute, which the city page's CSP (`style-src` without `'unsafe-inline'`) refuses, so a kit slider or progress bar logged a CSP violation in the viewer smoke. Use the element directive `cssProperties({...})` (`packages/ui/src/components/css-properties.ts`), which sets and removes custom properties with `style.setProperty`. Lit's own styles use adopted stylesheets, which the CSP allows.
- **Stacking**: the viewer sets `--hcm-sheet-z-index` so the kit's modal sheets cover its floating controls; the open FAB menu sits above the consent banner and the snackbar.

## Adaptive layout

- Window classes are measured on the **host element** with container queries and a `ResizeObserver` (which also calls `map.resize()`), not on the viewport: compact below 600, medium 600–839, expanded 840–1199, large 1200–1599, extra-large from 1600 (`'extra-large'`); compact height below 480 for landscape phones (`WINDOW_CLASS_BREAKPOINTS`, `windowClassFor`, `isCompactHeight`, `WindowClassController`).
- Touch targets at least 48 dp (`TOUCH_TARGET_MIN_PX`), safe areas, `dvh`, logical properties.
- Navigation: bottom sheet and navigation bar on compact, side sheet and rail from medium; no drawer.
- The tour tier checks every screen at 11 viewports, light and dark, RO and EN: no horizontal overflow, no overlap of `[data-layout-check]` elements, no clipped labels, visible focus.

## Accessibility

- Every interactive element has a role and an accessible name; keyboard order follows the visual order; focus returns to the opener when a dialog or lightbox closes.
- Forced colours stay readable; nothing is conveyed by colour alone.
- Tests: Vitest browser mode with `page.getByRole`, keyboard interaction, RO and EN strings, window-class variants, reduced motion (`quality/testing_strategy_skill.md`).
