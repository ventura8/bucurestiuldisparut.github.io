/**
 * A layer version and its job as the version's page shows them (`docs/research/M3-interfaces.md` §2.2–§2.4, §7, §10.2):
 * where it stands, its georeference and output, the compute-unit estimate and the guard's verdict, how it was approved;
 * the job's steps in the order its type runs them, its progress, wait and error; and the approval card's figures (the
 * checkpoint RMSE against the city's threshold, what publishing costs and what is left this month).
 */
import {
    availableComputeUnits,
    bboxFromRecord,
    estimateComputeUnits,
    isApiErrorCode,
    JOB_STEPS,
    jobRetryable,
    type BBox,
    type GeorefTransform,
    type JobDoc,
    type JobStatus,
    type JobWaitReason,
    type LayerVersionDoc,
    type LayerVersionState,
    type PublishChoice,
    type Sensor,
    type UsageCounters,
} from '@hcm/shared';

import { isoOf } from '../content/list.js';
import type { Stored } from '../content/services.js';
import { ACTIVE_JOB_STATUSES } from '../jobs/jobs.js';
import type { NoticeInput } from '../state/state.js';
import { isoOrNull, orNull } from './model.js';

export interface VersionView {
    readonly id: string;
    readonly layerId: string;
    readonly label: LayerVersionDoc['label'];
    readonly year: number;
    readonly date: string | null;
    readonly sensor: Sensor | null;
    readonly origin: LayerVersionDoc['origin'];
    readonly state: LayerVersionState;
    readonly georef: {
        readonly method: string;
        readonly transform: GeorefTransform;
        readonly pairs: number;
        readonly fitRmseM: number | null;
        readonly checkpointRmseM: number | null;
        readonly checkpointCount: number | null;
    } | null;
    readonly output: {
        readonly bounds: BBox;
        readonly minzoom: number;
        readonly maxzoom: number;
        readonly areaKm2: number;
        readonly previewPath: string;
        readonly studioPath: string | null;
        readonly cogBytes: number;
    } | null;
    readonly estimate: number | null;
    readonly guard: {
        readonly verdict: 'within' | 'over' | 'tileset-limit' | 'too-large';
        readonly available: number;
        readonly overageUsd: number | null;
        readonly choice: PublishChoice | null;
        readonly deferUntil: string | null;
    } | null;
    readonly approval: { readonly auto: boolean; readonly by: string; readonly at: string } | null;
    readonly error: NoticeInput | null;
    /** The georeferencer can open it: it has a scan. */
    readonly hasScan: boolean;
}

function georefOf(georef: LayerVersionDoc['georef']): VersionView['georef'] {
    if (georef === undefined) {
        return null;
    }
    return {
        ...{ method: georef.method, transform: georef.transform, pairs: georef.gcps.filter((gcp) => gcp.enabled).length },
        ...{
            fitRmseM: orNull(georef.fitRmseM),
            checkpointRmseM: orNull(georef.checkpointRmseM),
            checkpointCount: orNull(georef.checkpointCount),
        },
    };
}

function outputOf(output: LayerVersionDoc['output']): VersionView['output'] {
    if (output === undefined) {
        return null;
    }
    return {
        ...{ bounds: bboxFromRecord(output.bounds), minzoom: output.minzoom, maxzoom: output.maxzoom, areaKm2: output.areaKm2 },
        ...{ previewPath: output.previewPath, studioPath: orNull(output.studioPath), cogBytes: output.cogBytes },
    };
}

function guardOf(guard: LayerVersionDoc['guard']): VersionView['guard'] {
    if (guard === undefined) {
        return null;
    }
    return {
        ...{ verdict: guard.verdict, available: guard.available, overageUsd: orNull(guard.overageUsd), choice: orNull(guard.choice) },
        deferUntil: isoOrNull(guard.deferUntil),
    };
}

function approvalOf(approval: LayerVersionDoc['approval']): VersionView['approval'] {
    return approval === undefined ? null : { auto: approval.auto, by: approval.by, at: isoOf(approval.at) };
}

function errorOf(error: LayerVersionDoc['error']): NoticeInput | null {
    if (error === undefined) {
        return null;
    }
    return error.params === undefined ? { key: error.code } : { key: error.code, params: error.params };
}

/** The estimate the publisher recorded, else the same formula over the output. */
function estimateOf(version: LayerVersionDoc): number | null {
    const output = version.output;
    if (version.estimate !== undefined) {
        return version.estimate.computeUnits;
    }
    return output === undefined ? null : estimateComputeUnits(output.areaKm2, output.maxzoom);
}

export function versionViewOf(doc: Stored<LayerVersionDoc>): VersionView {
    const version = doc.data;
    return {
        ...{ id: doc.id, layerId: version.layerId, label: version.label, year: version.year, date: orNull(version.date) },
        ...{ sensor: orNull(version.sensor), origin: version.origin, state: version.state, georef: georefOf(version.georef) },
        ...{ output: outputOf(version.output), estimate: estimateOf(version), guard: guardOf(version.guard) },
        ...{ approval: approvalOf(version.approval), error: errorOf(version.error), hasScan: version.scan !== undefined },
    };
}

interface JobStepView {
    readonly name: string;
    readonly status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
}

export interface JobView {
    readonly id: string;
    readonly type: JobDoc['type'];
    readonly status: JobStatus;
    readonly finished: boolean;
    readonly progress: number | null;
    readonly step: string | null;
    /** Every step of the job's type, in order, with its state (`pending` until the job records one). */
    readonly steps: readonly JobStepView[];
    readonly waitReason: JobWaitReason | null;
    readonly retryAt: string | null;
    readonly attempt: number;
    readonly cancelRequested: boolean;
    readonly error: { readonly notice: NoticeInput; readonly message: string } | null;
    /** Retry may cure the failure (`jobRetryable`, CR-M3-47). */
    readonly retryable: boolean;
    /** Mapbox was asked to publish (its job recorded, or the call under way): Cancel can no longer stop it. */
    readonly atMapbox: boolean;
    /** An upload the server refused: its job failed before any version (no layer reserved). */
    readonly refusedUpload: boolean;
}

function stepsOf(job: JobDoc): JobStepView[] {
    const recorded = job.steps ?? {};
    return JOB_STEPS[job.type].map((name) => ({ name, status: recorded[name]?.status ?? 'pending' }));
}

/** A job's error code as a notice: an `apiError.*` code with its parameters (a code from before M3 reads as internal). */
function jobNotice(error: NonNullable<JobDoc['error']>): NoticeInput {
    if (!isApiErrorCode(error.code)) {
        return { key: 'apiError.internal' };
    }
    return error.params === undefined ? { key: error.code } : { key: error.code, params: error.params };
}

function jobErrorOf(error: JobDoc['error']): JobView['error'] {
    return error === undefined ? null : { notice: jobNotice(error), message: error.message };
}

/** Mapbox was asked to publish: the MTS job is recorded, or the publish call is (or was) under way. */
function atMapbox(job: JobDoc): boolean {
    const publish = job.steps?.['publish']?.status;
    return job.mapboxJobId !== undefined || publish === 'running' || publish === 'done';
}

export function jobViewOf(doc: Stored<JobDoc>): JobView {
    const job = doc.data;
    return {
        ...{ id: doc.id, type: job.type, status: job.status, finished: !ACTIVE_JOB_STATUSES.includes(job.status) },
        ...{ progress: orNull(job.progress), step: orNull(job.step), steps: stepsOf(job), waitReason: orNull(job.waitReason) },
        ...{ retryAt: isoOrNull(job.retryAt), attempt: orNull(job.attempt) ?? 0, cancelRequested: job.cancelRequested === true },
        ...{ error: jobErrorOf(job.error), retryable: jobRetryable(job), atMapbox: atMapbox(job) },
        refusedUpload: job.status === 'failed' && job.type === 'geotiff-import' && job.layerId === undefined,
    };
}

/** The approval card's numbers. */
export interface ApprovalFigures {
    /** Compute units the publish takes (null: no output yet). */
    readonly estimate: number | null;
    /** Compute units left this month. */
    readonly available: number;
    readonly fits: boolean;
    readonly checkpointRmseM: number | null;
    readonly thresholdM: number;
    /** Over the threshold (or never measured): the version waits for Approve. */
    readonly overThreshold: boolean;
}

export function approvalFigures(version: VersionView, usage: UsageCounters | undefined, thresholdM: number): ApprovalFigures {
    const available = availableComputeUnits(usage, version.id);
    const rmse = version.georef?.checkpointRmseM ?? null;
    return {
        ...{ estimate: version.estimate, available, fits: (version.estimate ?? 0) <= available },
        ...{ checkpointRmseM: rmse, thresholdM, overThreshold: rmse === null || rmse > thresholdM },
    };
}
