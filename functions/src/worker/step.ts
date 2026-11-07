import '../global-options.js';

import {
    cityDocSchema,
    imageryPassDocSchema,
    jobDocSchema,
    jobLogDocSchema,
    layerDocSchema,
    layerVersionDocSchema,
    usgsSceneDocSchema,
    validate,
    type CallableRequest,
    type CallableResponse,
    type JobLogDoc,
    type Schema,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { ApiError } from '../api/api-error.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import { guardIsRed, versionIdOf } from '../imagery/records.js';
import { UpstreamError } from '../ports/errors.js';
import type { Ports } from '../ports/index.js';
import { documentTarget, isJobLog, logLineOf, type DocumentTarget, type JobScope } from './allow-list.js';
import { storable, toWire } from './fields.js';
import { PIPELINE_WRITER, at, requireHeld, type WorkerCall } from './holder.js';
import { paired } from './pairing.js';
import { updateDocument } from './step-update.js';

export type StepDeps = Pick<Ports, 'documents' | 'clock' | 'log'>;

type Request = CallableRequest<'worker.step'>;
type Response = CallableResponse<'worker.step'>;
type Op = Request['request'];

/** At most this many log lines per job (`jobLogDocSchema`, the pipeline's `MAX_JOB_LOGS`). */
const MAX_LOG_LINES = 500;

/** The schema of each document a run reads. */
const SCHEMAS: Readonly<Record<DocumentTarget, Schema<unknown>>> = {
    city: cityDocSchema,
    job: jobDocSchema,
    version: layerVersionDocSchema,
    base: layerVersionDocSchema,
    layer: layerDocSchema,
    scene: usgsSceneDocSchema,
    pass: imageryPassDocSchema,
};

function refused(): ApiError {
    return new ApiError('apiError.worker.refused');
}

function callOf(caller: VerifiedCaller, request: Request): WorkerCall {
    return { cityId: request.cityId, workerId: request.workerId, uid: caller.uid };
}

/** The job the worker holds, with its allow-list's ids. */
async function heldScope(deps: StepDeps, call: WorkerCall, jobId: string): Promise<JobScope> {
    const job = await requireHeld(deps.documents, call, jobId, deps.clock.now());
    return { cityId: call.cityId, jobId, job, versionId: versionIdOf(jobId, job) };
}

/** `get {path}`: one document of the allow-list with its update time (both null when it does not exist). */
async function getDocument(deps: StepDeps, call: WorkerCall, jobId: string, path: string): Promise<Response> {
    return deps.documents.transaction(async (transaction) => {
        const job = await requireHeld(transaction, call, jobId, deps.clock.now());
        const target = documentTarget({ cityId: call.cityId, jobId, job, versionId: versionIdOf(jobId, job) }, path);
        if (target === undefined) {
            throw refused();
        }
        const read = await transaction.getVersioned(path, SCHEMAS[target]);
        return read === undefined
            ? { data: null, updateTime: null }
            : { data: toWire(read.data) as Record<string, unknown>, updateTime: read.updateTime };
    });
}

/** `list {collection}`: the ids of the job's log lines (the pipeline counts them to number the next one). */
async function listIds(deps: StepDeps, call: WorkerCall, jobId: string, collection: string): Promise<Response> {
    if (!isJobLog(await heldScope(deps, call, jobId), collection)) {
        throw refused();
    }
    const found = await deps.documents.query(collection, jobLogDocSchema);
    const ids = [...found.documents, ...found.invalid].map((line) => line.id).sort((a, b) => a.localeCompare(b));
    return { ids };
}

/** The sequence number of a log line the job may still write: its id's, under the cap, the same in its data. */
function lineSeq(scope: JobScope, path: string, data: Readonly<Record<string, unknown>>): number {
    const seq = logLineOf(scope, path) ?? MAX_LOG_LINES;
    if (seq >= MAX_LOG_LINES || data['seq'] !== seq) {
        throw refused();
    }
    return seq;
}

/** A log line of the job, numbered by its id, stamped `system:pipeline` at the server's time. */
function logLine(scope: JobScope, path: string, data: Readonly<Record<string, unknown>>, now: Date): JobLogDoc {
    lineSeq(scope, path, data);
    if (!storable(data)) {
        throw new ApiError('apiError.invalidRequest');
    }
    const result = validate(jobLogDocSchema, { ...data, updatedBy: PIPELINE_WRITER, updatedAt: at(now) });
    if (!result.ok) {
        throw new ApiError('apiError.invalidRequest', undefined, result.issues);
    }
    return result.value;
}

/** `create {path, data}`: one of the job's log lines, never over an existing one (`created: false`). */
async function createLine(deps: StepDeps, call: WorkerCall, jobId: string, op: Extract<Op, { op: 'create' }>): Promise<Response> {
    const line = logLine(await heldScope(deps, call, jobId), op.path, op.data, deps.clock.now());
    try {
        await deps.documents.create(op.path, jobLogDocSchema, line);
        return { created: true };
    } catch (error) {
        if (error instanceof UpstreamError && error.failure === 'conflict') {
            return { created: false };
        }
        throw error;
    }
}

/**
 * `worker.step` (`docs/research/M7-local-worker.md` §2.4, §2.5; S-A62-BAD-NOT-HOLDER): the pipeline's `DocumentStore` for
 * a local run, one operation a call, on the allow-list of the job the caller's worker holds. Reads and log lines go on
 * while the budget guard is red, and so do the writes that end the run (`step-update.ts`); every other write waits.
 */
async function workerStep(deps: StepDeps, caller: VerifiedCaller, request: Request): Promise<Response> {
    const call = callOf(caller, request);
    const op = request.request;
    switch (op.op) {
        case 'get':
            return getDocument(deps, call, request.jobId, op.path);
        case 'list':
            return listIds(deps, call, request.jobId, op.collection);
        case 'create':
            return createLine(deps, call, request.jobId, op);
        case 'update': {
            const context = { call, jobId: request.jobId, now: deps.clock.now(), red: await guardIsRed(deps.documents) };
            return updateDocument(deps.documents, context, op);
        }
    }
}

/** The `worker-step` callable. */
export function stepFunction(getDeps: () => StepDeps & CallableDeps) {
    return defineCallable('worker.step', paired(workerStep), getDeps);
}
