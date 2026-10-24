/**
 * The job parts of `imagery.tick` (`docs/research/M3-interfaces.md` §4.5, §4.6 steps 1–3; S-A12-BAD-LOST-EXECUTION): due
 * jobs dispatched, USGS waits resumed, stale starts and lost executions recovered (an out-of-memory exit on `std` runs
 * again on `xl`; past `JOB_MAX_ATTEMPTS` the job fails), cancellations and approvals a lost event left behind carried
 * out, and the MTS jobs whose poll went missing polled again.
 */
import {
    FIRESTORE_PATHS,
    JOB_MAX_ATTEMPTS,
    PUBLISH_POLL_SECONDS,
    STARTING_STALE_MINUTES,
    jobDocSchema,
    layerVersionDocSchema,
    timestampToDate,
    type ApiErrorCode,
    type JobDoc,
    type JobStatus,
    type TimestampLike,
} from '@hcm/shared';

import { omit } from '../api/objects.js';
import type { ExecutionStatus } from '../ports/cloud-run-jobs.js';
import type { StoredDocument } from '../ports/documents.js';
import type { Ports } from '../ports/index.js';
import { applyApprovalPolicy } from './approval.js';
import { beforeMapbox, cancelJob } from './cancel.js';
import { dispatchJob } from './dispatch.js';
import { endWork, type Ending } from './end.js';
import { enqueuePublish } from './publish-queue.js';
import { IMAGERY_WRITER, stampOf, versionIdOf } from './records.js';

export type TickJobsDeps = Pick<Ports, 'documents' | 'clock' | 'log' | 'jobs' | 'tasks'>;

const MINUTE_MS = 60_000;
/** The statuses whose job ends as soon as a cancellation is asked. */
const WAITING: ReadonlySet<JobStatus> = new Set<JobStatus>(['queued', 'waiting_usgs', 'awaiting_gcps', 'awaiting_approval']);
/** An MTS job not polled for this long lost its poll task (the longest poll delay plus five minutes). */
const POLL_STALE_MS = (Math.max(...PUBLISH_POLL_SECONDS) + 300) * 1000;
/** The poll index whose delay is the longest one. */
const LAST_POLL = PUBLISH_POLL_SECONDS.length - 1;

async function jobsIn(deps: TickJobsDeps, cityId: string, statuses: readonly JobStatus[]): Promise<readonly StoredDocument<JobDoc>[]> {
    return (await deps.documents.query(FIRESTORE_PATHS.jobs(cityId), jobDocSchema, { where: [['status', 'in', [...statuses]]] })).documents;
}

function earlier(at: TimestampLike | undefined, limit: Date): boolean {
    return at !== undefined && timestampToDate(at) < limit;
}

/** The job a recovery moves back to `queued`, and the status it must still be in. */
interface Requeue {
    readonly cityId: string;
    readonly jobId: string;
    readonly from: JobStatus;
}

/** Moves a job back to `queued` (attempt kept) when it is still in `from`. */
async function requeue(deps: TickJobsDeps, { cityId, jobId, from }: Requeue, changes: Partial<JobDoc> = {}): Promise<boolean> {
    const path = FIRESTORE_PATHS.job(cityId, jobId);
    return deps.documents.transaction(async (transaction) => {
        const job = await transaction.get(path, jobDocSchema);
        if (job?.status !== from) {
            return false;
        }
        const kept = omit(job, ['lease', 'executionName', 'retryAt', 'waitReason']);
        await transaction.set(path, jobDocSchema, { ...kept, ...changes, status: 'queued', ...stampOf(IMAGERY_WRITER, deps.clock.now()) });
        return true;
    });
}

/** A USGS wait whose `retryAt` has come (one without a time is due). */
function usgsWaitOver(job: JobDoc, now: Date): boolean {
    return job.retryAt === undefined || timestampToDate(job.retryAt) <= now;
}

/** A start that never got its execution's name (a run call that died with its instance). */
function staleStart(job: JobDoc, now: Date): boolean {
    return job.executionName === undefined && earlier(job.dispatchAt, new Date(now.getTime() - STARTING_STALE_MINUTES * MINUTE_MS));
}

function resumable(job: JobDoc, now: Date): boolean {
    return job.status === 'waiting_usgs' ? usgsWaitOver(job, now) : staleStart(job, now);
}

/** Step 1: due queued jobs dispatched; USGS waits past `retryAt` and stale starts back to `queued` first. */
export async function dispatchDue(deps: TickJobsDeps, cityId: string, now: Date): Promise<void> {
    for (const { id, data } of await jobsIn(deps, cityId, ['waiting_usgs', 'starting'])) {
        if (resumable(data, now)) {
            await requeue(deps, { cityId, jobId: id, from: data.status });
        }
    }
    for (const { id } of await jobsIn(deps, cityId, ['queued'])) {
        await dispatchJob(deps, cityId, id);
    }
}

type Ended =
    | { readonly kind: 'cancel' }
    | { readonly kind: 'fail'; readonly code: ApiErrorCode; readonly params?: Readonly<Record<string, string>> };
type LostAction = { readonly kind: 'wait' } | { readonly kind: 'requeue'; readonly machine?: 'xl' } | Ended;

function attemptsOf(job: JobDoc): number {
    return job.attempt ?? 0;
}

/** A lost execution that failed: again (on `xl` after running out of memory on `std`), or failed for good. */
function retryOrFail(job: JobDoc, status: ExecutionStatus): LostAction {
    if (status.failure === 'oom' && job.machine === 'xl') {
        return { kind: 'fail', code: 'apiError.imagery.outOfMemory' };
    }
    if (attemptsOf(job) >= JOB_MAX_ATTEMPTS) {
        return { kind: 'fail', code: 'apiError.imagery.attemptsExhausted', params: { attempts: String(attemptsOf(job)) } };
    }
    return status.failure === 'oom' ? { kind: 'requeue', machine: 'xl' } : { kind: 'requeue' };
}

/** What a running job whose lease lapsed needs, by its execution's outcome. */
export function lostAction(job: JobDoc, status: ExecutionStatus): LostAction {
    if (status.state === 'running') {
        return { kind: 'wait' };
    }
    if (status.state === 'cancelled' || job.cancelRequested === true) {
        return { kind: 'cancel' };
    }
    return retryOrFail(job, status);
}

async function executionOf(deps: TickJobsDeps, job: JobDoc): Promise<ExecutionStatus> {
    return job.executionName === undefined ? { state: 'failed', failure: 'exit' } : deps.jobs.get(job.executionName);
}

function endingOf(action: Ended): Ending {
    if (action.kind === 'cancel') {
        return { status: 'cancelled', versionState: 'cancelled', by: IMAGERY_WRITER };
    }
    const params = action.params === undefined ? {} : { params: action.params };
    return { status: 'failed', versionState: 'failed', by: IMAGERY_WRITER, error: { code: action.code, ...params } };
}

/** Back to `queued` (on `xl` after an out-of-memory exit), then dispatched at once. */
async function runAgain(deps: TickJobsDeps, cityId: string, jobId: string, machine: 'xl' | undefined): Promise<void> {
    if (await requeue(deps, { cityId, jobId, from: 'running' }, machine === undefined ? {} : { machine })) {
        await dispatchJob(deps, cityId, jobId);
    }
}

async function recover(deps: TickJobsDeps, cityId: string, jobId: string, job: JobDoc): Promise<void> {
    const action = lostAction(job, await executionOf(deps, job));
    deps.log.warn('lost pipeline execution', { cityId, jobId, action: action.kind });
    if (action.kind === 'requeue') {
        await runAgain(deps, cityId, jobId, action.machine);
        return;
    }
    if (action.kind !== 'wait') {
        await endWork(deps, cityId, jobId, endingOf(action));
    }
}

function leaseLapsed(job: JobDoc, now: Date): boolean {
    return job.lease === undefined || timestampToDate(job.lease.until) < now;
}

/** Step 2: running jobs whose lease lapsed (no heartbeat): their execution is asked how it ended. */
export async function recoverLost(deps: TickJobsDeps, cityId: string, now: Date): Promise<void> {
    for (const { id, data } of await jobsIn(deps, cityId, ['running'])) {
        if (leaseLapsed(data, now)) {
            await recover(deps, cityId, id, data);
        }
    }
}

/** A job a cancellation still ends at once: waiting, or a publish that has not reached Mapbox. */
function endsAtOnce(job: JobDoc): boolean {
    return WAITING.has(job.status) || beforeMapbox(job);
}

/** Cancellations a lost event left behind (a waiting job whose admin asked it to stop). */
export async function cancelAsked(deps: TickJobsDeps, cityId: string): Promise<void> {
    const asked = await deps.documents.query(FIRESTORE_PATHS.jobs(cityId), jobDocSchema, { where: [['cancelRequested', '==', true]] });
    for (const { id } of asked.documents.filter((job) => endsAtOnce(job.data))) {
        await cancelJob(deps, cityId, id);
    }
}

/** Approvals a lost event never evaluated (a rendered version without its estimate). */
export async function pendingApprovals(deps: TickJobsDeps, cityId: string): Promise<void> {
    for (const { id, data } of await jobsIn(deps, cityId, ['awaiting_approval'])) {
        const version = await deps.documents.get(FIRESTORE_PATHS.layerVersion(cityId, versionIdOf(id, data)), layerVersionDocSchema);
        if (version?.state === 'awaiting_approval' && version.estimate === undefined) {
            await applyApprovalPolicy(deps, cityId, id);
        }
    }
}

/**
 * Step 3: MTS jobs whose poll went missing are polled again (a publish that never reached Mapbox is started again). The
 * task is named after the job's last write (`stale-<ms>`), so a job that stays stale is queued once, not on every tick;
 * each start counts an attempt on the job (which moves its stamp), so the recovery ends at `PUBLISH_MAX_ATTEMPTS`.
 */
export async function pollStale(deps: TickJobsDeps, cityId: string, now: Date): Promise<void> {
    const limit = new Date(now.getTime() - POLL_STALE_MS);
    for (const { id, data } of await jobsIn(deps, cityId, ['mts_processing'])) {
        if (earlier(data.updatedAt, limit)) {
            const task =
                data.mapboxJobId === undefined ? { cityId, jobId: id } : { cityId, jobId: id, phase: 'poll' as const, poll: LAST_POLL };
            await enqueuePublish(deps.tasks, task, `stale-${String(timestampToDate(data.updatedAt).getTime())}`);
        }
    }
}
