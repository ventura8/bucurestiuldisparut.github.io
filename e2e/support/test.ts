import { test as base, expect, type APIRequestContext, type Page } from '@playwright/test';

import { axeViolations, type AxeOptions, type AxeViolation } from './a11y.js';
import { InputBudget } from './budget.js';
import { ENGINE_EVENTS, instrumentPage, readInstrumentation, type E2eInstrumentation } from './instrumentation.js';
import { installNetwork, Recorder } from './network.js';
import { leakedPlaceholders } from './placeholders.js';
import { MockApis } from './site.js';

/**
 * The fixtures every e2e spec imports instead of `@playwright/test` (docs/research/design-review-testability.md §4.2):
 *
 * - `firewall` (automatic): loopback passes, a mocked host is answered by the mock APIs, anything else is aborted and
 *   recorded, and the test fails at teardown if anything was blocked (support/network.ts). Chromium's host-resolver
 *   rules (playwright.config.ts) are the second layer.
 * - `consoleErrors` (automatic): console errors and uncaught page errors fail the test at teardown.
 * - `placeholderGuard` (automatic): visible text showing `undefined`, `null`, `NaN`, `[object Object]` or an unfilled
 *   `{param}` fails the test at teardown (support/placeholders.ts).
 * - `instrumentation` (automatic init script): the map-instance counter and the engine's events; read them with
 *   `instrumentation.read(page)`.
 * - `mockApis`: this test's calls as the mock APIs recorded them (map loads, analytics beacons, error reports).
 * - `axe`: the WCAG 2.2 AA check of the tour and a11y tiers.
 * - `inputBudget`: counted admin inputs per flow, checked at teardown.
 * - option `lang` (`ro` default, `en` in the English projects): the language a spec opens the viewer in.
 *
 * A bad-path test that provokes a block or an error on purpose claims it with `take()`, which returns the recorded
 * entries and clears them, and asserts on what it got.
 */

interface Instrumentation {
    read(page: Page): Promise<E2eInstrumentation>;
}

interface Axe {
    violations(options?: AxeOptions): Promise<AxeViolation[]>;
}

interface TestFixtures {
    firewall: Recorder;
    consoleErrors: Recorder;
    placeholderGuard: undefined;
    instrumentation: Instrumentation;
    mockApis: MockApis;
    axe: Axe;
    inputBudget: InputBudget;
}

export interface WorkerOptions {
    /** The viewer language of the project (`?lang=`). */
    lang: 'ro' | 'en';
}

interface WorkerFixtures extends WorkerOptions {
    mockApiRequest: APIRequestContext;
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
    lang: ['ro', { option: true, scope: 'worker' }],
    mockApiRequest: [
        async ({ playwright }, use) => {
            const api = await playwright.request.newContext();
            await use(api);
            await api.dispose();
        },
        { scope: 'worker' },
    ],
    firewall: [
        async ({ context, mockApiRequest }, use, testInfo) => {
            const blocked = new Recorder();
            await installNetwork(context, mockApiRequest, `${testInfo.testId}#${String(testInfo.retry)}`, blocked);
            await use(blocked);
            expect(blocked.take(), 'requests outside the loopback and mocked hosts were blocked').toEqual([]);
        },
        { auto: true },
    ],
    consoleErrors: [
        async ({ page }, use) => {
            const errors = new Recorder();
            page.on('console', (message) => {
                if (message.type() === 'error') {
                    errors.record(message.text());
                }
            });
            page.on('pageerror', (error) => {
                errors.record(`uncaught ${error.name}: ${error.message}`);
            });
            await use(errors);
            expect(errors.take(), 'console errors or uncaught page errors').toEqual([]);
        },
        { auto: true },
    ],
    placeholderGuard: [
        async ({ page }, use) => {
            await use(undefined);
            expect(await leakedPlaceholders(page), 'visible text shows a leaked placeholder').toEqual([]);
        },
        { auto: true },
    ],
    instrumentation: [
        async ({ context }, use) => {
            await context.addInitScript(instrumentPage, ENGINE_EVENTS);
            await use({ read: readInstrumentation });
        },
        { auto: true },
    ],
    mockApis: async ({ mockApiRequest }, use, testInfo) => {
        await use(new MockApis(mockApiRequest, `${testInfo.testId}#${String(testInfo.retry)}`));
    },
    axe: async ({ page }, use) => {
        await use({ violations: (options = {}) => axeViolations(page, options) });
    },
    inputBudget: async ({ page }, use) => {
        const budget = new InputBudget();
        await use(budget);
        expect(budget.overruns(), `admin flows over their input budget, ending on ${page.url()}`).toEqual([]);
    },
});

export { expect };
