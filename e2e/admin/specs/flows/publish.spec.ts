import type { Locator, Page } from '@playwright/test';

import { BASEMAP_BACKGROUND, E2E_XYZ_LAYER, type Rgb } from '../../../fixtures/world.js';
import { blend, expectColourAt, mapFraction, renderedFeatureIds, screenPointOf } from '../../../support/map.js';
import { openLayers, opacitySlider, t, visibilitySwitch } from '../../../support/viewer.js';
import { awaitManifest, entries, entry, FLOWS_CITY, flowText, openPublicViewer, seedPublicCity } from '../../support/flows.js';
import { seedPhoto, servePhotoImages } from '../../support/photos.js';
import { ADMIN_LOCK, adminPath, expect, test } from '../../support/test.js';
import { seedCategories } from '../pois/places.js';

// One admin test at a time (the emulators are one Firebase project): see ADMIN_LOCK.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * From the admin to the public viewer (behaviour A41; docs/research/M2c-interfaces.md §5.3, §12.3): what the owner saves
 * in an editor is written by the client, the publish trigger and the manifest build run in the Functions emulator, and
 * the manifest they publish is served to the built viewer, which shows what a visitor sees: a photo's new title, then
 * the old one again after a revert from History, and none once unpublished; a place added from the keyboard; a layer's
 * default opacity, shown-at-start switch and image adjustments. Without the admin's Mapbox token (no `setup/status`), the
 * editors work from their fields, which is what these journeys use; the admin map's own previews are A35's and A36's.
 */
test.use({ persona: 'owner', mapOwner: 'owner' });

const AT = new Date('2026-10-17T09:00:00.000Z');

/** A view of the city's centre at zoom 16 (the photo and the place are there). */
const CENTRE_VIEW = '16/44.43000/26.10000';
/** An empty corner of the city: only the basemap and the historical layer draw there. */
const EMPTY_VIEW = '15/44.37000/25.97000';

function saveButton(page: Page, lang: 'ro' | 'en'): Locator {
    return page.getByRole('button', { name: flowText(lang, 'adminContent.common.save'), exact: true });
}

function dialog(page: Page): Locator {
    return page.locator('hcm-dialog[open]');
}

/** The photo editor's Save (its own text, the same word as the kit's). */
async function savePhoto(page: Page, lang: 'ro' | 'en'): Promise<void> {
    await page.getByRole('button', { name: flowText(lang, 'adminContent.photos.editor.save'), exact: true }).click();
    await expect(page.getByText(flowText(lang, 'adminContent.photos.saved')).and(page.locator(':not([aria-live])'))).toBeVisible();
}

/** Sets an `hcm-slider` from the keyboard: Home, then PageUp (+10) and ArrowRight (+1) until `percent`. */
async function setWithKeys(slider: Locator, percent: number): Promise<void> {
    await slider.focus();
    await slider.press('Home');
    for (let step = 0; step < Math.floor(percent / 10); step += 1) {
        await slider.press('PageUp');
    }
    for (let step = 0; step < percent % 10; step += 1) {
        await slider.press('ArrowRight');
    }
    await expect(slider).toHaveAttribute('aria-valuenow', String(percent));
}

/** The photo's title in the published manifest. */
function photoTitle(manifest: Readonly<Record<string, unknown>>, id: string): unknown {
    return (entry(manifest, 'photos', id)?.['title'] as Readonly<Record<string, unknown>> | undefined)?.['ro'];
}

test(
    'A photo published and renamed in the admin reaches the viewer, a revert brings its old title back, and unpublishing removes it',
    { tag: ['@S-A41-HAPPY-PHOTO', '@S-A41-HAPPY-REVERT', '@S-A41-BAD-UNPUBLISHED'] },
    async ({ page, lang, adminWorld }) => {
        test.setTimeout(240_000);
        const { emulators, accounts } = adminWorld;
        await servePhotoImages(page);
        await seedPublicCity(emulators, AT);
        await seedPhoto(emulators, { id: 'ready', title: 'Calea Victoriei' }, AT, accounts.owner.uid);
        const editor = adminPath(lang, 'photos/ready');

        // Published on, Save: the build publishes the photo.
        await page.goto(editor);
        const published = page.getByRole('switch', { name: flowText(lang, 'adminContent.photos.field.published') });
        await published.click();
        await expect(published).toHaveAttribute('aria-checked', 'true');
        await savePhoto(page, lang);
        await awaitManifest(emulators, 'lists the published photo', (manifest) => photoTitle(manifest, 'ready') === 'Calea Victoriei');

        // A new title, Save: the next build carries it and the visitor sees it.
        const title = page.getByRole('textbox', { name: flowText(lang, 'adminContent.photos.field.titleRo') });
        await title.fill('Calea Victoriei, 1930');
        await savePhoto(page, lang);
        const renamed = await awaitManifest(
            emulators,
            'carries the new title',
            (manifest) => photoTitle(manifest, 'ready') === 'Calea Victoriei, 1930',
        );
        await openPublicViewer(page, renamed, { lang, hash: `${CENTRE_VIEW}&photo=ready` });
        await expect(page.getByRole('heading', { name: 'Calea Victoriei, 1930', exact: true })).toBeVisible();

        // History: the rename's version is reverted (asked first); the next build and the viewer show the old title.
        await page.goto(adminPath(lang, `history/photo/ready`));
        const fields = flowText(lang, 'adminContent.history.fields', { fields: '' });
        await page.getByRole('button', { name: new RegExp(`${fields}title`) }).click();
        await page.getByRole('button', { name: flowText(lang, 'adminContent.history.revert') }).click();
        await dialog(page)
            .getByRole('button', { name: flowText(lang, 'adminContent.history.revert') })
            .click();
        await expect
            .poll(async () => (await emulators.document(`cities/${FLOWS_CITY}/photos/ready`))?.['title'])
            .toEqual({ ro: 'Calea Victoriei' });
        const reverted = await awaitManifest(
            emulators,
            'carries the old title again',
            (manifest) => photoTitle(manifest, 'ready') === 'Calea Victoriei',
        );
        await openPublicViewer(page, reverted, { lang, hash: `${CENTRE_VIEW}&photo=ready` });
        await expect(page.getByRole('heading', { name: 'Calea Victoriei', exact: true })).toBeVisible();

        // Published off, Save: the next build leaves the photo out, and its link says it does not exist.
        await page.goto(editor);
        await page.getByRole('switch', { name: flowText(lang, 'adminContent.photos.field.published') }).click();
        await savePhoto(page, lang);
        const unpublished = await awaitManifest(
            emulators,
            'no longer lists the photo',
            (manifest) => entry(manifest, 'photos', 'ready') === undefined,
        );
        await openPublicViewer(page, unpublished, { lang, hash: `${CENTRE_VIEW}&photo=ready` });
        await expect(page.getByText(t(lang, 'error.unknownPhoto')).and(page.locator(':not([aria-live])'))).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Calea Victoriei', exact: true })).toHaveCount(0);
    },
);

test(
    'A place added from its list of positions is published on save and the viewer draws and opens it',
    { tag: ['@S-A41-HAPPY-PLACE'] },
    async ({ page, lang, adminWorld }) => {
        test.setTimeout(180_000);
        const { emulators } = adminWorld;
        await seedPublicCity(emulators, AT);
        await seedCategories(emulators, AT);
        await page.goto(adminPath(lang, 'pois'));

        // Add place, Point, Add at centre, the position typed, the Romanian title, Save.
        await page.getByRole('button', { name: flowText(lang, 'adminContent.pois.add') }).click();
        await page.getByRole('button', { name: flowText(lang, 'adminContent.pois.shape.point'), exact: true }).click();
        await page.getByRole('button', { name: flowText(lang, 'adminContent.map.tool.addCentre') }).click();
        for (const [id, value] of [
            ['v0-lat', '44.4312'],
            ['v0-lng', '26.1015'],
        ] as const) {
            const field = page.locator(`hcm-vertex-list #${id}`);
            await field.fill(value);
            await field.press('Tab');
        }
        await page.getByRole('textbox', { name: flowText(lang, 'adminContent.pois.field.titleRo') }).fill('Statuia lui Mihai Viteazul');
        await saveButton(page, lang).click();
        await expect.poll(async () => Object.keys(await emulators.collection(`cities/${FLOWS_CITY}/pois`)).length).toBe(1);
        const [placeId = ''] = Object.keys(await emulators.collection(`cities/${FLOWS_CITY}/pois`));

        // Published on save: the build carries the point, and the viewer draws it and opens its details.
        const manifest = await awaitManifest(emulators, 'lists the new place', (built) => entry(built, 'pois', placeId) !== undefined);
        expect(entry(manifest, 'pois', placeId)).toMatchObject({
            category: 'monuments',
            geometry: { type: 'Point', coordinates: [26.1015, 44.4312] },
            title: { ro: 'Statuia lui Mihai Viteazul' },
        });
        await openPublicViewer(page, manifest, { lang, hash: '17/44.43120/26.10150' });
        await expect.poll(() => renderedFeatureIds(page, 'hcm-poi-')).toContain(placeId);
        const point = await screenPointOf(page, [26.1015, 44.4312]);
        await page.mouse.click(point.x, point.y);
        await expect(page.getByRole('heading', { name: 'Statuia lui Mihai Viteazul', exact: true })).toBeVisible();
    },
);

/** Mapbox's `raster-saturation` at -1 turns a pixel into the average of its channels. */
function desaturated([red, green, blue]: Rgb): Rgb {
    const average = Math.round((red + green + blue) / 3);
    return [average, average, average];
}

test(
    "A layer's default opacity, shown-at-start switch and image adjustments reach the viewer",
    { tag: ['@S-A41-HAPPY-LAYER', '@S-A36-HAPPY-SHOWN-AT-START'] },
    async ({ page, lang, adminWorld }) => {
        test.setTimeout(180_000);
        const { emulators } = adminWorld;
        const label = { ro: 'Fotografie aeriană 1980', en: 'Aerial photo 1980' };
        await seedPublicCity(emulators, AT);
        await emulators.setDocument(`cities/${FLOWS_CITY}/layers/${E2E_XYZ_LAYER.id}`, {
            year: E2E_XYZ_LAYER.year,
            label,
            kind: 'aerial',
            attribution: 'Arhivă (e2e)',
            source: { type: 'xyz', tiles: [E2E_XYZ_LAYER.tiles], tileSize: 256 },
            minzoom: 0,
            maxzoom: 22,
            order: 1,
            opacity: 1,
            defaultVisible: false,
            status: 'ready',
            published: true,
            updatedBy: 'system:pipeline',
            updatedAt: AT,
        });
        // The layer is published already: the first build lists it hidden at start, at full opacity.
        await page.goto(adminPath(lang, `layers/${E2E_XYZ_LAYER.id}`));
        await expect(page.getByRole('heading', { level: 2, name: label[lang] })).toBeVisible();

        // Shown at start, 60 % by default, saturation at its minimum; Save.
        const shown = page.getByRole('switch', { name: flowText(lang, 'adminContent.layers.shownAtStart') });
        await shown.click();
        await expect(shown).toHaveAttribute('aria-checked', 'true');
        await setWithKeys(page.getByRole('slider', { name: flowText(lang, 'adminContent.layers.opacity'), exact: true }), 60);
        const saturation = page.getByRole('slider', { name: flowText(lang, 'adminContent.layers.adjust.saturation'), exact: true });
        await saturation.focus();
        await saturation.press('Home');
        await expect(saturation).toHaveAttribute('aria-valuetext', '-100 %');
        await saveButton(page, lang).click();
        await expect
            .poll(async () => await emulators.document(`cities/${FLOWS_CITY}/layers/${E2E_XYZ_LAYER.id}`))
            .toMatchObject({ opacity: 0.6, defaultVisible: true, adjustments: { saturation: -1 } });

        // The manifest carries the three; the viewer starts with the layer shown, at 60 %, without colour.
        const manifest = await awaitManifest(emulators, 'carries the layer defaults', (built) => {
            const layer = entry(built, 'layers', E2E_XYZ_LAYER.id);
            return layer?.['defaultVisible'] === true;
        });
        expect(entries(manifest, 'layers')).toEqual([expect.objectContaining({ opacity: 0.6, adjustments: { saturation: -1 } })]);
        await openPublicViewer(page, manifest, { lang, hash: EMPTY_VIEW });
        await expectColourAt(
            page,
            await mapFraction(page, 0.5, 0.5),
            blend(desaturated(E2E_XYZ_LAYER.colour), BASEMAP_BACKGROUND, 0.6),
            'the layer at 60 %, desaturated',
            { tolerance: 10 },
        );
        await openLayers(page, lang);
        await expect(visibilitySwitch(page, lang, label[lang])).toHaveAttribute('aria-checked', 'true');
        await expect(opacitySlider(page, lang, label[lang])).toHaveAttribute('aria-valuenow', '60');
    },
);
