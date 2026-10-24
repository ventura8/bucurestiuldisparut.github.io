/**
 * cities/{city}/jobs/{job} (+ logs), cities/{city}/layerVersions/{version} and cities/{city}/usgsScenes/{scene}: since M3
 * no client queues a job (`CLIENT_WRITES.job.create` is empty: the imagery callables and triggers create every job with
 * its checks, CR-M3-2); admins ask an unfinished job to stop, read the layer versions and triage harvested USGS scenes.
 * The dispatcher, the pipeline, the publisher and the harvest own every other field.
 */
import { FIRESTORE_PATHS, JOB_STATUSES, JOB_TYPES, USGS_SCENE_STATUSES } from '@hcm/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { jobDoc, layerDoc, layerVersionDoc, newJob, usgsSceneDoc } from './support/documents.js';
import { createWorld, deleted, serverTime, stampedBy, verdict, withChanges, type Data, type Verdict, type World } from './support/world.js';

const CITY_ID = 'rules-jobs';
const FINISHED = ['succeeded', 'failed', 'cancelled'];
const TRIAGE = ['candidate', 'ordered', 'rejected'];

let world: World;
let sequence = 0;

function nextId(): string {
    sequence += 1;
    return `j${String(sequence)}`;
}

function queue(changes: Data, id = nextId()): Promise<Verdict> {
    const job = withChanges(newJob(world.uid('admin')), changes);
    return verdict(
        world
            .db('admin')
            .doc(`${FIRESTORE_PATHS.jobs(CITY_ID)}/${id}`)
            .set(job),
    );
}

async function seeded(path: string, data: Data): Promise<string> {
    await world.seed(path, data);
    return path;
}

async function cancel(status: string, changes: Data = { cancelRequested: true }): Promise<Verdict> {
    const path = await seeded(FIRESTORE_PATHS.job(CITY_ID, nextId()), jobDoc(world.uid('admin'), status));
    return verdict(
        world
            .db('admin')
            .doc(path)
            .update({ ...stampedBy(world.uid('admin')), ...changes }),
    );
}

async function triage(changes: Data, status = 'candidate'): Promise<Verdict> {
    const path = await seeded(FIRESTORE_PATHS.usgsScene(CITY_ID, nextId()), usgsSceneDoc(status));
    return verdict(
        world
            .db('admin')
            .doc(path)
            .update({ ...stampedBy(world.uid('admin')), ...changes }),
    );
}

beforeAll(async () => {
    world = await createWorld('jobs');
});

afterAll(async () => {
    await world.close();
});

describe('queue a job', () => {
    it.each(JOB_TYPES)('badPath_noClientQueuesAJob_%s', async (type) => {
        expect(await queue({ type })).toBe('deny');
    });

    it('badPath_noClientDeletesALayerOrQueuesItsTilesetDeletion @S-A33-BAD-CLIENT-LAYER-DELETE', async () => {
        const layer = await seeded(FIRESTORE_PATHS.layer(CITY_ID, 'l1960'), layerDoc());
        const removal = await verdict(world.db('admin').doc(layer).delete());

        expect({ job: await queue({ type: 'layer-delete', params: { layerId: 'l1960' } }), removal }).toEqual({
            job: 'deny',
            removal: 'deny',
        });
        expect(JOB_TYPES).toContain('layer-delete');
    });

    it.each([
        ['an unknown type', { type: 'shell' }],
        ['a status other than queued', { status: 'running' }],
        ['a runner-owned field', { step: 'publish' }],
    ])('badPath_adminCannotQueueWith_%s', async (_label, changes) => {
        expect(await queue(changes)).toBe('deny');
    });
});

describe('layer versions', () => {
    it('happyPath_adminReadsALayerVersionAndNoClientWritesOne', async () => {
        const path = await seeded(FIRESTORE_PATHS.layerVersion(CITY_ID, 'v1'), layerVersionDoc());
        const read = await verdict(world.db('admin').doc(path).get());
        const edit = await verdict(
            world
                .db('admin')
                .doc(path)
                .update({ state: 'approved', ...stampedBy(world.uid('admin')) }),
        );
        const create = await verdict(world.db('admin').doc(FIRESTORE_PATHS.layerVersion(CITY_ID, 'v2')).set(layerVersionDoc()));
        const removal = await verdict(world.db('admin').doc(path).delete());

        expect({ read, edit, create, removal }).toEqual({ read: 'allow', edit: 'deny', create: 'deny', removal: 'deny' });
    });
});

describe('cancel a job', () => {
    it.each(JOB_STATUSES.filter((status) => !FINISHED.includes(status)))('happyPath_adminCancelsAJobThatIs_%s', async (status) => {
        expect(await cancel(status)).toBe('allow');
    });

    it.each(FINISHED)('badPath_aFinishedJobCannotBeCancelled_%s', async (status) => {
        expect(await cancel(status)).toBe('deny');
    });

    it.each([
        ['a cancellation withdrawn', { cancelRequested: false }],
        ['a status change', { cancelRequested: true, status: 'succeeded' }],
        ['new params', { cancelRequested: true, params: {} }],
        ['another editor', { cancelRequested: true, updatedBy: 'someone-else' }],
        ['a rewritten createdAt', { cancelRequested: true, createdAt: serverTime() }],
    ])('badPath_adminCannotSend_%s', async (_label, changes) => {
        expect(await cancel('running', changes)).toBe('deny');
    });

    it('badPath_aCancellationMustBeStamped', async () => {
        const path = await seeded(FIRESTORE_PATHS.job(CITY_ID, nextId()), jobDoc(world.uid('admin')));

        expect(await verdict(world.db('admin').doc(path).update({ cancelRequested: true }))).toBe('deny');
    });
});

describe('triage a USGS scene', () => {
    it.each(TRIAGE)('happyPath_adminMarksASceneAs_%s', async (status) => {
        expect(await triage({ status, note: 'Comandat pe 2026-10-11.' })).toBe('allow');
    });

    it.each(USGS_SCENE_STATUSES)('happyPath_adminAnnotatesASceneThatIs_%s', async (status) => {
        expect(await triage({ note: 'Acoperire parțială.' }, status)).toBe('allow');
    });

    it('happyPath_adminRemovesANote', async () => {
        expect(await triage({ note: deleted() })).toBe('allow');
    });

    it.each(USGS_SCENE_STATUSES.filter((status) => !TRIAGE.includes(status)))('badPath_onlyTheHarvestSetsStatus_%s', async (status) => {
        expect(await triage({ status })).toBe('deny');
    });

    it.each([
        ['a note over 1000 characters', { status: 'rejected', note: 'x'.repeat(1001) }],
        ['an empty note', { note: '' }],
        ['a harvested field', { status: 'rejected', downloadAvailable: false }],
        ['another editor', { status: 'rejected', updatedBy: 'someone-else' }],
    ])('badPath_adminCannotSet_%s', async (_label, changes) => {
        expect(await triage(changes)).toBe('deny');
    });
});
