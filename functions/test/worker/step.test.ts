/**
 * `worker.step` (`functions/src/worker/{step,step-update,allow-list,fields}.ts`, `docs/research/M7-local-worker.md` §2.4,
 * §2.5): the pipeline's `DocumentStore` for a local run. The worker reads the documents of its job's allow-list with
 * their update times, writes only the fields a run writes on its job and version (merged as Firestore's `update`,
 * stamped `system:pipeline`, checked against the schema, compare-and-set on the update time), creates and lists its
 * log lines; a worker that does not hold the job writes nothing.
 */
import {
    FIRESTORE_PATHS,
    LEASE_SECONDS,
    WORKER_DELETE_FIELD,
    imageryPassDocSchema,
    jobLogDocSchema,
    type CallableResponse,
    type JobDoc,
} from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { stepFunction } from '../../src/worker/step.js';
import { failureOf } from '../admin/world.js';
import { goldenGeoref, goldenOutput, readJob, readVersion, seedGuard, seedJob, seedVersion } from '../imagery/world.js';
import {
    CITY,
    ENTITY,
    FOLDER,
    JOB,
    NOW,
    OTHER,
    OTHER_WORKER,
    WORKER,
    at,
    callAs,
    localJob,
    minutes,
    processingVersion,
    seedHeld,
    seedWorker,
    workerWorld,
    type WorkerWorld,
} from './world.js';

const JOB_PATH = FIRESTORE_PATHS.job(CITY, JOB);
const VERSION_PATH = FIRESTORE_PATHS.layerVersion(CITY, JOB);
const LOGS = FIRESTORE_PATHS.jobLogs(CITY, JOB);
const DELETE = { [WORKER_DELETE_FIELD]: true };

type StepAnswer = CallableResponse<'worker.step'>;

function step(world: WorkerWorld, request: Record<string, unknown>, workerId = WORKER, uid?: string): Promise<StepAnswer> {
    return callAs<StepAnswer>(world, stepFunction, { workerId, jobId: JOB, request }, uid);
}

function update(world: WorkerWorld, path: string, fields: Record<string, unknown>, ifUpdateTime?: string): Promise<StepAnswer> {
    return step(world, { op: 'update', path, fields, ...(ifUpdateTime === undefined ? {} : { ifUpdateTime }) });
}

async function held(job: Partial<JobDoc> = {}, version: Parameters<typeof seedHeld>[2] = {}): Promise<WorkerWorld> {
    const world = await workerWorld();
    await seedHeld(world, job, version);
    return world;
}

function codeOf(promise: Promise<unknown>): Promise<unknown> {
    return failureOf(promise).then((failure) => (failure.details as { code?: unknown } | undefined)?.code);
}

describe('worker.step and a join (M8)', () => {
    const parts = [
        { versionId: 'v-f039', layerId: 'l-f039' },
        { versionId: 'v-f040', layerId: 'l-f040' },
    ];
    const join = { type: 'layer-join', params: { parts, sensor: 'KH-9-pan' } } as const;
    const report = { seams: [], omitted: [], coveragePct: 80, checkpointCount: 3, maxShiftM: 0 };

    it('happyPath_aJoinReadsItsFramesAndWritesItsReport', async () => {
        const world = await held(join);
        await seedVersion(world, 'v-f039', processingVersion({ layerId: 'l-f039', jobId: 'v-f039' }));

        await expect(step(world, { op: 'get', path: FIRESTORE_PATHS.layerVersion(CITY, 'v-f039') })).resolves.toMatchObject({
            data: { layerId: 'l-f039' },
        });
        await expect(update(world, VERSION_PATH, { join: report })).resolves.toEqual({ ok: true });
        expect((await readVersion(world, JOB))?.join).toEqual(report);
    });

    it('badPath_aFrameIsNeverWritten', async () => {
        const world = await held(join);
        await seedVersion(world, 'v-f039', processingVersion({ layerId: 'l-f039', jobId: 'v-f039' }));

        expect(await codeOf(update(world, FIRESTORE_PATHS.layerVersion(CITY, 'v-f039'), { state: 'failed' }))).toBe(
            'apiError.worker.refused',
        );
    });

    it('badPath_aRunNeverMarksAVersionJoined', async () => {
        const world = await held(join, { output: goldenOutput() });

        expect(await codeOf(update(world, VERSION_PATH, { state: 'joined' }))).toBe('apiError.worker.refused');
    });
});

describe('worker.step get and list', () => {
    it('happyPath_theJobIsReadWithPlainTimestampsAndItsUpdateTime', async () => {
        const world = await held();

        const answer = await step(world, { op: 'get', path: JOB_PATH });

        expect(answer.data).toMatchObject({ status: 'running', worker: { id: WORKER, claimedAt: minutes(-10) } });
        expect(JSON.parse(JSON.stringify(answer.data))).toEqual(answer.data);
        expect(answer.updateTime).toMatch(/^\d+\.\d{9}$/);
    });

    it.each([
        ['the city', FIRESTORE_PATHS.city(CITY)],
        ['the version', VERSION_PATH],
    ])('happyPath_%sIsOnTheAllowList', async (_name, path) => {
        const world = await held();

        await expect(step(world, { op: 'get', path })).resolves.toMatchObject({ data: expect.any(Object) as unknown });
    });

    it('happyPath_aMissingDocumentOfTheAllowListIsNull', async () => {
        const world = await held();

        await expect(step(world, { op: 'get', path: FIRESTORE_PATHS.usgsScene(CITY, ENTITY) })).resolves.toEqual({
            data: null,
            updateTime: null,
        });
    });

    it('happyPath_theLogLinesAreListedById', async () => {
        const world = await held();
        await step(world, { op: 'create', path: `${LOGS}/000001`, data: line(1) });
        await step(world, { op: 'create', path: `${LOGS}/000000`, data: line(0) });

        await expect(step(world, { op: 'list', collection: LOGS })).resolves.toEqual({ ids: ['000000', '000001'] });
    });

    it.each([
        ['another job', FIRESTORE_PATHS.job(CITY, 'j-other')],
        ['another city', FIRESTORE_PATHS.city('bacau')],
        ['the setup', FIRESTORE_PATHS.setupStatus],
    ])('badPath_%sIsOffTheAllowList @S-A62-BAD-NOT-HOLDER', async (_name, path) => {
        const world = await held();

        await expect(codeOf(step(world, { op: 'get', path }))).resolves.toBe('apiError.worker.refused');
        await expect(codeOf(step(world, { op: 'list', collection: path }))).resolves.toBe('apiError.worker.refused');
    });
});

describe('worker.step update', () => {
    it('happyPath_theRunsFieldsAreMergedStampedAndTheLeaseRenewed', async () => {
        const world = await held();

        await expect(
            update(world, JOB_PATH, {
                progress: 0.1,
                'steps.fetch': { status: 'running', startedAt: minutes(-1) },
                'steps.fetch.bytes': 1024,
                'lease.until': minutes(1),
                retryAt: DELETE,
                updatedBy: 'system:pipeline',
                updatedAt: minutes(-1),
            }),
        ).resolves.toEqual({ ok: true });

        const job = await readJob(world, JOB);
        expect(job).toMatchObject({
            progress: 0.1,
            steps: { fetch: { status: 'running', startedAt: minutes(-1), bytes: 1024 } },
            lease: { owner: `worker:${WORKER}`, until: at(new Date(Date.parse(NOW) + LEASE_SECONDS * 1000).toISOString()) },
            updatedBy: 'system:pipeline',
            updatedAt: at(NOW),
        });
        expect(job).not.toHaveProperty('retryAt');
    });

    it('happyPath_theLeaseIsTakenAndReleased', async () => {
        const world = await held({ status: 'starting', waitReason: 'worker', lease: { owner: `worker:${WORKER}`, until: minutes(5) } });

        await update(world, JOB_PATH, { status: 'running', lease: { owner: `worker:${WORKER}`, until: minutes(10) }, waitReason: DELETE });
        await update(world, JOB_PATH, { status: 'awaiting_approval', waitReason: 'approval', lease: DELETE });

        const job = await readJob(world, JOB);
        expect(job).toMatchObject({ status: 'awaiting_approval', waitReason: 'approval' });
        expect(job).not.toHaveProperty('lease');
    });

    it('happyPath_theCompareAndSetWritesOnlyOverTheReadItWasMadeFrom', async () => {
        const world = await held();
        const { updateTime } = await step(world, { op: 'get', path: JOB_PATH });
        await update(world, JOB_PATH, { progress: 0.2 });

        await expect(update(world, JOB_PATH, { progress: 0.3 }, String(updateTime))).resolves.toEqual({ ok: false });
        expect((await readJob(world, JOB))?.progress).toBeCloseTo(0.2);

        const fresh = await step(world, { op: 'get', path: JOB_PATH });
        await expect(update(world, JOB_PATH, { progress: 0.3 }, String(fresh.updateTime))).resolves.toEqual({ ok: true });
        expect((await readJob(world, JOB))?.progress).toBeCloseTo(0.3);
    });

    it('happyPath_nestedFieldsAreRemovedAndListsStoredAsFirestoresUpdateDoes', async () => {
        const world = await held({ steps: { fetch: { status: 'running', bytes: 10, totalBytes: 20 } } });

        await update(world, JOB_PATH, { 'steps.fetch.totalBytes': DELETE, 'steps.extract.bytes': DELETE, 'error.params': DELETE });
        await expect(update(world, VERSION_PATH, { georef: goldenGeoref() })).resolves.toEqual({ ok: true });

        const job = await readJob(world, JOB);
        expect(job?.steps).toEqual({ fetch: { status: 'running', bytes: 10 } });
        expect(job).not.toHaveProperty('error');
        await expect(readVersion(world, JOB)).resolves.toMatchObject({ georef: goldenGeoref() });
    });

    it('happyPath_aFailureWrittenTwiceToTheVersionIsKept', async () => {
        const world = await held({ status: 'failed', finishedAt: at(NOW), error: { code: 'apiError.internal', message: 'x' } });
        await seedVersion(world, JOB, processingVersion({ state: 'failed', error: { code: 'apiError.internal' } }));

        await expect(update(world, VERSION_PATH, { state: 'failed', error: { code: 'apiError.internal' } })).resolves.toEqual({ ok: true });
    });

    it('happyPath_aCancelAskedForEndsTheRunCancelled', async () => {
        const world = await held({ cancelRequested: true });

        await expect(update(world, JOB_PATH, { status: 'cancelled', finishedAt: at(NOW), lease: DELETE })).resolves.toEqual({ ok: true });
        await expect(update(world, VERSION_PATH, { state: 'cancelled' })).resolves.toEqual({ ok: true });
        await expect(readVersion(world, JOB)).resolves.toMatchObject({ state: 'cancelled' });
    });

    it('happyPath_theVersionTakesTheRunsFieldsAndAFailureAfterItsJobsEnd', async () => {
        const world = await held();
        await expect(update(world, VERSION_PATH, { 'machines.download': 'std', state: 'needs_gcps' })).resolves.toEqual({ ok: true });
        const failure = { code: 'apiError.imagery.referenceUnavailable', message: 'no reference' };
        await update(world, JOB_PATH, { status: 'failed', finishedAt: at(NOW), error: failure, lease: DELETE });

        await expect(update(world, VERSION_PATH, { state: 'failed', error: { code: failure.code } })).resolves.toEqual({ ok: true });
        await expect(readVersion(world, JOB)).resolves.toMatchObject({ state: 'failed', machines: { download: 'std' } });
    });
});

describe('worker.step and a refine that declines (M16)', () => {
    const declined = { code: 'apiError.imagery.notImproved', message: '17.0 m against the current 17.2 m', params: { before: '17.2', after: '17.0' } };

    it('happyPath_aRefineWithNothingBetterEndsCancelledWithItsReason @S-A80-BAD-NOT-IMPROVED', async () => {
        const world = await held({ type: 'regeoref', params: { basedOn: 'v-current' } });

        await expect(update(world, JOB_PATH, { status: 'cancelled', finishedAt: at(NOW), error: declined, lease: DELETE })).resolves.toEqual({
            ok: true,
        });
        await expect(update(world, VERSION_PATH, { state: 'cancelled', error: { code: declined.code } })).resolves.toEqual({ ok: true });
        await expect(readJob(world, JOB)).resolves.toMatchObject({ status: 'cancelled', error: { code: declined.code } });
    });

    it('badPath_noOtherRunEndsCancelledUnasked @S-A80-BAD-NOT-IMPROVED', async () => {
        const importing = await held();
        const failed = await held({ type: 'regeoref', params: { basedOn: 'v-current' } });
        const failure = { code: 'apiError.internal', message: 'x' };

        expect(await codeOf(update(importing, JOB_PATH, { status: 'cancelled', error: declined }))).toBe('apiError.worker.refused');
        expect(await codeOf(update(failed, JOB_PATH, { status: 'cancelled', error: failure }))).toBe('apiError.worker.refused');
    });
});

describe('worker.step and a pass (M9)', () => {
    const job = { params: { entityId: 'D3C1203-300415F006', dataset: 'declassiii', sensor: 'KH-9-pan' } };
    const path = FIRESTORE_PATHS.imageryPass(CITY, 'D3C1203-300415-F-1975-08-20');

    it('happyPath_aRunReadsItsPass_noneYetIsNoFailure', async () => {
        const world = await held(job);
        const none = await step(world, { op: 'get', path });
        const model = { camera: 'panoramic', rotation: 0, mirrored: false, scale: 0.94, rotationDeg: 0, dxM: 10, dyM: 20 };
        await world.deps.documents.set(path, imageryPassDocSchema, {
            model,
            entityId: 'D3C1203-300415F005',
            date: '1975-08-20',
            updatedBy: 'system:imagery',
            updatedAt: at(NOW),
        });

        expect(none).toEqual({ data: null, updateTime: null });
        await expect(step(world, { op: 'get', path })).resolves.toMatchObject({ data: { model } });
    });

    it('badPath_aRunNeverWritesAPass', async () => {
        const world = await held(job);

        await expect(codeOf(update(world, path, { model: {} }))).resolves.toBe('apiError.worker.refused');
    });
});

describe('worker.step and a side job (M12)', () => {
    const TILES = { path: `${FOLDER}/tiles.pmtiles`, bytes: 7, count: 1, sha256: 'd'.repeat(64), thumbPath: `${FOLDER}/thumb.webp` };
    const OTHER_CITY = 'rasters/bacau/l-other/v-other';
    const SIDE = { type: 'layer-tiles', params: { versionId: JOB }, versionId: JOB } as const;
    const APPROVED = { state: 'approved', output: goldenOutput(), approval: { auto: false, by: 'u-admin', at: minutes(-9) } } as const;

    it('happyPath_itAddsTilesToAnApprovedVersionAndEndsSucceeded @S-P08-HAPPY-OLD-VERSION', async () => {
        const world = await held(SIDE, APPROVED);

        await expect(update(world, VERSION_PATH, { 'output.tiles': TILES })).resolves.toEqual({ ok: true });
        await expect(update(world, JOB_PATH, { status: 'succeeded', finishedAt: minutes(0), lease: DELETE })).resolves.toEqual({
            ok: true,
        });

        expect(await readVersion(world, JOB)).toMatchObject({ state: 'approved', output: { tiles: TILES } });
        expect(await readJob(world, JOB)).toMatchObject({ status: 'succeeded' });
    });

    it('badPath_itNeverMovesItsVersionsState @S-P08-BAD-FAILS-ALONE', async () => {
        const world = await held(SIDE, APPROVED);

        const failure = await failureOf(update(world, VERSION_PATH, { state: 'failed', error: { code: 'apiError.internal' } }));

        expect(failure.details).toMatchObject({ code: 'apiError.worker.refused' });
        expect(await readVersion(world, JOB)).toMatchObject({ state: 'approved' });
    });

    it('badPath_tilesOutsideItsVersionsFolderOrAnyOtherOutputAreRefused @S-P08-BAD-FOREIGN-TILES', async () => {
        const world = await held(SIDE, APPROVED);
        const foreign = [
            { 'output.tiles': { ...TILES, path: `${OTHER_CITY}/tiles.pmtiles` } },
            { 'output.tiles': { ...TILES, thumbPath: `${OTHER_CITY}/thumb.webp` } },
            { 'output.tiles': TILES, 'output.previewPath': `${OTHER_CITY}/preview.png` },
        ];

        for (const fields of foreign) {
            expect(await codeOf(update(world, VERSION_PATH, fields))).toBe('apiError.worker.refused');
        }
        expect((await readVersion(world, JOB))?.output).toEqual(goldenOutput());
    });
});

describe('worker.step and the tiles of its own run (M12)', () => {
    it('badPath_aRunsTilesLieInItsVersionsFolder @S-P08-BAD-FOREIGN-TILES', async () => {
        const world = await held({}, { output: goldenOutput() });
        const tiles = { path: 'rasters/bacau/l-other/v-other/tiles.pmtiles', bytes: 7, count: 1, sha256: 'd'.repeat(64) };

        expect(await codeOf(update(world, VERSION_PATH, { 'output.tiles': { ...tiles, thumbPath: `${FOLDER}/thumb.webp` } }))).toBe(
            'apiError.worker.refused',
        );
        await expect(
            update(world, VERSION_PATH, {
                'output.tiles': { ...tiles, path: `${FOLDER}/tiles.pmtiles`, thumbPath: `${FOLDER}/thumb.webp` },
            }),
        ).resolves.toEqual({ ok: true });
    });
});

describe('worker.step update refused', () => {
    it('badPath_aWorkerThatDoesNotHoldTheJobWritesNothing @S-A62-BAD-NOT-HOLDER', async () => {
        const world = await held();
        await seedWorker(world, OTHER_WORKER, { uid: OTHER });

        const failures = await Promise.all([
            codeOf(step(world, { op: 'update', path: JOB_PATH, fields: { progress: 0.9 } }, OTHER_WORKER, OTHER)),
            codeOf(step(world, { op: 'update', path: JOB_PATH, fields: { progress: 0.9 } }, WORKER, OTHER)),
            codeOf(step(world, { op: 'create', path: `${LOGS}/000000`, data: line(0) }, OTHER_WORKER, OTHER)),
        ]);

        expect(failures).toEqual(['apiError.worker.notHolder', 'apiError.worker.notHolder', 'apiError.worker.notHolder']);
        expect((await readJob(world, JOB))?.progress).toBe(0);
        expect(world.deps.documents.paths(LOGS)).toEqual([]);
    });

    it('badPath_aJobAnotherOwnerLeasedIsNotHeld @S-A62-BAD-NOT-HOLDER', async () => {
        const world = await held({ lease: { owner: 'raster-pipeline-x7k2m/0', until: minutes(5) } });

        await expect(codeOf(update(world, JOB_PATH, { progress: 0.5 }))).resolves.toBe('apiError.worker.notHolder');
    });

    it.each([
        ['a path off the allow-list', FIRESTORE_PATHS.city(CITY), { name: { ro: 'X' } }],
        ['a field the pipeline does not write', JOB_PATH, { machine: 'xl' }],
        ['the worker itself', JOB_PATH, { 'worker.uid': OTHER }],
        ['a status the pipeline does not set', JOB_PATH, { status: 'succeeded' }],
        ['a cancellation nobody asked for', JOB_PATH, { status: 'cancelled' }],
        ['another owner on the lease', JOB_PATH, { lease: { owner: 'raster-pipeline-x7k2m/0', until: minutes(5) } }],
        ['a field path that reaches the prototype', JOB_PATH, { '__proto__.status': 'failed' }],
        ['a version field the pipeline does not write', VERSION_PATH, { approval: { by: OTHER } }],
        ['a version state the pipeline does not set', VERSION_PATH, { state: 'rejected' }],
    ])('badPath_%sIsRefused @S-A62-BAD-NOT-HOLDER', async (_name, path, fields) => {
        const world = await held();
        const before = [await readJob(world, JOB), await readVersion(world, JOB)];

        await expect(codeOf(update(world, path, fields))).resolves.toBe('apiError.worker.refused');
        expect([await readJob(world, JOB), await readVersion(world, JOB)]).toEqual(before);
    });

    it.each([
        ['a progress past one', JOB_PATH, { progress: 2 }],
        ['a timestamp that is not whole', JOB_PATH, { retryAt: { seconds: 1.5, nanoseconds: 0 } }],
        ['a removal inside a value', JOB_PATH, { steps: { fetch: DELETE } }],
        ['a failed version without its error', VERSION_PATH, { state: 'failed' }],
    ])('badPath_%sIsAnInvalidRequest @S-A62-BAD-NOT-HOLDER', async (_name, path, fields) => {
        const world = await held();
        const before = [await readJob(world, JOB), await readVersion(world, JOB)];

        await expect(codeOf(update(world, path, fields))).resolves.toBe('apiError.invalidRequest');
        expect([await readJob(world, JOB), await readVersion(world, JOB)]).toEqual(before);
    });

    it('badPath_aFinishedJobTakesNoMoreWritesButItsEnding', async () => {
        const world = await held();
        await update(world, JOB_PATH, { status: 'failed', finishedAt: at(NOW), error: { code: 'apiError.internal', message: 'x' } });

        await expect(codeOf(update(world, JOB_PATH, { progress: 0.5 }))).resolves.toBe('apiError.worker.refused');
        await expect(codeOf(update(world, VERSION_PATH, { state: 'processing' }))).resolves.toBe('apiError.worker.refused');
        await expect(codeOf(update(world, VERSION_PATH, { state: 'cancelled' }))).resolves.toBe('apiError.worker.refused');
    });

    it('badPath_aVersionAlreadyEndedTakesNoMoreWrites', async () => {
        const world = await held({}, { state: 'rejected' });

        await expect(codeOf(update(world, VERSION_PATH, { state: 'processing' }))).resolves.toBe('apiError.worker.refused');
    });

    it('badPath_aMissingVersionIsNotFound', async () => {
        const world = await held();
        await world.deps.documents.delete(VERSION_PATH);

        await expect(codeOf(update(world, VERSION_PATH, { state: 'processing' }))).resolves.toBe('apiError.notFound');
    });

    it('badPath_whileTheGuardIsRedOnlyTheRunsEndingIsWritten', async () => {
        const world = await held();
        await seedGuard(world, 'red');

        await expect(codeOf(update(world, JOB_PATH, { progress: 0.5 }))).resolves.toBe('apiError.guardPaused');
        await expect(codeOf(update(world, VERSION_PATH, { state: 'needs_gcps' }))).resolves.toBe('apiError.guardPaused');
        await expect(step(world, { op: 'get', path: JOB_PATH })).resolves.toMatchObject({ data: { status: 'running' } });
        await expect(update(world, VERSION_PATH, { state: 'failed', error: { code: 'apiError.internal' } })).resolves.toEqual({ ok: true });
        await expect(update(world, JOB_PATH, { status: 'queued', lease: DELETE })).resolves.toEqual({ ok: true });
    });
});

/** A log line as the pipeline writes it (`documents.py` → `log_line`). */
function line(seq: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        seq,
        level: 'info',
        step: 'fetch',
        message: `step fetch line ${String(seq)}`,
        updatedBy: 'system:pipeline',
        updatedAt: minutes(-1),
        ...overrides,
    };
}

describe('worker.step create', () => {
    it('happyPath_aLogLineIsCreatedOnceStampedByThePipeline', async () => {
        const world = await held();

        await expect(step(world, { op: 'create', path: `${LOGS}/000000`, data: line(0) })).resolves.toEqual({ created: true });
        await expect(step(world, { op: 'create', path: `${LOGS}/000000`, data: line(0) })).resolves.toEqual({ created: false });
        await expect(world.deps.documents.get(`${LOGS}/000000`, jobLogDocSchema)).resolves.toMatchObject({
            message: 'step fetch line 0',
            updatedAt: at(NOW),
        });
    });

    it('happyPath_aFinishedJobStillTakesItsLogLines', async () => {
        const world = await held({ status: 'failed', finishedAt: at(NOW), error: { code: 'apiError.internal', message: 'x' } });

        await expect(step(world, { op: 'create', path: `${LOGS}/000003`, data: line(3) })).resolves.toEqual({ created: true });
    });

    it.each([
        ['another job', `${FIRESTORE_PATHS.jobLogs(CITY, 'j-other')}/000000`, line(0)],
        ['an id that is not its number', `${LOGS}/000001`, line(0)],
        ['an id that is not a number', `${LOGS}/line-a`, line(0)],
        ['the 501st line', `${LOGS}/000500`, line(500)],
    ])('badPath_aLogLineOf%sIsRefused @S-A62-BAD-NOT-HOLDER', async (_name, path, data) => {
        const world = await held();

        await expect(codeOf(step(world, { op: 'create', path, data }))).resolves.toBe('apiError.worker.refused');
        expect(world.deps.documents.paths(`${FIRESTORE_PATHS.city(CITY)}/jobs/`).filter((path) => path.includes('/logs/'))).toEqual([]);
    });

    it.each([
        ['an unknown level', line(0, { level: 'debug' })],
        ['a removal marker', line(0, { step: DELETE })],
    ])('badPath_aLogLineWith%sIsAnInvalidRequest', async (_name, data) => {
        const world = await held();

        await expect(codeOf(step(world, { op: 'create', path: `${LOGS}/000000`, data }))).resolves.toBe('apiError.invalidRequest');
    });

    it('badPath_aStoreFailureIsNotHiddenAsADuplicate', async () => {
        const world = await held();
        world.deps.documents.recorder.failNext('create', new Error('firestore unavailable'));

        await expect(codeOf(step(world, { op: 'create', path: `${LOGS}/000000`, data: line(0) }))).resolves.toBe('apiError.internal');
    });

    it('badPath_aJobThatIsNotLocalWasNeverClaimed', async () => {
        const world = await workerWorld();
        await seedJob(world, JOB, localJob({ runOn: 'cloud' }));

        await expect(codeOf(step(world, { op: 'get', path: JOB_PATH }))).resolves.toBe('apiError.worker.notHolder');
    });
});
