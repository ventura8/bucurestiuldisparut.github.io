/**
 * The viewer side-loads the full-size view when it first opens (`services.loadLightbox`), and hands the version the visitor
 * picks to the store; a part that does not load closes the view and says so.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fireKitEvent, shadowQuery } from './doubles.js';
import { readyState } from './fake-store.js';
import { fakeServices, mountViewer } from './viewer-harness.js';

const OPEN = { selectedPhotoId: 'uranus-1984', sheet: 'photo', lightbox: true } as const;

describe('the viewer and the full-size view', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_eachOpeningAsksForThePartAndAPickReachesTheStore', async () => {
        const { element, store } = await mountViewer(readyState());
        const loadLightbox = vi.fn(() => Promise.resolve());
        element.services = fakeServices({ loadLightbox });

        store.set(OPEN);
        store.set({ ...OPEN, lightbox: false });
        store.set(OPEN);
        await element.updateComplete;
        fireKitEvent(shadowQuery(element, 'hcm-lightbox'), 'hcm-photo-version', { view: 'improved' });

        expect(loadLightbox).toHaveBeenCalledTimes(2);
        expect(store.getState().photoVersion).toBe('improved');
    });

    it('badPath_aPartThatDoesNotLoadClosesTheViewAndSaysSo', async () => {
        const { element, store } = await mountViewer(readyState());
        element.services = fakeServices({ loadLightbox: () => Promise.reject(new Error('offline')) });

        store.set(OPEN);

        await vi.waitFor(() => {
            expect(store.getState()).toMatchObject({ lightbox: false, toast: { key: 'error.photoImage' } });
        });
    });
});
