/**
 * The allow-lists of a worker's job (`functions/src/worker/allow-list.ts`, `docs/research/M7-local-worker.md` §2.5): a
 * job's parameters name its extra documents and inputs only when they are well-formed and of its type, so a malformed
 * parameter never widens what a worker may read.
 */
import { FIRESTORE_PATHS, type JobDoc } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { omit } from '../../src/api/objects.js';
import { documentTarget, mayRead, mayWrite } from '../../src/worker/allow-list.js';
import { CITY, FOLDER, JOB, LAYER, localJob } from './world.js';

function scope(job: JobDoc) {
    return { cityId: CITY, jobId: JOB, job, versionId: JOB, layerId: LAYER };
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
