import type { Locale } from '@hcm/shared';
import type { Page } from '@playwright/test';

import { twoDatesOf1980 } from '../../fixtures/manifest.js';
import { E2E_TILESET_LAYER, E2E_XYZ_LAYER } from '../../fixtures/world.js';
import { expectColourAt, mapFraction } from '../../support/map.js';
import { expect, test } from '../../support/test.js';
import { callController, hashParam, openTimelineCard, openViewer, serveManifest, t, viewer } from '../../support/viewer.js';

/**
 * V68 (the owner's V13, 2026-11-13): a timeline year with several dates carries a badge with their count; the badge, or
 * Enter on the slider, opens a menu of the dates; the date picked comes to the front (V15's mechanism) and its link keeps
 * it. Pixel probes read the synthetic tile colours in an empty corner of the city.
 */

const EMPTY_VIEW = '15/44.37000/25.97000';
const CORONA = 'Corona (e2e)';

function slider(page: Page, lang: Locale) {
    return page.getByRole('slider', { name: t(lang, 'timeline.label'), exact: true });
}

function datesMenu(page: Page, lang: Locale) {
    return page.getByRole('menu', { name: t(lang, 'timeline.dates', { year: '1980' }), exact: true });
}

async function openOn1980(page: Page, lang: Locale): Promise<void> {
    await serveManifest(page, twoDatesOf1980());
    await openViewer(page, { lang, hash: EMPTY_VIEW });
    await callController(page, 'setYear', 1980);
    const year = t(lang, 'timeline.year', { year: '1980' });
    await expect(slider(page, lang)).toHaveAttribute('aria-valuetext', `${year}, ${t(lang, 'timeline.datesHint', { count: '2' })}`);
}

test(
    'The badge of a year with two dates opens them; the date picked comes to the front',
    { tag: '@S-V68-HAPPY-PICK-DATE' },
    async ({ page, lang }) => {
        await openOn1980(page, lang);
        const probe = await mapFraction(page, 0.5, 0.3);
        await expectColourAt(page, probe, E2E_XYZ_LAYER.colour, 'the August layer, last in the manifest, on top');

        const badge = viewer(page).locator('hcm-timeline .thumb .badge');
        await expect(badge).toHaveText('2');
        await openTimelineCard(page);
        await badge.click();

        await expect(datesMenu(page, lang)).toBeVisible();
        const items = page.getByRole('menuitemradio');
        await expect(items).toHaveCount(2);
        await expect(items.first()).toContainText(CORONA);
        await expect(items.last()).toHaveAttribute('aria-checked', 'true');
        await items.first().click();

        await expect(datesMenu(page, lang)).toBeHidden();
        await expect(slider(page, lang)).toBeFocused();
        await expectColourAt(page, probe, E2E_TILESET_LAYER.colour, 'the March layer on top');
        await expect.poll(() => hashParam(page, 'layers')).toBe(`${E2E_XYZ_LAYER.id},${E2E_TILESET_LAYER.id}`);
    },
);

test(
    'Enter on the slider opens the dates; Esc closes them and changes nothing',
    { tag: '@S-V68-BAD-ESC-CHANGES-NOTHING' },
    async ({ page, lang }) => {
        await openOn1980(page, lang);
        const probe = await mapFraction(page, 0.5, 0.3);
        const layers = `${E2E_TILESET_LAYER.id},${E2E_XYZ_LAYER.id}`;
        await expect.poll(() => hashParam(page, 'layers')).toBe(layers);

        await slider(page, lang).focus();
        await page.keyboard.press('Enter');
        await expect(datesMenu(page, lang)).toBeVisible();
        await expect(page.getByRole('menuitemradio', { checked: true })).toBeFocused();
        await page.keyboard.press('Escape');

        await expect(datesMenu(page, lang)).toBeHidden();
        await expect(slider(page, lang)).toBeFocused();
        await expectColourAt(page, probe, E2E_XYZ_LAYER.colour, 'the August layer still on top');
        await expect.poll(() => hashParam(page, 'layers')).toBe(layers);
    },
);

test('A year with a single date has no badge, and Enter opens nothing', { tag: '@S-V68-BAD-SINGLE-DATE' }, async ({ page, lang }) => {
    await openViewer(page, { lang, hash: `${EMPTY_VIEW}&layers=${E2E_TILESET_LAYER.id}` });

    await expect(slider(page, lang)).toHaveAttribute('aria-valuetext', t(lang, 'timeline.year', { year: '1966' }));
    await expect(viewer(page).locator('hcm-timeline .badge')).toHaveCount(0);
    await slider(page, lang).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menu', { name: t(lang, 'timeline.dates', { year: '1966' }), exact: true })).toHaveCount(0);
});
