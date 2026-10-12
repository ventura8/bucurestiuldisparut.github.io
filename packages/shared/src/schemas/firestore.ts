/**
 * Firestore content documents (PLAN → Data, Addendum 3): the city, its photos, layers, POIs and POI categories, and the
 * `history` entries of every one of them. The operational documents (jobs, setup, admins, invitations, usage, the
 * guard, manifest builds) are in `firestore-ops.ts`; the paths of both in `paths.ts`.
 *
 * Every server writer (Cloud Functions, the raster pipeline through its own models) validates with these before
 * writing, because the Admin SDK bypasses the rules; `firebase/firestore.rules` checks the client-writable subset,
 * which `CLIENT_WRITES` (`client-writes.ts`) lists field by field. Firestore stores no nested arrays, so boxes are
 * `{west, south, east, north}` and positions `{lat, lng}` here, unlike the manifest. Final in M2
 * (`docs/research/M2-interfaces.md` §2); a change is a change request.
 */
import { z } from 'zod';

import { apiErrorCodeSchema } from '../api/errors.js';
import { sha256Schema, stamp, timestampSchema, uidSchema } from './firestore-common.js';
import { geometryDocSchema } from './geometry.js';
import {
    analyticsSchema,
    basemapSchema,
    creditSchema,
    layerAdjustmentsSchema,
    layerSourceSchema,
    LICENSES,
    themeSchema,
    LAYER_KINDS,
} from './manifest.js';
import { iconNameSchema, MAX_POI_PHOTOS, photosOverlaySchema } from './poi.js';
import {
    assetUrlSchema,
    bearingSchema,
    boundsRecordSchema,
    coded,
    fovSchema,
    hexColorSchema,
    httpsUrlSchema,
    idSchema,
    isoDateSchema,
    latLngSchema,
    linkSchema,
    localizedMarkdownPartial,
    localizedPartial,
    mapboxPublicTokenSchema,
    MAX_LINKS,
    opacitySchema,
    plainText,
    validYearRange,
    validYearSpan,
    versionSchema,
    yearSchema,
    zoomSchema,
} from './primitives.js';

/** The photo licences Firestore accepts: the published ones plus `unknown`, which cannot be published. */
export const FIRESTORE_LICENSES = [...LICENSES, 'unknown'] as const;
export const PROCESSING_STATES = ['pending', 'done', 'failed'] as const;
export const LAYER_STATUSES = ['draft', 'processing', 'awaiting_approval', 'ready', 'failed'] as const;
export const USGS_DATASETS = ['corona2', 'declassii', 'declassiii'] as const;
export const GEOREF_METHODS = ['corners', 'gcps', 'auto'] as const;
/** The audited, admin-editable documents (PLAN Addendum 3): each keeps a `history` subcollection. */
export const HISTORY_ENTITIES = ['city', 'layer', 'photo', 'poi', 'poiCategory'] as const;
export const HISTORY_ACTIONS = ['create', 'update', 'delete', 'revert'] as const;
/** What an admin may upload as a photo (`firebase/storage.rules`); the server sniffs the bytes, never trusts this. */
export const PHOTO_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/tiff', 'image/heic', 'image/heif'] as const;

const cityText = localizedMarkdownPartial(10_000);

/** A Mapbox token id (`authorization` of the Tokens API), never the token itself. */
export const mapboxTokenIdSchema = z.string().regex(/^[a-z0-9]{1,64}$/);

/** An https origin without a path (`https://ventura8.github.io`): what a URL-restricted Mapbox token allows. */
export const httpsOriginSchema = z.string().regex(/^https:\/\/[a-z0-9.-]{1,253}(?::\d{1,5})?$/);

/** `cities/{city}`. `id`, `mapbox`, `analytics`, `engine` and `createdAt` are server-owned. */
export const cityDocSchema = z.strictObject({
    id: idSchema.optional(),
    name: localizedPartial(100),
    bounds: boundsRecordSchema,
    center: latLngSchema.optional(),
    zoom: zoomSchema.optional(),
    minZoom: zoomSchema.optional(),
    maxZoom: zoomSchema.optional(),
    about: cityText.optional(),
    privacy: cityText.optional(),
    credits: z.array(creditSchema).max(50).optional(),
    theme: themeSchema.optional(),
    basemap: basemapSchema.optional(),
    /** Written by `setup.saveMapbox` and `setup.rotatePublicToken`: the viewer's URL-restricted public token. */
    mapbox: z
        .strictObject({
            user: z.string().max(64).optional(),
            publicToken: mapboxPublicTokenSchema.optional(),
            publicTokenId: mapboxTokenIdSchema.optional(),
            allowedUrls: z.array(httpsOriginSchema).max(10).optional(),
        })
        .optional(),
    /** Written by `setup.analyticsConfig` (GA4 ids from the Firebase Management API) and the crash endpoint. */
    analytics: analyticsSchema.optional(),
    engine: z.strictObject({ minVersion: versionSchema.optional() }).optional(),
    /** Defaults of the photos overlay (PLAN Addendum 3), copied into the manifest. */
    photosOverlay: photosOverlaySchema.optional(),
    published: z.boolean(),
    createdAt: timestampSchema.optional(),
    ...stamp,
});

const photoImageDocSchema = z.strictObject({
    /** https URLs of the content-hashed derivatives in the public bucket (`STORAGE_PATHS.photoDerivative`). */
    web: assetUrlSchema,
    thumb: assetUrlSchema,
    /** SHA-256 of the original upload: the duplicate check and the derivative paths use it. */
    sha256: sha256Schema,
    w: z.number().int().min(1).max(20_000),
    h: z.number().int().min(1).max(20_000),
});

/** The original upload, kept in the private bucket (`STORAGE_PATHS.photoOriginal`): uploads/ expire after 7 days. */
const photoOriginalDocSchema = z.strictObject({
    path: z.string().min(1).max(1024),
    contentType: z.enum(PHOTO_CONTENT_TYPES),
    bytes: z.number().int().min(1),
    sha256: sha256Schema,
});

/** What `photos.onUpload` read from the file (EXIF, file name); the admin accepts a suggestion with one click. */
const photoSuggestionsSchema = z.strictObject({
    location: latLngSchema.optional(),
    year: yearSchema.optional(),
    bearing: bearingSchema.optional(),
    title: plainText(200).optional(),
});

/**
 * `cities/{city}/photos/{photo}`. `image`, `exif`, `processing`, `processingError`, `duplicateOf`, `suggested` and
 * `original` are owned by `photos.onUpload`; `createdAt` and `createdBy` are set once by the client that creates it.
 */
export const photoDocSchema = z
    .strictObject({
        title: localizedPartial(200),
        description: localizedPartial(5000).optional(),
        year: yearSchema.optional(),
        yearEnd: yearSchema.optional(),
        /** The legacy dating as written (`Iulie 1936`), shown when present (CR-1). */
        dateText: localizedPartial(100).optional(),
        author: plainText(200).optional(),
        license: z.enum(FIRESTORE_LICENSES),
        rightsHolder: plainText(200).optional(),
        sourceUrl: httpsUrlSchema.optional(),
        sourceLabel: plainText(200).optional(),
        permissionNote: plainText(2000).optional(),
        legacyId: plainText(64).optional(),
        links: z.array(linkSchema).max(MAX_LINKS).optional(),
        location: latLngSchema,
        bearing: bearingSchema.optional(),
        fov: fovSchema.optional(),
        published: z.boolean(),
        rightsReview: z.boolean().optional(),
        image: photoImageDocSchema.optional(),
        exif: z.record(z.string().max(64), z.union([z.string().max(500), z.number()])).optional(),
        processing: z.enum(PROCESSING_STATES),
        /** Why the last processing failed (`apiError.photo.*`), set with `processing: 'failed'`. */
        processingError: apiErrorCodeSchema.optional(),
        /** The photo whose original has the same SHA-256 (flagged, never processed twice: S-A08-BAD-DUPLICATE). */
        duplicateOf: idSchema.optional(),
        suggested: photoSuggestionsSchema.optional(),
        original: photoOriginalDocSchema.optional(),
        createdAt: timestampSchema.optional(),
        createdBy: uidSchema.optional(),
        ...stamp,
    })
    .refine(validYearRange, coded('validation.yearRange', ['yearEnd']));

/**
 * `cities/{city}/layers/{layer}`: created by the pipeline (stamped `system:pipeline`); admins edit the presentation
 * fields, the default opacity and the image adjustments.
 */
export const layerDocSchema = z.strictObject({
    year: yearSchema,
    date: isoDateSchema.optional(),
    label: localizedPartial(200),
    description: localizedPartial(5000).optional(),
    kind: z.enum(LAYER_KINDS),
    sensor: plainText(100).optional(),
    attribution: plainText(500).optional(),
    source: layerSourceSchema,
    minzoom: zoomSchema,
    maxzoom: zoomSchema,
    bounds: boundsRecordSchema.optional(),
    order: z.number().int(),
    opacity: opacitySchema,
    defaultVisible: z.boolean(),
    adjustments: layerAdjustmentsSchema.optional(),
    status: z.enum(LAYER_STATUSES),
    published: z.boolean(),
    provenance: z
        .strictObject({
            usgsEntityId: z.string().max(64).optional(),
            usgsDataset: z.enum(USGS_DATASETS).optional(),
            georef: z
                .strictObject({
                    method: z.enum(GEOREF_METHODS),
                    gcpCount: z.number().int().min(0).max(300).optional(),
                    checkpointRmseM: z.number().min(0).optional(),
                })
                .optional(),
        })
        .optional(),
    mapbox: z.strictObject({ tilesetId: z.string().max(100), publishedSourceSha: sha256Schema.optional() }).optional(),
    createdAt: timestampSchema.optional(),
    ...stamp,
});

/** `cities/{city}/poiCategories/{category}`: edited in the city settings; the manifest lists them by `order`. */
export const poiCategoryDocSchema = z.strictObject({
    label: localizedPartial(100),
    icon: iconNameSchema,
    color: hexColorSchema,
    defaultOpacity: opacitySchema,
    order: z.number().int(),
    createdAt: timestampSchema.optional(),
    ...stamp,
});

/** `cities/{city}/pois/{poi}`: drawn and edited by admins; the geometry has no nested arrays (`geometry.ts`). */
export const poiDocSchema = z
    .strictObject({
        category: idSchema,
        geometry: geometryDocSchema,
        title: localizedPartial(200),
        description: localizedMarkdownPartial(5000).optional(),
        yearStart: yearSchema.optional(),
        yearEnd: yearSchema.optional(),
        links: z.array(linkSchema).max(MAX_LINKS).optional(),
        photoIds: z.array(idSchema).max(MAX_POI_PHOTOS).optional(),
        published: z.boolean(),
        createdAt: timestampSchema.optional(),
        createdBy: uidSchema.optional(),
        ...stamp,
    })
    .refine(validYearSpan, coded('validation.yearRange', ['yearEnd']));

/** A document as it was, keyed by field (validated again with its entity's schema before a revert writes it). */
const snapshotSchema = z
    .record(z.string().min(1).max(64), z.unknown())
    .refine((snapshot) => Object.keys(snapshot).length <= 100, coded('validation.tooBig'));

/**
 * `<audited document>/history/{entry}`, for example `cities/{city}/pois/{poi}/history/{entry}` (and
 * `cities/{city}/history/{entry}` for the city itself). Written by the `history.onWrite` triggers on every change of
 * an audited document, never by a client: `previous` is the version before the change (none for a create), and the
 * stamp is the change's own (for a delete, the deleting identity of the event's auth context). `history.revert`
 * writes the restored document and its own `revert` entry (`revertOf`; `previous` is null when it restores a deleted
 * document) in one transaction, and the trigger skips that change. Entry ids sort by time (`historyEntryId`); the
 * newest `HISTORY_KEEP` entries per document are kept.
 */
export const historyEntryDocSchema = z
    .strictObject({
        entity: z.enum(HISTORY_ENTITIES),
        entityId: idSchema,
        action: z.enum(HISTORY_ACTIONS),
        previous: snapshotSchema.nullable(),
        changedFields: z.array(z.string().min(1).max(64)).max(100),
        /** The history entry whose `previous` a revert restored. */
        revertOf: z.string().min(1).max(128).optional(),
        ...stamp,
    })
    .refine(
        (entry) => entry.action === 'revert' || (entry.action === 'create') === (entry.previous === null),
        coded('validation.value', ['previous']),
    )
    .refine((entry) => (entry.action === 'revert') === (entry.revertOf !== undefined), coded('validation.value', ['revertOf']));

export type CityDoc = z.infer<typeof cityDocSchema>;
export type PhotoDoc = z.infer<typeof photoDocSchema>;
export type LayerDoc = z.infer<typeof layerDocSchema>;
export type PoiCategoryDoc = z.infer<typeof poiCategoryDocSchema>;
export type PoiDoc = z.infer<typeof poiDocSchema>;
export type HistoryEntryDoc = z.infer<typeof historyEntryDocSchema>;
export type HistoryEntity = (typeof HISTORY_ENTITIES)[number];
export type HistoryAction = (typeof HISTORY_ACTIONS)[number];
export type FirestoreLicense = (typeof FIRESTORE_LICENSES)[number];
export type PhotoContentType = (typeof PHOTO_CONTENT_TYPES)[number];
