import '../global-options.js';

import {
    FIRESTORE_PATHS,
    isApiErrorCode,
    jobDocSchema,
    redactText,
    workerDocSchema,
    type ApiErrorCode,
    type CallableRequest,
    type CallableResponse,
    type JobDoc,
    type WorkerDoc,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { ApiError } from '../api/api-error.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import { omit } from '../api/objects.js';
import { endWork } from '../imagery/end.js';
import type { Ports } from '../ports/index.js';
import { IN_RUN, PIPELINE_WRITER, at, holds, requireWorker, type WorkerCall } from './holder.js';
import { archiveOf, handedBack, returnsExhausted } from './archive-host.js';
import { paired } from './pairing.js';
import { activePause, afterCommand, releasedJob } from './pause-state.js';

export type EndDeps = Pick<Ports, 'documents' | 'clock' | 'log'>;

type Request = CallableRequest<'worker.end'>;

/** The code a crash outside a step fails the job with: the worker's, when it is an `apiError.*` code. */
function codeOf(error: Request['error']): ApiErrorCode {
    return error !== undefined && isApiErrorCode(error.code) ? error.code : 'apiError.imagery.processingFailed';
}

/** True while the worker's run still holds the job unfinished (the claim's `starting` or the lease's `running`). */
function stillRunning(job: JobDoc, call: WorkerCall, now: Date): boolean {
    return holds(job, call, now) && IN_RUN.has(job.status);
}

/** A run that crashed outside a step: its job and version `failed`, if the worker still holds the job unfinished. */
async function failHeld(deps: EndDeps, call: WorkerCall, request: Request, now: Date): Promise<void> {
    const code = codeOf(request.error);
    const message = redactText(request.error?.message ?? code);
    const ended = await endWork(deps, call.cityId, request.jobId, {
        status: 'failed',
        versionState: 'failed',
        by: PIPELINE_WRITER,
        error: { code, message },
        accept: (job) => stillRunning(job, call, now),
    });
    if (ended) {
        deps.log.warn('worker run failed outside a step', { cityId: call.cityId, jobId: request.jobId, code });
    }
}

/** The archive of a job the worker may hand back: an archive series it still holds unfinished; else undefined. */
function returnable(job: JobDoc | undefined, call: WorkerCall, now: Date): string | undefined {
    return job !== undefined && stillRunning(job, call, now) ? archiveOf(job) : undefined;
}

/**
 * M20 (2026-11-13): the worker has not the series' sheets and found no copy: it hands the job back, queued again with its attempt
 * given back, waiting for the computer that has the archive to send a copy. Only an archive series the worker still holds
 * unfinished; the worker the archive's report came from (its files are gone) and the `ARCHIVE_RETURNS_MAX`th return fail the job
 * with `archiveMissing` instead (no hand-back loop).
 */
async function handBack(deps: EndDeps, call: WorkerCall, request: Request, now: Date): Promise<void> {
    const path = FIRESTORE_PATHS.job(call.cityId, request.jobId);
    const lost = await deps.documents.transaction(async (transaction) => {
        const job = await transaction.get(path, jobDocSchema);
        const archiveId = returnable(job, call, now);
        if (job === undefined || archiveId === undefined) {
            return false;
        }
        if (await returnsExhausted(transaction, job, archiveId, call)) {
            return true;
        }
        await transaction.set(path, jobDocSchema, handedBack(job, now));
        deps.log.info('worker handed back an archive job it has no sheets for', { cityId: call.cityId, jobId: request.jobId, archiveId });
        return false;
    });
    if (lost) {
        await failHeld(
            deps,
            call,
            {
                ...request,
                error: {
                    code: 'apiError.imagery.archiveMissing',
                    message: 'the archive is not on its computer, and no copy reached this one',
                },
            },
            now,
        );
    }
}

/** The run that ended: its worker's call, the worker's document (its own page's pause applied) and the time. */
interface Ended {
    readonly call: WorkerCall;
    readonly worker: WorkerDoc;
    readonly now: Date;
}

/** True when the computer was asked to give the job back: it is paused, or its job was asked back (`releaseRequested`). */
function askedBack(job: JobDoc, worker: WorkerDoc, now: Date): boolean {
    return job.releaseRequested === true || activePause(worker, now) !== undefined;
}

/**
 * Pause this computer (2026-11-13): the paused computer's run stopped at a checkpoint and hands the job back, queued where it stopped.
 * The attempt its claim counted is given back only while the computer is paused or its job was asked back (a Resume that came
 * between the checkpoint and this call keeps it counted): a hand-back is never a way round the attempts. Only a job the worker still
 * holds unfinished.
 */
async function release(deps: EndDeps, ended: Ended, request: Request): Promise<void> {
    const { call, worker, now } = ended;
    const path = FIRESTORE_PATHS.job(call.cityId, request.jobId);
    const released = await deps.documents.transaction(async (transaction) => {
        const job = await transaction.get(path, jobDocSchema);
        if (job === undefined || !stillRunning(job, call, now)) {
            return false;
        }
        await transaction.set(path, jobDocSchema, releasedJob(job, PIPELINE_WRITER, now, askedBack(job, worker, now)));
        return true;
    });
    if (released) {
        deps.log.info('a paused computer handed its job back', { cityId: call.cityId, workerId: call.workerId, jobId: request.jobId });
    }
}

/** What the run's outcome does to the job: a crash fails it, a hand-back queues it again, `done` leaves it. */
async function settle(deps: EndDeps, ended: Ended, request: Request): Promise<void> {
    const { call, now } = ended;
    if (request.outcome === 'failed') {
        await failHeld(deps, call, request, now);
    } else if (request.outcome === 'returned') {
        await handBack(deps, call, request, now);
    } else if (request.outcome === 'released') {
        await release(deps, ended, request);
    }
}

/** The worker's last job as its panel shows it: a hand-back is no job it ran, so the one before stays. */
function lastJobOf(worker: WorkerDoc, request: Request, now: Date): Pick<WorkerDoc, 'lastJob'> {
    if (request.outcome === 'returned' || request.outcome === 'released') {
        return worker.lastJob === undefined ? {} : { lastJob: worker.lastJob };
    }
    return { lastJob: { id: request.jobId, outcome: request.outcome, at: at(now) } };
}

/**
 * `worker.end` (`docs/research/M7-local-worker.md` §1.2, §2.4): the run is over. `failed` ends a job the worker still
 * holds unfinished (the run crashed outside a step: `error.code`, else `apiError.imagery.processingFailed`); `done` leaves
 * the job as the run left it; `returned` hands an archive series back (`handBack`, M20). The worker is idle again with its last
 * job. `released` hands a paused computer's job back (`release`), the computer's own page's `pause` recorded first. Never paused by
 * the budget guard.
 */
async function workerEnd(deps: EndDeps, caller: VerifiedCaller, request: Request): Promise<CallableResponse<'worker.end'>> {
    const call = { cityId: request.cityId, workerId: request.workerId, uid: caller.uid };
    const now = deps.clock.now();
    // Pause: the computer's own page paused it during the run; recorded before the job is handed back.
    const worker = afterCommand(await requireWorker(deps.documents, call), request.pause, now);
    const path = FIRESTORE_PATHS.job(call.cityId, request.jobId);
    await settle(deps, { call, worker, now }, request);
    await deps.documents.set(FIRESTORE_PATHS.worker(call.cityId, call.workerId), workerDocSchema, {
        ...omit(worker, ['jobId', 'lastJob']),
        state: 'idle',
        ...lastJobOf(worker, request, now),
        lastSeenAt: at(now),
        updatedBy: caller.uid,
        updatedAt: at(now),
    });
    const job = await deps.documents.get(path, jobDocSchema);
    if (job === undefined) {
        throw new ApiError('apiError.notFound');
    }
    return { status: job.status };
}

/** The `worker-end` callable. */
export function endFunction(getDeps: () => EndDeps & CallableDeps) {
    return defineCallable('worker.end', paired(workerEnd), getDeps);
}
