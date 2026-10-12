/**
 * Firestore document shapes (PLAN → Data; `firebase/firestore.rules` → the client-writable subset).
 * Every server writer (Cloud Functions, the raster pipeline through its own models) validates with
 * these before writing, because the Admin SDK bypasses the rules. M1 fixes the shapes; M2 refines
 * them with the handlers that write them. Firestore stores no nested arrays, so boxes are
 * `{west, south, east, north}` and positions `{lat, lng}` here, unlike the manifest.
 */
import { z } from 'zod';

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

/** What both Firestore SDKs' `Timestamp` expose (plain getters; the class itself is SDK-specific). */
export interface TimestampLike {
    readonly seconds: number;
    readonly nanoseconds: number;
}

function isTimestampLike(value: unknown): value is TimestampLike {
    return (
        typeof value === 'object' &&
        value !== null &&
        typeof (value as Partial<TimestampLike>).seconds === 'number' &&
        typeof (value as Partial<TimestampLike>).nanoseconds === 'number'
    );
}

export const timestampSchema = z.custom<TimestampLike>(isTimestampLike, coded('validation.type'));

const uidSchema = z.string().min(1).max(128);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

/** The photo licences Firestore accepts: the published ones plus `unknown`, which cannot be published. */
export const FIRESTORE_LICENSES = [...LICENSES, 'unknown'] as const;
export const PROCESSING_STATES = ['pending', 'done', 'failed'] as const;
export const LAYER_STATUSES = ['draft', 'processing', 'awaiting_approval', 'ready', 'failed'] as const;
export const JOB_TYPES = ['usgs-import', 'geotiff-import', 'regeoref', 'republish'] as const;
/** The job state machine of security review §4.1. */
export const JOB_STATUSES = [
    'queued',
    'starting',
    'running',
    'waiting_usgs',
    'mts_processing',
    'awaiting_approval',
    'succeeded',
    'failed',
    'cancelled',
] as const;
export const USGS_DATASETS = ['corona2', 'declassii', 'declassiii'] as const;
export const USGS_SCENE_STATUSES = ['candidate', 'ordered', 'available', 'imported', 'rejected'] as const;
/** Setup health per connected service, as `functions/src/handlers/setup-status.ts` projects it. */
export const SERVICE_STATES = ['missing', 'ok', 'invalid'] as const;
export const ADMIN_ROLES = ['owner', 'admin'] as const;
export const GEOREF_METHODS = ['corners', 'gcps', 'auto'] as const;
/** The audited, admin-editable documents (PLAN Addendum 3): each keeps a `history` subcollection. */
export const HISTORY_ENTITIES = ['city', 'layer', 'photo', 'poi', 'poiCategory'] as const;
export const HISTORY_ACTIONS = ['create', 'update', 'delete', 'revert'] as const;

/**
 * Who last wrote an audited document, and when. A client write stamps its uid and `serverTimestamp()` (the rules
 * check both); a server writer stamps its own identity, `system:<writer>` (for example `system:pipeline`).
 */
const stamp = { updatedBy: uidSchema, updatedAt: timestampSchema };

const cityText = localizedMarkdownPartial(10_000);

/** `cities/{city}`. `id`, `mapbox` and `createdAt` are server-owned. */
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
    mapbox: z.strictObject({ user: z.string().max(64).optional(), publicToken: mapboxPublicTokenSchema.optional() }).optional(),
    analytics: analyticsSchema.optional(),
    engine: z.strictObject({ minVersion: versionSchema.optional() }).optional(),
    /** Defaults of the photos overlay (PLAN Addendum 3), copied into the manifest. */
    photosOverlay: photosOverlaySchema.optional(),
    published: z.boolean(),
    createdAt: timestampSchema.optional(),
    ...stamp,
});

const photoImageDocSchema = z.strictObject({
    web: assetUrlSchema,
    thumb: assetUrlSchema,
    sha256: sha256Schema,
    w: z.number().int().min(1).max(20_000),
    h: z.number().int().min(1).max(20_000),
});

/** `cities/{city}/photos/{photo}`. `image`, `exif` and `processing` are owned by `photos.onUpload`. */
export const photoDocSchema = z
    .strictObject({
        title: localizedPartial(200),
        description: localizedPartial(5000).optional(),
        year: yearSchema.optional(),
        yearEnd: yearSchema.optional(),
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
 * `cities/{city}/history/{entry}` for the city itself). Written by a server trigger on every change of an audited
 * document, never by a client: `previous` is the version before the change (none for a create), and the stamp is
 * the change's own. A revert writes `previous` of the entry it names back to the document, which is audited again.
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
    .refine((entry) => (entry.action === 'create') === (entry.previous === null), coded('validation.value', ['previous']))
    .refine((entry) => (entry.action === 'revert') === (entry.revertOf !== undefined), coded('validation.value', ['revertOf']));

/** `cities/{city}/jobs/{job}`: admins create `queued` requests; the job runner owns every other field. */
export const jobDocSchema = z.strictObject({
    type: z.enum(JOB_TYPES),
    status: z.enum(JOB_STATUSES),
    params: z.record(z.string().max(64), z.unknown()),
    createdBy: uidSchema,
    createdAt: timestampSchema,
    cancelRequested: z.boolean().optional(),
    step: z.string().max(64).optional(),
    progress: z.number().min(0).max(1).optional(),
    retryAt: timestampSchema.optional(),
    executionName: z.string().max(500).optional(),
    mapboxJobId: z.string().max(100).optional(),
    error: z.strictObject({ code: z.string().max(64), message: plainText(2000) }).optional(),
    updatedAt: timestampSchema.optional(),
});

/** `cities/{city}/usgsScenes/{entityId}`: harvested server-side; admins set `status` and `note`. */
export const usgsSceneDocSchema = z.strictObject({
    entityId: z.string().min(1).max(64),
    dataset: z.enum(USGS_DATASETS),
    acquisitionDate: isoDateSchema,
    status: z.enum(USGS_SCENE_STATUSES),
    note: plainText(1000).optional(),
    downloadAvailable: z.boolean(),
    browseUrl: assetUrlSchema.optional(),
    footprint: z.array(latLngSchema).min(3).max(64).optional(),
    rank: z.number().optional(),
    createdAt: timestampSchema.optional(),
    updatedAt: timestampSchema.optional(),
});

const serviceRecordSchema = z.strictObject({
    state: z.enum(SERVICE_STATES),
    checkedAt: timestampSchema.optional(),
    detail: plainText(500).optional(),
});

/** `setup/status`: non-secret health only (secrets live in Secret Manager, never here). */
export const setupStatusDocSchema = z.strictObject({
    google: serviceRecordSchema.optional(),
    mapbox: serviceRecordSchema.optional(),
    usgs: serviceRecordSchema.optional(),
    analytics: serviceRecordSchema.optional(),
    secretsRev: z.number().int().min(0).optional(),
});

/** `admins/{uid}`: written by the bootstrap script and the `admins.*` callables only. */
export const adminDocSchema = z.strictObject({
    role: z.enum(ADMIN_ROLES),
    email: z.email().max(254).optional(),
    displayName: plainText(200).optional(),
    invitedBy: uidSchema.optional(),
    createdAt: timestampSchema,
});

export type CityDoc = z.infer<typeof cityDocSchema>;
export type PhotoDoc = z.infer<typeof photoDocSchema>;
export type LayerDoc = z.infer<typeof layerDocSchema>;
export type JobDoc = z.infer<typeof jobDocSchema>;
export type UsgsSceneDoc = z.infer<typeof usgsSceneDocSchema>;
export type SetupStatusDoc = z.infer<typeof setupStatusDocSchema>;
export type AdminDoc = z.infer<typeof adminDocSchema>;
export type PoiCategoryDoc = z.infer<typeof poiCategoryDocSchema>;
export type PoiDoc = z.infer<typeof poiDocSchema>;
export type HistoryEntryDoc = z.infer<typeof historyEntryDocSchema>;
export type HistoryEntity = (typeof HISTORY_ENTITIES)[number];
export type HistoryAction = (typeof HISTORY_ACTIONS)[number];
export type FirestoreLicense = (typeof FIRESTORE_LICENSES)[number];
export type JobStatus = (typeof JOB_STATUSES)[number];
export type JobType = (typeof JOB_TYPES)[number];
