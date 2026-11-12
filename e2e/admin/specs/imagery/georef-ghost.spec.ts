import type { Page } from '@playwright/test';

import { expectStateSound } from '../../../support/state-check.js';
import { mapFacts, mapIdle } from '../../../support/map.js';
import { adminVisit } from '../../../tour/states.js';
import { scanPixelOf, SCAN_PREVIEW_SCALE, SCAN_SIZE } from '../../support/imagery-geometry.js';
import { ADMIN_LOCK, expect, test } from '../../support/test.js';
import { georefText, landmark, openGeoreferencer, pairRows, pointInView, removePair, scanCentre, scanPane, showPane } from './georef.js';
import { readyImagery } from './world.js';

// One admin test at a time: the import that needs points runs in the server's world and reads setup/status.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * The georeferencer while a pair is placed (behaviour A16; the owner's 1966 Corona frames, 2026-11-12): the scan keeps its zoom and
 * centre when a pair is added and when the window changes size; while a pair waits for its second click neither pane moves (the
 * views linked or not), and the place the pairs so far expect is a dashed ring on the other pane, named by the hint; with fewer than
 * two pairs and no fit there is none.
 */
test.use({ persona: 'owner', mapOwner: 'owner' });

type Lang = 'ro' | 'en';

/** Where a full-resolution scan pixel is on the page with the scan as it shows now (zoomed or not). */
async function scanPointNow(page: Page, pixel: { readonly x: number; readonly y: number }): Promise<{ x: number; y: number }> {
    const viewer = page.locator('hcm-scan-viewer');
    // A compact window shows the pane below the tools: in view first, or the pointer would land outside the window.
    await viewer.scrollIntoViewIfNeeded();
    const box = await viewer.boundingBox();
    const view = await viewer.evaluate(
        (element) => (element as unknown as { view: { scale: number; offset: { x: number; y: number } } }).view,
    );
    const across = SCAN_PREVIEW_SCALE * view.scale;
    return { x: (box?.x ?? 0) + view.offset.x + pixel.x * across, y: (box?.y ?? 0) + view.offset.y + pixel.y * across };
}

/** The wheel over a scan pixel: the scan zooms in about it (it stays under the pointer). */
async function zoomScanAt(page: Page, pixel: { readonly x: number; readonly y: number }, delta = -600): Promise<void> {
    const before = (await scanCentre(page)).scale;
    const at = await scanPointNow(page, pixel);
    await page.mouse.move(at.x, at.y);
    await page.mouse.wheel(0, delta);
    await expect.poll(async () => (await scanCentre(page)).scale).toBeGreaterThan(before);
}

/** Add pairs, unless it is on (pressed). */
async function addingPairs(page: Page, lang: Lang): Promise<void> {
    const toggle = page.getByRole('button', { name: georefText(lang, 'adminContent.georef.addPairs') });
    if ((await toggle.getAttribute('aria-pressed')) !== 'true') {
        await toggle.click();
    }
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
}

/** The map's camera (its centre and zoom) once it is idle, the map pane shown. */
async function mapCamera(page: Page, lang: Lang): Promise<{ readonly center: readonly number[]; readonly zoom: number }> {
    await showPane(page, lang, 'map');
    await mapIdle(page);
    const { center, zoom } = await mapFacts(page);
    return { center, zoom };
}

async function opened(fixtures: Parameters<typeof readyImagery>[0], uid: string, page: Page, lang: Lang, linked = false): Promise<void> {
    const imagery = await readyImagery(fixtures, uid);
    await imagery.script({ attempts: [{ outcome: 'no-match' }] });
    await openGeoreferencer(page, lang, { linked });
    // The four corner pairs of the frame that found too few.
    await expect(pairRows(page, lang)).toHaveCount(4);
}

test(
    'A pair added and a narrower window keep the scan where the owner zoomed it',
    { tag: '@S-A16-HAPPY-GEOREF-KEEP-ZOOM' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        await opened({ emulators: adminWorld.emulators, api: mockApiRequest, upstream }, adminWorld.accounts.owner.uid, page, lang);
        const place = landmark(0);
        const pixel = scanPixelOf(place);
        await zoomScanAt(page, pixel);
        const zoomed = await scanCentre(page);

        await addingPairs(page, lang);
        await showPane(page, lang, 'scan');
        const onScan = await scanPointNow(page, pixel);
        await page.mouse.click(onScan.x, onScan.y);
        await showPane(page, lang, 'map');
        const onMap = await pointInView(page, lang, [place.lng, place.lat]);
        await page.mouse.click(onMap.x, onMap.y);
        await expect(pairRows(page, lang)).toHaveCount(5);
        await showPane(page, lang, 'scan');
        const after = await scanCentre(page);
        expect(after.scale, 'the zoom after a pair is added').toBeCloseTo(zoomed.scale, 9);
        expect(Math.hypot(after.x - zoomed.x, after.y - zoomed.y), 'the centre after a pair is added').toBeLessThan(1);

        // A scrollbar's width less (the page grew taller below): the same zoom and the same place in the middle.
        const size = page.viewportSize() ?? { width: 1440, height: 900 };
        await page.setViewportSize({ width: size.width - 15, height: size.height });
        await expect
            .poll(async () => {
                const now = await scanCentre(page);
                return Math.hypot(now.x - zoomed.x, now.y - zoomed.y) < 1 && Math.abs(now.scale - zoomed.scale) < 1e-9;
            })
            .toBe(true);
    },
);

test(
    'A scan never zoomed still shows the whole frame after the window changes',
    { tag: '@S-A16-BAD-GEOREF-KEEP-ZOOM-NEVER-SHOWN' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        await opened({ emulators: adminWorld.emulators, api: mockApiRequest, upstream }, adminWorld.accounts.owner.uid, page, lang);
        const viewer = page.locator('hcm-scan-viewer');
        const before = (await viewer.boundingBox())?.width ?? 0;

        const size = page.viewportSize() ?? { width: 1440, height: 900 };
        await page.setViewportSize({ width: size.width - 40, height: size.height });
        await expect.poll(async () => (await viewer.boundingBox())?.width ?? 0).toBeLessThan(before);

        // Fitted again to the narrower pane: the frame's middle at the centre, at the scale that shows the whole frame (no zoom kept).
        const box = (await viewer.boundingBox()) ?? { width: 0, height: 0 };
        const fit =
            Math.min(box.width / (SCAN_SIZE.width * SCAN_PREVIEW_SCALE), box.height / (SCAN_SIZE.height * SCAN_PREVIEW_SCALE)) *
            SCAN_PREVIEW_SCALE;
        await expect.poll(async () => Math.abs((await scanCentre(page)).scale - fit)).toBeLessThan(1e-6);
        const now = await scanCentre(page);
        expect(Math.hypot(now.x - SCAN_SIZE.width / 2, now.y - SCAN_SIZE.height / 2)).toBeLessThan(1);
    },
);

test(
    'While a pair waits for its second click the panes stand still and a dashed ring shows the expected place',
    { tag: '@S-A16-HAPPY-GEOREF-GHOST' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        await opened({ emulators: adminWorld.emulators, api: mockApiRequest, upstream }, adminWorld.accounts.owner.uid, page, lang, true);
        const place = landmark(1);
        const pixel = scanPixelOf(place);
        // Linked: zooming the scan on the landmark brings the map there.
        await zoomScanAt(page, pixel, -300);

        await addingPairs(page, lang);
        await showPane(page, lang, 'scan');
        const onScan = await scanPointNow(page, pixel);
        await page.mouse.click(onScan.x, onScan.y);
        await expect(page.getByText(georefText(lang, 'adminContent.georef.halfOnScanGhost'))).toBeVisible();
        const still = await mapCamera(page, lang);
        await expectStateSound(page, adminVisit('georef.ghost', lang));

        // The owner zooms the scan once more before the map's click: the map does not move to the place the fit expects.
        await showPane(page, lang, 'scan');
        await zoomScanAt(page, pixel, -200);
        expect(await mapCamera(page, lang)).toEqual(still);

        // The click on the place itself (on or beside the ring: it takes no click of its own) makes the pair.
        const onMap = await pointInView(page, lang, [place.lng, place.lat]);
        await page.mouse.click(onMap.x, onMap.y);
        await expect(pairRows(page, lang)).toHaveCount(5);

        // The other way round: the map first, then the scan, which stands still while the map zooms.
        const second = landmark(2);
        await showPane(page, lang, 'map');
        const first = await pointInView(page, lang, [second.lng, second.lat]);
        await page.mouse.click(first.x, first.y);
        await expect(page.getByText(georefText(lang, 'adminContent.georef.halfOnMapGhost'))).toBeVisible();
        await showPane(page, lang, 'scan');
        const scanBefore = await scanCentre(page);
        await showPane(page, lang, 'map');
        await page
            .locator('hcm-admin-map')
            .getByRole('button', { name: georefText(lang, 'adminContent.map.zoomIn'), exact: true })
            .click();
        await mapIdle(page);
        await showPane(page, lang, 'scan');
        expect(await scanCentre(page)).toEqual(scanBefore);
    },
);

test(
    'With two pairs the ghost comes from their likeness; with one pair and no fit there is none',
    { tag: '@S-A16-BAD-GEOREF-GHOST-NO-PAIRS' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }) => {
        await opened({ emulators: adminWorld.emulators, api: mockApiRequest, upstream }, adminWorld.accounts.owner.uid, page, lang);
        // Two of the four corner pairs left: no fit, but their similarity tells where a scan point lies.
        await removePair(page, lang, 4);
        await removePair(page, lang, 3);
        await expect(pairRows(page, lang)).toHaveCount(2);
        await addingPairs(page, lang);
        await showPane(page, lang, 'scan');
        const onScan = await scanPointNow(page, scanPixelOf(landmark(0)));
        await page.mouse.click(onScan.x, onScan.y);
        await expect(page.getByText(georefText(lang, 'adminContent.georef.halfOnScanGhost'))).toBeVisible();
        // Esc on the scan drops the half pair (and its ghost).
        await showPane(page, lang, 'scan');
        await scanPane(page, lang).focus();
        await page.keyboard.press('Escape');
        await expect(page.getByText(georefText(lang, 'adminContent.georef.addingHint'))).toBeVisible();

        // One pair: nothing to tell where, only the plain hint.
        await removePair(page, lang, 2);
        await expect(pairRows(page, lang)).toHaveCount(1);
        await addingPairs(page, lang);
        await showPane(page, lang, 'scan');
        const again = await scanPointNow(page, scanPixelOf(landmark(0)));
        await page.mouse.click(again.x, again.y);
        await expect(page.getByText(georefText(lang, 'adminContent.georef.halfOnScan'))).toBeVisible();
        await expect(page.getByText(georefText(lang, 'adminContent.georef.halfOnScanGhost'))).toHaveCount(0);
    },
);
