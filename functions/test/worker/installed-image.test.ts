/**
 * The installed pipeline image (finding 74 of 2026-11-03, `functions/src/worker/installed-image.ts`): the image the job
 * `raster-pipeline` runs wins over the record, its release comes from the job's label (or from the record only for the
 * same digest), a refused or absent job falls back to the record, and what the job runs is kept a minute.
 */
import { describe, expect, it } from 'vitest';

import { UpstreamError } from '../../src/ports/errors.js';
import { installedImage, JOB_CACHE_MS } from '../../src/worker/installed-image.js';
import { seedSetup } from '../imagery/world.js';
import { NOW, workerWorld, type WorkerWorld } from './world.js';

const OLD = `sha256:${'ae'.repeat(32)}`;
const NEW = `sha256:${'eb'.repeat(32)}`;
const REPOSITORY = 'us-central1-docker.pkg.dev/demo-hcm/hcm/pipeline';

async function recorded(world: WorkerWorld, image: string, release = '1.0.0+bf74d17'): Promise<void> {
    await seedSetup(world, { install: { pipeline: { state: 'installed', release, checkedAt: NOW, image } } });
}

function jobRuns(world: WorkerWorld, image: string, labels: Readonly<Record<string, string>> = {}): void {
    world.jobs.descriptions.set('raster-pipeline', { image, labels });
}

describe('installedImage', () => {
    it('happyPath_theJobsImageAndItsLabelsReleaseWinOverAStaleRecord', async () => {
        // The live finding: the record named the release before's digest beside the new release.
        const world = await workerWorld();
        await recorded(world, OLD);
        jobRuns(world, `${REPOSITORY}@${NEW}`, { 'hcm-release': '1-0-0-bf74d17' });

        await expect(installedImage(world.deps)).resolves.toEqual({ digest: NEW, release: '1.0.0+bf74d17', from: 'job' });
    });

    it('happyPath_theRecordsReleaseIsKeptOnlyForTheDigestItNames', async () => {
        const world = await workerWorld();
        await recorded(world, NEW, '1.0.0+b8b4a26');
        jobRuns(world, `${REPOSITORY}@${NEW}`);
        await expect(installedImage(world.deps)).resolves.toEqual({ digest: NEW, release: '1.0.0+b8b4a26', from: 'job' });

        const other = await workerWorld();
        await recorded(other, OLD);
        jobRuns(other, `${REPOSITORY}@${NEW}`, { 'hcm-release': 'not-a-release' });
        await expect(installedImage(other.deps)).resolves.toEqual({ digest: NEW, release: undefined, from: 'job' });
    });

    it('badPath_aRefusedAbsentOrForeignJobFallsBackToTheRecord', async () => {
        const refused = await workerWorld();
        await recorded(refused, OLD);
        refused.jobs.recorder.failNext('job', new UpstreamError('cloud-run', 'forbidden'));
        await expect(installedImage(refused.deps)).resolves.toEqual({ digest: OLD, release: '1.0.0+bf74d17', from: 'record' });
        expect(refused.deps.recording.records.map((record) => record.message)).toContain(
            'pipeline job not readable: the recorded image is used',
        );

        const absent = await workerWorld();
        await recorded(absent, OLD);
        await expect(installedImage(absent.deps)).resolves.toMatchObject({ digest: OLD, from: 'record' });

        const foreign = await workerWorld();
        jobRuns(foreign, 'us-docker.pkg.dev/cloudrun/container/job:latest');
        await expect(installedImage(foreign.deps)).resolves.toBeUndefined();
    });

    it('badPath_anUnreadableRecordLeavesTheJobsAnswer', async () => {
        const world = await workerWorld();
        jobRuns(world, `${REPOSITORY}@${NEW}`, { 'hcm-release': '1-0-0-bf74d17' });
        const documents = { get: () => Promise.reject(new Error('firestore unavailable')) } as unknown as WorkerWorld['deps']['documents'];

        await expect(installedImage({ ...world.deps, documents })).resolves.toEqual({ digest: NEW, release: '1.0.0+bf74d17', from: 'job' });
    });

    it('happyPath_whatTheJobRunsIsKeptAMinute', async () => {
        const world = await workerWorld();
        jobRuns(world, `${REPOSITORY}@${OLD}`);
        await expect(installedImage(world.deps)).resolves.toMatchObject({ digest: OLD });

        jobRuns(world, `${REPOSITORY}@${NEW}`);
        world.deps.clock.set(new Date(Date.parse(NOW) + JOB_CACHE_MS - 1).toISOString());
        await expect(installedImage(world.deps)).resolves.toMatchObject({ digest: OLD });
        world.deps.clock.set(new Date(Date.parse(NOW) + JOB_CACHE_MS).toISOString());
        await expect(installedImage(world.deps)).resolves.toMatchObject({ digest: NEW });
        expect(world.jobs.recorder.argsOf('job')).toEqual([['raster-pipeline'], ['raster-pipeline']]);
    });
});
