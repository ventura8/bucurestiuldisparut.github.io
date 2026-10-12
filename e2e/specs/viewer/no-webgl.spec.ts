import { readInstrumentation } from '../../support/instrumentation.js';
import { sitePath } from '../../support/site.js';
import { expect, test } from '../../support/test.js';
import { t, viewer, waitForEngineEvent } from '../../support/viewer.js';

/**
 * Without WebGL (behaviour V02, bad path; project `nogl`, Chromium with `--disable-3d-apis`): no map is created and
 * none is billed; a card says why, and the photo list is still there to browse every photo.
 */

test(
    'Without WebGL a card explains it and the photo list still opens every photo',
    { tag: '@S-V02-BAD-NO-WEBGL' },
    async ({ page, lang, mockApis }) => {
        await page.goto(sitePath('bucharest', { lang }));
        await waitForEngineEvent(page, 'hcm-ready');

        expect(await page.evaluate(() => document.createElement('canvas').getContext('webgl2'))).toBeNull();
        await expect(page.getByRole('alert')).toContainText(t(lang, 'error.webgl'));
        const list = viewer(page).locator('.fallback hcm-photo-list');
        await expect(list.getByRole('status')).toHaveText(t(lang, 'photos.count.other', { count: '45' }));
        const photos = list.getByRole('list', { name: t(lang, 'photos.list') }).getByRole('button');
        await expect(photos).toHaveCount(45);
        // UX review: the list scrolls under the menu button; its last row must scroll clear of it.
        const last = photos.last();
        await last.scrollIntoViewIfNeeded();
        await viewer(page)
            .locator('.status')
            .evaluate((element) => {
                element.scrollTop = element.scrollHeight;
            });
        const fab = await page.getByRole('button', { name: t(lang, 'action.menu'), exact: true }).boundingBox();
        const lastBox = await last.boundingBox();
        expect((lastBox?.y ?? 0) + (lastBox?.height ?? 0), 'the last photo scrolls clear of the menu button').toBeLessThanOrEqual(
            fab?.y ?? 0,
        );

        await photos.filter({ hasText: 'Ștrandul Operetă' }).click();
        await expect(page.getByRole('heading', { name: 'Ștrandul Operetă' })).toBeVisible();
        await expect(viewer(page).locator('canvas.mapboxgl-canvas')).toHaveCount(0);
        expect((await readInstrumentation(page)).mapsCreated).toBe(0);
        expect(await mockApis.mapLoadEvents()).toBe(0);
    },
);
