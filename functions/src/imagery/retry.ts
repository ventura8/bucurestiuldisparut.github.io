import '../global-options.js';

import {
    FIRESTORE_PATHS,
    JOB_MAX_ATTEMPTS,
    JOB_STEPS,
    NOT_RETRYABLE_CODES,
    PUBLISH_MAX_ATTEMPTS,
    jobDocSchema,
    layerVersionDocSchema,
    type CallableRequest,
    type CallableResponse,
    type JobDoc,
    type JobStep,
    type LayerVersionDoc,
    type LayerVersionState,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { ApiError } from '../api/api-error.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import { omit } from '../api/objects.js';
import type { DocumentTransaction } from '../ports/documents.js';
import type { Ports } from '../ports/index.js';
import { GO, partsReady } from './join-parts.js';
import { enqueuePublish } from './publish-queue.js';
import { guardIsRed, requireJob, stampOf, versionIdOf, type Stamp } from './records.js';

/**
 * `imagery.retry` (admin; `docs/research/M3-interfaces.md` §4.5): a failed raster job again, from its first unfinished
 * step. A pipeline failure goes back to `queued` with its failed steps `pending` (the finished ones are skipped by their
 * recorded outputs; the dispatcher starts a new execution); a failure after approval goes back to the publisher, never
 * to Cloud Run, its MTS job and publish steps cleared (the upload is kept: the same file is not sent twice). At most
 * `JOB_MAX_ATTEMPTS` executions and `PUBLISH_MAX_ATTEMPTS` publish starts in all; never while the budget guard is red;
 * never a job without its version (an upload the server refused: there is nothing to run) nor a failure no retry can
 * cure (a Mapbox token or its scopes: Setup's Mapbox step; out of memory on the large machine) (CR-M3-47); never a version
 * that ended otherwise: a dismissed one gave its scene and its scratch files back, and a retry would make a layer no scene
 * knows (finding of 2026-11-06; S-A12-BAD-RETRY-DISMISSED). A version still `processing` under a failed job is a stranded run
 * (the runner's second write did not arrive): the retry is the way out, as neither Dismiss nor Cancel takes it
 * (S-A12-BAD-STRANDED-VERSION). Checked again in the transaction that retries. M8 (`docs/research/M8-join-interfaces.md` §5): a
 * failed join freed its frames, so its retry asks whether they are still its own (a newer join, new points or a publish of its
 * own may have taken one: `apiError.imagery.joinPartGone`), and it goes back waiting for them, so no worker can claim it before the
 * dispatcher looked; a publish retry needs them all still there.
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

/**
 * The states a retry may bring a version back from: failed; processing under a failed job, a stranded run (`_fail_job`
 * writes the job first); or approved or publishing for a publish retry (the schema gives those two an approval, so
 * `failedAtPublish` holds); never one dismissed or otherwise ended.
 */
const REVIVABLE: ReadonlySet<LayerVersionState> = new Set<LayerVersionState>(['failed', 'processing', 'approved', 'publishing']);

function revivable(version: LayerVersionDoc | undefined): version is LayerVersionDoc {
    return version !== undefined && REVIVABLE.has(version.state);
}

/** A failed raster job, made with its version (a refused upload has none), whose failure a retry may cure. */
function retryable(job: JobDoc, version: LayerVersionDoc | undefined): version is LayerVersionDoc {
    return job.status === 'failed' && job.type !== 'layer-delete' && revivable(version) && curable(job);
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

/** The failed steps become `pending` again; the others keep what they recorded (a publish retry: the render stands). */
function reopenedSteps(job: JobDoc): JobDoc['steps'] {
    const steps = Object.entries(job.steps ?? {}).map(([name, step]) => [
        name,
        step.status === 'failed' ? { status: 'pending' as const } : step,
    ]);
    return Object.fromEntries(steps) as JobDoc['steps'];
}

/**
 * What a pipeline retry keeps, the first of these that is finished (finding 78 of 2026-11-03): the city crop (the delivery
 * is gone after it), an upload's inspection, the unpacked segments, the delivery (a long download). Every step after it
 * runs again, so a pipeline updated since the failure redoes its own results: the 1972 frame's retry kept the wrongly
 * joined frame of the pipeline before the fix.
 */
const KEPT_BY_A_RETRY: readonly JobStep[] = ['locate', 'inspect', 'extract', 'fetch'];

function finished(job: JobDoc, step: string): boolean {
    const status = job.steps?.[step]?.status;
    return status === 'done' || status === 'skipped';
}

/** The steps after what a retry keeps become `pending` again; the kept ones and those before them stay as recorded. */
function rerunSteps(job: JobDoc): JobDoc['steps'] {
    const order: readonly string[] = JOB_STEPS[job.type];
    const kept = order.indexOf(KEPT_BY_A_RETRY.find((step) => finished(job, step)) ?? '');
    const steps = Object.entries(job.steps ?? {}).map(([name, step]) => [
        name,
        order.indexOf(name) > kept ? { status: 'pending' as const } : step,
    ]);
    return Object.fromEntries(steps) as JobDoc['steps'];
}

/** The publisher's steps a publish retry runs again (the upload is kept: its file is not sent twice). */
const PUBLISH_AGAIN = ['publish', 'tiles', 'finalize', 'mts-retry'] as const;

/** A publish retry starts with no MTS job and its publish steps cleared. */
function publishReopened(job: JobDoc): Pick<JobDoc, 'steps'> {
    return { steps: omit(reopenedSteps(job) ?? {}, PUBLISH_AGAIN) };
}

/** M8: a join goes back waiting for its frames, as `imagery.join` leaves it: a worker claims nothing the dispatcher did not see ready. */
function queuedAgain(job: JobDoc): Pick<JobDoc, 'waitReason'> {
    return job.type === 'layer-join' ? { waitReason: 'parts' } : {};
}

function retriedJob(job: JobDoc, atPublish: boolean, stamp: Stamp): JobDoc {
    const kept = omit(job, ['error', 'finishedAt', 'lease', 'retryAt', 'executionName', 'mapboxJobId']);
    if (atPublish) {
        return { ...kept, status: 'awaiting_approval', waitReason: 'approval', ...publishReopened(job), ...stamp };
    }
    return { ...kept, status: 'queued', ...queuedAgain(job), steps: rerunSteps(job), ...stamp };
}

/** M8: a join's frames are still its own; a publish retry cannot wait, so it needs them all ready now. */
async function requireJoinFrames(transaction: DocumentTransaction, request: Request, job: JobDoc, atPublish: boolean): Promise<void> {
    const ready = job.type === 'layer-join' ? await partsReady(transaction, request.cityId, request.jobId, job) : GO;
    if (ready.kind === 'gone') {
        throw new ApiError('apiError.imagery.joinPartGone', { frame: ready.frame });
    }
    if (atPublish && ready.kind === 'hold') {
        throw new ApiError('apiError.imagery.versionState');
    }
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
    if (!revivable(version)) {
        throw new ApiError('apiError.imagery.versionState');
    }
    const atPublish = failedAtPublish(job, version);
    await requireJoinFrames(transaction, request, job, atPublish);
    const retried = retriedJob(job, atPublish, stamp);
    await transaction.set(jobPath, jobDocSchema, retried);
    if (version.state === 'failed') {
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
