/** cities/{city}: admins read and edit; id, Mapbox tokens and createdAt are server-owned. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { EVERYONE, NON_ADMINS, createWorld, expected, past, stampedBy, verdict, verdicts, type Data, type World } from './support/world.js';

const CITY = 'cities/rules-cities';

let world: World;

function city(): Data {
    return {
        id: 'rules-cities',
        name: { ro: 'București', en: 'Bucharest' },
        bounds: { west: 25.9, south: 44.3, east: 26.3, north: 44.6 },
        published: false,
        mapbox: { user: 'demo', publicToken: 'pk.demo' },
        createdAt: past(),
        updatedBy: 'bootstrap',
        updatedAt: past(),
    };
}

beforeAll(async () => {
    world = await createWorld('cities');
});

beforeEach(async () => {
    await world.seed(CITY, city());
});

afterAll(async () => {
    await world.env.cleanup();
});

function edit(changes: Data, by = world.uid('admin')): Data {
    return { ...stampedBy(by), ...changes };
}

describe('read', () => {
    it('happyPath_onlyAdminsReadCities', async () => {
        const result = await verdicts(EVERYONE, (persona) => world.db(persona).doc(CITY).get());

        expect(result).toEqual(expected(EVERYONE, ['admin']));
    });
});

describe('update', () => {
    it('happyPath_adminEditsNameBoundsAndPublished', async () => {
        const changes = edit({
            name: { ro: 'Bucureștiul dispărut' },
            bounds: { west: 25.8, south: 44.2, east: 26.4, north: 44.7 },
            published: true,
        });

        expect(await verdict(world.db('admin').doc(CITY).update(changes))).toBe('allow');
    });

    it('badPath_nonAdminsCannotEdit', async () => {
        const result = await verdicts(NON_ADMINS, (persona) =>
            world
                .db(persona)
                .doc(CITY)
                .update(edit({ published: true }, world.uid(persona))),
        );

        expect(result).toEqual(expected(NON_ADMINS, []));
    });

    it.each([
        ['id', { id: 'other' }],
        ['mapbox', { mapbox: { user: 'demo', publicToken: 'pk.stolen' } }],
        ['createdAt', { createdAt: past().toMillis() }],
        ['name not bilingual', { name: { ro: 'București', fr: 'Bucarest' } }],
        ['name not a map', { name: 'București' }],
        ['name too long', { name: { ro: 'x'.repeat(101) } }],
        ['bounds not a map', { bounds: '25.9,44.3,26.3,44.6' }],
        ['bounds missing a side', { bounds: { west: 25.9, south: 44.3, east: 26.3 } }],
        ['bounds with an extra key', { bounds: { west: 25.9, south: 44.3, east: 26.3, north: 44.6, up: 1 } }],
        ['bounds east of west', { bounds: { west: 26.3, south: 44.3, east: 25.9, north: 44.6 } }],
        ['bounds off the globe', { bounds: { west: -181, south: 44.3, east: 26.3, north: 44.6 } }],
        ['bounds north of south', { bounds: { west: 25.9, south: 44.6, east: 26.3, north: 44.3 } }],
        ['published not a boolean', { published: 'yes' }],
    ])('badPath_adminCannotSet_%s', async (_label, changes) => {
        expect(await verdict(world.db('admin').doc(CITY).update(edit(changes)))).toBe('deny');
    });

    it('badPath_editsMustBeStampedByTheEditor', async () => {
        const forged = { ...edit({ published: true }), updatedBy: world.uid('stranger') };

        expect(await verdict(world.db('admin').doc(CITY).update(forged))).toBe('deny');
        expect(
            await verdict(
                world
                    .db('admin')
                    .doc(CITY)
                    .update({ published: true, updatedBy: world.uid('admin') }),
            ),
        ).toBe('deny');
    });
});

describe('create and delete', () => {
    it('badPath_citiesAreCreatedAndDeletedByCallablesOnly', async () => {
        const db = world.db('admin');

        expect(await verdict(db.doc('cities/rules-cities-new').set({ ...city(), id: 'rules-cities-new' }))).toBe('deny');
        expect(await verdict(db.doc(CITY).delete())).toBe('deny');
    });
});
