/**
 * M20 (`docs/research/M20-import-local.md` §1.3, §2.4, §8): `worker.archiveReport` records a scan's report and a sample of its
 * skipped paths; `imagery.archiveImport` makes one local-only `archive-series` job per kept series in the ladder's order, those
 * beyond today's share born waiting (`daily`) and released by `imagery.tick` on the next days; a local-only job never moves to
 * the cloud; an archive is imported once.
 */
import {
    DEFAULT_NEW_CITY_LIMITS,
    FIRESTORE_PATHS,
    archiveIssueSchema,
    jobDocSchema,
    type ArchiveSeriesParams,
    type JobDoc,
} from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { archiveImportFunction } from '../../src/imagery/archive-import.js';
import { releaseDaily } from '../../src/imagery/daily.js';
import { runOnFunction } from '../../src/imagery/run-on.js';
import { claimFunction } from '../../src/worker/claim.js';
import { archiveReportFunction } from '../../src/worker/archive-report.js';
import { failureOf } from '../admin/world.js';
import { adminCall } from '../publish/fakes.js';
import { callAs, seedWorker, workerWorld, type WorkerWorld } from '../worker/world.js';
import { ARCHIVE, CLEAR, UNCONFIRMED, archiveDoc, archiveSeries, readArchive, seedArchive, seriesIdOf } from './archive-world.js';
import {
    CITY,
    NOW,
    at,
    imageryWorld,
    readJob,
    readVersion,
    readyWorld,
    seedCity,
    seedGuard,
    seedJob,
    seedSetup,
    type ImageryWorld,
} from './world.js';

const TOMORROW = '2026-10-24T08:00:00.000Z';

function report(world: WorkerWorld, overrides: Readonly<Record<string, unknown>> = {}) {
    const { series, skipped } = archiveDoc(3);
    const issues = [
        { path: 'harti/Thumbs.db', reason: 'not-a-map' },
        { path: 'harti/copie/1895.jpg', reason: 'duplicate-of', of: 'harti/1895.jpg' },
    ];
    const data = {
        workerId: 'w-0123456789abcdef',
        archiveId: ARCHIVE,
        name: 'harti.zip',
        source: 'zip',
        fileCount: 5,
        bytes: 3000,
        series,
        skipped,
        issues,
    };
    return callAs(world, archiveReportFunction, { ...data, ...overrides });
}

function issues(world: ImageryWorld) {
    return world.deps.documents.query(FIRESTORE_PATHS.archiveIssues(CITY, ARCHIVE), archiveIssueSchema);
}

function importAll(world: ImageryWorld, count: number, extra: Readonly<Record<string, unknown>> = {}) {
    const series = Array.from({ length: count }, (_, n) => ({ seriesId: seriesIdOf(n), include: true }));
    return archiveImportFunction(() => world.deps).run(adminCall({ cityId: CITY, archiveId: ARCHIVE, series, ...extra }));
}

async function jobsOf(world: ImageryWorld): Promise<JobDoc[]> {
    const found = await world.deps.documents.query(FIRESTORE_PATHS.jobs(CITY), jobDocSchema);
    return found.documents.map((job) => job.data);
}

async function shareOf(world: ImageryWorld, share: number): Promise<void> {
    await seedCity(world, { limits: { ...DEFAULT_NEW_CITY_LIMITS, rasterJobsPerDay: share } });
}

describe('worker.archiveReport', () => {
    it('happyPath_theScansReportAndItsSampleOfSkippedPathsAreRecorded @S-A120-HAPPY-REPORT', async () => {
        const world = await workerWorld();
        await seedWorker(world);

        await expect(report(world)).resolves.toEqual({ archiveId: ARCHIVE, series: 3 });

        expect(await readArchive(world)).toMatchObject({
            name: 'harti.zip',
            source: 'zip',
            workerId: 'w-0123456789abcdef',
            skipped: { 'not-a-map': 2 },
        });
        expect((await readArchive(world))?.series.map((series) => series.seriesId)).toEqual([seriesIdOf(0), seriesIdOf(1), seriesIdOf(2)]);
        expect((await issues(world)).documents.map((issue) => [issue.id, issue.data.reason])).toEqual([
            ['000', 'not-a-map'],
            ['001', 'duplicate-of'],
        ]);
    });

    it('happyPath_aRescanReplacesTheReportKeepsItsCreatorAndDropsTheOldSample', async () => {
        const world = await workerWorld();
        await seedWorker(world);
        await report(world);

        await report(world, { issues: [{ path: 'harti/desktop.ini', reason: 'not-a-map' }], fileCount: 4 });

        expect(await readArchive(world)).toMatchObject({ fileCount: 4, createdBy: 'u-admin' });
        expect((await issues(world)).documents.map((issue) => issue.data.path)).toEqual(['harti/desktop.ini']);
    });

    it('badPath_anArchiveAlreadyImportedIsNotReportedAgain', async () => {
        const world = await workerWorld();
        await seedWorker(world);
        await seedArchive(world, archiveDoc(1, { jobs: { [seriesIdOf(0)]: 'ar-1' } }));

        const failure = await failureOf(report(world));

        expect(failure).toMatchObject({ code: 'failed-precondition', details: { code: 'apiError.imagery.archiveImported' } });
    });

    it('badPath_aSeriesNamedTwiceOrAnUnknownWorkerIsRefused', async () => {
        const world = await workerWorld();
        const twice = archiveSeries(0);
        await expect(failureOf(report(world))).resolves.toMatchObject({ details: { code: 'apiError.worker.refused' } });

        await seedWorker(world);
        await expect(failureOf(report(world, { series: [twice, twice] }))).resolves.toMatchObject({
            details: { code: 'apiError.invalidRequest' },
        });
        expect(await readArchive(world)).toBeUndefined();
    });
});

describe('imagery.archiveImport', () => {
    it('happyPath_oneClickMakesALocalOnlyJobPerKeptSeriesInTheLadderOrder @S-A120-HAPPY-IMPORT', async () => {
        const world = await readyWorld();
        await seedArchive(
            world,
            archiveDoc(3, { series: [archiveSeries(2), archiveSeries(0), archiveSeries(1, { rights: UNCONFIRMED })] }),
        );

        const response = await importAll(world, 3);

        expect(response).toMatchObject({ today: 3, waiting: 0 });
        expect(response.jobs.map((job) => job.seriesId)).toEqual([seriesIdOf(0), seriesIdOf(1), seriesIdOf(2)]);
        const [first] = response.jobs;
        const job = await readJob(world, first?.jobId ?? '');
        expect(job).toMatchObject({
            type: 'archive-series',
            status: 'queued',
            runOn: 'local',
            localOnly: true,
            waitReason: 'worker',
            countedAt: at(NOW),
        });
        expect(job?.params).toMatchObject<Partial<ArchiveSeriesParams>>({
            archiveId: ARCHIVE,
            seriesId: seriesIdOf(0),
            order: 0,
            referenceLayerIds: [],
        });
        expect(await readVersion(world, response.jobs[1]?.jobId ?? '')).toMatchObject({
            origin: 'archive',
            state: 'processing',
            source: { kind: 'archive', archiveId: ARCHIVE, seriesId: seriesIdOf(1), sheetCount: 1 },
            rights: UNCONFIRMED,
            year: 1891,
        });
        expect(await readArchive(world)).toMatchObject({ importedBy: 'u-admin', jobs: { [seriesIdOf(2)]: response.jobs[2]?.jobId } });
    });

    it('happyPath_theOwnersEditsAndATooSmallMapTheyInsistOnAreImported', async () => {
        const world = await readyWorld();
        await seedArchive(
            world,
            archiveDoc(2, {
                series: [archiveSeries(0), archiveSeries(1, { action: 'skip', reason: 'too-small', edition: '62', scaleDenominator: 500 })],
            }),
        );
        const series = [
            { seriesId: seriesIdOf(0), include: true, title: 'Planul Borroczyn', year: 1846, rights: { ...CLEAR, year: '1846' } },
            { seriesId: seriesIdOf(1), include: true },
        ];

        const response = await archiveImportFunction(() => world.deps).run(adminCall({ cityId: CITY, archiveId: ARCHIVE, series }));

        expect(await readVersion(world, response.jobs[0]?.jobId ?? '')).toMatchObject({
            label: { ro: 'Planul Borroczyn' },
            year: 1846,
            rights: { year: '1846' },
        });
        expect(response.jobs[0]?.layerId).toBe('planul-borroczyn');
        expect((await readVersion(world, response.jobs[0]?.jobId ?? ''))?.rights?.confirmedAt).toBeUndefined();
        expect((await readJob(world, response.jobs[1]?.jobId ?? ''))?.params).toMatchObject({ edition: '62', scaleDenominator: 500 });
    });

    it('badPath_beyondTodaysShareTheSeriesWaitForTheNextDays @S-A120-BAD-DAILY-SPLITS', async () => {
        const world = await readyWorld();
        await shareOf(world, 2);
        await seedArchive(world, archiveDoc(5));

        const response = await importAll(world, 5);

        expect(response).toMatchObject({ today: 2, waiting: 3 });
        const jobs = await jobsOf(world);
        expect(jobs.filter((job) => job.waitReason === 'daily')).toHaveLength(3);
        expect(jobs.filter((job) => job.waitReason === 'daily').every((job) => job.countedAt === undefined)).toBe(true);

        // Nothing frees today: the tick releases none; tomorrow it releases the next two of the ladder, in order.
        await expect(releaseDaily(world.deps, CITY, new Date(NOW))).resolves.toBe(0);
        await expect(releaseDaily(world.deps, CITY, new Date(TOMORROW))).resolves.toBe(2);
        const released = (await jobsOf(world)).filter((job) => job.countedAt?.seconds === at(TOMORROW).seconds);
        expect(released.map((job) => (job.params as ArchiveSeriesParams).order).sort((a, b) => a - b)).toEqual([2, 3]);
        expect(released.every((job) => job.waitReason === 'worker')).toBe(true);
    });

    it('badPath_aSeriesWaitingForItsDayIsNotClaimedByTheWorker', async () => {
        const world = await workerWorld();
        await seedWorker(world);
        await shareOf(world, 0);
        await seedArchive(world, archiveDoc(1));
        await importAll(world, 1);

        await expect(callAs(world, claimFunction, { workerId: 'w-0123456789abcdef' })).resolves.toEqual({ job: null });
    });

    it('badPath_aReRunDoesNotCountAndAnArchivesJobsCountOnce', async () => {
        const world = await readyWorld();
        await shareOf(world, 2);
        await seedJob(world, 'rg-1', { ...waitingJob(), type: 'regeoref', params: { basedOn: 'v0' } });
        await seedArchive(world, archiveDoc(3));

        await expect(importAll(world, 3)).resolves.toMatchObject({ today: 2, waiting: 1 });
    });

    it('badPath_anArchiveIsImportedOnce_anUnknownOneIsNotFound', async () => {
        const world = await readyWorld();
        await seedArchive(world, archiveDoc(1));
        await importAll(world, 1);

        await expect(failureOf(importAll(world, 1))).resolves.toMatchObject({ details: { code: 'apiError.imagery.archiveImported' } });
        const empty = await readyWorld();
        await expect(failureOf(importAll(empty, 1))).resolves.toMatchObject({ code: 'not-found' });
    });

    it.each([
        ['a series the report skipped', archiveSeries(0, { action: 'skip', reason: 'do-not-publish' }), {}],
        ['a series it never found', archiveSeries(7), {}],
        ['a year a layer cannot show', archiveSeries(0), { series: [{ seriesId: seriesIdOf(0), include: true, year: 1770 }] }],
        ['nothing kept', archiveSeries(0), { series: [{ seriesId: seriesIdOf(0), include: false }] }],
    ])('badPath_%sIsRefused', async (_name, series, extra) => {
        const world = await readyWorld();
        await seedArchive(world, archiveDoc(1, { series: [series] }));

        await expect(failureOf(importAll(world, 1, extra))).resolves.toMatchObject({ details: { code: 'apiError.invalidRequest' } });
        expect(await jobsOf(world)).toEqual([]);
    });

    it('badPath_whileTheBudgetGuardIsRedNothingIsImported', async () => {
        const world = imageryWorld();
        await seedCity(world);
        await seedArchive(world, archiveDoc(1));
        await seedSetup(world);
        await seedGuard(world, 'red');

        await expect(failureOf(importAll(world, 1))).resolves.toMatchObject({ code: 'failed-precondition' });
        expect(await readArchive(world)).not.toHaveProperty('jobs');
    });
});

function waitingJob(): JobDoc {
    return {
        type: 'archive-series',
        status: 'queued',
        params: {},
        createdBy: 'u-admin',
        createdAt: at(NOW),
        layerId: 'planul-1891',
        versionId: 'rg-1',
        updatedBy: 'u-admin',
        updatedAt: at(NOW),
    };
}

describe('imagery.archiveImport, the rights', () => {
    it('happyPath_theOwnersWordOnTheRightsIsStampedByTheServer @S-A121-HAPPY-RIGHTS-CONFIRMED', async () => {
        const world = await readyWorld();
        await seedArchive(world, archiveDoc(1, { series: [archiveSeries(0, { rights: UNCONFIRMED })] }));
        const rights = { ...UNCONFIRMED, licence: 'permission', state: 'clear', confirmedBy: 'Idei Urbane – DocuBucurești' };

        const response = await archiveImportFunction(() => world.deps).run(
            adminCall({ cityId: CITY, archiveId: ARCHIVE, series: [{ seriesId: seriesIdOf(0), include: true, rights }] }),
        );

        const version = await readVersion(world, response.jobs[0]?.jobId ?? '');
        expect(version?.rights).toMatchObject({ licence: 'permission', state: 'clear', confirmedBy: 'Idei Urbane – DocuBucurești' });
        expect(version?.rights?.confirmedAt).toBeDefined();
    });
});

describe('the daily release', () => {
    it('happyPath_aJobThatMovedMeanwhileIsLeftAlone_andAnUnreadableOneGoesLast', async () => {
        const world = await readyWorld();
        const daily = { ...waitingJob(), runOn: 'local' as const, localOnly: true as const, waitReason: 'daily' as const };
        await seedJob(world, 'ar-bad', daily);
        await seedJob(world, 'ar-good', {
            ...daily,
            params: {
                archiveId: ARCHIVE,
                seriesId: seriesIdOf(1),
                class: 'single',
                sheets: 1,
                encoding: 'grey',
                order: 3,
                referenceLayerIds: [],
            },
        });
        await seedJob(world, 'ar-gone', { ...daily, status: 'cancelled' });

        await expect(releaseDaily(world.deps, CITY, new Date(NOW))).resolves.toBe(2);

        expect((await readJob(world, 'ar-gone'))?.waitReason).toBe('daily');
        expect((await readJob(world, 'ar-good'))?.waitReason).toBe('worker');
    });

    it('happyPath_noJobWaitingReleasesNothing', async () => {
        const world = await readyWorld();
        await expect(releaseDaily(world.deps, CITY, new Date(NOW))).resolves.toBe(0);
    });
});

describe('imagery.runOn on an archive series', () => {
    it('badPath_aLocalOnlySeriesNeverMovesToTheCloud @S-A120-BAD-LOCAL-ONLY', async () => {
        const world = await readyWorld();
        const job = { ...waitingJob(), runOn: 'local' as const, localOnly: true as const, waitReason: 'worker' as const };
        await seedJob(world, 'ar-1', job);

        const failure = await failureOf(runOnFunction(() => world.deps).run(adminCall({ cityId: CITY, jobId: 'ar-1', runOn: 'cloud' })));

        expect(failure).toMatchObject({ code: 'failed-precondition', details: { code: 'apiError.imagery.localOnly' } });
        expect((await readJob(world, 'ar-1'))?.runOn).toBe('local');
    });

    it('happyPath_aSeriesWaitingForItsDayKeepsItsWaitWhenMovedOnTheComputer', async () => {
        const world = await readyWorld();
        await seedJob(world, 'ar-1', { ...waitingJob(), runOn: 'local', localOnly: true, waitReason: 'daily' });

        await runOnFunction(() => world.deps).run(adminCall({ cityId: CITY, jobId: 'ar-1', runOn: 'local' }));

        expect((await readJob(world, 'ar-1'))?.waitReason).toBe('daily');
    });
});
