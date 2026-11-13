import '../global-options.js';

import { FIRESTORE_PATHS, workerDocSchema, type CallableRequest, type CallableResponse, type WorkerDoc } from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import { omit } from '../api/objects.js';
import type { Ports } from '../ports/index.js';
import { at } from './holder.js';

export type ManageDeps = Pick<Ports, 'documents' | 'clock' | 'log'>;

type Request = CallableRequest<'worker.manage'>;

/** The worker's document as the action leaves it. */
function changed(worker: WorkerDoc, request: Request, stamp: Pick<WorkerDoc, 'updatedBy' | 'updatedAt'>): WorkerDoc {
    if (request.action === 'rename') {
        return { ...worker, name: request.name, ...stamp };
    }
    if (request.action === 'remove') {
        const removal = { step: 'asked' as const, askedAt: stamp.updatedAt, docker: request.docker, keep: request.keep };
        return { ...worker, removal, ...stamp };
    }
    if (request.action === 'pause') {
        return { ...worker, pausedAt: worker.pausedAt ?? stamp.updatedAt, ...stamp };
    }
    return { ...omit(worker, ['pausedAt']), ...stamp };
}

/**
 * `worker.manage` (W5, household computers: `docs/research/M7-local-worker.md` *Household computers*; S-A143-HAPPY-MANAGE,
 * S-A143-BAD-MANAGE-REMOVED): the admin's list of the city's computers renames one (its name in the list only), pauses it (its
 * claims are given no job: `worker.claim` answers `paused`) or resumes it, or asks it to remove itself (`removal.ts`: its
 * worker cleans the computer up at its next claim, then is disconnected; S-A143-HAPPY-REMOVE). A computer that is unknown or
 * already disconnected is left alone: false.
 */
async function workerManage(deps: ManageDeps, caller: VerifiedCaller, request: Request): Promise<CallableResponse<'worker.manage'>> {
    const path = FIRESTORE_PATHS.worker(request.cityId, request.workerId);
    const stamp = { updatedBy: caller.uid, updatedAt: at(deps.clock.now()) };
    const done = await deps.documents.transaction(async (transaction) => {
        const worker = await transaction.get(path, workerDocSchema);
        if (worker === undefined || worker.revokedAt !== undefined) {
            return false;
        }
        await transaction.set(path, workerDocSchema, changed(worker, request, stamp));
        return true;
    });
    deps.log.info('worker managed', { cityId: request.cityId, workerId: request.workerId, action: request.action, changed: done });
    return { changed: done };
}

/** The `worker-manage` callable. */
export function manageFunction(getDeps: () => ManageDeps & CallableDeps) {
    return defineCallable('worker.manage', workerManage, getDeps);
}
