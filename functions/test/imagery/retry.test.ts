/**
 * `imagery.retry` (`functions/src/imagery/retry.ts`, `docs/research/M3-interfaces.md` §4.5): a failed raster job again
 * from its first unfinished step: a pipeline failure goes back to `queued` (the dispatcher starts it), a failure after
 * approval goes back to the publisher; never past the attempts, never while the budget guard is red.
 */
import { JOB_MAX_ATTEMPTS, PUBLISH_MAX_ATTEMPTS, type JobDoc } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { retryFunction } from '../../src/imagery/retry.js';
import { failureOf } from '../admin/world.js';
import { adminCall } from '../publish/fakes.js';
import {
    CITY,
    NOW,
    at,
    readJob,
    readVersion,
    readyWorld,
    renderedVersion,
    seedGuard,
    seedJob,
    seedVersion,
    type ImageryWorld,
} from './world.js';

const JOB = 'job-1966-0712';

function failed(overrides: Partial<JobDoc> = {}): JobDoc {
    return {
        type: 'usgs-import',
        status: 'failed',
        params: { entityId: 'DS1035-1057DA023', dataset: 'corona2', sensor: 'KH-4A' },
        createdBy: 'u-admin',
        createdAt: at(NOW),
        layerId: 'kh-4a-corona-1966',
        versionId: JOB,
        attempt: 1,
        finishedAt: at(NOW),
        error: { code: 'apiError.imagery.referenceUnavailable', message: 'apiError.imagery.referenceUnavailable' },
        steps: { fetch: { status: 'done', gcsPath: 'usgs-raw/corona2/DS1035-1057DA023/a.tgz' }, reference: { status: 'failed' } },
        updatedBy: 'system:pipeline',
        updatedAt: at(NOW),
        ...overrides,
    };
}

function retry(world: ImageryWorld, jobId = JOB) {
    return retryFunction(() => world.deps).run(adminCall({ cityId: CITY, jobId }));
}

/** The failed version the pipeline left (the version a retry needs: a refused upload has none). */
async function seedFailedVersion(world: ImageryWorld, overrides: Parameters<typeof renderedVersion>[0] = {}): Promise<void> {
    await seedVersion(
        world,
        JOB,
        renderedVersion({ state: 'failed', output: undefined, error: { code: 'apiError.imagery.referenceUnavailable' }, ...overrides }),
    );
}

const PUBLISH_FAILED = renderedVersion({
    state: 'failed',
    approval: { auto: true, by: 'system:imagery', at: at(NOW) },
    error: { code: 'apiError.imagery.mtsRefused' },
});

describe('imagery.retry', () => {
    it('happyPath_aPipelineFailureIsQueuedAgainFromItsFailedStep', async () => {
        const world = await readyWorld();
        await seedJob(world, JOB, failed());
        await seedVersion(
            world,
            JOB,
            renderedVersion({ state: 'failed', output: undefined, error: { code: 'apiError.imagery.referenceUnavailable' } }),
        );

        await expect(retry(world)).resolves.toEqual({ status: 'queued', attempt: 1 });

        const job = await readJob(world, JOB);
        expect(job).toMatchObject({
            status: 'queued',
            attempt: 1,
            steps: { fetch: { status: 'done' }, reference: { status: 'pending' } },
            updatedBy: 'u-admin',
        });
        expect(job?.error).toBeUndefined();
        expect(job?.finishedAt).toBeUndefined();
        expect((await readVersion(world, JOB))?.state).toBe('processing');
        expect(world.deps.tasks.queued).toEqual([]);
    });

    it('happyPath_aFailureAfterApprovalGoesBackToThePublisher', async () => {
        const world = await readyWorld();
        await seedJob(
            world,
            JOB,
            failed({
                error: { code: 'apiError.imagery.mtsRefused', message: 'x' },
                mapboxJobId: 'mts-job-1',
                publishAttempts: 1,
                steps: { upload: { status: 'done', sha256: 'c'.repeat(64) }, publish: { status: 'done' }, tiles: { status: 'failed' } },
            }),
        );
        await seedVersion(world, JOB, PUBLISH_FAILED);

        await expect(retry(world)).resolves.toEqual({ status: 'awaiting_approval', attempt: 1 });

        expect(await readJob(world, JOB)).toMatchObject({ status: 'awaiting_approval', waitReason: 'approval' });
        expect((await readJob(world, JOB))?.mapboxJobId).toBeUndefined();
        expect((await readVersion(world, JOB))?.state).toBe('approved');
        expect(world.deps.tasks.queued).toEqual([
            {
                queue: 'imagery-publish',
                payload: { cityId: CITY, jobId: JOB, phase: 'start', poll: 0 },
                options: { id: `${CITY}-${JOB}-retry-${String(Date.parse(NOW))}` },
            },
        ]);
    });

    it('happyPath_aPublishRetryKeepsTheUploadAndClearsThePublishSteps', async () => {
        const world = await readyWorld();
        await seedJob(
            world,
            JOB,
            failed({
                error: { code: 'apiError.imagery.mtsRefused', message: 'x' },
                mapboxJobId: 'mts-job-1',
                steps: { upload: { status: 'done', sha256: 'c'.repeat(64) }, publish: { status: 'done' }, tiles: { status: 'failed' } },
            }),
        );
        await seedVersion(world, JOB, PUBLISH_FAILED);

        await retry(world);

        expect((await readJob(world, JOB))?.steps).toEqual({ upload: { status: 'done', sha256: 'c'.repeat(64) } });
    });
});

describe('imagery.retry: what is not tried again', () => {
    it('badPath_pastTheAttemptsItIsNotTriedAgain', async () => {
        const world = await readyWorld();
        await seedJob(world, JOB, failed({ attempt: JOB_MAX_ATTEMPTS }));
        await seedFailedVersion(world);

        expect(await failureOf(retry(world))).toMatchObject({
            code: 'failed-precondition',
            details: { code: 'apiError.imagery.attemptsExhausted', params: { attempts: '3' } },
        });
    });

    it('badPath_aPublishPastItsAttemptsIsNotTriedAgain @S-A42-BAD-PUBLISH-ATTEMPTS', async () => {
        const world = await readyWorld();
        await seedJob(
            world,
            JOB,
            failed({ error: { code: 'apiError.imagery.mtsRefused', message: 'x' }, publishAttempts: PUBLISH_MAX_ATTEMPTS }),
        );
        await seedVersion(world, JOB, PUBLISH_FAILED);

        expect(await failureOf(retry(world))).toMatchObject({
            details: { code: 'apiError.imagery.attemptsExhausted', params: { attempts: String(PUBLISH_MAX_ATTEMPTS) } },
        });
        expect(world.deps.tasks.queued).toEqual([]);
    });

    it.each([
        ['a revoked Mapbox token', 'apiError.mapbox.tokenInvalid'],
        ['a token without the tileset scopes', 'apiError.mapbox.missingScopes'],
        ['out of memory on the large machine', 'apiError.imagery.outOfMemory'],
    ])('badPath_aFailureNoRetryCuresIsNotRetried_%s @S-A12-BAD-NOT-RETRYABLE', async (_case, code) => {
        const world = await readyWorld();
        await seedJob(world, JOB, failed({ error: { code, message: code } }));
        await seedFailedVersion(world, { error: { code: code as 'apiError.imagery.outOfMemory' } });

        expect(await failureOf(retry(world))).toMatchObject({ details: { code: 'apiError.imagery.versionState' } });
        expect((await readJob(world, JOB))?.status).toBe('failed');
    });

    it('badPath_aRefusedUploadWithoutAVersionIsNotRetried @S-A14-BAD-NON-TIFF', async () => {
        const world = await readyWorld();
        await seedJob(
            world,
            JOB,
            failed({
                type: 'geotiff-import',
                attempt: undefined,
                steps: undefined,
                error: { code: 'apiError.imagery.notTiff', message: 'x' },
            }),
        );

        expect(await failureOf(retry(world))).toMatchObject({ details: { code: 'apiError.imagery.versionState' } });
        expect((await readJob(world, JOB))?.status).toBe('failed');
    });

    it.each([
        ['a job that did not fail', failed({ status: 'running' })],
        ['a layer deletion', failed({ type: 'layer-delete', params: { layerId: 'x' } })],
    ])('badPath_onlyAFailedRasterJobIsRetried_%s', async (_case, job) => {
        const world = await readyWorld();
        await seedJob(world, JOB, job);

        expect(await failureOf(retry(world))).toMatchObject({ details: { code: 'apiError.imagery.versionState' } });
    });

    it('badPath_theBudgetGuardPausesRetries', async () => {
        const world = await readyWorld();
        await seedGuard(world, 'red');
        await seedJob(world, JOB, failed());
        await seedFailedVersion(world);

        expect(await failureOf(retry(world))).toMatchObject({ details: { code: 'apiError.guardPaused' } });
    });

    it('badPath_aJobRetriedMeanwhileIsNotRetriedTwice', async () => {
        const world = await readyWorld();
        await seedJob(world, JOB, failed());
        const original = world.deps.documents.transaction.bind(world.deps.documents);
        world.deps.documents.transaction = (async (work: Parameters<typeof original>[0]) => {
            await seedJob(world, JOB, failed({ status: 'queued' }));
            return original(work);
        }) as typeof original;

        expect(await failureOf(retry(world))).toMatchObject({ details: { code: 'apiError.imagery.versionState' } });
    });

    it('badPath_anUnknownJobIsNotFound', async () => {
        const world = await readyWorld();

        expect(await failureOf(retry(world, 'nope'))).toMatchObject({ code: 'not-found' });
    });

    it('happyPath_aJobWithoutAttemptsOrStepsIsQueued', async () => {
        const world = await readyWorld();
        await seedJob(world, JOB, failed({ attempt: undefined, versionId: undefined, steps: undefined, error: undefined }));
        await seedFailedVersion(world);

        await expect(retry(world)).resolves.toEqual({ status: 'queued', attempt: 0 });
    });
});
