/**
 * A deleted layer's clean-up (`docs/research/M3-interfaces.md` §4.6 step 5, §7.6; CR-M2c-13; S-A33-HAPPY-TILESET-DELETED):
 * `layers.delete` queued a `layer-delete` job that may run once its grace has passed. When the layer is back (a revert
 * from History) the job is cancelled; while an unfinished version holds the layer's id (it should not, the id stays
 * reserved during the grace: CR-M3-47) the job waits for it to end, since the tileset id is the layer's; otherwise the
 * tileset and its source are deleted at Mapbox (a missing one is fine; a tileset of another account is never touched),
 * the files of the deleted layer's own versions (those made before the deletion) go, and the job succeeds. A failure is
 * tried again on the next tick, at most `JOB_MAX_ATTEMPTS` times.
 */
import {
    ENDED_VERSION_STATES,
    FIRESTORE_PATHS,
    JOB_MAX_ATTEMPTS,
    jobDocSchema,
    layerDeleteParamsSchema,
    layerDocSchema,
    layerVersionDocSchema,
    tilesetName,
    timestampToDate,
    validate,
    type ApiErrorCode,
    type JobDoc,
    type LayerDeleteParams,
    type LayerVersionDoc,
    type LayerVersionState,
} from '@hcm/shared';

import { ApiError } from '../api/api-error.js';
import { omit } from '../api/objects.js';
import type { StoredDocument } from '../ports/documents.js';
import type { Ports } from '../ports/index.js';
import { IMAGERY_WRITER, appendJobLog, requireMapboxUser, requireTilesToken, stampOf, withStep } from './records.js';

export type LayerDeleteDeps = Pick<Ports, 'documents' | 'clock' | 'log' | 'secrets' | 'setup' | 'tilesets' | 'blobs'>;

export type DeleteOutcome = 'succeeded' | 'cancelled' | 'waiting' | 'retry' | 'failed' | 'skipped';

const ENDED: ReadonlySet<LayerVersionState> = new Set(ENDED_VERSION_STATES);

function graceOver(job: JobDoc, now: Date): boolean {
    return job.dispatchAt === undefined || timestampToDate(job.dispatchAt) <= now;
}

/** A due deletion: queued, past its grace. */
function isDue(job: JobDoc | undefined, now: Date): job is JobDoc {
    return job?.type === 'layer-delete' && job.status === 'queued' && graceOver(job, now);
}

/** The tileset and its source at Mapbox, when the layer had one of the city's own account. */
async function deleteTileset(deps: LayerDeleteDeps, cityId: string, params: LayerDeleteParams): Promise<void> {
    if (params.tilesetId === undefined) {
        return;
    }
    const [user, token] = [await requireMapboxUser(deps.setup), await requireTilesToken(deps.secrets)];
    if (!params.tilesetId.startsWith(`${user}.`)) {
        deps.log.warn('tileset of another account left alone', { cityId, layerId: params.layerId });
        return;
    }
    await deps.tilesets.deleteTileset(token, params.tilesetId);
    await deps.tilesets.deleteSource(user, token, tilesetName(cityId, params.layerId));
}

/** The versions that carry the layer's id. */
async function versionsOf(deps: LayerDeleteDeps, cityId: string, layerId: string): Promise<readonly StoredDocument<LayerVersionDoc>[]> {
    const versions = await deps.documents.query(FIRESTORE_PATHS.layerVersions(cityId), layerVersionDocSchema, {
        where: [['layerId', '==', layerId]],
    });
    return versions.documents;
}

/** The files of the deleted layer's own versions (`rasters/{city}/{layer}/{version}/…`, made before the deletion). */
async function deleteFiles(deps: LayerDeleteDeps, cityId: string, job: JobDoc, versions: readonly StoredDocument<LayerVersionDoc>[]) {
    const deletedAt = timestampToDate(job.createdAt).getTime();
    const own = versions.filter((version) => timestampToDate(version.data.createdAt).getTime() <= deletedAt);
    let count = 0;
    for (const version of own) {
        const paths = await deps.blobs.list('private', `rasters/${cityId}/${version.data.layerId}/${version.id}/`);
        await Promise.all(paths.map((path) => deps.blobs.delete('private', path)));
        count += paths.length;
    }
    return count;
}

async function finish(deps: LayerDeleteDeps, path: string, job: JobDoc, status: 'succeeded' | 'cancelled'): Promise<void> {
    const stamp = stampOf(IMAGERY_WRITER, deps.clock.now());
    const done = status === 'succeeded' ? withStep(job, 'delete', 'done', stamp.updatedAt) : job;
    await deps.documents.set(path, jobDocSchema, { ...omit(done, ['error']), status, finishedAt: stamp.updatedAt, ...stamp });
}

/** A failed attempt: tried again on the next tick, or failed for good after `JOB_MAX_ATTEMPTS`. */
async function failedAttempt(deps: LayerDeleteDeps, path: string, job: JobDoc, error: unknown): Promise<DeleteOutcome> {
    const attempt = (job.attempt ?? 0) + 1;
    const code: ApiErrorCode = error instanceof ApiError ? error.code : 'apiError.mapbox.unavailable';
    const stamp = stampOf(IMAGERY_WRITER, deps.clock.now());
    const failed = { code, message: code };
    if (attempt < JOB_MAX_ATTEMPTS) {
        await deps.documents.set(path, jobDocSchema, { ...job, attempt, error: failed, ...stamp });
        return 'retry';
    }
    await deps.documents.set(path, jobDocSchema, {
        ...job,
        attempt,
        status: 'failed',
        finishedAt: stamp.updatedAt,
        error: failed,
        ...stamp,
    });
    return 'failed';
}

/** The params of a due deletion, or undefined (not due, not a deletion, params the schema refuses). */
function dueParams(job: JobDoc | undefined, now: Date): { readonly job: JobDoc; readonly params: LayerDeleteParams } | undefined {
    const params = validate(layerDeleteParamsSchema, job?.params);
    return isDue(job, now) && params.ok ? { job, params: params.value } : undefined;
}

/** Runs one due `layer-delete` job. */
export async function runLayerDelete(deps: LayerDeleteDeps, cityId: string, jobId: string): Promise<DeleteOutcome> {
    const path = FIRESTORE_PATHS.job(cityId, jobId);
    const due = dueParams(await deps.documents.get(path, jobDocSchema), deps.clock.now());
    if (due === undefined) {
        return 'skipped';
    }
    const { job, params } = due;
    if ((await deps.documents.get(FIRESTORE_PATHS.layer(cityId, params.layerId), layerDocSchema)) !== undefined) {
        await finish(deps, path, job, 'cancelled');
        return 'cancelled';
    }
    const versions = await versionsOf(deps, cityId, params.layerId);
    if (versions.some((version) => !ENDED.has(version.data.state))) {
        deps.log.warn('layer deletion waits for a version of the same id', { cityId, jobId, layerId: params.layerId });
        return 'waiting';
    }
    try {
        await deleteTileset(deps, cityId, params);
        const files = await deleteFiles(deps, cityId, job, versions);
        await finish(deps, path, job, 'succeeded');
        await appendJobLog(deps, cityId, jobId, { level: 'info', step: 'delete', message: `Tileset and ${String(files)} files deleted.` });
        return 'succeeded';
    } catch (error) {
        deps.log.warn('layer deletion failed', { cityId, jobId, error: String(error) });
        return failedAttempt(deps, path, job, error);
    }
}
