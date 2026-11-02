import type { Page, Request } from '@playwright/test';

import { expect } from '../../support/test.js';

/**
 * The callables whose server-side work writes the shared city's scenes after the page that asked has gone: the harvest
 * (`imagery.search`, which copies the best frames' browse images before it answers) and a row's or a scene's browse copy
 * (`imagery.browse`). The admin tests share one city (`PROJECT_CITY`), and the Functions emulator finishes a callable
 * whose page closed: a copy of the test before recorded `browse.state: 'copied'` on the next test's freshly harvested
 * scene, whose browse host was failing on purpose (S-A11-BAD-BROWSE-UNAVAILABLE, `docs/LESSONS.md` 341).
 */
const SCENE_WRITERS = /\/us-central1\/imagery-(search|browse)$/;

/** How long a test may wait at its end for those calls: the harvest's own limit in the admin (`search.ts`) and more. */
const SETTLE_TIMEOUT_MS = 120_000;

/** Follows one page's scene-writing callables, so its test ends only once each has answered (`settled`). */
export class SceneWriters {
    readonly #open = new Set<Request>();

    constructor(page: Page) {
        page.on('request', (request) => {
            if (SCENE_WRITERS.test(request.url()) && request.method() === 'POST') {
                this.#open.add(request);
            }
        });
        const settle = (request: Request): void => {
            this.#open.delete(request);
        };
        page.on('requestfinished', settle);
        page.on('requestfailed', settle);
    }

    /** Resolves once none of the page's scene-writing callables is under way (the server answered each one). */
    async settled(): Promise<void> {
        await expect
            .poll(() => this.#open.size, { message: 'the imagery callables of the page answered', timeout: SETTLE_TIMEOUT_MS })
            .toBe(0);
    }
}
