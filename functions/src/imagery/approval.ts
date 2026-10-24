/**
 * The approval policy (`docs/research/M3-interfaces.md` §7.1; S-A17-*): when the pipeline registers a rendered version,
 * its compute-unit estimate is recorded and it is approved on its own, by `system:imagery`, when the city auto-publishes,
 * the georeference was measured (an upload's own georeference never is: S-A17-BAD-EMBEDDED-GEOREF) and its checkpoint
 * error is within the city's threshold over at least three checks. Otherwise it waits for Approve.
 */
import {
    FIRESTORE_PATHS,
    cityDocSchema,
    estimateComputeUnits,
    imagerySettingsOf,
    jobDocSchema,
    layerVersionDocSchema,
    precisionOf,
    timestampFromDate,
    type Georef,
    type ImagerySettings,
    type LayerVersionDoc,
} from '@hcm/shared';

import { compact } from '../api/objects.js';
import type { DocumentTransaction } from '../ports/documents.js';
import type { Ports } from '../ports/index.js';
import { enqueuePublish, type PublishReason } from './publish-queue.js';
import { IMAGERY_WRITER, stampOf, versionIdOf } from './records.js';

export type ApprovalDeps = Pick<Ports, 'documents' | 'clock' | 'log' | 'tasks'>;

/** A georeference is trusted on its own only with this many checks behind its checkpoint error. */
const MIN_CHECKPOINTS = 3;

type Output = NonNullable<LayerVersionDoc['output']>;

/** The version's compute-unit estimate (its area at its maximum zoom), as the guard and the approval card read it. */
export function estimateOf(output: Output, now: Date): NonNullable<LayerVersionDoc['estimate']> {
    return {
        computeUnits: estimateComputeUnits(output.areaKm2, output.maxzoom),
        precision: precisionOf(output.maxzoom),
        areaKm2: output.areaKm2,
        at: timestampFromDate(now),
    };
}

/** A georeference measured by its checkpoints (never an upload's own) and within `threshold` over enough of them. */
function measuredWithin(georef: Georef, threshold: number): boolean {
    const rmse = georef.checkpointRmseM ?? Number.POSITIVE_INFINITY;
    return georef.method !== 'embedded' && (georef.checkpointCount ?? 0) >= MIN_CHECKPOINTS && rmse <= threshold;
}

/** True when the version may be published without anyone's click. */
function autoApproves(version: LayerVersionDoc, settings: ImagerySettings): boolean {
    return settings.autoPublish && version.georef !== undefined && measuredWithin(version.georef, settings.rmseThresholdM);
}

/** The version approved: by the policy (`auto`, with the error and the threshold it met) or by an admin. */
export function approved(version: LayerVersionDoc, by: string, now: Date, settings?: ImagerySettings): LayerVersionDoc {
    const approval = compact<NonNullable<LayerVersionDoc['approval']>>({
        auto: settings !== undefined,
        by,
        at: timestampFromDate(now),
        checkpointRmseM: settings === undefined ? undefined : version.georef?.checkpointRmseM,
        thresholdM: settings?.rmseThresholdM,
    });
    return { ...version, state: 'approved', approval, ...stampOf(by, now) };
}

/** Queues the version's publish; the reason names the task, so a second approval of the same job queues nothing. */
export function queuePublish(deps: ApprovalDeps, cityId: string, jobId: string, reason: PublishReason): Promise<boolean> {
    return enqueuePublish(deps.tasks, { cityId, jobId }, reason);
}

type Rendered = LayerVersionDoc & { readonly output: Output };

function isRendered(version: LayerVersionDoc | undefined): version is Rendered {
    return version?.state === 'awaiting_approval' && version.output !== undefined;
}

interface Awaiting {
    readonly path: string;
    readonly version: Rendered;
    readonly settings: ImagerySettings;
}

/** The job's rendered version while both await approval, with the city's settings. */
async function readAwaiting(transaction: DocumentTransaction, cityId: string, jobId: string): Promise<Awaiting | undefined> {
    const job = await transaction.get(FIRESTORE_PATHS.job(cityId, jobId), jobDocSchema);
    if (job?.status !== 'awaiting_approval') {
        return undefined;
    }
    const path = FIRESTORE_PATHS.layerVersion(cityId, versionIdOf(jobId, job));
    const version = await transaction.get(path, layerVersionDocSchema);
    const city = await transaction.get(FIRESTORE_PATHS.city(cityId), cityDocSchema);
    return isRendered(version) ? { path, version, settings: imagerySettingsOf(city?.imagery) } : undefined;
}

async function policyIn(transaction: DocumentTransaction, cityId: string, jobId: string, now: Date): Promise<boolean> {
    const awaiting = await readAwaiting(transaction, cityId, jobId);
    if (awaiting === undefined) {
        return false;
    }
    const estimated: LayerVersionDoc = {
        ...awaiting.version,
        estimate: estimateOf(awaiting.version.output, now),
        ...stampOf(IMAGERY_WRITER, now),
    };
    const auto = autoApproves(estimated, awaiting.settings);
    await transaction.set(
        awaiting.path,
        layerVersionDocSchema,
        auto ? approved(estimated, IMAGERY_WRITER, now, awaiting.settings) : estimated,
    );
    return auto;
}

/**
 * The policy on a job that just reached `awaiting_approval` (`imagery.onJobWrite`): records the estimate, approves the
 * version when the policy allows and queues its publish. Returns whether it approved.
 */
export async function applyApprovalPolicy(deps: ApprovalDeps, cityId: string, jobId: string): Promise<boolean> {
    const now = deps.clock.now();
    const approvedNow = await deps.documents.transaction((transaction) => policyIn(transaction, cityId, jobId, now));
    if (approvedNow) {
        await queuePublish(deps, cityId, jobId, 'auto');
    }
    deps.log.info('approval policy applied', { cityId, jobId, approved: approvedNow });
    return approvedNow;
}
