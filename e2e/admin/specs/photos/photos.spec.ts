import type { Page } from '@playwright/test';

import { recordLiveRegions } from '../../../support/live-regions.js';
import { expectStateSound } from '../../../support/state-check.js';
import { adminVisit } from '../../../tour/states.js';
import { photosText, PHOTOS_CITY, seedPhoto, seedPhotosCity, servePhotoImages } from '../../support/photos.js';
import { ADMIN_LOCK, adminPath, expect, test } from '../../support/test.js';

// One admin test at a time (the emulators are one Firebase project): see ADMIN_LOCK.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * The photos page (docs/research/M2c-interfaces.md §6; behaviours A08, A10): the owner of a map whose server answers
 * opens `#/photos`, sees the empty page, a file refused in the page, then the city's photos as an earlier session left
 * them; selects them all and publishes: the photos that cannot be published are named with their reason and stay
 * unpublished, the rest are published, an English title not required; opens a photo's editor. Every screen and dialog on
 * the way runs the generic layout and accessibility checkers (the photos section of e2e/tour/states.ts).
 */
test.use({ persona: 'owner', mapOwner: 'owner' });

const AT = new Date('2026-10-17T09:00:00.000Z');

/** The page's list of photos (its rows are links to the editors). */
function photoLink(page: Page, title: string) {
    return page.getByRole('link', { name: new RegExp(title) });
}

test(
    'Publishing a selection skips the photos that cannot be published, each with its reason',
    { tag: ['@S-A10-BAD-NOT-PUBLISHABLE'] },
    async ({ page, lang, adminWorld }) => {
        const owner = adminWorld.accounts.owner.uid;
        await page.context().addInitScript(recordLiveRegions);
        await servePhotoImages(page);
        await seedPhotosCity(adminWorld.emulators, AT);
        await page.goto(adminPath(lang, 'photos'));

        // No photo yet: the empty page says how to add some.
        await expect(page.getByText(photosText(lang, 'adminContent.photos.empty'))).toBeVisible();
        await expectStateSound(page, adminVisit('photos.empty', lang));

        // A file no photo upload may be is refused in the page, before anything is written.
        await page
            .locator('hcm-admin-photo-list input[type="file"]')
            .setInputFiles({ name: 'scan.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7') });
        await expect(page.getByText(photosText(lang, 'adminContent.photos.upload.refused'))).toBeVisible();
        await expectStateSound(page, adminVisit('photos.upload-refused', lang));
        expect(await adminWorld.emulators.collection(`cities/${PHOTOS_CITY}/photos`)).toEqual({});

        // The photos an earlier session left: one ready (English title missing), one still processing, one refused, one
        // with an unknown licence.
        const photos = [
            { id: 'ready', title: 'Calea Victoriei' },
            { id: 'pending', title: 'Piața Romană', extra: { processing: 'pending', image: undefined } },
            {
                id: 'refused',
                title: 'Lipscani',
                extra: { processing: 'failed', image: undefined, processingError: 'apiError.photo.unsupportedType' },
            },
            { id: 'unknown', title: 'Gara de Nord', extra: { license: 'unknown', rightsReview: true } },
        ];
        for (const photo of photos) {
            await seedPhoto(adminWorld.emulators, photo, AT, owner);
        }
        await expect(photoLink(page, 'Gara de Nord')).toBeVisible();
        await expectStateSound(page, adminVisit('photos.list', lang));

        // Select them all, then Publish.
        await page.getByRole('checkbox', { name: photosText(lang, 'adminContent.photos.select', { title: 'Calea Victoriei' }) }).check();
        await page.getByRole('button', { name: photosText(lang, 'adminContent.photos.bulk.selectAll') }).click();
        await expect(page.getByText(photosText(lang, 'adminContent.photos.bulk.selected', { count: '4' }))).toBeVisible();
        await expectStateSound(page, adminVisit('photos.bulk', lang));
        await page.getByRole('button', { name: photosText(lang, 'adminContent.photos.bulk.publishAction'), exact: true }).click();

        // One photo published; the three others named with their reason, and left as they were.
        await expect
            .poll(async () => (await adminWorld.emulators.document(`cities/${PHOTOS_CITY}/photos/ready`))?.['published'])
            .toBe(true);
        const seeWhy = page.getByRole('button', { name: photosText(lang, 'adminContent.photos.bulk.seeWhy') });
        await seeWhy.click();
        await expect(page.getByRole('dialog', { name: photosText(lang, 'adminContent.photos.report.title') })).toBeVisible();
        // The dialog's list is slotted content of its element (light DOM), not inside the native dialog of its shadow root.
        const report = page.locator('hcm-dialog.report');
        for (const [title, reason] of [
            ['Piața Romană', 'adminContent.photos.reason.processing'],
            ['Lipscani', 'adminContent.photos.reason.failed'],
            ['Gara de Nord', 'adminContent.photos.reason.license'],
        ] as const) {
            await expect(
                report.getByText(photosText(lang, 'adminContent.photos.reason.line', { title, reason: photosText(lang, reason) })),
            ).toBeVisible();
        }
        await expectStateSound(page, adminVisit('photos.report', lang, { escape: { opener: null } }));
        for (const id of ['pending', 'refused', 'unknown']) {
            expect((await adminWorld.emulators.document(`cities/${PHOTOS_CITY}/photos/${id}`))?.['published']).toBe(false);
        }

        // The photo's editor: its heading takes the focus.
        await photoLink(page, 'Calea Victoriei').click();
        await expect(
            page.getByRole('heading', { name: photosText(lang, 'adminContent.photos.editor.title', { title: 'Calea Victoriei' }) }),
        ).toBeFocused();
        await expectStateSound(page, adminVisit('photos.editor', lang));
    },
);

test('The photo editor names a field to correct, and a delete asks first and offers Undo', async ({ page, lang, adminWorld }) => {
    const owner = adminWorld.accounts.owner.uid;
    await page.context().addInitScript(recordLiveRegions);
    await servePhotoImages(page);
    await seedPhotosCity(adminWorld.emulators, AT);
    await seedPhoto(adminWorld.emulators, { id: 'ready', title: 'Calea Victoriei' }, AT, owner);
    await seedPhoto(adminWorld.emulators, { id: 'other', title: 'Piața Romană' }, AT, owner);
    await page.goto(adminPath(lang, 'photos'));

    // Author, source and licence for a selection: a dialog.
    await page.getByRole('checkbox', { name: photosText(lang, 'adminContent.photos.select', { title: 'Piața Romană' }) }).check();
    const setFields = photosText(lang, 'adminContent.photos.bulk.setFieldsAction');
    await page.getByRole('button', { name: setFields }).click();
    await expect(page.getByRole('dialog', { name: photosText(lang, 'adminContent.photos.setFields.title') })).toBeVisible();
    await expectStateSound(page, adminVisit('photos.set-fields', lang, { escape: { opener: setFields } }));

    // The editor: a source address that is not https is named, and Save stays off.
    await page.goto(adminPath(lang, 'photos/ready'));
    const heading = page.getByRole('heading', { name: photosText(lang, 'adminContent.photos.editor.title', { title: 'Calea Victoriei' }) });
    await expect(heading).toBeVisible();
    await page.getByRole('textbox', { name: photosText(lang, 'adminContent.photos.field.sourceUrl') }).fill('http://arhiva.example');
    await expect(page.getByRole('button', { name: photosText(lang, 'adminContent.photos.editor.save'), exact: true })).toBeDisabled();
    await expectStateSound(page, adminVisit('photos.editor-invalid', lang));
    await page.getByRole('button', { name: photosText(lang, 'adminContent.photos.editor.discard') }).click();

    // Delete asks first; once deleted, the snackbar offers Undo.
    const remove = photosText(lang, 'adminContent.photos.editor.delete');
    await page.getByRole('button', { name: remove }).click();
    await expect(
        page.getByRole('dialog', { name: photosText(lang, 'adminContent.photos.delete.titleOne', { title: 'Calea Victoriei' }) }),
    ).toBeVisible();
    await expectStateSound(page, adminVisit('photos.delete-confirm', lang, { escape: { opener: remove } }));
    await page.getByRole('button', { name: remove }).click();
    await page
        .locator('hcm-confirm-dialog')
        .getByRole('button', { name: photosText(lang, 'adminContent.photos.delete.confirm'), exact: true })
        .click();
    // The snackbar's Undo is the kit's action button, with its 48 px target and its whole label on a phone since CR-M2c-17
    // of docs/research/M2c-interfaces.md.
    const deleted = photosText(lang, 'adminContent.photos.deleted', { title: 'Calea Victoriei' });
    await expect(page.getByText(deleted).and(page.locator(':not([aria-live])'))).toBeVisible();
    await expect(page.getByRole('button', { name: photosText(lang, 'adminContent.photos.undoAction'), exact: true })).toBeVisible();
    await expectStateSound(page, adminVisit('photos.deleted-undo', lang, { announcements: [deleted] }));
    await expect.poll(() => adminWorld.emulators.document(`cities/${PHOTOS_CITY}/photos/ready`)).toBeUndefined();
});
