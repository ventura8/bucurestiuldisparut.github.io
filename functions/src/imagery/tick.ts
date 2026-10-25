import '../global-options.js';

import { BACKGROUND_FUNCTIONS } from '@hcm/shared';
import { onSchedule } from 'firebase-functions/scheduler';

import { runAs } from '../global-options.js';
import type { Ports } from '../ports/index.js';
import { cityIds } from './limits.js';
import { guardIsRed } from './records.js';
import { watchOrders } from './orders/watch.js';
import { cancelAsked, dispatchDue, pendingApprovals, pollStale, recoverLost } from './tick-jobs.js';
import { monthlyHarvest, publishDeferred, runDeletions, sweepEnded } from './tick-maintenance.js';

/**
 * `imagery.tick` (every 5 minutes, one instance; `docs/research/M3-interfaces.md` §4.6): the raster work's clock. For
 * every city, each part on its own (a failure is logged and the next part runs): dispatch, lost executions, the
 * cancellations and approvals a lost event left, MTS polls gone missing, deferred publishes, due layer deletions, the
 * files of long-ended versions, the monthly harvest and (M4) the order watch. While the budget guard is red only the
 * parts that end or recover work run (lost executions, cancellations) and the order watch, which asks USGS and reminds
 * but imports nothing; nothing new starts, and the public site is never touched.
 */
export type TickDeps = Pick<
    Ports,
    'documents' | 'clock' | 'log' | 'jobs' | 'tasks' | 'secrets' | 'setup' | 'tilesets' | 'blobs' | 'usgs' | 'scenes' | 'remote'
>;

type Part = (deps: TickDeps, cityId: string, now: Date) => Promise<void>;

/** The parts in order, and whether each runs while the guard is red. */
const PARTS: readonly (readonly [name: string, part: Part, whileRed: boolean])[] = [
    ['dispatch', dispatchDue, false],
    ['lost', recoverLost, true],
    ['cancel', cancelAsked, true],
    ['approval', pendingApprovals, false],
    ['mapbox', pollStale, false],
    ['deferred', publishDeferred, false],
    ['deletions', runDeletions, false],
    ['sweep', sweepEnded, false],
    ['harvest', monthlyHarvest, false],
    // M4 (docs/research/M4-interfaces.md §1.5): the order watch asks USGS and reminds while the guard is red; its import waits.
    ['orders', watchOrders, true],
];

/** One tick over every city; returns the parts that failed (`<city>:<part>`). */
export async function runImageryTick(deps: TickDeps): Promise<string[]> {
    const now = deps.clock.now();
    const red = await guardIsRed(deps.documents);
    const failed: string[] = [];
    for (const cityId of await cityIds(deps.documents)) {
        for (const [name, part] of PARTS.filter(([, , whileRed]) => whileRed || !red)) {
            await part(deps, cityId, now).catch((error: unknown) => {
                deps.log.error('imagery tick part failed', { cityId, part: name, error: String(error) });
                failed.push(`${cityId}:${name}`);
            });
        }
    }
    deps.log.info('imagery tick finished', { guard: red ? 'red' : 'green', failed: failed.length });
    return failed;
}

/** The `imagery-tick` schedule (`IMAGERY_TICK_SCHEDULE`, UTC): one instance, so ticks never overlap; no retry (the next tick). */
export function tickFunction(getDeps: () => TickDeps) {
    const options = {
        schedule: BACKGROUND_FUNCTIONS['imagery.tick'].source,
        timeZone: 'UTC',
        retryCount: 0,
        maxInstances: 1,
        timeoutSeconds: 540,
        memory: '512MiB',
        ...runAs('imagery.tick'),
    } as const;
    return onSchedule(options, async () => {
        await runImageryTick(getDeps());
    });
}
