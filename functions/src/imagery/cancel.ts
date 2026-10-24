/**
 * An admin's Cancel (`cancelRequested`, `docs/research/M3-interfaces.md` §4.2, §4.5): a job that waits (queued, waiting
 * for USGS, for points or for approval) is cancelled at once with its version, its reservation released and its scene
 * freed; so is a publish that has not reached Mapbox yet (its job `mts_processing` with no publish call made: CR-M3-47),
 * checked in the same transaction that ends it; a starting or running one gets its Cloud Run execution cancelled, and
 * the pipeline's SIGTERM handler finishes the cancellation (the tick does when no heartbeat follows); Mapbox's
 * processing, once asked for, can no longer be stopped.
 */
import { FIRESTORE_PATHS, jobDocSchema, type JobDoc, type JobStatus } from '@hcm/shared';

import type { Ports } from '../ports/index.js';
import { endWork } from './end.js';
import { IMAGERY_WRITER, appendJobLog } from './records.js';

export type CancelDeps = Pick<Ports, 'documents' | 'clock' | 'log' | 'jobs'>;

export type CancelOutcome = 'cancelled' | 'signalled' | 'finishing' | 'skipped';

/** The statuses whose job ends as soon as the admin asks. */
const WAITING: ReadonlySet<JobStatus> = new Set<JobStatus>(['queued', 'waiting_usgs', 'awaiting_gcps', 'awaiting_approval']);

/** The publish steps' states that mean Mapbox was asked (the call under way, or made). */
const CALLED: ReadonlySet<string> = new Set(['running', 'done']);

function publishCalled(job: Pick<JobDoc, 'steps'>): boolean {
    const publish = job.steps?.['publish'];
    return publish !== undefined && CALLED.has(publish.status);
}

/** A publish that has not asked Mapbox for anything billable yet: no MTS job, and no publish call under way. */
export function beforeMapbox(job: Pick<JobDoc, 'status' | 'mapboxJobId' | 'steps'>): boolean {
    return job.status === 'mts_processing' && job.mapboxJobId === undefined && !publishCalled(job);
}

/** Cancels the job as far as its status allows. */
export async function cancelJob(deps: CancelDeps, cityId: string, jobId: string): Promise<CancelOutcome> {
    const job = await deps.documents.get(FIRESTORE_PATHS.job(cityId, jobId), jobDocSchema);
    if (job === undefined) {
        return 'skipped';
    }
    if (WAITING.has(job.status)) {
        return cancelNow(deps, cityId, jobId, (current) => WAITING.has(current.status));
    }
    if (job.status === 'mts_processing') {
        return cancelPublish(deps, cityId, jobId);
    }
    return job.executionName === undefined ? 'skipped' : signal(deps, cityId, jobId, job.executionName);
}

/** Ends a waiting job and its version (the reservation, the pending version and the scene released). */
async function cancelNow(deps: CancelDeps, cityId: string, jobId: string, accept: (job: JobDoc) => boolean): Promise<CancelOutcome> {
    const ending = { status: 'cancelled', versionState: 'cancelled', by: IMAGERY_WRITER, accept } as const;
    const ended = await endWork(deps, cityId, jobId, ending);
    deps.log.info('raster job cancelled', { cityId, jobId, ended });
    return ended ? 'cancelled' : 'skipped';
}

/** A publish is cancelled while it has not reached Mapbox; once it has, Mapbox finishes it. */
async function cancelPublish(deps: CancelDeps, cityId: string, jobId: string): Promise<CancelOutcome> {
    if ((await cancelNow(deps, cityId, jobId, beforeMapbox)) === 'cancelled') {
        return 'cancelled';
    }
    await appendJobLog(deps, cityId, jobId, { level: 'warn', message: 'apiError.imagery.mapboxFinishing' });
    return 'finishing';
}

/** Asks Cloud Run to stop the execution (SIGTERM); the pipeline records the cancellation itself. */
async function signal(deps: CancelDeps, cityId: string, jobId: string, executionName: string): Promise<CancelOutcome> {
    try {
        await deps.jobs.cancel(executionName);
    } catch (error) {
        deps.log.warn('pipeline execution not cancelled', { cityId, jobId, error: String(error) });
        return 'skipped';
    }
    deps.log.info('pipeline execution cancelled', { cityId, jobId });
    return 'signalled';
}
