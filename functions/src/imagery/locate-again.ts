import '../global-options.js';

import {
    FIRESTORE_PATHS,
    JOB_MAX_ATTEMPTS,
    JOB_STEPS,
    jobDocSchema,
    layerVersionDocSchema,
    type CallableRequest,
    type CallableResponse,
    type JobDoc,
    type LayerVersionDoc,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { ApiError } from '../api/api-error.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import { omit } from '../api/objects.js';
import type { DocumentTransaction } from '../ports/documents.js';
import type { Ports } from '../ports/index.js';
import { appendJobLog, guardIsRed, stampOf, type Stamp } from './records.js';

/**
 * `imagery.locateAgain` (a city editor; `docs/research/M3-interfaces.md` §4.5; S-A69-*): a frame that waits for points under an older
 * pipeline searches for its place again, which **Retry** cannot do (it takes failed jobs only), and which used to cost a cancel, a
 * new download and one of the day's imports. The job goes back to `queued` from `stitch`: what `fetch` and `extract` recorded stands,
 * and the runner passes over each whose output is still stored, makes the segments again from a delivery a weak crop kept, and a
 * `locate` that refused may now prove. `stitch` runs again for the reason a retry's does (finding 78): a frame parked under an older
 * pipeline would be searched on that pipeline's `frame.json` and preview. It is the same job, so `imagery.import`'s daily limit is not
 * asked; each start still counts against `JOB_MAX_ATTEMPTS` (the admin's points get their own run, `imagery.saveGcps`), and the budget
 * guard stops it as any start. The segments live 14 days and the delivery 7: with neither left, the refusal says so instead of
 * downloading again. A job on the owner's computer keeps both there, out of the server's reach: its runner fetches again only if
 * that computer's sweep removed them. A job moved after it parked left its files where it ran (`JobDoc.filesOn`), which the other
 * place cannot read: `apiError.imagery.locateFilesElsewhere` says so, and no download of up to 8.7 GB starts behind the log's back.
 * M18 item 3 (`docs/research/M18-improvements.md`): a frame whose crop failed (its job failed at `stitch` or `locate`) searches
 * again the same way, before anyone imports it anew; and Locate again is free: never the day's limit, and, like the admin's points,
 * one run of its own whatever the runs before used (`attemptForSearch`). `imagery.tick` asks it by itself for every frame parked
 * under an older pipeline image (`relocate.ts`).
 */
export type LocateAgainDeps = Pick<Ports, 'documents' | 'clock' | 'log' | 'blobs'>;

type Request = CallableRequest<'imagery.locateAgain'>;
type StepRecord = NonNullable<JobDoc['steps']>[string];

/** The steps whose failure is a failed crop: the frame was not cut out of its delivery, or not placed. */
const CROP_STEPS: readonly string[] = ['stitch', 'locate'];

/** A frame waiting for the admin's points. */
function parkedFrame(version: LayerVersionDoc, job: JobDoc): boolean {
    return version.state === 'needs_gcps' && job.status === 'awaiting_gcps';
}

/** M18 item 3: a frame whose crop failed. */
function failedCrop(version: LayerVersionDoc, job: JobDoc): boolean {
    return version.state === 'failed' && job.status === 'failed' && CROP_STEPS.some((step) => job.steps?.[step]?.status === 'failed');
}

/** A job not asked to stop whose type has a `locate`, of a frame parked for points or whose crop failed. */
function locatable(version: LayerVersionDoc, job: JobDoc): boolean {
    const found = parkedFrame(version, job) || failedCrop(version, job);
    return found && job.cancelRequested !== true && JOB_STEPS[job.type].includes('locate');
}

/** A USGS frame waiting for the admin's points (or whose crop failed) with its job, else `apiError.imagery.versionState`. */
function requireParked(version: LayerVersionDoc | undefined, job: JobDoc | undefined): readonly [LayerVersionDoc, JobDoc] {
    if (version === undefined || job === undefined || !locatable(version, job)) {
        throw new ApiError('apiError.imagery.versionState');
    }
    return [version, job];
}

/** The attempts the search goes on with: one run of its own, whatever the runs before it used (as the admin's points). */
function attemptForSearch(job: JobDoc): Pick<JobDoc, 'attempt'> {
    return (job.attempt ?? 0) >= JOB_MAX_ATTEMPTS ? { attempt: JOB_MAX_ATTEMPTS - 1 } : {};
}

/** The step's output is the object it recorded, as the runner's own check of a finished step asks. */
async function outputStored(deps: LocateAgainDeps, step: StepRecord | undefined): Promise<boolean> {
    if (step?.gcsPath === undefined) {
        return false;
    }
    const stored = await deps.blobs.stat('private', step.gcsPath);
    return stored !== undefined && (step.generation === undefined || stored.generation === step.generation);
}

/** The job runs where its files are. */
function requireFilesHere(job: JobDoc): void {
    if (job.filesOn !== undefined) {
        throw new ApiError('apiError.imagery.locateFilesElsewhere');
    }
}

/** Something to search in: the segments, or the delivery they come from; a local job's are out of the server's reach. */
async function requireInputs(deps: LocateAgainDeps, job: JobDoc): Promise<void> {
    const steps = job.steps ?? {};
    if (job.runOn === 'local' || (await outputStored(deps, steps['extract'])) || (await outputStored(deps, steps['fetch']))) {
        return;
    }
    throw new ApiError('apiError.imagery.locateInputsGone');
}

/** `stitch` and every step after it are to run again; those before it stay as recorded (`locatable`: a job of a type with both). */
function fromStitch(job: JobDoc): JobDoc['steps'] {
    const order: readonly string[] = JOB_STEPS[job.type];
    const first = order.indexOf('stitch');
    const steps = Object.entries(job.steps ?? {}).map(([name, step]) => [
        name,
        order.indexOf(name) >= first ? { status: 'pending' as const } : step,
    ]);
    return Object.fromEntries(steps) as JobDoc['steps'];
}

/** Everything `locate` and `georef` left is theirs to write again; the scan stays until the new one replaces it. */
async function requeueIn(transaction: DocumentTransaction, request: Pick<Request, 'cityId' | 'versionId'>, stamp: Stamp): Promise<JobDoc> {
    const versionPath = FIRESTORE_PATHS.layerVersion(request.cityId, request.versionId);
    const jobPath = FIRESTORE_PATHS.job(request.cityId, request.versionId);
    const [version, job] = requireParked(
        await transaction.get(versionPath, layerVersionDocSchema),
        await transaction.get(jobPath, jobDocSchema),
    );
    const left = omit(version, ['error', 'georef', 'calibration', 'suggestions']);
    await transaction.set(versionPath, layerVersionDocSchema, { ...left, state: 'processing', ...stamp });
    const kept = omit(job, ['waitReason', 'error', 'finishedAt', 'lease', 'retryAt', 'executionName', 'searchedWith']);
    const queued: JobDoc = { ...kept, status: 'queued', ...attemptForSearch(job), steps: fromStitch(job), ...stamp };
    await transaction.set(jobPath, jobDocSchema, queued);
    return queued;
}

/** Who asks: an editor's click, or `imagery.tick` after a pipeline update (`relocate.ts`). */
export interface LocateAsk {
    readonly cityId: string;
    readonly versionId: string;
    readonly uid: string;
    readonly message: string;
}

/** Every check, then the job back to `queued` from `stitch`; the refusals are `ApiError`s. */
export async function locateAgain(deps: LocateAgainDeps, ask: LocateAsk): Promise<JobDoc> {
    const { cityId, versionId } = ask;
    const [, parked] = requireParked(
        await deps.documents.get(FIRESTORE_PATHS.layerVersion(cityId, versionId), layerVersionDocSchema),
        await deps.documents.get(FIRESTORE_PATHS.job(cityId, versionId), jobDocSchema),
    );
    if (await guardIsRed(deps.documents)) {
        throw new ApiError('apiError.guardPaused');
    }
    requireFilesHere(parked);
    await requireInputs(deps, parked);
    const now = deps.clock.now();
    const job = await deps.documents.transaction((transaction) => requeueIn(transaction, { cityId, versionId }, stampOf(ask.uid, now)));
    await appendJobLog(deps, cityId, versionId, { level: 'info', message: ask.message });
    deps.log.info('frame located again', { uid: ask.uid, cityId, versionId });
    return job;
}

async function imageryLocateAgain(
    deps: LocateAgainDeps,
    caller: VerifiedCaller,
    request: Request,
): Promise<CallableResponse<'imagery.locateAgain'>> {
    const message = 'Locate again: the search runs again; no new import, no new download.';
    const job = await locateAgain(deps, { ...request, uid: caller.uid, message });
    return { status: job.status, attempt: job.attempt ?? 0 };
}

/** The `imagery-locateAgain` callable. */
export function locateAgainFunction(getDeps: () => LocateAgainDeps & CallableDeps) {
    return defineCallable('imagery.locateAgain', imageryLocateAgain, getDeps);
}
