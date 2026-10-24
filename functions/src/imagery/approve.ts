import '../global-options.js';

import {
    FINISHED_JOB_STATUSES,
    FIRESTORE_PATHS,
    jobDocSchema,
    layerVersionDocSchema,
    type CallableRequest,
    type CallableResponse,
    type JobDoc,
    type JobStatus,
    type LayerVersionDoc,
    type LayerVersionState,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { ApiError } from '../api/api-error.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import { approved, estimateOf, queuePublish, type ApprovalDeps } from './approval.js';
import { endWork } from './end.js';
import { requireVersion, stampOf } from './records.js';

/**
 * `imagery.approve` and `imagery.reject` (admin; `docs/research/M3-interfaces.md` §7.1; S-A12-HAPPY, S-A17-*): the one
 * click when a version did not publish on its own. Approve queues the publish (the compute-unit guard runs there);
 * Reject ends the version and its job, frees its reserved layer id and its scene, and the layer keeps its tiles. The
 * job and the version are checked again in the transaction that ends them, so a rejection never ends a publish the guard
 * has meanwhile sent to Mapbox (CR-M3-47). A version that failed is dismissed the same way: it becomes `rejected` and
 * leaves the Imagery area's "Waiting for you" (its job stays failed; the failure already released what it held).
 */
type VersionRequest = CallableRequest<'imagery.approve'>;

/** The versions an admin may still reject: waiting for points, for approval, or for a compute-unit choice. */
const REJECTABLE: ReadonlySet<LayerVersionState> = new Set<LayerVersionState>(['needs_gcps', 'awaiting_approval', 'approved']);
const FINISHED: ReadonlySet<JobStatus> = new Set(FINISHED_JOB_STATUSES);

/** A job and version a rejection may end: not at Mapbox, the version still waiting for the admin. */
function rejectable(job: JobDoc, version: LayerVersionDoc | undefined): boolean {
    return job.status !== 'mts_processing' && version !== undefined && REJECTABLE.has(version.state);
}

/** The version is approved now, its estimate recorded; any other state is `apiError.imagery.versionState`. */
async function approveVersion(deps: ApprovalDeps, caller: VerifiedCaller, request: VersionRequest): Promise<LayerVersionDoc> {
    const path = FIRESTORE_PATHS.layerVersion(request.cityId, request.versionId);
    const now = deps.clock.now();
    return deps.documents.transaction(async (transaction) => {
        const version = await transaction.get(path, layerVersionDocSchema);
        if (version === undefined) {
            throw new ApiError('apiError.notFound');
        }
        if (version.state !== 'awaiting_approval' || version.output === undefined) {
            throw new ApiError('apiError.imagery.versionState');
        }
        const result = approved({ ...version, estimate: version.estimate ?? estimateOf(version.output, now) }, caller.uid, now);
        await transaction.set(path, layerVersionDocSchema, result);
        return result;
    });
}

async function imageryApprove(
    deps: ApprovalDeps,
    caller: VerifiedCaller,
    request: VersionRequest,
): Promise<CallableResponse<'imagery.approve'>> {
    const version = await approveVersion(deps, caller, request);
    await queuePublish(deps, request.cityId, version.jobId, 'approved');
    deps.log.info('layer version approved', { uid: caller.uid, cityId: request.cityId, versionId: request.versionId });
    return { state: version.state, jobId: version.jobId };
}

/** The version's job is still unfinished and not at Mapbox, so rejecting it changes nothing published. */
async function requireRejectable(deps: ApprovalDeps, request: VersionRequest): Promise<LayerVersionDoc> {
    const version = await requireVersion(deps.documents, request.cityId, request.versionId);
    const job = await deps.documents.get(FIRESTORE_PATHS.job(request.cityId, version.jobId), jobDocSchema);
    const busyAtMapbox = job === undefined || FINISHED.has(job.status) || job.status === 'mts_processing';
    if (!REJECTABLE.has(version.state) || busyAtMapbox) {
        throw new ApiError('apiError.imagery.versionState');
    }
    return version;
}

/** A failed version, dismissed: `rejected` in a transaction that finds it still failed. */
async function dismissFailed(deps: ApprovalDeps, caller: VerifiedCaller, request: VersionRequest): Promise<void> {
    const path = FIRESTORE_PATHS.layerVersion(request.cityId, request.versionId);
    await deps.documents.transaction(async (transaction) => {
        const version = await transaction.get(path, layerVersionDocSchema);
        if (version?.state !== 'failed') {
            throw new ApiError('apiError.imagery.versionState');
        }
        await transaction.set(path, layerVersionDocSchema, { ...version, state: 'rejected', ...stampOf(caller.uid, deps.clock.now()) });
    });
}

/** A waiting version: it and its job end, checked again in the transaction. */
async function rejectWaiting(deps: ApprovalDeps, caller: VerifiedCaller, request: VersionRequest): Promise<void> {
    const version = await requireRejectable(deps, request);
    const ending = { status: 'cancelled', versionState: 'rejected', by: caller.uid, accept: rejectable } as const;
    if (!(await endWork(deps, request.cityId, version.jobId, ending))) {
        throw new ApiError('apiError.imagery.versionState');
    }
}

async function imageryReject(
    deps: ApprovalDeps,
    caller: VerifiedCaller,
    request: VersionRequest,
): Promise<CallableResponse<'imagery.reject'>> {
    const current = await requireVersion(deps.documents, request.cityId, request.versionId);
    await (current.state === 'failed' ? dismissFailed(deps, caller, request) : rejectWaiting(deps, caller, request));
    deps.log.info('layer version rejected', { uid: caller.uid, cityId: request.cityId, versionId: request.versionId, was: current.state });
    return { state: 'rejected' };
}

/** The `imagery-approve` callable. */
export function approveFunction(getDeps: () => ApprovalDeps & CallableDeps) {
    return defineCallable('imagery.approve', imageryApprove, getDeps);
}

/** The `imagery-reject` callable. */
export function rejectFunction(getDeps: () => ApprovalDeps & CallableDeps) {
    return defineCallable('imagery.reject', imageryReject, getDeps);
}
