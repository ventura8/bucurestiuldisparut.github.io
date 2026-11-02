/**
 * M7: "Run on my computer" (`docs/research/M7-local-worker.md`). The local worker (`python -m hcm_pipeline worker`) speaks
 * to the server through five callables, `worker.hello`, `worker.claim`, `worker.step`, `worker.urls` and `worker.end`
 * (access `cityEditor`, App Check off: §2.4), each bound to the one job the worker claimed; their schemas are in
 * `worker-calls.ts`, which the admin never imports (it never calls them, and its bundle should not carry them). Here: the
 * constants of the worker (§1–§2), the free-tier estimate (§4) and the Uploads API path (§6), and `imagery.runOn`, with
 * which the admin chooses where a job runs.
 */
import { z } from 'zod';

import { coded, idSchema } from '../schemas/primitives.js';
import { cityIdSchema } from '../schemas/paths.js';
import { RUN_CHOICES, RUN_PLACES, type JobMachine } from '../schemas/firestore-ops.js';
import { STUDIO_MAX_BYTES } from '../schemas/imagery-publish.js';

/** The local page's port, on the computer's loopback only (`-p 127.0.0.1:8765:8765`). */
export const WORKER_PORT = 8765;
/** A worker seen this recently counts as connected (`auto` sends new jobs to the computer). */
export const WORKER_FRESH_SECONDS = 180;
/** How often an idle worker asks for a job (`worker.claim` also refreshes its `lastSeenAt`). */
export const WORKER_POLL_SECONDS = 30;
/** How long a signed URL of `worker.urls` works. */
export const WORKER_URL_SECONDS = 900;
/** At most this many objects per `worker.urls` call. */
export const WORKER_URLS_MAX = 20;
/** The lease owner of a worker's run: `worker:<workerId>` (a Cloud Run run's is `<execution>/<attempt>`). */
export const WORKER_LEASE_PREFIX = 'worker:';
/** The field value a `worker.step` update sends to remove a field (Firestore's `DELETE_FIELD` cannot travel as JSON). */
export const WORKER_DELETE_FIELD = '__hcmDelete';
/** The USGS M2M endpoints a worker may ask the server to call for its job (§2.5). */
export const WORKER_USGS_ENDPOINTS = ['download-options', 'download-request', 'download-retrieve', 'download-order-remove'] as const;

/**
 * Cloud Run's monthly free tier as the user gave it (request-based; jobs may count against the instance-based tier's
 * 240,000 vCPU-seconds and 450,000 GiB-seconds instead: UNVERIFIED, these lower figures are the conservative ones).
 */
export const CLOUD_RUN_FREE_TIER = { vcpuSeconds: 180_000, gibSeconds: 360_000 } as const;
/** The size of each Cloud Run job (`CLOUD_RUN_JOBS`). */
export const JOB_MACHINE_SIZES: Readonly<Record<JobMachine, { readonly vcpu: number; readonly gib: number }>> = {
    fetch: { vcpu: 1, gib: 4 },
    std: { vcpu: 4, gib: 16 },
    xl: { vcpu: 8, gib: 32 },
};
/** The estimate of one phase's run on each machine, in seconds: a download on `fetch`, a processing on `std` or `xl`. */
export const CLOUD_RUN_ESTIMATE_SECONDS: Readonly<Record<JobMachine, number>> = { fetch: 1800, std: 2700, xl: 3600 };

/** Mapbox's Uploads API: the megabytes a month it processes for free (no compute units; `platform-research.json`). */
export const MAPBOX_FREE_UPLOAD_MB = 10_000;
/** The largest file the free Uploads path sends: the Studio file's ceiling (Console uploads' free limit). */
export const UPLOADS_FREE_MAX_BYTES = STUDIO_MAX_BYTES;

/**
 * `imagery.runOn` (admin): without `jobId`, the city's remembered choice; with `jobId`, where that job runs (and the
 * city's choice with it), while it holds no run; `freeTierOk` is the OK to run it in the cloud past the free tier.
 */
export const imageryRunOnRequestSchema = z
    .strictObject({ cityId: cityIdSchema, jobId: idSchema.optional(), runOn: z.enum(RUN_CHOICES), freeTierOk: z.boolean().optional() })
    .refine((request) => request.jobId === undefined || request.runOn !== 'auto', coded('validation.format', ['runOn']));
export const imageryRunOnResponseSchema = z.strictObject({ choice: z.enum(RUN_CHOICES), runOn: z.enum(RUN_PLACES).optional() });
