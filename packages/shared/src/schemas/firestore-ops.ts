/**
 * Firestore operational documents (PLAN → Data; security review §1.2, §3.3, §3.4, §4): raster jobs and their logs,
 * harvested USGS scenes, the non-secret setup health `setup/status`, admins and invitations, the Mapbox usage
 * counters, the budget guard and the state of each city's manifest build. Content documents are in `firestore.ts`,
 * paths in `paths.ts`. No document here ever holds a secret (Secret Manager does) or an e-mail address in clear
 * outside `admins/{uid}` (invitations store `sha256(lowercase email)` as their id only).
 */
import { z } from 'zod';

import { apiErrorCodeSchema, apiErrorParamsSchema } from '../api/errors.js';
import { sha256Schema, stamp, timestampSchema, uidSchema } from './firestore-common.js';
import { httpsOriginSchema, mapboxTokenIdSchema } from './firestore.js';
import {
    coded,
    firebaseAppIdsSchema,
    httpsUrlSchema,
    idSchema,
    mapboxPublicTokenSchema,
    measurementIdSchema,
    plainText,
    type ValidationCode,
} from './primitives.js';
import { isValidationCode } from './validation.js';

export { USGS_SCENE_STATUSES, usgsSceneDocSchema, type UsgsSceneDoc } from './usgs-scene.js';

/** The jobs an admin may queue with the Firestore SDK (`firebase/firestore.rules` lists the same four). */
export const CLIENT_JOB_TYPES = ['usgs-import', 'geotiff-import', 'regeoref', 'republish'] as const;
/** Every job type: the client's, and `layer-delete`, which only `layers.delete` queues (CR-M2c-3). */
export const JOB_TYPES = [...CLIENT_JOB_TYPES, 'layer-delete'] as const;
/** The job state machine of security review §4.1. */
export const JOB_STATUSES = [
    'queued',
    'starting',
    'running',
    'waiting_usgs',
    'mts_processing',
    'awaiting_approval',
    /** M3: the scan is ready but has no georeference (the matcher found too few pairs, or an upload carries none). */
    'awaiting_gcps',
    'succeeded',
    'failed',
    'cancelled',
] as const;
/** The statuses a job never leaves (the rules refuse a cancellation of these). */
export const FINISHED_JOB_STATUSES = ['succeeded', 'failed', 'cancelled'] as const;
/**
 * Why an unfinished job is not running (`docs/research/M3-interfaces.md` §4.2): USGS preparing the download or in
 * maintenance, rate limited, the two-running-jobs cap, the budget guard, the admin's points or approval, the compute-unit
 * guard's choice, a publish deferred to next month, Mapbox processing.
 */
export const JOB_WAIT_REASONS = [
    'usgs-preparing',
    'usgs-maintenance',
    'rate-limited',
    'capacity',
    'guard',
    'gcps',
    'approval',
    'compute-units',
    'deferred',
    'mapbox',
] as const;
export const JOB_STEP_STATES = ['pending', 'running', 'done', 'failed', 'skipped'] as const;
/** The two Cloud Run Job definitions (security review §4.1): `std` 4 vCPU / 16 GiB, `xl` 8 vCPU / 32 GiB. */
export const JOB_MACHINES = ['std', 'xl'] as const;
export const JOB_LOG_LEVELS = ['info', 'warn', 'error'] as const;
/**
 * Where a connected service stands: never configured, waiting for someone outside (USGS M2M approval), verified,
 * rejected on its last check, or not answering (maintenance, 5xx: checked again later).
 */
export const SERVICE_STATES = ['missing', 'pending', 'ok', 'invalid', 'unavailable'] as const;
/** The Setup Assistant's cards, in screen order (`setup/status` has one record per area). */
export const SETUP_AREAS = ['billing', 'provision', 'mapbox', 'usgs', 'analytics', 'crash'] as const;
/**
 * The items of the "Provision cloud" doctor (PLAN Addendum 1, security review §1, §2), in screen order;
 * `docs/research/M2b-interfaces.md` §3.4 says what each one creates and in which order the provisioner runs them.
 * `crash-alerts` (the Cloud Monitoring e-mail channel and alert policy for new crash reports) and `api-key` (the
 * browser API key's referrer restriction) joined in M2b.
 */
export const PROVISION_ITEMS = [
    'apis',
    'service-accounts',
    'iam',
    'buckets',
    'bucket-cors',
    'bucket-lifecycle',
    'secrets',
    'task-queues',
    'scheduler',
    'workload-identity',
    'app-check',
    'budget-alerts',
    'org-policies',
    'crash-alerts',
    'api-key',
] as const;
/** `search` until USGS approves the M2M download role, then `download`. */
export const USGS_ROLES = ['search', 'download'] as const;
export const ADMIN_ROLES = ['owner', 'admin'] as const;
export const GUARD_STATES = ['green', 'red'] as const;
export const GUARD_REASONS = ['budget', 'manual'] as const;
/** The steps of `ops.tick`, in the order it runs them (`docs/research/M2-interfaces.md` → `ops.tick`). */
export const OPS_STEPS = ['guard', 'jobs', 'mts', 'manifests', 'health', 'tokens', 'invites', 'users'] as const;
export const MANIFEST_BUILD_STATES = ['idle', 'queued', 'building', 'failed'] as const;
/** Entities a manifest build may skip (an invalid document is skipped and flagged, never fails the manifest). */
export const MANIFEST_ENTITIES = ['layer', 'photo', 'poi', 'poiCategory'] as const;

const stepNameSchema = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/);

/**
 * `cities/{city}/jobs/{job}`: admins may set `cancelRequested`; the callables that queue work (`layers.delete`, the M3
 * `imagery.*`), the dispatcher and the raster pipeline own every other field (security review §4.1: lease, heartbeat,
 * idempotent steps; `docs/research/M3-interfaces.md` §4: who writes which field in which status).
 */
export const jobDocSchema = z.strictObject({
    type: z.enum(JOB_TYPES),
    status: z.enum(JOB_STATUSES),
    params: z.record(z.string().max(64), z.unknown()),
    createdBy: uidSchema,
    createdAt: timestampSchema,
    cancelRequested: z.boolean().optional(),
    step: stepNameSchema.optional(),
    progress: z.number().min(0).max(1).optional(),
    retryAt: timestampSchema.optional(),
    dispatchAt: timestampSchema.optional(),
    executionName: z.string().max(500).optional(),
    machine: z.enum(JOB_MACHINES).optional(),
    attempt: z.number().int().min(0).max(10).optional(),
    /**
     * M3: how many times the publisher started this job's publish (`PUBLISH_MAX_ATTEMPTS`; every delivery of a start task
     * counts, so a publish that keeps failing ends instead of streaming its COG to Mapbox again and again).
     */
    publishAttempts: z.number().int().min(0).max(50).optional(),
    lease: z.strictObject({ owner: z.string().min(1).max(200), until: timestampSchema }).optional(),
    steps: z
        .record(
            stepNameSchema,
            z.strictObject({
                status: z.enum(JOB_STEP_STATES),
                gcsPath: z.string().max(1024).optional(),
                generation: z
                    .string()
                    .regex(/^\d{1,30}$/)
                    .optional(),
                sha256: sha256Schema.optional(),
                bytes: z.number().int().min(0).optional(),
                startedAt: timestampSchema.optional(),
                finishedAt: timestampSchema.optional(),
            }),
        )
        .refine((steps) => Object.keys(steps).length <= 30, coded('validation.tooBig'))
        .optional(),
    mapboxJobId: z.string().max(100).optional(),
    /** `code` is an `apiError.*` code from M3 on (`params` fills its message); `message` is the redacted technical detail. */
    error: z.strictObject({ code: z.string().max(64), message: plainText(2000), params: apiErrorParamsSchema.optional() }).optional(),
    /** M3: the layer the job works for (reserved at Import for a new one). */
    layerId: idSchema.optional(),
    /** M3: the layer version it produces (its own id) or publishes (`republish`). */
    versionId: idSchema.optional(),
    /** M3: why an unfinished job is not running. */
    waitReason: z.enum(JOB_WAIT_REASONS).optional(),
    startedAt: timestampSchema.optional(),
    finishedAt: timestampSchema.optional(),
    ...stamp,
});

/** `cities/{city}/jobs/{job}/logs/{line}` (id: `seq` zero-padded to 6 digits): redacted, at most 500 per job. */
export const jobLogDocSchema = z.strictObject({
    seq: z.number().int().min(0).max(999_999),
    level: z.enum(JOB_LOG_LEVELS),
    step: stepNameSchema.optional(),
    message: plainText(2000),
    ...stamp,
});

/** The health every `setup/status` area shares; `detail` says why, as an error code with its parameters. */
const health = {
    state: z.enum(SERVICE_STATES),
    checkedAt: timestampSchema.optional(),
    detail: apiErrorCodeSchema.optional(),
    params: apiErrorParamsSchema.optional(),
};

const billingStatusSchema = z.strictObject({
    ...health,
    /** `billingAccounts/{account}/budgets/{budget}` of the $5 budget the Setup Assistant created. */
    budgetId: z
        .string()
        .regex(/^billingAccounts\/[A-Z0-9-]{1,40}\/budgets\/[a-z0-9-]{1,64}$/)
        .optional(),
    budgetAmount: z.number().min(0).max(1_000_000).optional(),
    currency: z
        .string()
        .regex(/^[A-Z]{3}$/)
        .optional(),
});

const provisionItemSchema = z.strictObject({ id: z.enum(PROVISION_ITEMS), ...health });

const provisionStatusSchema = z.strictObject({ ...health, items: z.array(provisionItemSchema).max(PROVISION_ITEMS.length).optional() });

const mapboxStatusSchema = z.strictObject({
    ...health,
    user: z
        .string()
        .regex(/^[a-z0-9_-]{1,64}$/)
        .optional(),
    /** The scopes of the pasted secret token (its value is in Secret Manager only). */
    scopes: z
        .array(z.string().regex(/^[a-z]{1,20}:[a-z]{1,20}$/))
        .max(30)
        .optional(),
    tilesTokenId: mapboxTokenIdSchema.optional(),
    /** The admin's own URL-restricted public token (public by design: it only works from the admin's origins). */
    adminToken: mapboxPublicTokenSchema.optional(),
    adminTokenId: mapboxTokenIdSchema.optional(),
    adminAllowedUrls: z.array(httpsOriginSchema).max(10).optional(),
    /** Replaced public tokens, deleted by `ops.tick` once `retireAt` has passed (security review §1.3: 10 minutes). */
    retiring: z
        .array(z.strictObject({ tokenId: mapboxTokenIdSchema, retireAt: timestampSchema }))
        .max(10)
        .optional(),
});

const usgsStatusSchema = z.strictObject({
    ...health,
    role: z.enum(USGS_ROLES).optional(),
    /** While `pending`, `ops.tick` checks the M2M role again at this time (every 6 hours). */
    nextCheckAt: timestampSchema.optional(),
    /** The application token's expiry when the admin chose one; a reminder comes 14 days before. */
    tokenExpiresAt: timestampSchema.optional(),
});

const analyticsStatusSchema = z.strictObject({
    ...health,
    measurementId: measurementIdSchema.optional(),
    appId: firebaseAppIdsSchema.shape.appId.optional(),
});

const crashStatusSchema = z.strictObject({ ...health, lastReportAt: timestampSchema.optional() });

/**
 * `setup/status`: the non-secret integration health the Setup Assistant shows (one record per `SETUP_AREAS` entry),
 * written by the `setup.*` callables, `ops.tick` and `telemetry.reportError`. Secrets live in Secret Manager only:
 * `secretsRev` is bumped on every secret write so each instance drops its cached values.
 */
export const setupStatusDocSchema = z.strictObject({
    billing: billingStatusSchema.optional(),
    provision: provisionStatusSchema.optional(),
    mapbox: mapboxStatusSchema.optional(),
    usgs: usgsStatusSchema.optional(),
    analytics: analyticsStatusSchema.optional(),
    crash: crashStatusSchema.optional(),
    secretsRev: z.number().int().min(0).optional(),
    ...stamp,
});

/** `admins/{uid}`: written by `admin.claim`, `admin.join`, `admins.revoke` and the bootstrap script only. */
export const adminDocSchema = z.strictObject({
    role: z.enum(ADMIN_ROLES),
    /** From the verified Google ID token, shown in the admins list; deleted with the document (GDPR). */
    email: z.email().max(254).optional(),
    displayName: plainText(200).optional(),
    invitedBy: uidSchema.optional(),
    createdAt: timestampSchema,
    ...stamp,
});

/**
 * `setup/owner`: who claimed the map (`admin.claim`, created once: a second claim finds it). A uid only, never an
 * address; the owner's `admins/{uid}` document says the rest.
 */
export const ownerDocSchema = z.strictObject({
    uid: uidSchema,
    claimedAt: timestampSchema,
    ...stamp,
});

/**
 * `invites/{sha256(lowercase email)}` (`inviteIdFor`): written by `admins.invite`, deleted by `admin.join` (accepted),
 * `admins.revoke` and `ops.tick` (expired). The address itself is never stored.
 */
export const inviteDocSchema = z.strictObject({
    role: z.literal('admin'),
    invitedBy: uidSchema,
    createdAt: timestampSchema,
    expiresAt: timestampSchema,
    ...stamp,
});

/** `usage/mapbox-YYYY-MM`: the month-to-date Mapbox counters the compute-unit guard reads (security review §3.3). */
export const usageDocSchema = z.strictObject({
    month: z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/),
    computeUnits: z.number().min(0),
    computeUnitBudget: z.number().min(0),
    uploadedMb: z.number().min(0),
    publishes: z.number().int().min(0),
    studioUploads: z.number().int().min(0).optional(),
    /**
     * M3: compute units held for publishes under way (by layer version), released or counted when Mapbox answers, so two
     * publishes never both fit in the same remaining budget (`docs/research/M3-interfaces.md` §7.2).
     */
    reservations: z
        .record(
            idSchema,
            z.strictObject({
                computeUnits: z.number().min(0),
                at: timestampSchema,
                /** The publish makes a tileset its layer did not have yet: the tileset cap counts it (CR-M3-47). */
                newTileset: z.boolean().optional(),
            }),
        )
        .refine((held) => Object.keys(held).length <= 50, coded('validation.tooBig'))
        .optional(),
    /** M3: compute units over the budget that an admin chose to pay for this month ("Pay about $X"). */
    overageComputeUnits: z.number().min(0).optional(),
    ...stamp,
});

const tickStepSchema = z.strictObject({ step: z.enum(OPS_STEPS), ok: z.boolean(), detail: apiErrorCodeSchema.optional() });

/**
 * `ops/guard`: `red` pauses raster dispatch, MTS publishes and AI assists, never the public site (security review
 * §3.4); `ops.onBudget` turns it red, an admin turns it green again. `lastTick` is what the last `ops.tick` did.
 */
export const opsGuardDocSchema = z.strictObject({
    state: z.enum(GUARD_STATES),
    reason: z.enum(GUARD_REASONS).optional(),
    since: timestampSchema.optional(),
    /** What the budget alert that turned it red said: the cost so far and the budget, in the billing account's currency. */
    spend: z
        .strictObject({
            costAmount: z.number().min(0),
            budgetAmount: z.number().min(0),
            currency: z
                .string()
                .regex(/^[A-Z]{3}$/)
                .optional(),
            /** The budget period the alert counts (`costIntervalStart`). */
            interval: z.string().max(40).optional(),
        })
        .optional(),
    /** Who turned it green again (`imagery.resumeGuard`), when, and the budget period whose spend they accepted. */
    resumedBy: uidSchema.optional(),
    resumedAt: timestampSchema.optional(),
    resumedFor: z.string().max(40).optional(),
    lastTick: z.strictObject({ ranAt: timestampSchema, steps: z.array(tickStepSchema).max(OPS_STEPS.length) }).optional(),
    lastNightlyAt: timestampSchema.optional(),
    ...stamp,
});

/**
 * `ops/dispatch`: the Cloud Run executions the dispatcher handed out (CR-M3-47), one slot per job that holds one, read
 * and written in the same transaction that moves a job to `starting`, so two dispatchers never both take the last place
 * of `RUNNING_JOBS_MAX`. A slot whose job no longer holds an execution is dropped by the next dispatch.
 */
export const opsDispatchDocSchema = z.strictObject({
    slots: z
        .record(z.string().regex(/^[a-z0-9-]{1,40}\/[A-Za-z0-9_-]{1,40}$/), z.strictObject({ at: timestampSchema }))
        .refine((slots) => Object.keys(slots).length <= 20, coded('validation.tooBig')),
    ...stamp,
});

/** How a city's last USGS harvest went: found scenes, found none, or USGS did not answer (every dataset failed). */
export const HARVEST_OUTCOMES = ['ok', 'empty', 'failed'] as const;

/**
 * `ops/harvest-{city}`: the city's last harvest attempt (CR-M3-47), written on every attempt, so the monthly harvest of
 * `imagery.tick` is keyed on what the harvest itself wrote: the next one is due at `nextAt` (a month after a harvest that
 * answered, an hour after a failure, doubled after each further one), never every five minutes.
 */
export const harvestStateDocSchema = z.strictObject({
    attemptedAt: timestampSchema,
    outcome: z.enum(HARVEST_OUTCOMES),
    /** Failures in a row (0 after a harvest that answered). */
    failures: z.number().int().min(0).max(1000),
    nextAt: timestampSchema,
    error: apiErrorCodeSchema.optional(),
    ...stamp,
});

const skippedDocumentSchema = z.strictObject({
    entity: z.enum(MANIFEST_ENTITIES),
    id: idSchema,
    code: z.custom<ValidationCode>((value) => typeof value === 'string' && isValidationCode(value), coded('validation.value')),
    path: z.string().max(200),
});

/**
 * `manifests/{city}`: the city's manifest builds (security review §4.5). Triggers bump `requestedVersion`; the
 * serialized builder records what it published. Admins read it (the "Published" chip); only the builder writes it.
 */
export const manifestStateDocSchema = z.strictObject({
    requestedVersion: z.number().int().min(0),
    builtVersion: z.number().int().min(0),
    status: z.enum(MANIFEST_BUILD_STATES),
    builtAt: timestampSchema.optional(),
    url: httpsUrlSchema.optional(),
    sha256: sha256Schema.optional(),
    bytes: z.number().int().min(0).optional(),
    counts: z
        .strictObject({
            layers: z.number().int().min(0),
            photos: z.number().int().min(0),
            pois: z.number().int().min(0),
            poiCategories: z.number().int().min(0),
        })
        .optional(),
    skipped: z.array(skippedDocumentSchema).max(100).optional(),
    error: apiErrorCodeSchema.optional(),
    ...stamp,
});

export type JobDoc = z.infer<typeof jobDocSchema>;
export type JobLogDoc = z.infer<typeof jobLogDocSchema>;
export type SetupStatusDoc = z.infer<typeof setupStatusDocSchema>;
export type AdminDoc = z.infer<typeof adminDocSchema>;
export type InviteDoc = z.infer<typeof inviteDocSchema>;
export type OwnerDoc = z.infer<typeof ownerDocSchema>;
export type UsageDoc = z.infer<typeof usageDocSchema>;
export type OpsGuardDoc = z.infer<typeof opsGuardDocSchema>;
export type OpsDispatchDoc = z.infer<typeof opsDispatchDocSchema>;
export type HarvestStateDoc = z.infer<typeof harvestStateDocSchema>;
export type ManifestStateDoc = z.infer<typeof manifestStateDocSchema>;
export type JobStatus = (typeof JOB_STATUSES)[number];
export type JobType = (typeof JOB_TYPES)[number];
export type JobWaitReason = (typeof JOB_WAIT_REASONS)[number];
export type ServiceState = (typeof SERVICE_STATES)[number];
export type SetupArea = (typeof SETUP_AREAS)[number];
export type ProvisionItem = (typeof PROVISION_ITEMS)[number];
export type AdminRole = (typeof ADMIN_ROLES)[number];
export type UsgsRole = (typeof USGS_ROLES)[number];
export type OpsStep = (typeof OPS_STEPS)[number];
