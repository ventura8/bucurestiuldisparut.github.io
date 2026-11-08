import type { Page } from '@playwright/test';

import { siteManifestData } from '../../fixtures/manifest.js';
import { E2E_XYZ_LAYER } from '../../fixtures/world.js';
import { overlaps, visibleBoxes, type Box } from '../../support/layout.js';
import { expect, test } from '../../support/test.js';
import { menuButton, openViewer, serveManifest, t, viewer } from '../../support/viewer.js';

/**
 * The timeline's orientation (behaviour V04; the owner, 2026-11-08: "for phone or small width setup, maybe it would be
 * wise to show the timeline vertically" and "when height is short, we should display the timeline horizontally"): a
 * phone held upright stands it on the leading edge with the photos-near-the-year chip docked under its foot and the menu
 * button in the bottom trailing corner; a short window lays it at the foot of the map. The arrow keys follow it on
 * screen, and the selected year's pill never hides another year's label (his phone: "1980" over 1979 and 1982).
 */

const OBOR_VIEW = '16/44.44763/26.13822';
/** The owner's city on 2026-11-08: eleven layer years and today. */
const OWNERS_YEARS = [1966, 1967, 1972, 1976, 1977, 1978, 1979, 1980, 1982, 1983, 1984] as const;
const FLOATING = ['[role="menu"]', '.dock.chip hcm-button', 'hcm-timeline'];

function slider(page: Page, lang: 'ro' | 'en') {
    return page.getByRole('slider', { name: t(lang, 'timeline.label'), exact: true });
}

async function boxOf(page: Page, selector: string): Promise<Box> {
    const [box] = await visibleBoxes(page, [selector]);
    expect(box, `${selector} is shown`).toBeDefined();
    return box ?? { name: selector, x: 0, y: 0, width: 0, height: 0 };
}

/** Selects 1966, then walks to 1980 and back with the key that points the way the timeline lies. */
async function walk(page: Page, lang: 'ro' | 'en', later: string, earlier: string): Promise<void> {
    const thumb = slider(page, lang);
    await thumb.focus();
    await thumb.press('Home');
    await expect(thumb).toHaveAttribute('aria-valuetext', t(lang, 'timeline.year', { year: '1966' }));
    await thumb.press(later);
    await expect(thumb).toHaveAttribute('aria-valuetext', t(lang, 'timeline.year', { year: '1980' }));
    await thumb.press(earlier);
    await expect(thumb).toHaveAttribute('aria-valuetext', t(lang, 'timeline.year', { year: '1966' }));
}

/** Opens the menu: its items cover neither the chip nor the timeline, and all of them are on screen. */
async function expectOpenMenuClear(page: Page, lang: 'ro' | 'en'): Promise<void> {
    await menuButton(page, lang).click();
    await expect(page.getByRole('menu', { name: t(lang, 'action.menu') })).toBeVisible();
    const boxes = await visibleBoxes(page, FLOATING);
    expect(boxes).toHaveLength(3);
    expect(overlaps(boxes)).toEqual([]);
    const menu = await boxOf(page, '[role="menu"]');
    expect(menu.y).toBeGreaterThanOrEqual(0);
}

test(
    'On a phone held upright the timeline stands on the leading edge with the chip under it',
    { tag: '@S-V04-HAPPY-VERTICAL-ON-PHONE' },
    async ({ page, lang }) => {
        await page.setViewportSize({ width: 375, height: 812 });
        await openViewer(page, { lang, hash: OBOR_VIEW });
        await expect(slider(page, lang)).toHaveAttribute('aria-orientation', 'vertical');

        await walk(page, lang, 'ArrowUp', 'ArrowDown');
        const timeline = await boxOf(page, 'hcm-timeline');
        const chip = await boxOf(page, '.dock.chip hcm-button');
        const fab = (await menuButton(page, lang).boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
        expect(timeline.height).toBeGreaterThan(timeline.width);
        expect(Math.abs(timeline.x - 16), 'on the leading edge').toBeLessThanOrEqual(1);
        expect(Math.abs(chip.x - timeline.x), "the chip on the card's leading edge").toBeLessThanOrEqual(1);
        expect(Math.abs(chip.y - (timeline.y + timeline.height) - 8), '8 px under its foot').toBeLessThanOrEqual(1);
        expect(Math.abs(375 - 16 - (fab.x + fab.width)), 'the menu button on the trailing edge').toBeLessThanOrEqual(1);
        expect(fab.y, 'the menu button below the chip').toBeGreaterThanOrEqual(chip.y + chip.height + 8);

        await expectOpenMenuClear(page, lang);
    },
);

test(
    'A short window lays the timeline at the foot of the map, the chip on its trailing edge',
    { tag: '@S-V04-BAD-HORIZONTAL-WHEN-SHORT' },
    async ({ page, lang }) => {
        await page.setViewportSize({ width: 915, height: 412 });
        await openViewer(page, { lang, hash: OBOR_VIEW });
        await expect(slider(page, lang)).toHaveAttribute('aria-orientation', 'horizontal');

        await walk(page, lang, 'ArrowRight', 'ArrowLeft');
        const timeline = await boxOf(page, 'hcm-timeline');
        const chip = await boxOf(page, '.dock.chip hcm-button');
        expect(timeline.width).toBeGreaterThan(timeline.height);
        expect(Math.abs(chip.x + chip.width - (timeline.x + timeline.width)), "on the card's trailing edge").toBeLessThanOrEqual(1);
        expect(Math.abs(timeline.y - (chip.y + chip.height) - 8), '8 px above the card').toBeLessThanOrEqual(1);

        await expectOpenMenuClear(page, lang);
    },
);

/** The owner's twelve stops: the fixture's two layers and nine more years drawn by the 1980 layer's tiles. */
function ownersManifest(): Record<string, unknown> {
    const manifest = siteManifestData();
    const served = manifest['layers'] as Record<string, unknown>[];
    const xyz = served.find((layer) => layer['id'] === E2E_XYZ_LAYER.id) ?? {};
    const extra = OWNERS_YEARS.filter((year) => !served.some((layer) => layer['year'] === year)).map((year) => ({
        ...xyz,
        id: `e2e-${String(year)}`,
        year,
        label: { ro: `Strat ${String(year)} (e2e)`, en: `Layer ${String(year)} (e2e)` },
    }));
    const layers = [...served, ...extra].map((layer, order) => ({ ...layer, order: order + 1 }));
    return { ...manifest, layers };
}

/** In the page: the labels the selected year's pill covers, by year (none expected). */
async function coveredLabels(page: Page): Promise<string[]> {
    return viewer(page)
        .locator('hcm-timeline')
        .evaluate((element) => {
            const root = element.shadowRoot;
            const thumb = root?.querySelector('.thumb')?.getBoundingClientRect();
            const stops = [...(root?.querySelectorAll('.stop') ?? [])];
            return stops
                .filter((stop) => !stop.classList.contains('selected'))
                .map((stop) => ({ text: stop.textContent.trim(), box: stop.querySelector('.label')?.getBoundingClientRect() }))
                .filter(({ box }) => {
                    if (thumb === undefined || box === undefined) {
                        return false;
                    }
                    return (
                        box.left < thumb.right - 1 && thumb.left < box.right - 1 && box.top < thumb.bottom - 1 && thumb.top < box.bottom - 1
                    );
                })
                .map(({ text }) => text);
        });
}

test(
    "The selected year's pill hides no other year's label, upright, short or wide",
    { tag: '@S-V04-BAD-PILL-HIDES-NO-LABEL' },
    async ({ page, lang }) => {
        // The springs off: each box is measured where the pill lands.
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await serveManifest(page, ownersManifest());
        for (const size of [
            { width: 320, height: 568 },
            { width: 375, height: 812 },
            { width: 915, height: 412 },
        ]) {
            await page.setViewportSize(size);
            await openViewer(page, { lang, hash: OBOR_VIEW });
            const thumb = slider(page, lang);
            await expect(thumb).toHaveAttribute('aria-valuemax', String(OWNERS_YEARS.length));
            await thumb.focus();
            await thumb.press('Home');
            for (const year of [...OWNERS_YEARS.map(String), t(lang, 'timeline.present')]) {
                await expect(viewer(page).locator('hcm-timeline .thumb-label')).toHaveText(year);
                expect(await coveredLabels(page), `${String(size.width)}x${String(size.height)} at ${year}`).toEqual([]);
                await thumb.press('ArrowUp');
            }
        }
    },
);
