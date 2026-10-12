/**
 * What the viewer store sees of analytics and crash reporting (docs/research/M1-interfaces.md §6, PLAN Addendum 2).
 * `createTelemetry` (`telemetry.ts`) implements it: consent (`consent.ts`), the consent-gated Firebase loader
 * (`analytics.ts`) and the error reporter (`errors.ts`).
 */
import type { Unsubscribe } from '../map/map-port.js';

export type ConsentState = 'unknown' | 'granted' | 'denied';

export type TelemetryEvent =
    | { readonly name: 'page_view' }
    | { readonly name: 'layer_toggle'; readonly layerId: string; readonly visible: boolean }
    | { readonly name: 'year_change'; readonly year: number | null }
    | { readonly name: 'photo_open'; readonly photoId: string }
    | { readonly name: 'poi_open'; readonly poiId: string }
    | { readonly name: 'share' }
    | { readonly name: 'compare_open' };

export type ErrorSource = 'window' | 'promise' | 'boundary';

/** The Firebase web app identifiers `initializeApp` needs besides the measurement id (public values; CR-9). */
export interface FirebaseAppIds {
    readonly apiKey: string;
    readonly appId: string;
    readonly projectId: string;
}

/**
 * What telemetry learns once the manifest has loaded, and again whenever the language or the window class changes:
 * the city (it namespaces the stored consent), the analytics ids and the error endpoint of the manifest.
 */
export interface TelemetryContext {
    readonly cityId: string;
    readonly locale: string;
    readonly windowClass: string;
    readonly measurementId?: string;
    readonly errorEndpoint?: string;
    readonly firebase?: FirebaseAppIds;
}

export interface TelemetryPort {
    readonly consent: ConsentState;
    /** Stored under `hcm:<cityId>:consent`; withdrawing stops every later analytics request (V19). */
    setConsent(consent: 'granted' | 'denied'): void;
    onConsentChange(listener: (consent: ConsentState) => void): Unsubscribe;
    /** Dropped unless consent is granted and the manifest has a measurementId; the Firebase SDK loads lazily on the first one. */
    logEvent(event: TelemetryEvent): void;
    /**
     * Never throws. Redacted (createLogger's rules plus URL queries), at most 5 per page and one per message per 10 s,
     * POSTed to `analytics.errorEndpoint` when set; a GA4 `exception` event too when consent is granted (V20).
     */
    reportError(error: unknown, context: { readonly fatal: boolean; readonly source: ErrorSource }): void;
    /** engine-core addition (CR-8): the store passes the manifest's ids and the live locale and window class. */
    setContext?(context: TelemetryContext): void;
    destroy(): void;
}

/** The body sent to `telemetry.reportError` (M2 HTTPS function). No PII: no hash, no query, no visitor position. */
export interface ErrorReportPayload {
    readonly message: string;
    readonly stack?: string;
    readonly release: string;
    readonly cityId: string;
    /** `location.origin + location.pathname`. */
    readonly page: string;
    readonly viewport: { readonly width: number; readonly height: number };
    readonly windowClass: string;
    readonly locale: string;
    readonly fatal: boolean;
    readonly source: ErrorSource;
}
