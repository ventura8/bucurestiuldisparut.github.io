/**
 * M7 documents (`docs/research/M7-local-worker.md` §2.4, §3, §4.2): a city's local workers, its remembered choice of
 * where raster jobs run, and the month's Cloud Run use (an estimate against the free tier). Written by the functions only;
 * a city's members read the first two, every admin the third (`usage/*`).
 */
import { z } from 'zod';

import { stamp, timestampSchema, uidSchema } from './firestore-common.js';
import { RUN_CHOICES } from './firestore-ops.js';
import { idSchema } from './primitives.js';

const PAIR_ID = /^[0-9a-f]{40}$/;
const digestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);

/** What a worker is doing: waiting for a job, or running one. */
export const WORKER_STATES = ['idle', 'busy'] as const;

/** The local AI on a worker's computer (`docs/research/M10-local-ai.md`): waiting for a frame, getting ready, running, or why not. */
export const WORKER_AI_STATES = ['idle', 'preparing', 'ready', 'unavailable'] as const;

/** Why the local AI is unavailable, in words the panel has (`adminWorker.ai.why.*`). */
export const WORKER_AI_WHYS = ['old-starter', 'arm64', 'disk', 'pull', 'tampered', 'unreachable', 'no-answer', 'garbage'] as const;

export const workerAiSchema = z.strictObject({
    state: z.enum(WORKER_AI_STATES),
    device: z.enum(['gpu', 'cpu']).optional(),
    deviceName: z.string().min(1).max(120).optional(),
    why: z.enum(WORKER_AI_WHYS).optional(),
});

/** `cities/{city}/workers/{workerId}`: one local worker process, refreshed by `worker.hello` and `worker.claim`. */
export const workerDocSchema = z.strictObject({
    uid: uidSchema,
    version: z.string().regex(/^[0-9A-Za-z.+-]{1,40}$/),
    startedAt: timestampSchema,
    lastSeenAt: timestampSchema,
    state: z.enum(WORKER_STATES),
    jobId: idSchema.optional(),
    lastJob: z.strictObject({ id: idSchema, outcome: z.enum(['done', 'failed']), at: timestampSchema }).optional(),
    /** Finding 67: the pairing it signed in with (absent: a Google sign-in on its local page). */
    pair: z.string().regex(PAIR_ID).optional(),
    /**
     * The pipeline image it runs (finding 72: the one the starter's supervisor names in `worker.hello`, else its pairing's
     * command's), and whether that is no longer the installed one.
     */
    image: digestSchema.optional(),
    outdated: z.boolean().optional(),
    /** Its local AI, as the worker last said through `worker.hello`. */
    ai: workerAiSchema.optional(),
    /** 2026-11-13: the jobs whose stitched film this computer holds, as its last claim said (a job without its film waits for it). */
    films: z.array(idSchema).max(200).optional(),
    /** Disconnect this computer (`worker.revoke`): every later call of this worker is refused. */
    revokedAt: timestampSchema.optional(),
    ...stamp,
});

/**
 * `cities/{city}/pairings/{pairId}` (finding 67; id: the first 40 hex characters of the code's SHA-256, the code is never
 * stored): a one-time code minted by `worker.pairCode` for `uid`, exchanged once by `worker.pair` (`pairedAt`) before
 * `expiresAt`, revoked by Disconnect this computer or a later pairing that replaced it. No client reads or writes it.
 */
export const workerPairingDocSchema = z.strictObject({
    uid: uidSchema,
    /** The pipeline image the command named (absent: no image was recorded yet). */
    image: digestSchema.optional(),
    expiresAt: timestampSchema,
    pairedAt: timestampSchema.optional(),
    revokedAt: timestampSchema.optional(),
    ...stamp,
});

/** `cities/{city}/pairings/limit`: `worker.pair`'s attempts in the current window (it needs no sign-in). */
export const workerPairLimitDocSchema = z.strictObject({ windowStart: timestampSchema, attempts: z.number().int().min(0), ...stamp });

/** `cities/{city}/workers/choice`: where the city's raster jobs run by default (`auto` when absent). */
export const runChoiceDocSchema = z.strictObject({ choice: z.enum(RUN_CHOICES), ...stamp });

/**
 * `usage/cloudrun-YYYY-MM`: the month's counted cloud runs, seconds × each machine's vCPUs and GiB. Finding 64 of
 * 2026-11-02: `backfilledAt` says the month's cloud runs that ended before they were counted (the count began with M7's
 * release) were added once, from their jobs' recorded times (`imagery.tick`).
 */
export const cloudRunUsageDocSchema = z.strictObject({
    month: z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/),
    vcpuSeconds: z.number().min(0),
    gibSeconds: z.number().min(0),
    runs: z.number().int().min(0),
    backfilledAt: timestampSchema.optional(),
    ...stamp,
});

export type WorkerDoc = z.infer<typeof workerDocSchema>;
export type WorkerAi = z.infer<typeof workerAiSchema>;
export type RunChoiceDoc = z.infer<typeof runChoiceDocSchema>;
export type CloudRunUsageDoc = z.infer<typeof cloudRunUsageDocSchema>;
export type WorkerPairingDoc = z.infer<typeof workerPairingDocSchema>;
export type WorkerPairLimitDoc = z.infer<typeof workerPairLimitDocSchema>;
