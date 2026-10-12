import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

/**
 * The axe helper of the tour and a11y tiers (docs/research/design-review-testability.md §4.3): WCAG 2.0 A and AA,
 * 2.1 AA and 2.2 AA, run on the live page (shadow roots included). Contrast is judged per theme, so a dark-mode
 * project catches a seed colour that fails there. The map canvas is excluded: it has no DOM content to audit, and
 * Mapbox's own controls are checked where they sit.
 */
const AXE_TAGS: readonly string[] = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'];

/**
 * `css-orientation-lock` parses the page's stylesheets in a scratch document that inherits the page's CSP, whose
 * `style-src` refuses the `<style>` elements axe writes there (its CSSOM preload): under the city sites' policy it
 * cannot run and would only log CSP violations. So the rule is off and nothing is preloaded (the other preload, media
 * readiness, serves audio and video rules; the viewer has neither). The viewer's styles lock no orientation.
 */
const RULES_BLOCKED_BY_THE_PAGE_CSP: readonly string[] = ['css-orientation-lock'];

export interface AxeOptions {
    /** Selectors to limit the check to (the whole page by default). */
    readonly include?: readonly string[];
    /** Rules that do not apply to the page as emulated (the colour rules under forced colours). */
    readonly skipRules?: readonly string[];
}

export interface AxeViolation {
    readonly id: string;
    readonly impact: string;
    readonly targets: readonly string[];
}

/** The violations on `page` (empty when it passes), optionally limited to `include` selectors. */
export async function axeViolations(page: Page, options: AxeOptions = {}): Promise<AxeViolation[]> {
    // `options` replaces the run options, so it comes before the tags and rules that add to them.
    let builder = new AxeBuilder({ page })
        .options({ preload: false })
        .withTags([...AXE_TAGS])
        .disableRules([...RULES_BLOCKED_BY_THE_PAGE_CSP, ...(options.skipRules ?? [])])
        .exclude('canvas.mapboxgl-canvas');
    for (const selector of options.include ?? []) {
        builder = builder.include(selector);
    }
    const results = await builder.analyze();
    return results.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact ?? 'unknown',
        targets: violation.nodes.map((node) => node.target.join(' ')),
    }));
}
