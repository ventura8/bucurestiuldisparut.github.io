/**
 * GA4 and Performance Monitoring through the Firebase JS SDK (PLAN Addendum 2), loaded lazily and only when the
 * manifest has a `measurementId` (and the Firebase app ids, CR-9) **and** the visitor granted consent. Before that no
 * Firebase code runs and no Google host is contacted (scenario V19). Withdrawing consent turns collection off at once
 * and drops every later event. Events carry ids and flags only (no PII); the page location sent to GA4 is the page's
 * origin and path, never its hash (the visitor's view) or query.
 */
import type { Logger } from '@hcm/shared';
import type { FirebaseApp, FirebaseOptions } from 'firebase/app';
import type { Analytics as GaAnalytics, AnalyticsSettings, ConsentSettings } from 'firebase/analytics';
import type { FirebasePerformance, PerformanceSettings } from 'firebase/performance';

import { CONSENT_DENIED, CONSENT_GRANTED } from './consent.js';
import type { ConsentState, FirebaseAppIds, TelemetryEvent } from './telemetry-port.js';

/** The Firebase functions the viewer uses; `firebase-sdk.ts` (a lazy chunk) provides the real ones. */
export interface FirebaseSdk {
    readonly getApps: () => readonly FirebaseApp[];
    readonly initializeApp: (options: FirebaseOptions, name: string) => FirebaseApp;
    readonly isSupported: () => Promise<boolean>;
    readonly setConsent: (settings: ConsentSettings) => void;
    readonly initializeAnalytics: (app: FirebaseApp, options: AnalyticsSettings) => GaAnalytics;
    readonly logEvent: (analytics: GaAnalytics, name: string, params: Readonly<Record<string, string | number | boolean>>) => void;
    readonly setAnalyticsCollectionEnabled: (analytics: GaAnalytics, enabled: boolean) => void;
    readonly initializePerformance: (app: FirebaseApp, settings: PerformanceSettings) => FirebasePerformance;
}

/** Firebase's name for the default app: Performance Monitoring runs only on it (`performance/FB not default`). */
export const DEFAULT_FIREBASE_APP = '[DEFAULT]';

/** The name of the viewer's Firebase app when the page already runs its own default app (which is then left alone). */
export const FIREBASE_APP_NAME = 'hcm-viewer';

export interface AnalyticsConfig {
    readonly measurementId: string;
    readonly firebase: FirebaseAppIds;
}

export interface AnalyticsDeps {
    readonly loadSdk: () => Promise<FirebaseSdk>;
    readonly log: Logger;
    /** `location.origin + location.pathname`. */
    readonly pageLocation: () => string;
}

interface Loaded {
    readonly sdk: FirebaseSdk;
    readonly analytics: GaAnalytics;
    /** Null when Performance Monitoring could not start: analytics works without it. */
    readonly performance: FirebasePerformance | null;
}

type GaEvent = TelemetryEvent | { readonly name: 'exception'; readonly description: string; readonly fatal: boolean };

type GaParams = Readonly<Record<string, string | number | boolean>>;

/** Per event name, its GA4 parameters; an event without parameters is absent. */
const GA_PARAMS: { readonly [N in GaEvent['name']]?: (event: Extract<GaEvent, { readonly name: N }>) => GaParams } = {
    layer_toggle: (event) => ({ layer_id: event.layerId, visible: event.visible }),
    year_change: (event) => ({ year: event.year ?? 'today' }),
    photo_open: (event) => ({ photo_id: event.photoId }),
    poi_open: (event) => ({ poi_id: event.poiId }),
    exception: (event) => ({ description: event.description, fatal: event.fatal }),
};

/** A telemetry event as GA4 receives it: snake_case parameters, ids and flags only. */
export function gaParams(event: GaEvent): GaParams {
    const params = GA_PARAMS[event.name] as ((event: GaEvent) => GaParams) | undefined;
    return params === undefined ? {} : params(event);
}

export class AnalyticsLoader {
    readonly #deps: AnalyticsDeps;
    #config: AnalyticsConfig | null = null;
    #consent: ConsentState = 'unknown';
    #loading: Promise<Loaded | null> | null = null;

    constructor(deps: AnalyticsDeps) {
        this.#deps = deps;
    }

    /** The manifest's ids; without the Firebase app ids analytics stays off (CR-9). */
    configure(measurementId: string | undefined, firebase: FirebaseAppIds | undefined): void {
        if (this.#config !== null || measurementId === undefined) {
            return;
        }
        if (firebase === undefined) {
            this.#deps.log.warn('analytics off: the manifest has no Firebase app ids', { measurementId });
            return;
        }
        this.#config = { measurementId, firebase };
    }

    /** Withdrawing turns collection off at once; granting again (after a withdrawal) turns it back on. */
    setConsent(consent: ConsentState): void {
        this.#consent = consent;
        if (consent !== 'unknown') {
            this.#whenLoaded((loaded) => {
                toggleCollection(loaded, consent === 'granted');
            });
        }
    }

    /** Sends `event` once the SDK is ready; dropped without configuration or consent (also if consent goes in between). */
    send(event: GaEvent): void {
        const config = this.#config;
        if (config === null || this.#consent !== 'granted') {
            return;
        }
        this.#loading ??= this.#start(config);
        this.#whenLoaded((loaded) => {
            if (this.#consent === 'granted') {
                loaded.sdk.logEvent(loaded.analytics, event.name, gaParams(event));
            }
        });
    }

    /** Runs `action` once the SDK has loaded (never if it is not loading or failed); a throwing SDK call is logged. */
    #whenLoaded(action: (loaded: Loaded) => void): void {
        this.#loading
            ?.then((loaded) => {
                if (loaded !== null) {
                    action(loaded);
                }
            })
            .catch((error: unknown) => {
                this.#deps.log.warn('analytics call failed', { error: String(error) });
            });
    }

    async #start(config: AnalyticsConfig): Promise<Loaded | null> {
        try {
            const sdk = await this.#deps.loadSdk();
            if (!(await sdk.isSupported())) {
                this.#deps.log.info('analytics unsupported in this browser');
                return null;
            }
            return initialize(sdk, config, this.#deps);
        } catch (error) {
            this.#deps.log.warn('analytics failed to load', { error: String(error) });
            return null;
        }
    }
}

/**
 * Consent first (Consent Mode v2), then GA4 without the automatic page view, then Performance Monitoring. The viewer's
 * app is the page's default Firebase app unless the page already has one (Performance Monitoring refuses any other
 * app, so it stays off then); a Performance Monitoring failure never stops analytics (S-V19-HAPPY found it did).
 */
function initialize(sdk: FirebaseSdk, config: AnalyticsConfig, deps: Pick<AnalyticsDeps, 'log' | 'pageLocation'>): Loaded {
    const pageHasDefault = sdk.getApps().some((app) => app.name === DEFAULT_FIREBASE_APP);
    const options = { ...config.firebase, measurementId: config.measurementId };
    const app = sdk.initializeApp(options, pageHasDefault ? FIREBASE_APP_NAME : DEFAULT_FIREBASE_APP);
    sdk.setConsent(CONSENT_GRANTED);
    const analytics = sdk.initializeAnalytics(app, { config: { send_page_view: false, page_location: deps.pageLocation() } });
    const performance = pageHasDefault ? skipPerformance(deps.log) : startPerformance(sdk, app, deps.log);
    return { sdk, analytics, performance };
}

function skipPerformance(log: Logger): null {
    log.info('performance monitoring off: the page runs its own default Firebase app');
    return null;
}

function startPerformance(sdk: FirebaseSdk, app: FirebaseApp, log: Logger): FirebasePerformance | null {
    try {
        return sdk.initializePerformance(app, { dataCollectionEnabled: true, instrumentationEnabled: true });
    } catch (error) {
        log.warn('performance monitoring failed to start', { error: String(error) });
        return null;
    }
}

/** Consent Mode v2 and collection on or off for GA4 and Performance Monitoring. */
function toggleCollection(loaded: Loaded, enabled: boolean): void {
    loaded.sdk.setConsent(enabled ? CONSENT_GRANTED : CONSENT_DENIED);
    loaded.sdk.setAnalyticsCollectionEnabled(loaded.analytics, enabled);
    if (loaded.performance !== null) {
        loaded.performance.dataCollectionEnabled = enabled;
        loaded.performance.instrumentationEnabled = enabled;
    }
}
