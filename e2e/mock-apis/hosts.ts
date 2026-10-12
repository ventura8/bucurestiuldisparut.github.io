import { E2E_TELEMETRY_HOST, E2E_TILE_HOST } from '../fixtures/world.js';

/**
 * Which hosts the e2e browser may reach, and how (docs/research/design-review-testability.md §4.2):
 *
 * - loopback (`127.0.0.1`, `localhost`): the site server and the mock APIs themselves;
 * - the mocked hosts below: every request is forwarded to the mock APIs, recorded, and answered there;
 * - anything else (Firestore, real Google, an unknown CDN): aborted by the firewall, and the test fails.
 */

const LOOPBACK_HOSTS: readonly string[] = ['127.0.0.1', 'localhost'];

export type HostKind = 'mapbox' | 'mapbox-events' | 'analytics' | 'cdn' | 'tiles' | 'telemetry';

/** Exact hosts, then suffixes (`.google-analytics.com` covers `region1.google-analytics.com`). */
const EXACT: ReadonlyMap<string, HostKind> = new Map<string, HostKind>([
    ['api.mapbox.com', 'mapbox'],
    ['events.mapbox.com', 'mapbox-events'],
    ['www.googletagmanager.com', 'analytics'],
    ['firebase.googleapis.com', 'analytics'],
    ['firebaseinstallations.googleapis.com', 'analytics'],
    ['firebaselogging.googleapis.com', 'analytics'],
    ['firebaselogging-pa.googleapis.com', 'analytics'],
    ['firebaseremoteconfig.googleapis.com', 'analytics'],
    ['cdn.jsdelivr.net', 'cdn'],
    [E2E_TILE_HOST, 'tiles'],
    [E2E_TELEMETRY_HOST, 'telemetry'],
]);

const SUFFIXES: readonly (readonly [string, HostKind])[] = [
    ['.tiles.mapbox.com', 'mapbox'],
    ['.google-analytics.com', 'analytics'],
    ['.analytics.google.com', 'analytics'],
    ['.googletagmanager.com', 'analytics'],
];

/** How the mock APIs answer `host`, or null when the host is not mocked (the firewall blocks it). */
export function mockedHostKind(host: string): HostKind | null {
    const name = host.toLowerCase();
    return EXACT.get(name) ?? SUFFIXES.find(([suffix]) => name.endsWith(suffix))?.[1] ?? null;
}

export function isLoopback(host: string): boolean {
    return LOOPBACK_HOSTS.includes(host);
}
