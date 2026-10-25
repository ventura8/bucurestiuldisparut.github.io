/**
 * A new rendition of a version's scan (`docs/research/M3-interfaces.md` §4.1, §6.4; S-P02-*): new points from the
 * georeferencer, or a crop of the layer. It gets its own `regeoref` job and version on the same layer, built from the base
 * version's scan, reference, label and dates (the pipeline reads the scan, never rewrites it, and calls no USGS). The
 * layer keeps its tiles and shows the version as pending until it is published; a base that was still awaiting approval
 * is replaced (it and its job end, cancelled). The transaction that creates the new version reads the base and the layer
 * again (CR-M3-47): a base the guard sent to Mapbox meanwhile, or a layer another version took, refuses the save
 * (`apiError.imagery.versionState`, `apiError.layers.busy`) instead of cancelling what is already under way.
 */
import {
    FIRESTORE_PATHS,
    jobDocSchema,
    layerDocSchema,
    layerVersionDocSchema,
    type CropRing,
    type Georef,
    type JobDoc,
    type LayerDoc,
    type LayerVersionDoc,
} from '@hcm/shared';

import { ApiError } from '../api/api-error.js';
import { omit } from '../api/objects.js';
import type { DocumentTransaction } from '../ports/documents.js';
import type { Ports } from '../ports/index.js';
import { refuseBusyLayer, refuseNewRasterJob } from './limits.js';
import { pickDefined, stampOf, type Stamp } from './records.js';
import { createWork, jobIdFor, type NewWork } from './versions.js';

export type RegeorefDeps = Pick<Ports, 'documents' | 'clock' | 'log'>;

export interface Regeoref {
    readonly cityId: string;
    /** The version whose scan is rendered again. */
    readonly base: LayerVersionDoc;
    readonly origin: 'regeoref' | 'crop';
    readonly georef: Georef;
    readonly crop?: CropRing;
    readonly by: string;
}

type Fields = Parameters<typeof createWork>[2];

function fieldsOf(regeoref: Regeoref): Fields {
    const { base } = regeoref;
    const crop = regeoref.crop ?? base.crop;
    return {
        origin: regeoref.origin,
        basedOn: base.jobId,
        label: base.label,
        year: base.year,
        ...pickDefined(base, ['source', 'date', 'sensor', 'scan', 'reference']),
        georef: regeoref.georef,
        ...(crop === undefined ? {} : { crop }),
    };
}

/** The base still awaiting approval ends, cancelled: the new version replaces it. */
async function replaceBase(transaction: DocumentTransaction, regeoref: Regeoref, job: JobDoc, stamp: Stamp): Promise<void> {
    const { cityId, base } = regeoref;
    const cancelled: JobDoc = { ...omit(job, ['waitReason']), status: 'cancelled', finishedAt: stamp.updatedAt, ...stamp };
    await transaction.set(FIRESTORE_PATHS.job(cityId, base.jobId), jobDocSchema, cancelled);
    await transaction.set(FIRESTORE_PATHS.layerVersion(cityId, base.jobId), layerVersionDocSchema, {
        ...base,
        state: 'cancelled',
        ...stamp,
    });
}

/** The layer (when it exists already) shows the new version as pending. */
async function markPending(
    transaction: DocumentTransaction,
    regeoref: Regeoref,
    layer: LayerDoc | undefined,
    work: NewWork,
): Promise<void> {
    if (layer !== undefined) {
        const stamp = stampOf(work.createdBy, work.now);
        await transaction.set(FIRESTORE_PATHS.layer(regeoref.cityId, regeoref.base.layerId), layerDocSchema, {
            ...layer,
            pendingVersion: work.jobId,
            ...stamp,
        });
    }
}

/** The base's job, read again: still waiting for approval with its version, or the save is refused. */
async function awaitingBase(transaction: DocumentTransaction, regeoref: Regeoref): Promise<JobDoc> {
    const { cityId, base } = regeoref;
    const job = await transaction.get(FIRESTORE_PATHS.job(cityId, base.jobId), jobDocSchema);
    const version = await transaction.get(FIRESTORE_PATHS.layerVersion(cityId, base.jobId), layerVersionDocSchema);
    if (job?.status !== 'awaiting_approval' || version?.state !== 'awaiting_approval') {
        throw new ApiError('apiError.imagery.versionState');
    }
    return job;
}

/** The layer, read again: no other version may be on its way to it. */
async function freeLayer(transaction: DocumentTransaction, regeoref: Regeoref): Promise<LayerDoc | undefined> {
    const layer = await transaction.get(FIRESTORE_PATHS.layer(regeoref.cityId, regeoref.base.layerId), layerDocSchema);
    if (layer?.pendingVersion !== undefined && layer.pendingVersion !== regeoref.base.jobId) {
        throw new ApiError('apiError.layers.busy');
    }
    return layer;
}

async function regeorefIn(transaction: DocumentTransaction, regeoref: Regeoref, work: NewWork): Promise<void> {
    const awaiting = regeoref.base.state === 'awaiting_approval' ? await awaitingBase(transaction, regeoref) : undefined;
    const layer = await freeLayer(transaction, regeoref);
    await createWork(transaction, work, fieldsOf(regeoref));
    if (awaiting !== undefined) {
        await replaceBase(transaction, regeoref, awaiting, stampOf(work.createdBy, work.now));
    }
    await markPending(transaction, regeoref, layer, work);
}

/** Starts the new rendition after the creator's checks; its job id is also its version id. */
export async function startRegeoref(deps: RegeorefDeps, regeoref: Regeoref): Promise<{ jobId: string; versionId: string }> {
    const now = deps.clock.now();
    const { cityId, base } = regeoref;
    await refuseNewRasterJob(deps.documents, now, cityId);
    await refuseBusyLayer(deps.documents, cityId, base.layerId, base.state === 'awaiting_approval' ? base.jobId : undefined);
    const jobId = jobIdFor(regeoref.origin === 'crop' ? 'cr' : 'rg', now, base.layerId);
    const work: NewWork = {
        cityId,
        jobId,
        type: 'regeoref',
        params: { basedOn: base.jobId },
        layerId: base.layerId,
        createdBy: regeoref.by,
        now,
    };
    await deps.documents.transaction((transaction) => regeorefIn(transaction, regeoref, work));
    deps.log.info('layer version started', { uid: regeoref.by, cityId, layerId: base.layerId, jobId, origin: regeoref.origin });
    return { jobId, versionId: jobId };
}
