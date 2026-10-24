import '../global-options.js';

import {
    BROWSE_MAX_BYTES,
    FIRESTORE_PATHS,
    RASTER_PATHS,
    timestampFromDate,
    usgsSceneDocSchema,
    type CallableRequest,
    type CallableResponse,
    type UsgsSceneDoc,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { ApiError } from '../api/api-error.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import { UpstreamError } from '../ports/errors.js';
import type { Ports } from '../ports/index.js';
import { imageTypeOf } from './magic.js';
import { IMAGERY_WRITER, stampOf } from './records.js';

/**
 * The browse proxy (`docs/research/M3-interfaces.md` §3.4): the browser never requests a USGS address, so a scene's
 * browse image is fetched server-side from `ims.cr.usgs.gov` only (`RemoteFiles` with `allowedHosts`), checked to be a
 * JPEG or a PNG, and copied create-only into the private bucket, where the admin reads it with the Storage SDK.
 */
export type BrowseDeps = Pick<Ports, 'documents' | 'clock' | 'log' | 'remote' | 'blobs'>;

/** USGS's browse host: the only address a browse image is fetched from. */
const BROWSE_HOST = 'ims.cr.usgs.gov';
const BROWSE_TIMEOUT_MS = 10_000;

type BrowseType = CallableResponse<'imagery.browse'>['contentType'];

const BROWSE_TYPES: readonly BrowseType[] = ['image/jpeg', 'image/png'];

/** Writes the scene's new browse record in a transaction (an admin's triage meanwhile is kept). */
async function recordBrowse(deps: BrowseDeps, cityId: string, entityId: string, browse: UsgsSceneDoc['browse']): Promise<void> {
    const path = FIRESTORE_PATHS.usgsScene(cityId, entityId);
    await deps.documents.transaction(async (transaction) => {
        const scene = await transaction.get(path, usgsSceneDocSchema);
        if (scene !== undefined) {
            await transaction.set(path, usgsSceneDocSchema, { ...scene, browse, ...stampOf(IMAGERY_WRITER, deps.clock.now()) });
        }
    });
}

/** Fetches and stores the image; any failure (refused address, 5xx, not an image) is `browseUnavailable`. */
async function fetchAndStore(deps: BrowseDeps, scene: UsgsSceneDoc, sourceUrl: string): Promise<BrowseType> {
    const file = await deps.remote.get(sourceUrl, {
        maxBytes: BROWSE_MAX_BYTES,
        timeoutMs: BROWSE_TIMEOUT_MS,
        allowedHosts: [BROWSE_HOST],
    });
    const contentType = imageTypeOf(file.bytes, BROWSE_TYPES);
    if (contentType === undefined) {
        throw new ApiError('apiError.imagery.browseUnavailable');
    }
    const path = RASTER_PATHS.browse(scene.dataset, scene.entityId);
    try {
        await deps.blobs.write('private', path, file.bytes, { contentType, ifGenerationMatch: 0 });
    } catch (error) {
        // Another city copied the same frame first (`usgs-browse/` is shared): its copy is as good.
        if (!(error instanceof UpstreamError && error.failure === 'conflict')) {
            throw error;
        }
    }
    return contentType;
}

/**
 * Copies `scene`'s browse image into our bucket and records it (`browse.state: 'copied'`, `path`, `checkedAt`); a
 * failure records `failed` with `apiError.imagery.browseUnavailable` and rejects with that code (the card's Try again).
 */
export async function copyBrowse(
    deps: BrowseDeps,
    cityId: string,
    scene: UsgsSceneDoc,
): Promise<{ path: string; contentType: BrowseType }> {
    const checkedAt = timestampFromDate(deps.clock.now());
    const sourceUrl = scene.browse.sourceUrl;
    try {
        if (sourceUrl === undefined) {
            throw new ApiError('apiError.imagery.browseUnavailable');
        }
        const contentType = await fetchAndStore(deps, scene, sourceUrl);
        const path = RASTER_PATHS.browse(scene.dataset, scene.entityId);
        await recordBrowse(deps, cityId, scene.entityId, { state: 'copied', sourceUrl, path, checkedAt });
        return { path, contentType };
    } catch (error) {
        deps.log.warn('browse image not copied', { cityId, entityId: scene.entityId, error: String(error) });
        const failed = { state: 'failed' as const, error: 'apiError.imagery.browseUnavailable' as const, checkedAt };
        await recordBrowse(deps, cityId, scene.entityId, sourceUrl === undefined ? failed : { ...failed, sourceUrl });
        throw new ApiError('apiError.imagery.browseUnavailable');
    }
}

/** The stored copy when it is still there (a lifecycle rule or a manual clean-up may have removed it). */
async function storedCopy(deps: BrowseDeps, scene: UsgsSceneDoc): Promise<{ path: string; contentType: BrowseType } | undefined> {
    const path = scene.browse.path;
    if (scene.browse.state !== 'copied' || path === undefined) {
        return undefined;
    }
    const stored = await deps.blobs.stat('private', path);
    return stored === undefined ? undefined : { path, contentType: stored.contentType === 'image/png' ? 'image/png' : 'image/jpeg' };
}

/** `imagery.browse` (admin): the scene's browse copy, made first when there is none. */
async function imageryBrowse(
    deps: BrowseDeps,
    _caller: VerifiedCaller,
    request: CallableRequest<'imagery.browse'>,
): Promise<CallableResponse<'imagery.browse'>> {
    const scene = await deps.documents.get(FIRESTORE_PATHS.usgsScene(request.cityId, request.entityId), usgsSceneDocSchema);
    if (scene === undefined) {
        throw new ApiError('apiError.notFound');
    }
    return (await storedCopy(deps, scene)) ?? copyBrowse(deps, request.cityId, scene);
}

/** The `imagery-browse` callable. */
export function browseFunction(getDeps: () => BrowseDeps & CallableDeps) {
    return defineCallable('imagery.browse', imageryBrowse, getDeps);
}
