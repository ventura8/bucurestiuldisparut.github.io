/**
 * M20 (`docs/research/M20-import-local.md` §1.3; S-A120-BAD-DAILY-SPLITS): the archive series that wait for a later day's share of
 * new layers (`waitReason: 'daily'`) are let start by `imagery.tick`, as many as today's share has room for, in the archive's order
 * (the reference ladder: `params.order`, then the oldest). Each counts on the day it is released (`countedAt`), then waits for the
 * owner's computer like any other local job. A job that moved meanwhile is left alone (the release is a transaction).
 */
import {
    FIRESTORE_PATHS,
    archiveSeriesParamsSchema,
    jobDocSchema,
    timestampFromDate,
    timestampToDate,
    validate,
    type JobDoc,
} from '@hcm/shared';

import type { StoredDocument } from '../ports/documents.js';
import type { Ports } from '../ports/index.js';
import { dailyRoom } from './limits.js';
import { IMAGERY_WRITER, stampOf } from './records.js';

export type DailyDeps = Pick<Ports, 'documents' | 'clock' | 'log'>;

/** The job's place in its archive's order (a job whose parameters cannot be read goes last). */
function orderOf(job: JobDoc): number {
    const params = validate(archiveSeriesParamsSchema, job.params);
    return params.ok ? params.value.order : Number.MAX_SAFE_INTEGER;
}

function byPlan(a: StoredDocument<JobDoc>, b: StoredDocument<JobDoc>): number {
    const order = orderOf(a.data) - orderOf(b.data);
    return order === 0 ? timestampToDate(a.data.createdAt).getTime() - timestampToDate(b.data.createdAt).getTime() : order;
}

/** Releases one job if it still waits for its day: it counts now and waits for a worker. */
async function release(deps: DailyDeps, cityId: string, jobId: string, now: Date): Promise<boolean> {
    const path = FIRESTORE_PATHS.job(cityId, jobId);
    return deps.documents.transaction(async (transaction) => {
        const job = await transaction.get(path, jobDocSchema);
        if (job?.status !== 'queued' || job.waitReason !== 'daily') {
            return false;
        }
        const released: JobDoc = { ...job, waitReason: 'worker', countedAt: timestampFromDate(now), ...stampOf(IMAGERY_WRITER, now) };
        await transaction.set(path, jobDocSchema, released);
        return true;
    });
}

/** The city's archive series waiting for their day, released in the archive's order while today's share has room. */
export async function releaseDaily(deps: DailyDeps, cityId: string, now: Date): Promise<number> {
    const waiting = await deps.documents.query(FIRESTORE_PATHS.jobs(cityId), jobDocSchema, { where: [['waitReason', '==', 'daily']] });
    if (waiting.documents.length === 0) {
        return 0;
    }
    const room = await dailyRoom(deps.documents, now, cityId);
    let released = 0;
    for (const { id } of [...waiting.documents].sort(byPlan).slice(0, room)) {
        released += (await release(deps, cityId, id, now)) ? 1 : 0;
    }
    if (released > 0) {
        deps.log.info('archive series released for today', { cityId, released, waiting: waiting.documents.length - released });
    }
    return released;
}
