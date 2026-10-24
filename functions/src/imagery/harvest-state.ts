/**
 * A city's USGS harvest attempts (`ops/harvest-{city}`, CR-M3-47; `docs/research/M3-interfaces.md` §3.5): every attempt,
 * the admin's search and the tick's monthly one, records when it ran, how it went and when the next one is due: a month
 * after a harvest that answered (scenes or none), `HARVEST_RETRY_HOURS` after a failure, doubled after each further one
 * (at most a month). The tick harvests a city only once that time has come, so a harvest that writes no scene (USGS not
 * answering, revoked credentials, an area without frames) never repeats every five minutes.
 */
import {
    FIRESTORE_PATHS,
    HARVEST_EVERY_DAYS,
    HARVEST_RETRY_HOURS,
    harvestStateDocSchema,
    timestampFromDate,
    timestampToDate,
    type ApiErrorCode,
    type HarvestStateDoc,
} from '@hcm/shared';

import type { Ports } from '../ports/index.js';
import { IMAGERY_WRITER, stampOf } from './records.js';

type HarvestStateDeps = Pick<Ports, 'documents' | 'clock'>;

const HOUR_MS = 3_600_000;
const MONTH_MS = HARVEST_EVERY_DAYS * 24 * HOUR_MS;

/** How long after the `failures`-th failure in a row the harvest is tried again. */
function retryDelayMs(failures: number): number {
    return Math.min(MONTH_MS, HARVEST_RETRY_HOURS * HOUR_MS * 2 ** Math.max(0, failures - 1));
}

/** The city's last attempt, or undefined (never recorded: a harvest before CR-M3-47, or none). */
export function harvestStateOf(deps: Pick<Ports, 'documents'>, cityId: string): Promise<HarvestStateDoc | undefined> {
    return deps.documents.get(FIRESTORE_PATHS.harvestState(cityId), harvestStateDocSchema);
}

/** Failures in a row once this attempt is counted (0 after one that answered). */
async function failuresAfter(deps: HarvestStateDeps, cityId: string, outcome: HarvestStateDoc['outcome']): Promise<number> {
    return outcome === 'failed' ? ((await harvestStateOf(deps, cityId))?.failures ?? 0) + 1 : 0;
}

/** Records an attempt: `ok` (scenes found), `empty` (none) or `failed` (with the code the search failed with). */
export async function recordHarvest(
    deps: HarvestStateDeps,
    cityId: string,
    outcome: HarvestStateDoc['outcome'],
    error?: ApiErrorCode,
): Promise<void> {
    const now = deps.clock.now();
    const failures = await failuresAfter(deps, cityId, outcome);
    const delay = outcome === 'failed' ? retryDelayMs(failures) : MONTH_MS;
    await deps.documents.set(FIRESTORE_PATHS.harvestState(cityId), harvestStateDocSchema, {
        attemptedAt: timestampFromDate(now),
        outcome,
        failures,
        nextAt: timestampFromDate(new Date(now.getTime() + delay)),
        ...(error === undefined ? {} : { error }),
        ...stampOf(IMAGERY_WRITER, now),
    });
}

/** The recorded attempt says the next harvest is due (undefined: nothing recorded, the caller decides). */
export function dueByState(state: HarvestStateDoc | undefined, now: Date): boolean | undefined {
    return state === undefined ? undefined : timestampToDate(state.nextAt) <= now;
}
