import '../global-options.js';

import {
    FIRESTORE_PATHS,
    MAPBOX_TILES_SCOPES,
    MTS_PRECISIONS,
    PUBLISH_MAX_ATTEMPTS,
    jobDocSchema,
    layerVersionDocSchema,
    publishTaskSchema,
    validate,
    type ApiErrorCode,
    type JobDoc,
    type LayerVersionDoc,
    type MtsPrecision,
    type PublishTask,
} from '@hcm/shared';
import { onTaskDispatched } from 'firebase-functions/tasks';

import { ApiError } from '../api/api-error.js';
import { runAs } from '../global-options.js';
import { UpstreamError, type UpstreamFailure } from '../ports/errors.js';
import { endWork } from './end.js';
import { finalizeVersion } from './finalize.js';
import { runGuard, type GuardStep } from './publish-guard.js';
import { loadPublishing, pollDelay, publishTileset, uploadAndPublish, type MtsDeps, type Publishing } from './publish-mts.js';
import { enqueuePublish } from './publish-queue.js';
import { tooLargeForMts } from './publish-studio.js';
import { IMAGERY_WRITER, appendJobLog, guardIsRed, stampOf, versionIdOf } from './records.js';

/**
 * `imagery.publish` (task queue `imagery-publish`; `docs/research/M3-interfaces.md` §7.2, §7.3; S-A42-*, S-P01-BAD-MTS-
 * FAILURE): one publish at a time. A `start` task of a publish that already reached Mapbox (its MTS job recorded) polls
 * it; otherwise, while the budget guard is green, it runs the compute-unit guard, then counts one attempt (at most
 * `PUBLISH_MAX_ATTEMPTS` in all: CR-M3-47) and uploads (unless done) and publishes. A `poll` task reads the MTS job:
 * still working → the next poll; success → the TileJSON smoke test and the finalize step; an internal Mapbox failure →
 * published once more; any other failure → the job fails with `apiError.imagery.mtsRefused`, the reservation released and
 * the layer's tiles unchanged. A file Mapbox refuses as too large goes back to the admin with the free Studio upload; a
 * transient failure (5xx, rate limit) is retried by Cloud Tasks.
 */
export type PublishDeps = MtsDeps;

/** Errors of a failed MTS job that say Mapbox itself failed (worth one more publish). */
const INTERNAL = /internal/i;

/** The job step that marks the one extra publish after an internal Mapbox failure. */
const RETRY_MARK = 'mts-retry';

/** Mapbox failures a retry cannot fix, and the error the admin reads for each. */
const PERMANENT: Readonly<Partial<Record<UpstreamFailure, () => ApiError>>> = {
    unauthorized: () => new ApiError('apiError.mapbox.tokenInvalid'),
    forbidden: () => new ApiError('apiError.mapbox.missingScopes', { scopes: MAPBOX_TILES_SCOPES.join(', ') }),
    invalid: () => new ApiError('apiError.imagery.mtsRefused'),
    notFound: () => new ApiError('apiError.imagery.mtsRefused'),
};

/** A failure that ends the publish (with its code and parameters), or undefined for one Cloud Tasks should retry. */
function permanent(error: unknown): ApiError | undefined {
    if (error instanceof ApiError) {
        return error;
    }
    return error instanceof UpstreamError && error.service === 'mapbox' ? PERMANENT[error.failure]?.() : undefined;
}

async function failPublish(deps: PublishDeps, task: PublishTask, failure: ApiError, detail: string): Promise<void> {
    const error = { code: failure.code, message: detail, ...(failure.params === undefined ? {} : { params: failure.params }) };
    await endWork(deps, task.cityId, task.jobId, { status: 'failed', versionState: 'failed', by: IMAGERY_WRITER, error });
    await appendJobLog(deps, task.cityId, task.jobId, { level: 'error', message: `${failure.code}: ${detail}` });
    deps.log.warn('publish failed', { cityId: task.cityId, jobId: task.jobId, code: failure.code });
}

interface Started {
    readonly job: JobDoc;
    readonly version: LayerVersionDoc;
    readonly versionId: string;
}

async function loadStart(deps: PublishDeps, task: PublishTask): Promise<Started | undefined> {
    const job = await deps.documents.get(FIRESTORE_PATHS.job(task.cityId, task.jobId), jobDocSchema);
    const versionId = versionIdOf(task.jobId, job ?? {});
    const version = await deps.documents.get(FIRESTORE_PATHS.layerVersion(task.cityId, versionId), layerVersionDocSchema);
    return job === undefined || version === undefined ? undefined : { job, version, versionId };
}

/**
 * While the budget guard is red an approved version waits, its job saying why (and stamped, so the tick's resume of this
 * pause has a task id of its own); the tick starts it again once the guard is green.
 */
async function pausedByGuard(deps: PublishDeps, task: PublishTask, job: JobDoc): Promise<void> {
    if (job.status === 'awaiting_approval') {
        const path = FIRESTORE_PATHS.job(task.cityId, task.jobId);
        await deps.documents.set(path, jobDocSchema, { ...job, waitReason: 'guard', ...stampOf(IMAGERY_WRITER, deps.clock.now()) });
    }
    deps.log.info('publish paused by the budget guard', { cityId: task.cityId, jobId: task.jobId });
}

/** The budget guard first (nothing reaches Mapbox while it is red), then the compute-unit guard. */
async function guardStep(deps: PublishDeps, task: PublishTask, started: Started): Promise<GuardStep> {
    if (await guardIsRed(deps.documents)) {
        await pausedByGuard(deps, task, started.job);
        return 'wait';
    }
    return runGuard(deps, task.cityId, task.jobId, { id: started.versionId, layerId: started.version.layerId });
}

type Claim = { readonly kind: 'go' } | { readonly kind: 'gone' } | { readonly kind: 'exhausted'; readonly attempts: number };

/** In one transaction: one more attempt counted on the job, or none left (`PUBLISH_MAX_ATTEMPTS`). */
async function claimAttempt(deps: PublishDeps, task: PublishTask): Promise<Claim> {
    const path = FIRESTORE_PATHS.job(task.cityId, task.jobId);
    return deps.documents.transaction(async (transaction): Promise<Claim> => {
        const job = await transaction.get(path, jobDocSchema);
        if (job?.status !== 'mts_processing') {
            return { kind: 'gone' };
        }
        const attempts = (job.publishAttempts ?? 0) + 1;
        if (attempts > PUBLISH_MAX_ATTEMPTS) {
            return { kind: 'exhausted', attempts: attempts - 1 };
        }
        await transaction.set(path, jobDocSchema, { ...job, publishAttempts: attempts, ...stampOf(IMAGERY_WRITER, deps.clock.now()) });
        return { kind: 'go' };
    });
}

/** One counted attempt at the upload and the publish (a job out of attempts fails instead). */
async function attemptPublish(deps: PublishDeps, task: PublishTask): Promise<void> {
    const claim = await claimAttempt(deps, task);
    if (claim.kind === 'exhausted') {
        const failure = new ApiError('apiError.imagery.attemptsExhausted', { attempts: String(claim.attempts) });
        await failPublish(deps, task, failure, `The publish was started ${String(claim.attempts)} times.`);
        return;
    }
    const work = claim.kind === 'go' ? await loadPublishing(deps, task.cityId, task.jobId) : undefined;
    if (work !== undefined) {
        await uploadAndPublish(deps, work, task.poll);
    }
}

/** The MTS job is still queued or processing: the job shows it was polled, and the next poll is queued. */
async function stillProcessing(deps: PublishDeps, work: Publishing, poll: number): Promise<void> {
    const next = poll + 1;
    await deps.documents.set(FIRESTORE_PATHS.job(work.cityId, work.jobId), jobDocSchema, {
        ...work.job,
        ...stampOf(IMAGERY_WRITER, deps.clock.now()),
    });
    await enqueuePublish(
        deps.tasks,
        { cityId: work.cityId, jobId: work.jobId, phase: 'poll', poll: next },
        `poll-${String(next)}`,
        pollDelay(next),
    );
}

/** The km² per precision an MTS job reports, every precision listed (0 for those it did not use). */
function precisionsOf(reported: Readonly<Record<string, number>> | undefined): Record<MtsPrecision, number> {
    return Object.fromEntries(MTS_PRECISIONS.map((precision) => [precision, Math.max(0, reported?.[precision] ?? 0)])) as Record<
        MtsPrecision,
        number
    >;
}

/** Success: the tiles must answer their TileJSON (the smoke test), then the layer gets them. */
async function succeed(deps: PublishDeps, work: Publishing, reported: Readonly<Record<string, number>> | undefined): Promise<void> {
    await deps.tilesets.tileJson(work.token, work.tilesetId);
    await finalizeVersion(deps, {
        cityId: work.cityId,
        jobId: work.jobId,
        versionId: work.version.jobId,
        origin: 'mts',
        tilesetId: work.tilesetId,
        sourceId: work.sourceId,
        precisions: precisionsOf(reported),
    });
}

/** A failed MTS job: an internal failure is published once more, anything else ends the publish. */
async function mtsFailed(deps: PublishDeps, work: Publishing, errors: readonly string[], task: PublishTask): Promise<void> {
    const detail = errors.join('; ').slice(0, 1000);
    if (!errors.some((error) => INTERNAL.test(error)) || work.job.steps?.[RETRY_MARK] !== undefined) {
        await failPublish(deps, task, new ApiError('apiError.imagery.mtsRefused'), detail);
        return;
    }
    const at = stampOf(IMAGERY_WRITER, deps.clock.now()).updatedAt;
    const job = { ...work.job, steps: { ...work.job.steps, [RETRY_MARK]: { status: 'done' as const, finishedAt: at } } };
    await appendJobLog(deps, task.cityId, task.jobId, {
        level: 'warn',
        step: 'tiles',
        message: `Mapbox failed internally (${detail}); publishing once more.`,
    });
    await publishTileset(deps, { ...work, job }, task.poll + 1);
}

/** The publish under way with its MTS job, or undefined when there is none to poll. */
async function polled(
    deps: PublishDeps,
    task: PublishTask,
): Promise<{ readonly work: Publishing; readonly mapboxJobId: string } | undefined> {
    const work = await loadPublishing(deps, task.cityId, task.jobId);
    const mapboxJobId = work?.job.mapboxJobId;
    return work === undefined || mapboxJobId === undefined ? undefined : { work, mapboxJobId };
}

/** `poll`: where the MTS job stands. */
async function pollMts(deps: PublishDeps, task: PublishTask): Promise<void> {
    const found = await polled(deps, task);
    if (found === undefined) {
        return;
    }
    const { work, mapboxJobId } = found;
    const result = await deps.tilesets.job(work.token, work.tilesetId, mapboxJobId);
    if (result.stage === 'success') {
        await succeed(deps, work, result.precisions);
        return;
    }
    await (result.stage === 'failed' ? mtsFailed(deps, work, result.errors, task) : stillProcessing(deps, work, task.poll));
}

/** `start`: a publish whose MTS job is known is polled; otherwise the guards, then one attempt. */
async function startPublish(deps: PublishDeps, task: PublishTask): Promise<void> {
    const started = await loadStart(deps, task);
    if (started === undefined) {
        return;
    }
    if (started.job.status === 'mts_processing' && started.job.mapboxJobId !== undefined) {
        await pollMts(deps, { ...task, phase: 'poll' });
        return;
    }
    if ((await guardStep(deps, task, started)) === 'publish') {
        await attemptPublish(deps, task);
    }
}

/** The codes that end a publish but leave a way out to the admin instead of a failure. */
const BACK_TO_ADMIN: ReadonlySet<ApiErrorCode> = new Set<ApiErrorCode>(['apiError.imagery.sourceTooLarge']);

/** A permanent failure: a file too large goes back to the admin with the Studio upload, anything else fails the job. */
async function ended(deps: PublishDeps, task: PublishTask, failure: ApiError, detail: string): Promise<void> {
    if (BACK_TO_ADMIN.has(failure.code) && (await tooLargeForMts(deps, task, failure))) {
        return;
    }
    await failPublish(deps, task, failure, detail);
}

/** One publish task; a permanent failure ends the publish, a transient one is rethrown for Cloud Tasks to retry. */
export async function runPublishTask(deps: PublishDeps, task: PublishTask): Promise<void> {
    try {
        await (task.phase === 'poll' ? pollMts(deps, task) : startPublish(deps, task));
    } catch (error) {
        const failure = permanent(error);
        if (failure === undefined) {
            throw error;
        }
        await ended(deps, task, failure, String(error));
    }
}

/**
 * The `imagery-publish` task queue: one dispatch at a time and at most two a minute (MTS allows about two publishes a
 * minute), five attempts with backoff, 30 minutes and 1 GiB for streaming a COG. A payload the schema refuses is logged
 * and dropped.
 */
export function publishFunction(getDeps: () => PublishDeps) {
    return onTaskDispatched(
        {
            retryConfig: { maxAttempts: 5, minBackoffSeconds: 60 },
            rateLimits: { maxConcurrentDispatches: 1, maxDispatchesPerSecond: 2 / 60 },
            memory: '1GiB',
            timeoutSeconds: 1800,
            maxInstances: 1,
            ...runAs('imagery.publish'),
        },
        async (request) => {
            const deps = getDeps();
            const task = validate(publishTaskSchema, request.data);
            if (!task.ok) {
                deps.log.error('publish task refused', { issues: task.issues.length });
                return;
            }
            await runPublishTask(deps, task.value);
        },
    );
}
