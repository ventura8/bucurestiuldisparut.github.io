/**
 * The M3 raster work as stored (`docs/research/M3-interfaces.md` §4, §6): a **layer version** is one georeferenced
 * rendition of a scan on its way to a layer (`cities/{city}/layerVersions/{version}`, its id the id of the job that made
 * it), the parameters of each job type, and the steps each job type runs. A layer document exists only once a version
 * is published (or a tileset is linked); until then the version and its job are what the admin sees.
 */
import { z } from 'zod';

import { apiErrorCodeSchema, apiErrorParamsSchema } from '../api/errors.js';
import { layerDeleteParamsSchema } from '../api/layers.js';
import { gcpSuggestionsSchema } from './autogcp.js';
import { sha256Schema, stamp, timestampSchema, uidSchema } from './firestore-common.js';
import type { JobType } from './firestore-ops.js';
import { LAYER_TILESET_ORIGINS, USGS_DATASETS } from './firestore.js';
import { cropRingSchema, georefSchema, MAX_SCAN_PIXELS } from './georef.js';
import { boundsRecordSchema, coded, idSchema, isoDateSchema, localizedPartial, plainText, yearSchema, zoomSchema } from './primitives.js';
import { SENSORS } from './usgs-scene.js';

/**
 * Where a version stands. `processing`: its job runs; `needs_gcps`: the scan waits for the admin's points
 * (georeferencer); `awaiting_approval`: rendered, waits for Approve (or for a compute-unit choice); `approved`: queued to
 * publish; `publishing`: at Mapbox; `published`: the layer shows it; `rejected`, `superseded` (a newer one was published),
 * `failed`, `cancelled`: ended.
 */
export const LAYER_VERSION_STATES = [
    'processing',
    'needs_gcps',
    'awaiting_approval',
    'approved',
    'publishing',
    'published',
    'rejected',
    'superseded',
    'failed',
    'cancelled',
] as const;

export type LayerVersionState = (typeof LAYER_VERSION_STATES)[number];

/** States a version never leaves. */
export const ENDED_VERSION_STATES = ['published', 'rejected', 'superseded', 'failed', 'cancelled'] as const;

/** What a version was made from: a USGS scene, an uploaded GeoTIFF, new points on an earlier version, a crop of one. */
export const VERSION_ORIGINS = ['usgs', 'upload', 'regeoref', 'crop'] as const;

/** The compute-unit guard's three ways out when a publish does not fit the month (security review §3.3). */
export const PUBLISH_CHOICES = ['studio', 'defer', 'pay'] as const;

export type PublishChoice = (typeof PUBLISH_CHOICES)[number];

/**
 * The guard's verdict on a version: it fits, it does not fit the month's compute units, the tileset cap is reached,
 * Mapbox refused its file as too large (`apiError.imagery.sourceTooLarge`: only the free Studio upload is left), or (M5,
 * `docs/research/M5-interfaces.md` §1.8) it fits the project's month but not its city's share (`city-over`).
 */
export const GUARD_VERDICTS = ['within', 'over', 'tileset-limit', 'too-large', 'city-over'] as const;

/** Mapbox's processing precisions, by the tiles' maximum zoom (z ≤ 5, ≤ 10, ≤ 16, above). */
export const MTS_PRECISIONS = ['10m', '1m', '30cm', '1cm'] as const;

export type MtsPrecision = (typeof MTS_PRECISIONS)[number];

/** The scan preview's long side in pixels: what the georeferencer shows (`scan-preview.jpg`). */
export const SCAN_PREVIEW_MAX_PX = 4096;

const pathSchema = z.string().min(1).max(500);

const sourceSchema = z.discriminatedUnion('kind', [
    z.strictObject({
        kind: z.literal('usgs'),
        entityId: idSchema,
        dataset: z.enum(USGS_DATASETS),
        sensor: z.enum(SENSORS),
        acquisitionDate: isoDateSchema,
    }),
    z.strictObject({
        kind: z.literal('upload'),
        uploadPath: pathSchema,
        originalName: plainText(255).optional(),
        bytes: z.number().int().min(1),
    }),
]);

/** The cropped scan in pixel space: the georeferencer's left pane and the input of every later georeferencing. */
const scanSchema = z.strictObject({
    path: pathSchema,
    width: z.number().int().min(1).max(MAX_SCAN_PIXELS),
    height: z.number().int().min(1).max(MAX_SCAN_PIXELS),
    sha256: sha256Schema,
    previewPath: pathSchema,
    /** Preview pixels per scan pixel (at most 1): a GCP's preview position is `pixel × previewScale`. */
    previewScale: z.number().positive().max(1),
});

/** The reference rasters the pipeline fetched for the window (OSM data drawn as lines, Sentinel-2 L2A true colour). */
const referenceSchema = z.strictObject({
    bounds: boundsRecordSchema,
    osmPath: pathSchema.optional(),
    s2Path: pathSchema.optional(),
    /** The STAC item the Sentinel-2 window came from, and its date. */
    s2Item: z.string().max(200).optional(),
    s2Date: isoDateSchema.optional(),
});

/** What the render produced: the 8-bit COG Mapbox gets, the preview the admin sees, the Studio-sized GeoTIFF. */
const outputSchema = z.strictObject({
    cogPath: pathSchema,
    cogBytes: z.number().int().min(1),
    cogSha256: sha256Schema,
    /** An EPSG:3857 PNG of the warped layer and its bounds: the admin map's image source before any tiles exist. */
    previewPath: pathSchema,
    bounds: boundsRecordSchema,
    minzoom: zoomSchema,
    maxzoom: zoomSchema,
    /** The area of the warped footprint (inside the crop), km²: what the compute-unit estimate reads. */
    areaKm2: z.number().min(0),
    /** A JPEG-compressed GeoTIFF of at most `STUDIO_MAX_BYTES`, for the free Mapbox Studio upload. */
    studioPath: pathSchema.optional(),
    studioBytes: z.number().int().min(1).optional(),
});

const estimateSchema = z.strictObject({
    computeUnits: z.number().min(0),
    precision: z.enum(MTS_PRECISIONS),
    areaKm2: z.number().min(0),
    at: timestampSchema,
});

/** The compute-unit guard on this version: its verdict, and the choice an admin made when it did not fit. */
const guardSchema = z.strictObject({
    verdict: z.enum(GUARD_VERDICTS),
    /** Compute units left this month when it was checked. */
    available: z.number(),
    /** About how many US dollars the overage costs (the "Pay about $X" choice). */
    overageUsd: z.number().min(0).optional(),
    choice: z.enum(PUBLISH_CHOICES).optional(),
    chosenBy: uidSchema.optional(),
    chosenAt: timestampSchema.optional(),
    /** A deferred publish runs at this time (the first day of next month, UTC). */
    deferUntil: timestampSchema.optional(),
    checkedAt: timestampSchema,
});

const approvalSchema = z.strictObject({
    /** True when the policy approved it (auto-publish under the threshold); `by` is then `system:imagery`. */
    auto: z.boolean(),
    by: uidSchema,
    at: timestampSchema,
    checkpointRmseM: z.number().min(0).optional(),
    thresholdM: z.number().min(0).optional(),
});

const mapboxSchema = z.strictObject({
    tilesetId: z.string().max(100),
    sourceId: z.string().max(100).optional(),
    jobId: z.string().max(100).optional(),
    origin: z.enum(LAYER_TILESET_ORIGINS),
    /** km² processed per precision, as the MTS job reports it (`tileset_precisions`): the estimate's calibration. */
    precisions: z.record(z.enum(MTS_PRECISIONS), z.number().min(0)).optional(),
    publishedAt: timestampSchema.optional(),
});

/** The fields a version must carry in each state (beyond the always-required ones). */
const REQUIRED_BY_STATE: Readonly<Record<LayerVersionState, readonly ('scan' | 'georef' | 'output' | 'approval' | 'mapbox' | 'error')[]>> =
    {
        processing: [],
        needs_gcps: ['scan'],
        awaiting_approval: ['output'],
        approved: ['output', 'approval'],
        publishing: ['output', 'approval'],
        published: ['output', 'mapbox'],
        rejected: [],
        superseded: ['output', 'mapbox'],
        failed: ['error'],
        cancelled: [],
    };

function hasStateFields(version: { readonly state: LayerVersionState } & Partial<Record<string, unknown>>): boolean {
    return REQUIRED_BY_STATE[version.state].every((field) => version[field] !== undefined);
}

/** `cities/{city}/layerVersions/{version}`: written by the imagery callables, the pipeline and the publisher only. */
export const layerVersionDocSchema = z
    .strictObject({
        /** The layer it renders: an existing one (re-georeference, crop, replace) or the id reserved at Import. */
        layerId: idSchema,
        /** The job that made it; the version's id is the same. */
        jobId: idSchema,
        origin: z.enum(VERSION_ORIGINS),
        /** The version whose scan it reuses (`regeoref`, `crop`). */
        basedOn: idSchema.optional(),
        state: z.enum(LAYER_VERSION_STATES),
        source: sourceSchema.optional(),
        /** What a new layer gets at its first publish. */
        label: localizedPartial(200),
        year: yearSchema,
        date: isoDateSchema.optional(),
        sensor: z.enum(SENSORS).optional(),
        scan: scanSchema.optional(),
        reference: referenceSchema.optional(),
        georef: georefSchema.optional(),
        /** M4: the matcher's pairs below the confidence, for the georeferencer's Accept (never in the fit until saved). */
        suggestions: gcpSuggestionsSchema.optional(),
        crop: cropRingSchema.optional(),
        output: outputSchema.optional(),
        estimate: estimateSchema.optional(),
        guard: guardSchema.optional(),
        approval: approvalSchema.optional(),
        mapbox: mapboxSchema.optional(),
        error: z.strictObject({ code: apiErrorCodeSchema, params: apiErrorParamsSchema.optional() }).optional(),
        createdBy: uidSchema,
        createdAt: timestampSchema,
        ...stamp,
    })
    .refine(hasStateFields, coded('validation.required', ['state']));

export type LayerVersionDoc = z.infer<typeof layerVersionDocSchema>;

/** `usgs-import`: the scene to fetch (the layer is the job's `layerId`). */
export const usgsImportParamsSchema = z.strictObject({ entityId: idSchema, dataset: z.enum(USGS_DATASETS), sensor: z.enum(SENSORS) });

/** `geotiff-import`: the uploaded file; `replaces` when it replaces the image of the job's existing layer. */
export const geotiffImportParamsSchema = z.strictObject({
    uploadPath: pathSchema,
    originalName: plainText(255).optional(),
    replaces: z.boolean(),
});

/** `regeoref`: the version whose scan it renders again; the points and the crop are in its own version document. */
export const regeorefParamsSchema = z.strictObject({ basedOn: idSchema });

/** `republish`: an approved version to publish again (after a Mapbox failure, or a deferral). */
export const republishParamsSchema = z.strictObject({ versionId: idSchema });

/** The `params` schema of each job type: the dispatcher and the pipeline refuse a job whose params fail it. */
export const JOB_PARAMS_SCHEMAS: Readonly<Record<JobType, z.ZodType>> = {
    'usgs-import': usgsImportParamsSchema,
    'geotiff-import': geotiffImportParamsSchema,
    regeoref: regeorefParamsSchema,
    republish: republishParamsSchema,
    'layer-delete': layerDeleteParamsSchema,
};

/** The steps the raster pipeline runs (`pipeline/src/hcm_pipeline/steps/<step>.py`), in this order when a type has them. */
export const PIPELINE_STEPS = [
    'fetch',
    'extract',
    'stitch',
    'inspect',
    'locate',
    'reference',
    'georef',
    'warp',
    'export',
    'register',
] as const;

/** The steps the publisher runs (functions, `imagery.publish`), after approval. */
export const PUBLISH_STEPS = ['guard', 'upload', 'publish', 'tiles', 'finalize'] as const;

export type PipelineStep = (typeof PIPELINE_STEPS)[number];
export type PublishStep = (typeof PUBLISH_STEPS)[number];
export type JobStep = PipelineStep | PublishStep | 'delete';

/** Each job type's steps in order: the keys of the job's `steps`, which the Jobs page lists. */
export const JOB_STEPS: Readonly<Record<JobType, readonly JobStep[]>> = {
    'usgs-import': ['fetch', 'extract', 'stitch', 'locate', 'reference', 'georef', 'warp', 'export', 'register', ...PUBLISH_STEPS],
    'geotiff-import': ['inspect', 'reference', 'georef', 'warp', 'export', 'register', ...PUBLISH_STEPS],
    regeoref: ['georef', 'warp', 'export', 'register', ...PUBLISH_STEPS],
    republish: [...PUBLISH_STEPS],
    'layer-delete': ['delete'],
};

/** True for the job types the Cloud Run pipeline runs (the others run in functions). */
export function runsOnPipeline(type: JobType): boolean {
    return JOB_STEPS[type].some((step) => (PIPELINE_STEPS as readonly string[]).includes(step));
}
