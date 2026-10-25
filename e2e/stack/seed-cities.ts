import { readFile } from 'node:fs/promises';

import { citiesCreateRequestSchema, createLogger, poiCategoryDocSchema, poiDocSchema } from '@hcm/shared';
import type { APIRequestContext } from '@playwright/test';

import type { EmulatorWorld, SignedInAccount } from '../admin/support/emulators.js';
import { callable } from './callable.js';
import { firestoreShape } from './seed-content.js';

/**
 * The local stack's second city (M5; docs/SETUP.md → *Local stack for manual testing*): Iași, made by the project's owner
 * with the server's own `cities.create` and `setup.rotatePublicToken`, as New city makes it (its start view, texts and
 * per-city limits, the owner's membership, its viewer token, unpublished), then given a category and two places past the
 * rules, as an earlier session of editing would have. Nobody else administers it: `admin@e2e.test` edits Bucharest only,
 * so the city menu, the per-city admins and roles, the city's budget and the isolation between cities each have a city to
 * show. Its first USGS harvest is the scheduler's (the next `imagery.tick`, as for a city made in the admin). Not
 * Cluj-Napoca: the fake Nominatim finds only that name, so New city's own walk (docs/MANUAL_TEST_PLAN.md) can still make
 * it. Generated test values only.
 */

const log = createLogger('dev-stack-seed');

/** The second city's id, the one New city suggests for its name. */
export const STACK_SECOND_CITY = 'iasi';

/** Its name, as the city menu shows it. */
export const STACK_SECOND_CITY_NAME = 'Iași';

const NAME = { ro: STACK_SECOND_CITY_NAME, en: STACK_SECOND_CITY_NAME } as const;
const BOUNDS = { west: 27.52, south: 47.12, east: 27.66, north: 47.21 } as const;

/** When the city's content was written (fixed: never the wall clock). */
const SEEDED_AT = new Date('2026-10-18T09:00:00.000Z');

/** A schema as the seed uses it (zod's `parse`). */
interface Schema {
    parse(value: unknown): unknown;
}

/**
 * The theme New city sends for its first seed colour (`NEW_CITY_SEEDS[0]`, computed in the browser by `themeFromSeed`):
 * the same tokens the legacy Bucharest manifest carries for that seed (`seed/bucharest/`, read only).
 */
async function defaultTheme(): Promise<unknown> {
    const legacy = JSON.parse(await readFile('seed/bucharest/manifest.static.json', 'utf8')) as { city: { theme: unknown } };
    return legacy.city.theme;
}

const CATEGORY = { id: 'monumente', label: { ro: 'Monumente', en: 'Monuments' }, icon: 'account_balance', color: '#3D6B8C' } as const;

const PLACES = [
    {
        id: 'palatul-culturii',
        geometry: { type: 'Point', point: { lat: 47.1575, lng: 27.5869 } },
        title: { ro: 'Palatul Culturii', en: 'The Palace of Culture' },
        description: { ro: 'Construit între 1906 și 1925.', en: 'Built between 1906 and 1925.' },
        yearStart: 1906,
    },
    {
        id: 'parcul-copou',
        geometry: {
            type: 'Polygon',
            rings: [
                {
                    points: [
                        { lat: 47.181, lng: 27.562 },
                        { lat: 47.181, lng: 27.5705 },
                        { lat: 47.176, lng: 27.5705 },
                        { lat: 47.176, lng: 27.562 },
                        { lat: 47.181, lng: 27.562 },
                    ],
                },
            ],
        },
        title: { ro: 'Parcul Copou', en: 'Copou Park' },
    },
] as const;

/** Validates `data` with `schema`, then writes it past the rules. */
async function write(emulators: EmulatorWorld, path: string, schema: Schema, data: Readonly<Record<string, unknown>>): Promise<void> {
    schema.parse(firestoreShape(data));
    await emulators.setDocument(path, data);
}

async function seedContent(emulators: EmulatorWorld, owner: SignedInAccount): Promise<void> {
    const stamp = { createdAt: SEEDED_AT, updatedBy: owner.uid, updatedAt: SEEDED_AT };
    const { id: categoryId, ...category } = CATEGORY;
    await write(emulators, `cities/${STACK_SECOND_CITY}/poiCategories/${categoryId}`, poiCategoryDocSchema, {
        ...category,
        defaultOpacity: 1,
        order: 0,
        ...stamp,
    });
    for (const { id, ...place } of PLACES) {
        await write(emulators, `cities/${STACK_SECOND_CITY}/pois/${id}`, poiDocSchema, {
            ...place,
            category: categoryId,
            published: true,
            createdBy: owner.uid,
            ...stamp,
        });
    }
}

/** Iași through `cities.create`, then its content; a failure is logged and the stack comes up without it. */
export async function seedSecondCity(api: APIRequestContext, emulators: EmulatorWorld, owner: SignedInAccount): Promise<void> {
    try {
        const request = citiesCreateRequestSchema.parse({
            cityId: STACK_SECOND_CITY,
            name: NAME,
            bounds: BOUNDS,
            theme: await defaultTheme(),
        });
        const result = await callable(api, owner, 'cities.create', request);
        await callable(api, owner, 'setup.rotatePublicToken', { cityId: STACK_SECOND_CITY, audience: 'viewer' });
        await seedContent(emulators, owner);
        log.info('a second city, unpublished, its owner the project owner', { city: STACK_SECOND_CITY, created: result['created'] });
    } catch (error: unknown) {
        log.error('the second city could not be seeded; the rest of the world is', { error: String(error) });
    }
}
