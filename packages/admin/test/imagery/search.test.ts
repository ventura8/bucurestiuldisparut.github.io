import { describe, expect, it } from 'vitest';

import { HarvestSearch, IMAGERY_SEARCH_TIMEOUT_MS, usgsCanSearch, type SearchState } from '../../src/imagery/search.js';
import { failure, settle } from '../app/fakes.js';
import { answer, callsOf, imageryWorld } from './world.js';

const SEARCHED = { found: 7, added: 5, updated: 2, failedDatasets: ['declassiii' as const], searchedAt: '2026-10-20T09:00:00.000Z' };

function search() {
    const world = imageryWorld();
    world.clock.current = Date.parse('2026-10-20T09:00:00Z');
    const states: SearchState[] = [];
    const harvest = new HarvestSearch(world.services, (state) => states.push(state));
    return { ...world, harvest, states };
}

describe('the automatic search', () => {
    it('happyPath_aStaleHarvestSearchesOnceWhenUsgsCanSearch', async () => {
        const { harvest, callables, states } = search();
        answer(callables, 'imagery.search', () => SEARCHED);

        harvest.known(null, '2026-08-01T00:00:00Z');
        harvest.known('pending', undefined);
        harvest.known('pending', '2026-08-01T00:00:00Z');
        harvest.known('ok', null);
        await settle();

        expect(callsOf(callables, 'imagery.search')).toEqual([{ cityId: 'bucharest' }]);
        // A first harvest may take minutes: the call waits past the SDK's 70 s (CR-M3-22).
        expect(callables.calls.find((call) => call.name === 'imagery.search')?.timeoutMs).toBe(IMAGERY_SEARCH_TIMEOUT_MS);
        expect(states.map((state) => state.phase)).toEqual(['searching', 'done']);
        expect(harvest.state).toEqual({ phase: 'done', found: 7, added: 5, failedDatasets: ['declassiii'], error: null });
    });

    it('happyPath_aFreshHarvestOrUsgsNotSetUpSearchesNothing', async () => {
        const fresh = search();
        fresh.harvest.known('ok', '2026-10-19T00:00:00Z');
        const missing = search();
        missing.harvest.known('missing', null);
        await settle();

        expect([callsOf(fresh.callables, 'imagery.search'), callsOf(missing.callables, 'imagery.search')]).toEqual([[], []]);
        expect([usgsCanSearch(null), usgsCanSearch('invalid'), usgsCanSearch('ok')]).toEqual([false, false, true]);
    });
});

describe('the search', () => {
    it('badPath_aRefusedSearchSaysWhyAndASecondClickWaitsForTheFirst', async () => {
        const { harvest, callables } = search();
        let release: () => void = () => undefined;
        answer(
            callables,
            'imagery.search',
            () =>
                new Promise((_resolve, reject) => {
                    release = () => {
                        reject(failure('unavailable', 'apiError.usgs.maintenance'));
                    };
                }),
        );

        const first = harvest.search();
        await harvest.search();
        release();
        await first;

        expect(callsOf(callables, 'imagery.search')).toHaveLength(1);
        expect(harvest.state).toMatchObject({ phase: 'failed', error: { key: 'apiError.usgs.maintenance' } });
    });
});
