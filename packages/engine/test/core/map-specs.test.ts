import { overlaysFromManifest, withOverlayOpacity, withOverlayVisibility } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { CONE_LENGTH_M, localized, mapOptions, photoFeatures, poiSpecs, rasterSpec, resolveAssetUrl } from '../../src/core/map-specs.js';
import { cityView } from '../../src/core/state.js';
import { category, layer, manifest, omit, photo, poi } from './fixtures.js';

describe('map specs', () => {
    it('happyPath_englishFallsBackToRomanian', () => {
        expect(localized({ ro: 'Stradă', en: 'Street' }, 'en')).toBe('Street');
        expect(localized({ ro: 'Stradă' }, 'en')).toBe('Stradă');
        expect(localized({ ro: 'Stradă', en: 'Street' }, 'ro')).toBe('Stradă');
    });

    it('happyPath_relativeAssetsResolveAgainstTheManifest', () => {
        const base = 'https://storage.example.org/cities/bucuresti/manifest.json';

        expect(resolveAssetUrl('derived/a/web.webp', base)).toBe('https://storage.example.org/cities/bucuresti/derived/a/web.webp');
        expect(resolveAssetUrl('/x.pmtiles', base)).toBe('https://storage.example.org/x.pmtiles');
    });

    it('badPath_httpsOrUnresolvableAssetsStayAsTheyAre', () => {
        expect(resolveAssetUrl('https://cdn.example.org/a.webp', 'https://storage.example.org/m.json')).toBe(
            'https://cdn.example.org/a.webp',
        );
        expect(resolveAssetUrl('derived/a.webp', undefined)).toBe('derived/a.webp');
        expect(resolveAssetUrl('derived/a.webp', 'not a url')).toBe('derived/a.webp');
    });

    it('happyPath_aRasterSpecFollowsItsOverlay', () => {
        const kh4 = layer({
            bounds: [
                [25.95, 44.35],
                [26.2, 44.5],
            ],
            adjustments: { contrast: 0.2 },
        });
        const overlays = withOverlayOpacity(
            withOverlayVisibility(overlaysFromManifest(manifest({ layers: [kh4] })), kh4.id, true),
            kh4.id,
            0.4,
        );

        expect(rasterSpec(kh4, overlays[0], undefined)).toEqual({
            id: 'kh4-1966',
            source: { type: 'mapbox', tilesetId: 'test-owner.kh4-1966' },
            minzoom: 10,
            maxzoom: 17,
            visible: true,
            opacity: 0.4,
            order: 1,
            attribution: 'USGS EROS',
            bounds: [
                [25.95, 44.35],
                [26.2, 44.5],
            ],
            adjustments: { contrast: 0.2 },
        });
    });

    it('happyPath_withoutAnOverlayTheManifestDefaultsApply', () => {
        const spec = rasterSpec(layer({ defaultVisible: true, opacity: 0.7 }), undefined, undefined);

        expect(spec).toMatchObject({ visible: true, opacity: 0.7 });
        expect(spec).not.toHaveProperty('bounds');
        expect(spec).not.toHaveProperty('adjustments');
        expect(
            rasterSpec(
                layer({
                    bounds: [
                        [25.95, 44.35],
                        [26.2, 44.5],
                    ],
                }),
                undefined,
                undefined,
            ),
        ).not.toHaveProperty('adjustments');
    });

    it('happyPath_aPmtilesArchiveResolvesAgainstTheManifest', () => {
        const spec = rasterSpec(
            layer({ source: { type: 'pmtiles', url: 'tiles/kh4.pmtiles' } }),
            undefined,
            'https://site.example.org/m/manifest.json',
        );

        expect(spec.source).toEqual({ type: 'pmtiles', url: 'https://site.example.org/m/tiles/kh4.pmtiles' });
    });
});

describe('map specs: photos, POIs, options', () => {
    it('happyPath_photoMarkersAndConesInTheVisitorsLanguage', () => {
        const photos = [photo(), { ...omit(photo(), 'bearing', 'fov', 'year'), id: 'plain' }];

        const data = photoFeatures(photos, 'en', null);

        expect(data.features).toHaveLength(3);
        expect(data.features[0]).toEqual({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [26.091611, 44.431722] },
            properties: { id: 'mihai-voda-1978', title: 'Mihai Voda street', year: 1978, bearing: 46.8 },
        });
        expect(data.features[1]?.properties).toEqual({ id: 'plain', title: 'Mihai Voda street', year: null, bearing: null });
        const cone = data.features[2];
        expect(cone?.geometry.type).toBe('Polygon');
        expect(cone?.properties).toEqual({ id: 'mihai-voda-1978' });
        expect(CONE_LENGTH_M).toBe(60);
    });

    it('happyPath_aConeWithoutFieldOfViewUsesTheDefault', () => {
        const data = photoFeatures([omit(photo(), 'fov')], 'ro', null);

        expect(data.features[1]?.geometry.type).toBe('Polygon');
    });

    it('badPath_photosFarFromTheYearAreLeftOut', () => {
        expect(photoFeatures([photo({ year: 1900 })], 'ro', 1980).features).toEqual([]);
    });

    it('happyPath_oneVectorOverlayPerCategoryWithTheYearsPois', () => {
        const city = manifest();
        const overlays = withOverlayOpacity(overlaysFromManifest(city), 'strazi', 0.3);

        const specs = poiSpecs(city, overlays, 'en', 1870);

        expect(specs.map((spec) => [spec.id, spec.features.map((feature) => feature.properties.id)])).toEqual([
            ['cladiri', ['eveniment']],
            ['strazi', ['strada']],
        ]);
        expect(specs[1]).toMatchObject({ kind: 'poi', color: '#B3261E', icon: 'location_on', visible: true, opacity: 0.3 });
        expect(specs[0]?.features[0]?.properties.title).toBe('Event');
        expect(specs[1]?.features[0]?.properties.title).toBe('Stradă');
    });

    it('happyPath_aBundledIconIsKept', () => {
        const specs = poiSpecs(manifest({ categories: [category()], pois: [poi()] }), [], 'ro', null);

        expect(specs[0]).toMatchObject({ icon: 'domain_disabled', visible: true, opacity: 1 });
    });

    it('badPath_aManifestWithoutPoisHasNoVectorOverlays', () => {
        const city = manifest();
        const bare = { ...omit(city, 'poiCategories', 'pois') };

        expect(poiSpecs(bare, [], 'ro', null)).toEqual([]);
        expect(poiSpecs({ ...city, pois: [] }, [], 'ro', null).every((spec) => spec.features.length === 0)).toBe(true);
        expect(poiSpecs({ ...omit(city, 'pois') }, [], 'ro', null)).toHaveLength(2);
    });

    it('happyPath_mapOptionsOfACity', () => {
        const city = manifest();

        expect(mapOptions(city, { center: [26.1, 44.43], zoom: 15, bearing: 10 }, 'en', true)).toEqual({
            style: 'mapbox://styles/mapbox/standard-satellite',
            config: { lightPreset: 'day' },
            accessToken: 'pk.test-viewer-token',
            view: { center: [26.1, 44.43], zoom: 15, bearing: 10 },
            minZoom: 10,
            maxZoom: 20,
            maxBounds: city.city.bounds,
            locale: 'en',
            reducedMotion: true,
        });
        const plain = { ...city, city: { ...city.city, basemap: { style: 'mapbox://styles/mapbox/standard' } } };
        expect(mapOptions(plain, cityView(city), 'ro', false)).not.toHaveProperty('config');
    });
});
