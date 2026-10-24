/**
 * The M3 imagery backend (`docs/research/M3-interfaces.md` §3–§8; scenarios A11, A12, A14–A17, P01, P02): the callables
 * the admin's Imagery area, georeferencer and layer editor call, the publish task's payload, the raster upload's
 * metadata, and the limits the dispatcher, the pipeline and the publisher share. The registry rows (`registry.ts`,
 * owner `fn-imagery`) join with their implementation (§9 of the contract).
 */
import { z } from 'zod';

import { JOB_STATUSES, type JobDoc } from '../schemas/firestore-ops.js';
import { USGS_DATASETS } from '../schemas/firestore.js';
import { cropRingSchema, enabledGcps, GEOREF_TRANSFORMS, gcpSchema, MAX_GCPS, MIN_GCPS } from '../schemas/georef.js';
import { LAYER_VERSION_STATES, PUBLISH_CHOICES } from '../schemas/imagery.js';
import { cityIdSchema } from '../schemas/paths.js';
import { coded, idSchema, isoDateSchema, plainText } from '../schemas/primitives.js';
import { isoTimeSchema } from './common.js';
import { layerLinkRequestSchema } from './layers.js';

/** The two Cloud Run Job definitions (security review §4.1): 4 vCPU / 16 GiB, and 8 vCPU / 32 GiB. */
export const CLOUD_RUN_JOBS = { std: 'raster-pipeline', xl: 'raster-pipeline-xl' } as const;
/** The container arguments of every execution: run the job's remaining steps in order (`python -m hcm_pipeline run`). */
export const PIPELINE_RUN_ARGS = ['run'] as const;
/** The task queue of the publisher (`imagery.publish`: one at a time, at most two MTS calls a minute). */
export const IMAGERY_PUBLISH_QUEUE = 'imagery-publish';
/** `imagery.tick`: dispatch, resume, poll Mapbox, run due deletions and deferred publishes, the monthly harvest. */
export const IMAGERY_TICK_SCHEDULE = 'every 5 minutes';
/** At most this many raster jobs a day per project (security review §3.4), and this many running at once. */
export const JOBS_PER_DAY = 10;
export const RUNNING_JOBS_MAX = 2;
/** A job is tried at most this many times (dispatches, OOM on `xl` included) before it fails. */
export const JOB_MAX_ATTEMPTS = 3;
/**
 * A publish is started at most this many times in all (every delivery of a start task, Cloud Tasks' own retries and the
 * admin's Retry included): each start may stream the COG to Mapbox again, so a publish that keeps failing ends
 * `apiError.imagery.attemptsExhausted` instead of looping (security review of M3, findings 2 and 9).
 */
export const PUBLISH_MAX_ATTEMPTS = 6;
/** The pipeline's lease on its job, renewed by a heartbeat; an execution whose lease lapsed is lost. */
export const LEASE_SECONDS = 600;
export const HEARTBEAT_SECONDS = 60;
/** A job `starting` this long without an execution name is dispatched again. */
export const STARTING_STALE_MINUTES = 10;
/** The harvest runs again when a city's newest scene is older than this. */
export const HARVEST_EVERY_DAYS = 30;
/** A harvest that failed is tried again after this many hours, doubled after each further failure (at most a month). */
export const HARVEST_RETRY_HOURS = 1;
/** Browse copies: at most this size; the harvest copies the best-ranked ones ahead, the rest on demand. */
export const BROWSE_MAX_BYTES = 5_000_000;
export const BROWSE_PREFETCH = 20;
/** The publisher polls an MTS job after these delays, then every 15 minutes (`imagery.tick` as the safety net). */
export const PUBLISH_POLL_SECONDS = [60, 120, 300, 900] as const;
/** USGS maintenance (an HTML 503): the job waits this long, then doubles, at most 12 hours (security review §4.2). */
export const USGS_BACKOFF_MINUTES = [30, 60, 120, 240, 480, 720] as const;
/** `imagery.probeTiles`: one tile, at most this long and this large. */
export const PROBE_LIMITS = { timeoutMs: 5000, maxBytes: 2_000_000 } as const;

const versionIdField = { cityId: cityIdSchema, versionId: idSchema };

/** `imagery.search` (admin): search the city's bounds in the datasets (all three by default), harvest and rank. */
export const imagerySearchRequestSchema = z
    .strictObject({
        cityId: cityIdSchema,
        datasets: z.array(z.enum(USGS_DATASETS)).min(1).max(USGS_DATASETS.length).optional(),
        from: isoDateSchema.optional(),
        to: isoDateSchema.optional(),
    })
    .refine(
        (request) => request.from === undefined || request.to === undefined || request.from <= request.to,
        coded('validation.value', ['to']),
    );

export const imagerySearchResponseSchema = z.strictObject({
    found: z.number().int().min(0),
    added: z.number().int().min(0),
    updated: z.number().int().min(0),
    /** Datasets M2M did not answer for (the others are harvested; the screen names these). */
    failedDatasets: z.array(z.enum(USGS_DATASETS)).max(USGS_DATASETS.length),
    searchedAt: isoTimeSchema,
});

/** `imagery.browse` (admin): the scene's browse image in our bucket, copied from USGS first when missing. */
export const imageryBrowseRequestSchema = z.strictObject({ cityId: cityIdSchema, entityId: idSchema });
export const imageryBrowseResponseSchema = z.strictObject({ path: z.string().max(300), contentType: z.enum(['image/jpeg', 'image/png']) });

/** `imagery.import` (admin): import an already-scanned scene; the job, its version and the reserved layer id. */
export const imageryImportRequestSchema = z.strictObject({ cityId: cityIdSchema, entityId: idSchema });
export const imageryImportResponseSchema = z.strictObject({ jobId: idSchema, versionId: idSchema, layerId: idSchema });

/** `imagery.approve` and `imagery.reject` (admin) take one version. */
export const imageryVersionRequestSchema = z.strictObject(versionIdField);
export const imageryApproveResponseSchema = z.strictObject({ state: z.enum(LAYER_VERSION_STATES), jobId: idSchema });
export const imageryRejectResponseSchema = z.strictObject({ state: z.literal('rejected') });

/** `imagery.choose` (admin; App Check consume for `pay`): the way out of a publish that does not fit the month. */
export const imageryChooseRequestSchema = z.strictObject({ ...versionIdField, choice: z.enum(PUBLISH_CHOICES) });
export const imageryChooseResponseSchema = z.strictObject({
    state: z.enum(LAYER_VERSION_STATES),
    deferUntil: isoTimeSchema.optional(),
    /** `studio`: the Studio-sized GeoTIFF the admin downloads (Storage SDK) and uploads in Mapbox Studio. */
    studioPath: z.string().max(300).optional(),
});

/** `imagery.studioDone` (admin): find the tileset the admin uploaded in Studio and point the layer at it. */
export const imageryStudioDoneResponseSchema = z.strictObject({ tilesetId: z.string().max(100), layerId: idSchema });

/**
 * `imagery.saveGcps` (admin): the georeferencer's points. A version that waits for points (`needs_gcps`) continues its
 * own job; any other gets a new `regeoref` job and version, and the layer keeps its tiles until that one is published.
 */
export const imagerySaveGcpsRequestSchema = z
    .strictObject({
        ...versionIdField,
        transform: z.enum(GEOREF_TRANSFORMS),
        gcps: z.array(gcpSchema).max(MAX_GCPS),
        crop: cropRingSchema.optional(),
    })
    .refine((request) => enabledGcps(request.gcps) >= MIN_GCPS[request.transform], coded('validation.tooSmall', ['gcps']));

export const imagerySaveGcpsResponseSchema = z.strictObject({
    jobId: idSchema,
    versionId: idSchema,
    /** True when the waiting job continued; false when a new job started. */
    resumed: z.boolean(),
});

/** `imagery.crop` (admin): render the layer's current version again inside a polygon (`gdalwarp -cutline`). */
export const imageryCropRequestSchema = z.strictObject({ cityId: cityIdSchema, layerId: idSchema, ring: cropRingSchema });
export const imageryCropResponseSchema = z.strictObject({ jobId: idSchema, versionId: idSchema });

/**
 * Failures no retry cures (CR-M3-47): the admin fixes the cause first (a Mapbox token or its scopes: Setup's Mapbox step),
 * or the frame cannot be processed (out of memory on the large machine, the attempts used up). `imagery.retry` refuses
 * them and the admin's pages offer no Retry for them.
 */
export const NOT_RETRYABLE_CODES = [
    'apiError.mapbox.tokenInvalid',
    'apiError.mapbox.missingScopes',
    'apiError.mapbox.notConfigured',
    'apiError.imagery.outOfMemory',
    'apiError.imagery.attemptsExhausted',
] as const;

const NOT_RETRYABLE: ReadonlySet<string> = new Set(NOT_RETRYABLE_CODES);

type RetriedJob = Pick<JobDoc, 'status' | 'type' | 'layerId' | 'attempt' | 'publishAttempts' | 'error' | 'steps'>;

/** The job reached the publisher's guard: a retry starts the publish again, not a run. */
function atPublish(job: RetriedJob): boolean {
    return job.type === 'republish' || job.steps?.['guard'] !== undefined;
}

/** The attempts a retry would add to: the publish starts once the job reached the publisher's guard, else the runs. */
function attemptsLeft(job: RetriedJob): boolean {
    return atPublish(job) ? (job.publishAttempts ?? 0) < PUBLISH_MAX_ATTEMPTS : (job.attempt ?? 0) < JOB_MAX_ATTEMPTS;
}

/** A failure a retry may cure (none recorded counts as one). */
function curable(job: RetriedJob): boolean {
    return job.error === undefined || !NOT_RETRYABLE.has(job.error.code);
}

/**
 * A failed raster job a Retry may run again: not a tileset deletion, made with its layer version (an upload the server
 * refused has none: its cure is another file), a failure a retry can cure, attempts left (`imagery.retry` decides).
 */
export function jobRetryable(job: RetriedJob): boolean {
    return job.status === 'failed' && job.type !== 'layer-delete' && job.layerId !== undefined && curable(job) && attemptsLeft(job);
}

/**
 * `imagery.resumeGuard` (admin, App Check consume): turns the budget guard green again after the budget alert paused the
 * raster work, accepting this budget period's spend (`ops/guard.resumedFor`): the same period's alerts pause it no more.
 */
export const imageryResumeGuardRequestSchema = z.strictObject({});
export const imageryResumeGuardResponseSchema = z.strictObject({ state: z.literal('green') });

/** `imagery.retry` (admin): a failed job again, from its first unfinished step. */
export const imageryRetryRequestSchema = z.strictObject({ cityId: cityIdSchema, jobId: idSchema });
export const imageryRetryResponseSchema = z.strictObject({ status: z.enum(JOB_STATUSES), attempt: z.number().int().min(0) });

/**
 * `imagery.probeTiles` (admin): ask one tile of a source before linking it (`layers.link`), server-side, behind the
 * address guard of §8.3 (https on port 443, a public address, no redirect to another host).
 */
export const imageryProbeRequestSchema = z.strictObject({ cityId: cityIdSchema, source: layerLinkRequestSchema.shape.source });
export const imageryProbeResponseSchema = z.strictObject({
    contentType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
    tile: z.strictObject({ z: z.number().int().min(0).max(24), x: z.number().int().min(0), y: z.number().int().min(0) }),
});

/** A publish task (`imagery.publish`): start the publish of the job's version, or poll its MTS job (`poll` times so far). */
export const publishTaskSchema = z.strictObject({
    cityId: cityIdSchema,
    jobId: idSchema,
    phase: z.enum(['start', 'poll']),
    poll: z.number().int().min(0).max(100),
});

/**
 * The custom metadata of a raster upload (`RASTER_PATHS.upload`): the file's own name, the year it shows (Storage
 * metadata values are strings), and the layer whose image it replaces (`S-A14-HAPPY-REPLACE-SOURCE`). The upload's folder
 * id becomes the `geotiff-import` job's id.
 */
export const rasterUploadMetadataSchema = z.strictObject({
    originalName: plainText(255).optional(),
    year: z
        .string()
        .regex(/^(?:18|19|20)\d\d$/)
        .optional(),
    layerId: idSchema.optional(),
});

export type ImagerySearchRequest = z.infer<typeof imagerySearchRequestSchema>;
export type ImagerySearchResponse = z.infer<typeof imagerySearchResponseSchema>;
export type ImageryImportResponse = z.infer<typeof imageryImportResponseSchema>;
export type ImageryChooseRequest = z.infer<typeof imageryChooseRequestSchema>;
export type ImagerySaveGcpsRequest = z.infer<typeof imagerySaveGcpsRequestSchema>;
export type ImageryCropRequest = z.infer<typeof imageryCropRequestSchema>;
export type ImageryProbeRequest = z.infer<typeof imageryProbeRequestSchema>;
export type PublishTask = z.infer<typeof publishTaskSchema>;
export type RasterUploadMetadata = z.infer<typeof rasterUploadMetadataSchema>;
