import type { LngLat } from '@hcm/shared';
import { describe, expect, it, vi } from 'vitest';

import type { ViewerServices } from '../../src/viewer/services.js';
import {
    LOCATE_ZOOM,
    closeSheet,
    defaultCompareLayer,
    locateViewer,
    menuAction,
    selectPhoto,
    shareTitle,
    shareViewer,
    syncLocale,
    toggleCompare,
} from '../../src/viewer/viewer-actions.js';
import { FakeStore, idleState, readyState } from './fake-store.js';
import { testManifest } from './fixtures.js';

function services(change: Partial<ViewerServices> = {}): ViewerServices {
    return {
        share: null,
        copyText: () => Promise.resolve(),
        locate: () => Promise.resolve([26.1, 44.43] as LngLat),
        pageUrl: () => 'https://example.org/#14/44.43/26.1',
        matchMedia: (query) => window.matchMedia(query),
        ...change,
    };
}

describe('closeSheet', () => {
    it('happyPath_photoAndPoiDetailsCloseTheirSelection', () => {
        const store = new FakeStore(readyState(testManifest(), { sheet: 'photo' }));
        closeSheet(store);
        store.set({ sheet: 'poi' });
        closeSheet(store);

        expect(store.calls.map((call) => [call.method, ...call.args])).toEqual([
            ['openPhoto', null],
            ['openPoi', null],
        ]);
    });

    it('badPath_anyOtherSheetJustCloses', () => {
        const store = new FakeStore(readyState(testManifest(), { sheet: 'layers' }));
        closeSheet(store);

        expect(store.callsOf('openSheet')).toEqual([['none']]);
    });
});

describe('selectPhoto', () => {
    it('happyPath_opensThePhoto', () => {
        const store = new FakeStore(readyState());
        selectPhoto(store, 'uranus-1984');

        expect(store.getState()).toMatchObject({ selectedPhotoId: 'uranus-1984', lightbox: false });
    });

    it('badPath_theLightboxStaysOpenWhileSteppingThroughPhotos', () => {
        const store = new FakeStore(readyState(testManifest(), { lightbox: true }));
        selectPhoto(store, 'fara-an');

        expect(store.getState()).toMatchObject({ selectedPhotoId: 'fara-an', lightbox: true });
    });
});

describe('syncLocale', () => {
    it('happyPath_switchesTheLanguage', () => {
        const store = new FakeStore(readyState());
        syncLocale(store, 'en');

        expect(store.callsOf('setLocale')).toEqual([['en']]);
    });

    it('badPath_theSameLanguageIsNotSetAgain', () => {
        const store = new FakeStore(readyState());
        syncLocale(store, 'ro');

        expect(store.callsOf('setLocale')).toEqual([]);
    });
});

describe('shareTitle', () => {
    it('happyPath_theOpenPhotoOrTheCity', () => {
        const manifest = testManifest();

        expect(shareTitle(manifest, { selectedPhotoId: 'mihai-voda-1978' }, 'en')).toBe('Mihai Vodă church');
        expect(shareTitle(manifest, { selectedPhotoId: null }, 'en')).toBe('Lost Bucharest');
    });

    it('badPath_noManifestYet', () => {
        expect(shareTitle(null, { selectedPhotoId: null }, 'ro')).toBe('');
    });
});

describe('shareViewer', () => {
    it('happyPath_aCopiedLinkIsConfirmed', async () => {
        const store = new FakeStore(readyState());
        await shareViewer(store, services());

        expect(store.getState().toast).toEqual({ key: 'share.copied' });
        expect(store.callsOf('logShare')).toEqual([[]]);
    });

    it('badPath_aRefusedClipboardSaysSoAndLogsNoShare', async () => {
        const store = new FakeStore(readyState());
        await shareViewer(store, services({ copyText: () => Promise.reject(new Error('denied')) }));

        expect(store.getState().toast).toEqual({ key: 'share.failed' });
        expect(store.callsOf('logShare')).toEqual([]);
    });

    it('badPath_aCancelledWebShareLogsNothing', async () => {
        const store = new FakeStore(readyState());
        await shareViewer(store, services({ share: () => Promise.reject(new DOMException('cancelled', 'AbortError')) }));

        expect(store.callsOf('showToast')).toEqual([]);
        expect(store.callsOf('logShare')).toEqual([]);
    });

    it('badPath_aCompletedWebShareNeedsNoMessage', async () => {
        const store = new FakeStore(readyState());
        await shareViewer(store, services({ share: () => Promise.resolve() }));

        expect(store.callsOf('showToast')).toEqual([]);
        expect(store.callsOf('logShare')).toEqual([[]]);
    });
});

describe('locateViewer', () => {
    it('happyPath_theCameraMovesToTheVisitor', async () => {
        const store = new FakeStore(readyState());
        await locateViewer(store, services());

        expect(store.callsOf('showToast')).toEqual([['geolocate.locating', undefined]]);
        expect(store.getState().toast).toBeNull();
        expect(store.getState().view).toEqual({ center: [26.1, 44.43], zoom: LOCATE_ZOOM, bearing: 0 });
        expect(store.callsOf('flyTo')).toHaveLength(1);
        expect(store.callsOf('setView')).toEqual([]);
    });

    it('happyPath_aCloserCameraKeepsItsZoom', async () => {
        const store = new FakeStore(readyState(testManifest(), { view: { center: [26, 44.4], zoom: 18, bearing: 30 } }));
        await locateViewer(store, services());

        expect(store.getState().view).toEqual({ center: [26.1, 44.43], zoom: 18, bearing: 30 });
    });

    it('badPath_outsideTheCitySaysSo', async () => {
        const store = new FakeStore(readyState());
        await locateViewer(store, services({ locate: () => Promise.resolve([2.35, 48.85] as LngLat) }));

        expect(store.getState().toast).toEqual({ key: 'error.geolocate.outside' });
        expect(store.callsOf('flyTo')).toEqual([]);
    });

    it('badPath_beforeTheManifestThereIsNoCity', async () => {
        const store = new FakeStore(idleState());
        await locateViewer(store, services());

        expect(store.getState().toast).toEqual({ key: 'error.geolocate.unavailable' });
    });
});

describe('menuAction', () => {
    it('happyPath_sheetsOpenFromTheMenu', () => {
        const store = new FakeStore(readyState());
        menuAction(store, services(), 'layers');
        menuAction(store, services(), 'photos');
        menuAction(store, services(), 'about');

        expect(store.callsOf('openSheet')).toEqual([['layers'], ['photos'], ['about']]);
    });

    it('happyPath_shareAndLocateRunInTheBackground', async () => {
        const store = new FakeStore(readyState());
        menuAction(store, services(), 'share');
        menuAction(store, services(), 'locate');

        await vi.waitFor(() => {
            expect(store.callsOf('flyTo')).toHaveLength(1);
        });
        expect(store.callsOf('showToast').map((args) => args[0])).toEqual(['geolocate.locating', 'share.copied']);
    });
});

describe('toggleCompare (M4, V06)', () => {
    it('happyPath_compareOpensWithTodayOrTheNewestLayerAndClosesAModalLayersSheet', () => {
        const store = new FakeStore(readyState(testManifest(), { sheet: 'layers' }));
        toggleCompare(store);
        const today = store.getState().compare;
        store.closeCompare();
        store.set({ overlays: store.getState().overlays.map((overlay) => ({ ...overlay, visible: false })) });
        toggleCompare(store);

        expect(today).toEqual({ layerId: null, position: 0.5 });
        expect(store.getState().compare?.layerId).toBe('kh9-1977');
        expect(store.callsOf('openSheet')).toEqual([['none']]);
    });

    it('badPath_whileComparingTheButtonClosesAndADockedPanelStays', () => {
        const store = new FakeStore(readyState(testManifest(), { sheet: 'layers', windowClass: 'large' }));
        toggleCompare(store);
        toggleCompare(store);

        expect(store.getState().compare).toBeNull();
        expect(store.getState().sheet).toBe('layers');
        expect(defaultCompareLayer({ overlays: [], manifest: null })).toBeNull();
    });
});
