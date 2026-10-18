import '../global-options.js';

import {
    FIRESTORE_PATHS,
    LAYER_DELETE_GRACE_DAYS,
    jobDocSchema,
    layerDocSchema,
    timestampFromDate,
    type CallableRequest,
    type CallableResponse,
    type JobDoc,
    type JobStatus,
    type LayerDeleteParams,
    type LayerDoc,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { ApiError } from '../api/api-error.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import { compact } from '../api/objects.js';
import type { DocumentTransaction } from '../ports/documents.js';
import type { Ports } from '../ports/index.js';

export type LayerDeleteDeps = Pick<Ports, 'documents' | 'clock' | 'log'>;

type Request = CallableRequest<'layers.delete'>;

const DAY_MS = 86_400_000;

/** A job in one of these states is done with its layer; any other one is still working on it. */
const FINISHED: ReadonlySet<JobStatus> = new Set<JobStatus>(['succeeded', 'failed', 'cancelled']);

/** The layer states in which the raster pipeline is working on the layer's tiles. */
const PROCESSING: ReadonlySet<LayerDoc['status']> = new Set<LayerDoc['status']>(['processing', 'awaiting_approval']);

/** `ld-<time>-<layer>` (at most 40 characters, `ID_PATTERN`): one deletion per layer and millisecond. */
function jobIdFor(layerId: string, now: Date): string {
    return `ld-${now.getTime().toString(36)}-${layerId.slice(0, 26)}`;
}

/** A layer whose pipeline job is not finished, or which the pipeline is processing, is not deleted (`layers.busy`). */
async function refuseWhileBusy(deps: LayerDeleteDeps, request: Request): Promise<void> {
    const jobs = await deps.documents.query(FIRESTORE_PATHS.jobs(request.cityId), jobDocSchema, {
        where: [['params.layerId', '==', request.layerId]],
    });
    if (jobs.documents.some((job) => !FINISHED.has(job.data.status))) {
        throw new ApiError('apiError.layers.busy');
    }
}

/**
 * What the `layer-delete` job deletes: the tileset the raster pipeline published for the layer (`mapbox.tilesetId`)
 * and its source. A layer linked to a tileset that existed before (`layers.link`) names none: the tileset stays in the
 * Mapbox account.
 */
function paramsOf(request: Request, layer: LayerDoc): LayerDeleteParams {
    return compact<LayerDeleteParams>({
        layerId: request.layerId,
        tilesetId: layer.mapbox?.tilesetId,
        sourceSha: layer.mapbox?.publishedSourceSha,
    });
}

interface Deletion {
    readonly request: Request;
    readonly caller: VerifiedCaller;
    readonly now: Date;
    readonly runsAt: Date;
    readonly jobId: string;
}

function jobOf(deletion: Deletion, layer: LayerDoc): JobDoc {
    const now = timestampFromDate(deletion.now);
    return {
        type: 'layer-delete',
        status: 'queued',
        params: paramsOf(deletion.request, layer),
        createdBy: deletion.caller.uid,
        createdAt: now,
        dispatchAt: timestampFromDate(deletion.runsAt),
        updatedBy: deletion.caller.uid,
        updatedAt: now,
    };
}

/** In one transaction: the layer goes (the history trigger keeps it whole) and its `layer-delete` job waits. */
async function deleteAndQueue(transaction: DocumentTransaction, deletion: Deletion): Promise<void> {
    const { cityId, layerId } = deletion.request;
    const path = FIRESTORE_PATHS.layer(cityId, layerId);
    const layer = await transaction.get(path, layerDocSchema);
    if (layer === undefined) {
        throw new ApiError('apiError.notFound');
    }
    if (PROCESSING.has(layer.status)) {
        throw new ApiError('apiError.layers.busy');
    }
    await transaction.delete(path);
    await transaction.create(FIRESTORE_PATHS.job(cityId, deletion.jobId), jobDocSchema, jobOf(deletion, layer));
}

/**
 * `layers.delete` (admins; `docs/research/M2c-interfaces.md` §8.4, CR-M2c-3; S-A33-HAPPY-LAYER): deletes the layer
 * document and queues a `layer-delete` job that may run `LAYER_DELETE_GRACE_DAYS` later (the raster pipeline's
 * dispatcher runs it in M3, CR-M2c-13; a revert of the deletion before then cancels it, CR-M2c-5). A missing layer is
 * `apiError.notFound`; a layer the pipeline is working on is `apiError.layers.busy`.
 */
async function layersDelete(deps: LayerDeleteDeps, caller: VerifiedCaller, request: Request): Promise<CallableResponse<'layers.delete'>> {
    await refuseWhileBusy(deps, request);
    const now = deps.clock.now();
    const runsAt = new Date(now.getTime() + LAYER_DELETE_GRACE_DAYS * DAY_MS);
    const deletion: Deletion = { request, caller, now, runsAt, jobId: jobIdFor(request.layerId, now) };
    await deps.documents.transaction((transaction) => deleteAndQueue(transaction, deletion));
    deps.log.info('layer deleted', { uid: caller.uid, cityId: request.cityId, layerId: request.layerId, jobId: deletion.jobId });
    return { jobId: deletion.jobId, runsAt: runsAt.toISOString() };
}

/** The `layers-delete` callable. */
export function layerDeleteFunction(getDeps: () => LayerDeleteDeps & CallableDeps) {
    return defineCallable('layers.delete', layersDelete, getDeps);
}
