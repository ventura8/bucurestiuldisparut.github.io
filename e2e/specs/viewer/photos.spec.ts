import type { Locator, Page } from '@playwright/test';
import type { Locale } from '@hcm/shared';

import { siteManifestData, type Json } from '../../fixtures/manifest.js';
import { mapFacts, mapIdle, renderedFeatureIds, renderedPoints, screenPointOf, type LngLat } from '../../support/map.js';
import { isColour, probePixel } from '../../support/site.js';
import { expect, test } from '../../support/test.js';
import { engineEvents, openViewer, serveManifest, t, viewer, windowClassOf } from '../../support/viewer.js';

/**
 * Photos on the map (behaviour V07) and the lightbox (V08): clustered camera markers that expand when the visitor zooms
 * in, a detail sheet whose shape follows the window class, view cones from zoom 17, and the full image with zoom,
 * arrows and Esc. Image failures show a placeholder or an error state, never a broken image.
 */

interface FixturePhoto {
    readonly id: string;
    readonly title: { readonly ro: string; readonly en?: string };
    readonly location: { readonly lat: number; readonly lng: number };
}

const PHOTOS = siteManifestData()['photos'] as FixturePhoto[];

function photo(id: string): FixturePhoto {
    const found = PHOTOS.find((candidate) => candidate.id === id);
    if (found === undefined) {
        throw new Error(`no photo ${id} in the fixture`);
    }
    return found;
}

function titleOf(id: string, lang: Locale): string {
    const { title } = photo(id);
    return lang === 'en' ? (title.en ?? title.ro) : title.ro;
}

function lngLatOf(id: string): LngLat {
    const { location } = photo(id);
    return [location.lng, location.lat];
}

/** A photo with a view cone and no neighbour within 300 m; one without a bearing, in a dense street. */
const LONE = 'strandul-opereta-1976';
const LONE_VIEW = '18/44.42955/26.09560';
const NO_BEARING = 'intrarea-in-fabrica-luceafarul-nufarul';
const NO_BEARING_VIEW = '18.5/44.43082/26.08578';

/**
 * The detail sheet of a photo: a modal bottom sheet (compact) or side sheet (medium) is a dialog; from expanded it is
 * a docked pane, a labelled region.
 */
function detailSheet(page: Page, name: string): Locator {
    const width = page.viewportSize()?.width ?? 0;
    return page.getByRole(windowClassOf(width) === 'compact' || windowClassOf(width) === 'medium' ? 'dialog' : 'region', {
        name,
        exact: true,
    });
}

/** The visible variant of the sheet: `bottom`, `side` (both modal) or `docked`. */
async function sheetVariant(page: Page): Promise<string> {
    const modal = viewer(page).locator('hcm-photo-sheet hcm-sheet[open]');
    return (await modal.count()) > 0 ? ((await modal.getAttribute('variant')) ?? '') : 'docked';
}

function expectedVariant(page: Page): string {
    const windowClass = windowClassOf(page.viewportSize()?.width ?? 0);
    const modal: Partial<Record<string, string>> = { compact: 'bottom', medium: 'side' };
    return modal[windowClass] ?? 'docked';
}

async function clickPhoto(page: Page, id: string): Promise<void> {
    const point = await screenPointOf(page, lngLatOf(id));
    await page.mouse.click(point.x, point.y);
}

test(
    'Clusters expand on zoom, a marker opens the detail sheet, cones show from zoom 17',
    { tag: '@S-V07-HAPPY' },
    async ({ page, lang }) => {
        await openViewer(page, { lang });
        const [cluster] = await renderedPoints(page, 'hcm-photos-cluster');
        expect(cluster, 'the city view shows clusters').toBeDefined();
        const before = (await mapFacts(page)).zoom;
        const at = await screenPointOf(page, cluster?.lngLat ?? [0, 0]);
        await page.mouse.click(at.x, at.y);
        await expect.poll(async () => (await mapFacts(page)).zoom, { message: 'a cluster click zooms in' }).toBeGreaterThan(before + 0.25);
        await expect.poll(async () => (await mapFacts(page)).moving, { message: 'the cluster flight ends' }).toBe(false);

        await page.evaluate((hash) => {
            location.hash = hash;
        }, LONE_VIEW);
        await expect.poll(() => renderedFeatureIds(page, 'hcm-photos-cone')).toContain(LONE);
        await mapIdle(page);
        await clickPhoto(page, LONE);
        const sheet = detailSheet(page, titleOf(LONE, lang));
        await expect(sheet).toBeVisible();
        expect(await sheetVariant(page)).toBe(expectedVariant(page));
        await expect(page.getByRole('img', { name: titleOf(LONE, lang) })).toBeVisible();
        expect(await engineEvents(page, 'hcm-photo-open')).toEqual([{ photoId: LONE }]);

        await page.evaluate(() => {
            location.hash = '16/44.42955/26.09560';
        });
        await expect.poll(async () => (await mapFacts(page)).zoom).toBeLessThan(16.5);
        await expect.poll(() => renderedFeatureIds(page, 'hcm-photos-cone')).toEqual([]);
    },
);

test(
    'A thumbnail that fails shows a placeholder named after the photo',
    { tag: '@S-V07-BAD-IMAGE404' },
    async ({ page, lang, consoleErrors }) => {
        await page.route(`**/data/media/${LONE}/thumb.webp`, (route) => route.fulfill({ status: 404, body: 'gone' }));
        await openViewer(page, { lang, hash: `${LONE_VIEW}&photo=${LONE}` });

        const sheet = detailSheet(page, titleOf(LONE, lang));
        await expect(sheet).toBeVisible();
        const placeholder = page.getByRole('img', { name: titleOf(LONE, lang), exact: true });
        await expect(placeholder).toBeVisible();
        await expect(viewer(page).locator('hcm-photo-sheet .placeholder')).toContainText(t(lang, 'error.photoImage'));
        await expect(page.getByRole('button', { name: t(lang, 'photo.openLightbox') })).toHaveCount(0);
        expect(consoleErrors.take()).toEqual([expect.stringContaining('404')]);
    },
);

test(
    'A photo without a bearing has an unrotated marker, no cone, and still opens',
    { tag: '@S-V07-BAD-NO-BEARING' },
    async ({ page, lang }) => {
        await openViewer(page, { lang, hash: NO_BEARING_VIEW });

        await expect.poll(async () => (await renderedPoints(page, 'hcm-photos-marker')).map((point) => point.id)).toContain(NO_BEARING);
        const marker = (await renderedPoints(page, 'hcm-photos-marker')).find((point) => point.id === NO_BEARING);
        expect(marker?.properties).not.toHaveProperty('bearing');
        expect(await renderedFeatureIds(page, 'hcm-photos-cone')).not.toContain(NO_BEARING);

        await clickPhoto(page, NO_BEARING);
        const sheet = detailSheet(page, titleOf(NO_BEARING, lang));
        await expect(sheet).toBeVisible();
        await expect(viewer(page).locator('hcm-photo-sheet .supporting')).toHaveText(t(lang, 'photo.unknownYear'));
    },
);

function withRightsHolder(id: string, holder: string): Json {
    const manifest = siteManifestData();
    const target = (manifest['photos'] as Json[]).find((candidate) => candidate['id'] === id);
    if (target !== undefined) {
        target['rightsHolder'] = holder;
    }
    return manifest;
}

test('The photo sheet credits the rights holder after the licence', { tag: '@S-V07-HAPPY-RIGHTS-HOLDER' }, async ({ page, lang }) => {
    await serveManifest(page, withRightsHolder(LONE, 'Arhiva Operetei (e2e)'));
    await openViewer(page, { lang, hash: `${LONE_VIEW}&photo=${LONE}` });

    const details = viewer(page).locator('hcm-photo-sheet .details > p');
    // `allTextContents` does not wait, and the sheet renders after `hcm-ready`: poll for the line after the licence.
    await expect
        .poll(async () => {
            const texts = await details.allTextContents();
            const licence = texts.indexOf(t(lang, 'license.permission-legacy'));
            return licence < 0 ? 'no licence line' : texts[licence + 1];
        })
        .toBe(t(lang, 'photo.rightsHolder', { holder: 'Arhiva Operetei (e2e)' }));
});

test(
    'A photo without a rights holder shows its licence and no credit line',
    { tag: '@S-V07-BAD-NO-RIGHTS-HOLDER' },
    async ({ page, lang }) => {
        await openViewer(page, { lang, hash: `${LONE_VIEW}&photo=${LONE}` });

        const details = viewer(page).locator('hcm-photo-sheet .details');
        await expect(details).toContainText(t(lang, 'license.permission-legacy'));
        await expect(details).not.toContainText('©');
    },
);

/** Pinches outwards on `target` with two touch points (Chrome DevTools Protocol touch input). */
async function pinchOut(page: Page, target: Locator): Promise<void> {
    const box = await target.boundingBox();
    const x = (box?.x ?? 0) + (box?.width ?? 0) / 2;
    const y = (box?.y ?? 0) + (box?.height ?? 0) / 2;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [
            { x: x - 20, y, id: 1 },
            { x: x + 20, y, id: 2 },
        ],
    });
    for (const spread of [40, 60, 80, 100]) {
        await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchMove',
            touchPoints: [
                { x: x - spread, y, id: 1 },
                { x: x + spread, y, id: 2 },
            ],
        });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
}

const LIGHTBOX_INDEX = PHOTOS.findIndex((candidate) => candidate.id === LONE);

test(
    'The lightbox zooms with a pinch, steps with the arrows and gives focus back on Esc',
    { tag: '@S-V08-HAPPY' },
    async ({ page, lang }) => {
        await openViewer(page, { lang, hash: `${LONE_VIEW}&photo=${LONE}` });
        const opener = page.getByRole('button', { name: t(lang, 'photo.openLightbox') });
        await opener.click();

        const lightbox = page.getByRole('dialog', { name: t(lang, 'lightbox.label') });
        await expect(lightbox).toBeVisible();
        await expect(lightbox).toBeFocused();
        const position = (index: number): string =>
            t(lang, 'lightbox.position', { index: String(index + 1), total: String(PHOTOS.length) });
        await expect(lightbox.getByText(position(LIGHTBOX_INDEX))).toBeVisible();
        const image = lightbox.getByRole('img', { name: titleOf(LONE, lang) });
        await expect(image).toBeVisible();
        const before = (await image.boundingBox())?.width ?? 0;
        await pinchOut(page, image);
        await expect
            .poll(async () => (await image.boundingBox())?.width ?? 0, { message: 'the pinch zooms the image in' })
            .toBeGreaterThan(before * 1.2);

        await page.keyboard.press('ArrowRight');
        const next = PHOTOS[LIGHTBOX_INDEX + 1]?.id ?? '';
        await expect(lightbox.getByText(position(LIGHTBOX_INDEX + 1))).toBeVisible();
        await expect(lightbox.getByRole('img', { name: titleOf(next, lang) })).toBeVisible();
        await page.keyboard.press('ArrowLeft');
        await expect(lightbox.getByText(position(LIGHTBOX_INDEX))).toBeVisible();

        await page.keyboard.press('Escape');
        await expect(lightbox).toHaveCount(0);
        await expect(opener).toBeFocused();
    },
);

test(
    'Stepping to the last photo with the Next button keeps the focus in the lightbox, and Tab stays inside it',
    { tag: '@S-V08-BAD-FOCUS-AT-LAST-PHOTO' },
    async ({ page, lang }) => {
        const lastIndex = PHOTOS.length - 1;
        const before = PHOTOS[lastIndex - 1]?.id ?? '';
        const [lng, lat] = lngLatOf(before);
        await openViewer(page, { lang, hash: `18/${lat.toFixed(5)}/${lng.toFixed(5)}&photo=${before}` });
        const opener = page.getByRole('button', { name: t(lang, 'photo.openLightbox') });
        await opener.click();
        const lightbox = page.getByRole('dialog', { name: t(lang, 'lightbox.label') });
        await expect(lightbox).toBeFocused();

        // A focused button that becomes disabled drops the focus: Esc and the arrow keys used to stop working here.
        const next = lightbox.getByRole('button', { name: t(lang, 'action.next') });
        await next.focus();
        await page.keyboard.press('Enter');
        await expect(
            lightbox.getByText(t(lang, 'lightbox.position', { index: String(lastIndex + 1), total: String(PHOTOS.length) })),
        ).toBeVisible();
        await expect(next).toBeDisabled();
        await expect(lightbox).toBeFocused();

        await page.keyboard.press('Shift+Tab');
        await expect(lightbox.getByRole('button', { name: t(lang, 'action.previous') })).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(lightbox.getByRole('button', { name: t(lang, 'action.close') })).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(lightbox).toHaveCount(0);
        await expect(opener).toBeFocused();
    },
);

test(
    'On a landscape phone the lightbox fits the whole photo on a scrim that hides the viewer',
    { tag: '@S-V08-BAD-SHORT-WINDOW' },
    async ({ page, lang }) => {
        // UX review: on 915 x 412 the photo overflowed its stage and was cropped, and the photo sheet showed through.
        await page.setViewportSize({ width: 915, height: 412 });
        await openViewer(page, { lang, hash: `${LONE_VIEW}&photo=${LONE}` });
        await page.getByRole('button', { name: t(lang, 'photo.openLightbox') }).click();
        const image = page.getByRole('dialog', { name: t(lang, 'lightbox.label') }).getByRole('img', { name: titleOf(LONE, lang) });
        await expect
            .poll(() => image.evaluate((element) => element instanceof HTMLImageElement && element.naturalWidth > 0), {
                message: 'the full image has loaded',
            })
            .toBe(true);

        const stage = (await viewer(page).locator('hcm-lightbox .stage').boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
        const box = (await image.boundingBox()) ?? { x: 0, y: -1, width: 0, height: 0 };
        expect(box.height, 'the photo is drawn').toBeGreaterThan(0);
        expect(box.y, 'the top of the photo is inside the stage').toBeGreaterThanOrEqual(stage.y - 0.5);
        expect(box.y + box.height, 'the bottom of the photo is inside the stage').toBeLessThanOrEqual(stage.y + stage.height + 0.5);
        const middle = stage.y + stage.height / 2;
        for (const x of [stage.x + 4, stage.x + stage.width - 4]) {
            expect(isColour(await probePixel(page, x, middle), [0, 0, 0]), `the scrim at x = ${String(x)} is opaque`).toBe(true);
        }
    },
);

test(
    'A broken full image shows an error state and the lightbox still closes',
    { tag: '@S-V08-BAD-BROKEN-IMAGE' },
    async ({ page, lang, consoleErrors }) => {
        await page.route(`**/data/media/${LONE}/web.webp`, (route) => route.fulfill({ status: 404, body: 'gone' }));
        await openViewer(page, { lang, hash: `${LONE_VIEW}&photo=${LONE}` });
        const opener = page.getByRole('button', { name: t(lang, 'photo.openLightbox') });
        await opener.click();

        const lightbox = page.getByRole('dialog', { name: t(lang, 'lightbox.label') });
        await expect(lightbox.getByRole('alert')).toContainText(t(lang, 'error.photoImage'));
        await lightbox.getByRole('button', { name: t(lang, 'action.close') }).click();
        await expect(lightbox).toHaveCount(0);
        await expect(opener).toBeFocused();
        expect(consoleErrors.take()).toEqual([expect.stringContaining('404')]);
    },
);
