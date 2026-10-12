import type { FirebaseApp } from 'firebase/app';
import type { Analytics, ConsentSettings } from 'firebase/analytics';
import type { FirebasePerformance } from 'firebase/performance';
import { describe, expect, it } from 'vitest';

import { AnalyticsLoader, DEFAULT_FIREBASE_APP, FIREBASE_APP_NAME, gaParams, type FirebaseSdk } from '../../src/telemetry/analytics.js';
import { CONSENT_DENIED, CONSENT_GRANTED, ConsentStore, parseConsent } from '../../src/telemetry/consent.js';
import { brokenStorage, memoryStorage, recordingLog, settle } from '../core/support.js';

const IDS = { apiKey: 'test-api-key', appId: '1:2:web:3', projectId: 'demo-hcm' };

interface FakeSdk extends FirebaseSdk {
    readonly log: string[];
    readonly consents: ConsentSettings[];
    readonly events: [string, unknown][];
    readonly performance: { dataCollectionEnabled: boolean; instrumentationEnabled: boolean };
}

interface FakeSdkOptions {
    readonly supported?: boolean;
    readonly throwOnLog?: boolean;
    /** The page already runs its own default Firebase app. */
    readonly pageDefaultApp?: boolean;
    /** `initializePerformance` throws, as Firebase does for an app that is not the default one. */
    readonly performanceThrows?: boolean;
}

function fakeSdk(options: FakeSdkOptions = {}): FakeSdk {
    const log: string[] = [];
    const consents: ConsentSettings[] = [];
    const events: [string, unknown][] = [];
    const performance = { dataCollectionEnabled: false, instrumentationEnabled: false };
    const app: FirebaseApp = { name: FIREBASE_APP_NAME, options: {}, automaticDataCollectionEnabled: false };
    const pageApp: FirebaseApp = { name: DEFAULT_FIREBASE_APP, options: {}, automaticDataCollectionEnabled: false };
    const analytics: Analytics = { app };
    return {
        log,
        consents,
        events,
        performance,
        getApps: () => (options.pageDefaultApp === true ? [pageApp] : []),
        initializeApp: (appOptions, name) => {
            log.push(`initializeApp ${name} ${JSON.stringify(appOptions)}`);
            return app;
        },
        isSupported: () => Promise.resolve(options.supported ?? true),
        setConsent: (settings) => {
            consents.push(settings);
        },
        initializeAnalytics: (_app, settings) => {
            log.push(`initializeAnalytics ${JSON.stringify(settings)}`);
            return analytics;
        },
        logEvent: (_analytics, name, params) => {
            if (options.throwOnLog === true) {
                throw new Error('gtag missing');
            }
            events.push([name, params]);
        },
        setAnalyticsCollectionEnabled: (_analytics, enabled) => {
            log.push(`collection ${String(enabled)}`);
        },
        initializePerformance: (_app, settings) => {
            if (options.performanceThrows === true) {
                throw new Error('Performance: Performance can only start when Firebase app instance is the default one.');
            }
            log.push(`initializePerformance ${JSON.stringify(settings)}`);
            Object.assign(performance, settings);
            return performance as FirebasePerformance;
        },
    };
}

function loader(sdk: FirebaseSdk | Error, log = recordingLog()): { analytics: AnalyticsLoader; loads: () => number } {
    let loads = 0;
    const analytics = new AnalyticsLoader({
        loadSdk: () => {
            loads += 1;
            return sdk instanceof Error ? Promise.reject(sdk) : Promise.resolve(sdk);
        },
        log: log.log,
        pageLocation: () => 'https://site.example.org/bucuresti/',
    });
    return { analytics, loads: () => loads };
}

describe('analytics', () => {
    it('happyPath_eventsMapToGa4ParametersWithoutPii', () => {
        expect(gaParams({ name: 'page_view' })).toEqual({});
        expect(gaParams({ name: 'layer_toggle', layerId: 'kh4', visible: true })).toEqual({ layer_id: 'kh4', visible: true });
        expect(gaParams({ name: 'year_change', year: 1966 })).toEqual({ year: 1966 });
        expect(gaParams({ name: 'year_change', year: null })).toEqual({ year: 'today' });
        expect(gaParams({ name: 'photo_open', photoId: 'p' })).toEqual({ photo_id: 'p' });
        expect(gaParams({ name: 'poi_open', poiId: 'x' })).toEqual({ poi_id: 'x' });
        expect(gaParams({ name: 'exception', description: 'TypeError: x', fatal: false })).toEqual({
            description: 'TypeError: x',
            fatal: false,
        });
        expect(gaParams({ name: 'share' })).toEqual({});
        expect(gaParams({ name: 'compare_open' })).toEqual({});
    });

    it('badPath_nothingLoadsBeforeConsent', async () => {
        const sdk = fakeSdk();
        const { analytics, loads } = loader(sdk);
        analytics.configure('G-TEST1234', IDS);

        analytics.send({ name: 'page_view' });
        analytics.setConsent('unknown');
        analytics.send({ name: 'share' });
        await settle();

        expect(loads()).toBe(0);
        expect(sdk.events).toEqual([]);
    });

    it('badPath_withoutAMeasurementIdNothingLoadsEvenWithConsent', async () => {
        const { analytics, loads } = loader(fakeSdk());
        analytics.configure(undefined, IDS);
        analytics.setConsent('granted');

        analytics.send({ name: 'page_view' });
        await settle();

        expect(loads()).toBe(0);
    });

    it('badPath_withoutTheFirebaseAppIdsAnalyticsStaysOffAndSaysWhy', async () => {
        const log = recordingLog();
        const { analytics, loads } = loader(fakeSdk(), log);
        analytics.configure('G-TEST1234', undefined);
        analytics.setConsent('granted');

        analytics.send({ name: 'page_view' });
        await settle();

        expect(loads()).toBe(0);
        expect(log.messages()).toEqual(['analytics off: the manifest has no Firebase app ids']);
    });
});

describe('analytics after consent', () => {
    it('happyPath_consentLoadsTheSdkOnceInConsentModeAndSendsEvents', async () => {
        const sdk = fakeSdk();
        const { analytics, loads } = loader(sdk);
        analytics.configure('G-TEST1234', IDS);
        analytics.configure('G-OTHER999', IDS);
        analytics.setConsent('granted');

        analytics.send({ name: 'page_view' });
        analytics.send({ name: 'photo_open', photoId: 'p' });
        await settle();

        expect(loads()).toBe(1);
        expect(sdk.log).toEqual([
            `initializeApp [DEFAULT] ${JSON.stringify({ ...IDS, measurementId: 'G-TEST1234' })}`,
            `initializeAnalytics ${JSON.stringify({ config: { send_page_view: false, page_location: 'https://site.example.org/bucuresti/' } })}`,
            `initializePerformance ${JSON.stringify({ dataCollectionEnabled: true, instrumentationEnabled: true })}`,
        ]);
        expect(sdk.consents).toEqual([CONSENT_GRANTED]);
        expect(sdk.events).toEqual([
            ['page_view', {}],
            ['photo_open', { photo_id: 'p' }],
        ]);
    });

    it('happyPath_withdrawingStopsCollectionAndLaterEvents', async () => {
        const sdk = fakeSdk();
        const { analytics } = loader(sdk);
        analytics.configure('G-TEST1234', IDS);
        analytics.setConsent('granted');
        analytics.send({ name: 'page_view' });
        await settle();

        analytics.setConsent('denied');
        analytics.send({ name: 'share' });
        await settle();

        expect(sdk.consents.at(-1)).toEqual(CONSENT_DENIED);
        expect(sdk.log.at(-1)).toBe('collection false');
        expect(sdk.performance).toEqual({ dataCollectionEnabled: false, instrumentationEnabled: false });
        expect(sdk.events).toEqual([['page_view', {}]]);
    });

    it('happyPath_grantingAgainTurnsCollectionBackOn', async () => {
        const sdk = fakeSdk();
        const { analytics } = loader(sdk);
        analytics.configure('G-TEST1234', IDS);
        analytics.setConsent('granted');
        analytics.send({ name: 'page_view' });
        await settle();
        analytics.setConsent('denied');

        analytics.setConsent('granted');
        analytics.send({ name: 'share' });
        await settle();

        expect(sdk.log.at(-1)).toBe('collection true');
        expect(sdk.performance.dataCollectionEnabled).toBe(true);
        expect(sdk.events.at(-1)).toEqual(['share', {}]);
    });

    it('badPath_anEventQueuedBeforeAWithdrawalIsDropped', async () => {
        const sdk = fakeSdk();
        const { analytics } = loader(sdk);
        analytics.configure('G-TEST1234', IDS);
        analytics.setConsent('granted');

        analytics.send({ name: 'page_view' });
        analytics.setConsent('denied');
        await settle();

        expect(sdk.events).toEqual([]);
    });

    it('badPath_aPageWithItsOwnDefaultAppKeepsItAndRunsAnalyticsWithoutPerformance', async () => {
        const sdk = fakeSdk({ pageDefaultApp: true });
        const log = recordingLog();
        const { analytics } = loader(sdk, log);
        analytics.configure('G-TEST1234', IDS);
        analytics.setConsent('granted');

        analytics.send({ name: 'page_view' });
        await settle();
        analytics.setConsent('denied');
        await settle();

        expect(sdk.log[0]).toBe(`initializeApp hcm-viewer ${JSON.stringify({ ...IDS, measurementId: 'G-TEST1234' })}`);
        expect(sdk.log.some((entry) => entry.startsWith('initializePerformance'))).toBe(false);
        expect(sdk.events).toEqual([['page_view', {}]]);
        expect(sdk.log.at(-1)).toBe('collection false');
        expect(log.messages()).toEqual(['performance monitoring off: the page runs its own default Firebase app']);
    });

    it('badPath_aPerformanceMonitoringFailureNeverStopsAnalytics', async () => {
        // S-V19-HAPPY found it: Firebase refuses Performance Monitoring on a named app, the whole load failed with it,
        // and no analytics event was ever sent.
        const sdk = fakeSdk({ performanceThrows: true });
        const log = recordingLog();
        const { analytics } = loader(sdk, log);
        analytics.configure('G-TEST1234', IDS);
        analytics.setConsent('granted');

        analytics.send({ name: 'page_view' });
        await settle();

        expect(sdk.events).toEqual([['page_view', {}]]);
        expect(log.messages()).toEqual(['performance monitoring failed to start']);
        expect(String(log.records[0]?.data?.['error'])).toContain('default one');
    });

    it('badPath_anUnsupportedBrowserOrAFailedLoadSendsNothing', async () => {
        const unsupported = fakeSdk({ supported: false });
        const quiet = loader(unsupported);
        const log = recordingLog();
        const failing = loader(new Error('chunk 404'), log);
        for (const { analytics } of [quiet, failing]) {
            analytics.configure('G-TEST1234', IDS);
            analytics.setConsent('granted');
            analytics.send({ name: 'page_view' });
            analytics.send({ name: 'share' });
        }
        await settle();

        expect(unsupported.events).toEqual([]);
        expect(quiet.loads()).toBe(1);
        expect(log.messages()).toEqual(['analytics failed to load']);
        expect(log.records[0]?.data).toEqual({ error: 'Error: chunk 404' });
    });

    it('badPath_aThrowingSdkCallIsLoggedNotThrown', async () => {
        const log = recordingLog();
        const { analytics } = loader(fakeSdk({ throwOnLog: true }), log);
        analytics.configure('G-TEST1234', IDS);
        analytics.setConsent('granted');

        analytics.send({ name: 'page_view' });
        await settle();

        expect(log.messages()).toEqual(['analytics call failed']);
    });
});

describe('ConsentStore', () => {
    it('happyPath_theAnswerIsStoredPerCityAndAnnounced', () => {
        const storage = memoryStorage();
        const consent = new ConsentStore(storage, recordingLog().log, 'bucuresti');
        const heard: string[] = [];
        consent.onChange((state) => heard.push(state));

        consent.set('granted');
        consent.set('granted');
        consent.set('denied');

        expect(consent.state).toBe('denied');
        expect(storage.get('hcm:bucuresti:consent')).toBe('denied');
        expect(heard).toEqual(['granted', 'denied']);
    });

    it('happyPath_aStoredAnswerIsReadBackForItsCity', () => {
        const storage = memoryStorage({ 'hcm:bucuresti:consent': 'granted', 'hcm:cluj:consent': 'denied' });
        const consent = new ConsentStore(storage, recordingLog().log, undefined);
        const heard: string[] = [];
        consent.onChange((state) => heard.push(state));

        expect(consent.state).toBe('unknown');
        consent.setCity('bucuresti');
        consent.setCity('bucuresti');
        consent.setCity('cluj');

        expect(heard).toEqual(['granted', 'denied']);
    });

    it('happyPath_anAnswerGivenBeforeTheCityIsKnownIsStoredForIt', () => {
        const storage = memoryStorage();
        const consent = new ConsentStore(storage, recordingLog().log, undefined);

        consent.set('granted');
        consent.setCity('bucuresti');

        expect(consent.state).toBe('granted');
        expect(storage.get('hcm:bucuresti:consent')).toBe('granted');
    });

    it('badPath_aBrokenStorageMeansNoAnswerYet', () => {
        const log = recordingLog();
        const consent = new ConsentStore(brokenStorage, log.log, 'bucuresti');
        consent.onChange(() => {
            throw new Error('listener bug');
        });

        consent.set('denied');

        expect(consent.state).toBe('denied');
        expect(log.messages()).toEqual(['preference not stored', 'consent listener failed']);
        expect(parseConsent('maybe')).toBe('unknown');
        consent.destroy();
    });
});
