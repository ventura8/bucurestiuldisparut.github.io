/**
 * M7 documents (`docs/research/M7-local-worker.md` §2.4, §3, §4.2): a city's local workers, its remembered choice of
 * where raster jobs run, and the month's Cloud Run use (an estimate against the free tier). Written by the functions only;
 * a city's members read the first two, every admin the third (`usage/*`).
 */
import { z } from 'zod';

import { stamp, timestampSchema, uidSchema } from './firestore-common.js';
import { RUN_CHOICES } from './firestore-ops.js';
import { idSchema } from './primitives.js';

/** What a worker is doing: waiting for a job, or running one. */
export const WORKER_STATES = ['idle', 'busy'] as const;

/** `cities/{city}/workers/{workerId}`: one local worker process, refreshed by `worker.hello` and `worker.claim`. */
export const workerDocSchema = z.strictObject({
    uid: uidSchema,
    version: z.string().regex(/^[0-9A-Za-z.+-]{1,40}$/),
    startedAt: timestampSchema,
    lastSeenAt: timestampSchema,
    state: z.enum(WORKER_STATES),
    jobId: idSchema.optional(),
    lastJob: z.strictObject({ id: idSchema, outcome: z.enum(['done', 'failed']), at: timestampSchema }).optional(),
    ...stamp,
});

/** `cities/{city}/workers/choice`: where the city's raster jobs run by default (`auto` when absent). */
export const runChoiceDocSchema = z.strictObject({ choice: z.enum(RUN_CHOICES), ...stamp });

/** `usage/cloudrun-YYYY-MM`: the month's counted cloud runs, seconds × each machine's vCPUs and GiB. */
export const cloudRunUsageDocSchema = z.strictObject({
    month: z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/),
    vcpuSeconds: z.number().min(0),
    gibSeconds: z.number().min(0),
    runs: z.number().int().min(0),
    ...stamp,
});

export type WorkerDoc = z.infer<typeof workerDocSchema>;
export type RunChoiceDoc = z.infer<typeof runChoiceDocSchema>;
export type CloudRunUsageDoc = z.infer<typeof cloudRunUsageDocSchema>;
