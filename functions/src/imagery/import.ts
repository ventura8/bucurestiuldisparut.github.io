import '../global-options.js';

import {
    FIRESTORE_PATHS,
    layerDocSchema,
    layerLabelFor,
    usgsSceneDocSchema,
    yearOfDate,
    type CallableRequest,
    type CallableResponse,
    type UsgsSceneDoc,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { ApiError } from '../api/api-error.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import type { DocumentTransaction } from '../ports/documents.js';
import type { Ports } from '../ports/index.js';
import { refuseNewRasterJob } from './limits.js';
import { requireCity, stampOf } from './records.js';
import { markNotScanned } from './scene-rank.js';
import { requireUsgs, usgsDownloads, withUsgs } from './usgs-session.js';
import { createWork, jobIdFor, reserveLayerId, type NewWork } from './versions.js';

/**
 * `imagery.import` (admin; `docs/research/M3-interfaces.md` §1, §4.1; S-A12-*): the one click of the happy path. An
 * already scanned frame gets a `usgs-import` job and its layer version, under a layer id reserved from the version's
 * label, and the scene is marked imported, all in one transaction; the dispatcher starts the pipeline from there.
 */
export type ImportDeps = Pick<Ports, 'documents' | 'clock' | 'log' | 'secrets' | 'usgs' | 'scenes' | 'setup'>;

type Request = CallableRequest<'imagery.import'>;

async function requireScene(deps: ImportDeps, request: Request): Promise<UsgsSceneDoc> {
    const scene = await deps.documents.get(FIRESTORE_PATHS.usgsScene(request.cityId, request.entityId), usgsSceneDocSchema);
    if (scene === undefined) {
        throw new ApiError('apiError.notFound');
    }
    return scene;
}

/** `apiError.imagery.alreadyImported` naming the layer (its label once it exists, else its reserved id). */
async function alreadyImported(deps: ImportDeps, cityId: string, layerId: string): Promise<ApiError> {
    const layer = await deps.documents.get(FIRESTORE_PATHS.layer(cityId, layerId), layerDocSchema);
    return new ApiError('apiError.imagery.alreadyImported', { layer: layer?.label.ro ?? layerId });
}

/**
 * USGS confirms the frame can be downloaded now (`download-options`), else `apiError.imagery.notScanned`, and the scene
 * records that it is not (no longer) free, so its card stops offering an Import that always fails (CR-M3-47).
 */
async function confirmScanned(deps: ImportDeps, cityId: string, scene: UsgsSceneDoc): Promise<void> {
    const options = await withUsgs(deps, (apiKey) => deps.scenes.downloadOptions(apiKey, scene.dataset, [scene.entityId]));
    if (!options.some((option) => option.entityId === scene.entityId && option.available)) {
        await markNotScanned(deps, cityId, scene.entityId);
        throw new ApiError('apiError.imagery.notScanned');
    }
}

/** In one transaction: the scene is still free, the job and its version are created, the scene is marked imported. */
async function importIn(transaction: DocumentTransaction, work: NewWork, scene: UsgsSceneDoc): Promise<void> {
    const path = FIRESTORE_PATHS.usgsScene(work.cityId, scene.entityId);
    const current = await transaction.get(path, usgsSceneDocSchema);
    if (current === undefined) {
        throw new ApiError('apiError.notFound');
    }
    if (current.status === 'imported' && current.layerId !== undefined) {
        throw new ApiError('apiError.imagery.alreadyImported', { layer: current.layerId });
    }
    const label = layerLabelFor(scene.sensor, scene.acquisitionDate);
    await createWork(transaction, work, {
        origin: 'usgs',
        source: {
            kind: 'usgs',
            entityId: scene.entityId,
            dataset: scene.dataset,
            sensor: scene.sensor,
            acquisitionDate: scene.acquisitionDate,
        },
        label,
        year: yearOfDate(scene.acquisitionDate),
        date: scene.acquisitionDate,
        sensor: scene.sensor,
    });
    await transaction.set(path, usgsSceneDocSchema, {
        ...current,
        status: 'imported',
        layerId: work.layerId,
        ...stampOf(work.createdBy, work.now),
    });
}

/** USGS must have approved downloads (the `download` role); before that only the search works. */
function refuseWithoutDownloads(usgs: Awaited<ReturnType<typeof requireUsgs>>): void {
    if (!usgsDownloads(usgs)) {
        throw new ApiError('apiError.usgs.accessPending');
    }
}

/** The scene, once it is known, not imported yet and already scanned, with USGS downloads approved. */
async function importableScene(deps: ImportDeps, request: Request): Promise<UsgsSceneDoc> {
    const usgs = await requireUsgs(deps.setup);
    const scene = await requireScene(deps, request);
    if (scene.status === 'imported' && scene.layerId !== undefined) {
        throw await alreadyImported(deps, request.cityId, scene.layerId);
    }
    if (!scene.downloadAvailable) {
        throw new ApiError('apiError.imagery.notScanned');
    }
    refuseWithoutDownloads(usgs);
    return scene;
}

async function imageryImport(deps: ImportDeps, caller: VerifiedCaller, request: Request): Promise<CallableResponse<'imagery.import'>> {
    await requireCity(deps.documents, request.cityId);
    const scene = await importableScene(deps, request);
    const now = deps.clock.now();
    await refuseNewRasterJob(deps.documents, now);
    await confirmScanned(deps, request.cityId, scene);
    const layerId = await reserveLayerId(deps.documents, request.cityId, layerLabelFor(scene.sensor, scene.acquisitionDate).ro);
    const jobId = jobIdFor('im', now, scene.entityId);
    const work: NewWork = {
        cityId: request.cityId,
        jobId,
        type: 'usgs-import',
        params: { entityId: scene.entityId, dataset: scene.dataset, sensor: scene.sensor },
        layerId,
        createdBy: caller.uid,
        now,
    };
    await deps.documents.transaction((transaction) => importIn(transaction, work, scene));
    deps.log.info('usgs scene imported', { uid: caller.uid, cityId: request.cityId, entityId: scene.entityId, jobId, layerId });
    return { jobId, versionId: jobId, layerId };
}

/** The `imagery-import` callable. */
export function importFunction(getDeps: () => ImportDeps & CallableDeps) {
    return defineCallable('imagery.import', imageryImport, getDeps);
}
