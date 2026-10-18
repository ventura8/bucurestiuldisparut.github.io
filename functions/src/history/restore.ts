/**
 * What restoring a deleted document must not get wrong (`docs/research/M2c-interfaces.md` §8.4, §6.6; CR-M2c-5): a
 * restored layer or photo never points at files that are gone.
 *
 * - A deleted layer waits `LAYER_DELETE_GRACE_DAYS` before its `layer-delete` job removes the Mapbox tileset. Restoring
 *   it within the grace sets that waiting job `cancelled` in the same transaction; once a job succeeded, the tiles are
 *   gone and the revert answers `apiError.history.layerGone` (S-A23-BAD-LAYER-GONE).
 * - A deleted photo's public derivatives are swept once no manifest names them. Restoring it after the sweep puts it
 *   back `pending` and processes it again from its kept original, as `photos.reprocess` does
 *   (S-A23-BAD-RESTORE-AFTER-SWEEP). The steps are written here: a feature folder reaches another only through
 *   `ports/`, `api/` and `@hcm/shared` (dependency-cruiser `functions-feature-folders-independent`).
 */
import {
    FIRESTORE_PATHS,
    STORAGE_PATHS,
    jobDocSchema,
    photoDocSchema,
    timestampFromDate,
    type AuditedDocument,
    type JobDoc,
    type PhotoDoc,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { ApiError } from '../api/api-error.js';
import { omit } from '../api/objects.js';
import type { DocumentTransaction } from '../ports/documents.js';
import type { Ports } from '../ports/index.js';

export type RestoreDeps = Pick<Ports, 'documents' | 'blobs' | 'clock' | 'log'>;

const FINISHED: ReadonlySet<JobDoc['status']> = new Set(['succeeded', 'failed', 'cancelled']);

/**
 * The `layer-delete` jobs of a layer about to be restored: refused once one succeeded (its tiles are gone); the paths of
 * those still waiting otherwise, which the revert's transaction cancels.
 */
export async function waitingLayerDeletes(deps: Pick<RestoreDeps, 'documents'>, audited: AuditedDocument): Promise<readonly string[]> {
    if (audited.entity !== 'layer') {
        return [];
    }
    const jobs = await deps.documents.query(FIRESTORE_PATHS.jobs(audited.cityId), jobDocSchema, {
        where: [
            ['type', '==', 'layer-delete'],
            ['params.layerId', '==', audited.entityId],
        ],
    });
    if (jobs.documents.some((job) => job.data.status === 'succeeded')) {
        throw new ApiError('apiError.history.layerGone');
    }
    return jobs.documents.filter((job) => !FINISHED.has(job.data.status)).map((job) => job.path);
}

/** Inside the revert's transaction, after its reads: each waiting job of the restored layer ends `cancelled`. */
export async function cancelLayerDeletes(
    transaction: DocumentTransaction,
    paths: readonly string[],
    stamp: { readonly caller: VerifiedCaller; readonly now: Date },
): Promise<void> {
    const jobs = await Promise.all(paths.map(async (path) => ({ path, job: await transaction.get(path, jobDocSchema) })));
    for (const { path, job } of jobs) {
        if (job !== undefined && !FINISHED.has(job.status)) {
            await transaction.set(path, jobDocSchema, {
                ...job,
                status: 'cancelled',
                updatedBy: stamp.caller.uid,
                updatedAt: timestampFromDate(stamp.now),
            });
        }
    }
}

/** The restored photo when the sweep removed its public files (its `web` derivative is gone), else undefined. */
async function sweptPhoto(deps: RestoreDeps, audited: AuditedDocument): Promise<PhotoDoc | undefined> {
    const photo = await deps.documents.get(FIRESTORE_PATHS.photo(audited.cityId, audited.entityId), photoDocSchema);
    const image = photo?.image;
    if (image === undefined) {
        return undefined;
    }
    const web = STORAGE_PATHS.photoDerivative(audited.cityId, audited.entityId, image.sha256, 'web');
    return (await deps.blobs.stat('public', web)) === undefined ? photo : undefined;
}

/** The photo's original while the private bucket still keeps it. */
async function keptOriginal(deps: RestoreDeps, photo: PhotoDoc): Promise<string | undefined> {
    const original = photo.original?.path;
    return original !== undefined && (await deps.blobs.stat('private', original)) !== undefined ? original : undefined;
}

/** Back to `pending`, without the last processing's error: the manifest leaves the photo out until it is processed. */
async function markPending(deps: RestoreDeps, caller: VerifiedCaller, path: string): Promise<void> {
    await deps.documents.transaction(async (transaction) => {
        const current = await transaction.get(path, photoDocSchema);
        if (current !== undefined) {
            await transaction.set(path, photoDocSchema, {
                ...omit(current, ['processingError', 'duplicateOf']),
                processing: 'pending',
                updatedBy: caller.uid,
                updatedAt: timestampFromDate(deps.clock.now()),
            });
        }
    });
}

/**
 * A restored photo whose public derivatives the sweep removed goes back to `pending`, and its kept original is copied
 * into a new upload of the caller's folder, which runs `photos.onUpload` again. Without the original it stays
 * `pending` (never on the public map with files that are gone) and the log says why.
 */
export async function reprocessIfSwept(deps: RestoreDeps, caller: VerifiedCaller, audited: AuditedDocument): Promise<boolean> {
    const photo = audited.entity === 'photo' ? await sweptPhoto(deps, audited) : undefined;
    if (photo === undefined) {
        return false;
    }
    const ids = { cityId: audited.cityId, photoId: audited.entityId };
    await markPending(deps, caller, FIRESTORE_PATHS.photo(ids.cityId, ids.photoId));
    const original = await keptOriginal(deps, photo);
    if (original === undefined) {
        deps.log.warn('restored photo has no original to process again', ids);
        return true;
    }
    const fileName = `reprocess-${String(deps.clock.now().getTime())}.${original.slice(original.lastIndexOf('.') + 1)}`;
    await deps.blobs.copy(
        { bucket: 'private', path: original },
        { bucket: 'private', path: STORAGE_PATHS.photoUpload(ids.cityId, caller.uid, ids.photoId, fileName) },
    );
    deps.log.info('restored photo processed again', ids);
    return true;
}
