/**
 * GA4 for the admin (PLAN Addendum 2), through `firebase/analytics` on the admin's own Firebase app. Nothing loads and no
 * Google host is contacted until the admin consented **and** the web configuration has a `measurementId`; the SDK module
 * is then imported lazily (`analytics-sdk.ts`, its own chunk in the ES build). Consent Mode v2 starts denied and grants
 * `analytics_storage` only; withdrawing turns collection off at once. Like the viewer, GA4 is told the page's origin and
 * path only, never its hash, and the automatic page view is off (the shell logs one per route).
 */
import type { Logger } from '@hcm/shared';

/** The parts of `firebase/analytics` the admin uses (`analytics-sdk.ts` provides the real ones). */
export interface AnalyticsSdk<App = unknown, Analytics = unknown> {
    readonly isSupported: () => Promise<boolean>;
    readonly setConsent: (settings: Readonly<Record<string, 'granted' | 'denied'>>) => void;
    readonly initializeAnalytics: (app: App, options: { readonly config: Readonly<Record<string, unknown>> }) => Analytics;
    readonly logEvent: (analytics: Analytics, name: string, params: Readonly<Record<string, string | number | boolean>>) => void;
    readonly setAnalyticsCollectionEnabled: (analytics: Analytics, enabled: boolean) => void;
}

/** Consent Mode v2 before any answer, and after a refusal or a withdrawal. */
export const CONSENT_DENIED = {
    analytics_storage: 'denied',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
} as const;

/** After "Accept": analytics storage only. */
export const CONSENT_GRANTED = { ...CONSENT_DENIED, analytics_storage: 'granted' } as const;

export type EventParams = Readonly<Record<string, string | number | boolean>>;

/** What the admin's telemetry sees of GA4. */
export interface AnalyticsPort {
    /** The admin's answer (or its withdrawal): collection on or off; the first grant loads nothing yet. */
    setConsent(granted: boolean): void;
    /** Sent once the SDK is ready; dropped while consent is not granted. */
    log(name: string, params: EventParams): void;
}

export interface AnalyticsDeps<App, Analytics> {
    readonly app: App;
    readonly load: () => Promise<AnalyticsSdk<App, Analytics>>;
    readonly log: Logger;
    /** `location.origin + location.pathname`. */
    readonly pageLocation: () => string;
}

interface Loaded<App, Analytics> {
    readonly sdk: AnalyticsSdk<App, Analytics>;
    readonly analytics: Analytics;
}

/** Google signals and ad personalisation stay off whatever the property says. */
const NO_ADVERTISING = { allow_google_signals: false, allow_ad_personalization_signals: false } as const;

/** The consent-gated GA4 of the admin. */
export function createAnalytics<App, Analytics>(deps: AnalyticsDeps<App, Analytics>): AnalyticsPort {
    let granted = false;
    let loading: Promise<Loaded<App, Analytics> | null> | null = null;
    const start = async (): Promise<Loaded<App, Analytics> | null> => {
        try {
            const sdk = await deps.load();
            if (!(await sdk.isSupported())) {
                deps.log.info('analytics unsupported in this browser');
                return null;
            }
            sdk.setConsent(granted ? CONSENT_GRANTED : CONSENT_DENIED);
            const config = { send_page_view: false, page_location: deps.pageLocation(), ...NO_ADVERTISING };
            const analytics = sdk.initializeAnalytics(deps.app, { config });
            sdk.setAnalyticsCollectionEnabled(analytics, granted);
            return { sdk, analytics };
        } catch (error) {
            deps.log.warn('analytics failed to load', { error: String(error) });
            return null;
        }
    };
    const whenLoaded = (action: (loaded: Loaded<App, Analytics>) => void): void => {
        loading
            ?.then((loaded) => {
                if (loaded !== null) {
                    action(loaded);
                }
            })
            .catch((error: unknown) => {
                deps.log.warn('analytics call failed', { error: String(error) });
            });
    };
    return {
        setConsent: (next) => {
            granted = next;
            whenLoaded(({ sdk, analytics }) => {
                sdk.setConsent(next ? CONSENT_GRANTED : CONSENT_DENIED);
                sdk.setAnalyticsCollectionEnabled(analytics, next);
            });
        },
        log: (name, params) => {
            if (!granted) {
                return;
            }
            loading ??= start();
            whenLoaded(({ sdk, analytics }) => {
                if (granted) {
                    sdk.logEvent(analytics, name, { ...params, page_location: deps.pageLocation() });
                }
            });
        },
    };
}
