import { FIRESTORE_PATHS } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { RECONNECT_DELAYS_MS } from '../../src/content/live.js';
import { healthChipsOf, HOME_MODULE, publicMapOf } from '../../src/home/home.js';
import { at, CITY, contentWorld } from '../content/world.js';

const STAMP = { updatedBy: 'system:ops', updatedAt: at('2026-10-17T10:00:00Z') };

function seeded() {
    const world = contentWorld();
    const docs: [string, Record<string, unknown>][] = [
        [`${FIRESTORE_PATHS.photos(CITY)}/p1`, { rightsReview: true, published: false }],
        [`${FIRESTORE_PATHS.photos(CITY)}/p2`, { rightsReview: false, published: true }],
        [`${FIRESTORE_PATHS.pois(CITY)}/x`, { published: true }],
        [`${FIRESTORE_PATHS.jobs(CITY)}/j1`, { status: 'running' }],
        [`${FIRESTORE_PATHS.jobs(CITY)}/j2`, { status: 'failed' }],
        [
            FIRESTORE_PATHS.setupStatus,
            {
                billing: { state: 'ok' },
                mapbox: { state: 'invalid', detail: 'apiError.mapbox.tokenInvalid' },
                usgs: { state: 'pending', detail: 'apiError.cloud.permission', params: { role: 'x' } },
                ...STAMP,
            },
        ],
        [
            FIRESTORE_PATHS.manifestState(CITY),
            {
                requestedVersion: 3,
                builtVersion: 3,
                status: 'idle',
                builtAt: at('2026-10-17T09:00:00Z'),
                skipped: [{ entity: 'photo', id: 'p9', code: 'validation.required', path: 'title' }],
                ...STAMP,
            },
        ],
    ];
    for (const [path, data] of docs) {
        world.store.docs.set(path, data);
    }
    return world;
}

async function settled(): Promise<void> {
    for (let round = 0; round < 10; round += 1) {
        await Promise.resolve();
    }
}

describe('the dashboard', () => {
    it('happyPath_countsTheCityAndWhatWaitsAndFollowsTheServicesAndThePublicMap', async () => {
        const { services } = seeded();
        const home = HOME_MODULE.create(services);

        home.open([]);
        await settled();

        expect(home.state.counts).toEqual({
            photos: 2,
            pois: 1,
            categories: 0,
            layers: 0,
            rightsReviews: 1,
            unpublishedPhotos: 1,
            activeJobs: 1,
            failedJobs: 1,
        });
        expect(home.state.health.chips.map((chip) => [chip.area, chip.state])).toEqual([
            ['billing', 'ok'],
            ['provision', 'missing'],
            ['mapbox', 'invalid'],
            ['usgs', 'pending'],
            ['analytics', 'missing'],
            ['crash', 'missing'],
        ]);
        expect(home.state.health.chips[3]?.detail).toEqual({ key: 'apiError.cloud.permission', params: { role: 'x' } });
        expect(home.state.publicMap.doc?.data).toEqual({
            status: 'idle',
            builtAt: '2026-10-17T09:00:00.000Z',
            skipped: [{ entity: 'photo', id: 'p9', code: 'validation.required', path: 'title' }],
            error: null,
        });
        expect([HOME_MODULE.area, home.hasUnsavedChanges()]).toEqual(['home', false]);
    });

    it('happyPath_liveChangesAndRefreshCountsAgain', async () => {
        const { services, store } = seeded();
        const home = HOME_MODULE.create(services);
        home.open([]);
        home.open([]);
        await settled();

        store.put(FIRESTORE_PATHS.manifestState(CITY), {
            requestedVersion: 4,
            builtVersion: 3,
            status: 'failed',
            error: 'apiError.internal',
            ...STAMP,
        });
        store.docs.set(`${FIRESTORE_PATHS.photos(CITY)}/p3`, { rightsReview: true });
        await home.intents.refresh();

        expect(home.state.publicMap.doc?.data).toEqual({
            status: 'failed',
            builtAt: null,
            skipped: [],
            error: { key: 'apiError.internal' },
        });
        expect(home.state.counts?.photos).toBe(3);
    });

    it('badPath_failedCountsAreDashesAndAllFailedIsAnError', async () => {
        const { services, store } = seeded();
        store.counts.set(FIRESTORE_PATHS.layers(CITY), null);
        const home = HOME_MODULE.create(services);
        home.open([]);
        await settled();
        expect(home.state.counts?.layers).toBeNull();
        expect(home.state.countsStatus).toBe('ready');

        for (const path of [
            FIRESTORE_PATHS.photos(CITY),
            FIRESTORE_PATHS.pois(CITY),
            FIRESTORE_PATHS.poiCategories(CITY),
            FIRESTORE_PATHS.jobs(CITY),
        ]) {
            store.counts.set(path, null);
        }
        await home.intents.refresh();

        expect(home.state.countsStatus).toBe('error');
    });

    it('badPath_nothingCheckedYetAndListenersThatDropOrAreRefused', async () => {
        const { services, store, clock, denials } = contentWorld();
        const home = HOME_MODULE.create(services);
        home.open([]);
        await settled();
        expect(home.state.health.chips.every((chip) => chip.state === 'missing' && chip.detail === null)).toBe(true);
        expect(home.state.publicMap).toMatchObject({ status: 'ready', doc: null });

        store.fail(FIRESTORE_PATHS.setupStatus, { kind: 'unavailable', code: 'unavailable' });
        expect(home.state.health.reconnecting).toBe(true);
        clock.advance(RECONNECT_DELAYS_MS[0] ?? 0);
        store.fail(FIRESTORE_PATHS.setupStatus, { kind: 'denied', code: 'permission-denied' });
        store.fail(FIRESTORE_PATHS.manifestState(CITY), { kind: 'failed', code: 'internal' });
        expect([home.state.health.status, home.state.publicMap.status, denials.count]).toEqual(['error', 'error', 1]);
        home.intents.retry();
        await settled();

        expect([home.state.health.status, home.state.publicMap.status]).toEqual(['ready', 'ready']);
        home.destroy();
        expect(store.listeners()).toBe(0);
        let heard = 0;
        home.subscribe(() => {
            heard += 1;
        })();
        expect(heard).toBe(0);
    });

    it('happyPath_theMappingsOnTheirOwn', () => {
        expect(healthChipsOf(null)).toHaveLength(6);
        expect(publicMapOf({ requestedVersion: 1, builtVersion: 0, status: 'queued', ...STAMP })).toEqual({
            status: 'queued',
            builtAt: null,
            skipped: [],
            error: null,
        });
    });
});
