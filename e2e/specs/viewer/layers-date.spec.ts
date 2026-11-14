import type { Locator, Page } from '@playwright/test';

import { siteManifestData, type Json } from '../../fixtures/manifest.js';
import { expect, test } from '../../support/test.js';
import { openLayers, openViewer, serveManifest, viewer } from '../../support/viewer.js';

/**
 * Each historical layer's date (or year) sits below its name in Layers, in smaller text, and the row is no taller for it
 * (the owner, 2026-11-14): a dated row has the height of the undated Photos row at a phone's and a computer's width.
 */

const WIDTHS = [
    { width: 360, height: 800 },
    { width: 1440, height: 900 },
] as const;

function row(page: Page, id: string): Locator {
    return viewer(page).locator(`hcm-overlay-list li[data-overlay="${id}"]`).first();
}

async function height(locator: Locator): Promise<number> {
    return (await locator.boundingBox())?.height ?? 0;
}

for (const size of WIDTHS) {
    test(
        `At ${String(size.width)} px each layer shows its date below its name in a row no taller than Photos`,
        { tag: '@S-V03-HAPPY-LAYER-DATE' },
        async ({ page, lang }) => {
            await page.setViewportSize(size);
            await openViewer(page, { lang, hash: '15/44.42700/26.08530' });
            await openLayers(page, lang);
            const dated = row(page, 'e2e-1980');
            await expect(dated.locator('.detail')).toBeVisible();
            await expect(dated.locator('.detail')).toContainText('1980');
            const nameBox = await dated.locator('.label').boundingBox();
            const dateBox = await dated.locator('.detail').boundingBox();
            expect((dateBox?.y ?? 0) >= (nameBox?.y ?? 0) + (nameBox?.height ?? 0) - 1, 'the date sits below the name').toBe(true);
            const photos = await height(row(page, 'photos'));
            expect(await height(dated)).toBe(photos);
            expect(await height(row(page, 'e2e-1966'))).toBe(photos);
        },
    );
}

test(
    'A long layer name ellipsizes on one line and Photos and Places show no date',
    { tag: '@S-V03-BAD-LAYER-NO-DATE' },
    async ({ page, lang }) => {
        await page.setViewportSize({ width: 360, height: 800 });
        const manifest = siteManifestData();
        const layers = manifest['layers'] as Json[];
        const first: Json = layers.at(0) ?? {};
        first['label'] = { ro: 'Strat istoric '.repeat(10), en: 'Historical layer '.repeat(10) };
        await serveManifest(page, manifest);
        await openViewer(page, { lang, hash: '15/44.42700/26.08530' });
        await openLayers(page, lang);
        const long = row(page, String(first['id']));
        const label = long.locator('.label');
        expect(await label.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
        expect(await height(long)).toBe(await height(row(page, 'photos')));
        await expect(row(page, 'photos').locator('.detail')).toHaveCount(0);
        await expect(viewer(page).locator('hcm-overlay-list li[data-overlay]:not([data-overlay^="e2e-"]) .detail')).toHaveCount(0);
    },
);
