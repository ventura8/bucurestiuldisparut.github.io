/**
 * M20 (`docs/research/M20-import-local.md` §4.1; live report of 2026-11-13): an archive series reads scanned maps that were imported
 * on one computer (`<work>/import/<archiveId>/`), yet any of the city's workers may run it. A worker without the series' sheets looks
 * for a copy in the bucket; when there is none it hands the job back (`worker.end` `returned`): queued again, its attempt given back,
 * waiting for a copy (`waitReason: 'archive-copy'`). The next claim of a worker that holds the archive whole (`archives`) gets the
 * series to send (`copy`) before any job; `worker.archiveCopy` signs the copy's files under `tmp/archive-copies/` (deleted after a
 * day) and, once it is complete, lets the job be claimed again. The computer the archive's report came from never hands it back
 * (its files are gone: `archiveMissing`), and neither does a job handed back `ARCHIVE_RETURNS_MAX` times.
 */
import { FIRESTORE_PATHS, archiveDocSchema, jobDocSchema, type CallableResponse, type JobDoc } from '@hcm/shared';

import { omit } from '../api/objects.js';
import type { DocumentReader } from '../ports/documents.js';
import type { Ports } from '../ports/index.js';
import { IMAGERY_WRITER, stampOf } from '../imagery/records.js';
import type { WorkerCall } from './holder.js';

/**
 * A file of an archive series' copy (`tmp/archive-copies/{city}/{job}/<name>`): a sheet by its SHA-256, or the manifest. The
 * pipeline's side: `pipeline/src/hcm_pipeline/archive/copy.py` `copy_path`.
 */
export const ARCHIVE_COPY_FILE = /^(?:[0-9a-f]{64}|manifest\.json)$/;

/** How often a job may go back for a copy before it fails `archiveMissing` (a copy that never arrives, or never reads). */
export const ARCHIVE_RETURNS_MAX = 5;

/** How many jobs waiting for a copy one claim looks at. */
const COPY_SCAN = 20;

/** The local archive a job reads its files from, or undefined: only an archive series needs one. */
export function archiveOf(job: JobDoc): string | undefined {
    const value = job.type === 'archive-series' ? job.params['archiveId'] : undefined;
    return typeof value === 'string' ? value : undefined;
}

/** The worker whose scan reported the archive, or undefined when the archive has no record. */
async function reporterOf(reader: DocumentReader, cityId: string, archiveId: string): Promise<string | undefined> {
    return (await reader.get(FIRESTORE_PATHS.archive(cityId, archiveId), archiveDocSchema))?.workerId;
}

/** A queued archive series waiting for its sheets' copy. */
export function awaitingCopy(job: JobDoc | undefined): job is JobDoc {
    return job?.status === 'queued' && job.waitReason === 'archive-copy' && job.cancelRequested !== true && archiveOf(job) !== undefined;
}

type Copy = NonNullable<CallableResponse<'worker.claim'>['copy']>;

/** The oldest series waiting for a copy whose archive the claiming worker holds whole, or undefined. */
export async function copyFor(
    deps: Pick<Ports, 'documents'>,
    cityId: string,
    archives: readonly string[] | undefined,
): Promise<Copy | undefined> {
    if (archives === undefined || archives.length === 0) {
        return undefined;
    }
    const waiting = await deps.documents.query(FIRESTORE_PATHS.jobs(cityId), jobDocSchema, {
        where: [['waitReason', '==', 'archive-copy']],
        limit: COPY_SCAN,
    });
    const copies = waiting.documents
        .filter((job) => awaitingCopy(job.data))
        .map((job) => ({ jobId: job.id, archiveId: String(archiveOf(job.data)), seriesId: String(job.data.params['seriesId']) }));
    return copies.find((copy) => archives.includes(copy.archiveId));
}

/** True when the job's next return ends it: the computer its archive came from lost the files, or the copies never helped. */
export async function returnsExhausted(reader: DocumentReader, job: JobDoc, archive: string, call: WorkerCall): Promise<boolean> {
    if ((job.archiveReturns ?? 0) + 1 >= ARCHIVE_RETURNS_MAX) {
        return true;
    }
    return (await reporterOf(reader, call.cityId, archive)) === call.workerId;
}

/**
 * The job handed back by a worker without its sheets: queued again, the attempt its claim counted given back, no lease or worker,
 * waiting for a new copy (the last one, if any, did not reach this worker or expired).
 */
export function handedBack(job: JobDoc, now: Date): JobDoc {
    return {
        ...omit(job, ['lease', 'worker', 'retryAt', 'archiveCopy']),
        status: 'queued',
        attempt: Math.max(0, (job.attempt ?? 0) - 1),
        archiveReturns: (job.archiveReturns ?? 0) + 1,
        waitReason: 'archive-copy',
        ...stampOf(IMAGERY_WRITER, now),
    };
}

/** The job once its copy is complete: claimable by any worker again, the copy recorded. */
export function copied(job: JobDoc, by: string, bytes: number, now: Date): JobDoc {
    const stamp = stampOf(IMAGERY_WRITER, now);
    return { ...job, waitReason: 'worker', archiveCopy: { by, at: stamp.updatedAt, bytes }, ...stamp };
}
