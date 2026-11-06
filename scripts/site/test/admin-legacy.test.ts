import { afterEach, describe, expect, it } from 'vitest';

import { citySchema, photoSchema, type MigratedPhoto } from '@hcm/shared';

import { CITY_SEED_FILE, LEGACY_FOLDER, planLegacyBundle, type AdminFile } from '../src/admin/legacy.js';
import { SiteBuildError } from '../src/errors.js';
import { nodeFileSystem, type SiteFileSystem } from '../src/files.js';
import { readRepositoryJson } from './manifests.js';
import { ROOT, cleanup, temporaryDir } from './support.js';

afterEach(cleanup);

/** A stand-in image: the manifest record of a photo only lacks one until `photos.onUpload` made its derivatives. */
const IMAGE = { web: 'media/x/web.webp', thumb: 'media/x/thumb.webp', w: 1600, h: 1200 };

function generated(files: readonly AdminFile[], to: string): string {
    const file = files.find((candidate) => candidate.to === to);
    return file !== undefined && 'content' in file ? file.content : '';
}

function point(photo: string, lng: number, id?: string): Record<string, unknown> {
    return {
        type: 'Feature',
        ...(id === undefined ? {} : { id }),
        properties: { title: photo, photo: `https://legacy.example/photos/${photo}`, author: 'E2E', year: 1970 },
        geometry: { type: 'Point', coordinates: [lng, 44.43] },
    };
}

/** A seed folder in a temporary root: the real Bucharest manifest, `features` as the legacy GeoJSON, `photos` as files. */
function syntheticSeed(features: readonly unknown[], photos: readonly string[]): SiteFileSystem {
    const files = nodeFileSystem(temporaryDir());
    files.write('seed/x/manifest.static.json', JSON.stringify(readRepositoryJson('seed/bucharest/manifest.static.json')));
    files.write('seed/x/photos.legacy.geojson', JSON.stringify({ type: 'FeatureCollection', features }));
    for (const name of photos) {
        files.write(`seed/x/photos/${name}`, name);
    }
    return files;
}

describe('planLegacyBundle', () => {
    it('happyPath_theCommittedSeedGivesTheCityThe45PhotosAndTheirOriginals', () => {
        const bundle = planLegacyBundle(nodeFileSystem(ROOT));
        const city = JSON.parse(generated(bundle.files, `${LEGACY_FOLDER}/city.json`)) as Record<string, unknown>;
        const photos = JSON.parse(generated(bundle.files, `${LEGACY_FOLDER}/photos.json`)) as MigratedPhoto[];

        expect(bundle.photos).toBe(45);
        expect(photos).toHaveLength(45);
        // Two photos show the same original from two places: one copy each.
        expect(bundle.originals).toBe(44);
        expect(bundle.warnings).toBe(1);
        expect(city['id']).toBe('bucuresti');
        // The city file's settings, which the viewer's manifest never holds.
        const { imagery, ...manifestCity } = city;
        expect(imagery).toEqual({ targetYears: [1966, 1972, 1976, 1977, 1978, 1979, 1980, 1982, 1983, 1984] });
        expect(citySchema.safeParse({ ...manifestCity, mapbox: { publicToken: 'pk.e2e-fake-token' }, analytics: {} }).success).toBe(true);
        expect(photos.every((record) => photoSchema.safeParse({ ...record.photo, image: IMAGE }).success)).toBe(true);
        expect(bundle.files.filter((file) => 'from' in file).map((file) => file.to)).toContain(`${LEGACY_FOLDER}/originals/Ferdinand.png`);
    });

    it('happyPath_theViewerTokenAndTheAnalyticsIdsNeverTravel', () => {
        const city = generated(planLegacyBundle(nodeFileSystem(ROOT)).files, `${LEGACY_FOLDER}/city.json`);

        expect(city).not.toContain('publicToken');
        expect(city).not.toContain('analytics');
        expect(Object.keys(JSON.parse(city) as object)).toEqual([
            'id',
            'name',
            'center',
            'zoom',
            'minZoom',
            'maxZoom',
            'bounds',
            'about',
            'credits',
            'privacy',
            'theme',
            'basemap',
            'imagery',
        ]);
    });

    it('happyPath_aSeedOutsideThisRepositoryHasNoImagerySettings', () => {
        const files = syntheticSeed([point('A.jpg', 26.08)], ['A.jpg']);

        const city = (): unknown => JSON.parse(generated(planLegacyBundle(files, 'seed/x').files, `${LEGACY_FOLDER}/city.json`));

        expect(city()).not.toHaveProperty('imagery');
        files.write(CITY_SEED_FILE, JSON.stringify({ id: 'x' }));
        expect(city()).not.toHaveProperty('imagery');
    });

    it('badPath_invalidImagerySettingsStopTheBuild', () => {
        const files = syntheticSeed([point('A.jpg', 26.08)], ['A.jpg']);
        files.write(CITY_SEED_FILE, JSON.stringify({ imagery: { targetYears: [1966, 1966] } }));

        expect(() => planLegacyBundle(files, 'seed/x')).toThrow(/invalid imagery/);
    });

    it('happyPath_keepsTheLegacyIdWhenThereIsOne', () => {
        const files = syntheticSeed([point('A b.jpg', 26.08, 'legacy-a'), point('C.jpg', 26.09)], ['A b.jpg', 'C.jpg']);
        const photos = JSON.parse(generated(planLegacyBundle(files, 'seed/x').files, `${LEGACY_FOLDER}/photos.json`)) as MigratedPhoto[];

        expect(photos.map((record) => [record.sourceFile, record.legacyId ?? null])).toEqual([
            ['A b.jpg', 'legacy-a'],
            ['C.jpg', null],
        ]);
    });

    it('badPath_aMissingOriginalStopsTheBuild', () => {
        const files = syntheticSeed([point('A.jpg', 26.08)], []);

        expect(() => planLegacyBundle(files, 'seed/x')).toThrow(
            new SiteBuildError('seed/x/photos/A.jpg is missing: a legacy photo record names it'),
        );
    });

    it('badPath_aSeedWithoutPhotosOrWithBrokenFilesStopsTheBuild', () => {
        expect(() => planLegacyBundle(syntheticSeed([], []), 'seed/x')).toThrow(/holds no photo/);

        const broken = syntheticSeed([point('A.jpg', 26.08)], ['A.jpg']);
        broken.write('seed/x/photos.legacy.geojson', '{');
        expect(() => planLegacyBundle(broken, 'seed/x')).toThrow(/^seed\/x\/photos\.legacy\.geojson: not JSON/);

        expect(() => planLegacyBundle(broken, 'seed/missing')).toThrow(/^seed\/missing\/manifest\.static\.json is missing/);
    });

    it('badPath_anInvalidManifestStopsTheBuild', () => {
        const files = syntheticSeed([point('A.jpg', 26.08)], ['A.jpg']);
        files.write('seed/x/manifest.static.json', JSON.stringify({ version: 1 }));

        expect(() => planLegacyBundle(files, 'seed/x')).toThrow(/^seed\/x\/manifest\.static\.json: invalid manifest\n/);
    });
});
