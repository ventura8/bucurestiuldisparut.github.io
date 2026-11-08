import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HASH_WRITE_DELAY_MS } from '../../src/core/url-sync.js';
import { harness, loaded } from './harness.js';
import { manifest } from './fixtures.js';

/**
 * The photo sheet's Locate (V44): the camera goes to the photo's place, zoomed in as far as its view cone shows (but within
 * the city's zoom range), with the place beside the sheet; a ring marks it until the camera moves again or a photo opens
 * or closes. Unlike Show my location this is the photo's place, not the visitor's: the address follows the camera.
 */
const PLACE = [26.091611, 44.431722] as const;

describe('Locate a photo', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('happyPath_theCameraFliesToThePlaceBesideTheSheetAndTheAddressFollowsIt', async () => {
        const { store, map, location } = await loaded();
        store.openPhoto('mihai-voda-1978');

        store.locatePhoto('mihai-voda-1978', [0, -150]);

        expect(map.callsOf('flyTo').at(-1)).toEqual([{ center: PLACE, zoom: 17 }, { offset: [0, -150] }]);
        expect(map.callsOf('markPhoto')).toEqual([[PLACE]]);
        expect(store.getState().sheet).toBe('photo');
        map.emit('moveend', { center: [26.0916, 44.4307], zoom: 17, bearing: 0 });
        vi.advanceTimersByTime(HASH_WRITE_DELAY_MS);
        expect(location.hash.split('&')[0]).toBe('#17/44.4307/26.0916');
        expect(map.callsOf('markPhoto')).toHaveLength(1);
    });

    it('happyPath_aCameraCloserThanTheConesStaysThatClose', async () => {
        const { store, map } = await loaded();
        map.emit('moveend', { center: [26.1, 44.43], zoom: 18.5, bearing: 30 });

        store.locatePhoto('mihai-voda-1978', [0, 0]);

        expect(map.callsOf('flyTo').at(-1)?.[0]).toEqual({ center: PLACE, zoom: 18.5 });
    });

    it('badPath_aCityThatStopsBeforeTheConesZoomsOnlyAsFarAsItAllows', async () => {
        const base = manifest();
        const { store, map } = await loaded({ manifest: { ...base, city: { ...base.city, maxZoom: 16 } } });

        store.locatePhoto('mihai-voda-1978', [0, 0]);

        expect(map.callsOf('flyTo').at(-1)?.[0]).toEqual({ center: PLACE, zoom: 16 });
    });

    it('happyPath_theRingGoesWhenTheVisitorMovesTheMap', async () => {
        const { store, map } = await loaded();

        store.locatePhoto('mihai-voda-1978', [0, 0]);
        map.emit('moveend', { center: [...PLACE], zoom: 17, bearing: 0 });
        map.emit('moveend', { center: [26.12, 44.44], zoom: 15, bearing: 0 });
        map.emit('moveend', { center: [26.13, 44.44], zoom: 15, bearing: 0 });

        expect(map.callsOf('markPhoto')).toEqual([[PLACE], [null]]);
    });

    it('badPath_theRingGoesWhenThePhotoClosesOrAnotherOpens', async () => {
        const { store, map } = await loaded();
        store.openPhoto('mihai-voda-1978');

        store.locatePhoto('mihai-voda-1978', [0, 0]);
        store.openPhoto('uranus-1936');
        store.openPhoto(null);

        expect(map.callsOf('markPhoto')).toEqual([[PLACE], [null]]);
    });

    it('badPath_anUnknownPhotoMovesNothing', async () => {
        const { store, map } = await loaded();
        const flights = map.callsOf('flyTo').length;

        store.locatePhoto('nowhere', [0, 0]);

        expect(map.callsOf('flyTo')).toHaveLength(flights);
        expect(map.callsOf('markPhoto')).toEqual([]);
    });

    it('badPath_beforeTheManifestNothingMoves', () => {
        const { store, map } = harness();

        store.locatePhoto('mihai-voda-1978', [0, 0]);

        expect(map.callsOf('flyTo')).toEqual([]);
        expect(map.callsOf('markPhoto')).toEqual([]);
    });
});
