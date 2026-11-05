/**
 * Finding 85 of 2026-11-05: a scene whose import ended for good goes back to `candidate`, so it can be imported again. The
 * server's own endings free it (`end.ts`), but a run that failed in the pipeline ends the job by itself, and dismissing that
 * version left the scene `imported` for ever, with no Import to offer. Freed when the layer it reserved was never made and
 * every version of that layer was rejected or cancelled (a failed one may still be retried): on a dismissal, and on every
 * tick for a scene an earlier release left behind.
 */
import {
    FIRESTORE_PATHS,
    layerDocSchema,
    layerVersionDocSchema,
    usgsSceneDocSchema,
    type LayerVersionDoc,
    type UsgsSceneDoc,
} from '@hcm/shared';

import { omit } from '../api/objects.js';
import type { DocumentTransaction } from '../ports/documents.js';
import type { Ports } from '../ports/index.js';
import { IMAGERY_WRITER, stampOf } from './records.js';

export type ReleaseDeps = Pick<Ports, 'documents' | 'clock'>;

const GONE: ReadonlySet<LayerVersionDoc['state']> = new Set(['rejected', 'cancelled']);

/** True when one of the layer's versions (`ids`, re-read in the transaction) may still become its layer. */
async function versionHolds(transaction: DocumentTransaction, cityId: string, ids: readonly string[]): Promise<boolean> {
    for (const id of ids) {
        const version = await transaction.get(FIRESTORE_PATHS.layerVersion(cityId, id), layerVersionDocSchema);
        if (version !== undefined && !GONE.has(version.state)) {
            return true;
        }
    }
    return false;
}

/** The scene back to `candidate`, in a transaction that finds it still held by nothing. */
async function release(deps: ReleaseDeps, cityId: string, entityId: string, layerId: string): Promise<void> {
    const versions = await deps.documents.query(FIRESTORE_PATHS.layerVersions(cityId), layerVersionDocSchema, {
        where: [['layerId', '==', layerId]],
    });
    const ids = versions.documents.map((version) => version.id);
    const path = FIRESTORE_PATHS.usgsScene(cityId, entityId);
    await deps.documents.transaction(async (transaction) => {
        const scene = await transaction.get(path, usgsSceneDocSchema);
        const layer = await transaction.get(FIRESTORE_PATHS.layer(cityId, layerId), layerDocSchema);
        const held = await versionHolds(transaction, cityId, ids);
        if (scene?.layerId === layerId && layer === undefined && !held) {
            await transaction.set(path, usgsSceneDocSchema, {
                ...omit(scene, ['layerId']),
                status: 'candidate',
                ...stampOf(IMAGERY_WRITER, deps.clock.now()),
            });
        }
    });
}

function reservedLayer(scene: UsgsSceneDoc): string | undefined {
    return scene.status === 'imported' ? scene.layerId : undefined;
}

/** Every `imported` scene of the city that nothing holds any more goes back to `candidate`. */
export async function releaseScenes(deps: ReleaseDeps, cityId: string): Promise<void> {
    const scenes = await deps.documents.query(FIRESTORE_PATHS.usgsScenes(cityId), usgsSceneDocSchema, {
        where: [['status', '==', 'imported']],
    });
    for (const { id, data } of scenes.documents) {
        const layerId = reservedLayer(data);
        if (layerId !== undefined) {
            await release(deps, cityId, id, layerId);
        }
    }
}
