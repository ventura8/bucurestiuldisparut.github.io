import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';

import { HCM_PHOTO_LIST_TAG, HcmPhotoList, defineHcmPhotoList } from '../../src/viewer/hcm-photo-list.js';
import { mountElement, recordEvents, shadowQueryAll } from './doubles.js';
import { TEST_MANIFEST_URL, testManifest } from './fixtures.js';

const MANIFEST = testManifest();

describe('<hcm-photo-list>', () => {
    beforeAll(() => {
        defineHcmPhotoList();
    });

    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_everyPhotoWithItsDateAndACount', async () => {
        const element = await mountElement<HcmPhotoList>(HCM_PHOTO_LIST_TAG, { photos: MANIFEST.photos, manifestUrl: TEST_MANIFEST_URL });

        await expect.element(page.getByRole('status')).toHaveTextContent('3 fotografii');
        await expect.element(page.getByRole('list', { name: 'Lista fotografiilor' })).toBeVisible();
        expect(shadowQueryAll(element, 'button').map((button) => button.textContent.replace(/\s+/g, ' ').trim())).toEqual([
            'Mihai Vodă Anii 1978–1979',
            'Strada Uranus Iulie 1984',
            'Fără an An necunoscut',
        ]);
        expect(shadowQueryAll(element, 'img')[0]?.getAttribute('src')).toBe(
            `${location.origin}/seed/bucharest/derived/mihai-voda-1978/thumb.webp`,
        );
    });

    it('happyPath_choosingAPhotoFiresItsId', async () => {
        const element = await mountElement<HcmPhotoList>(HCM_PHOTO_LIST_TAG, {
            photos: MANIFEST.photos,
            locale: 'en',
            manifestUrl: TEST_MANIFEST_URL,
        });
        const events = recordEvents(element, 'hcm-photo-select');

        await page.getByRole('button', { name: /Mihai Vodă church/ }).click();

        expect(events).toEqual([{ type: 'hcm-photo-select', detail: { photoId: 'mihai-voda-1978' } }]);
        await expect.element(page.getByRole('status')).toHaveTextContent('3 photos');
    });

    it('badPath_noPhotosShowsAZeroCount', async () => {
        const element = await mountElement<HcmPhotoList>(HCM_PHOTO_LIST_TAG, { photos: [] });

        await expect.element(page.getByRole('status')).toHaveTextContent('0 fotografii');
        expect(shadowQueryAll(element, 'li')).toHaveLength(0);
    });

    it('badPath_anUnresolvableThumbnailLeavesAnEmptyImage', async () => {
        const element = await mountElement<HcmPhotoList>(HCM_PHOTO_LIST_TAG, {
            photos: MANIFEST.photos.slice(0, 1),
            manifestUrl: 'https://[bad',
        });

        expect(shadowQueryAll(element, 'img')[0]?.getAttribute('src')).toBe('');
    });

    it('badPath_definingTwiceKeepsTheFirstRegistration', () => {
        defineHcmPhotoList();

        expect(customElements.get(HCM_PHOTO_LIST_TAG)).toBe(HcmPhotoList);
    });
});
