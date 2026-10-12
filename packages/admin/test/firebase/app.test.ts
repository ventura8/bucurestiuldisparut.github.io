import { describe, expect, it, vi } from 'vitest';

import { EMULATOR_PORTS, firebaseOptions, FUNCTIONS_REGION, initFirebase, loadAnalyticsSdk } from '../../src/firebase/app.js';
import { firebaseSdk, type FirebaseSdk } from '../../src/firebase/sdk.js';
import { E2E_WEB_CONFIG } from '../app/fakes.js';

/** The SDK table with every function the app uses recorded. */
function fakeSdk() {
    const calls: string[] = [];
    const record =
        (name: string, result: unknown = { name }) =>
        (...args: unknown[]) => {
            calls.push([name, ...args.slice(1).map((arg) => JSON.stringify(arg))].join(' '));
            return result;
        };
    class Provider {
        readonly key: string;

        constructor(key: string) {
            this.key = key;
            calls.push(`provider ${key}`);
        }
    }
    const sdk = {
        initializeApp: record('initializeApp', { app: true }),
        initializeAppCheck: record('initializeAppCheck'),
        ReCaptchaEnterpriseProvider: Provider,
        getAuth: record('getAuth', { auth: true }),
        getFunctions: record('getFunctions', { functions: true }),
        getFirestore: record('getFirestore', { firestore: true }),
        getStorage: record('getStorage', { storage: true }),
        connectAuthEmulator: record('connectAuthEmulator'),
        connectFunctionsEmulator: record('connectFunctionsEmulator'),
        connectFirestoreEmulator: record('connectFirestoreEmulator'),
        connectStorageEmulator: record('connectStorageEmulator'),
    };
    return { sdk: sdk as unknown as FirebaseSdk, calls };
}

describe('initFirebase', () => {
    it('happyPath_productionWithAnAppCheckKeyAndLazyFirestoreAndStorage', () => {
        const { sdk, calls } = fakeSdk();

        const handles = initFirebase(
            sdk,
            { ...E2E_WEB_CONFIG, measurementId: 'G-E2E0000000' },
            { release: 'r', appCheckSiteKey: '6Le2e-key-001' },
            false,
        );

        expect(calls).toEqual([
            'initializeApp',
            'provider 6Le2e-key-001',
            'initializeAppCheck {"provider":{"key":"6Le2e-key-001"},"isTokenAutoRefreshEnabled":true}',
            'getAuth',
            `getFunctions "${FUNCTIONS_REGION}"`,
        ]);
        expect(handles.firestore()).toBe(handles.firestore());
        expect(handles.storage()).toEqual({ storage: true });
        expect(calls.slice(5)).toEqual(['getFirestore', 'getStorage']);
    });

    it('happyPath_theE2eBuildUsesTheEmulatorsAndNoAppCheck', () => {
        const { sdk, calls } = fakeSdk();

        const handles = initFirebase(sdk, E2E_WEB_CONFIG, { release: 'e2e', appCheckSiteKey: '6Le2e-key-001' }, true);
        handles.firestore();
        handles.storage();

        expect(calls).toEqual([
            'initializeApp',
            'getAuth',
            `getFunctions "${FUNCTIONS_REGION}"`,
            `connectAuthEmulator "http://127.0.0.1:${String(EMULATOR_PORTS.auth)}" {"disableWarnings":true}`,
            `connectFunctionsEmulator "127.0.0.1" ${String(EMULATOR_PORTS.functions)}`,
            'getFirestore',
            `connectFirestoreEmulator "127.0.0.1" ${String(EMULATOR_PORTS.firestore)}`,
            'getStorage',
            `connectStorageEmulator "127.0.0.1" ${String(EMULATOR_PORTS.storage)}`,
        ]);
    });

    it('badPath_withoutASiteKeyThereIsNoAppCheck', () => {
        const { sdk, calls } = fakeSdk();

        initFirebase(sdk, E2E_WEB_CONFIG, { release: 'r' }, false);

        expect(calls).not.toContain('initializeAppCheck');
    });
});

describe('firebaseOptions', () => {
    it('happyPath_absentKeysAreLeftOut', () => {
        const { storageBucket, ...noBucket } = E2E_WEB_CONFIG;
        expect(storageBucket).toBe('demo-hcm.firebasestorage.app');

        expect(firebaseOptions(noBucket)).toEqual(noBucket);
        expect(firebaseOptions({ ...E2E_WEB_CONFIG, measurementId: 'G-E2E0000000' })).toEqual({
            ...E2E_WEB_CONFIG,
            measurementId: 'G-E2E0000000',
        });
        expect(Object.keys(firebaseOptions(noBucket))).not.toContain('storageBucket');
    });
});

describe('the SDK modules', () => {
    it('happyPath_theRealTablesHoldTheSdksFunctions', async () => {
        const analytics = await loadAnalyticsSdk();

        expect(Object.values(firebaseSdk).every((value) => typeof value === 'function')).toBe(true);
        expect(Object.keys(analytics).toSorted((a, b) => a.localeCompare(b, 'en'))).toEqual([
            'initializeAnalytics',
            'isSupported',
            'logEvent',
            'setAnalyticsCollectionEnabled',
            'setConsent',
        ]);
        await expect(analytics.isSupported()).resolves.toBe(false);
        expect(vi.isMockFunction(analytics.logEvent)).toBe(false);
    });
});
