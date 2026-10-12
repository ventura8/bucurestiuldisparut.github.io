import { describe, expect, it, vi } from 'vitest';

import { AdminTelemetry, CONSENT_KEY, eventParams, expireAnalyticsCookies, parseConsent } from '../../src/app/telemetry.js';
import type { AnalyticsPort } from '../../src/firebase/analytics.js';
import { MemoryStore, testLog } from './fakes.js';

function telemetry(stored: string | null, configured = true) {
    const local = new MemoryStore();
    if (stored !== null) {
        local.set(CONSENT_KEY, stored);
    }
    const setConsent = vi.fn<(granted: boolean) => void>();
    const logEvent = vi.fn<AnalyticsPort['log']>();
    const analytics: AnalyticsPort = { setConsent, log: logEvent };
    const report = vi.fn();
    const clearCookies = vi.fn();
    const subject = new AdminTelemetry({
        local,
        analytics: configured ? analytics : null,
        errors: { report },
        clearCookies,
        log: testLog().log,
    });
    return { local, setConsent, logEvent, report, clearCookies, subject };
}

describe('AdminTelemetry', () => {
    it('happyPath_aStoredGrantTurnsCollectionOnAndEventsFlow', () => {
        const t = telemetry('granted');

        t.subject.track({ name: 'setup_step', step: 'billing', state: 'ok' });

        expect(t.subject.consent).toBe('granted');
        expect(t.subject.available).toBe(true);
        expect(t.setConsent).toHaveBeenCalledWith(true);
        expect(t.logEvent).toHaveBeenCalledWith('setup_step', { step: 'billing', state: 'ok' });
    });

    it('happyPath_theAnswerIsStoredAndAWithdrawalExpiresTheCookies', () => {
        const t = telemetry(null);

        t.subject.setConsent('denied');
        expect(t.clearCookies).not.toHaveBeenCalled();
        t.subject.setConsent('granted');
        t.subject.setConsent('denied');

        expect(t.local.get(CONSENT_KEY)).toBe('denied');
        expect(t.clearCookies).toHaveBeenCalledTimes(1);
        expect(t.setConsent.mock.calls.map(([granted]) => granted)).toEqual([false, false, true, false]);
    });

    it('badPath_withoutAMeasurementIdNothingIsAskedOrSent', () => {
        const t = telemetry(null, false);

        t.subject.track({ name: 'page_view', route: 'setup' });
        t.subject.setConsent('granted');

        expect(t.subject.available).toBe(false);
        expect(t.logEvent).not.toHaveBeenCalled();
    });

    it('happyPath_errorsGoToTheReporter', () => {
        const t = telemetry(null);
        const error = new Error('x');

        t.subject.reportError(error, { fatal: true, source: 'boundary' });

        expect(t.report).toHaveBeenCalledWith(error, { fatal: true, source: 'boundary' });
    });
});

describe('eventParams and parseConsent', () => {
    it('happyPath_eventsCarryIdsAndCountsOnly', () => {
        expect(eventParams({ name: 'legacy_import', imported: 44, failed: 1 })).toEqual({ imported: 44, failed: 1 });
        expect(eventParams({ name: 'page_view', route: 'admins' })).toEqual({ route: 'admins' });
    });

    it('badPath_anythingButAnAnswerIsUnknown', () => {
        expect([parseConsent('granted'), parseConsent('denied'), parseConsent('yes'), parseConsent(null)]).toEqual([
            'granted',
            'denied',
            'unknown',
            'unknown',
        ]);
    });
});

describe('expireAnalyticsCookies', () => {
    it('happyPath_expiresGa4CookiesHostOnlyAndForTheHost', () => {
        const writes: string[] = [];
        const jar = {
            get cookie(): string {
                return '_ga=GA1.1.1; theme=dark; _ga_E2E0000000=GS1; _gac_x=1; _ga=again';
            },
            set cookie(value: string) {
                writes.push(value);
            },
        };

        expect(expireAnalyticsCookies(jar, 'demo-hcm.web.app')).toEqual(['_ga', '_ga_E2E0000000']);
        expect(writes).toEqual([
            '_ga=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/',
            '_ga=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; Domain=demo-hcm.web.app',
            '_ga_E2E0000000=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/',
            '_ga_E2E0000000=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; Domain=demo-hcm.web.app',
        ]);
    });
});
