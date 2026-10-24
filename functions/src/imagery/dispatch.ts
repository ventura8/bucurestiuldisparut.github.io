/**
 * The dispatcher (`docs/research/M3-interfaces.md` §4.2, §4.3; S-A12-HAPPY-DISPATCH): a `queued` pipeline job whose time
 * has come starts exactly one Cloud Run execution, while the budget guard is green and fewer than `RUNNING_JOBS_MAX`
 * jobs hold one (starting, or running with their lease held). The job moves to `starting` in a transaction before the
 * run call, so a redelivered trigger finds it moved and starts nothing; a failed run call puts it back to `queued` a
 * minute later. The cap is checked in that same transaction (CR-M3-47): it reads and writes the execution slots
 * (`ops/dispatch`), each slot's job read again to drop the ones that ended, so the five trigger instances and the tick
 * never all see one place free and each start a run (`S-A12-BAD-RACING-DISPATCH`).
 */
import {
    CLOUD_RUN_JOBS,
    FIRESTORE_PATHS,
    JOB_MAX_ATTEMPTS,
    PIPELINE_RUN_ARGS,
    RUNNING_JOBS_MAX,
    SENSOR_SPECS,
    jobDocSchema,
    opsDispatchDocSchema,
    runsOnPipeline,
    timestampFromDate,
    timestampToDate,
    type JobDoc,
    type JobWaitReason,
    type OpsDispatchDoc,
    type Sensor,
} from '@hcm/shared';

import { omit } from '../api/objects.js';
import type { DocumentTransaction } from '../ports/documents.js';
import type { Ports } from '../ports/index.js';
import { endWork } from './end.js';
import { cityIds } from './limits.js';
import { enqueuePublish } from './publish-queue.js';
import { IMAGERY_WRITER, appendJobLog, guardIsRed, stampOf } from './records.js';

export type DispatchDeps = Pick<Ports, 'documents' | 'clock' | 'log' | 'jobs' | 'tasks'>;

export type DispatchOutcome = 'started' | 'waiting' | 'not-due' | 'publish' | 'skipped' | 'failed';

/** A failed run call is tried again this much later. */
const RUN_RETRY_MS = 60_000;

/** The machine the job's camera needs (`SENSOR_SPECS`: a KH-9 panoramic strip does not fit in 16 GiB). */
function sensorMachine(job: JobDoc): 'std' | 'xl' {
    const sensor = job.params['sensor'];
    return typeof sensor === 'string' && sensor in SENSOR_SPECS ? SENSOR_SPECS[sensor as Sensor].machine : 'std';
}

/** The machine a job needs: `xl` for a KH-9 panoramic frame or after an out-of-memory exit, else `std`. */
export function machineOf(job: JobDoc): 'std' | 'xl' {
    return job.machine === 'xl' ? 'xl' : sensorMachine(job);
}

/** True once neither `dispatchAt` nor `retryAt` lies in the future. */
function isDue(job: JobDoc, now: Date): boolean {
    return [job.dispatchAt, job.retryAt].every((at) => at === undefined || timestampToDate(at) <= now);
}

/**
 * True while a job holds a Cloud Run execution (CR-M3-45): `starting` (the run is asked for, or still booting), or
 * `running` with its lease held. A running job whose lease lapsed is a lost run that `imagery.tick` recovers; it holds no
 * capacity, so a run that stopped heartbeating never blocks the next one.
 */
function holdsExecution(job: JobDoc, now: Date): boolean {
    return job.status === 'starting' || (job.lease !== undefined && timestampToDate(job.lease.until) >= now);
}

/** A job's key in the execution slots: `<city>/<job>`. */
function slotKey(cityId: string, jobId: string): string {
    return `${cityId}/${jobId}`;
}

/** What the dispatcher found before its transaction: the jobs holding an execution, and the project's cities. */
interface Busy {
    /** Keys of the jobs holding an execution, by the query (a run started before the slots, a seeded one). */
    readonly holding: ReadonlySet<string>;
    readonly cities: ReadonlySet<string>;
}

/** Jobs holding an execution in the whole project (the cap is per project). */
async function busyExecutions(deps: DispatchDeps): Promise<Busy> {
    const now = deps.clock.now();
    const cities = await cityIds(deps.documents);
    const keys = await Promise.all(
        cities.map(async (cityId) => {
            const jobs = await deps.documents.query(FIRESTORE_PATHS.jobs(cityId), jobDocSchema, {
                where: [['status', 'in', ['starting', 'running']]],
            });
            return jobs.documents.filter((job) => holdsExecution(job.data, now)).map((job) => slotKey(cityId, job.id));
        }),
    );
    return { holding: new Set(keys.flat()), cities: new Set(cities) };
}

/** A slot's job, read in the transaction; undefined when its city is gone (a retired test world, a deleted city). */
function slotJob(transaction: DocumentTransaction, key: string, busy: Busy): Promise<JobDoc | undefined> | undefined {
    const cut = key.indexOf('/');
    const cityId = key.slice(0, cut);
    return busy.cities.has(cityId) ? transaction.get(FIRESTORE_PATHS.job(cityId, key.slice(cut + 1)), jobDocSchema) : undefined;
}

/** The slots as stored (none before the first dispatch). */
async function slotsIn(transaction: DocumentTransaction): Promise<OpsDispatchDoc['slots']> {
    return (await transaction.get(FIRESTORE_PATHS.opsDispatch, opsDispatchDocSchema))?.slots ?? {};
}

/** The slots whose job (read in the transaction) still holds an execution, in a city that still exists. */
async function liveSlots(transaction: DocumentTransaction, slots: OpsDispatchDoc['slots'], busy: Busy, now: Date) {
    const live: [string, OpsDispatchDoc['slots'][string]][] = [];
    for (const [key, slot] of Object.entries(slots)) {
        const job = await slotJob(transaction, key, busy);
        if (job !== undefined && holdsExecution(job, now)) {
            live.push([key, slot]);
        }
    }
    return Object.fromEntries(live);
}

/** `starting` for the queued job, if a place is free; the slots and the job written in one transaction. */
async function takeSlot(deps: DispatchDeps, cityId: string, jobId: string, busy: Busy): Promise<'started' | 'capacity' | 'moved'> {
    const path = FIRESTORE_PATHS.job(cityId, jobId);
    const now = deps.clock.now();
    return deps.documents.transaction(async (transaction) => {
        const job = await transaction.get(path, jobDocSchema);
        const slots = await liveSlots(transaction, await slotsIn(transaction), busy, now);
        if (!isQueued(job)) {
            return 'moved';
        }
        if (new Set([...busy.holding, ...Object.keys(slots)]).size >= RUNNING_JOBS_MAX) {
            return 'capacity';
        }
        const held = { ...slots, [slotKey(cityId, jobId)]: { at: timestampFromDate(now) } };
        await transaction.set(FIRESTORE_PATHS.opsDispatch, opsDispatchDocSchema, { slots: held, ...stampOf(IMAGERY_WRITER, now) });
        await transaction.set(path, jobDocSchema, starting(job, now));
        return 'started';
    });
}

/** Changes a job in a transaction when it is still `queued`; false when it moved meanwhile. */
async function whileQueued(
    deps: DispatchDeps,
    cityId: string,
    jobId: string,
    change: (job: JobDoc) => JobDoc | undefined,
): Promise<boolean> {
    const path = FIRESTORE_PATHS.job(cityId, jobId);
    return deps.documents.transaction(async (transaction) => {
        const job = await transaction.get(path, jobDocSchema);
        const changed = job?.status === 'queued' && job.cancelRequested !== true ? change(job) : undefined;
        if (changed !== undefined) {
            await transaction.set(path, jobDocSchema, changed);
        }
        return changed !== undefined;
    });
}

/** Leaves the job queued with why it waits (the tick tries again). */
async function wait(deps: DispatchDeps, cityId: string, jobId: string, reason: JobWaitReason): Promise<DispatchOutcome> {
    const stamp = stampOf(IMAGERY_WRITER, deps.clock.now());
    await whileQueued(deps, cityId, jobId, (job) => (job.waitReason === reason ? undefined : { ...job, waitReason: reason, ...stamp }));
    return 'waiting';
}

function starting(job: JobDoc, now: Date): JobDoc {
    const at = timestampFromDate(now);
    const kept = omit(job, ['waitReason', 'retryAt', 'executionName', 'lease']);
    return {
        ...kept,
        status: 'starting',
        dispatchAt: at,
        machine: machineOf(job),
        attempt: (job.attempt ?? 0) + 1,
        ...stampOf(IMAGERY_WRITER, now),
    };
}

/** Records the execution of a job still `starting` (a later state means the pipeline already took it). */
async function recordExecution(deps: DispatchDeps, cityId: string, jobId: string, executionName: string): Promise<void> {
    const path = FIRESTORE_PATHS.job(cityId, jobId);
    await deps.documents.transaction(async (transaction) => {
        const job = await transaction.get(path, jobDocSchema);
        if (job?.status === 'starting' && job.executionName === undefined) {
            await transaction.set(path, jobDocSchema, { ...job, executionName, ...stampOf(IMAGERY_WRITER, deps.clock.now()) });
        }
    });
}

/** A run call that failed: the job goes back to `queued` and waits a minute (the attempt it used stays counted). */
async function requeueAfterFailedRun(deps: DispatchDeps, cityId: string, jobId: string, error: unknown): Promise<DispatchOutcome> {
    const path = FIRESTORE_PATHS.job(cityId, jobId);
    const now = deps.clock.now();
    await deps.documents.transaction(async (transaction) => {
        const job = await transaction.get(path, jobDocSchema);
        if (job?.status === 'starting') {
            const retryAt = timestampFromDate(new Date(now.getTime() + RUN_RETRY_MS));
            await transaction.set(path, jobDocSchema, { ...job, status: 'queued', retryAt, ...stampOf(IMAGERY_WRITER, now) });
        }
    });
    deps.log.warn('pipeline execution not started', { cityId, jobId, error: String(error) });
    await appendJobLog(deps, cityId, jobId, {
        level: 'warn',
        message: `The pipeline did not start (${String(error)}); retrying in a minute.`,
    });
    return 'failed';
}

/** Starts the execution of a job that is now `starting`. */
async function run(deps: DispatchDeps, cityId: string, jobId: string, machine: 'std' | 'xl'): Promise<DispatchOutcome> {
    try {
        const execution = await deps.jobs.run(
            CLOUD_RUN_JOBS[machine],
            { JOB_ID: jobId, CITY_ID: cityId },
            { args: [...PIPELINE_RUN_ARGS] },
        );
        await recordExecution(deps, cityId, jobId, execution.name);
        deps.log.info('pipeline execution started', { cityId, jobId, machine, execution: execution.name });
        return 'started';
    } catch (error) {
        return requeueAfterFailedRun(deps, cityId, jobId, error);
    }
}

/** What a queued job of a type that does not run on Cloud Run does: a republish goes to the publisher, a deletion waits. */
async function notOnPipeline(deps: DispatchDeps, cityId: string, jobId: string, job: JobDoc): Promise<DispatchOutcome> {
    if (job.type !== 'republish') {
        return 'skipped';
    }
    await enqueuePublish(deps.tasks, { cityId, jobId }, 'republish');
    return 'publish';
}

/** A job past `JOB_MAX_ATTEMPTS` fails instead of starting again. */
async function exhausted(deps: DispatchDeps, cityId: string, jobId: string, job: JobDoc): Promise<DispatchOutcome> {
    const attempts = String(job.attempt ?? 0);
    await endWork(deps, cityId, jobId, {
        status: 'failed',
        versionState: 'failed',
        by: IMAGERY_WRITER,
        error: { code: 'apiError.imagery.attemptsExhausted', params: { attempts } },
    });
    return 'failed';
}

/** The job moved to `starting` with its slot, or why not: the budget guard, the cap, or it is no longer queued. */
async function admit(deps: DispatchDeps, cityId: string, jobId: string): Promise<JobWaitReason | 'started' | 'moved'> {
    if (await guardIsRed(deps.documents)) {
        return 'guard';
    }
    return takeSlot(deps, cityId, jobId, await busyExecutions(deps));
}

/** A queued job that is not due yet, or that used up its attempts. */
function notYet(job: JobDoc, now: Date): 'not-due' | 'exhausted' | undefined {
    if (!isDue(job, now)) {
        return 'not-due';
    }
    return (job.attempt ?? 0) >= JOB_MAX_ATTEMPTS ? 'exhausted' : undefined;
}

async function dispatchPipelineJob(deps: DispatchDeps, cityId: string, jobId: string, job: JobDoc): Promise<DispatchOutcome> {
    const early = notYet(job, deps.clock.now());
    if (early === 'not-due') {
        return 'not-due';
    }
    if (early === 'exhausted') {
        return exhausted(deps, cityId, jobId, job);
    }
    const admitted = await admit(deps, cityId, jobId);
    if (admitted === 'started') {
        return run(deps, cityId, jobId, machineOf(job));
    }
    return admitted === 'moved' ? 'skipped' : wait(deps, cityId, jobId, admitted);
}

function isQueued(job: JobDoc | undefined): job is JobDoc {
    return job?.status === 'queued' && job.cancelRequested !== true;
}

/** Dispatches the job when it is queued and due (the trigger on a job becoming `queued`, and `imagery.tick`). */
export async function dispatchJob(deps: DispatchDeps, cityId: string, jobId: string): Promise<DispatchOutcome> {
    const job = await deps.documents.get(FIRESTORE_PATHS.job(cityId, jobId), jobDocSchema);
    if (!isQueued(job)) {
        return 'skipped';
    }
    return runsOnPipeline(job.type) ? dispatchPipelineJob(deps, cityId, jobId, job) : notOnPipeline(deps, cityId, jobId, job);
}
