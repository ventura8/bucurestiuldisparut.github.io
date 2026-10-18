import type { Locator, Page, Request, Route } from '@playwright/test';

import { apiText, setupText } from '../support/i18n.js';
import { SetupPage } from '../support/setup-page.js';
import { seedClaimedCity, seedSetupStatus } from '../support/steps.js';
import { ADMIN_LOCK, expect, test } from '../support/test.js';
import type { EmulatorWorld } from '../support/emulators.js';

// One admin test at a time (the emulators are one Firebase project): see ADMIN_LOCK.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * The legacy Bucharest import (docs/research/M2b-interfaces.md §3.3 h; behaviour A28) on a claimed map: one click
 * creates a photo document per bundled record and uploads its original through the normal path, `photos.onUpload`
 * processes it in the Functions emulator, and the photo is published. It is idempotent by document id and `legacyId`:
 * a second run writes nothing, a closed tab resumes with the photos that have no image, and a photo that fails
 * processing is listed with its reason while the others are imported.
 */

test.use({ persona: 'owner', mapOwner: 'owner' });

/** The bundle's records (`seed/bucharest`, migrated as is). */
const LEGACY_PHOTOS = 45;

test.beforeEach(async ({ adminWorld }) => {
    await seedClaimedCity(adminWorld.emulators, adminWorld.accounts.owner.uid);
    await seedSetupStatus(adminWorld.emulators, adminWorld.accounts.owner.uid);
});

async function importCard(page: Page, lang: 'ro' | 'en'): Promise<{ readonly card: Locator; readonly action: Locator }> {
    const setup = new SetupPage(page, lang);
    await setup.visit('mapbox');
    const card = await setup.show('legacyImport');
    return {
        card,
        action: card.getByRole('button', { name: setupText(lang, 'adminSetup.import.action', { count: String(LEGACY_PHOTOS) }) }),
    };
}

/** The legacy photos of the city: by id, whether `photos.onUpload` gave each an image and whether it is published. */
async function legacyPhotos(
    emulators: EmulatorWorld,
): Promise<{ readonly id: string; readonly image: boolean; readonly published: boolean }[]> {
    const photos = await emulators.collection('cities/bucharest/photos');
    return Object.entries(photos)
        .filter(([, photo]) => photo['legacyId'] !== undefined)
        .map(([id, photo]) => ({ id, image: photo['image'] !== undefined, published: photo['published'] === true }));
}

/** Waits until the import is done (the card, opened again: Setup closes it when the last step is done) and says so. */
async function imported(page: Page, lang: 'ro' | 'en'): Promise<void> {
    const setup = new SetupPage(page, lang);
    await setup.expectState('legacyImport', 'ok', 300_000);
    await expect(
        (await setup.show('legacyImport')).getByText(setupText(lang, 'adminSetup.import.done', { count: String(LEGACY_PHOTOS) })),
    ).toBeVisible();
}

/** Counts the page's uploads of originals to the Storage emulator. */
function countUploads(page: Page): () => number {
    let uploads = 0;
    page.on('request', (request: Request) => {
        if (request.method() === 'POST' && /\/v0\/b\/[^/]+\/o\?.*name=uploads/.test(request.url())) {
            uploads += 1;
        }
    });
    return () => uploads;
}

test(
    'Importing again, from a tab opened before the first import ended, creates no document and uploads nothing',
    { tag: ['@S-A28-BAD-RERUN-IDEMPOTENT'] },
    async ({ page, lang, adminWorld }) => {
        test.setTimeout(420_000);
        const second = await page.context().newPage();
        const first = await importCard(page, lang);
        const stale = await importCard(second, lang);
        await first.action.click();
        await imported(page, lang);
        const before = await legacyPhotos(adminWorld.emulators);

        // The other tab still offers the import: it finds every photo done.
        const uploads = countUploads(second);
        await stale.action.click();
        await imported(second, lang);
        expect(uploads()).toBe(0);
        expect(await legacyPhotos(adminWorld.emulators)).toEqual(before);
        expect(before).toHaveLength(LEGACY_PHOTOS);
    },
);

test(
    'An import whose tab closed resumes with the photos that have no image and finishes',
    { tag: ['@S-A28-BAD-RESUME'] },
    async ({ page, lang, adminWorld }) => {
        test.setTimeout(420_000);
        const first = await importCard(page, lang);
        await first.action.click();
        await expect
            .poll(async () => (await legacyPhotos(adminWorld.emulators)).filter((photo) => photo.image).length, { timeout: 120_000 })
            .toBeGreaterThan(5);
        await page.close();
        const withImage = (await legacyPhotos(adminWorld.emulators)).filter((photo) => photo.image).length;

        const again = await page.context().newPage();
        const uploads = countUploads(again);
        const resumed = await importCard(again, lang);
        await resumed.action.click();
        await imported(again, lang);
        const photos = await legacyPhotos(adminWorld.emulators);
        expect(photos).toHaveLength(LEGACY_PHOTOS);
        expect(photos.every((photo) => photo.image && photo.published)).toBe(true);
        // Only the photos without an image when the tab closed were sent again.
        expect(uploads()).toBeLessThanOrEqual(LEGACY_PHOTOS - withImage);
    },
);

test(
    'A photo that fails processing is listed with its reason, and the other photos are imported and published',
    { tag: ['@S-A28-BAD-PROCESSING-FAILED'] },
    async ({ page, lang, adminWorld }) => {
        test.setTimeout(420_000);
        // One original is damaged on its way: its bytes are no image.
        let damaged: string | null = null;
        await page.route('**/legacy/bucharest/originals/**', async (route: Route) => {
            if (damaged === null) {
                damaged = new URL(route.request().url()).pathname;
                await route.fulfill({ status: 200, contentType: 'image/jpeg', body: Buffer.from('not an image at all') });
                return;
            }
            await route.fallback();
        });
        const { card, action } = await importCard(page, lang);
        await action.click();

        const failed = card.locator('[data-photo]');
        await expect(failed).toHaveCount(1, { timeout: 300_000 });
        await expect(card.getByText(setupText(lang, 'adminSetup.import.failed', { count: '1' }))).toBeVisible({ timeout: 300_000 });
        // The server sniffs the bytes: they are no image of a type it takes.
        await expect(failed).toContainText(apiText(lang, 'apiError.photo.unsupportedType'));
        await expect
            .poll(async () => (await legacyPhotos(adminWorld.emulators)).filter((photo) => photo.image && photo.published).length, {
                timeout: 120_000,
            })
            .toBe(LEGACY_PHOTOS - 1);
    },
);
