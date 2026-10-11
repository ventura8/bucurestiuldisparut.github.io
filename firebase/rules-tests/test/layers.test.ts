/**
 * Pipeline-owned documents that admins only curate: cities/{city}/layers (presentation fields),
 * cities/{city}/gcps (ground control points) and cities/{city}/usgsScenes (triage status).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EVERYONE, createWorld, expected, past, serverTime, verdict, verdicts, type Data, type World } from './support/world.js';

const CITY = 'cities/rules-layers';

let world: World;
let sequence = 0;

function nextId(prefix: string): string {
    sequence += 1;
    return `${CITY}/${prefix}/${prefix}${String(sequence)}`;
}

function stamp(): Data {
    return { updatedBy: world.uid('admin'), updatedAt: serverTime() };
}

function layer(): Data {
    return {
        year: 1966,
        kind: 'satellite',
        sensor: 'KH-4A',
        label: { ro: 'Corona 1966', en: 'Corona 1966' },
        description: { ro: 'Fotografie declasificată.', en: 'Declassified photograph.' },
        order: 1,
        opacity: 0.8,
        defaultVisible: true,
        published: false,
        attribution: 'Courtesy of the U.S. Geological Survey',
        status: 'approved',
        updatedBy: 'pipeline',
        updatedAt: past(),
    };
}

async function seeded(prefix: string, data: Data): Promise<string> {
    const path = nextId(prefix);
    await world.seed(path, data);
    return path;
}

beforeAll(async () => {
    world = await createWorld('layers');
});

afterAll(async () => {
    await world.env.cleanup();
});

describe('layers', () => {
    it('happyPath_onlyAdminsReadLayers', async () => {
        const path = await seeded('layers', layer());

        const result = await verdicts(EVERYONE, (persona) => world.db(persona).doc(path).get());

        expect(result).toEqual(expected(EVERYONE, ['admin']));
    });

    it('happyPath_adminEditsPresentation', async () => {
        const path = await seeded('layers', layer());
        const changes = { ...stamp(), label: { ro: 'București, 1966' }, opacity: 0.5, order: 2, defaultVisible: false, published: true };

        expect(await verdict(world.db('admin').doc(path).update(changes))).toBe('allow');
    });

    it.each([
        ['the year', { year: 1977 }],
        ['the pipeline status', { status: 'draft' }],
        ['an opacity over 1', { opacity: 1.5 }],
        ['a fractional order', { order: 1.5 }],
        ['a visibility that is not a boolean', { defaultVisible: 'yes' }],
        ['a published flag that is not a boolean', { published: 1 }],
        ['a label over 200 characters', { label: { ro: 'x'.repeat(201) } }],
        ['a description that is not bilingual', { description: { de: 'Luftbild' } }],
        ['an attribution over 500 characters', { attribution: 'x'.repeat(501) }],
        ['another editor', { updatedBy: 'someone-else' }],
    ])('badPath_adminCannotSet_%s', async (_label, changes) => {
        const path = await seeded('layers', layer());

        expect(
            await verdict(
                world
                    .db('admin')
                    .doc(path)
                    .update({ ...stamp(), ...changes }),
            ),
        ).toBe('deny');
    });

    it('badPath_nonAdminsCannotEditAndNobodyCreatesOrDeletes', async () => {
        const path = await seeded('layers', layer());

        expect(
            await verdict(
                world
                    .db('stranger')
                    .doc(path)
                    .update({ ...stamp(), opacity: 0.1 }),
            ),
        ).toBe('deny');
        expect(await verdict(world.db('admin').doc(nextId('layers')).set(layer()))).toBe('deny');
        expect(await verdict(world.db('admin').doc(path).delete())).toBe('deny');
    });
});

describe('gcps', () => {
    const points = (count: number): Data[] =>
        Array.from({ length: count }, (_, index) => ({ pixel: [index, index], lngLat: [26.1, 44.4] }));

    it('happyPath_adminSavesAndReplacesControlPoints', async () => {
        const path = nextId('gcps');
        const db = world.db('admin');

        expect(await verdict(db.doc(path).set({ ...stamp(), points: points(4) }))).toBe('allow');
        expect(await verdict(db.doc(path).set({ ...stamp(), points: points(300) }))).toBe('allow');
        expect(await verdict(db.doc(path).get())).toBe('allow');
    });

    it.each([
        ['over 300 points', { points: points(301) }],
        ['points that are not a list', { points: { a: 1 } }],
        ['an unknown field', { points: points(1), rmse: 2 }],
        ['another editor', { points: points(1), updatedBy: 'someone-else' }],
    ])('badPath_adminCannotSave_%s', async (_label, changes) => {
        expect(
            await verdict(
                world
                    .db('admin')
                    .doc(nextId('gcps'))
                    .set({ ...stamp(), ...changes }),
            ),
        ).toBe('deny');
    });

    it('badPath_onlyAdminsReadWriteOrDelete', async () => {
        const path = await seeded('gcps', { points: points(2), updatedBy: 'pipeline', updatedAt: past() });

        const reads = await verdicts(['stranger', 'admin'], (persona) => world.db(persona).doc(path).get());
        const writes = await verdicts(['stranger'], (persona) =>
            world
                .db(persona)
                .doc(path)
                .set({ ...stamp(), points: points(1) }),
        );
        const deletes = await verdicts(['stranger', 'admin'], (persona) => world.db(persona).doc(path).delete());

        expect({ reads, writes, deletes }).toEqual({
            reads: { stranger: 'deny', admin: 'allow' },
            writes: { stranger: 'deny' },
            deletes: { stranger: 'deny', admin: 'allow' },
        });
    });
});

describe('usgsScenes', () => {
    const scene = (): Data => ({ entityId: 'DS1034-1057DA024', status: 'candidate', coverage: 0.92, free: true });

    it('happyPath_adminTriagesAScene', async () => {
        const path = await seeded('usgsScenes', scene());

        const ordered = world.db('admin').doc(path).update({ status: 'ordered', note: 'Comandat pe 2026-10-11.' });

        expect(await verdict(ordered)).toBe('allow');
        expect(await verdict(world.db('admin').doc(path).get())).toBe('allow');
    });

    it.each([
        ['an unknown status', { status: 'available' }],
        ['a note over 1000 characters', { status: 'rejected', note: 'x'.repeat(1001) }],
        ['a harvested field', { status: 'rejected', coverage: 1 }],
    ])('badPath_adminCannotSet_%s', async (_label, changes) => {
        const path = await seeded('usgsScenes', scene());

        expect(await verdict(world.db('admin').doc(path).update(changes))).toBe('deny');
    });

    it('badPath_nonAdminsCannotReadOrTriageAndNobodyCreates', async () => {
        const path = await seeded('usgsScenes', scene());

        expect(await verdict(world.db('stranger').doc(path).get())).toBe('deny');
        expect(await verdict(world.db('stranger').doc(path).update({ status: 'rejected' }))).toBe('deny');
        expect(await verdict(world.db('admin').doc(nextId('usgsScenes')).set(scene()))).toBe('deny');
    });
});
