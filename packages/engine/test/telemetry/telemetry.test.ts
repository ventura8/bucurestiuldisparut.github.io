import type { FirebaseApp } from 'firebase/app';
import type { Analytics } from 'firebase/analytics';
import type { FirebasePerformance } from 'firebase/performance';
import { describe, expect, it } from 'vitest';

import type { FirebaseSdk } from '../../src/telemetry/analytics.js';
import { createTelemetry, loadFirebaseSdk, type TelemetryDeps } from '../../src/telemetry/telemetry.js';
import { memoryStorage, recordingLog, settle } from '../core/support.js';

const CONTEXT = {
    cityId: 'bucuresti',
    locale: 'ro',
    windowClass: 'compact',
    measurementId: 'G-TEST1234',
    errorEndpoint: 'https://errors.example.org/report',
    firebase: { apiKey: 'test-api-key', appId: '1:2:web:3', projectId: 'demo-hcm' },
};

function fakeWindow(): TelemetryDeps['window'] & EventTarget {
    return Object.assign(new EventTarget(), {
        innerWidth: 1280,
        innerHeight: 800,
        location: { origin: 'https://site.example.org', pathname: '/bucuresti/' },
    });
}

function sdk(events: string[]): FirebaseSdk {
    return {
        getApps: () => [],
        initializeApp: () => ({}) as FirebaseApp,
        isSupported: () => Promise.resolve(true),
        setConsent: () => undefined,
        initializeAnalytics: () => ({}) as Analytics,
        logEvent: (_analytics, name) => {
            events.push(name);
        },
        setAnalyticsCollectionEnabled: () => undefined,
        initializePerformance: () => ({ dataCollectionEnabled: true, instrumentationEnabled: true }) as FirebasePerformance,
    };
}

function setup(stored: Readonly<Record<string, string>> = {}): {
    telemetry: ReturnType<typeof createTelemetry>;
    events: string[];
    posts: [string, RequestInit][];
    page: ReturnType<typeof fakeWindow>;
    storage: ReturnType<typeof memoryStorage>;
} {
    const events: string[] = [];
    const posts: [string, RequestInit][] = [];
    const page = fakeWindow();
    const storage = memoryStorage(stored);
    const telemetry = createTelemetry({
        window: page,
        storage,
        fetch: (url, init) => {
            posts.push([url, init]);
            return Promise.resolve();
        },
        log: recordingLog().log,
        release: '1.0.0',
        loadSdk: () => Promise.resolve(sdk(events)),
        now: () => 0,
    });
    return { telemetry, events, posts, page, storage };
}

describe('telemetry', () => {
    it('badPath_noAnalyticsBeforeConsent', async () => {
        const { telemetry, events } = setup();
        telemetry.setContext?.(CONTEXT);

        telemetry.logEvent({ name: 'page_view' });
        await settle();

        expect(telemetry.consent).toBe('unknown');
        expect(events).toEqual([]);
    });

    it('happyPath_acceptingCountsThePageViewAndLaterEvents', async () => {
        const { telemetry, events, storage } = setup();
        const heard: string[] = [];
        telemetry.onConsentChange((consent) => heard.push(consent));
        telemetry.setContext?.(CONTEXT);
        telemetry.logEvent({ name: 'page_view' });

        telemetry.setConsent('granted');
        telemetry.logEvent({ name: 'share' });
        await settle();

        expect(events).toEqual(['page_view', 'share']);
        expect(heard).toEqual(['granted']);
        expect(storage.get('hcm:bucuresti:consent')).toBe('granted');
    });

    it('happyPath_aStoredConsentAppliesOnceTheCityIsKnown', async () => {
        const { telemetry, events } = setup({ 'hcm:bucuresti:consent': 'granted' });

        telemetry.setContext?.(CONTEXT);
        telemetry.logEvent({ name: 'page_view' });
        await settle();

        expect(telemetry.consent).toBe('granted');
        expect(events).toEqual(['page_view']);
    });

    it('happyPath_acceptingBeforeAnyPageViewSendsNone', async () => {
        const { telemetry, events } = setup();
        telemetry.setContext?.(CONTEXT);

        telemetry.setConsent('granted');
        await settle();

        expect(events).toEqual([]);
    });

    it('happyPath_uncaughtErrorsArePostedAsTextWithoutCredentials', () => {
        const { telemetry, posts, page } = setup();
        telemetry.setContext?.(CONTEXT);

        page.dispatchEvent(Object.assign(new Event('error'), { error: new Error('boom') }));
        telemetry.reportError(new Error('boundary'), { fatal: true, source: 'boundary' });

        expect(posts.map(([url]) => url)).toEqual(['https://errors.example.org/report', 'https://errors.example.org/report']);
        const [, init] = posts[0] ?? ['', {}];
        expect(init).toMatchObject({ method: 'POST', headers: { 'content-type': 'text/plain' }, keepalive: true, credentials: 'omit' });
        expect(JSON.parse(init.body as string)).toMatchObject({
            message: 'Error: boom',
            page: 'https://site.example.org/bucuresti/',
            viewport: { width: 1280, height: 800 },
        });
    });

    it('badPath_withoutAnErrorEndpointNothingIsPosted', () => {
        const { telemetry, posts } = setup();
        telemetry.setContext?.({ cityId: 'bucuresti', locale: 'ro', windowClass: 'compact' });

        telemetry.reportError(new Error('x'), { fatal: false, source: 'boundary' });

        expect(posts).toEqual([]);
    });

    it('badPath_afterDestroyNothingIsSentOrHooked', async () => {
        const { telemetry, posts, page, events } = setup();
        telemetry.setContext?.(CONTEXT);
        telemetry.destroy();
        telemetry.destroy();

        telemetry.setConsent('granted');
        telemetry.logEvent({ name: 'page_view' });
        telemetry.reportError(new Error('x'), { fatal: false, source: 'boundary' });
        page.dispatchEvent(Object.assign(new Event('error'), { error: new Error('late') }));
        await settle();

        expect(telemetry.consent).toBe('unknown');
        expect(posts).toEqual([]);
        expect(events).toEqual([]);
    });

    it('happyPath_theDefaultsUseTheRealClockAndTheLazyChunk', () => {
        const telemetry = createTelemetry({
            window: fakeWindow(),
            storage: memoryStorage(),
            fetch: () => Promise.resolve(),
            log: recordingLog().log,
            release: '1.0.0',
            cityId: 'bucuresti',
        });

        telemetry.reportError(new Error('x'), { fatal: false, source: 'boundary' });

        expect(telemetry.consent).toBe('unknown');
        telemetry.destroy();
    });

    it('happyPath_theFirebaseChunkHasOnlyAppAnalyticsAndPerformance', async () => {
        const firebase = await loadFirebaseSdk();

        expect(Object.keys(firebase).sort((a, b) => a.localeCompare(b))).toEqual([
            'getApps',
            'initializeAnalytics',
            'initializeApp',
            'initializePerformance',
            'isSupported',
            'logEvent',
            'setAnalyticsCollectionEnabled',
            'setConsent',
        ]);
        expect(await firebase.isSupported()).toBe(false);
    });
});
