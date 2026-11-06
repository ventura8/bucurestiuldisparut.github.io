/**
 * What a published join does to its frames (`docs/research/M8-join-interfaces.md` §5), inside `finalizeVersion`'s transaction,
 * reads first: a frame still waiting for approval becomes `joined` and its job `succeeded` (its files stay for the layer:
 * `tick-maintenance.ts`, `layer-delete.ts`), and every frame's scene now holds the join's layer, or `releaseScenes` would free
 * it. A frame already published is the join's own layer's previous version, which `supersede` handles.
 */
import {
    FIRESTORE_PATHS,
    jobDocSchema,
    layerVersionDocSchema,
    usgsSceneDocSchema,
    type JobDoc,
    type JoinPart,
    type LayerVersionDoc,
    type UsgsSceneDoc,
} from '@hcm/shared';

import { omit } from '../api/objects.js';
import type { DocumentTransaction } from '../ports/documents.js';
import type { Stamp } from './records.js';

/** One frame of a join, as its transaction read it. */
export interface JoinFrame {
    readonly cityId: string;
    readonly part: JoinPart;
    readonly version: LayerVersionDoc | undefined;
    readonly job: JobDoc | undefined;
    readonly scene: UsgsSceneDoc | undefined;
}

type Apply = (transaction: DocumentTransaction) => Promise<void>;

async function readFrame(transaction: DocumentTransaction, cityId: string, part: JoinPart): Promise<JoinFrame> {
    return {
        cityId,
        part,
        version: await transaction.get(FIRESTORE_PATHS.layerVersion(cityId, part.versionId), layerVersionDocSchema),
        job: await transaction.get(FIRESTORE_PATHS.job(cityId, part.versionId), jobDocSchema),
        scene: await transaction.get(FIRESTORE_PATHS.usgsScene(cityId, part.entityId), usgsSceneDocSchema),
    };
}

/** Every frame of `version` when it is a join, read one after the other in the transaction; none for any other version. */
export async function readJoinFrames(transaction: DocumentTransaction, cityId: string, version: LayerVersionDoc): Promise<JoinFrame[]> {
    const frames: JoinFrame[] = [];
    for (const part of version.source?.kind === 'join' ? version.source.parts : []) {
        frames.push(await readFrame(transaction, cityId, part));
    }
    return frames;
}

function versionWrite({ cityId, part, version }: JoinFrame, stamp: Stamp): Apply | undefined {
    if (version?.state !== 'awaiting_approval' || version.output === undefined) {
        return undefined;
    }
    return (transaction) =>
        transaction.set(FIRESTORE_PATHS.layerVersion(cityId, part.versionId), layerVersionDocSchema, {
            ...version,
            state: 'joined',
            ...stamp,
        });
}

function jobWrite({ cityId, part, job }: JoinFrame, stamp: Stamp): Apply | undefined {
    if (job?.status !== 'awaiting_approval') {
        return undefined;
    }
    const succeeded: JobDoc = {
        ...omit(job, ['waitReason', 'error', 'lease']),
        status: 'succeeded',
        finishedAt: stamp.updatedAt,
        ...stamp,
    };
    return (transaction) => transaction.set(FIRESTORE_PATHS.job(cityId, part.versionId), jobDocSchema, succeeded);
}

function sceneWrite({ cityId, part, scene }: JoinFrame, layerId: string, stamp: Stamp): Apply | undefined {
    if (scene === undefined) {
        return undefined;
    }
    return (transaction) =>
        transaction.set(FIRESTORE_PATHS.usgsScene(cityId, part.entityId), usgsSceneDocSchema, {
            ...scene,
            status: 'imported',
            layerId,
            ...stamp,
        });
}

/** The writes for `frames` of a join published as layer `layerId`. */
export function joinFrameWrites(frames: readonly JoinFrame[], layerId: string, stamp: Stamp): (Apply | undefined)[] {
    return frames.flatMap((frame) => [versionWrite(frame, stamp), jobWrite(frame, stamp), sceneWrite(frame, layerId, stamp)]);
}
