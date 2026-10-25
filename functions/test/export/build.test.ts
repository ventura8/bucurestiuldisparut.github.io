/**
 * `export.build` (`functions/src/export/build.ts`, M5 §5.1 to §5.4; behaviour A53): a queued export becomes a zip that
 * serves the city from any static host (the kit's page with the engine beside it, `city.json` with relative photos and
 * no analytics, the photos, README and RIGHTS), `ready` with its size, SHA-256, counts and expiry; only USGS scans
 * travel; a zip over the limit, a missing file or a failed upload leaves `failed` with nothing behind.
 */
import { createHash } from 'node:crypto';

import { EXPORT_LIMITS, STORAGE_PATHS, timestampFromDate, validateManifest } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { buildExport, buildExportFunction, measured, type Written } from '../../src/export/build.js';
import {
    CITY,
    KIT_README,
    NOW,
    engineFiles,
    exportWorld,
    publish,
    publishedManifest,
    readExport,
    seedCity,
    seedExport,
    seedLayers,
    type ExportWorld,
} from './world.js';
import { unzip, zipTexts } from './unzip.js';

const EXPORT = 'x-20261102-1';
const TASK = { cityId: CITY, exportId: EXPORT };
const ZIP_PATH = STORAGE_PATHS.cityExport(CITY, EXPORT);

async function queuedWorld(rasters = false): Promise<ExportWorld> {
    const world = exportWorld();
    await seedCity(world);
    publish(world);
    await seedLayers(world);
    await seedExport(world, EXPORT, { rasters });
    return world;
}

function zipOf(world: ExportWorld): Buffer {
    const stored = world.blobs.object('private', ZIP_PATH);
    if (stored === undefined) {
        throw new Error('no zip was written');
    }
    return Buffer.from(stored.bytes);
}

describe('export.build', () => {
    it('happyPath_theZipServesTheCityWithoutFirebase', async () => {
        const world = await queuedWorld();

        await expect(buildExport(world, TASK)).resolves.toBe('ready');

        const zip = zipOf(world);
        const files = zipTexts(zip);
        expect(Object.keys(files)).toEqual([
            'README.md',
            'RIGHTS.md',
            'city.json',
            'engine/THIRD_PARTY_NOTICES.txt',
            'engine/engine.css',
            'engine/engine.iife.js',
            'engine/fonts/roboto-flex-latin-wght.woff2',
            'index.html',
            'photos/opera-1940/thumb.webp',
            'photos/opera-1940/web.webp',
            'photos/strand-1976/thumb.webp',
            'photos/strand-1976/web.webp',
        ]);
        const manifest = validateManifest(JSON.parse(String(files['city.json'])));
        expect(manifest.ok).toBe(true);
        const city = JSON.parse(String(files['city.json'])) as ReturnType<typeof publishedManifest>;
        expect(city.city.analytics).toEqual({});
        expect(city.city.mapbox.publicToken).toBe('pk.test-viewer-token');
        expect(city.photos.map((photo) => photo.image.web)).toEqual([
            'photos/strand-1976/web.webp',
            'photos/opera-1940/web.webp',
            'https://images.example.test/gara/web.webp',
        ]);
        expect(city.layers.map((layer) => layer.source)).toEqual(publishedManifest().layers.map((layer) => layer.source));
        expect(files['photos/strand-1976/web.webp']).toBe(`webp:photos/${CITY}/strand-1976/12345678/web.webp`);
        expect(files['README.md']).toContain(KIT_README.trim());
        expect(files['README.md']).toContain('# Orașul \\| exportat: export static / static export (2026-11-02)');
        expect(await readExport(world, EXPORT)).toMatchObject({
            state: 'ready',
            bytes: zip.length,
            sha256: createHash('sha256').update(zip).digest('hex'),
            counts: { photos: 3, restrictedPhotos: 1, layers: 2, rasters: 0, pois: 0 },
            startedAt: timestampFromDate(new Date(NOW)),
            finishedAt: timestampFromDate(new Date(NOW)),
            expiresAt: timestampFromDate(new Date('2026-11-09T10:00:00.000Z')),
            updatedBy: 'system:export',
        });
    });

    it('happyPath_thePageLoadsTheEngineBesideIt_andItsPolicyNamesOnlyWhatTheCityStillPointsAt', async () => {
        const world = await queuedWorld();

        await buildExport(world, TASK);

        const page = String(zipTexts(zipOf(world))['index.html']);
        expect(page).toContain('<link rel="stylesheet" href="engine/engine.css" />');
        expect(page).toContain('<script src="engine/engine.iife.js" defer></script>');
        expect(page).toContain('<title>Orașul | exportat</title>');
        expect(page).toContain('manifest-url="city.json"');
        expect(page).not.toContain('cdn.jsdelivr.net');
        expect(page).toContain('https://tiles.example.test');
        expect(page).toContain('https://images.example.test');
        expect(page).not.toContain('storage.googleapis.com');
        expect(page).not.toContain('cloudfunctions.net');
    });

    it('happyPath_withTheScansOnlyTheUsgsLayersCogTravels @S-A53-HAPPY-RASTERS', async () => {
        const world = await queuedWorld(true);

        await buildExport(world, TASK);

        const files = zipTexts(zipOf(world));
        expect(Object.keys(files).filter((name) => name.startsWith('rasters/'))).toEqual(['rasters/corona-1966.tif']);
        expect(files['rasters/corona-1966.tif']).toBe('cog:corona-1966');
        expect(unzip(zipOf(world)).find((file) => file.name === 'rasters/corona-1966.tif')?.method).toBe(0);
        expect(files['README.md']).toContain('scanările USGS ale straturilor istorice (1)');
        expect(files['README.md']).toContain('a layer uploaded as a GeoTIFF does not export its scan');
        expect((await readExport(world, EXPORT))?.counts).toMatchObject({ rasters: 1, layers: 2 });
    });

    it('happyPath_withoutTheScansNoCogIsRead', async () => {
        const world = await queuedWorld(false);

        await buildExport(world, TASK);

        expect(Object.keys(zipTexts(zipOf(world))).some((name) => name.startsWith('rasters/'))).toBe(false);
        expect(zipTexts(zipOf(world))['README.md']).toContain('the USGS scans are not included');
    });

    it('happyPath_thePhotosLicensedForThisMapOnlyAreNamedInRights @S-A53-HAPPY-RIGHTS', async () => {
        const world = await queuedWorld();

        await buildExport(world, TASK);

        const rights = String(zipTexts(zipOf(world))['RIGHTS.md']);
        expect(rights).toContain('| `opera-1940` | Fotografia opera-1940 | Arhiva \\| familiei | permission |');
        expect(rights).not.toContain('strand-1976');
        expect(rights).toContain('doar pentru harta Orașul \\| exportat');
        expect((await readExport(world, EXPORT))?.counts?.restrictedPhotos).toBe(1);
    });

    it('happyPath_aCityWithNoRestrictedPhotoSaysSo @S-A53-HAPPY-RIGHTS', async () => {
        const world = exportWorld();
        await seedCity(world);
        const manifest = publishedManifest();
        publish(world, { ...manifest, photos: manifest.photos.filter((photo) => photo.license !== 'permission') });
        await seedExport(world, EXPORT);

        await buildExport(world, TASK);

        expect(zipTexts(zipOf(world))['RIGHTS.md']).toContain('No photo has this restriction.');
    });

    it('badPath_anUnlicensedPhotoNeverTravels @S-A53-BAD-UNLICENSED', async () => {
        // An unlicensed photo (`unknown`, or still in its rights review) is never in the published manifest, so it is
        // never read: the export carries only what the city publishes.
        const world = await queuedWorld();
        world.blobs.put('public', `photos/${CITY}/unlicensed/12345678/web.webp`, new Uint8Array([1]));

        await buildExport(world, TASK);

        expect(Object.keys(zipTexts(zipOf(world))).some((name) => name.includes('unlicensed'))).toBe(false);
        expect(world.blobs.recorder.argsOf('read').map((args) => args[1])).toEqual([STORAGE_PATHS.manifest(CITY)]);
    });
});

describe('export.build: failures', () => {
    it('badPath_anExportOverTheLimitFailsBeforeWritingAnything @S-A53-BAD-TOO-LARGE', async () => {
        const world = await queuedWorld();
        world.setEngine(engineFiles({ 'engine.iife.js': EXPORT_LIMITS.maxBytes }));

        await expect(buildExport(world, TASK)).resolves.toBe('failed');

        const record = await readExport(world, EXPORT);
        expect(record).toMatchObject({
            state: 'failed',
            error: 'apiError.export.tooLarge',
            errorParams: { max: String(EXPORT_LIMITS.maxBytes) },
        });
        expect(Number(record?.errorParams?.['size'])).toBeGreaterThan(EXPORT_LIMITS.maxBytes);
        expect(world.blobs.object('private', ZIP_PATH)).toBeUndefined();
        expect(world.blobs.recorder.argsOf('delete')).toEqual([['private', ZIP_PATH]]);
    });

    it('badPath_aPhotoFileMissingFromTheBucketFailsTheExport', async () => {
        const world = await queuedWorld();
        await world.blobs.delete('public', `photos/${CITY}/strand-1976/12345678/thumb.webp`);

        await expect(buildExport(world, TASK)).resolves.toBe('failed');

        expect(await readExport(world, EXPORT)).toMatchObject({ state: 'failed', error: 'apiError.notFound' });
    });

    it('badPath_aFailedUploadLeavesAFailedExportAndNoObject', async () => {
        const world = await queuedWorld();
        world.writer.failNextUpload();

        await expect(buildExport(world, TASK)).resolves.toBe('failed');

        expect(await readExport(world, EXPORT)).toMatchObject({ state: 'failed', error: 'apiError.internal' });
        expect(world.blobs.object('private', ZIP_PATH)).toBeUndefined();
    });

    it('badPath_aManifestGoneSinceTheStartFailsAsNeverPublished', async () => {
        const world = await queuedWorld();
        await world.blobs.delete('public', STORAGE_PATHS.manifest(CITY));

        await buildExport(world, TASK);

        expect(await readExport(world, EXPORT)).toMatchObject({ state: 'failed', error: 'apiError.export.noManifest' });
    });

    it('badPath_aManifestTheSchemaRefusesFailsTheExport', async () => {
        const world = await queuedWorld();
        world.blobs.put('public', STORAGE_PATHS.manifest(CITY), new TextEncoder().encode('{"version":1}'));

        await buildExport(world, TASK);

        expect(await readExport(world, EXPORT)).toMatchObject({ state: 'failed', error: 'apiError.internal' });
    });

    it.each([
        ['already building (a redelivered task)', 'building' as const],
        ['ready', 'ready' as const],
    ])('badPath_anExport_%s_isNotBuiltAgain', async (_case, state) => {
        const world = await queuedWorld();
        await seedExport(world, EXPORT, { state });

        await expect(buildExport(world, TASK)).resolves.toBe('skipped');

        expect(world.blobs.object('private', ZIP_PATH)).toBeUndefined();
    });

    it('badPath_aTaskWithoutItsRecordBuildsNothing', async () => {
        const world = exportWorld();

        await expect(buildExport(world, TASK)).resolves.toBe('skipped');
    });
});

describe('export-build (task queue)', () => {
    it('happyPath_aValidTaskBuilds_andARefusedPayloadIsDropped', async () => {
        const world = await queuedWorld();
        const fn = buildExportFunction(() => world);

        await fn.run({ data: { cityId: CITY } } as Parameters<typeof fn.run>[0]);
        expect((await readExport(world, EXPORT))?.state).toBe('queued');

        await fn.run({ data: TASK } as Parameters<typeof fn.run>[0]);
        expect((await readExport(world, EXPORT))?.state).toBe('ready');
        expect(world.recording.records.map((record) => record.message)).toEqual(
            expect.arrayContaining(['export task refused', 'export ready']),
        );
    });
});

describe('measured', () => {
    async function drain(chunks: AsyncIterable<Uint8Array>): Promise<number> {
        let total = 0;
        for await (const chunk of chunks) {
            total += chunk.length;
        }
        return total;
    }

    async function* chunksOf(...sizes: number[]): AsyncGenerator<Uint8Array> {
        for (const size of sizes) {
            yield await Promise.resolve(new Uint8Array(size).fill(7));
        }
    }

    it('happyPath_theChunksPassCountedAndHashed', async () => {
        const written: Written = { bytes: 0, hash: createHash('sha256') };

        await expect(drain(measured(chunksOf(3, 4), written, 7))).resolves.toBe(7);

        expect(written.bytes).toBe(7);
        expect(written.hash.digest('hex')).toBe(createHash('sha256').update(new Uint8Array(7).fill(7)).digest('hex'));
    });

    it('badPath_aZipThatGrowsPastTheLimitWhileStreamingStops @S-A53-BAD-TOO-LARGE', async () => {
        const written: Written = { bytes: 0, hash: createHash('sha256') };

        await expect(drain(measured(chunksOf(5, 5), written, 7))).rejects.toMatchObject({
            code: 'apiError.export.tooLarge',
            params: { size: '10', max: String(EXPORT_LIMITS.maxBytes) },
        });
    });
});
