/**
 * `setup.createCity` (docs/research/M2b-interfaces.md §3.3 d2, CR-M2b-1): right after the owner claim the Setup
 * Assistant creates the city from the bundled seed, once; the server sets the fields a client may not.
 */
import { FIRESTORE_PATHS } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { createCity } from '../../src/setup/create-city.js';
import { ADMIN, CITY, NOW, createWorld } from './world.js';

const CREATED = { seconds: Date.parse(NOW) / 1000, nanoseconds: 0 };

/** The bundled seed's fields, as `legacyCityFields` of the admin hands them over. */
const SEED = {
    name: { ro: 'București dispărut', en: 'Lost Bucharest' },
    bounds: { west: 25.93, south: 44.33, east: 26.25, north: 44.55 },
    center: { lng: 26.085298, lat: 44.427037 },
    zoom: 14.5,
    minZoom: 10,
    maxZoom: 20,
    basemap: { style: 'mapbox://styles/mapbox/standard-satellite' },
} as const;

describe('setup.createCity', () => {
    it('happyPath_createsTheCityPublishedWithTheServersFields', async () => {
        const world = createWorld({ city: false });

        const response = await createCity(world.deps, ADMIN, { cityId: CITY, city: SEED });

        expect(response).toEqual({ created: true });
        expect(world.documents.peek(FIRESTORE_PATHS.city(CITY))).toEqual({
            ...SEED,
            id: CITY,
            published: true,
            createdAt: CREATED,
            updatedBy: ADMIN.uid,
            updatedAt: CREATED,
        });
        expect(world.logged()).toContain('city created');
    });

    it('badPath_anExistingCityIsLeftAsItIs', async () => {
        const world = createWorld();
        const before = world.documents.peek(FIRESTORE_PATHS.city(CITY));

        const response = await createCity(world.deps, ADMIN, { cityId: CITY, city: SEED });

        expect(response).toEqual({ created: false });
        expect(world.documents.peek(FIRESTORE_PATHS.city(CITY))).toEqual(before);
        expect(world.documents.writes).toEqual([]);
    });

    it('badPath_aContendedTransactionCreatesTheCityOnce', async () => {
        const world = createWorld({ city: false });
        world.documents.contend(2);

        await expect(createCity(world.deps, ADMIN, { cityId: CITY, city: SEED })).resolves.toEqual({ created: true });

        expect(world.documents.writes.filter((write) => write.kind === 'create')).toHaveLength(1);
    });
});
