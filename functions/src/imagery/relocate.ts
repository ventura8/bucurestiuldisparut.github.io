/**
 * `imagery.tick`'s `relocate` part (M18 item 3, `docs/research/M18-improvements.md`): a frame parked for points under an
 * older pipeline searches for its place again by itself once a newer pipeline image is installed, as the owner used to do
 * with **Locate again** after every update. It is free: no import, so never the day's limit, and one run of its own whatever
 * the runs before used (`locate-again.ts`). Each parked frame remembers the image it was searched with (`JobDoc.searchedWith`,
 * written the first time a tick sees it); a frame first seen now keeps the current image and is not searched again. At most
 * `RELOCATE_PER_TICK` frames a city start in one tick, and a refusal (the inputs gone, the files on the other place) is logged
 * once and remembered, so no tick asks again for the same image.
 */
import { FIRESTORE_PATHS, jobDocSchema, type JobDoc } from '@hcm/shared';

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

/** One frame searched again; a refusal is logged and remembered for this image. */
async function relocateOne(deps: RelocateDeps, cityId: string, frame: StoredDocument<JobDoc>, digest: string): Promise<void> {
    try {
        await locateAgain(deps, { cityId, versionId: frame.id, uid: IMAGERY_WRITER, message: MESSAGE });
    } catch (error) {
        if (!(error instanceof ApiError)) {
            throw error;
        }
        deps.log.warn('a parked frame was not searched again', { cityId, jobId: frame.id, code: error.code });
    }
    await remember(deps, cityId, frame.id, digest);
}

/** The installed image's digest, read only when some frame waits (undefined: none waits, or no image is known). */
async function digestFor(deps: RelocateDeps, parked: readonly StoredDocument<JobDoc>[]): Promise<string | undefined> {
    return parked.length === 0 ? undefined : (await installedImage(deps))?.digest;
}

/** The parked frames of `cityId` searched with another image than the installed one start again; new ones are remembered. */
export async function relocateParked(deps: RelocateDeps, cityId: string): Promise<void> {
    const parked = await deps.documents.query(FIRESTORE_PATHS.jobs(cityId), jobDocSchema, { where: [['status', '==', 'awaiting_gcps']] });
    const digest = await digestFor(deps, parked.documents);
    if (digest === undefined) {
        return;
    }
    const unseen = parked.documents.filter((frame) => frame.data.searchedWith === undefined);
    const older = parked.documents.filter((frame) => ![undefined, digest].includes(frame.data.searchedWith));
    for (const frame of unseen) {
        await remember(deps, cityId, frame.id, digest);
    }
    for (const frame of older.slice(0, RELOCATE_PER_TICK)) {
        await relocateOne(deps, cityId, frame, digest);
    }
}
