import '../global-options.js';

import {
    ARCHIVE_COPY_FILE,
    FIRESTORE_PATHS,
    WORKER_URL_SECONDS,
    jobDocSchema,
    type CallableRequest,
    type CallableResponse,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { ApiError } from '../api/api-error.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import type { Ports } from '../ports/index.js';
import { archiveOf, awaitingCopy, copied } from './archive-host.js';
import { requireGreen, requireWorker, type WorkerCall } from './holder.js';
import { paired } from './pairing.js';
import { signOne, type ObjectRequest } from './urls.js';

export type ArchiveCopyDeps = Pick<Ports, 'documents' | 'clock' | 'log' | 'blobs' | 'signer'>;

type Request = CallableRequest<'worker.archiveCopy'>;
type Response = CallableResponse<'worker.archiveCopy'>;

function refused(): ApiError {
    return new ApiError('apiError.worker.refused');
}

/** True when `object` is one file of this job's copy: a sheet by its SHA-256 or the manifest; a PUT names its content type. */
function inCopy(cityId: string, jobId: string, object: ObjectRequest): boolean {
    const folder = `tmp/archive-copies/${cityId}/${jobId}/`;
    const name = object.path.startsWith(folder) ? object.path.slice(folder.length) : '';
    return ARCHIVE_COPY_FILE.test(name) && (object.method === 'GET' || object.contentType !== undefined);
}

/** Signed addresses of the copy's files (`WORKER_URL_SECONDS`), or nothing at all when one is not the job's copy. */
async function signCopy(deps: ArchiveCopyDeps, request: Request, objects: readonly ObjectRequest[]): Promise<Response> {
    if (!objects.every((object) => inCopy(request.cityId, request.jobId, object))) {
        throw refused();
    }
    const expiresAt = new Date(deps.clock.now().getTime() + WORKER_URL_SECONDS * 1000);
    return { objects: await Promise.all(objects.map((object) => signOne(deps, object, expiresAt))) };
}

/** The copy is complete: the job, still waiting for it, may be claimed by any worker again. */
async function finishCopy(deps: ArchiveCopyDeps, call: WorkerCall, request: Request, bytes: number): Promise<Response> {
    const path = FIRESTORE_PATHS.job(call.cityId, request.jobId);
    const now = deps.clock.now();
    const job = await deps.documents.transaction(async (transaction) => {
        const current = await transaction.get(path, jobDocSchema);
        if (!awaitingCopy(current)) {
            throw refused();
        }
        const next = copied(current, call.workerId, bytes, now);
        await transaction.set(path, jobDocSchema, next);
        return next;
    });
    deps.log.info('archive series copied through the bucket', {
        cityId: call.cityId,
        jobId: request.jobId,
        archiveId: archiveOf(job),
        workerId: call.workerId,
        bytes,
    });
    return { status: job.status };
}

/**
 * `worker.archiveCopy` (`docs/research/M20-import-local.md` §4.1; live report of 2026-11-13; S-A120-HAPPY-ARCHIVE-COPY): the computer
 * that holds an archive sends one series' sheets for a job another worker waits on (`waitReason: 'archive-copy'`). `objects` signs
 * the copy's files under `tmp/archive-copies/{city}/{job}/` (a sheet by its SHA-256, or `manifest.json`; the bucket deletes them after
 * a day); `done` records who sent how many bytes and lets the job be claimed again. Only while the job waits for its copy, never while
 * the budget guard is red, at most `ARCHIVE_COPY_MAX_BYTES` a copy (the schema's bound).
 */
async function workerArchiveCopy(deps: ArchiveCopyDeps, caller: VerifiedCaller, request: Request): Promise<Response> {
    await requireGreen(deps.documents);
    const call: WorkerCall = { cityId: request.cityId, workerId: request.workerId, uid: caller.uid };
    await requireWorker(deps.documents, call);
    if (request.copy.kind === 'done') {
        return finishCopy(deps, call, request, request.copy.bytes);
    }
    if (!awaitingCopy(await deps.documents.get(FIRESTORE_PATHS.job(call.cityId, request.jobId), jobDocSchema))) {
        throw refused();
    }
    return signCopy(deps, request, request.copy.objects);
}

/** The `worker-archiveCopy` callable. */
export function archiveCopyFunction(getDeps: () => ArchiveCopyDeps & CallableDeps) {
    return defineCallable('worker.archiveCopy', paired(workerArchiveCopy), getDeps);
}
