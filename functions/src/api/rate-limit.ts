import { createHash } from 'node:crypto';

import { ERROR_REPORT_LIMITS } from '@hcm/shared';

/** The window the crash endpoint's limits count in. */
const MINUTE_MS = 60_000;

/** How many requests one client, and the whole instance, may make in one window of `windowMs`. */
export interface RateLimits {
    readonly perClient: number;
    readonly perInstance: number;
    readonly windowMs: number;
}

/** `ERROR_REPORT_LIMITS`, per minute. */
const CRASH_LIMITS: RateLimits = {
    perClient: ERROR_REPORT_LIMITS.perClientPerMinute,
    perInstance: ERROR_REPORT_LIMITS.perInstancePerMinute,
    windowMs: MINUTE_MS,
};

/** Admits a report or refuses it (429), per client and per function instance, in fixed windows (a minute by default). */
export interface RateLimiter {
    allow(client: string, now: Date): boolean;
}

/**
 * The in-memory limiter of `telemetry.reportError` (`ERROR_REPORT_LIMITS`; `docs/research/M2-interfaces.md` §3.4): the
 * endpoint is public, so nothing per report reaches Firestore. A client is the salted SHA-256 of its address, kept in
 * this instance's memory for the current minute only; the salt is random per instance. The limits are per instance:
 * with `maxInstances: 2` and Cloud Run's concurrency, at most twice `perInstancePerMinute` reports a minute reach
 * Cloud Logging project-wide, and one client at most twice its own limit when its requests land on both instances.
 * Refused requests do not count, so the per-client map never holds more entries than the instance limit. `reports.submit`
 * (`../reports/submit.ts`) uses the same limiter with its own limits, per hour.
 */
export function createRateLimiter(salt: string, limits: RateLimits = CRASH_LIMITS): RateLimiter {
    let window = Number.NaN;
    let total = 0;
    const perClient = new Map<string, number>();
    return {
        allow: (client, now) => {
            const current = Math.floor(now.getTime() / limits.windowMs);
            if (current !== window) {
                window = current;
                total = 0;
                perClient.clear();
            }
            const key = createHash('sha256').update(salt).update(client).digest('hex');
            const count = perClient.get(key) ?? 0;
            if (total >= limits.perInstance || count >= limits.perClient) {
                return false;
            }
            perClient.set(key, count + 1);
            total += 1;
            return true;
        },
    };
}
