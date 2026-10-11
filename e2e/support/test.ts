import { test as base, expect, type BrowserContext, type Page, type Route } from '@playwright/test';

/**
 * The fixtures every e2e spec imports instead of `@playwright/test` (docs/research/design-review-testability.md §4.2):
 *
 * - `firewall` (automatic): every request of the browser context to a host outside `ALLOWED_HOSTS` is aborted
 *   and recorded, and the test fails at teardown if anything was blocked. Chromium's host-resolver rules
 *   (playwright.config.ts) are the second layer. Mocked external hosts (Mapbox, Storage) get their own
 *   `context.route` handlers in M1; Playwright tries the most recently registered handler first, so they win.
 * - `consoleErrors` (automatic): console errors and uncaught page errors fail the test at teardown.
 *
 * A bad-path test that provokes a block or an error on purpose claims it with `take()`, which returns
 * the recorded entries and clears them, and asserts on what it got.
 */
const ALLOWED_HOSTS: readonly string[] = ['127.0.0.1', 'localhost'];

/** Recorded entries that the test either claims with `take()` or that fail the test at teardown. */
class Recorder {
    readonly #entries: string[] = [];

    record(entry: string): void {
        this.#entries.push(entry);
    }

    /** The entries recorded so far, which the test now owns; the recorder is empty afterwards. */
    take(): string[] {
        return this.#entries.splice(0);
    }
}

function isAllowed(url: string): boolean {
    return ALLOWED_HOSTS.includes(new URL(url).hostname);
}

async function guardRoute(route: Route, blocked: Recorder): Promise<void> {
    const url = route.request().url();
    if (isAllowed(url)) {
        await route.fallback();
        return;
    }
    blocked.record(url);
    await route.abort('blockedbyclient');
}

async function installFirewall(context: BrowserContext, blocked: Recorder): Promise<void> {
    await context.route('**/*', (route) => guardRoute(route, blocked));
}

function watchConsole(page: Page, errors: Recorder): void {
    page.on('console', (message) => {
        if (message.type() === 'error') {
            errors.record(message.text());
        }
    });
    page.on('pageerror', (error) => {
        errors.record(`uncaught ${error.name}: ${error.message}`);
    });
}

interface Guards {
    firewall: Recorder;
    consoleErrors: Recorder;
}

export const test = base.extend<Guards>({
    firewall: [
        async ({ context }, use) => {
            const blocked = new Recorder();
            await installFirewall(context, blocked);
            await use(blocked);
            expect(blocked.take(), `requests outside ${ALLOWED_HOSTS.join(', ')} were blocked`).toEqual([]);
        },
        { auto: true },
    ],
    consoleErrors: [
        async ({ page }, use) => {
            const errors = new Recorder();
            watchConsole(page, errors);
            await use(errors);
            expect(errors.take(), 'console errors or uncaught page errors').toEqual([]);
        },
        { auto: true },
    ],
});

export { expect };
