/** `<hcm-unplaced-gallery>` (M13, V40): the photos with no place, each linking to the page that signs in. */
import type { UnplacedPhoto } from '@hcm/shared';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';

import { browserServices } from '../../src/viewer/services.js';
import { HCM_UNPLACED_GALLERY_TAG, defineHcmUnplacedGallery, type HcmUnplacedGallery } from '../../src/viewer/hcm-unplaced-gallery.js';
import { HCM_PHOTO_SHEET_TAG, defineHcmPhotoSheet, type HcmPhotoSheet } from '../../src/viewer/hcm-photo-sheet.js';
import { menuAction } from '../../src/viewer/viewer-actions.js';
import { mountElement, shadowQueryAll } from './doubles.js';
import { FakeStore, readyState } from './fake-store.js';
import { TEST_MANIFEST_URL, testManifest } from './fixtures.js';
import { fakeServices } from './viewer-harness.js';

const CONTRIBUTE = 'https://demo.web.app/admin/#/contribute/bucharest';

function firstPhoto() {
    const [photo] = testManifest().photos;
    if (photo === undefined) {
        throw new Error('the fixture has photos');
    }
    return photo;
}

function unplaced() {
    const entries = Object.entries(firstPhoto()).filter(([key]) => !['location', 'bearing', 'fov'].includes(key));
    return { ...(Object.fromEntries(entries) as unknown as UnplacedPhoto), id: 'lost', credit: 'Maria' };
}

describe('<hcm-unplaced-gallery>', () => {
    beforeAll(() => {
        defineHcmUnplacedGallery();
        defineHcmPhotoSheet();
    });

    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_aPhotoLinksToItsSuggestionPage @S-V40-HAPPY-GALLERY', async () => {
        const element = await mountElement<HcmUnplacedGallery>(HCM_UNPLACED_GALLERY_TAG, {
            photos: [unplaced()],
            manifestUrl: TEST_MANIFEST_URL,
            contributeUrl: CONTRIBUTE,
            locale: 'en',
        });
        await expect.element(page.getByRole('list', { name: 'Where was this taken?' })).toBeVisible();
        const link = page.getByRole('link', { name: 'I know where' });
        await expect.element(link).toHaveAttribute('href', `${CONTRIBUTE}/lost`);
        await expect.element(link).toHaveAttribute('rel', 'noopener noreferrer nofollow ugc');
        expect(shadowQueryAll(element, 'img')[0]?.getAttribute('alt')).toBeTruthy();
    });

    it('badPath_noLinkWithoutAContributePage @S-V40-BAD-NO-BACKEND', async () => {
        const element = await mountElement<HcmUnplacedGallery>(HCM_UNPLACED_GALLERY_TAG, { photos: [unplaced()], contributeUrl: null });
        expect(shadowQueryAll(element, 'a')).toHaveLength(0);
        expect(shadowQueryAll(element, 'img')).toHaveLength(1);
    });

    it('happyPath_aPhotoSheetSaysItsCreditAndOffersACorrection @S-V41-HAPPY-CORRECTION-LINK', async () => {
        const photo = firstPhoto();
        await mountElement<HcmPhotoSheet>(HCM_PHOTO_SHEET_TAG, {
            photo: { ...photo, credit: 'Maria' },
            open: true,
            mode: 'bottom',
            locale: 'en',
            manifestUrl: TEST_MANIFEST_URL,
            contributeUrl: CONTRIBUTE,
        });
        await expect.element(page.getByText('Added by Maria')).toBeVisible();
        await expect.element(page.getByRole('link', { name: 'Suggest a correction' })).toHaveAttribute('href', `${CONTRIBUTE}/${photo.id}`);
    });

    it('badPath_noCorrectionLinkWithoutAContributePage', async () => {
        const photo = firstPhoto();
        const element = await mountElement<HcmPhotoSheet>(HCM_PHOTO_SHEET_TAG, {
            photo,
            open: true,
            mode: 'bottom',
            manifestUrl: TEST_MANIFEST_URL,
        });
        expect(shadowQueryAll(element, 'a').filter((link) => link.textContent.includes('Propune'))).toHaveLength(0);
    });
});

describe('the menu', () => {
    it('happyPath_contributeOpensAPageOfItsOwn @S-V41-HAPPY-LINK', () => {
        const openPage = vi.fn();
        const store = new FakeStore(readyState({ ...testManifest(), contributeUrl: CONTRIBUTE }));
        menuAction(store, fakeServices({ openPage }), 'contribute');
        expect(openPage).toHaveBeenCalledWith(CONTRIBUTE);
    });

    it('badPath_noPageNoOpening', () => {
        const openPage = vi.fn();
        menuAction(new FakeStore(readyState()), fakeServices({ openPage }), 'contribute');
        expect(openPage).not.toHaveBeenCalled();
    });

    it('happyPath_theGalleryIsASheet', () => {
        const store = new FakeStore(readyState());
        menuAction(store, fakeServices(), 'unplaced');
        expect(store.callsOf('openSheet')).toEqual([['unplaced']]);
    });

    it('happyPath_theBrowserOpensItWithNothingPassedOn', () => {
        const open = vi.fn();
        browserServices({ navigator: {}, location: { href: 'x' }, open, matchMedia: () => null } as unknown as Window).openPage(CONTRIBUTE);
        expect(open).toHaveBeenCalledWith(CONTRIBUTE, '_blank', 'noopener');
    });
});
