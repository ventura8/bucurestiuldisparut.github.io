/**
 * Firestore document shapes (PLAN → Data; `firebase/firestore.rules` → the client-writable subset).
 * Every server writer (Cloud Functions, the raster pipeline through its own models) validates with
 * these before writing, because the Admin SDK bypasses the rules. M1 fixes the shapes; M2 refines
 * them with the handlers that write them. Firestore stores no nested arrays, so boxes are
 * `{west, south, east, north}` and positions `{lat, lng}` here, unlike the manifest.
 */
import { z } from 'zod';

import {
    analyticsSchema,
    basemapSchema,
    creditSchema,
    layerAdjustmentsSchema,
    layerSourceSchema,
    LICENSES,
    linkSchema,
    MAX_LINKS,
    themeSchema,
    LAYER_KINDS,
} from './manifest.js';
import {
    assetUrlSchema,
    bearingSchema,
    boundsRecordSchema,
    coded,
    fovSchema,
    httpsUrlSchema,
    idSchema,
    isoDateSchema,
    latLngSchema,
    localizedPartial,
    mapboxPublicTokenSchema,
    markdownText,
    opacitySchema,
    plainText,
    validYearRange,
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

/** Who last wrote a client-editable document, and when (`serverTimestamp()`; the rules check both). */
const stamp = { updatedBy: uidSchema, updatedAt: timestampSchema };

const localizedMarkdownPartial = z.strictObject({ ro: markdownText(10_000), en: markdownText(10_000).optional() });

/** `cities/{city}`. `id`, `mapbox` and `createdAt` are server-owned. */
export const cityDocSchema = z.strictObject({
    id: idSchema.optional(),
    name: localizedPartial(100),
    bounds: boundsRecordSchema,
    center: latLngSchema.optional(),
    zoom: zoomSchema.optional(),
    minZoom: zoomSchema.optional(),
    maxZoom: zoomSchema.optional(),
    about: localizedMarkdownPartial.optional(),
    privacy: localizedMarkdownPartial.optional(),
    credits: z.array(creditSchema).max(50).optional(),
    theme: themeSchema.optional(),
    basemap: basemapSchema.optional(),
    mapbox: z.strictObject({ user: z.string().max(64).optional(), publicToken: mapboxPublicTokenSchema.optional() }).optional(),
    analytics: analyticsSchema.optional(),
    engine: z.strictObject({ minVersion: versionSchema.optional() }).optional(),
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

/** `cities/{city}/layers/{layer}`: created by the pipeline; admins edit the presentation fields. */
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
    updatedBy: uidSchema.optional(),
    updatedAt: timestampSchema.optional(),
});

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
export type FirestoreLicense = (typeof FIRESTORE_LICENSES)[number];
export type JobStatus = (typeof JOB_STATUSES)[number];
export type JobType = (typeof JOB_TYPES)[number];
