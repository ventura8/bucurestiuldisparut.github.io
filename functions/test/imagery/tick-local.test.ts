/**
 * `imagery.tick`'s lost local runs (`functions/src/imagery/tick-jobs.ts`, `docs/research/M7-local-worker.md` §3): a job
 * running on the owner's computer whose worker stopped beating (its lease lapsed, `running` or still `starting`) goes back
 * to `queued` waiting for a worker, with `apiError.imagery.workerLost` in its log and its attempt kept; Cloud Run is never
 * asked about it, and a local run whose lease is live is left alone however old its start.
 */
import { FIRESTORE_PATHS, jobLogDocSchema, type JobDoc } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { runImageryTick } from '../../src/imagery/tick.js';
import { heldJob, minutes, workerWorld, type WorkerWorld } from '../worker/world.js';
import { CITY, readJob, renderedVersion, seedJob, seedVersion } from './world.js';

const JOB = 'job-1966-0712';

async function localRun(job: Partial<JobDoc>): Promise<WorkerWorld> {
    const world = await workerWorld();
    await seedVersion(world, JOB, { ...renderedVersion(), state: 'processing' });
    await seedJob(world, JOB, heldJob(job));
    return world;
}

async function logMessages(world: WorkerWorld): Promise<string[]> {
    const lines = await world.deps.documents.query(FIRESTORE_PATHS.jobLogs(CITY, JOB), jobLogDocSchema);
    return lines.documents.map((line) => line.data.message);
}

describe('imagery.tick: lost local runs', () => {
    it.each([
        ['running', { status: 'running' as const }],
        ['still starting', { status: 'starting' as const, startedAt: undefined }],
    ])('badPath_aLocalRun%sWhoseWorkerStoppedWaitsForAWorkerAgain @S-A62-BAD-WORKER-LOST', async (_name, state) => {
        const world = await localRun({ ...state, lease: { owner: 'worker:w-0123456789abcdef', until: minutes(-1) }, attempt: 2 });

        await runImageryTick(world.deps);

        const job = await readJob(world, JOB);
        expect(job).toMatchObject({ status: 'queued', waitReason: 'worker', runOn: 'local', attempt: 2, updatedBy: 'system:imagery' });
        expect(job).not.toHaveProperty('worker');
        expect(job).not.toHaveProperty('lease');
        await expect(logMessages(world)).resolves.toEqual(['apiError.imagery.workerLost']);
        expect(world.jobs.recorder.calls).toEqual([]);
    });

    it('happyPath_aLocalRunWithItsLeaseLiveIsLeftAloneHoweverLateItsHeartbeatOrOldItsStart @S-A62-BAD-WORKER-LOST', async () => {
        const world = await localRun({ status: 'starting', dispatchAt: minutes(-30), updatedAt: minutes(-30), startedAt: undefined });
        const before = await readJob(world, JOB);

        await runImageryTick(world.deps);

        await expect(readJob(world, JOB)).resolves.toEqual(before);
        await expect(logMessages(world)).resolves.toEqual([]);
        expect(world.jobs.recorder.calls).toEqual([]);
    });

    it('badPath_aRunTheWorkerRenewedMeanwhileIsNotLost', async () => {
        const world = await localRun({ lease: { owner: 'worker:w-0123456789abcdef', until: minutes(-1) } });
        const { documents } = world.deps;
        const renewed = heldJob();
        const racing: typeof documents = {
            ...documents,
            transaction: (work) => {
                documents.seed(FIRESTORE_PATHS.job(CITY, JOB), renewed);
                return documents.transaction(work);
            },
        };

        await runImageryTick({ ...world.deps, documents: racing });

        await expect(readJob(world, JOB)).resolves.toEqual(renewed);
        await expect(logMessages(world)).resolves.toEqual([]);
    });
});
