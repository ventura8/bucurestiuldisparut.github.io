/**
 * The USGS search as the Imagery area runs it (`docs/research/M3-interfaces.md` §3.1, §3.5): the first time the area
 * opens for a city whose newest harvest is older than `HARVEST_EVERY_DAYS` (or missing), and USGS can search (`ok`, or
 * `pending` while USGS has not approved downloads yet), `imagery.search` runs once by itself; the admin can search again
 * any time. Its answer says how many scenes it found and which datasets did not answer; the scenes themselves arrive
 * through the area's live list.
 */
import { HARVEST_EVERY_DAYS, type ServiceState, type UsgsDataset } from '@hcm/shared';

import type { ContentServices } from '../content/services.js';
import type { NoticeInput } from '../state/state.js';
import { callImagery, refusalOf } from './api.js';
import { harvestIsStale } from './model.js';

type SearchPhase = 'idle' | 'searching' | 'done' | 'failed';

export interface SearchState {
    readonly phase: SearchPhase;
    readonly found: number | null;
    readonly added: number | null;
    /** Datasets M2M did not answer for (the others were harvested). */
    readonly failedDatasets: readonly UsgsDataset[];
    readonly error: NoticeInput | null;
}

export const IDLE_SEARCH: SearchState = { phase: 'idle', found: null, added: null, failedDatasets: [], error: null };

/**
 * The search's timeout: just over the server's 300 s (`CALLABLE_TIMEOUT_SECONDS` of `functions/src/api/callable.ts`,
 * CR-M3-22), past the SDK's 70 s default, so a first harvest is not cut short in the browser.
 */
export const IMAGERY_SEARCH_TIMEOUT_MS = 310_000;
const SEARCH_OPTIONS = { timeoutMs: IMAGERY_SEARCH_TIMEOUT_MS } as const;

/** USGS states in which a search may run (downloads need `ok`). */
const CAN_SEARCH: readonly ServiceState[] = ['ok', 'pending'];

export function usgsCanSearch(usgs: ServiceState | null): boolean {
    return usgs !== null && CAN_SEARCH.includes(usgs);
}

export class HarvestSearch {
    readonly #services: ContentServices;
    readonly #changed: (state: SearchState) => void;
    #state: SearchState = IDLE_SEARCH;
    /** The automatic search ran (or was not needed): it runs at most once a session (the store lives until sign-out). */
    #decided = false;

    constructor(services: ContentServices, changed: (state: SearchState) => void) {
        this.#services = services;
        this.#changed = changed;
    }

    get state(): SearchState {
        return this.#state;
    }

    /**
     * What the area knows: USGS's state (null while reading) and the newest harvest (undefined while reading, null for
     * none). Once both are read, a stale harvest starts the one automatic search.
     */
    known(usgs: ServiceState | null, newest: string | null | undefined): void {
        if (this.#decided || usgs === null || newest === undefined) {
            return;
        }
        this.#decided = true;
        if (this.#wanted(usgs, newest)) {
            void this.search();
        }
    }

    /** USGS can search and the newest harvest is stale. */
    #wanted(usgs: ServiceState, newest: string | null): boolean {
        return usgsCanSearch(usgs) && harvestIsStale(newest, this.#services.clock.now(), HARVEST_EVERY_DAYS);
    }

    async search(): Promise<void> {
        if (this.#state.phase === 'searching') {
            return;
        }
        this.#set({ ...IDLE_SEARCH, phase: 'searching' });
        try {
            const answer = await callImagery(this.#services.callables, 'imagery.search', { cityId: this.#services.cityId }, SEARCH_OPTIONS);
            this.#set({ phase: 'done', found: answer.found, added: answer.added, failedDatasets: answer.failedDatasets, error: null });
        } catch (error) {
            this.#set({ ...IDLE_SEARCH, phase: 'failed', error: refusalOf(error) });
        }
    }

    #set(state: SearchState): void {
        this.#state = state;
        this.#changed(state);
    }
}
