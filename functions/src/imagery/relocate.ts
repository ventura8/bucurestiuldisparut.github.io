/**
 * `imagery.tick`'s `relocate` part (M18 item 3, `docs/research/M18-improvements.md`): a frame parked for points under an
 * older pipeline searches for its place again by itself once a newer pipeline image is installed, as the owner used to do
 * with **Locate again** after every update. It is free: no import, so never the day's limit, and one run of its own whatever
 * the runs before used (`locate-again.ts`). Each parked frame remembers the image it was searched with (`JobDoc.searchedWith`,
 * written the first time a tick sees it); a frame first seen now keeps the current image and is not searched again. At most
 * `RELOCATE_PER_TICK` frames a city start in one tick, and a refusal (the inputs gone, the files on the other place) is logged
 * once and remembered, so no tick asks again for the same image.
 *
 * Review of M18 item 3: only the image the Cloud Run job runs counts (`InstalledImage.from === 'job'`): the record
 * `setup/status.install.pipeline` can lag behind it, and each switch between the two would send every parked frame searching
 * again, uncounted. While the job cannot be read nothing moves and nothing is remembered. A frame an editor is placing points on
 * (`JobDoc.placingPoints`, within `PLACING_POINTS_HOLD_MS` of its stamp) keeps waiting: a search would refuse their Save.
 */
import { FIRESTORE_PATHS, jobDocSchema, PLACING_POINTS_HOLD_MS, timestampToDate, type JobDoc } from '@hcm/shared';

import { ApiError } from '../api/api-error.js';
import type { StoredDocument } from '../ports/documents.js';
import type { Ports } from '../ports/index.js';
import { installedImage } from '../worker/installed-image.js';
import { locateAgain } from './locate-again.js';
import { IMAGERY_WRITER, stampOf } from './records.js';

export type RelocateDeps = Pick<Ports, 'documents' | 'clock' | 'log' | 'blobs' | 'jobs'>;

/** How many frames of one city one tick sends searching again (each is a pipeline run). */
export const RELOCATE_PER_TICK = 3;

const MESSAGE = 'Locate again by itself: the pipeline was updated, so the search runs again; free, no new import, no new download.';

/** Remembers the image the frame was searched with, while it still waits for points. */
async function remember(deps: RelocateDeps, cityId: string, jobId: string, digest: string): Promise<void> {
    const path = FIRESTORE_PATHS.job(cityId, jobId);
    await deps.documents.transaction(async (transaction) => {
        const job = await transaction.get(path, jobDocSchema);
        if (job?.status === 'awaiting_gcps') {
            await transaction.set(path, jobDocSchema, { ...job, searchedWith: digest, ...stampOf(IMAGERY_WRITER, deps.clock.now()) });
        }
    });
}

/** What the log says of a frame that was not searched again: the refusal's code, or the error itself (an invalid record). */
function whyNot(error: unknown): Readonly<Record<string, string>> {
    return error instanceof ApiError ? { code: error.code } : { error: String(error) };
}

/**
 * One frame searched again; a refusal, or any other failure (a record its schema refuses: finding of 2026-11-12), is logged with
 * the version and remembered for this image, so one bad frame never stops the others nor is asked again each tick.
 */
async function relocateOne(deps: RelocateDeps, cityId: string, frame: StoredDocument<JobDoc>, digest: string): Promise<void> {
    // A parked frame's version has its job's id (`locate-again.ts`).
    const versionId = frame.id;
    try {
        await locateAgain(deps, { cityId, versionId, uid: IMAGERY_WRITER, message: MESSAGE });
    } catch (error) {
        deps.log.warn('a parked frame was not searched again', { cityId, jobId: frame.id, versionId, ...whyNot(error) });
    }
    await remember(deps, cityId, frame.id, digest);
}

/**
 * The image the pipeline job runs, read only when some frame waits (undefined: none waits, or the job cannot be read: the
 * record's image is no ground to search again).
 */
async function digestFor(deps: RelocateDeps, parked: readonly StoredDocument<JobDoc>[]): Promise<string | undefined> {
    const image = parked.length === 0 ? undefined : await installedImage(deps);
    return image?.from === 'job' ? image.digest : undefined;
}

/** An editor marked the frame while placing points on it, recently enough. */
function placingPoints(frame: StoredDocument<JobDoc>, now: Date): boolean {
    const markedAt = timestampToDate(frame.data.updatedAt).getTime();
    return frame.data.placingPoints === true && now.getTime() - markedAt < PLACING_POINTS_HOLD_MS;
}

/** The parked frames of `cityId` searched with another image than the installed one start again; new ones are remembered. */
export async function relocateParked(deps: RelocateDeps, cityId: string): Promise<void> {
    const parked = await deps.documents.query(FIRESTORE_PATHS.jobs(cityId), jobDocSchema, { where: [['status', '==', 'awaiting_gcps']] });
    const digest = await digestFor(deps, parked.documents);
    if (digest === undefined) {
        return;
    }
    const unseen = parked.documents.filter((frame) => frame.data.searchedWith === undefined);
    const now = deps.clock.now();
    const older = parked.documents.filter((frame) => ![undefined, digest].includes(frame.data.searchedWith) && !placingPoints(frame, now));
    for (const frame of unseen) {
        await remember(deps, cityId, frame.id, digest);
    }
    for (const frame of older.slice(0, RELOCATE_PER_TICK)) {
        await relocateOne(deps, cityId, frame, digest);
    }
}
