# UI: Material 3 Adaptive Skill

The component kit `@hcm/ui` (`packages/ui`), shared by the engine and the admin: Lit 3 custom elements, Material 3 with M3 Expressive, adaptive to every window size. Today it holds the window-class tokens (`packages/ui/src/theme/tokens.ts`) and the scaffolding sample `hcm-hello` (`packages/ui/src/hcm-hello.ts`).

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

- Google's `@material/web` is in maintenance mode and M3 Expressive is not implemented on the web, so Expressive components come from `@m3e/web` (pinned) and stable `@material/web` form controls are used in the admin; both sit behind our own `hcm-*` wrappers in `@hcm/ui`. These dependencies are added in the milestone that first imports them.
- **Colour**: `@material/material-color-utilities` generates light, dark and high-contrast `--md-sys-color-*` tokens from the city's seed colour; the admin precomputes them into the manifest. A low-contrast seed is adjusted with a warning; contrast is checked by axe per theme in the tour tier.
- **Shape and motion**: the M3 shape scale, spring-derived motion curves; `prefers-reduced-motion` disables fly animations.
- **Fonts**: self-hosted Roboto Flex and a subsetted Material Symbols font; never Google Fonts (GDPR).

## Adaptive layout

- Window classes are measured on the **host element** with container queries and a `ResizeObserver` (which also calls `map.resize()`), not on the viewport: compact below 600, medium 600–839, expanded 840–1199, large 1200–1599, extra-large from 1600; compact height below 480 for landscape phones (`WINDOW_CLASS_BREAKPOINTS`, `windowClassFor`, `isCompactHeight`).
- Touch targets at least 48 dp (`TOUCH_TARGET_MIN_PX`), safe areas, `dvh`, logical properties.
- Navigation: bottom sheet and navigation bar on compact, side sheet and rail from medium; no drawer.
- The tour tier checks every screen at 11 viewports, light and dark, RO and EN: no horizontal overflow, no overlap of `[data-layout-check]` elements, no clipped labels, visible focus.

## Accessibility

- Every interactive element has a role and an accessible name; keyboard order follows the visual order; focus returns to the opener when a dialog or lightbox closes.
- Forced colours stay readable; nothing is conveyed by colour alone.
- Tests: Vitest browser mode with `page.getByRole`, keyboard interaction, RO and EN strings, window-class variants, reduced motion (`quality/testing_strategy_skill.md`).
