import type { Photo } from '@hcm/shared';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';

import { HCM_PHOTO_SHEET_TAG, HcmPhotoSheet, defineHcmPhotoSheet } from '../../src/viewer/hcm-photo-sheet.js';
import { defineHcmPoiDetail } from '../../src/viewer/hcm-poi-detail.js';
import { defineKitDoubles, mountElement, recordEvents, shadowQuery, shadowText } from './doubles.js';
import { TEST_MANIFEST_URL, testManifest } from './fixtures.js';

const MANIFEST = testManifest();

function photo(id: string): Photo {
    const found = MANIFEST.photos.find((candidate) => candidate.id === id);
    if (found === undefined) {
        throw new Error(id);
    }
    return found;
}

async function sheet(properties: Partial<HcmPhotoSheet> = {}): Promise<HcmPhotoSheet> {
    return mountElement<HcmPhotoSheet>(HCM_PHOTO_SHEET_TAG, {
        photos: MANIFEST.photos,
        open: true,
        mode: 'docked',
        manifestUrl: TEST_MANIFEST_URL,
        ...properties,
    });
}

describe('<hcm-photo-sheet>', () => {
    beforeAll(() => {
        defineKitDoubles();
        defineHcmPoiDetail();
        defineHcmPhotoSheet();
    });

    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_photoDetailsAsTextAndSafeLinks', async () => {
        const element = await sheet({ photo: photo('mihai-voda-1978') });

        await expect.element(page.getByRole('heading', { name: 'Mihai Vodă' })).toBeVisible();
        const text = shadowText(element);
        expect(text).toContain('Anii 1978–1979');
        expect(text).toContain('Autor: Dan Vartanian');
        expect(text).toContain('Publicată cu permisiune, din proiectul comunitar original');
        expect(text).toContain('Drepturile acestei fotografii sunt în curs de verificare.');
        expect(text).toContain('Strada spre Dâmbovița.');
        const link = page.getByRole('link', { name: 'Flickr' });
        await expect.element(link).toHaveAttribute('rel', 'noopener noreferrer nofollow ugc');
        await expect.element(link).toHaveAttribute('target', '_blank');
        const image = shadowQuery(element, 'img') as HTMLImageElement;
        expect(image.getAttribute('src')).toBe(`${location.origin}/seed/bucharest/derived/mihai-voda-1978/thumb.webp`);
        expect(image.alt).toBe('Mihai Vodă');
        expect(image.loading).toBe('lazy');
    });

    it('happyPath_theRightsHolderFollowsTheLicence', async () => {
        const element = await sheet({ photo: photo('uranus-1984') });

        expect(shadowText(element)).toContain('© Arhiva Uranus');
    });

    it('badPath_noRightsHolderLineWithoutOne', async () => {
        const element = await sheet({ photo: photo('mihai-voda-1978') });

        expect(shadowText(element)).not.toContain('©');
    });

    it('happyPath_englishTitleAndTheLightboxButton', async () => {
        const element = await sheet({ photo: photo('mihai-voda-1978'), locale: 'en' });
        const events = recordEvents(element, 'hcm-lightbox-open');

        await page.getByRole('button', { name: 'Open the full-size photo' }).click();

        expect(events).toEqual([{ type: 'hcm-lightbox-open', detail: { photoId: 'mihai-voda-1978' } }]);
        await expect.element(page.getByRole('heading', { name: 'Mihai Vodă church' })).toBeVisible();
    });

    it('badPath_aMissingImageShowsAPlaceholderNamedAfterThePhoto', async () => {
        const element = await sheet({ photo: photo('fara-an') });

        shadowQuery(element, 'img').dispatchEvent(new Event('error'));
        await element.updateComplete;

        expect(element.shadowRoot?.querySelector('img')).toBeNull();
        await expect.element(page.getByRole('img', { name: 'Fără an' })).toBeVisible();
        expect(shadowText(element)).toContain('Imaginea nu s-a putut încărca.');
        expect(shadowText(element)).toContain('An necunoscut');

        element.photo = photo('uranus-1984');
        await element.updateComplete;
        expect(element.imageFailed).toBe(false);
        expect(shadowText(element)).toContain('Iulie 1984');
        expect(element.shadowRoot?.querySelector('.details section')).toBeNull();
    });

    it('badPath_anUnresolvableImageAddressIsAPlaceholderToo', async () => {
        const element = await sheet({ photo: photo('fara-an'), manifestUrl: 'https://[bad' });

        expect(element.shadowRoot?.querySelector('img')).toBeNull();
        expect(element.shadowRoot?.querySelector('.placeholder')).not.toBeNull();
    });

    it('happyPath_aPoiRendersItsDetailsInTheSameSheet', async () => {
        const poi = MANIFEST.pois?.find((candidate) => candidate.id === 'casa-uranus') ?? null;
        const category = MANIFEST.poiCategories?.[0] ?? null;
        const element = await sheet({ poi, category, photo: photo('uranus-1984'), mode: 'bottom' });

        const frame = shadowQuery(element, 'hcm-sheet') as HTMLElement & { label: string; variant: string };
        expect(frame.label).toBe('Casa de pe Uranus');
        expect(frame.variant).toBe('bottom');
        const detail = shadowQuery(element, 'hcm-poi-detail') as HTMLElement & { poi: unknown };
        expect(detail.poi).toBe(poi);
    });

    it('badPath_nothingSelectedLeavesAnEmptySheet', async () => {
        const element = await sheet({ mode: 'side' });

        const frame = shadowQuery(element, 'hcm-sheet') as HTMLElement & { label: string };
        expect(frame.label).toBe('');
        expect(element.shadowRoot?.querySelector('.details')).toBeNull();
    });

    it('happyPath_dockedCloseFiresClose', async () => {
        const element = await sheet({ photo: photo('fara-an') });
        const events = recordEvents(element, 'hcm-close');

        await page.getByRole('button', { name: 'Închide' }).click();

        expect(events).toHaveLength(1);
    });

    it('badPath_definingTwiceKeepsTheFirstRegistration', () => {
        defineHcmPhotoSheet();

        expect(customElements.get(HCM_PHOTO_SHEET_TAG)).toBe(HcmPhotoSheet);
    });
});
