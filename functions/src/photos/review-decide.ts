import '../global-options.js';

import {
    DERIVATIVE_WRITTEN_AT,
    FIRESTORE_PATHS,
    IMMUTABLE_CACHE_CONTROL,
    STORAGE_PATHS,
    photoDocSchema,
    poiDocSchema,
    publicObjectUrl,
    timestampFromDate,
    timestampToDate,
    type CallableRequest,
    type CallableResponse,
    type HeldImage,
    type PhotoDoc,
    type PhotoVariant,
    type PoiDoc,
    type TimestampLike,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { ApiError } from '../api/api-error.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import { omit } from '../api/objects.js';
import { UpstreamError } from '../ports/errors.js';
import type { Ports } from '../ports/index.js';

export type ReviewDeps = Pick<Ports, 'documents' | 'blobs' | 'clock' | 'config' | 'log'>;

type Request = CallableRequest<'review.decide'>;

/** What a decision writes on the item, whichever kind it is. */
function verdict(data: Request, caller: VerifiedCaller, now: Date) {
    const at = timestampFromDate(now);
    return {
        ...(data.note === undefined ? {} : { reviewNote: data.note }),
        reviewStatus: data.decision === 'approve' ? ('approved' as const) : ('refused' as const),
        reviewedBy: caller.uid,
        reviewedAt: at,
        updatedBy: caller.uid,
        updatedAt: at,
    };
}

/** Still waiting, and still what the reviewer read: an approval is of what they saw (M13 §2), and every write moves `updatedAt`. */
function pendingItem<Item extends { readonly reviewStatus?: string | undefined; readonly updatedAt: TimestampLike }>(
    item: Item | undefined,
    data: Request,
): Item {
    if (item === undefined) {
        throw new ApiError('apiError.notFound');
    }
    if (item.reviewStatus !== 'pending') {
        throw new ApiError('apiError.review.alreadyDecided');
    }
    if (data.seenAt !== undefined && timestampToDate(item.updatedAt).toISOString() !== data.seenAt) {
        throw new ApiError('apiError.review.changed');
    }
    return item;
}

/** A photo can be approved once processed and with a known licence: the rules ask no less of an editor who publishes. */
function requireApprovable(photo: PhotoDoc): HeldImage {
    if (photo.heldImage === undefined || photo.processing !== 'done') {
        throw new ApiError('apiError.review.notReady');
    }
    if (photo.license === 'unknown') {
        throw new ApiError('apiError.review.licenseUnknown');
    }
    return photo.heldImage;
}

/** One held derivative in the public bucket, content-hashed and immutable as any other; a repeat finds it there. */
async function moveOut(deps: ReviewDeps, data: Request, held: HeldImage, variant: PhotoVariant): Promise<string> {
    const path = STORAGE_PATHS.photoDerivative(data.cityId, data.id, held.sha256, variant);
    const bytes = await deps.blobs.read('private', held[variant]);
    await deps.blobs
        .write('public', path, bytes, {
            contentType: 'image/webp',
            cacheControl: IMMUTABLE_CACHE_CONTROL,
            ifGenerationMatch: 0,
            customMetadata: { [DERIVATIVE_WRITTEN_AT]: deps.clock.now().toISOString() },
        })
        .catch((error: unknown) => {
            if (!(error instanceof UpstreamError && error.failure === 'conflict')) {
                throw error;
            }
        });
    return publicObjectUrl(deps.config.buckets.public, path);
}

async function forgetHeld(deps: ReviewDeps, held: HeldImage | undefined): Promise<void> {
    if (held !== undefined) {
        await Promise.all([deps.blobs.delete('private', held.web), deps.blobs.delete('private', held.thumb)]);
    }
}

async function rewritePhoto(deps: ReviewDeps, data: Request, change: (photo: PhotoDoc) => PhotoDoc): Promise<void> {
    const path = FIRESTORE_PATHS.photo(data.cityId, data.id);
    await deps.documents.transaction(async (transaction) => {
        const photo = pendingItem(await transaction.get(path, photoDocSchema), data);
        await transaction.set(path, photoDocSchema, change(photo));
    });
}

/** Files first and the document after, so a public photo always has its pictures; a failure leaves it pending and retryable. */
async function approvePhoto(deps: ReviewDeps, caller: VerifiedCaller, data: Request): Promise<void> {
    const photo = pendingItem(await deps.documents.get(FIRESTORE_PATHS.photo(data.cityId, data.id), photoDocSchema), data);
    const held = requireApprovable(photo);
    const image = {
        web: await moveOut(deps, data, held, 'web'),
        thumb: await moveOut(deps, data, held, 'thumb'),
        sha256: held.sha256,
        w: held.w,
        h: held.h,
    };
    await rewritePhoto(deps, data, (current) => ({
        ...omit(current, ['heldImage']),
        image,
        published: true,
        ...verdict(data, caller, deps.clock.now()),
    }));
    await forgetHeld(deps, held);
}

async function refusePhoto(deps: ReviewDeps, caller: VerifiedCaller, data: Request): Promise<void> {
    const photo = await deps.documents.get(FIRESTORE_PATHS.photo(data.cityId, data.id), photoDocSchema);
    await rewritePhoto(deps, data, (current) => ({
        ...omit(current, ['heldImage']),
        published: false,
        ...verdict(data, caller, deps.clock.now()),
    }));
    await forgetHeld(deps, photo?.heldImage);
}

async function decidePoi(deps: ReviewDeps, caller: VerifiedCaller, data: Request): Promise<void> {
    const path = FIRESTORE_PATHS.poi(data.cityId, data.id);
    await deps.documents.transaction(async (transaction) => {
        const poi = pendingItem(await transaction.get(path, poiDocSchema), data);
        const decided: PoiDoc = { ...poi, published: data.decision === 'approve', ...verdict(data, caller, deps.clock.now()) };
        await transaction.set(path, poiDocSchema, decided);
    });
}

function decidePhoto(deps: ReviewDeps, caller: VerifiedCaller, data: Request): Promise<void> {
    return data.decision === 'approve' ? approvePhoto(deps, caller, data) : refusePhoto(deps, caller, data);
}

/**
 * `review.decide` (a city's reviewers; `docs/research/M13-roles.md` §2; S-A90-HAPPY-APPROVE, S-A90-HAPPY-REFUSE,
 * S-A90-BAD-DECIDED-TWICE, S-A90-BAD-CHANGED-SINCE): the one door out of the queue. The write goes through `history.on*Write` as any edit and the publish
 * triggers rebuild the manifest; the note goes to the uploader.
 */
async function reviewDecide(deps: ReviewDeps, caller: VerifiedCaller, data: Request): Promise<CallableResponse<'review.decide'>> {
    await (data.entity === 'photo' ? decidePhoto(deps, caller, data) : decidePoi(deps, caller, data));
    deps.log.info('review decided', { by: caller.uid, cityId: data.cityId, entity: data.entity, id: data.id, decision: data.decision });
    return { status: data.decision === 'approve' ? 'approved' : 'refused' };
}

/** The `review-decide` callable. */
export function reviewFunctions(getDeps: () => ReviewDeps & CallableDeps) {
    return { decide: defineCallable('review.decide', reviewDecide, getDeps) };
}
