import { FIRESTORE_PATHS } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import type { AreaStore } from '../../src/content/areas.js';
import { LAST_CATEGORY_KEY } from '../../src/pois/actions.js';
import { POIS_MODULE } from '../../src/pois/pois.js';
import type { PoisIntents, PoisState } from '../../src/pois/state.js';
import { AREA, CITY, CONTAINER, POINT, seedPlace, seededWorld, settle, type PoisWorld } from './world.js';

function opened(world: PoisWorld, params: readonly string[] = []): AreaStore<PoisState, PoisIntents> {
    const store = POIS_MODULE.create(world.services);
    store.open(params);
    return store;
}

describe('places: the list', () => {
    it('happyPath_theListShowsTheCitysPlacesNewestFirstWithTheirCategories', () => {
        const world = seededWorld();

        const store = opened(world);

        expect(POIS_MODULE.area).toBe('pois');
        expect(store.state.list.items.map((item) => item.id)).toEqual(['cismigiu', 'stavropoleos']);
        expect(store.state.categories.items.map((category) => category.id)).toEqual(['biserici', 'parcuri']);
        expect(store.state.frame?.view).toEqual({ center: [26.1, 44.43], zoom: 14, bearing: 0 });
        expect(store.hasUnsavedChanges()).toBe(false);
    });

    it('happyPath_filtersQueryOneIndexAndTheRestFilterTheLoadedPage', () => {
        const world = seededWorld();
        const store = opened(world);

        store.intents.setFilter({ category: 'parcuri' });
        expect(store.state.list.items.map((item) => item.id)).toEqual(['cismigiu']);
        store.intents.setFilter({ category: null, unpublished: true });
        expect(store.state.list.items.map((item) => item.id)).toEqual(['cismigiu']);
        store.intents.setFilter({ unpublished: false, search: 'STAVRO' });

        expect(store.state.filter).toEqual({ category: null, unpublished: false, search: 'STAVRO' });
        expect(store.state.list.items).toHaveLength(2);
    });

    it('badPath_aListenerThatFailsRecoversWithTryAgain', () => {
        const world = seededWorld();
        const store = opened(world);
        world.store.fail(FIRESTORE_PATHS.pois(CITY), { kind: 'denied', code: 'permission-denied' });
        expect(store.state.list.status).toBe('error');

        store.intents.retry();
        store.intents.more();

        expect(store.state.list.status).toBe('ready');
        expect(world.denials.count).toBe(1);
    });

    it('happyPath_aBulkActionChangesTheSelectionAndReports', async () => {
        const world = seededWorld();
        const store = opened(world);

        store.intents.toggleSelected('cismigiu');
        store.intents.toggleSelected('stavropoleos');
        store.intents.toggleSelected('stavropoleos');
        expect(store.state.selection).toEqual(['cismigiu']);
        store.intents.selectAll();
        expect(store.state.selection).toEqual(['cismigiu', 'stavropoleos']);
        await store.intents.bulk({ kind: 'publish', published: true });

        expect(world.store.docs.get(FIRESTORE_PATHS.poi(CITY, 'cismigiu'))).toMatchObject({ published: true });
        expect(store.state.selection).toEqual([]);
        expect(world.notices.at(-1)).toEqual({ key: 'adminContent.pois.bulkDone', params: { changed: '1', skipped: '1' } });
    });

    it('badPath_aBulkActionWithoutSelectionOrThatTheStoreRefusesKeepsTheSelection', async () => {
        const world = seededWorld();
        const store = opened(world);
        await store.intents.bulk({ kind: 'delete' });
        expect(world.store.writes).toEqual([]);

        store.intents.selectAll();
        world.store.outcomes.push({ ok: false, reason: 'denied' });
        await store.intents.bulk({ kind: 'delete' });

        expect(store.state.selection).toHaveLength(2);
        expect(world.denials.count).toBe(1);
        expect(world.notices.at(-1)).toEqual({ key: 'adminContent.pois.bulkStopped', params: { changed: '0', skipped: '2' } });
        store.intents.clearSelection();
        expect(store.state.selection).toEqual([]);
    });

    it('badPath_aBulkActionThatGoesOfflineStopsWithoutAskingWhoThisIs', async () => {
        const world = seededWorld();
        const store = opened(world);
        store.intents.selectAll();
        world.store.outcomes.push({ ok: false, reason: 'offline' });

        await store.intents.bulk({ kind: 'move', category: 'biserici' });

        expect(world.denials.count).toBe(0);
        expect(world.notices.at(-1)?.key).toBe('adminContent.pois.bulkStopped');
    });

    it('happyPath_aBulkDeleteSaysHowToRestore', async () => {
        const world = seededWorld();
        const store = opened(world);
        store.intents.selectAll();

        await store.intents.bulk({ kind: 'delete' });

        expect(world.notices.at(-1)).toEqual({ key: 'adminContent.pois.bulkDeleted', params: { changed: '2', skipped: '0' } });
        expect(store.state.list.items).toEqual([]);
    });
});

describe('places: adding and editing', () => {
    it('happyPath_aNewPlaceStartsInTheLastCategoryAndSavesPublished', async () => {
        const world = seededWorld();
        world.services.local.set(LAST_CATEGORY_KEY, 'parcuri');
        const store = opened(world);

        const id = store.intents.add('point');
        store.open([id]);
        expect(store.state.editor?.draft?.value).toMatchObject({ category: 'parcuri', geometry: null, published: true });
        expect(store.hasUnsavedChanges()).toBe(true);
        store.intents.edit({ title: { ro: 'Statuia' } });
        store.intents.editVertex({ kind: 'add', index: -1, position: [26.1, 44.43] });
        const outcome = await store.intents.save();

        expect(outcome).toEqual({ ok: true });
        expect(world.store.docs.get(FIRESTORE_PATHS.poi(CITY, id))).toMatchObject({
            category: 'parcuri',
            published: true,
            title: { ro: 'Statuia' },
        });
        expect(world.notices.at(-1)).toEqual({ key: 'adminContent.pois.saved' });
        expect(world.services.local.get(LAST_CATEGORY_KEY)).toBe('parcuri');
        expect(store.hasUnsavedChanges()).toBe(false);
    });

    it('happyPath_addingWhileAPlaceIsOpenKeepsThatPlaceOpen', () => {
        const world = seededWorld();
        const store = opened(world, ['stavropoleos']);

        store.intents.add('point');

        expect(store.state.editor?.id).toBe('stavropoleos');
    });

    it('badPath_withoutAMapFactoryTheMapIsUnavailable', () => {
        const world = seededWorld({ maps: null });
        const store = opened(world);

        store.intents.attachMap(CONTAINER);

        expect(store.state.map).toBe('failed');
    });

    it('happyPath_withoutARememberedCategoryTheFirstIsUsed', () => {
        const world = seededWorld();
        const store = opened(world);

        store.open([store.intents.add('linestring')]);

        expect(store.state.editor).toMatchObject({ shape: 'linestring', draft: { value: { category: 'biserici' } } });
    });

    it('badPath_aSaveTheStoreRefusesSaysWhy', async () => {
        const world = seededWorld();
        const store = opened(world, ['stavropoleos']);
        store.intents.edit({ published: false });
        world.store.outcomes.push({ ok: false, reason: 'denied' });

        const outcome = await store.intents.save();
        store.intents.edit({ title: { ro: '' } });
        const invalid = await store.intents.save();

        expect(outcome).toEqual({ ok: false, reason: 'denied' });
        expect(invalid).toMatchObject({ ok: false, reason: 'invalid' });
        expect(world.notices.map((notice) => notice.key)).toEqual(['adminContent.pois.denied', 'adminContent.pois.invalid']);
        expect(world.denials.count).toBe(1);
    });

    it('badPath_anUnknownOrMalformedIdIsNotFound', async () => {
        const world = seededWorld();
        const store = opened(world, ['nu-exista']);
        expect(store.state.editor?.status).toBe('not-found');

        store.open(['a/b']);

        expect(store.state.editor).toMatchObject({ id: 'a/b', status: 'not-found', draft: null });
        expect(await store.intents.save()).toBeNull();
        expect(await store.intents.remove()).toBeNull();
        expect(store.intents.addAtCentre()).toBe(false);
        expect(store.intents.undoLastVertex()).toBe(false);
        expect(store.intents.editVertex({ kind: 'remove', index: 0 })).toBe(false);
        store.intents.redraw('point');
        store.intents.selectVertex(0);
        store.intents.discard();
        store.intents.keepMine();
        store.intents.takeTheirs();
        store.intents.edit({ title: { ro: 'x' } });
        store.open([]);
        expect(store.state.editor).toBeNull();
    });

    it('happyPath_theOpenPlaceFollowsItsDocumentAndTheVertexList', () => {
        const world = seededWorld();
        const store = opened(world, ['cismigiu']);

        store.intents.selectVertex(0);
        store.intents.editVertex({ kind: 'move', index: 0, by: 1 });
        store.intents.redraw('point');
        store.intents.discard();
        store.intents.keepMine();
        store.intents.takeTheirs();

        expect(store.state.editor).toMatchObject({ id: 'cismigiu', shape: 'polygon', draft: { value: { geometry: AREA } } });
    });
});

describe('places: the map', () => {
    it('happyPath_theMapShowsThePlacesAndAClickOpensOne', async () => {
        const world = seededWorld();
        const store = opened(world);

        store.intents.attachMap(CONTAINER);
        await settle();
        world.maps.map.clickPoi('stavropoleos');
        world.maps.map.clickPoi('stavropoleos');

        expect(store.state.map).toBe('ready');
        expect(store.state.clicked).toEqual({ id: 'stavropoleos', seq: 2 });
        const drawn = world.maps.map.callsOf('addVectorOverlay').map((args) => (args[0] as { id: string }).id);
        expect(drawn).toContain('biserici');
        expect(drawn).toContain('parcuri');
    });

    it('happyPath_drawingOnTheMapShapesTheOpenPlaceAndAddAtCentreAddsAVertex', async () => {
        const world = seededWorld();
        const store = opened(world);
        store.intents.attachMap(CONTAINER);
        await settle();
        const id = store.intents.add('polygon');
        store.open([id]);
        expect(world.maps.draw.mode).toBe('draw-polygon');

        world.maps.draw.emitRefused({
            kind: 'outside',
            bounds: [
                [26, 44],
                [27, 45],
            ],
        });
        expect(store.state.editor?.refusal).toBe('outside');
        world.maps.draw.emitChange([{ id, geometry: AREA }]);
        expect(store.state.editor?.draft?.value.geometry).toEqual(AREA);
        world.maps.map.view = { center: [26.105, 44.435], zoom: 16, bearing: 0 };
        store.intents.selectVertex(0);
        expect(store.intents.addAtCentre()).toBe(true);
        store.intents.setTool('select');
        store.intents.zoomBy(-1);

        expect(store.state.editor?.draft?.value.geometry?.type).toBe('Polygon');
        expect(world.maps.draw.mode).toBe('select');
        store.intents.detachMap();
        expect(store.state.map).toBe('none');
    });
});

describe('places: deleting', () => {
    it('happyPath_aDeleteOffersUndoThatRestoresThePlace', async () => {
        const world = seededWorld();
        world.callables.answer('history.revert', () => ({ restoredFields: [] }));
        const store = opened(world, ['stavropoleos']);

        const outcome = await store.intents.remove();
        const notice = world.notices.at(-1);
        world.store.put(`${FIRESTORE_PATHS.history({ entity: 'poi', cityId: CITY, entityId: 'stavropoleos' })}/20261017120000000-a`, {
            ...{
                entity: 'poi',
                entityId: 'stavropoleos',
                action: 'delete',
                previous: { title: { ro: 'Stavropoleos' } },
                changedFields: [],
            },
            ...world.store.stamp(),
        });
        notice?.action?.run();
        await settle();

        expect(outcome).toEqual({ ok: true });
        expect(notice?.key).toBe('adminContent.pois.deleted');
        expect(notice?.action?.key).toBe('adminContent.pois.undo');
        expect(world.callables.named('history.revert')).toBe(1);
        expect(world.notices.at(-1)).toEqual({ key: 'adminContent.pois.restored' });
        expect(store.state.editor?.draft?.gone).toBe(true);
        world.clock.advance(10_000);
    });

    it('badPath_aDeleteTheStoreRefusesSaysWhyAndAnUnavailableUndoToo', async () => {
        const world = seededWorld();
        const store = opened(world, ['stavropoleos']);
        world.store.outcomes.push({ ok: false, reason: 'conflict' });

        const refused = await store.intents.remove();
        const deleted = await store.intents.remove();
        world.clock.advance(10_000);
        world.notices.at(-1)?.action?.run();
        await settle();

        expect(refused).toEqual({ ok: false, reason: 'conflict' });
        expect(deleted).toEqual({ ok: true });
        expect(world.notices.map((notice) => notice.key)).toEqual([
            'adminContent.pois.conflict',
            'adminContent.pois.deleted',
            'adminContent.pois.undoUnavailable',
        ]);
    });

    it('badPath_aNewPlaceHasNothingToDelete', async () => {
        const world = seededWorld();
        const store = opened(world);
        store.open([store.intents.add('point')]);

        expect(await store.intents.remove()).toBeNull();
    });
});

describe('places: files and photos', () => {
    it('happyPath_theExportHoldsEveryLoadedPlaceOrTheSelection', () => {
        const world = seededWorld();
        const store = opened(world);
        store.intents.toggleSelected('stavropoleos');

        const all = store.intents.exportPlaces(false);
        const selection = store.intents.exportPlaces(true);

        expect(all).toMatchObject({ name: 'bucharest-places-2025-10-09.geojson', type: 'application/geo+json' });
        expect((JSON.parse(all.text) as { features: unknown[] }).features).toHaveLength(2);
        expect((JSON.parse(selection.text) as { features: { id: string }[] }).features.map((feature) => feature.id)).toEqual([
            'stavropoleos',
        ]);
    });

    it('happyPath_anImportIsPreviewedOnTheMapAndWritten', async () => {
        const world = seededWorld();
        const store = opened(world);
        store.intents.attachMap(CONTAINER);
        await settle();
        const text = JSON.stringify({
            type: 'FeatureCollection',
            features: [{ type: 'Feature', geometry: POINT, properties: { title: 'Nou' } }],
        });

        await store.intents.chooseImport({ name: 'a.geojson', size: text.length, text: () => Promise.resolve(text) });
        expect(store.state.importing?.plan?.refused).toHaveLength(1);
        store.intents.setImportCategory('biserici');
        const preview = world.maps.map.callsOf('addVectorOverlay').map((args) => args[0] as { id: string; clickable?: boolean });
        expect(preview.at(-1)).toMatchObject({ id: 'hcm-import', clickable: false });
        await store.intents.commitImport();
        expect(store.state.importing?.status).toBe('done');
        store.intents.closeImport();

        expect(store.state.importing).toBeNull();
        expect(store.state.list.items).toHaveLength(3);
    });

    it('happyPath_thePhotoPickerReadsThePhotosOnce', () => {
        const world = seededWorld();
        world.store.put(FIRESTORE_PATHS.photo(CITY, 'p1'), {
            title: { ro: 'Lipscani' },
            year: 1930,
            published: true,
            processing: 'done',
            license: 'CC-BY-4.0',
            location: { lat: 44.43, lng: 26.1 },
            image: { web: 'https://example.org/w.webp', thumb: 'https://example.org/t.webp', sha256: 'a'.repeat(64), w: 10, h: 10 },
            ...world.store.stamp(),
        });
        const store = opened(world);

        store.intents.loadPhotos();
        store.intents.loadPhotos();

        expect(store.state.photos?.items).toEqual([
            { id: 'p1', title: { ro: 'Lipscani' }, year: 1930, thumb: 'https://example.org/t.webp' },
        ]);
        expect(world.store.listeners(FIRESTORE_PATHS.photos(CITY))).toBe(1);
    });
});

describe('places: closing', () => {
    it('happyPath_closeStopsEveryListenerAndDestroyForgetsNewPlaces', async () => {
        const world = seededWorld();
        const store = opened(world);
        store.intents.add('point');
        store.intents.attachMap(CONTAINER);
        await settle();

        store.close();
        store.destroy();

        expect(world.store.listeners()).toBe(0);
        expect(world.maps.destroyed).toBe(1);
        seedPlace(world, 'nou');
        expect(store.state.list.items).toHaveLength(2);
    });
});
