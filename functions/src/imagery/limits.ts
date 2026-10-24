/**
 * What every creator of a raster job checks first (`docs/research/M3-interfaces.md` §4.1, security review §3.4): the
 * budget guard is green (`apiError.guardPaused`), fewer than `JOBS_PER_DAY` raster jobs started today in the whole
 * project (`apiError.imagery.dailyLimit {limit}`), and the layer has no unfinished job (`apiError.layers.busy`). The daily
 * count and the busy check are queries, which a Firestore transaction cannot hold, so two creators racing in the same
 * second may both pass: the cap is a spend guard, not an exact quota.
 */
import {
    FINISHED_JOB_STATUSES,
    FIRESTORE_PATHS,
    JOBS_PER_DAY,
    cityDocSchema,
    jobDocSchema,
    runsOnPipeline,
    timestampFromDate,
    type JobStatus,
} from '@hcm/shared';

import { ApiError } from '../api/api-error.js';
import type { DocumentStore } from '../ports/documents.js';
import { guardIsRed } from './records.js';

const FINISHED: ReadonlySet<JobStatus> = new Set(FINISHED_JOB_STATUSES);

/** The first instant of `now`'s day, UTC. */
function dayStart(now: Date): Date {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Every city of the project (a project holds one or a few: the daily cap and the running cap are per project). */
export async function cityIds(documents: DocumentStore): Promise<string[]> {
    const cities = await documents.query(FIRESTORE_PATHS.cities, cityDocSchema);
    return [...cities.documents, ...cities.invalid].map((city) => city.id);
}

/** The raster jobs created since the start of today (UTC) in every city. */
async function rasterJobsToday(documents: DocumentStore, now: Date): Promise<number> {
    const since = timestampFromDate(dayStart(now));
    const counts = await Promise.all(
        (await cityIds(documents)).map(async (cityId) => {
            const jobs = await documents.query(FIRESTORE_PATHS.jobs(cityId), jobDocSchema, { where: [['createdAt', '>=', since]] });
            return jobs.documents.filter((job) => runsOnPipeline(job.data.type)).length;
        }),
    );
    return counts.reduce((sum, count) => sum + count, 0);
}

/** `apiError.guardPaused` while the budget guard is red, `apiError.imagery.dailyLimit` once today's jobs reached the cap. */
export async function refuseNewRasterJob(documents: DocumentStore, now: Date): Promise<void> {
    if (await guardIsRed(documents)) {
        throw new ApiError('apiError.guardPaused');
    }
    if ((await rasterJobsToday(documents, now)) >= JOBS_PER_DAY) {
        throw new ApiError('apiError.imagery.dailyLimit', { limit: String(JOBS_PER_DAY) });
    }
}

/** `apiError.layers.busy` when a job of the layer is not finished (`except`: a job the caller replaces itself). */
export async function refuseBusyLayer(documents: DocumentStore, cityId: string, layerId: string, except?: string): Promise<void> {
    const jobs = await documents.query(FIRESTORE_PATHS.jobs(cityId), jobDocSchema, { where: [['layerId', '==', layerId]] });
    if (jobs.documents.some((job) => job.id !== except && !FINISHED.has(job.data.status))) {
        throw new ApiError('apiError.layers.busy');
    }
}
