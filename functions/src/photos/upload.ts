/**
 * `photos.onUpload`, the pure handler (`docs/research/M2-interfaces.md` §3.6; security review §1.5, §4.6): an admin's
 * upload into the private bucket becomes the photo's original, its two public WebP derivatives (content-hashed,
 * immutable, no metadata) and the server-owned fields of its document. Processing is idempotent: the paths derive from
 * the SHA-256, a redelivered event finds its objects and its upload gone.
 */
import { createHash } from 'node:crypto';

import {
    DERIVATIVE_WRITTEN_AT,
    FIRESTORE_PATHS,
    IMMUTABLE_CACHE_CONTROL,
    PHOTO_LIMITS,
    STORAGE_PATHS,
    parsePhotoUploadPath,
    photoDocSchema,
    publicObjectUrl,
    systemWriter,
    timestampFromDate,
    type ApiErrorCode,
    type PhotoContentType,
    type PhotoDoc,
    type PhotoUpload,
    type PhotoVariant,
} from '@hcm/shared';

import type { ExifSummary, ImageInspection } from '../ports/image-processor.js';
import type { Ports } from '../ports/index.js';
import { UpstreamError } from '../ports/errors.js';
import { compact, omit } from '../api/objects.js';
import { exifRecord, suggestionsFrom } from './suggestions.js';

export type PhotoDeps = Pick<Ports, 'log' | 'clock' | 'config' | 'documents' | 'blobs' | 'images'>;

/** The finalized object of the private bucket, as far as the handler reads it (`StorageObjectData`). */
export interface FinalizedObject {
    readonly name: string;
    /** Bytes; Cloud Storage events carry this int64 as a decimal string, whatever the event type says. */
    readonly size: number | string;
    /** Custom metadata: the admin sets `originalName`, the file's name on the admin's computer. */
    readonly metadata: Readonly<Record<string, string>>;
}

/** What became of one upload (logged, and what the tests assert besides the documents and objects). */
export type UploadOutcome = 'ignored' | 'orphan' | 'gone' | 'failed' | 'done';

/**
 * The code of a HEIC/HEIF upload, which the runtime cannot decode (`adapters/image.ts`; `DECISIONS-for-review.md` §20b):
 * its message tells the admin how to export a JPEG instead (CR-M2-30).
 */
const HEIC_ERROR: ApiErrorCode = 'apiError.photo.heicUnsupported';
const UNDECODABLE: ReadonlySet<PhotoContentType> = new Set(['image/heic', 'image/heif']);

/** The fields one processing result replaces; everything else of the document stays as the admin wrote it. */
const SERVER_FIELDS = ['image', 'exif', 'suggested', 'original', 'processingError', 'duplicateOf'] as const;

const DERIVATIVES: Readonly<Record<PhotoVariant, { readonly longEdge: number; readonly quality: number }>> = {
    web: { longEdge: PHOTO_LIMITS.webLongEdge, quality: PHOTO_LIMITS.webQuality },
    thumb: { longEdge: PHOTO_LIMITS.thumbLongEdge, quality: PHOTO_LIMITS.thumbQuality },
};

/** Why a file was refused: the code the photo records (`apiError.photo.tooLarge` reads its limit from `PHOTO_LIMITS`). */
interface Refusal {
    readonly code: ApiErrorCode;
    readonly duplicateOf?: string;
}

/** An upload the server will not process; recorded on the document, the upload deleted. */
class PhotoRefused extends Error {
    readonly refusal: Refusal;

    constructor(refusal: Refusal) {
        super(refusal.code);
        this.name = 'PhotoRefused';
        this.refusal = refusal;
    }
}

interface Processed {
    readonly image: NonNullable<PhotoDoc['image']>;
    readonly original: NonNullable<PhotoDoc['original']>;
    readonly exif: NonNullable<PhotoDoc['exif']>;
    readonly suggested?: NonNullable<PhotoDoc['suggested']>;
}

interface Accepted {
    readonly contentType: PhotoContentType;
    readonly exif: ExifSummary;
}

function refuseUnreadable(error: unknown): never {
    if (error instanceof UpstreamError && error.failure === 'invalid') {
        throw new PhotoRefused({ code: 'apiError.photo.unreadable' });
    }
    throw error;
}

function tooLarge(): PhotoRefused {
    return new PhotoRefused({ code: 'apiError.photo.tooLarge' });
}

/** The sniffed type must be an accepted, decodable photo type, and the pixel count within the limit. */
function accept(inspection: ImageInspection): Accepted {
    const { contentType } = inspection;
    if (contentType === undefined) {
        throw new PhotoRefused({ code: 'apiError.photo.unsupportedType' });
    }
    if (UNDECODABLE.has(contentType)) {
        throw new PhotoRefused({ code: HEIC_ERROR });
    }
    if (inspection.width * inspection.height > PHOTO_LIMITS.maxInputPixels) {
        throw tooLarge();
    }
    return { contentType, exif: inspection.exif };
}

/** The upload's bytes; undefined when it is gone (a redelivered event after the upload was processed and deleted). */
async function readUpload(deps: PhotoDeps, object: FinalizedObject): Promise<Uint8Array | undefined> {
    if (Number(object.size) > PHOTO_LIMITS.maxUploadBytes) {
        throw tooLarge();
    }
    try {
        return await deps.blobs.read('private', object.name);
    } catch (error) {
        if (error instanceof UpstreamError && error.failure === 'notFound') {
            return undefined;
        }
        throw error;
    }
}

/** Whether the photo being processed came from the old site (it carries a `legacyId`). */
async function isLegacyPhoto(deps: PhotoDeps, upload: PhotoUpload): Promise<boolean> {
    const current = await deps.documents.get(FIRESTORE_PATHS.photo(upload.cityId, upload.photoId), photoDocSchema);
    return current?.legacyId !== undefined;
}

/**
 * Another photo of the city whose original has the same SHA-256 (S-A08-BAD-DUPLICATE); the photo itself never counts.
 * The old site placed one image at two spots (two legacy records, one file): two legacy photos are never each other's
 * duplicate, so the legacy import keeps both whichever is processed first.
 */
async function refuseDuplicate(deps: PhotoDeps, upload: PhotoUpload, sha256: string): Promise<void> {
    const found = await deps.documents.query(FIRESTORE_PATHS.photos(upload.cityId), photoDocSchema, {
        where: [['original.sha256', '==', sha256]],
        limit: 2,
    });
    const others = [...found.documents, ...found.invalid].filter((document) => document.id !== upload.photoId);
    const [other] = others;
    if (other === undefined) {
        return;
    }
    const legacyPair = found.documents.some((document) => document.id === other.id && document.data.legacyId !== undefined);
    if (!(legacyPair && (await isLegacyPhoto(deps, upload)))) {
        throw new PhotoRefused({ code: 'apiError.photo.duplicate', duplicateOf: other.id });
    }
}

interface Derivative {
    readonly variant: PhotoVariant;
    readonly bytes: Uint8Array;
    readonly width: number;
    readonly height: number;
}

/** Both derivatives in memory: every decoding problem shows here, before anything is written. */
async function render(deps: PhotoDeps, bytes: Uint8Array): Promise<readonly [Derivative, Derivative]> {
    const encode = async (variant: PhotoVariant): Promise<Derivative> => ({
        variant,
        ...(await deps.images.webp(bytes, DERIVATIVES[variant]).catch(refuseUnreadable)),
    });
    return [await encode('web'), await encode('thumb')];
}

/** One derivative, created once: a redelivered event finds the same content-hashed object (a conflict) and moves on. */
async function store(deps: PhotoDeps, upload: PhotoUpload, sha256: string, derivative: Derivative): Promise<string> {
    const path = STORAGE_PATHS.photoDerivative(upload.cityId, upload.photoId, sha256, derivative.variant);
    await deps.blobs
        .write('public', path, derivative.bytes, {
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

async function processBytes(deps: PhotoDeps, upload: PhotoUpload, object: FinalizedObject, bytes: Uint8Array): Promise<Processed> {
    const accepted = accept(await deps.images.inspect(bytes).catch(refuseUnreadable));
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    await refuseDuplicate(deps, upload, sha256);
    const [web, thumb] = await render(deps, bytes);
    const originalPath = STORAGE_PATHS.photoOriginal(upload.cityId, upload.photoId, sha256, accepted.contentType);
    await deps.blobs.copy({ bucket: 'private', path: object.name }, { bucket: 'private', path: originalPath });
    return compact<Processed>({
        image: {
            web: await store(deps, upload, sha256, web),
            thumb: await store(deps, upload, sha256, thumb),
            sha256,
            w: web.width,
            h: web.height,
        },
        original: { path: originalPath, contentType: accepted.contentType, bytes: bytes.length, sha256 },
        exif: exifRecord(accepted.exif),
        suggested: suggestionsFrom(accepted.exif, object.metadata['originalName']),
    });
}

/** Rewrites the photo inside a transaction (the admin may be editing it); a photo deleted meanwhile stays deleted. */
async function updatePhoto(deps: PhotoDeps, upload: PhotoUpload, change: (current: PhotoDoc) => PhotoDoc): Promise<void> {
    const path = FIRESTORE_PATHS.photo(upload.cityId, upload.photoId);
    await deps.documents.transaction(async (transaction) => {
        const current = await transaction.get(path, photoDocSchema);
        if (current !== undefined) {
            await transaction.set(path, photoDocSchema, change(current));
        }
    });
}

function stamp(deps: PhotoDeps): Pick<PhotoDoc, 'updatedBy' | 'updatedAt'> {
    return { updatedBy: systemWriter('photos'), updatedAt: timestampFromDate(deps.clock.now()) };
}

async function recordDone(deps: PhotoDeps, upload: PhotoUpload, processed: Processed): Promise<void> {
    await updatePhoto(deps, upload, (current) => ({
        ...omit(current, SERVER_FIELDS),
        ...processed,
        processing: 'done',
        ...stamp(deps),
    }));
}

async function recordFailed(deps: PhotoDeps, upload: PhotoUpload, refusal: Refusal): Promise<void> {
    await updatePhoto(deps, upload, (current) => ({
        ...omit(current, ['processingError', 'duplicateOf']),
        ...compact<Pick<PhotoDoc, 'duplicateOf'>>({ duplicateOf: refusal.duplicateOf }),
        processing: 'failed',
        processingError: refusal.code,
        ...stamp(deps),
    }));
}

/** A failure that is not the file's fault (Storage or Firestore unavailable): retryable with Reprocess, upload kept. */
function unexpected(deps: PhotoDeps, upload: PhotoUpload, error: unknown): Refusal {
    const transient = error instanceof UpstreamError && ['unavailable', 'rateLimited'].includes(error.failure);
    deps.log.error('photo processing failed', { cityId: upload.cityId, photoId: upload.photoId, error: String(error) });
    return { code: transient ? 'apiError.unavailable' : 'apiError.internal' };
}

async function recordFailure(deps: PhotoDeps, upload: PhotoUpload, object: FinalizedObject, error: unknown): Promise<void> {
    if (!(error instanceof PhotoRefused)) {
        await recordFailed(deps, upload, unexpected(deps, upload, error));
        return;
    }
    await recordFailed(deps, upload, error.refusal);
    await deps.blobs.delete('private', object.name);
    deps.log.info('photo refused', { cityId: upload.cityId, photoId: upload.photoId, code: error.refusal.code });
}

async function processKnownUpload(deps: PhotoDeps, upload: PhotoUpload, object: FinalizedObject): Promise<UploadOutcome> {
    try {
        const bytes = await readUpload(deps, object);
        if (bytes === undefined) {
            return 'gone';
        }
        const processed = await processBytes(deps, upload, object, bytes);
        await recordDone(deps, upload, processed);
        deps.log.info('photo processed', { cityId: upload.cityId, photoId: upload.photoId, sha256: processed.image.sha256 });
    } catch (error) {
        await recordFailure(deps, upload, object, error);
        return 'failed';
    }
    await deps.blobs.delete('private', object.name);
    return 'done';
}

/**
 * Processes one finalized object of the private bucket: anything but `uploads/photos/{city}/{uid}/{photo}/{file}` is
 * ignored, an upload without its photo document is deleted, a refused file is recorded on the document
 * (`processing: 'failed'`, `processingError`, `duplicateOf`) and deleted, a processed one sets `image`, `exif`,
 * `suggested`, `original` and `processing: 'done'` (stamped `system:photos`) and is deleted.
 */
export async function processPhotoUpload(deps: PhotoDeps, object: FinalizedObject): Promise<UploadOutcome> {
    const upload = parsePhotoUploadPath(object.name);
    if (upload === undefined) {
        deps.log.debug('not a photo upload', { name: object.name });
        return 'ignored';
    }
    const photo = await deps.documents.get(FIRESTORE_PATHS.photo(upload.cityId, upload.photoId), photoDocSchema);
    if (photo === undefined) {
        await deps.blobs.delete('private', object.name);
        deps.log.warn('upload without its photo document deleted', { cityId: upload.cityId, photoId: upload.photoId });
        return 'orphan';
    }
    return processKnownUpload(deps, upload, object);
}
