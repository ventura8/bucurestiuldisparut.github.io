import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

/**
 * The axe helper of the tour and a11y tiers (docs/research/design-review-testability.md §4.3): WCAG 2.0 A and AA,
 * 2.1 AA and 2.2 AA, run on the live page (shadow roots included). Contrast is judged per theme, so a dark-mode
 * project catches a seed colour that fails there. The map canvas is excluded: it has no DOM content to audit, and
 * Mapbox's own controls are checked where they sit.
 */
const AXE_TAGS: readonly string[] = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'];

export interface AxeViolation {
    readonly id: string;
    readonly impact: string;
    readonly targets: readonly string[];
}

/** The violations on `page` (empty when it passes), optionally limited to `include` selectors. */
export async function axeViolations(page: Page, include: readonly string[] = []): Promise<AxeViolation[]> {
    let builder = new AxeBuilder({ page }).withTags([...AXE_TAGS]).exclude('canvas.mapboxgl-canvas');
    for (const selector of include) {
        builder = builder.include(selector);
    }
    const results = await builder.analyze();
    return results.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact ?? 'unknown',
        targets: violation.nodes.map((node) => node.target.join(' ')),
    }));
}
