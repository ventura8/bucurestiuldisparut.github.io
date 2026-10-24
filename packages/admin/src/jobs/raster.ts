/**
 * What the Jobs page learns from the raster pipeline (`docs/research/M3-interfaces.md` §4.5, §10.6; CR-M3-5): why an
 * unfinished job waits and until when, the layer version it works for (an `awaiting_gcps` job opens the georeferencer
 * on it), and whether a failed job may run again (`jobRetryable` of `@hcm/shared`, CR-M3-47: a pipeline or publish job
 * with its version, attempts left and a failure a retry can cure), through `imagery.retry`, which puts it back in the
 * queue from its failed step.
 */
import { isoOf } from '../content/list.js';
import type { ContentServices } from '../content/services.js';
import { callImagery, refusalOf } from '../imagery/api.js';
import { jobRetryable, type JobDoc, type JobWaitReason } from '@hcm/shared';

export interface RasterJobFields {
    /** Why the unfinished job is not running, or null. */
    readonly waitReason: JobWaitReason | null;
    /** When a job waiting for a retry tries again (ISO), or null. */
    readonly retryAt: string | null;
    /** The layer version it produces or publishes, or null. */
    readonly versionId: string | null;
    /** A failed pipeline or publish job a retry may cure, with attempts left: Retry is offered. */
    readonly retryable: boolean;
}

export function rasterFieldsOf(job: JobDoc): RasterJobFields {
    return {
        ...{ waitReason: job.waitReason ?? null, retryAt: job.retryAt === undefined ? null : isoOf(job.retryAt) },
        ...{ versionId: job.versionId ?? null, retryable: jobRetryable(job) },
    };
}

/** Runs a failed job again; says so, or why not. True once it is queued again. */
export async function retryRasterJob(services: ContentServices, jobId: string): Promise<boolean> {
    try {
        await callImagery(services.callables, 'imagery.retry', { cityId: services.cityId, jobId });
    } catch (error) {
        services.notify(refusalOf(error));
        return false;
    }
    services.notify({ key: 'adminContent.jobs.retried' });
    return true;
}
