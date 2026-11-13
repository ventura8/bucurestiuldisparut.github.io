import '../global-options.js';

import {
    FIRESTORE_PATHS,
    JOB_MAX_ATTEMPTS,
    LEASE_SECONDS,
    jobDocSchema,
    runsOnPipeline,
    timestampToDate,
    workerDocSchema,
    type CallableRequest,
    type CallableResponse,
    type JobDoc,
    type WorkerDoc,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import { omit } from '../api/objects.js';
import { IMAGERY_WRITER } from '../imagery/records.js';
import type { Ports } from '../ports/index.js';
import { copyFor } from './archive-host.js';
import { at, leaseOwnerOf, requireGreen, requireWorker, type WorkerCall } from './holder.js';
import { imageState, paired } from './pairing.js';

export type ClaimDeps = Pick<Ports, 'documents' | 'clock' | 'log' | 'jobs'>;

/** How many of the oldest queued local jobs one claim looks at (the rest wait for the next poll). */
const CLAIM_SCAN = 20;

/** What makes a queued job one a worker may take (`docs/research/M7-local-worker.md` §2.4), each rule on its own. */
const CLAIM_RULES: readonly ((job: JobDoc, now: Date) => boolean)[] = [
    (job) => job.status === 'queued' && job.runOn === 'local',
    (job) => job.cancelRequested !== true && runsOnPipeline(job.type),
    (job) => (job.attempt ?? 0) < JOB_MAX_ATTEMPTS,
    // M8 (docs/research/M8-join-interfaces.md §5): a join still waiting for its frames; the dispatcher moves it on.
    (job) => job.waitReason !== 'parts',
    // M20 (docs/research/M20-import-local.md §1.3): an archive series waiting for a later day's share; imagery.tick releases it.
    (job) => job.waitReason !== 'daily',
    // M20 (live report of 2026-11-13): a series waiting for its sheets' copy; the computer with the archive sends it first.
    (job) => job.waitReason !== 'archive-copy',
    (job, now) => [job.dispatchAt, job.retryAt].every((time) => time === undefined || timestampToDate(time) <= now),
];

/** The types the worker's pipeline runs, when it named them: an older image leaves a newer type queued for an updated one. */
type Runs = readonly string[] | undefined;

/** The worker's call with the types it runs. */
type Claim = WorkerCall & { readonly runs: Runs };

function claimable(job: JobDoc | undefined, now: Date, runs: Runs): job is JobDoc {
    return job !== undefined && CLAIM_RULES.every((rule) => rule(job, now)) && (runs === undefined || runs.includes(job.type));
}

/** The job as the worker takes it: `starting`, one more attempt, leased to the worker, no Cloud Run machine. */
function claimed(job: JobDoc, call: WorkerCall, now: Date): JobDoc {
    return {
        ...omit(job, ['machine', 'waitReason', 'executionName', 'workerOverdueAt']),
        status: 'starting',
        attempt: (job.attempt ?? 0) + 1,
        dispatchAt: at(now),
        lease: { owner: leaseOwnerOf(call.workerId), until: at(new Date(now.getTime() + LEASE_SECONDS * 1000)) },
        worker: { id: call.workerId, uid: call.uid, claimedAt: at(now) },
        updatedBy: IMAGERY_WRITER,
        updatedAt: at(now),
    };
}

/** The worker's document as last seen now: busy with `jobId`, or idle. */
function seen(worker: WorkerDoc, call: WorkerCall, now: Date, jobId?: string): WorkerDoc {
    const state = jobId === undefined ? { state: 'idle' as const } : { state: 'busy' as const, jobId };
    return { ...omit(worker, ['jobId']), ...state, lastSeenAt: at(now), updatedBy: call.uid, updatedAt: at(now) };
}

/** The first of the city's claimable jobs this worker takes, or null. */
async function takeFirst(deps: ClaimDeps, call: Claim, now: Date): Promise<string | null> {
    for (const jobId of await candidates(deps, call.cityId, now, call.runs)) {
        if (await take(deps, call, jobId, now)) {
            return jobId;
        }
    }
    return null;
}

/** Takes `jobId` for the worker in one transaction, if it is still claimable; false when another worker or event came first. */
function take(deps: ClaimDeps, call: Claim, jobId: string, now: Date): Promise<boolean> {
    const path = FIRESTORE_PATHS.job(call.cityId, jobId);
    return deps.documents.transaction(async (transaction) => {
        const job = await transaction.get(path, jobDocSchema);
        const worker = await requireWorker(transaction, call);
        if (!claimable(job, now, call.runs)) {
            return false;
        }
        await transaction.set(path, jobDocSchema, claimed(job, call, now));
        await transaction.set(FIRESTORE_PATHS.worker(call.cityId, call.workerId), workerDocSchema, seen(worker, call, now, jobId));
        return true;
    });
}

/** The oldest queued local jobs of the city, oldest first (index `jobs`: `runOn`, `status`, `createdAt`). */
async function candidates(deps: ClaimDeps, cityId: string, now: Date, runs: Runs): Promise<string[]> {
    const found = await deps.documents.query(FIRESTORE_PATHS.jobs(cityId), jobDocSchema, {
        where: [
            ['runOn', '==', 'local'],
            ['status', '==', 'queued'],
        ],
        orderBy: ['createdAt', 'asc'],
        limit: CLAIM_SCAN,
    });
    return found.documents.filter((job) => claimable(job.data, now, runs)).map((job) => job.id);
}

/**
 * `worker.claim` (`docs/research/M7-local-worker.md` §1.2, §2.4; S-A62-HAPPY-CLAIM): the oldest due queued job of the city
 * chosen for the owner's computer, taken in one transaction (`starting`, its attempt counted, the lease and `worker`
 * naming this worker, no Cloud Run machine or wait), or none, of the types the worker said its pipeline runs (an older image
 * leaves a newer type queued; 2026-11-09); either way the worker is seen now. M20 (2026-11-13): a worker that holds an archive
 * whole is first given a series another worker waits for (`copy`), to send its sheets (`archive-host.ts`). Finding 67: a paired
 * worker whose image is no longer the installed pipeline's takes nothing (`outdated`) until the owner runs the new command.
 */
async function workerClaim(
    deps: ClaimDeps,
    caller: VerifiedCaller,
    request: CallableRequest<'worker.claim'>,
): Promise<CallableResponse<'worker.claim'>> {
    await requireGreen(deps.documents);
    const call = { cityId: request.cityId, workerId: request.workerId, uid: caller.uid };
    const now = deps.clock.now();
    const worker = await requireWorker(deps.documents, call);
    // Finding 72: the image `worker.hello` recorded (the supervisor's), else the pairing's.
    const { outdated } = await imageState(deps, caller, call.cityId, worker.image);
    if (outdated) {
        await deps.documents.set(FIRESTORE_PATHS.worker(call.cityId, call.workerId), workerDocSchema, {
            ...seen(worker, call, now),
            outdated,
        });
        return { job: null, outdated };
    }
    const seenNow = { ...seen(worker, call, now), outdated: false };
    return (
        (await offerCopy(deps, call, request.archives, seenNow)) ?? (await claimJob(deps, { ...call, runs: request.types }, seenNow, now))
    );
}

/** M20: a series another worker waits for, when this worker holds its archive whole; the worker is seen now. */
async function offerCopy(
    deps: ClaimDeps,
    call: WorkerCall,
    archives: readonly string[] | undefined,
    seenNow: WorkerDoc,
): Promise<CallableResponse<'worker.claim'> | undefined> {
    const copy = await copyFor(deps, call.cityId, archives);
    if (copy === undefined) {
        return undefined;
    }
    deps.log.info('worker asked to copy an archive series', { cityId: call.cityId, workerId: call.workerId, ...copy });
    await deps.documents.set(FIRESTORE_PATHS.worker(call.cityId, call.workerId), workerDocSchema, seenNow);
    return { job: null, copy };
}

/** The first claimable job taken, or none; the worker is seen now either way. */
async function claimJob(deps: ClaimDeps, call: Claim, seenNow: WorkerDoc, now: Date): Promise<CallableResponse<'worker.claim'>> {
    const jobId = await takeFirst(deps, call, now);
    if (jobId !== null) {
        deps.log.info('worker claimed a job', { cityId: call.cityId, workerId: call.workerId, jobId });
        return { job: { jobId } };
    }
    await deps.documents.set(FIRESTORE_PATHS.worker(call.cityId, call.workerId), workerDocSchema, seenNow);
    return { job: null };
}

/** The `worker-claim` callable. */
export function claimFunction(getDeps: () => ClaimDeps & CallableDeps) {
    return defineCallable('worker.claim', paired(workerClaim), getDeps);
}
