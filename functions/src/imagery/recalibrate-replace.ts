/**
 * M16 (`docs/research/M16-recalibrate.md` §5; S-A83-*): a refine of a version waiting for approval leaves that version, and the layer's
 * pending mark, where they are while it runs, because it may decline. Once the new version is rendered, the approval policy's transaction
 * calls this: the version it `replaces`, still waiting with its job, ends cancelled, and the layer shows the new one as pending. A version
 * approved or rejected meanwhile is left as it is.
 */
import {
    FIRESTORE_PATHS,
    jobDocSchema,
    layerDocSchema,
    layerVersionDocSchema,
    type JobDoc,
    type LayerDoc,
    type LayerVersionDoc,
} from '@hcm/shared';

import { omit } from '../api/objects.js';
import type { DocumentTransaction } from '../ports/documents.js';
import { IMAGERY_WRITER, stampOf, type Stamp } from './records.js';

interface Replaced {
    readonly id: string;
    readonly version: LayerVersionDoc | undefined;
    readonly job: JobDoc | undefined;
    readonly layer: LayerDoc | undefined;
}

async function readReplaced(transaction: DocumentTransaction, cityId: string, id: string, layerId: string): Promise<Replaced> {
    const version = await transaction.get(FIRESTORE_PATHS.layerVersion(cityId, id), layerVersionDocSchema);
    const job = await transaction.get(FIRESTORE_PATHS.job(cityId, id), jobDocSchema);
    const layer = await transaction.get(FIRESTORE_PATHS.layer(cityId, layerId), layerDocSchema);
    return { id, version, job, layer };
}

/** The replaced version and its job, both still waiting for approval, end cancelled. */
async function cancelWaiting(transaction: DocumentTransaction, cityId: string, replaced: Replaced, stamp: Stamp): Promise<void> {
    const { version, job } = replaced;
    if (version?.state !== 'awaiting_approval' || job?.status !== 'awaiting_approval') {
        return;
    }
    const cancelled: JobDoc = { ...omit(job, ['waitReason']), status: 'cancelled', finishedAt: stamp.updatedAt, ...stamp };
    await transaction.set(FIRESTORE_PATHS.job(cityId, replaced.id), jobDocSchema, cancelled);
    await transaction.set(FIRESTORE_PATHS.layerVersion(cityId, replaced.id), layerVersionDocSchema, {
        ...version,
        state: 'cancelled',
        ...stamp,
    });
}

/** The layer, when it exists and no other version is on its way to it, shows the new version as pending. */
async function markPending(
    transaction: DocumentTransaction,
    cityId: string,
    replaced: Replaced & { readonly next: LayerVersionDoc },
    stamp: Stamp,
): Promise<void> {
    const { layer, next } = replaced;
    const free = layer?.pendingVersion === undefined || layer.pendingVersion === replaced.id;
    if (layer !== undefined && free) {
        await transaction.set(FIRESTORE_PATHS.layer(cityId, next.layerId), layerDocSchema, {
            ...layer,
            pendingVersion: next.jobId,
            ...stamp,
        });
    }
}

/** Replaces the version `version.recalibration.replaces` names, if any; every read comes before the first write. */
export async function replaceWaitingBase(
    transaction: DocumentTransaction,
    cityId: string,
    version: LayerVersionDoc,
    now: Date,
): Promise<void> {
    const id = version.recalibration?.replaces;
    if (id === undefined) {
        return;
    }
    const replaced = await readReplaced(transaction, cityId, id, version.layerId);
    const stamp = stampOf(IMAGERY_WRITER, now);
    await cancelWaiting(transaction, cityId, replaced, stamp);
    await markPending(transaction, cityId, { ...replaced, next: version }, stamp);
}
