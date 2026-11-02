import '../global-options.js';

import {
    FIRESTORE_PATHS,
    jobDocSchema,
    runChoiceDocSchema,
    type CallableRequest,
    type CallableResponse,
    type JobDoc,
    type JobStatus,
    type RunPlace,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { ApiError } from '../api/api-error.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import { omit } from '../api/objects.js';
import type { DocumentTransaction } from '../ports/documents.js';
import type { Ports } from '../ports/index.js';
import { requireCity, stampOf, type Stamp } from './records.js';

/**
 * `imagery.runOn` (a city editor; App Check enforced; `docs/research/M7-local-worker.md` §3, §4.3; S-A62-*): without a
 * job, the city's remembered choice of where its raster jobs run (`auto`, `local`, `cloud`); with a job, where that job
 * runs (`local` or `cloud`) and the city's choice with it, only while the job holds no run (`queued`, `waiting_usgs`,
 * `awaiting_gcps`; else `apiError.imagery.versionState`). The job's worker and wait reason are cleared; `freeTierOk`
 * with `cloud` is the admin's OK past the month's free tier (`{by, at}`), and moving the job to the computer drops an
 * earlier OK. A `queued` job is then dispatched again by its own trigger (`imagery.onJobWrite`).
 */
export type RunOnDeps = Pick<Ports, 'documents' | 'clock' | 'log'>;

type Request = CallableRequest<'imagery.runOn'>;

/** The statuses in which a job holds no run, so where it runs may still change. */
const MOVABLE: ReadonlySet<JobStatus> = new Set<JobStatus>(['queued', 'waiting_usgs', 'awaiting_gcps']);

/** Which job moves where, by whom, with or without the OK. */
interface Move {
    readonly cityId: string;
    readonly jobId: string;
    readonly place: RunPlace;
    readonly ok: boolean;
    readonly uid: string;
}

/** The job as moved: its worker and wait reason cleared, the OK recorded or dropped. */
function movedJob(job: JobDoc, move: Move, stamp: Stamp): JobDoc {
    const kept = omit(job, move.place === 'local' ? ['worker', 'waitReason', 'freeTierOk'] : ['worker', 'waitReason']);
    const okay = move.place === 'cloud' && move.ok ? { freeTierOk: { by: move.uid, at: stamp.updatedAt } } : {};
    return { ...kept, runOn: move.place, ...okay, ...stamp };
}

async function moveJob(transaction: DocumentTransaction, move: Move, stamp: Stamp): Promise<void> {
    const path = FIRESTORE_PATHS.job(move.cityId, move.jobId);
    const job = await transaction.get(path, jobDocSchema);
    if (job === undefined) {
        throw new ApiError('apiError.notFound');
    }
    if (!MOVABLE.has(job.status)) {
        throw new ApiError('apiError.imagery.versionState');
    }
    await transaction.set(path, jobDocSchema, movedJob(job, move, stamp));
    await transaction.set(FIRESTORE_PATHS.runChoice(move.cityId), runChoiceDocSchema, { choice: move.place, ...stamp });
}

async function imageryRunOn(deps: RunOnDeps, caller: VerifiedCaller, request: Request): Promise<CallableResponse<'imagery.runOn'>> {
    await requireCity(deps.documents, request.cityId);
    const stamp = stampOf(caller.uid, deps.clock.now());
    const jobId = request.jobId;
    if (jobId === undefined) {
        await deps.documents.set(FIRESTORE_PATHS.runChoice(request.cityId), runChoiceDocSchema, { choice: request.runOn, ...stamp });
        deps.log.info('run choice saved', { uid: caller.uid, cityId: request.cityId, choice: request.runOn });
        return { choice: request.runOn };
    }
    // The request's schema refuses `auto` with a job: a job runs in one place.
    const place: RunPlace = request.runOn === 'local' ? 'local' : 'cloud';
    const move: Move = { cityId: request.cityId, jobId, place, ok: request.freeTierOk === true, uid: caller.uid };
    await deps.documents.transaction((transaction) => moveJob(transaction, move, stamp));
    deps.log.info('job place chosen', { uid: caller.uid, cityId: request.cityId, jobId, runOn: place, ok: move.ok });
    return { choice: place, runOn: place };
}

/** The `imagery-runOn` callable. */
export function runOnFunction(getDeps: () => RunOnDeps & CallableDeps) {
    return defineCallable('imagery.runOn', imageryRunOn, getDeps);
}
