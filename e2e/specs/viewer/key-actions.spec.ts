import type { Page } from '@playwright/test';

import { analyticsCalls, analyticsManifest, gaEvents, viewerEventProblem } from '../../support/ga4.js';
import { expect, test } from '../../support/test.js';
import { openViewer, serveManifest, t, viewer } from '../../support/viewer.js';

/**
 * The viewer's key actions in GA4 (behaviour V70, the owner's request of 2026-11-13, DECISIONS-for-review.md §200): after
 * Accept, the compass's reset is one `compass_reset` event and every event passes the viewer's own guard (no position, no
 * text); a browser that asks not to be tracked (Do Not Track) is not asked and nothing reaches Google or Firebase.
 */

function banner(page: Page) {
    return viewer(page).locator('hcm-consent-banner');
}

test(
    'After Accept the compass reset is one GA4 event, valid and private',
    { tag: ['@S-V70-HAPPY-KEY-ACTIONS', '@S-V70-BAD-YEAR-DRAG-ONE-EVENT'] },
    async ({ page, lang, mockApis }) => {
        await serveManifest(page, analyticsManifest());
        await openViewer(page, { lang, hash: '16/44.42704/26.0853/45' });
        await page.getByRole('button', { name: t(lang, 'consent.accept'), exact: true }).click();
        await expect.poll(async () => (await gaEvents(mockApis)).map((event) => event.name)).toContain('page_view');

        // Four years in a row along the timeline: one year_change, the last year, once it stays.
        const timeline = page.getByRole('slider', { name: t(lang, 'timeline.label'), exact: true });
        await timeline.focus();
        for (let step = 0; step < 4; step += 1) {
            await timeline.press('ArrowLeft');
        }
        const years = async (): Promise<number> => (await gaEvents(mockApis)).filter((event) => event.name === 'year_change').length;
        await expect.poll(years).toBe(1);

        await page.getByRole('button', { name: t(lang, 'viewer.compass'), exact: true }).click();

        await expect.poll(async () => (await gaEvents(mockApis)).filter((event) => event.name === 'compass_reset').length).toBe(1);
        expect(await years()).toBe(1);
        for (const event of await gaEvents(mockApis)) {
            expect(viewerEventProblem(event), event.name).toBeNull();
        }
    },
);

test(
    'A browser that asks not to be tracked gets no banner and sends nothing',
    { tag: '@S-V70-BAD-NO-EVENTS-BEFORE-CONSENT' },
    async ({ page, lang, mockApis }) => {
        await page.addInitScript(() => {
            Object.defineProperty(Navigator.prototype, 'doNotTrack', { configurable: true, get: () => '1' });
        });
        await serveManifest(page, analyticsManifest());
        await openViewer(page, { lang, hash: '16/44.42704/26.0853/45' });
        await expect(page.getByRole('button', { name: t(lang, 'action.menu'), exact: true })).toBeVisible();
        await expect(banner(page)).toHaveCount(0);

        await page.getByRole('button', { name: t(lang, 'viewer.compass'), exact: true }).click();

        expect(await analyticsCalls(mockApis), 'no analytics request under Do Not Track').toEqual([]);
        expect(await page.evaluate(() => Object.keys(window).filter((key) => key === 'dataLayer' || key === 'gtag'))).toEqual([]);
    },
);
