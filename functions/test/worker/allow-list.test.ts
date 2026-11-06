/**
 * The allow-lists of a worker's job (`functions/src/worker/allow-list.ts`, `docs/research/M7-local-worker.md` §2.5): a
 * job's parameters name its extra documents and inputs only when they are well-formed and of its type, so a malformed
 * parameter never widens what a worker may read.
 */
import { FIRESTORE_PATHS, type JobDoc } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { omit } from '../../src/api/objects.js';
import { documentTarget, inputVersionsOf, mayRead, mayWrite } from '../../src/worker/allow-list.js';
import { CITY, FOLDER, JOB, LAYER, localJob } from './world.js';

function scope(job: JobDoc) {
    return { cityId: CITY, jobId: JOB, job, versionId: JOB, layerId: LAYER, inputScans: [] };
}

describe('documents', () => {
    it('happyPath_aJobWithoutALayerHasNoLayerDocument', () => {
        const job = omit(localJob(), ['layerId']);

        expect(documentTarget(scope(job), FIRESTORE_PATHS.layer(CITY, LAYER))).toBeUndefined();
        expect(documentTarget(scope(job), FIRESTORE_PATHS.job(CITY, JOB))).toBe('job');
    });

    it.each([
        [
            'an import whose scene is no id',
            localJob({ params: { entityId: '../other', dataset: 'corona2' } }),
            FIRESTORE_PATHS.usgsScenes(CITY),
        ],
        [
            'a re-georeference whose base is no id',
            localJob({ type: 'regeoref', params: { basedOn: 42 } }),
            FIRESTORE_PATHS.layerVersions(CITY),
        ],
    ])('badPath_%sNamesNoExtraDocument', (_name, job, collection) => {
        expect([`${collection}/42`, `${collection}/other`].map((path) => documentTarget(scope(job), path))).toEqual([undefined, undefined]);
        expect(documentTarget(scope(job), FIRESTORE_PATHS.city(CITY))).toBe('city');
    });
});

describe('a join (M8)', () => {
    const parts = [
        { versionId: 'v-f039', layerId: 'layer-f039' },
        { versionId: 'v-f040', layerId: 'layer-f040' },
    ];
    const join = localJob({ type: 'layer-join', params: { parts, sensor: 'KH-9-pan' } });

    it('happyPath_itsFramesAreReadOnlyBases_itsScansInputs', () => {
        expect(documentTarget(scope(join), FIRESTORE_PATHS.layerVersion(CITY, 'v-f040'))).toBe('base');
        expect(mayRead(scope(join), `rasters/${CITY}/layer-f039/v-f039/scan.tif`)).toBe(true);
        expect(mayRead(scope(join), `rasters/${CITY}/layer-f040/v-f040/scan.tif`)).toBe(true);
    });

    it('happyPath_aFrameReGeoreferencedReadsTheScanOfItsBase_itsVersionNamesIt', () => {
        const base = `rasters/${CITY}/layer-f039/im-f039/scan.tif`;
        const named = { ...scope(join), inputScans: [base] };

        expect(inputVersionsOf(join)).toEqual(['v-f039', 'v-f040']);
        expect(mayRead(scope(join), base)).toBe(false);
        expect(mayRead(named, base)).toBe(true);
        expect(mayWrite(named, base)).toBe(false);
    });

    it.each([
        ['another city', 'rasters/other/layer-f039/im-f039/scan.tif'],
        ['a way out of the city', `rasters/${CITY}/../other/l/v/scan.tif`],
        ['no raster at all', `work/${CITY}/job/warped.tif`],
    ])('badPath_aScanPathOf%sIsNoInput', (_name, path) => {
        expect(mayRead({ ...scope(join), inputScans: [path] }, path)).toBe(false);
    });

    it('badPath_nothingElseOfAFrameIsReadOrWritten', () => {
        expect(mayRead(scope(join), `rasters/${CITY}/layer-f039/v-f039/cog.tif`)).toBe(false);
        expect(mayWrite(scope(join), `rasters/${CITY}/layer-f039/v-f039/scan.tif`)).toBe(false);
        expect(documentTarget(scope(join), FIRESTORE_PATHS.layerVersion(CITY, 'v-other'))).toBeUndefined();
    });

    it.each([
        [
            'parameters that do not parse',
            localJob({ type: 'layer-join', params: { parts: [{ versionId: '../x', layerId: 'l' }], sensor: 'KH-9-pan' } }),
        ],
        ['a job of another type', localJob({ params: { parts, sensor: 'KH-9-pan' } })],
    ])('badPath_%sNameNoFrame', (_name, job) => {
        expect(documentTarget(scope(job), FIRESTORE_PATHS.layerVersion(CITY, 'v-f039'))).toBeUndefined();
        expect(mayRead(scope(job), `rasters/${CITY}/layer-f039/v-f039/scan.tif`)).toBe(false);
    });
});

describe('objects', () => {
    it('happyPath_theVersionsFilesAreWrittenAndReadAndNothingElseWritten', () => {
        const job = localJob();

        expect([mayWrite(scope(job), `${FOLDER}/cog.tif`), mayRead(scope(job), `${FOLDER}/cog.tif`)]).toEqual([true, true]);
        expect([mayWrite(scope(job), `${FOLDER}/other.bin`), mayRead(scope(job), FOLDER)]).toEqual([false, false]);
    });

    it('badPath_aGeotiffImportWhoseUploadIsNoTextReadsNoUpload', () => {
        const job = localJob({ type: 'geotiff-import', params: { uploadPath: ['uploads/x.tif'], replaces: false } });

        expect(mayRead(scope(job), 'uploads/x.tif')).toBe(false);
    });
});
