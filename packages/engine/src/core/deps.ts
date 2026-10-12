/**
 * What the viewer store is given (docs/research/M1-interfaces.md §6). The fields marked CR-8 are engine-core
 * additions to the contract: the engine version and the map container the boot sequence needs, the reduced-motion
 * preference, and the page address, query and `hashchange` of the location.
 */
import type { EngineConfig, Logger } from '@hcm/shared';

import type { MapPort, Unsubscribe } from '../map/map-port.js';
import type { TelemetryPort } from '../telemetry/telemetry-port.js';
import type { PreferenceStorage } from './preferences.js';

export interface ViewerLocation {
    readonly hash: string;
    replaceHash(hash: string): void;
    /** engine-core addition (CR-8): the page address, to resolve the manifest's relative asset URLs. */
    readonly href?: string;
    /** engine-core addition (CR-8): `?lang=` of the page. */
    readonly search?: string;
    /** engine-core addition (CR-8): `hashchange`; the store applies a hash the visitor edits or navigates to. */
    subscribe?(listener: () => void): Unsubscribe;
}

export interface ViewerDeps {
    readonly config: EngineConfig;
    /** `fetch` for the manifest (tests pass a fake); the store applies a 15 s timeout. */
    readonly fetch: (url: string, init: { readonly signal: AbortSignal }) => Promise<Response>;
    readonly map: MapPort;
    readonly telemetry: TelemetryPort;
    /** localStorage-like; preferences live under `hcm:<cityId>:<name>` (`lang`, `theme`, `consent`). */
    readonly storage: PreferenceStorage;
    /** Reads and writes the URL hash (history.replaceState). */
    readonly location: ViewerLocation;
    readonly log: Logger;
    /** engine-core addition (CR-8): `ENGINE_VERSION`, checked against `city.engine.minVersion`. */
    readonly engineVersion: string;
    /** engine-core addition (CR-8): the element the map is mounted into, once the viewer has rendered it. */
    readonly mapContainer: () => HTMLElement | null;
    /** engine-core addition (CR-8): `prefers-reduced-motion: reduce` (default false). */
    readonly reducedMotion?: () => boolean;
}
