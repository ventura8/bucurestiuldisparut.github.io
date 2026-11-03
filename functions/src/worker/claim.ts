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
    (job, now) => [job.dispatchAt, job.retryAt].every((time) => time === undefined || timestampToDate(time) <= now),
];

function claimable(job: JobDoc | undefined, now: Date): job is JobDoc {
    return job !== undefined && CLAIM_RULES.every((rule) => rule(job, now));
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
async function takeFirst(deps: ClaimDeps, call: WorkerCall, now: Date): Promise<string | null> {
    for (const jobId of await candidates(deps, call.cityId, now)) {
        if (await take(deps, call, jobId, now)) {
            return jobId;
        }
    }
    return null;
}

/** Takes `jobId` for the worker in one transaction, if it is still claimable; false when another worker or event came first. */
function take(deps: ClaimDeps, call: WorkerCall, jobId: string, now: Date): Promise<boolean> {
    const path = FIRESTORE_PATHS.job(call.cityId, jobId);
    return deps.documents.transaction(async (transaction) => {
        const job = await transaction.get(path, jobDocSchema);
        const worker = await requireWorker(transaction, call);
        if (!claimable(job, now)) {
            return false;
        }
        await transaction.set(path, jobDocSchema, claimed(job, call, now));
        await transaction.set(FIRESTORE_PATHS.worker(call.cityId, call.workerId), workerDocSchema, seen(worker, call, now, jobId));
        return true;
    });
}

/** The oldest queued local jobs of the city, oldest first (index `jobs`: `runOn`, `status`, `createdAt`). */
async function candidates(deps: ClaimDeps, cityId: string, now: Date): Promise<string[]> {
    const found = await deps.documents.query(FIRESTORE_PATHS.jobs(cityId), jobDocSchema, {
        where: [
            ['runOn', '==', 'local'],
            ['status', '==', 'queued'],
        ],
        orderBy: ['createdAt', 'asc'],
        limit: CLAIM_SCAN,
    });
    return found.documents.filter((job) => claimable(job.data, now)).map((job) => job.id);
}

/**
 * `worker.claim` (`docs/research/M7-local-worker.md` §1.2, §2.4; S-A62-HAPPY-CLAIM): the oldest due queued job of the city
 * chosen for the owner's computer, taken in one transaction (`starting`, its attempt counted, the lease and `worker`
 * naming this worker, no Cloud Run machine or wait), or none; either way the worker is seen now. Finding 67: a paired
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
    const jobId = outdated ? null : await takeFirst(deps, call, now);
    if (jobId !== null) {
        deps.log.info('worker claimed a job', { cityId: call.cityId, workerId: call.workerId, jobId });
        return { job: { jobId } };
    }
    await deps.documents.set(FIRESTORE_PATHS.worker(call.cityId, call.workerId), workerDocSchema, { ...seen(worker, call, now), outdated });
    return outdated ? { job: null, outdated } : { job: null };
}

/** The `worker-claim` callable. */
export function claimFunction(getDeps: () => ClaimDeps & CallableDeps) {
    return defineCallable('worker.claim', paired(workerClaim), getDeps);
}
