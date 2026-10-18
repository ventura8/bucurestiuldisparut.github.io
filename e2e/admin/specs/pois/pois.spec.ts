import { readFile } from 'node:fs/promises';

import type { Page } from '@playwright/test';

import { recordLiveRegions } from '../../../support/live-regions.js';
import { expectStateSound } from '../../../support/state-check.js';
import { adminVisit } from '../../../tour/states.js';
import { ADMIN_LOCK, adminPath, expect, test } from '../../support/test.js';
import { chooseImport, feature, POIS_PATH, poisText, seedCategories, seedPlace, seedPoisCity } from './places.js';

// One admin test at a time (the emulators are one Firebase project): see ADMIN_LOCK.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * The places page (docs/research/M2c-interfaces.md §7; behaviours A32, A34) for the owner of a map whose Mapbox step is
 * not done yet: no admin token, so the page's map box says why and links to the step, and every place is edited without
 * a map: Add at centre (the city's view centre), the positions typed in the list, a position removed, the texts, Save;
 * then the GeoJSON export, its import changing nothing, a file that is not GeoJSON, and a file whose invalid features are
 * listed with their reasons while the valid one imports. Every screen and dialog on the way runs the generic layout and
 * accessibility checkers (the pois section of e2e/tour/states.ts). The map's own drawing (S-A32-HAPPY and its rows)
 * needs the admin tier's Mapbox mocks (CR-M2c-7).
 */
test.use({ persona: 'owner', mapOwner: 'owner' });

const AT = new Date('2026-10-17T09:00:00.000Z');

/** A row of the places list (its link opens the place). */
function placeLink(page: Page, title: string) {
    return page.getByRole('link', { name: new RegExp(title) });
}

/** A coordinate field of the list of positions: `v<index>-lat` or `v<index>-lng`. */
function coordinate(page: Page, id: string) {
    return page.locator(`hcm-vertex-list #${id}`);
}

/** Types a coordinate and leaves the field (the list reads it on change). */
async function typeCoordinate(page: Page, id: string, value: string): Promise<void> {
    const field = coordinate(page, id);
    await field.fill(value);
    await field.press('Tab');
}

test(
    'Without the Mapbox token a place is still drawn from its positions, saved, and deleted after a question',
    { tag: ['@S-A32-BAD-NO-MAP-TOKEN'] },
    async ({ page, lang, adminWorld }) => {
        await page.context().addInitScript(recordLiveRegions);
        await seedPoisCity(adminWorld.emulators, AT);
        await seedCategories(adminWorld.emulators, AT);
        await page.goto(adminPath(lang, 'pois'));

        // No place yet: the empty list says how to add one.
        await expect(page.getByText(poisText(lang, 'adminContent.pois.empty'))).toBeVisible();
        await expectStateSound(page, adminVisit('pois.empty', lang));

        // Add place asks which shape.
        await page.getByRole('button', { name: poisText(lang, 'adminContent.pois.add') }).click();
        const line = page.getByRole('button', { name: poisText(lang, 'adminContent.pois.shape.linestring'), exact: true });
        await expect(line).toBeVisible();
        await expectStateSound(page, adminVisit('pois.add-shape', lang));

        // A new line: the map box says why there is no map and leads to the Mapbox step; the tools and the list still work.
        await line.click();
        await expect(page.getByRole('heading', { name: poisText(lang, 'adminContent.pois.newPlace') })).toBeVisible();
        await expect(page.getByText(poisText(lang, 'adminContent.map.noToken'))).toBeVisible();
        await expect(page.getByRole('link', { name: poisText(lang, 'adminContent.map.openSetup') })).toHaveAttribute(
            'href',
            '#/setup/mapbox',
        );
        await expect(page.getByText(poisText(lang, 'adminContent.map.verticesEmpty'))).toBeVisible();
        await expectStateSound(page, adminVisit('pois.new-place', lang));

        // Add at centre puts the city's view centre; the first position is typed; two more added, the last one removed.
        const addAtCentre = page.getByRole('button', { name: poisText(lang, 'adminContent.map.tool.addCentre') });
        await addAtCentre.click();
        await expect(coordinate(page, 'v0-lat')).toHaveValue('44.43');
        await typeCoordinate(page, 'v0-lat', '44.44');
        await addAtCentre.click();
        await addAtCentre.click();
        await expect(coordinate(page, 'v2-lng')).toHaveValue('26.1');
        await page.getByRole('button', { name: poisText(lang, 'adminContent.map.removeVertex', { number: '3' }) }).click();
        await expect(coordinate(page, 'v2-lng')).toHaveCount(0);
        await typeCoordinate(page, 'v1-lng', '26.11');

        // The texts: the description's preview shows its emphasis as text, never as markup from the field.
        await page.getByRole('textbox', { name: poisText(lang, 'adminContent.pois.field.titleRo') }).fill('Strada Lipscani');
        const description = page.getByRole('textbox', { name: poisText(lang, 'adminContent.pois.field.descriptionRo') });
        await description.fill('**Strada** negustorilor');
        await description.press('Tab');
        const preview = page.getByRole('region', {
            name: poisText(lang, 'adminContent.pois.field.preview', { language: poisText(lang, 'adminContent.pois.language.ro') }),
        });
        await expect(preview.locator('strong')).toHaveText('Strada');

        // Save writes the line, published, in the first category.
        await page.getByRole('button', { name: poisText(lang, 'adminContent.common.save'), exact: true }).click();
        await expect.poll(async () => Object.values(await adminWorld.emulators.collection(POIS_PATH)).length).toBe(1);
        const [saved] = Object.values(await adminWorld.emulators.collection(POIS_PATH));
        expect(saved).toMatchObject({
            category: 'monuments',
            geometry: {
                type: 'LineString',
                points: [
                    { lat: 44.44, lng: 26.1 },
                    { lat: 44.43, lng: 26.11 },
                ],
            },
            title: { ro: 'Strada Lipscani' },
            description: { ro: '**Strada** negustorilor' },
            published: true,
        });
        await expect(page.getByText(poisText(lang, 'adminContent.pois.state.saved'), { exact: true })).toBeVisible();
        await expectStateSound(page, adminVisit('pois.editor', lang));

        // Delete asks first; the place leaves the list.
        const remove = poisText(lang, 'adminContent.pois.delete');
        await page.getByRole('button', { name: remove }).click();
        await expect(
            page.getByRole('dialog', { name: poisText(lang, 'adminContent.pois.deleteTitle', { title: 'Strada Lipscani' }) }),
        ).toBeVisible();
        await expectStateSound(page, adminVisit('pois.delete-confirm', lang, { escape: { opener: remove } }));
        await page.getByRole('button', { name: remove }).click();
        await page.getByRole('button', { name: poisText(lang, 'adminContent.pois.deleteConfirm'), exact: true }).click();
        await expect.poll(async () => Object.values(await adminWorld.emulators.collection(POIS_PATH)).length).toBe(0);
        await expect(page.getByText(poisText(lang, 'adminContent.pois.deleted'))).toBeVisible();
    },
);

test(
    'Exported places import unchanged, a file that is not GeoJSON is refused, and invalid features are listed and left out',
    { tag: ['@S-A34-HAPPY-ROUND-TRIP', '@S-A34-BAD-NOT-GEOJSON', '@S-A34-BAD-INVALID-FEATURES'] },
    async ({ page, lang, adminWorld }) => {
        const owner = adminWorld.accounts.owner.uid;
        await page.context().addInitScript(recordLiveRegions);
        await seedPoisCity(adminWorld.emulators, AT);
        await seedCategories(adminWorld.emulators, AT);
        await seedPlace(
            adminWorld.emulators,
            {
                id: 'stavropoleos',
                title: 'Biserica Stavropoleos',
                at: [26.0985, 44.4317],
                extra: { yearStart: 1890, links: [{ url: 'https://example.org/stavropoleos', label: 'Istoric' }] },
            },
            AT,
            owner,
        );
        await seedPlace(
            adminWorld.emulators,
            { id: 'manuc', title: 'Hanul lui Manuc', at: [26.1003, 44.4302], extra: { category: 'markets' } },
            AT,
            owner,
        );
        const seeded = await adminWorld.emulators.collection(POIS_PATH);
        await page.goto(adminPath(lang, 'pois'));
        await expect(placeLink(page, 'Hanul lui Manuc')).toBeVisible();
        await expectStateSound(page, adminVisit('pois.list', lang));

        // Export all: a GeoJSON file of both places, with their ids and fields.
        const download = page.waitForEvent('download');
        await page.getByRole('button', { name: poisText(lang, 'adminContent.pois.export') }).click();
        const exported = await (await download).path();
        const collection = JSON.parse(await readFile(exported, 'utf8')) as {
            features: { id: string; properties: Record<string, unknown> }[];
        };
        expect(collection.features.map((item) => item.id).sort((a, b) => a.localeCompare(b))).toEqual(['manuc', 'stavropoleos']);

        // Importing it again changes nothing: both unchanged, no Import offered.
        await page.locator('hcm-poi-list input[type="file"]').setInputFiles(exported);
        // The dialog's texts are slotted content of its element (light DOM), not inside the native dialog of its shadow root.
        const dialog = page.locator('hcm-dialog.import-dialog');
        await expect(dialog.getByText(poisText(lang, 'adminContent.pois.import.unchanged', { count: '2' }))).toBeVisible();
        await expect(dialog.getByText(poisText(lang, 'adminContent.pois.import.created', { count: '0' }))).toBeVisible();
        await expect(page.getByRole('button', { name: poisText(lang, 'adminContent.pois.import.go'), exact: true })).toHaveCount(0);
        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog')).toHaveCount(0);

        // A file that is not GeoJSON: one message, no preview, nothing written.
        await chooseImport(page, { name: 'notes.txt', mimeType: 'text/plain', text: 'Strada Lipscani, 1890' });
        await expect(page.getByText(poisText(lang, 'adminContent.pois.import.file.not-geojson'))).toBeVisible();
        await expect(page.getByText(poisText(lang, 'adminContent.pois.import.dryRun'))).toHaveCount(0);
        await expectStateSound(page, adminVisit('pois.import-refused', lang, { escape: { opener: null } }));
        expect(await adminWorld.emulators.collection(POIS_PATH)).toEqual(seeded);

        // Invalid features are listed with their reasons; the valid one is the only one written.
        const features = [
            feature({ type: 'Point', coordinates: [26.1046, 44.4335] }, { title: { ro: 'Biserica Colțea' }, category: 'monuments' }),
            feature({ type: 'MultiPolygon', coordinates: [] }, { title: { ro: 'Parcul Carol' } }),
            feature({ type: 'Point', coordinates: [26.104, 44.433, 80] }, { title: { ro: 'Turnul Colței' }, category: 'monuments' }),
            feature(
                {
                    type: 'Polygon',
                    coordinates: [
                        [
                            [26.1, 44.42],
                            [26.11, 44.42],
                            [26.11, 44.43],
                            [26.1, 44.43],
                        ],
                    ],
                },
                { title: { ro: 'Piața Unirii' }, category: 'markets' },
            ),
            feature({ type: 'Point', coordinates: [28.6, 44.17] }, { title: { ro: 'Cazinoul din Constanța' }, category: 'monuments' }),
            feature({ type: 'Point', coordinates: [26.098, 44.436] }, { title: { ro: 'Teatrul Național' }, category: 'theatres' }),
        ];
        await chooseImport(page, {
            name: 'locuri.geojson',
            mimeType: 'application/geo+json',
            text: JSON.stringify({ type: 'FeatureCollection', features }),
        });
        await expect(dialog.getByText(poisText(lang, 'adminContent.pois.import.created', { count: '1' }))).toBeVisible();
        await expect(dialog.getByText(poisText(lang, 'adminContent.pois.import.refused', { count: '5' }))).toBeVisible();
        for (const [number, title, reason] of [
            ['2', 'Parcul Carol', 'adminContent.pois.import.reason.unsupported-type'],
            ['3', 'Turnul Colței', 'adminContent.pois.import.reason.altitude'],
            ['4', 'Piața Unirii', 'adminContent.pois.import.reason.open-ring'],
            ['5', 'Cazinoul din Constanța', 'adminContent.pois.import.reason.outside'],
            ['6', 'Teatrul Național', 'adminContent.pois.import.reason.unknown-category'],
        ] as const) {
            await expect(
                dialog.getByText(poisText(lang, 'adminContent.pois.import.refusedItem', { number, title, reason: poisText(lang, reason) })),
            ).toBeVisible();
        }
        expect(await adminWorld.emulators.collection(POIS_PATH)).toEqual(seeded);
        await expectStateSound(page, adminVisit('pois.import-preview', lang));
        await page.getByRole('button', { name: poisText(lang, 'adminContent.pois.import.go'), exact: true }).click();
        await expect(dialog.getByText(poisText(lang, 'adminContent.pois.import.done', { written: '1' }))).toBeVisible();
        const after = await adminWorld.emulators.collection(POIS_PATH);
        const added = Object.entries(after).filter(([id]) => !(id in seeded));
        expect(added).toHaveLength(1);
        expect(added[0]?.[1]).toMatchObject({
            category: 'monuments',
            geometry: { type: 'Point', point: { lat: 44.4335, lng: 26.1046 } },
            title: { ro: 'Biserica Colțea' },
        });
        expect({ manuc: after['manuc'], stavropoleos: after['stavropoleos'] }).toEqual(seeded);
    },
);
