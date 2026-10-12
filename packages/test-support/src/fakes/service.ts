import type { Route } from './routes.js';

/**
 * What every fake upstream service provides to `createUpstreamFakes` (upstream.ts): its routes, the answer each failure
 * mode gives every call while it is on, its named scenarios and a JSON snapshot of its state for assertions and the
 * HTTP server's `/__upstream/snapshot`.
 */

export const UPSTREAM_SERVICES = [
    'google-oauth',
    'resource-manager',
    'iam',
    'cloud-billing',
    'billing-budgets',
    'service-usage',
    'firebase-management',
    'secret-manager',
    'cloud-run',
    'cloud-tasks',
    'cloud-storage',
    'error-reporting',
    'mapbox',
    'usgs',
    'nominatim',
] as const;

export type UpstreamServiceName = (typeof UPSTREAM_SERVICES)[number];

/**
 * A failure every call of a service answers while it is on (`fakes.fail(service, mode)`):
 * `unavailable` (5xx), `rateLimited` (429), `unauthorized` (401: the credential expired or was revoked), `forbidden`
 * (403: a missing role or scope), `apiDisabled` (Google's 403 `SERVICE_DISABLED`), `maintenance` (USGS's HTML 503).
 */
export const FAILURE_MODES = ['unavailable', 'rateLimited', 'unauthorized', 'forbidden', 'apiDisabled', 'maintenance'] as const;

export type FailureMode = (typeof FAILURE_MODES)[number];

export interface ServiceFake {
    readonly name: UpstreamServiceName;
    readonly routes: readonly Route[];
    /** The answer to every call while `mode` is on; undefined when this service has no such failure. */
    failure(mode: FailureMode): Response | undefined;
    /** Named state changes (`m2mApproved`), applied by `fakes.scenario('<service>.<name>')`. */
    readonly scenarios: Readonly<Record<string, () => void>>;
    /** The state as plain JSON. */
    snapshot(): unknown;
}

/** A counter-based id: `prefix` + the number padded to `width` digits (`e2e-key-0001`). */
export function sequence(prefix: string, width = 4): () => string {
    let next = 0;
    return () => {
        next += 1;
        return `${prefix}${String(next).padStart(width, '0')}`;
    };
}
