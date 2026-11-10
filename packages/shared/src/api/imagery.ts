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
import { RECALIBRATE_MAX_POINTS, RECALIBRATE_STARTED, roughPointSchema } from '../schemas/imagery-recalibration.js';
import { JOIN_MAX_PARTS } from '../schemas/imagery-settings.js';
import { LAYER_VERSION_STATES, PUBLISH_CHOICES } from '../schemas/imagery.js';
import { cityIdSchema } from '../schemas/paths.js';
import { coded, idSchema, isoDateSchema, plainText } from '../schemas/primitives.js';
import { isoTimeSchema } from './common.js';
import { layerLinkRequestSchema } from './layers.js';

/**
 * The three Cloud Run Job definitions (security review §4.1; `JOB_MACHINES`): 1 vCPU / 4 GiB for an import's download
 * (finding 56 of 2026-11-01), 4 vCPU / 16 GiB, and 8 vCPU / 32 GiB.
 */
export const CLOUD_RUN_JOBS = { fetch: 'raster-fetch', std: 'raster-pipeline', xl: 'raster-pipeline-xl' } as const;
/** The container arguments of every execution: run the job's remaining steps in order (`python -m hcm_pipeline run`). */
export const PIPELINE_RUN_ARGS = ['run'] as const;
/** The task queue of the publisher (`imagery.publish`: one at a time, at most two MTS calls a minute). */
export const IMAGERY_PUBLISH_QUEUE = 'imagery-publish';
/** `imagery.tick`: dispatch, resume, poll Mapbox, run due deletions and deferred publishes, the monthly harvest. */
export const IMAGERY_TICK_SCHEDULE = 'every 5 minutes';
/** At most this many raster jobs a day per project (security review §3.4), and this many running at once. */
export const JOBS_PER_DAY = 10;
export const RUNNING_JOBS_MAX = 2;
/**
 * A job is tried at most this many times (dispatches, OOM on `xl` included) before it fails; the hand-over from the
 * download phase to the processing (finding 56) is no new try.
 */
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
/** M16: Approve of a recalibration not shown to be better (`recalibrationVerdict`) needs the owner's `acceptWorse`. */
export const imageryApproveRequestSchema = z.strictObject({ ...versionIdField, acceptWorse: z.literal(true).optional() });
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

/** M12: how long `imagery.previewUrl`'s address works: long enough to look at an image before approving it. */
export const IMAGERY_PREVIEW_URL_SECONDS = 3600;

/**
 * M12 (`imagery.previewUrl`, a city's editor; `docs/research/M12-own-tiles.md`): a signed address of the version's private archive, so
 * the admin sees it at full zoom before approving it. The address is a credential for its hour: never logged, never stored.
 */
export const imageryPreviewUrlResponseSchema = z.strictObject({
    url: z.string().min(1).max(4096),
    expiresAt: isoTimeSchema,
    bytes: z.number().int().min(1),
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

/**
 * M16 (`imagery.recalibrate`, `docs/research/M16-recalibrate.md`): a published version, or one waiting for approval, calibrated again from its
 * scan: Refine automatically (`auto`), or the admin's rough points snapped by the dense matching (`points`). A new `regeoref` version.
 */
export const imageryRecalibrateRequestSchema = z
    .strictObject({
        ...versionIdField,
        route: z.enum(RECALIBRATE_STARTED),
        points: z.array(roughPointSchema).min(1).max(RECALIBRATE_MAX_POINTS).optional(),
    })
    .refine((request) => (request.route === 'points') === (request.points !== undefined), coded('validation.value', ['points']));
export const imageryRecalibrateResponseSchema = z.strictObject({ jobId: idSchema, versionId: idSchema });

/** `imagery.crop` (admin): render the layer's current version again inside a polygon (`gdalwarp -cutline`). */
export const imageryCropRequestSchema = z.strictObject({ cityId: cityIdSchema, layerId: idSchema, ring: cropRingSchema });
export const imageryCropResponseSchema = z.strictObject({ jobId: idSchema, versionId: idSchema });

/**
 * `imagery.join` (M8, `docs/research/M8-join-interfaces.md` §2, §5): join frames of one date and one camera into one layer.
 * It imports the frames not imported yet and queues a `layer-join` job that waits for them; only this callable queues one.
 */
export const imageryJoinRequestSchema = z.strictObject({
    cityId: cityIdSchema,
    entityIds: z.array(idSchema).min(2).max(JOIN_MAX_PARTS),
});
export const imageryJoinResponseSchema = z.strictObject({ jobId: idSchema, versionId: idSchema, layerId: idSchema });

/**
 * Failures no retry cures (CR-M3-47): the admin fixes the cause first (a Mapbox token or its scopes: Setup's Mapbox step),
 * or the job used up its attempts. `imagery.retry` refuses them and the admin's pages offer no Retry for them. Out of
 * memory on the large machine is retried (finding 58 of 2026-11-01: a later pipeline may fit it, finding 57). M8: a join's
 * frames too far apart or adding nothing are measured the same way again; only **Join frames** with the fixed frames cures them.
 * `joinPartGone` stays: the frame's own retry can bring it back, and the join with it. Batch 4: `joinPartTaken` (a newer join of the date
 * holds the frame) never comes back: that join is the one to open.
 */
export const NOT_RETRYABLE_CODES = [
    'apiError.mapbox.tokenInvalid',
    'apiError.mapbox.missingScopes',
    'apiError.mapbox.notConfigured',
    'apiError.imagery.attemptsExhausted',
    'apiError.imagery.joinSeamTooFar',
    'apiError.imagery.joinNoFrames',
    'apiError.imagery.joinPartMissing',
    'apiError.imagery.joinPartTaken',
] as const;

const NOT_RETRYABLE: ReadonlySet<string> = new Set(NOT_RETRYABLE_CODES);

type RetriedJob = Pick<JobDoc, 'status' | 'type' | 'layerId' | 'attempt' | 'publishAttempts' | 'error' | 'steps' | 'cancelRequested'>;

/**
 * The job reached the publisher's guard: a retry starts the publish again, not a run. A guard still `pending` was not
 * reached (the pipeline lists every step from the start: an exhausted import offered Retry, 2026-11-09).
 */
function atPublish(job: RetriedJob): boolean {
    const guard = job.steps?.['guard']?.status;
    return job.type === 'republish' || (guard !== undefined && guard !== 'pending');
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
 * A failed job with work to run again: not a tileset deletion, made with its layer version (an upload the server refused
 * has none: its cure is another file), not dismissed (a dismissal marks its failed job `cancelRequested`: the version is
 * `rejected`, and `imagery.retry` refuses it).
 */
function failedWork(job: RetriedJob): boolean {
    return job.status === 'failed' && job.type !== 'layer-delete' && job.layerId !== undefined && job.cancelRequested !== true;
}

/**
 * A stopped job with work to run again: not a tileset deletion, made with its layer version, not dismissed (a dismissal
 * marks the job `cancelRequested`: the version is `rejected`, and `imagery.retry` refuses it).
 */
function cancelledWork(job: RetriedJob): boolean {
    return job.status === 'cancelled' && job.type !== 'layer-delete' && job.layerId !== undefined && job.cancelRequested !== true;
}

/** The code an outdated runner fails a job with. */
export const PIPELINE_OUTDATED = 'apiError.imagery.pipelineOutdated';

/** The legacy form of an outdated runner's failure, before it had its own code (jobs failed so are still in Firestore). */
const OUTDATED_DETAIL = /the pipeline does not run [a-z-]+ jobs/;

/**
 * The job failed because the runner's pipeline was older than its type (`apiError.imagery.pipelineOutdated`, or the legacy
 * `apiError.invalidRequest` naming the type): no attempt was really spent, so a retry is allowed whatever the count and
 * starts the count again.
 */
export function failedOutdated(job: Pick<JobDoc, 'error'>): boolean {
    const error = job.error;
    if (error === undefined) {
        return false;
    }
    return error.code === PIPELINE_OUTDATED || (error.code === 'apiError.invalidRequest' && OUTDATED_DETAIL.test(error.message));
}

/** A failed or stopped raster job a Retry may run again: a curable failure with attempts left, or an outdated runner's (`imagery.retry` decides). */
export function jobRetryable(job: RetriedJob): boolean {
    if (cancelledWork(job)) {
        return attemptsLeft(job);
    }
    return failedWork(job) && curable(job) && (attemptsLeft(job) || failedOutdated(job));
}

/**
 * `imagery.resumeGuard` (admin, App Check consume): turns the budget guard green again after the budget alert paused the
 * raster work, accepting this budget period's spend (`ops/guard.resumedFor`): the same period's alerts pause it no more.
 */
export const imageryResumeGuardRequestSchema = z.strictObject({});
export const imageryResumeGuardResponseSchema = z.strictObject({ state: z.literal('green') });

/** `imagery.retry` (admin): a failed job again, keeping what is costly or gone (`functions/src/imagery/retry.ts`). */
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
export type ImageryJoinRequest = z.infer<typeof imageryJoinRequestSchema>;
export type ImageryJoinResponse = z.infer<typeof imageryJoinResponseSchema>;
export type PublishTask = z.infer<typeof publishTaskSchema>;
export type RasterUploadMetadata = z.infer<typeof rasterUploadMetadataSchema>;
