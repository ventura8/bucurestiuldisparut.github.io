/**
 * The viewer side-loads the full-size view when it first opens (`services.loadExtras`), and hands the version the visitor
 * picks to the store; a part that does not load closes the view and says so.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fireKitEvent, shadowQuery } from './doubles.js';
import { idleState, readyState } from './fake-store.js';
import { fakeServices, mountViewer } from './viewer-harness.js';

const OPEN = { selectedPhotoId: 'uranus-1984', sheet: 'photo', lightbox: true } as const;

describe('the viewer and the full-size view', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_eachOpeningAsksForThePartAndAPickReachesTheStore', async () => {
        const { element, store } = await mountViewer(readyState());
        const loadExtras = vi.fn(() => Promise.resolve());
        element.services = fakeServices({ loadExtras });

        store.set(OPEN);
        store.set({ ...OPEN, lightbox: false });
        store.set(OPEN);
        await element.updateComplete;
        fireKitEvent(shadowQuery(element, 'hcm-lightbox'), 'hcm-photo-version', { view: 'improved' });

        expect(loadExtras).toHaveBeenCalledTimes(2);
        expect(store.getState().photoVersion).toBe('improved');
    });

    it('badPath_aPartThatDoesNotLoadClosesTheViewAndSaysSo', async () => {
        const { element, store } = await mountViewer(readyState());
        element.services = fakeServices({ loadExtras: () => Promise.reject(new Error('offline')) });

        store.set(OPEN);

        await vi.waitFor(() => {
            expect(store.getState()).toMatchObject({ lightbox: false, toast: { key: 'error.photoImage' } });
        });
    });

    it('badPath_aboutThatDoesNotLoadClosesItsSheet', async () => {
        const { element, store } = await mountViewer(readyState());
        element.services = fakeServices({ loadExtras: () => Promise.reject(new Error('offline')) });

        store.set({ sheet: 'about' });

        await vi.waitFor(() => {
            expect(store.getState().sheet).toBe('none');
        });
    });

    it('happyPath_aRightClickOnTheMapOpensItsMenuWhichCopiesAndCloses', async () => {
        const { element, store } = await mountViewer(readyState());
        const copied: string[] = [];
        element.services = fakeServices({
            copyText: (text) => {
                copied.push(text);
                return Promise.resolve();
            },
        });
        const map = element.mapContainer ?? element;

        map.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 30 }));
        await vi.waitFor(() => {
            expect(element.mapMenu).not.toBeNull();
        });
        await element.updateComplete;
        const menu = shadowQuery(element, 'hcm-map-menu');
        fireKitEvent(menu, 'hcm-map-menu-copy', { text: '44.4, 26.1' });
        fireKitEvent(menu, 'hcm-close');

        await vi.waitFor(() => {
            expect(store.getState().toast).toEqual({ key: 'mapMenu.copied' });
        });
        expect(copied).toEqual(['44.4, 26.1']);
        expect(element.mapMenu).toBeNull();
    });

    it('badPath_beforeTheMapIsReadyNoMenuOpens', async () => {
        const { element } = await mountViewer(idleState());

        (element.mapContainer ?? element).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        await element.updateComplete;

        expect(element.mapMenu).toBeNull();
    });
});
