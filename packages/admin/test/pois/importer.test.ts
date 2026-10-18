import { FIRESTORE_PATHS, MAX_GEOMETRY_VERTICES, MAX_POLYGON_RINGS } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { Importer, type ImportFile, type ImportState } from '../../src/pois/importer.js';
import type { PoiValue } from '../../src/pois/model.js';
import { CITY, POINT, poisWorld, type PoisWorld } from './world.js';

const LIMITS = {
    limits: [
        [25.5, 43.8],
        [26.8, 45.05],
    ],
    maxVertices: MAX_GEOMETRY_VERTICES,
    maxRings: MAX_POLYGON_RINGS,
} as const;

function file(content: string | Error, size = 100, name = 'locuri.geojson'): ImportFile {
    return { name, size, text: () => (content instanceof Error ? Promise.reject(content) : Promise.resolve(content)) };
}

function collection(count: number, extra: Record<string, unknown> = {}): string {
    const features = Array.from({ length: count }, (_unused, index) => ({
        type: 'Feature',
        geometry: POINT,
        properties: { category: 'biserici', title: `Loc ${String(index)}`, ...extra },
    }));
    return JSON.stringify({ type: 'FeatureCollection', features });
}

function importer(
    world: PoisWorld,
    existing = new Map<string, PoiValue>(),
): { readonly importer: Importer; readonly states: (ImportState | null)[] } {
    const states: (ImportState | null)[] = [];
    const subject = new Importer({
        store: world.store,
        cityId: CITY,
        context: () => ({ limits: LIMITS, categories: new Set(['biserici', 'parcuri']), existing }),
        changed: (state) => states.push(state),
    });
    return { importer: subject, states };
}

describe('the import dialog', () => {
    it('happyPath_aFileIsPreviewedThenWrittenInBatches', async () => {
        const world = poisWorld();
        const { importer: subject, states } = importer(world);

        await subject.choose(file(collection(501)), null);
        expect(subject.state).toMatchObject({ status: 'preview', fileName: 'locuri.geojson', refusal: null, written: 0 });
        expect(subject.state?.plan?.created).toHaveLength(501);
        expect(world.store.writes).toEqual([]);
        await subject.commit();

        expect(world.store.writes.map((write) => (write.kind === 'batch' ? write.writes.length : 0))).toEqual([500, 1]);
        expect(subject.state).toMatchObject({ status: 'done', written: 501 });
        expect(states.map((state) => state?.status)).toEqual(['reading', 'preview', 'writing', 'writing', 'writing', 'done']);
        expect(world.store.docs.get(FIRESTORE_PATHS.poi(CITY, 'new-1'))).toMatchObject({ title: { ro: 'Loc 0' }, createdBy: 'admin-uid' });
    });

    it('happyPath_updatesAreWrittenToTheirPlace', async () => {
        const world = poisWorld();
        const existing = new Map<string, PoiValue>([
            ['stavropoleos', { category: 'biserici', geometry: POINT, title: { ro: 'Vechi' }, links: [], photoIds: [], published: true }],
        ]);
        const { importer: subject } = importer(world, existing);
        const text = JSON.stringify({
            type: 'Feature',
            id: 'stavropoleos',
            geometry: POINT,
            properties: { category: 'biserici', title: 'Nou' },
        });

        await subject.choose(file(text), null);
        await subject.commit();

        const write = world.store.writes[0];
        expect(write?.kind === 'batch' ? write.writes[0] : null).toMatchObject({
            kind: 'update',
            path: FIRESTORE_PATHS.poi(CITY, 'stavropoleos'),
        });
    });

    it('happyPath_theCategoryForUncategorisedFeaturesPlansAgain', async () => {
        const world = poisWorld();
        const { importer: subject } = importer(world);
        await subject.choose(file(collection(2, { category: 'nimic' })), null);
        expect(subject.state?.plan?.refused).toHaveLength(2);

        subject.setCategory('parcuri');

        expect(subject.state).toMatchObject({ fallbackCategory: 'parcuri' });
        expect(subject.state?.plan?.created.map((place) => place.value.category)).toEqual(['parcuri', 'parcuri']);
        expect(subject.state?.plan?.uncategorised).toBe(2);
    });

    it('badPath_aFileTooBigNotGeoJsonOrUnreadableIsRefusedBeforeAnyWrite', async () => {
        const world = poisWorld();
        const { importer: subject } = importer(world);

        await subject.choose(file('{}', 6 * 1024 * 1024), null);
        expect(subject.state).toMatchObject({ status: 'refused', refusal: 'too-big' });
        await subject.choose(file('<kml/>'), null);
        expect(subject.state).toMatchObject({ status: 'refused', refusal: 'not-geojson' });
        await subject.choose(file(new Error('read failed')), null);
        expect(subject.state).toMatchObject({ status: 'refused', refusal: 'unreadable' });
        subject.setCategory('parcuri');
        await subject.commit();

        expect(subject.state?.fallbackCategory).toBeNull();
        expect(world.store.writes).toEqual([]);
    });

    it('badPath_anImportThatWouldPassTheCityLimitWritesNothing', async () => {
        const world = poisWorld();
        world.store.counts.set(FIRESTORE_PATHS.pois(CITY), 4999);
        const { importer: subject } = importer(world);
        await subject.choose(file(collection(2)), null);

        await subject.commit();
        world.store.counts.set(FIRESTORE_PATHS.pois(CITY), null);
        await subject.choose(file(collection(1)), null);
        await subject.commit();

        expect(subject.state).toMatchObject({ status: 'refused', refusal: 'too-many' });
        expect(world.store.writes).toEqual([]);
    });

    it('badPath_aRefusedBatchStopsTheImport', async () => {
        const world = poisWorld();
        const { importer: subject } = importer(world);
        await subject.choose(file(collection(3)), null);
        world.store.outcomes.push({ ok: false, reason: 'denied' });

        await subject.commit();

        expect(subject.state).toMatchObject({ status: 'failed', written: 0 });
    });

    it('badPath_closingWhileWritingForgetsTheImport', async () => {
        const world = poisWorld();
        const { importer: subject } = importer(world);
        await subject.choose(file(collection(1)), null);

        const committing = subject.commit();
        subject.close();
        await committing;

        expect(subject.state).toBeNull();
    });

    it('happyPath_closingForgetsTheFile', async () => {
        const world = poisWorld();
        const { importer: subject, states } = importer(world);
        await subject.choose(file(collection(1)), 'biserici');

        subject.close();

        expect(subject.state).toBeNull();
        expect(states.at(-1)).toBeNull();
    });
});
