import '../global-options.js';

import {
    FIRESTORE_PATHS,
    HEARTBEAT_SECONDS,
    WORKER_POLL_SECONDS,
    workerDocSchema,
    type CallableRequest,
    type CallableResponse,
    type WorkerDoc,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import type { Ports } from '../ports/index.js';
import { at, ownWorker, requireGreen } from './holder.js';

export type HelloDeps = Pick<Ports, 'documents' | 'clock' | 'log'>;

/**
 * `worker.hello` (`docs/research/M7-local-worker.md` §1.2, §2.4): a worker process introduces itself before it claims
 * anything, which records `cities/{city}/workers/{workerId}` (its account, its version, when it started and was last
 * seen; a worker id another account said hello with is refused) and answers how often it asks for work and beats.
 * The local page calls it with a fresh token first, so a token of another project or of a non-editor is refused at once.
 */
async function workerHello(
    deps: HelloDeps,
    caller: VerifiedCaller,
    request: CallableRequest<'worker.hello'>,
): Promise<CallableResponse<'worker.hello'>> {
    await requireGreen(deps.documents);
    const call = { cityId: request.cityId, workerId: request.workerId, uid: caller.uid };
    const now = at(deps.clock.now());
    const path = FIRESTORE_PATHS.worker(request.cityId, request.workerId);
    await deps.documents.transaction(async (transaction) => {
        const known = await ownWorker(transaction, call);
        const base: Pick<WorkerDoc, 'startedAt' | 'state'> = known ?? { startedAt: now, state: 'idle' };
        await transaction.set(path, workerDocSchema, {
            ...known,
            ...base,
            uid: caller.uid,
            version: request.version,
            lastSeenAt: now,
            updatedBy: caller.uid,
            updatedAt: now,
        });
    });
    deps.log.info('worker hello', { cityId: request.cityId, workerId: request.workerId, version: request.version });
    return { pollSeconds: WORKER_POLL_SECONDS, heartbeatSeconds: HEARTBEAT_SECONDS };
}

/** The `worker-hello` callable. */
export function helloFunction(getDeps: () => HelloDeps & CallableDeps) {
    return defineCallable('worker.hello', workerHello, getDeps);
}
