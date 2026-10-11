/** cities/{city}/jobs/{job} (+ logs): admins queue jobs and request cancellation; the runner owns the rest. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { NON_ADMINS, createWorld, expected, past, serverTime, verdict, verdicts, type Data, type World } from './support/world.js';

const JOBS = 'cities/rules-jobs/jobs';

let world: World;
let sequence = 0;

function nextPath(): string {
    sequence += 1;
    return `${JOBS}/j${String(sequence)}`;
}

function request(uid: string): Data {
    return { type: 'usgs-import', status: 'queued', params: { entityId: 'DS1034-1057DA024' }, createdBy: uid, createdAt: serverTime() };
}

function running(): Data {
    return { type: 'usgs-import', status: 'running', params: {}, createdBy: 'someone', createdAt: past(), step: 'fetch' };
}

async function seeded(data: Data): Promise<string> {
    const path = nextPath();
    await world.seed(path, data);
    return path;
}

beforeAll(async () => {
    world = await createWorld('jobs');
});

afterAll(async () => {
    await world.env.cleanup();
});

describe('create', () => {
    it.each(['usgs-import', 'geotiff-import', 'regeoref', 'republish'])('happyPath_adminQueues_%s', async (type) => {
        const job = { ...request(world.uid('admin')), type };

        expect(await verdict(world.db('admin').doc(nextPath()).set(job))).toBe('allow');
    });

    it('badPath_nonAdminsCannotQueue', async () => {
        const result = await verdicts(NON_ADMINS, (persona) =>
            world
                .db(persona)
                .doc(nextPath())
                .set(request(world.uid(persona))),
        );

        expect(result).toEqual(expected(NON_ADMINS, []));
    });

    it.each([
        ['an unknown type', { type: 'shell' }],
        ['a status other than queued', { status: 'running' }],
        ['params that are not a map', { params: 'entityId=DS1' }],
        ['a runner-owned field', { step: 'publish' }],
        ['another creator', { createdBy: 'someone-else' }],
        ['a client createdAt', { createdAt: past() }],
    ])('badPath_adminCannotQueueWith_%s', async (_label, changes) => {
        const job = { ...request(world.uid('admin')), ...changes };

        expect(await verdict(world.db('admin').doc(nextPath()).set(job))).toBe('deny');
    });
});

describe('update', () => {
    it('happyPath_adminRequestsCancellation', async () => {
        const path = await seeded(running());

        expect(await verdict(world.db('admin').doc(path).update({ cancelRequested: true }))).toBe('allow');
    });

    it.each([
        ['a cancellation withdrawn', { cancelRequested: false }],
        ['a status change', { cancelRequested: true, status: 'succeeded' }],
    ])('badPath_adminCannotSend_%s', async (_label, changes) => {
        const path = await seeded(running());

        expect(await verdict(world.db('admin').doc(path).update(changes))).toBe('deny');
    });

    it('badPath_nonAdminsCannotCancelAndNobodyDeletes', async () => {
        const path = await seeded(running());

        expect(await verdict(world.db('stranger').doc(path).update({ cancelRequested: true }))).toBe('deny');
        expect(await verdict(world.db('admin').doc(path).delete())).toBe('deny');
    });
});

describe('read', () => {
    it('happyPath_onlyAdminsReadJobsAndTheirLogs', async () => {
        const path = await seeded(running());
        await world.seed(`${path}/logs/l1`, { line: 'fetch: 12% of 1.2 GB' });

        const jobs = await verdicts(['stranger', 'admin'], (persona) => world.db(persona).doc(path).get());
        const logs = await verdicts(['stranger', 'admin'], (persona) => world.db(persona).collection(`${path}/logs`).get());

        expect({ jobs, logs }).toEqual({ jobs: { stranger: 'deny', admin: 'allow' }, logs: { stranger: 'deny', admin: 'allow' } });
    });

    it('badPath_logsAreWrittenByTheRunnerOnly', async () => {
        const path = await seeded(running());

        expect(await verdict(world.db('admin').doc(`${path}/logs/l1`).set({ line: 'forged' }))).toBe('deny');
    });
});
