/**
 * The admin's key journeys as GA4 events (`docs/ARCHITECTURE.md` → *Field measurements*, the owner's request of
 * 2026-11-12): an import started, a georeferencing saved, a layer approved or rejected, published, joined, a new city.
 * Each is one `admin_action` event when its callable answers: the action's name (`imagery_import`), the outcome (`ok`,
 * or the refusal's code, which names the cause: `apiError.imagery.notReady`) and how long it took. Ids, codes and
 * milliseconds only, never a request's data; sent like every measurement, only after the admin's consent.
 */
import type { AdminCallableName, CallableRequest, CallableResponse } from '@hcm/shared';

import type { CallablesPort, CallOptions } from '../firebase/ports.js';
import type { Measure } from './telemetry.js';

/** The callables that are a journey's step; the others (reads, Setup's checks) are not counted. */
export const MEASURED_ACTIONS: ReadonlySet<string> = new Set([
    'imagery.import',
    'imagery.archiveImport',
    'imagery.saveGcps',
    'imagery.approve',
    'imagery.reject',
    'imagery.publish',
    'imagery.join',
    'imagery.recalibrate',
    'imagery.retry',
    'setup.createCity',
]);

/** The refusal's code (`apiError.…`) of a failed call, else `error`. */
function outcomeOf(failure: unknown): string {
    const code: unknown =
        typeof failure === 'object' && failure !== null && 'details' in failure
            ? (failure.details as { readonly code?: unknown } | undefined)?.code
            : undefined;
    return typeof code === 'string' ? code.slice(0, 100) : 'error';
}

/** `callables` with each {@link MEASURED_ACTIONS} call measured as `admin_action`. */
export function measuredCallables(callables: CallablesPort, measure: Measure, now: () => number): CallablesPort {
    return {
        call: async <N extends AdminCallableName>(
            name: N,
            request: CallableRequest<N>,
            options?: CallOptions,
        ): Promise<CallableResponse<N>> => {
            if (!MEASURED_ACTIONS.has(name)) {
                return callables.call(name, request, options);
            }
            const start = now();
            const report = (outcome: string): void => {
                const params = { action: name.replace('.', '_'), outcome, duration_ms: Math.max(0, Math.round(now() - start)) };
                measure({ name: 'admin_action', params });
            };
            try {
                const answer = await callables.call(name, request, options);
                report('ok');
                return answer;
            } catch (failure) {
                report(outcomeOf(failure));
                throw failure;
            }
        },
    };
}
