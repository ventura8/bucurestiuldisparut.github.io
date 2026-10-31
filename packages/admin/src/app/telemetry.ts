/**
 * The admin's analytics and crash reporting (PLAN Addendum 2, `docs/research/M2b-interfaces.md` §1.4): the admin's
 * consent (stored in `localStorage` `hcm:admin:consent`, withdrawable in the account menu), GA4 behind it
 * (`../firebase/analytics.ts`) and the crash reporter (`errors.ts`). Events carry ids and states only, never an address,
 * a token or free text: page views by route, Setup Assistant steps, the legacy import.
 */
import type { Logger } from '@hcm/shared';

import type { AnalyticsPort, EventParams } from '../firebase/analytics.js';
import type { AdminRouteId } from '../routing/routes.js';
import type { ConsentState } from '../state/state.js';
import type { AdminErrorReporter, ErrorSource } from './errors.js';
import type { KeyValueStore } from './ports.js';

export const CONSENT_KEY = 'hcm:admin:consent';

/** The admin's GA4 events (no PII). */
export type AdminEvent =
    | { readonly name: 'page_view'; readonly route: AdminRouteId }
    | { readonly name: 'setup_step'; readonly step: string; readonly state: string }
    | { readonly name: 'legacy_import'; readonly imported: number; readonly failed: number };

/** GA4's own parameters of an event: snake_case, ids and counts only. */
export function eventParams(event: AdminEvent): EventParams {
    return Object.fromEntries(Object.entries(event).filter(([key]) => key !== 'name'));
}

export function parseConsent(value: string | null): ConsentState {
    return value === 'granted' || value === 'denied' ? value : 'unknown';
}

/**
 * The admin's own GA4 cookies (`hcm_admin_ga`, `hcm_admin_ga_<container>`: `ADMIN_COOKIE_PREFIX` of
 * `../firebase/analytics.ts`), never another cookie: since M6 the public map on the same origin keeps its `_ga` and
 * `_ga_<container>` (`docs/research/M6-interfaces.md` §2.3).
 */
const GA_COOKIE = /^hcm_admin_+ga(?:_[\w-]+)?$/;

/**
 * Expires the admin's GA4 cookies on its own host (`<project>.web.app` is a public suffix, so gtag.js writes them for the
 * host itself, path `/`): host-only and with the host's domain. Returns their names.
 */
export function expireAnalyticsCookies(jar: { cookie: string }, hostname: string): readonly string[] {
    const names = [...new Set(jar.cookie.split(';').map((pair) => pair.split('=', 1).join('').trim()))].filter((name) =>
        GA_COOKIE.test(name),
    );
    for (const name of names) {
        for (const domain of ['', `; Domain=${hostname}`]) {
            jar.cookie = `${name}=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/${domain}`;
        }
    }
    return names;
}

export interface AdminTelemetryDeps {
    readonly local: KeyValueStore;
    /** Null when the web configuration has no `measurementId`: no banner, no GA4. */
    readonly analytics: AnalyticsPort | null;
    readonly errors: Pick<AdminErrorReporter, 'report'>;
    /** Expires GA4's cookies on a withdrawal (never throws). */
    readonly clearCookies: () => void;
    readonly log: Logger;
}

export class AdminTelemetry {
    readonly #deps: AdminTelemetryDeps;
    #consent: ConsentState;

    constructor(deps: AdminTelemetryDeps) {
        this.#deps = deps;
        this.#consent = parseConsent(deps.local.get(CONSENT_KEY));
        deps.analytics?.setConsent(this.#consent === 'granted');
    }

    get consent(): ConsentState {
        return this.#consent;
    }

    /** GA4 is configured, so the admin is asked. */
    get available(): boolean {
        return this.#deps.analytics !== null;
    }

    /** The admin's answer, stored; a withdrawal turns collection off and expires GA4's cookies. */
    setConsent(consent: 'granted' | 'denied'): void {
        const withdrawn = this.#consent === 'granted' && consent === 'denied';
        this.#consent = consent;
        this.#deps.local.set(CONSENT_KEY, consent);
        this.#deps.analytics?.setConsent(consent === 'granted');
        if (withdrawn) {
            this.#deps.clearCookies();
        }
        this.#deps.log.info('analytics consent', { consent });
    }

    /** Dropped without consent or configuration. */
    track(event: AdminEvent): void {
        this.#deps.analytics?.log(event.name, eventParams(event));
    }

    reportError(error: unknown, context: { readonly fatal: boolean; readonly source: ErrorSource }): void {
        this.#deps.errors.report(error, context);
    }
}
