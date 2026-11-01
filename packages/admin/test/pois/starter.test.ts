import { FIRESTORE_PATHS } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import type { ContentStore } from '../../src/content/services.js';
import { POIS_MODULE } from '../../src/pois/pois.js';
import { readIds, starterWrites } from '../../src/pois/starter.js';
import { CITY, poisWorld, seedCategory, settle } from './world.js';

const LAYERS = FIRESTORE_PATHS.layers(CITY);

/** A store whose listener answers when the test says, recording whether it was stopped. */
function laterStore(): {
    readonly store: Pick<ContentStore, 'watchQuery'>;
    readonly answer: (ids: readonly string[] | null) => void;
    readonly stopped: () => number;
} {
    let stops = 0;
    let listener: ((ids: readonly string[] | null) => void) | null = null;
    const store: Pick<ContentStore, 'watchQuery'> = {
        watchQuery: (_collection, _schema, _query, listened, failed) => {
            listener = (ids) => {
                if (ids === null) {
                    failed({ kind: 'unavailable', code: 'unavailable' });
                    return;
                }
                listened({
                    docs: ids.map((id) => ({ id, path: id, data: {} as never, version: '', pending: false })),
                    invalid: [],
                    hasMore: false,
                    fromCache: false,
                });
            };
            return () => {
                stops += 1;
            };
        },
    };
    return { store, answer: (ids) => listener?.(ids), stopped: () => stops };
}

describe('the starter categories', () => {
    it('happyPath_theIdsAreReadOnceAndTheListenerStopsAtItsAnswer', async () => {
        const later = laterStore();
        const read = readIds(later.store, LAYERS);

        later.answer(['e2e-1966']);
        later.answer(['ignored']);

        await expect(read).resolves.toEqual(['e2e-1966']);
        expect(later.stopped()).toBe(1);
    });

    it('badPath_aReadThatFailsAnswersNull', async () => {
        const later = laterStore();
        const read = readIds(later.store, LAYERS);

        later.answer(null);

        await expect(read).resolves.toBeNull();
        expect(later.stopped()).toBe(1);
    });

    it('happyPath_theWritesComeAfterTheCitysCategoriesAndAvoidEveryTakenId', () => {
        const writes = starterWrites(
            CITY,
            [{ id: 'strada', label: { ro: 'Străzi' }, icon: 'add_road', color: '#000000', defaultOpacity: 1, order: 4 }],
            ['cladire'],
        );

        expect(writes.map((write) => write.path)).toEqual(
            ['cladire-2', 'strada-2', 'piata', 'biserica', 'monument'].map((id) => FIRESTORE_PATHS.poiCategory(CITY, id)),
        );
        expect(writes[0]).toMatchObject({ kind: 'create', data: { label: { ro: 'Clădire', en: 'Building' }, icon: 'domain', order: 5 } });
    });

    it('happyPath_oneClickAddsTheFiveAndTheNewPlaceTakesTheFirst', async () => {
        const world = poisWorld();
        world.store.put(`${LAYERS}/strada`, { label: { ro: 'Harta' } });
        const store = POIS_MODULE.create(world.services);
        store.open([]);
        store.open([store.intents.add('point')]);
        expect(store.state.editor?.draft?.issues.some((issue) => issue.path === 'category')).toBe(true);

        const outcome = await store.intents.addStarterCategories();
        await settle();

        expect(outcome).toEqual({ ok: true });
        expect(store.state.categories.items.map((category) => category.id)).toEqual([
            'cladire',
            'strada-2',
            'piata',
            'biserica',
            'monument',
        ]);
        expect(store.state.editor?.draft?.value.category).toBe('cladire');
        expect(store.state.editor?.draft?.issues.some((issue) => issue.path === 'category')).toBe(false);
        expect(world.notices.at(-1)).toEqual({ key: 'adminContent.pois.startersAdded' });
        expect(store.state.busy).toBe(false);
        expect(world.store.listeners(LAYERS)).toBe(0);
    });

    it('badPath_offlineNothingIsWrittenAndTheSnackbarSaysWhy', async () => {
        const world = poisWorld();
        seedCategory(world, 'biserici', 1);
        world.store.setOffline(true);
        const store = POIS_MODULE.create(world.services);
        store.open([]);

        const outcome = await store.intents.addStarterCategories();

        expect(outcome).toEqual({ ok: false, reason: 'offline' });
        expect(world.notices.at(-1)).toEqual({ key: 'adminContent.pois.offline' });
        expect([...world.store.docs.keys()].filter((path) => path.includes('/poiCategories/'))).toHaveLength(1);
    });

    it('badPath_aLayersReadThatFailsWritesNothing', async () => {
        const world = poisWorld();
        const store = POIS_MODULE.create(world.services);
        store.open([]);
        const original = world.store.watchQuery.bind(world.store);
        world.store.watchQuery = (collection, schema, query, listener, failed) => {
            if (collection === LAYERS) {
                failed({ kind: 'denied', code: 'permission-denied' });
                return () => undefined;
            }
            return original(collection, schema, query, listener, failed);
        };

        await expect(store.intents.addStarterCategories()).resolves.toEqual({ ok: false, reason: 'offline' });
        expect(world.store.writes.filter((write) => write.kind === 'batch')).toEqual([]);
    });
});
