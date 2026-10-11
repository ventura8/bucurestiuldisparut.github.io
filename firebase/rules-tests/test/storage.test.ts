/**
 * firebase/storage.rules (private bucket): own-uid uploads only, type and size limits, no overwrite,
 * admin-only reads, and derived artifacts written by service accounts only. The Storage emulator
 * has no rule-coverage report, so every condition has an explicit allow and deny case here.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EVERYONE, bytes, createWorld, expected, verdict, verdicts, type Persona, type World } from './support/world.js';

const MIB = 1024 * 1024;

let world: World;
let sequence = 0;

function upload(kind: 'photos' | 'rasters', persona: Persona, city = 'bucuresti'): string {
    sequence += 1;
    return `uploads/${kind}/${city}/${world.uid(persona)}/u${String(sequence)}/original`;
}

function put(persona: Persona, path: string, contentType: string, size = 1024): Promise<unknown> {
    return world
        .storage(persona)
        .ref(path)
        .put(bytes(size), { contentType })
        .then(() => undefined);
}

beforeAll(async () => {
    world = await createWorld('storage');
});

afterAll(async () => {
    await world.env.cleanup();
});

describe('photo uploads', () => {
    it.each(['image/jpeg', 'image/png', 'image/webp', 'image/tiff', 'image/heic', 'image/heif'])(
        'happyPath_adminUploads_%s',
        async (type) => {
            expect(await verdict(put('admin', upload('photos', 'admin'), type))).toBe('allow');
        },
    );

    it('badPath_onlyAdminsUploadIntoTheirOwnFolder', async () => {
        const result = await verdicts(EVERYONE, (persona) => put(persona, upload('photos', persona), 'image/jpeg'));

        expect(result).toEqual(expected(EVERYONE, ['admin']));
    });

    it('badPath_adminCannotUploadIntoAnotherAdminsFolder', async () => {
        expect(await verdict(put('admin', upload('photos', 'docOnly'), 'image/jpeg'))).toBe('deny');
    });

    it.each(['image/svg+xml', 'text/html', 'application/pdf', 'application/octet-stream'])('badPath_adminCannotUpload_%s', async (type) => {
        expect(await verdict(put('admin', upload('photos', 'admin'), type))).toBe('deny');
    });

    it('badPath_photosOf60MiBOrMoreAreRejected', async () => {
        expect(await verdict(put('admin', upload('photos', 'admin'), 'image/jpeg', 60 * MIB))).toBe('deny');
    });

    it.each(['Bucuresti', 'b', 'x'.repeat(33), 'buc_uresti'])('badPath_malformedCityIdsAreRejected_%s', async (city) => {
        expect(await verdict(put('admin', upload('photos', 'admin', city), 'image/jpeg'))).toBe('deny');
    });

    it('badPath_uploadsAreNeverOverwritten', async () => {
        const path = upload('photos', 'admin');
        await world.seedObject(path, 'image/jpeg');

        expect(await verdict(put('admin', path, 'image/png'))).toBe('deny');
        expect(await verdict(world.storage('admin').ref(path).updateMetadata({ contentType: 'image/svg+xml' }))).toBe('deny');
    });

    it('happyPath_onlyAdminsReadAndDeleteUploads', async () => {
        const path = upload('photos', 'admin');
        await world.seedObject(path, 'image/jpeg');
        const ref = (persona: Persona) => world.storage(persona).ref(path);

        const reads = await verdicts(['stranger', 'claimOnly', 'admin'], (persona) => ref(persona).getMetadata());
        const deletes = await verdicts(['stranger', 'admin'], (persona) => ref(persona).delete());

        expect({ reads, deletes }).toEqual({
            reads: { stranger: 'deny', claimOnly: 'deny', admin: 'allow' },
            deletes: { stranger: 'deny', admin: 'allow' },
        });
    });
});

describe('raster uploads', () => {
    it.each(['image/tiff', 'application/octet-stream'])('happyPath_adminUploadsGeoTiffAs_%s', async (type) => {
        expect(await verdict(put('admin', upload('rasters', 'admin'), type))).toBe('allow');
    });

    it.each([
        ['a JPEG', 'admin', 'image/jpeg'],
        ['a stranger', 'stranger', 'image/tiff'],
        ['a revoked admin', 'claimOnly', 'image/tiff'],
    ] as const)('badPath_rasterUploadDeniedFor_%s', async (_label, persona, type) => {
        expect(await verdict(put(persona, upload('rasters', persona), type))).toBe('deny');
    });

    it('badPath_adminCannotUploadRastersIntoAnotherFolderOrCity', async () => {
        expect(await verdict(put('admin', upload('rasters', 'docOnly'), 'image/tiff'))).toBe('deny');
        expect(await verdict(put('admin', upload('rasters', 'admin', 'Bucuresti'), 'image/tiff'))).toBe('deny');
    });

    it('happyPath_onlyAdminsReadAndDeleteRasterUploads', async () => {
        const path = upload('rasters', 'admin');
        await world.seedObject(path, 'image/tiff');

        const reads = await verdicts(['stranger', 'admin'], (persona) => world.storage(persona).ref(path).getMetadata());
        const deletes = await verdicts(['stranger', 'admin'], (persona) => world.storage(persona).ref(path).delete());

        expect({ reads, deletes }).toEqual({ reads: { stranger: 'deny', admin: 'allow' }, deletes: { stranger: 'deny', admin: 'allow' } });
    });
});

describe('derived artifacts', () => {
    it('happyPath_adminsReadWhatServiceAccountsWrote', async () => {
        await world.seedObject('rasters/storage-1966/cog.tif', 'image/tiff');

        const result = await verdicts(EVERYONE, (persona) => world.storage(persona).ref('rasters/storage-1966/cog.tif').getMetadata());

        expect(result).toEqual(expected(EVERYONE, ['admin']));
    });

    it.each(['rasters/storage-1966/forged.tif', 'tmp/storage/x.bin', 'public/manifest.json'])(
        'badPath_adminsNeverWrite_%s',
        async (path) => {
            expect(await verdict(put('admin', path, 'image/tiff'))).toBe('deny');
        },
    );

    it('badPath_adminsNeverDeleteDerivedArtifacts', async () => {
        await world.seedObject('usgs-raw/storage/frame.tgz', 'application/gzip');

        expect(await verdict(world.storage('admin').ref('usgs-raw/storage/frame.tgz').delete())).toBe('deny');
    });
});
