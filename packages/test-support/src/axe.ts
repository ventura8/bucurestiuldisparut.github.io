/**
 * axe-core accessibility checks for component tests in Vitest browser mode (Chromium). The rule set is the one of the
 * e2e a11y tier (`docs/research/design-review-testability.md` §4.3): WCAG 2.0 A/AA, 2.1 AA and 2.2 AA. Import it from
 * `@hcm/test-support/axe`, only in browser-mode tests: axe needs a real DOM.
 */
import axe from 'axe-core';

export const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] as const;

/**
 * The violations of `context` (an element and everything in its shadow trees), one line each:
 * `<rule id>: <selectors of the failing nodes>`. An empty array means the subtree passes.
 */
export async function axeViolations(context: Element): Promise<string[]> {
    const results = await axe.run(context, {
        runOnly: { type: 'tag', values: [...AXE_TAGS] },
        resultTypes: ['violations'],
    });
    return results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`);
}
