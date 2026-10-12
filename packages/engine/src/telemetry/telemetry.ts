/**
 * The viewer's `TelemetryPort`: consent (`consent.ts`), the consent-gated Firebase analytics (`analytics.ts`, its SDK
 * a lazy chunk) and crash reporting (`errors.ts`) behind one object. The store passes it the manifest's ids with
 * `setContext`; `destroy` removes the global error hooks and every listener.
 */
import type { Logger } from '@hcm/shared';

import type { PreferenceStorage } from '../core/preferences.js';
import type { Unsubscribe } from '../map/map-port.js';
import { AnalyticsLoader, type FirebaseSdk } from './analytics.js';
import { ConsentStore, type ConsentValue } from './consent.js';
import { ErrorReporter, installErrorHooks } from './errors.js';
import type { ConsentState, ErrorSource, TelemetryContext, TelemetryEvent, TelemetryPort } from './telemetry-port.js';

/** The parts of `window` telemetry uses. */
export interface TelemetryWindow extends Pick<Window, 'addEventListener' | 'removeEventListener' | 'innerWidth' | 'innerHeight'> {
    readonly location: Pick<Location, 'origin' | 'pathname'>;
}

export interface TelemetryDeps {
    readonly window: TelemetryWindow;
    readonly storage: PreferenceStorage;
    /** POSTs a crash report (text body, so no CORS preflight). */
    readonly fetch: (url: string, init: RequestInit) => Promise<unknown>;
    readonly log: Logger;
    /** `ENGINE_VERSION`: the release a crash belongs to. */
    readonly release: string;
    /** The configured city, when the embed configuration names one (the stored consent is per city). */
    readonly cityId?: string;
    /** Loads the Firebase SDK chunk; the default is the dynamic import of `firebase-sdk.ts`. */
    readonly loadSdk?: () => Promise<FirebaseSdk>;
    readonly now?: () => number;
}

/** The lazy chunk with firebase/app, firebase/analytics and firebase/performance (docs/research/M1-interfaces.md CR-10). */
export async function loadFirebaseSdk(): Promise<FirebaseSdk> {
    const chunk = await import('./firebase-sdk.js');
    return chunk.firebaseSdk;
}

class Telemetry implements TelemetryPort {
    readonly #consent: ConsentStore;
    readonly #analytics: AnalyticsLoader;
    readonly #errors: ErrorReporter;
    readonly #uninstall: () => void;
    #pageViewed = false;
    #destroyed = false;

    constructor(deps: TelemetryDeps) {
        const page = (): string => `${deps.window.location.origin}${deps.window.location.pathname}`;
        this.#consent = new ConsentStore(deps.storage, deps.log, deps.cityId);
        this.#analytics = new AnalyticsLoader({ loadSdk: deps.loadSdk ?? loadFirebaseSdk, log: deps.log, pageLocation: page });
        this.#analytics.setConsent(this.#consent.state);
        this.#errors = new ErrorReporter({
            release: deps.release,
            log: deps.log,
            now: deps.now ?? (() => Date.now()),
            page,
            viewport: () => ({ width: deps.window.innerWidth, height: deps.window.innerHeight }),
            post: (url, body) =>
                deps.fetch(url, { method: 'POST', body, headers: { 'content-type': 'text/plain' }, keepalive: true, credentials: 'omit' }),
            exception: (description, fatal) => {
                this.#analytics.send({ name: 'exception', description, fatal });
            },
        });
        this.#uninstall = installErrorHooks(deps.window, this.#errors);
        this.#consent.onChange((consent) => {
            this.#consentChanged(consent);
        });
    }

    get consent(): ConsentState {
        return this.#consent.state;
    }

    setConsent(consent: ConsentValue): void {
        if (!this.#destroyed) {
            this.#consent.set(consent);
        }
    }

    onConsentChange(listener: (consent: ConsentState) => void): Unsubscribe {
        return this.#consent.onChange(listener);
    }

    logEvent(event: TelemetryEvent): void {
        if (this.#destroyed) {
            return;
        }
        this.#pageViewed ||= event.name === 'page_view';
        this.#analytics.send(event);
    }

    reportError(error: unknown, context: { readonly fatal: boolean; readonly source: ErrorSource }): void {
        if (!this.#destroyed) {
            this.#errors.report(error, context);
        }
    }

    /** Analytics is configured before the city's stored consent is read, so a stored "granted" applies at once. */
    setContext(context: TelemetryContext): void {
        this.#analytics.configure(context.measurementId, context.firebase);
        this.#consent.setCity(context.cityId);
        this.#errors.setContext({
            cityId: context.cityId,
            locale: context.locale,
            windowClass: context.windowClass,
            ...(context.errorEndpoint === undefined ? {} : { endpoint: context.errorEndpoint }),
        });
    }

    /** A page viewed before the visitor accepted is counted once they accept. */
    #consentChanged(consent: ConsentState): void {
        this.#analytics.setConsent(consent);
        if (consent === 'granted' && this.#pageViewed) {
            this.#analytics.send({ name: 'page_view' });
        }
    }

    /** Removes the error hooks and the listeners; every later call does nothing. */
    destroy(): void {
        if (this.#destroyed) {
            return;
        }
        this.#destroyed = true;
        this.#uninstall();
        this.#consent.destroy();
    }
}

export function createTelemetry(deps: TelemetryDeps): TelemetryPort {
    return new Telemetry(deps);
}
