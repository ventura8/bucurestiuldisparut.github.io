import { translateAdminContent } from '@hcm/shared';
import { expect, type Locator, type Page } from '@playwright/test';

import { FUNCTIONS_TIMEOUT_MS } from '../../support/emulators.js';
import { landmarks, scanPixelOf, SCAN_PREVIEW_SCALE, SCAN_SIZE, type LatLng } from '../../support/imagery-geometry.js';
import { adminMapReady, mapPointOf } from '../../support/map.js';
import { detail, imageryText, importFromList, versionState } from './world.js';

/**
 * The georeferencer's world for its specs (docs/research/M3-interfaces.md §10.4): a scene whose automatic georeferencing
 * found too few pairs (the stand-in's `no-match`: four corner pairs), opened in the georeferencer, and where a person
 * clicks to pair a landmark: on the scan at the pixel the scan's known transform puts it (e2e/admin/support/
 * imagery-geometry.ts), on the reference map at its place. The scan pane shows the whole preview centred until zoomed.
 */

const SCENE = 'DS1035-1057DA023';

/** A georeferencer text. */
export function georefText(
    lang: 'ro' | 'en',
    key: Parameters<typeof translateAdminContent>[1],
    params: Readonly<Record<string, string>> = {},
): string {
    return translateAdminContent(lang, key, params);
}

/**
 * Imports the 1966 frame (the spec scripted its first attempt to find too few pairs) and opens its georeferencer from the
 * version's page; the version id.
 */
export async function openGeoreferencer(page: Page, lang: 'ro' | 'en'): Promise<string> {
    const versionId = await importFromList(page, lang, SCENE);
    await expect(versionState(page, lang, 'adminContent.imagery.version.needsGcps')).toBeVisible({ timeout: FUNCTIONS_TIMEOUT_MS });
    await detail(page)
        .getByRole('link', { name: imageryText(lang, 'adminContent.imagery.openGeoref') })
        .click();
    await georeferencerReady(page, lang);
    return versionId;
}

/** The georeferencer is open and settled: the map first (its centre is the keyboard's crosshair), then the scan. */
export async function georeferencerReady(page: Page, lang: 'ro' | 'en'): Promise<void> {
    await expect(page.getByRole('button', { name: georefText(lang, 'adminContent.georef.save') })).toBeVisible();
    await showPane(page, lang, 'map');
    await showPane(page, lang, 'scan');
}

/** The fit's errors line (`Fit error: … m`, then the checkpoints' error or why there is none). */
export function errorsLine(page: Page): Locator {
    return page.locator('hcm-georef-page p.summary');
}

/**
 * Shows one pane where the window shows one at a time (a compact window: the Scan | Map switch), and waits for it; both
 * panes show side by side from a medium window, where there is nothing to switch.
 */
async function showPane(page: Page, lang: 'ro' | 'en', pane: 'scan' | 'map'): Promise<void> {
    const switcher = page.getByRole('radiogroup', { name: georefText(lang, 'adminContent.georef.pane.label') });
    if (await switcher.isVisible()) {
        await switcher.getByRole('radio', { name: georefText(lang, `adminContent.georef.pane.${pane}`) }).click();
    }
    await (pane === 'scan' ? expect(scanPane(page, lang)).toBeVisible() : adminMapReady(page));
}

/** The scan pane (an application: it takes the arrow keys). */
export function scanPane(page: Page, lang: 'ro' | 'en'): Locator {
    return page.getByRole('application', { name: georefText(lang, 'adminContent.georef.scanLabel') });
}

/** The table of pairs. */
function pairsTable(page: Page, lang: 'ro' | 'en'): Locator {
    return page.getByRole('table', { name: georefText(lang, 'adminContent.georef.tableCaption') });
}

/** The pairs' rows (the header row left out). */
export function pairRows(page: Page, lang: 'ro' | 'en'): Locator {
    return pairsTable(page, lang)
        .getByRole('row')
        .filter({ has: page.getByRole('rowheader') });
}

/** Where a full-resolution scan pixel is on the page, the scan shown whole (fitted and centred in its pane). */
async function scanPointOf(
    page: Page,
    lang: 'ro' | 'en',
    pixel: { readonly x: number; readonly y: number },
): Promise<{ x: number; y: number }> {
    await scanPane(page, lang).scrollIntoViewIfNeeded();
    const box = await scanPane(page, lang).boundingBox();
    expect(box, 'the scan pane is on the page').not.toBeNull();
    const pane = box ?? { x: 0, y: 0, width: 0, height: 0 };
    const width = SCAN_SIZE.width * SCAN_PREVIEW_SCALE;
    const height = SCAN_SIZE.height * SCAN_PREVIEW_SCALE;
    const scale = Math.min(pane.width / width, pane.height / height);
    return {
        x: pane.x + (pane.width - width * scale) / 2 + pixel.x * SCAN_PREVIEW_SCALE * scale,
        y: pane.y + (pane.height - height * scale) / 2 + pixel.y * SCAN_PREVIEW_SCALE * scale,
    };
}

/** The landmarks a spec pairs (vertices of the world inside the scan), far enough apart that a click never lands on another pair. */
const PAIRABLE = [1, 11, 17, 14, 6, 20];

/** The `index`-th landmark a spec pairs. */
export function landmark(index: number): LatLng {
    const place = landmarks()[PAIRABLE[index] ?? -1];
    if (place === undefined) {
        throw new Error(`the synthetic world has no landmark ${String(index)}`);
    }
    return place;
}

/** Turns the adding of pairs on (Add pairs), unless it still is from the last pair (the hint says so). */
async function addingPairs(page: Page, lang: 'ro' | 'en'): Promise<void> {
    if (!(await page.getByText(georefText(lang, 'adminContent.georef.addingHint')).isVisible())) {
        await page.getByRole('button', { name: georefText(lang, 'adminContent.georef.addPairs') }).click();
    }
}

/**
 * Adds one pair as a person does: Add pairs, a click on the scan where the landmark is, a click on the map at its place
 * (moved by `offsetMetres` east, for a pair that disagrees with the others).
 */
export async function addPair(page: Page, lang: 'ro' | 'en', place: LatLng, offsetMetres = 0): Promise<void> {
    await addingPairs(page, lang);
    // The hint above the panes appears first and moves them down: measure the scan where it now is.
    await expect(page.getByText(georefText(lang, 'adminContent.georef.addingHint'))).toBeVisible();
    await showPane(page, lang, 'scan');
    const scan = await scanPointOf(page, lang, scanPixelOf(place));
    await page.mouse.click(scan.x, scan.y);
    await expect(page.getByText(georefText(lang, 'adminContent.georef.halfOnScan'))).toBeVisible();
    await showPane(page, lang, 'map');
    const lng = place.lng + offsetMetres / (111_320 * Math.cos((place.lat * Math.PI) / 180));
    const point = await pointInView(page, lang, [lng, place.lat]);
    await page.mouse.click(point.x, point.y);
    await showPane(page, lang, 'scan');
}

/**
 * Where a place is drawn on the reference map once it is in view: the map follows the selected pair closely, so a place
 * further away is brought in with Zoom out, as a person does.
 */
async function pointInView(page: Page, lang: 'ro' | 'en', lngLat: [number, number]): Promise<{ readonly x: number; readonly y: number }> {
    const map = page.locator('hcm-admin-map');
    const zoomOut = map.getByRole('button', { name: georefText(lang, 'adminContent.map.zoomOut'), exact: true });
    for (let attempt = 0; attempt < 8; attempt += 1) {
        const point = await mapPointOf(page, lngLat);
        const box = await map.boundingBox();
        const margin = 40;
        const inside =
            box !== null &&
            point.x > box.x + margin &&
            point.x < box.x + box.width - margin &&
            point.y > box.y + margin &&
            point.y < box.y + box.height - margin;
        if (inside) {
            return point;
        }
        await zoomOut.click();
    }
    return mapPointOf(page, lngLat);
}

/** Deletes pair `number` with its row's Remove button. */
export async function removePair(page: Page, lang: 'ro' | 'en', number: number): Promise<void> {
    const name = georefText(lang, 'adminContent.georef.pairName', { number: String(number) });
    await page.getByRole('button', { name: georefText(lang, 'adminContent.georef.remove', { name }) }).click();
}

/** A transform's radio (its name starts with the transform's own text; the missing count may follow). */
export function transformRadio(page: Page, lang: 'ro' | 'en', kind: 'affine' | 'poly2' | 'tps'): Locator {
    return page.getByRole('radio', { name: georefText(lang, `adminContent.georef.transform.${kind}`) });
}
