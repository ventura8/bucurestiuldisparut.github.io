import { describe, expect, it } from 'vitest';

import type { BBox } from '../../src/geo/bbox.js';
import { decodeHash, encodeHash, MAX_HASH_LENGTH, MAX_OVERLAY_ENTRIES, type HashState } from '../../src/url/hash.js';

const BUCHAREST: BBox = [
    [25.93, 44.33],
    [26.25, 44.55],
];

describe('encodeHash', () => {
    it('happyPath_encodesEveryFieldInOrder', () => {
        const state: HashState = {
            view: { center: [26.0852981, 44.4270371], zoom: 14.567, bearing: 33.33 },
            layers: ['kh4-1966', 'kh9-1980'],
            opacity: 0.8,
            overlayOpacity: { photos: 0.5, 'kh4-1966': 1.4 },
            photo: 'mihai-voda-1978',
            lang: 'en',
        };

        expect(encodeHash(state)).toBe(
            '#14.57/44.42704/26.0853/33.3&layers=kh4-1966,kh9-1980&opacity=0.8&op=photos:50,kh4-1966:100&photo=mihai-voda-1978&lang=en',
        );
    });

    it('happyPath_northUpViewOmitsTheBearing', () => {
        expect(encodeHash({ view: { center: [26.1, 44.4], zoom: 15, bearing: 360 } })).toBe('#15/44.4/26.1');
    });

    it('happyPath_noLayersIsAnEmptyList', () => {
        expect(encodeHash({ layers: [] })).toBe('#layers=');
    });

    it('badPath_invalidIdsAreNeverEncoded', () => {
        expect(encodeHash({ layers: ['ok', 'not ok', '<b>'], overlayOpacity: { 'a b': 0.5 }, photo: '../x', opacity: -1 })).toBe(
            '#layers=ok&opacity=0',
        );
    });

    it('badPath_nothingToEncodeIsEmpty', () => {
        expect(encodeHash({})).toBe('');
    });

    it('badPath_writesAtMostTheOverlayEntriesTheDecoderReads', () => {
        const overlayOpacity = Object.fromEntries(
            Array.from({ length: MAX_OVERLAY_ENTRIES + 3 }, (_, index) => [`o${String(index)}`, 0.5]),
        );

        expect(Object.keys(decodeHash(encodeHash({ overlayOpacity })).overlayOpacity ?? {})).toHaveLength(MAX_OVERLAY_ENTRIES);
        expect(encodeHash({ overlayOpacity }).split(',')).toHaveLength(MAX_OVERLAY_ENTRIES);
    });
});

describe('decodeHash', () => {
    it('happyPath_roundTripsTheEncoder', () => {
        const state: HashState = {
            view: { center: [26.0853, 44.42704], zoom: 14.57, bearing: 33.3 },
            layers: ['kh4-1966'],
            opacity: 0.8,
            overlayOpacity: { photos: 0.5 },
            photo: 'mihai-voda-1978',
            lang: 'ro',
        };

        expect(decodeHash(encodeHash(state))).toEqual({ ...state, legacy: false });
    });

    it('happyPath_acceptsAHashWithoutItsSign', () => {
        expect(decodeHash('15/44.4/26.1').view).toEqual({ zoom: 15, center: [26.1, 44.4], bearing: 0 });
    });

    it('happyPath_parametersWithoutAView', () => {
        expect(decodeHash('#photo=gara-obor&lang=en')).toEqual({ legacy: false, photo: 'gara-obor', lang: 'en' });
    });

    it('happyPath_legacyHashKeepsTheViewAndIgnoresLayerCodes', () => {
        expect(decodeHash('#15.5/44.4271/26.0853/90/!a3!p2')).toEqual({
            legacy: true,
            view: { zoom: 15.5, center: [26.0853, 44.4271], bearing: 90 },
        });
    });

    it('badPath_legacyHashWithAMalformedViewKeepsOnlyTheFlag', () => {
        expect(decodeHash('#15.5/abc/26.0853/0/!a3')).toEqual({ legacy: true });
    });

    it('badPath_clampsZoomPositionAndBearingToTheLimits', () => {
        const decoded = decodeHash('#30/50.5/20.1/-90', { minZoom: 10, maxZoom: 20, bounds: BUCHAREST });

        expect(decoded.view).toEqual({ zoom: 20, center: [25.93, 44.55], bearing: 270 });
    });

    it('badPath_clampsToTheWebMercatorWorldWithoutBounds', () => {
        expect(decodeHash('#-3/89.9/-200').view).toEqual({ zoom: 0, center: [-180, 85.051129], bearing: 0 });
    });

    it.each([['#14/44.4'], ['#14/44.4/26.1/0/5'], ['#14/1e3/26.1'], ['#14/Infinity/26.1'], ['#14/ 44/26.1'], ['#0x10/44/26']])(
        'badPath_malformedView_%s_isIgnored',
        (hash) => {
            expect(decodeHash(`${hash}&lang=en`)).toEqual({ legacy: false, lang: 'en' });
        },
    );

    it('badPath_dropsInvalidIdsAndDuplicates', () => {
        expect(decodeHash('#layers=a,a,<script>,b,,x y&photo=../etc&photo=ok')).toEqual({ legacy: false, layers: ['a', 'b'], photo: 'ok' });
    });

    it('happyPath_emptyLayersMeansNone', () => {
        expect(decodeHash('#layers=').layers).toEqual([]);
    });

    it.each([
        ['opacity=1.7', { opacity: 1 }],
        ['opacity=-0.2', { opacity: 0 }],
        ['opacity=abc', {}],
        ['op=a:150,b:-5,c:x,:50,d:20:1,e,f:40', { overlayOpacity: { a: 1, b: 0, f: 0.4 } }],
        ['op=bad', {}],
        ['lang=fr', {}],
        ['lang=EN', {}],
        ['lang=en', { lang: 'en' }],
        ['unknown=1', {}],
        ['constructor=1', {}],
        ['__proto__=1', {}],
        ['photo', {}],
        ['layersX', {}],
    ])('badPath_parameter_%s_isReadDefensively', (parameter, expected) => {
        expect(decodeHash(`#14/44.4/26.1&${parameter}`)).toEqual({
            legacy: false,
            view: { zoom: 14, center: [26.1, 44.4], bearing: 0 },
            ...expected,
        });
    });

    it('badPath_readsAtMostTheOverlayLimit', () => {
        const entries = Array.from({ length: MAX_OVERLAY_ENTRIES + 5 }, (_, index) => `o${String(index)}:10`).join(',');

        expect(Object.keys(decodeHash(`#op=${entries}`).overlayOpacity ?? {})).toHaveLength(MAX_OVERLAY_ENTRIES);
    });

    it('happyPath_poiCategoryOpacitiesRoundTrip', () => {
        expect(decodeHash('#op=kh4-1966:40,photos:70,cladiri:25').overlayOpacity).toEqual({ 'kh4-1966': 0.4, photos: 0.7, cladiri: 0.25 });
    });

    it('badPath_withKnownOverlayIdsUnknownOnesAreDropped', () => {
        const limits = { minZoom: 0, maxZoom: 22, overlayIds: new Set(['kh4-1966', 'photos', 'cladiri']) };

        expect(decodeHash('#op=kh4-1966:40,ghost:50,cladiri:150', limits).overlayOpacity).toEqual({ 'kh4-1966': 0.4, cladiri: 1 });
        expect(decodeHash('#op=ghost:50', limits)).toEqual({ legacy: false });
    });

    it('badPath_knownOverlayIdsAlsoApplyWhenOpComesFirst', () => {
        expect(decodeHash('#op=ghost:50,photos:10', { minZoom: 0, maxZoom: 22, overlayIds: new Set(['photos']) })).toEqual({
            legacy: false,
            overlayOpacity: { photos: 0.1 },
        });
    });

    it('badPath_lastValidRepeatWins', () => {
        expect(decodeHash('#lang=ro&lang=en&lang=xx').lang).toBe('en');
    });

    it.each([[''], ['#'], [`#14/44/26&layers=${'a,'.repeat(MAX_HASH_LENGTH)}`]])('badPath_emptyOrOversizedHash_isIgnored', (hash) => {
        expect(decodeHash(hash)).toEqual({ legacy: false });
    });
});
