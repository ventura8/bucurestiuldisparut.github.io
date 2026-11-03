/**
 * The local worker's five callables (M7, `docs/research/M7-local-worker.md` §2.4, §2.5): their request and response
 * schemas and their registry rows (`WORKER_CALLABLES`: access `cityEditor`, App Check off, two instances, owner
 * `fn-worker`). The functions and the tests read them through `CALLABLES` (`callables.ts`); the admin, which never calls
 * them, reads `ADMIN_CALLABLES` and the names alone (`CALLABLE_NAMES`), so none of this reaches its bundle.
 */
import { z } from 'zod';

import { idSchema } from '../schemas/primitives.js';
import { cityIdSchema } from '../schemas/paths.js';
import { JOB_STATUSES, WORKER_ID_PATTERN } from '../schemas/firestore-ops.js';
import { isoTimeSchema } from './common.js';
import type { CallableSpec, WorkerCallableName } from './registry.js';
import { WORKER_PAIR_CODE_PATTERN, WORKER_PAIR_ID_PATTERN, WORKER_URLS_MAX, WORKER_USGS_ENDPOINTS } from './worker.js';

const workerIdSchema = z.string().regex(WORKER_ID_PATTERN);
const versionSchema = z.string().regex(/^[0-9A-Za-z.+-]{1,40}$/);
/** A Firestore path the worker names (checked against the job's allow-list on the server, §2.5). */
const documentPathSchema = z.string().regex(/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+){1,5}$/);
/** An object path in the private bucket (checked against the job's allow-list). */
const objectPathSchema = z
    .string()
    .min(1)
    .max(1024)
    .regex(/^[A-Za-z0-9_./-]+$/)
    .refine((path) => !path.split('/').some((part) => part === '' || part === '.' || part === '..'));
/** A document's fields as JSON (timestamps as `{seconds, nanoseconds}`, a removed field as `{__hcmDelete: true}`). */
const fieldsSchema = z.record(z.string().min(1).max(200), z.unknown());
const updateTimeSchema = z.string().regex(/^\d{1,20}\.\d{9}$/);

const workerJobFields = { cityId: cityIdSchema, workerId: workerIdSchema, jobId: idSchema };

/** The pipeline image's digest (`sha256:<64 hex>`). */
const digestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
/**
 * `worker.hello`: the worker introduces itself (recorded in `cities/{city}/workers/{workerId}`). Finding 72: a worker the
 * starter's supervisor runs names the image it runs (`image`), which is compared with the installed one.
 */
export const workerHelloRequestSchema = z.strictObject({
    cityId: cityIdSchema,
    workerId: workerIdSchema,
    version: versionSchema,
    image: digestSchema.optional(),
});
export const workerHelloResponseSchema = z.strictObject({
    pollSeconds: z.number().int().min(1),
    heartbeatSeconds: z.number().int().min(1),
    /** The installed pipeline image (`setup/status.install.pipeline.image`), when one is recorded. */
    image: digestSchema.optional(),
    /** A paired worker whose image is not the installed one: it claims nothing until it runs the new command. */
    outdated: z.boolean().optional(),
});

/** `worker.claim`: the oldest due local job of the city, leased to this worker, or none. */
export const workerClaimRequestSchema = z.strictObject({ cityId: cityIdSchema, workerId: workerIdSchema });
export const workerClaimResponseSchema = z.strictObject({
    job: z.strictObject({ jobId: idSchema }).nullable(),
    /** True when the worker's image is not the installed one (no job is given to it). */
    outdated: z.boolean().optional(),
});

/**
 * `worker.pair` (no sign-in, finding 67): the one-time code of the admin's command, exchanged once for a Firebase custom
 * token of the owner who minted it, with the claims `worker: true`, `city` and `pair`. `replaces` is the pairing the
 * worker held before (a new command on the same computer): it is revoked when it is the same owner's, in the same city.
 */
const pairIdSchema = z.string().regex(WORKER_PAIR_ID_PATTERN);
export const workerPairRequestSchema = z.strictObject({
    cityId: cityIdSchema,
    code: z.string().regex(WORKER_PAIR_CODE_PATTERN),
    replaces: pairIdSchema.optional(),
});
export const workerPairResponseSchema = z.strictObject({ token: z.string().min(1).max(4096), pairId: pairIdSchema });

/**
 * `worker.image` (no sign-in, finding 72 of 2026-11-02, M7 §1.5): the installed pipeline image the starter's supervisor
 * pulls and runs, by digest, with its release: since finding 74 of 2026-11-03 the one the job `raster-pipeline` runs, with
 * its label's release, else `setup/status.install.pipeline`; `apiError.notFound` while neither names one. The image is public (Provision's `allUsers` reader of the repository `hcm`), so nothing here is a secret.
 */
export const workerImageRequestSchema = z.strictObject({});
export const workerImageResponseSchema = z.strictObject({
    image: z.string().regex(/^us-central1-docker\.pkg\.dev\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/hcm\/pipeline@sha256:[0-9a-f]{64}$/),
    digest: digestSchema,
    release: z.string().max(64).optional(),
});

/** `worker.step`: one document operation of the claimed job's run (the pipeline's `DocumentStore`). */
export const workerStepOpSchema = z.discriminatedUnion('op', [
    z.strictObject({ op: z.literal('get'), path: documentPathSchema }),
    z.strictObject({ op: z.literal('update'), path: documentPathSchema, fields: fieldsSchema, ifUpdateTime: updateTimeSchema.optional() }),
    z.strictObject({ op: z.literal('create'), path: documentPathSchema, data: fieldsSchema }),
    z.strictObject({ op: z.literal('list'), collection: documentPathSchema }),
]);
export const workerStepRequestSchema = z.strictObject({ ...workerJobFields, request: workerStepOpSchema });
export const workerStepResponseSchema = z.strictObject({
    data: fieldsSchema.nullable().optional(),
    /** The read's update time, `<seconds>.<nanoseconds>`: the compare-and-set of a later `update`. */
    updateTime: updateTimeSchema.nullable().optional(),
    ok: z.boolean().optional(),
    created: z.boolean().optional(),
    ids: z.array(idSchema).max(1000).optional(),
});

/** `worker.urls`: signed URLs of the job's objects, or one M2M call made with the server's USGS key. */
export const workerUrlsRequestSchema = z.strictObject({
    ...workerJobFields,
    request: z.discriminatedUnion('kind', [
        z.strictObject({
            kind: z.literal('objects'),
            objects: z
                .array(
                    z.strictObject({
                        path: objectPathSchema,
                        method: z.enum(['GET', 'PUT']),
                        contentType: z
                            .string()
                            .regex(/^[a-z]+\/[a-z0-9.+-]+$/)
                            .optional(),
                    }),
                )
                .min(1)
                .max(WORKER_URLS_MAX),
        }),
        z.strictObject({ kind: z.literal('usgs'), endpoint: z.enum(WORKER_USGS_ENDPOINTS), payload: fieldsSchema }),
    ]),
});
export const workerSignedObjectSchema = z.strictObject({
    path: objectPathSchema,
    url: z.url(),
    /** The method to send (`PUT` on Cloud Storage; the emulator's stand-in answers another). */
    method: z.enum(['GET', 'PUT', 'POST']),
    /** The headers the request must carry (a PUT's signed content type). */
    headers: z.record(z.string().max(100), z.string().max(4096)),
    expiresAt: isoTimeSchema,
    exists: z.boolean(),
    size: z.number().int().min(0).optional(),
    generation: z
        .string()
        .regex(/^\d{1,30}$/)
        .optional(),
    md5: z.string().max(64).optional(),
});
export const workerUrlsResponseSchema = z.strictObject({
    objects: z.array(workerSignedObjectSchema).max(WORKER_URLS_MAX).optional(),
    usgs: z.unknown().optional(),
});

/** `worker.end`: the run is over; a crash outside a step fails the job the worker still holds. */
export const workerEndRequestSchema = z.strictObject({
    ...workerJobFields,
    outcome: z.enum(['done', 'failed']),
    error: z.strictObject({ code: z.string().max(64), message: z.string().max(2000) }).optional(),
});
export const workerEndResponseSchema = z.strictObject({ status: z.enum(JOB_STATUSES) });

/**
 * A local worker's callable (M7): a city editor's ID token, or the token of a worker paired for the city (`workerToken`),
 * App Check off, two instances at most.
 */
function workerCallable<Request extends z.ZodType, Response extends z.ZodType>(request: Request, response: Response) {
    return { access: 'cityEditor', appCheck: 'off', maxInstances: 2, request, response, owner: 'fn-worker', workerToken: true } as const;
}

/** The worker's rows of the registry, one per name of `WORKER_CALLABLE_NAMES` (no more, no fewer). */
export const WORKER_CALLABLES = {
    'worker.hello': workerCallable(workerHelloRequestSchema, workerHelloResponseSchema),
    'worker.claim': workerCallable(workerClaimRequestSchema, workerClaimResponseSchema),
    'worker.step': workerCallable(workerStepRequestSchema, workerStepResponseSchema),
    'worker.urls': workerCallable(workerUrlsRequestSchema, workerUrlsResponseSchema),
    'worker.end': workerCallable(workerEndRequestSchema, workerEndResponseSchema),
    // Finding 67: no sign-in; the one-time code is the credential, the attempts are limited per city.
    'worker.pair': {
        access: 'none',
        appCheck: 'off',
        maxInstances: 2,
        request: workerPairRequestSchema,
        response: workerPairResponseSchema,
        owner: 'fn-worker',
    },
    // Finding 72: no sign-in; the starter's supervisor asks which image to run (public, read-only).
    'worker.image': {
        access: 'none',
        appCheck: 'off',
        maxInstances: 2,
        request: workerImageRequestSchema,
        response: workerImageResponseSchema,
        owner: 'fn-worker',
    },
} as const satisfies Readonly<Record<WorkerCallableName, CallableSpec>>;
