import '../global-options.js';

import {
    FIRESTORE_PATHS,
    JOB_MAX_ATTEMPTS,
    NOT_RETRYABLE_CODES,
    PUBLISH_MAX_ATTEMPTS,
    jobDocSchema,
    layerVersionDocSchema,
    type CallableRequest,
    type CallableResponse,
    type JobDoc,
    type LayerVersionDoc,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { ApiError } from '../api/api-error.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import { omit } from '../api/objects.js';
import type { DocumentTransaction } from '../ports/documents.js';
import type { Ports } from '../ports/index.js';
import { enqueuePublish } from './publish-queue.js';
import { guardIsRed, requireJob, stampOf, versionIdOf, type Stamp } from './records.js';

/**
 * `imagery.retry` (admin; `docs/research/M3-interfaces.md` §4.5): a failed raster job again, from its first unfinished
 * step. A pipeline failure goes back to `queued` with its failed steps `pending` (the finished ones are skipped by their
 * recorded outputs; the dispatcher starts a new execution); a failure after approval goes back to the publisher, never
 * to Cloud Run, its MTS job and publish steps cleared (the upload is kept: the same file is not sent twice). At most
 * `JOB_MAX_ATTEMPTS` executions and `PUBLISH_MAX_ATTEMPTS` publish starts in all; never while the budget guard is red;
 * never a job without its version (an upload the server refused: there is nothing to run) nor a failure no retry can
 * cure (a Mapbox token or its scopes: Setup's Mapbox step; out of memory on the large machine) (CR-M3-47).
 */
export type RetryDeps = Pick<Ports, 'documents' | 'clock' | 'log' | 'tasks'>;

type Request = CallableRequest<'imagery.retry'>;

/** Failures no retry cures: the admin fixes the cause first (Setup's Mapbox step), or the frame cannot be processed. */
const NOT_RETRYABLE: ReadonlySet<string> = new Set(NOT_RETRYABLE_CODES);

/** A version that was approved failed while publishing: the retry is the publisher's. */
function failedAtPublish(job: JobDoc, version: LayerVersionDoc | undefined): boolean {
    return job.type === 'republish' || version?.approval !== undefined;
}

/** The attempts a retry would add to: the publish starts after approval, the executions before. */
function requireAttemptsLeft(job: JobDoc, version: LayerVersionDoc): void {
    const [attempts, max] = failedAtPublish(job, version)
        ? [job.publishAttempts ?? 0, PUBLISH_MAX_ATTEMPTS]
        : [job.attempt ?? 0, JOB_MAX_ATTEMPTS];
    if (attempts >= max) {
        throw new ApiError('apiError.imagery.attemptsExhausted', { attempts: String(attempts) });
    }
}

/** A failure a retry may cure (none recorded counts as one). */
function curable(job: JobDoc): boolean {
    return job.error === undefined || !NOT_RETRYABLE.has(job.error.code);
}

/** A failed raster job, made with its version (a refused upload has none), whose failure a retry may cure. */
function retryable(job: JobDoc, version: LayerVersionDoc | undefined): version is LayerVersionDoc {
    return job.status === 'failed' && job.type !== 'layer-delete' && version !== undefined && curable(job);
}

/** A failed raster job with its version, whose failure a retry may cure. */
async function requireFailedWork(deps: RetryDeps, request: Request): Promise<{ job: JobDoc; version: LayerVersionDoc }> {
    const job = await requireJob(deps.documents, request.cityId, request.jobId);
    const path = FIRESTORE_PATHS.layerVersion(request.cityId, versionIdOf(request.jobId, job));
    const version = await deps.documents.get(path, layerVersionDocSchema);
    if (!retryable(job, version)) {
        throw new ApiError('apiError.imagery.versionState');
    }
    return { job, version };
}

/** The job may be retried: failed with its version, a raster type, a curable failure, attempts left, the guard green. */
async function requireRetryable(deps: RetryDeps, request: Request): Promise<JobDoc> {
    const { job, version } = await requireFailedWork(deps, request);
    requireAttemptsLeft(job, version);
    if (await guardIsRed(deps.documents)) {
        throw new ApiError('apiError.guardPaused');
    }
    return job;
}

/** The failed steps become `pending` again; the others keep what they recorded. */
function reopenedSteps(job: JobDoc): JobDoc['steps'] {
    const steps = Object.entries(job.steps ?? {}).map(([name, step]) => [
        name,
        step.status === 'failed' ? { status: 'pending' as const } : step,
    ]);
    return Object.fromEntries(steps) as JobDoc['steps'];
}

/** The publisher's steps a publish retry runs again (the upload is kept: its file is not sent twice). */
const PUBLISH_AGAIN = ['publish', 'tiles', 'finalize', 'mts-retry'] as const;

/** A publish retry starts with no MTS job and its publish steps cleared. */
function publishReopened(job: JobDoc): Pick<JobDoc, 'steps'> {
    return { steps: omit(reopenedSteps(job) ?? {}, PUBLISH_AGAIN) };
}

function retriedJob(job: JobDoc, atPublish: boolean, stamp: Stamp): JobDoc {
    const kept = omit(job, ['error', 'finishedAt', 'lease', 'retryAt', 'executionName', 'mapboxJobId']);
    if (atPublish) {
        return { ...kept, status: 'awaiting_approval', waitReason: 'approval', ...publishReopened(job), ...stamp };
    }
    return { ...kept, status: 'queued', steps: reopenedSteps(job), ...stamp };
}

function retriedVersion(version: LayerVersionDoc, atPublish: boolean, stamp: Stamp): LayerVersionDoc {
    return { ...omit(version, ['error']), state: atPublish ? 'approved' : 'processing', ...stamp };
}

async function retryIn(transaction: DocumentTransaction, request: Request, stamp: Stamp): Promise<{ job: JobDoc; atPublish: boolean }> {
    const jobPath = FIRESTORE_PATHS.job(request.cityId, request.jobId);
    const job = await transaction.get(jobPath, jobDocSchema);
    if (job?.status !== 'failed') {
        throw new ApiError('apiError.imagery.versionState');
    }
    const versionPath = FIRESTORE_PATHS.layerVersion(request.cityId, versionIdOf(request.jobId, job));
    const version = await transaction.get(versionPath, layerVersionDocSchema);
    const atPublish = failedAtPublish(job, version);
    const retried = retriedJob(job, atPublish, stamp);
    await transaction.set(jobPath, jobDocSchema, retried);
    if (version?.state === 'failed') {
        await transaction.set(versionPath, layerVersionDocSchema, retriedVersion(version, atPublish, stamp));
    }
    return { job: retried, atPublish };
}

async function imageryRetry(deps: RetryDeps, caller: VerifiedCaller, request: Request): Promise<CallableResponse<'imagery.retry'>> {
    await requireRetryable(deps, request);
    const now = deps.clock.now();
    const { job, atPublish } = await deps.documents.transaction((transaction) => retryIn(transaction, request, stampOf(caller.uid, now)));
    if (atPublish) {
        await enqueuePublish(deps.tasks, { cityId: request.cityId, jobId: request.jobId }, `retry-${String(now.getTime())}`);
    }
    deps.log.info('raster job retried', { uid: caller.uid, cityId: request.cityId, jobId: request.jobId, atPublish });
    return { status: job.status, attempt: job.attempt ?? 0 };
}

/** The `imagery-retry` callable. */
export function retryFunction(getDeps: () => RetryDeps & CallableDeps) {
    return defineCallable('imagery.retry', imageryRetry, getDeps);
}
