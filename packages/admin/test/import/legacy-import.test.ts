import { createLogger, type ApiErrorCode } from '@hcm/shared';
import { createRecordingSink } from '@hcm/test-support';
import { createFakeFetch, jsonResponse, route, routeTable, type FakeFetch } from '@hcm/test-support/fakes';
import { describe, expect, it } from 'vitest';

import {
    createLegacyImport,
    type LegacyImportDeps,
    type LegacyImportProgress,
    type LegacyPhotoStore,
} from '../../src/import/legacy-import.js';
import { createMemoryStore, type MemoryStore, type MemoryStoreOptions } from './store.js';

/**
 * The legacy Bucharest import (docs/research/M2b-interfaces.md §3.3 h): every record created, uploaded through the normal
 * path and published once processed (S-A28-HAPPY); a rerun writes nothing (S-A28-BAD-RERUN-IDEMPOTENT); a closed tab
 * resumes (S-A28-BAD-RESUME); a refused file is listed with its reason (S-A28-BAD-PROCESSING-FAILED).
 */

const BASE = 'https://demo-hcm.web.app/';
const UID = 'e2eOwnerUid0001';

function photo(id: string, extra: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, unknown>> {
    return {
        id,
        title: { ro: `Fotografia ${id}` },
        license: 'permission-legacy',
        links: [{ url: 'https://example.org/a', label: 'Sursa' }],
        location: { lat: 44.43, lng: 26.1 },
        year: 1936,
        ...extra,
    };
}

const RECORDS = [
    { sourceFile: 'Arionoaia 1980.jpg', legacyId: 'legacy-1', photo: photo('arionoaia-1980') },
    { sourceFile: 'Ferdinand.png', legacyId: 'legacy-2', photo: photo('ferdinand') },
    { sourceFile: 'Bateriilor.jpg', photo: photo('bateriilor') },
] as const;

interface ImportWorld {
    readonly store: MemoryStore;
    readonly fetch: FakeFetch;
    readonly sink: ReturnType<typeof createRecordingSink>;
    deps(overrides?: Partial<LegacyImportDeps>): LegacyImportDeps;
}

function importWorld(records: readonly unknown[] = RECORDS, options: MemoryStoreOptions = {}): ImportWorld {
    const store = createMemoryStore(options);
    const sink = createRecordingSink();
    const fetch = createFakeFetch(
        routeTable([
            route('GET', 'https://demo-hcm.web.app/legacy/bucharest/photos.json', 'bundle.photos', () => jsonResponse(records)),
            route('GET', 'https://demo-hcm.web.app/legacy/bucharest/originals/{file}', 'bundle.original', (_request, params) =>
                params['file'] === 'Missing.jpg' ? new Response('', { status: 404 }) : new Response(new Uint8Array([1, 2, 3])),
            ),
        ]),
    );
    let nonce = 0;
    return {
        store,
        fetch,
        sink,
        deps: (overrides = {}) => ({
            fetch: fetch.fetch,
            store,
            cityId: 'bucharest',
            baseUrl: BASE,
            uid: () => UID,
            nonce: () => {
                nonce += 1;
                return `nonce-${String(nonce).padStart(4, '0')}`;
            },
            sleep: () => new Promise(() => undefined),
            log: createLogger('import', { sink: sink.sink }),
            ...overrides,
        }),
    };
}

describe('run', () => {
    it('happyPath_everyPhotoIsCreatedUploadedThroughTheNormalPathAndPublished', async () => {
        const world = importWorld();
        const progress: LegacyImportProgress[] = [];

        const result = await createLegacyImport(world.deps()).run((step) => progress.push(step));

        expect(result).toEqual({ done: 3, total: 3, failed: [] });
        expect(progress[0]).toEqual({ done: 0, total: 3, failed: [] });
        expect(progress.map((step) => step.done)).toEqual([0, 1, 2, 3]);
        expect(world.store.created.toSorted((left, right) => left.localeCompare(right))).toEqual([
            'arionoaia-1980',
            'bateriilor',
            'ferdinand',
        ]);
        expect(world.store.uploads.find((upload) => upload.originalName === 'Ferdinand.png')).toEqual({
            path: expect.stringMatching(new RegExp(`^uploads/photos/bucharest/${UID}/ferdinand/nonce-\\d{4}\\.png$`)) as unknown,
            contentType: 'image/png',
            originalName: 'Ferdinand.png',
            bytes: 3,
        });
        expect(world.store.published.toSorted((left, right) => left.localeCompare(right))).toEqual([
            'arionoaia-1980',
            'bateriilor',
            'ferdinand',
        ]);
        expect(world.fetch.calls.map((call) => call.url)).toContain(
            'https://demo-hcm.web.app/legacy/bucharest/originals/Arionoaia%201980.jpg',
        );
        expect(world.store.watchers()).toBe(0);
    });

    it('badPath_aRerunWritesNothing', async () => {
        const world = importWorld();
        await createLegacyImport(world.deps()).run(() => undefined);

        const again = await createLegacyImport(world.deps()).run(() => undefined);

        expect(again).toEqual({ done: 3, total: 3, failed: [] });
        expect(world.store.created).toHaveLength(3);
        expect(world.store.uploads).toHaveLength(3);
        expect(world.store.published).toHaveLength(3);
    });

    it('badPath_aClosedTabResumesUnprocessedAndUnpublishedPhotos', async () => {
        const world = importWorld();
        world.store.docs.set('arionoaia-1980', { processing: 'pending', hasImage: false, published: false, legacyId: 'legacy-1' });
        world.store.docs.set('ferdinand', { processing: 'done', hasImage: true, published: false, legacyId: 'legacy-2' });

        const result = await createLegacyImport(world.deps()).run(() => undefined);

        expect(result.done).toBe(3);
        expect(world.store.created).toEqual(['bateriilor']);
        expect(world.store.uploads.map((upload) => upload.originalName).toSorted((left, right) => left.localeCompare(right))).toEqual([
            'Arionoaia 1980.jpg',
            'Bateriilor.jpg',
        ]);
        expect(world.store.published.toSorted((left, right) => left.localeCompare(right))).toEqual([
            'arionoaia-1980',
            'bateriilor',
            'ferdinand',
        ]);
    });

    it('badPath_aPhotoImportedUnderAnotherIdIsNotImportedTwice', async () => {
        const world = importWorld();
        world.store.docs.set('older-id', { processing: 'done', hasImage: true, published: true, legacyId: 'legacy-1' });

        const result = await createLegacyImport(world.deps()).run(() => undefined);

        expect(result.done).toBe(3);
        expect(world.store.created.toSorted((left, right) => left.localeCompare(right))).toEqual(['bateriilor', 'ferdinand']);
    });

    it('badPath_twoRecordsSharingALegacyIdAreBothImported', async () => {
        // The old site gave Bateriilor and Ferdinand the same id: neither may count as the other already imported.
        const shared = [
            { sourceFile: 'Bateriilor.jpg', legacyId: 'legacy-shared', photo: photo('bateriilor') },
            { sourceFile: 'Ferdinand.png', legacyId: 'legacy-shared', photo: photo('ferdinand') },
            { sourceFile: 'Arionoaia 1980.jpg', legacyId: 'legacy-1', photo: photo('arionoaia-1980') },
        ];
        const world = importWorld(shared);

        const result = await createLegacyImport(world.deps({ concurrency: 1 })).run(() => undefined);
        const detected = await createLegacyImport(world.deps()).detect();

        expect(result.done).toBe(3);
        expect(world.store.created.toSorted((left, right) => left.localeCompare(right))).toEqual([
            'arionoaia-1980',
            'bateriilor',
            'ferdinand',
        ]);
        expect(detected).toEqual({ done: 3, total: 3, failed: [] });
    });

    it('badPath_aRefusedFileIsListedWithItsReasonAndTheOthersGoOn', async () => {
        const reasons: Readonly<Record<string, ApiErrorCode>> = { ferdinand: 'apiError.photo.tooLarge' };
        const world = importWorld(RECORDS, { outcome: (id) => reasons[id] ?? 'done', processing: 'later' });

        const result = await createLegacyImport(world.deps()).run(() => undefined);

        expect(result).toEqual({ done: 2, total: 3, failed: [{ id: 'ferdinand', detail: 'apiError.photo.tooLarge' }] });
        expect(world.store.published).not.toContain('ferdinand');
        expect(world.store.watchers()).toBe(0);
    });
});

describe('run when something fails', () => {
    it('badPath_aFailureWithoutAReasonADeletedPhotoAndAProcessingThatNeverEnds', async () => {
        const outcomes = { 'arionoaia-1980': 'apiError.photo.unreadable', ferdinand: 'deleted', bateriilor: 'never' } as const;
        const world = importWorld(RECORDS, { outcome: (id) => outcomes[id as keyof typeof outcomes] });
        world.store.docs.set('arionoaia-1980', { processing: 'failed', hasImage: false, published: false });
        const read = world.store.read.bind(world.store);
        const store: LegacyPhotoStore = {
            ...world.store,
            read: async (city, id) => {
                const state = await read(city, id);
                return state === null ? null : { processing: state.processing, hasImage: state.hasImage, published: state.published };
            },
        };

        const result = await createLegacyImport(world.deps({ store, sleep: () => Promise.resolve(), processingTimeoutMs: 1 })).run(
            () => undefined,
        );

        expect(result.failed).toEqual([
            { id: 'arionoaia-1980', detail: 'apiError.photo.unreadable' },
            { id: 'ferdinand', detail: 'apiError.notFound' },
            { id: 'bateriilor', detail: 'apiError.unavailable' },
        ]);
    });

    it('badPath_aMissingOriginalAnUnsupportedTypeAMalformedRecordAndABrokenStore', async () => {
        const records = [
            { sourceFile: 'Missing.jpg', photo: photo('missing') },
            { sourceFile: 'scan.gif', photo: photo('scan') },
            { sourceFile: 'x.jpg', photo: { id: 'Not An Id' } },
            { sourceFile: 'Arionoaia 1980.jpg', photo: photo('arionoaia-1980') },
        ];
        const world = importWorld(records);
        const fresh = importWorld(records);
        const store: LegacyPhotoStore = { ...fresh.store, create: () => Promise.reject(new TypeError('quota')) };
        const recorded = await createLegacyImport(world.deps()).run(() => undefined);

        const broken = await createLegacyImport(fresh.deps({ store })).run(() => undefined);

        expect(recorded.failed.toSorted((left, right) => left.id.localeCompare(right.id))).toEqual([
            { id: '#2', detail: 'apiError.invalidRequest' },
            { id: 'missing', detail: 'apiError.notFound' },
            { id: 'scan', detail: 'apiError.photo.unsupportedType' },
        ]);
        expect(broken.failed).toContainEqual({ id: 'arionoaia-1980', detail: 'apiError.unavailable' });
        expect(fresh.sink.records.at(-1)).toMatchObject({
            level: 'warn',
            data: { photo: expect.any(String) as unknown, error: 'TypeError' },
        });
    });

    it('badPath_anOriginalTheServerCannotServeIsUnavailable', async () => {
        const world = importWorld();
        const fetch = createFakeFetch(
            routeTable([
                route('GET', 'https://demo-hcm.web.app/legacy/bucharest/photos.json', 'bundle.photos', () => jsonResponse(RECORDS)),
                route(
                    'GET',
                    'https://demo-hcm.web.app/legacy/bucharest/originals/{file}',
                    'bundle.original',
                    () => new Response('', { status: 503 }),
                ),
            ]),
        );

        const result = await createLegacyImport(world.deps({ fetch: fetch.fetch })).run(() => undefined);

        expect(result.failed.map((failure) => failure.detail)).toEqual([
            'apiError.unavailable',
            'apiError.unavailable',
            'apiError.unavailable',
        ]);
    });

    it('badPath_signedOutOrWithoutTheBundleTheImportDoesNotStart', async () => {
        const world = importWorld();
        const empty = importWorld({ not: 'a list' } as unknown as readonly unknown[]);
        const gone: typeof globalThis.fetch = () => Promise.resolve(new Response('', { status: 404 }));

        await expect(createLegacyImport(world.deps({ uid: () => null })).run(() => undefined)).rejects.toThrow('signed-in admin');
        await expect(createLegacyImport(empty.deps()).detect()).rejects.toThrow('legacy bundle of bucharest is unavailable');
        await expect(createLegacyImport(world.deps({ fetch: gone })).detect()).rejects.toThrow('unavailable');
        expect(world.store.created).toEqual([]);
    });
});

describe('detect', () => {
    it('happyPath_whatIsImportedIsCountedWithoutWriting', async () => {
        const world = importWorld();
        world.store.docs.set('arionoaia-1980', { processing: 'done', hasImage: true, published: true });
        world.store.docs.set('ferdinand', {
            processing: 'failed',
            hasImage: false,
            published: false,
            processingError: 'apiError.photo.duplicate',
        });

        const found = await createLegacyImport(world.deps()).detect();

        expect(found).toEqual({ done: 1, total: 3, failed: [{ id: 'ferdinand', detail: 'apiError.photo.duplicate' }] });
        expect(world.store.created).toEqual([]);
        expect(world.store.uploads).toEqual([]);
    });

    it('badPath_aFailedPhotoWithoutAReasonIsUnreadableAndSomethingThrownIsUnknown', async () => {
        const world = importWorld();
        world.store.docs.set('ferdinand', { processing: 'failed', hasImage: false, published: false });
        const store: LegacyPhotoStore = { ...world.store, findByLegacyId: () => Promise.reject(Object.create(null) as Error) };

        const found = await createLegacyImport(world.deps()).detect();
        const broken = await createLegacyImport(world.deps({ store })).detect();

        expect(found.failed).toEqual([{ id: 'ferdinand', detail: 'apiError.photo.unreadable' }]);
        expect(broken.failed).toHaveLength(2);
        expect(world.sink.records.at(-1)?.data).toMatchObject({ error: 'unknown' });
    });

    it('badPath_aPhotoUnderAnotherIdCountsAndAnUnpublishedOneIsOpen', async () => {
        const world = importWorld();
        world.store.docs.set('older-id', { processing: 'done', hasImage: true, published: true, legacyId: 'legacy-2' });
        world.store.docs.set('arionoaia-1980', { processing: 'done', hasImage: true, published: false });

        await expect(createLegacyImport(world.deps({ concurrency: 1 })).detect()).resolves.toEqual({ done: 1, total: 3, failed: [] });
    });
});
