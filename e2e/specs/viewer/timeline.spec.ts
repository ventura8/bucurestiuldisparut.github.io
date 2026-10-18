import type { Page } from '@playwright/test';

import { siteManifestData } from '../../fixtures/manifest.js';
import { BASEMAP_BACKGROUND, E2E_TILESET_LAYER, E2E_XYZ_LAYER } from '../../fixtures/world.js';
import { isOnTop, overlaps, visibleBoxes } from '../../support/layout.js';
import { blend, expectColourAt, mapFraction, mapIdle, renderedFeatureIds } from '../../support/map.js';
import { sitePath } from '../../support/site.js';
import { expect, test } from '../../support/test.js';
import { callController, hashParam, menuButton, openViewer, serveManifest, t, viewer, waitForEngineEvent } from '../../support/viewer.js';

/**
 * The timeline (behaviour V04): its stops are the layer years plus "today"; choosing a stop shows that year's layer
 * and filters the photo markers to the photos taken within 10 years of it, and a year without a layer snaps to the
 * nearest stop. A city without layers (Bucharest until M3) shows a note instead.
 */

/** The fixture's photos dated within 10 years of 1966 (the Bucharest seed has two, both of 1960). */
const PHOTOS_NEAR_1966: readonly string[] = (siteManifestData()['photos'] as { id: string; year?: number }[])
    .filter((photo) => photo.year !== undefined && Math.abs(photo.year - 1966) <= 10)
    .map((photo) => photo.id);

/** Two photos at Obor: `ferdinand` (1960, near the 1966 stop) and `parcul-ferdinand-1930` (near no stop). */
const OBOR_VIEW = '16/44.44763/26.13822';
const NEAR_1966 = 'ferdinand';
const NEAR_NO_STOP = 'parcul-ferdinand-1930';

function timelineSlider(page: Page, lang: 'ro' | 'en') {
    return page.getByRole('slider', { name: t(lang, 'timeline.label'), exact: true });
}

test('Choosing a stop shows its layer and the photos of those years', { tag: '@S-V04-HAPPY' }, async ({ page, lang }) => {
    await openViewer(page, { lang, hash: OBOR_VIEW });
    const probe = await mapFraction(page, 0.5, 0.12);
    const slider = timelineSlider(page, lang);
    await expect.poll(() => renderedFeatureIds(page, 'hcm-photos-marker')).toEqual(expect.arrayContaining([NEAR_1966, NEAR_NO_STOP]));
    await expectColourAt(page, probe, BASEMAP_BACKGROUND, 'today shows no historical layer');

    await slider.focus();
    await slider.press('Home');
    await expect(slider).toHaveAttribute('aria-valuetext', t(lang, 'timeline.year', { year: '1966' }));
    await expectColourAt(page, probe, E2E_TILESET_LAYER.colour, 'the 1966 layer');
    // One poll for the whole filtered set: today's markers already include NEAR_1966, so waiting for it alone could read
    // the markers before the filter was drawn (docs/LESSONS.md).
    await expect
        .poll(
            async () => {
                const shown = await renderedFeatureIds(page, 'hcm-photos-marker');
                return { near: shown.includes(NEAR_1966), others: shown.filter((id) => !PHOTOS_NEAR_1966.includes(id)) };
            },
            { message: 'only photos taken 1956-1976' },
        )
        .toEqual({ near: true, others: [] });
    await expect.poll(() => hashParam(page, 'layers')).toBe(E2E_TILESET_LAYER.id);

    await slider.press('ArrowRight');
    await expect(slider).toHaveAttribute('aria-valuetext', t(lang, 'timeline.year', { year: '1980' }));
    await expectColourAt(page, probe, blend(E2E_XYZ_LAYER.colour, BASEMAP_BACKGROUND, 0.8), 'the 1980 layer at its default 80 %');
    await expect.poll(() => renderedFeatureIds(page, 'hcm-photos-marker')).toEqual([]);

    await slider.press('End');
    await expect(slider).toHaveAttribute('aria-valuetext', t(lang, 'timeline.present'));
    await expectColourAt(page, probe, BASEMAP_BACKGROUND, 'today again');
    await expect.poll(() => renderedFeatureIds(page, 'hcm-photos-marker')).toEqual(expect.arrayContaining([NEAR_1966, NEAR_NO_STOP]));
});

test('A year without a layer snaps to the nearest stop', { tag: '@S-V04-BAD-YEAR-WITHOUT-LAYER' }, async ({ page, lang }) => {
    await openViewer(page, { lang, hash: OBOR_VIEW });
    const slider = timelineSlider(page, lang);

    await callController(page, 'setYear', 1972);
    await expect(slider).toHaveAttribute('aria-valuetext', t(lang, 'timeline.year', { year: '1966' }));
    await expect.poll(() => hashParam(page, 'layers')).toBe(E2E_TILESET_LAYER.id);
    await callController(page, 'setYear', 1975);
    await expect(slider).toHaveAttribute('aria-valuetext', t(lang, 'timeline.year', { year: '1980' }));
    await expect.poll(() => hashParam(page, 'layers')).toBe(E2E_XYZ_LAYER.id);

    // A tap between two stops on the track lands on the nearer one.
    const track = viewer(page).locator('hcm-timeline .track');
    const box = await track.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click((box?.x ?? 0) + (box?.width ?? 0) * 0.2, (box?.y ?? 0) + (box?.height ?? 0) / 2);
    await expect(slider).toHaveAttribute('aria-valuetext', t(lang, 'timeline.year', { year: '1966' }));
    await expect(slider).toHaveAttribute('aria-valuemax', '2');
});

test(
    'A stop with photos near its year offers them in a chip; today offers none',
    { tag: '@S-V04-HAPPY-PHOTOS-NEAR-YEAR' },
    async ({ page, lang }) => {
        await openViewer(page, { lang, hash: OBOR_VIEW });
        const chip = page.getByRole('button', { name: t(lang, 'photos.nearYear', { year: '1966' }) });
        await expect(page.getByRole('button', { name: /1966|1980/ })).toHaveCount(0);

        const slider = timelineSlider(page, lang);
        await slider.focus();
        await slider.press('Home');
        await chip.click();
        const sheet = page.getByRole(viewportIsDocked(page) ? 'region' : 'dialog', { name: t(lang, 'photos.nearYear', { year: '1966' }) });
        await expect(sheet).toBeVisible();
        // The list is slotted into the sheet (a modal sheet's dialog is in its shadow root), so it is found by its own name.
        const list = viewer(page).locator('.photos-sheet hcm-photo-list');
        await expect(list.getByRole('status')).toHaveText(
            t(lang, lang === 'ro' ? 'photos.count.few' : 'photos.count.other', { count: String(PHOTOS_NEAR_1966.length) }),
        );
        await expect(list.getByRole('list', { name: t(lang, 'photos.list') }).getByRole('button')).toHaveCount(PHOTOS_NEAR_1966.length);

        await page.keyboard.press('Escape');
        await slider.focus();
        await slider.press('End');
        await expect(page.getByRole('button', { name: t(lang, 'photos.nearYear', { year: '1966' }) })).toHaveCount(0);
    },
);

/** Expanded and wider windows dock the sheets in a pane (a labelled region); narrower ones open modal dialogs. */
function viewportIsDocked(page: Page): boolean {
    return (page.viewportSize()?.width ?? 0) >= 840;
}

test(
    'Without historical layers a note replaces the timeline, clear of the menu',
    { tag: '@S-V04-HAPPY-NO-LAYERS-NOTE' },
    async ({ page, lang }) => {
        await serveManifest(page, siteManifestData({ layers: false }));
        await openViewer(page, { lang });

        await expect(timelineSlider(page, lang)).toHaveCount(0);
        const note = page.getByText(t(lang, 'timeline.empty'), { exact: true });
        await expect(note).toBeVisible();
        await expect(isOnTop(note)).resolves.toBe(true);
        await expect(isOnTop(menuButton(page, lang))).resolves.toBe(true);
        const boxes = await visibleBoxes(page, ['.dock.timeline-note .note', '.dock.menu hcm-fab-menu']);
        expect(boxes).toHaveLength(2);
        expect(overlaps(boxes)).toEqual([]);
    },
);

for (const size of [
    { width: 320, height: 568 },
    { width: 915, height: 412 },
]) {
    test(
        `The no-layers note leaves the menu, the logo and the attribution free at ${String(size.width)}x${String(size.height)}`,
        { tag: '@S-V04-BAD-NO-LAYERS-NOTE-LAYOUT' },
        async ({ page, lang }) => {
            await page.setViewportSize(size);
            await serveManifest(page, siteManifestData({ layers: false }));
            await page.goto(sitePath('bucharest', { lang }));
            await waitForEngineEvent(page, 'hcm-ready');
            await mapIdle(page);

            const note = page.getByText(t(lang, 'timeline.empty'), { exact: true });
            await expect(note).toBeVisible();
            const controls = [
                menuButton(page, lang),
                viewer(page).locator('a.mapboxgl-ctrl-logo'),
                viewer(page).locator('.mapboxgl-ctrl-attrib-button, .mapboxgl-ctrl-attrib').first(),
            ];
            for (const control of controls) {
                await expect(control).toBeVisible();
                await expect(isOnTop(control)).resolves.toBe(true);
            }
            const boxes = await visibleBoxes(page, [
                '.dock.timeline-note .note',
                '.dock.menu hcm-fab-menu',
                'a.mapboxgl-ctrl-logo',
                '.mapboxgl-ctrl-attrib',
            ]);
            expect(overlaps(boxes)).toEqual([]);
            const noteBox = await note.boundingBox();
            expect((noteBox?.x ?? -1) >= 0 && (noteBox?.x ?? 0) + (noteBox?.width ?? 0) <= size.width).toBe(true);
        },
    );
}
