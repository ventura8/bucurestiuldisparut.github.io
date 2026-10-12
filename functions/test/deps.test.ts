import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { write } from 'firebase-functions/logger';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { systemClock } from '../src/adapters/system-clock.js';
import { createDeps, getDeps, privateBucket, runtimeConfig } from '../src/deps.js';
import { UpstreamError } from '../src/ports/errors.js';

// Application Default Credentials and Cloud Logging are outside boundaries: stand-ins only.
vi.mock('google-auth-library', () => ({
    GoogleAuth: class {
        getAccessToken(): Promise<string> {
            return Promise.resolve('adc-test-access-token');
        }
    },
}));
vi.mock('firebase-functions/logger', () => ({ write: vi.fn() }));

const PROJECT = { GCLOUD_PROJECT: 'demo-hcm' } as const;
const EMULATOR = { ...PROJECT, FUNCTIONS_EMULATOR: 'true' } as const;
const FAKES = 'http://127.0.0.1:4311';

let app: App;

beforeAll(() => {
    app = initializeApp({ projectId: 'demo-hcm' }, 'functions-deps');
});

afterAll(async () => {
    await deleteApp(app);
});

afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

function answering(status: number, body: unknown) {
    return vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })));
}

describe('runtimeConfig', () => {
    it('happyPath_everyValueFollowsFromTheProject', () => {
        expect(runtimeConfig(PROJECT)).toEqual({
            projectId: 'demo-hcm',
            region: 'us-central1',
            buckets: { private: 'demo-hcm.firebasestorage.app', public: 'demo-hcm-public' },
            viewerOrigins: ['https://ventura8.github.io'],
            adminOrigins: ['https://demo-hcm.web.app', 'https://demo-hcm.firebaseapp.com'],
            adminUrl: 'https://demo-hcm.web.app/',
            oauthClientIds: [],
            errorEndpoint: 'https://us-central1-demo-hcm.cloudfunctions.net/telemetry-reportError',
            appCheck: 'monitor',
        });
    });

    it('happyPath_theListsAndAppCheckComeFromTheEnvironment', () => {
        const config = runtimeConfig({
            ...PROJECT,
            HCM_VIEWER_ORIGINS: ' https://city-one.example , ,https://city-two.example',
            HCM_OAUTH_CLIENT_IDS: 'client-one.apps.example,client-two.apps.example',
            HCM_APP_CHECK: 'enforce',
        });

        expect(config).toMatchObject({
            viewerOrigins: ['https://city-one.example', 'https://city-two.example'],
            oauthClientIds: ['client-one.apps.example', 'client-two.apps.example'],
            appCheck: 'enforce',
        });
    });

    it('badPath_withoutAProjectIdFailsFast', () => {
        expect(() => runtimeConfig({})).toThrow('GCLOUD_PROJECT is not set');
    });
});

describe('privateBucket', () => {
    it('happyPath_theDefaultBucketOfFirebaseConfig', () => {
        expect(privateBucket({ FIREBASE_CONFIG: JSON.stringify({ storageBucket: 'demo-hcm.appspot.com' }) })).toBe('demo-hcm.appspot.com');
    });

    it.each(['not json', 'null', '42', JSON.stringify({ storageBucket: '' }), JSON.stringify({ storageBucket: 7 })])(
        'badPath_anUnusableFirebaseConfigFallsBackToTheProjectsBucket %s',
        (config) => {
            expect(privateBucket({ ...PROJECT, FIREBASE_CONFIG: config })).toBe('demo-hcm.firebasestorage.app');
        },
    );
});

describe('createDeps', () => {
    it('happyPath_wiresEveryPortButTheM3Jobs', () => {
        const deps = createDeps(EMULATOR, app);

        expect(Object.keys(deps).sort((a, b) => a.localeCompare(b))).toEqual(
            [
                'admins',
                'auth',
                'blobs',
                'clock',
                'config',
                'documents',
                'errors',
                'firebase',
                'iam',
                'images',
                'log',
                'mapbox',
                'secrets',
                'setup',
                'tasks',
                'usgs',
            ].sort((a, b) => a.localeCompare(b)),
        );
        expect(deps.clock).toBe(systemClock);
        expect(deps.config.projectId).toBe('demo-hcm');
    });

    it('happyPath_theEmulatorKeepsSecretsInMemory', async () => {
        const fetch = vi.fn();
        vi.stubGlobal('fetch', fetch);
        const deps = createDeps(EMULATOR, app);

        await deps.secrets.write('usgs-app-token', 'emulator-usgs-token');

        await expect(deps.secrets.read('usgs-app-token')).resolves.toBe('emulator-usgs-token');
        expect(fetch).not.toHaveBeenCalled();
    });

    it('happyPath_theEmulatorSendsUpstreamCallsToTheFakesWithAPlaceholderToken', async () => {
        const fetch = answering(200, { apps: [{ appId: '1:000000000000:web:e2e', state: 'ACTIVE' }] });
        vi.stubGlobal('fetch', fetch);
        const deps = createDeps({ ...EMULATOR, HCM_UPSTREAM_BASE: FAKES }, app);

        await expect(deps.firebase.listWebApps('demo-hcm')).resolves.toEqual([{ appId: '1:000000000000:web:e2e', state: 'ACTIVE' }]);
        expect(fetch).toHaveBeenCalledWith(
            `${FAKES}/h/firebase.googleapis.com/v1beta1/projects/demo-hcm/webApps?pageSize=100`,
            expect.objectContaining({
                method: 'GET',
                headers: expect.objectContaining({ authorization: 'Bearer emulator-access-token' }) as unknown,
            }),
        );
    });

    it('badPath_theEmulatorWithoutTheFakesReachesNoUpstream', async () => {
        const fetch = vi.fn();
        vi.stubGlobal('fetch', fetch);
        const deps = createDeps(EMULATOR, app);

        await expect(deps.iam.tokenInfo('emulator-caller-token')).rejects.toMatchObject({
            service: 'google-oauth',
            failure: 'unavailable',
        });
        await expect(deps.mapbox.retrieveToken('sk.emulator')).rejects.toBeInstanceOf(UpstreamError);
        expect(fetch).not.toHaveBeenCalled();
    });

    it('happyPath_productionReadsSecretManagerOverRestWithAdc', async () => {
        const fetch = answering(404, { error: { code: 404, status: 'NOT_FOUND' } });
        vi.stubGlobal('fetch', fetch);
        const deps = createDeps(PROJECT, app);

        await expect(deps.secrets.read('mapbox-sk-tiles')).resolves.toBeUndefined();
        expect(fetch).toHaveBeenCalledWith(
            'https://secretmanager.googleapis.com/v1/projects/demo-hcm/secrets/mapbox-sk-tiles/versions/latest:access',
            expect.objectContaining({
                method: 'GET',
                headers: { authorization: 'Bearer adc-test-access-token', 'content-type': 'application/json' },
            }),
        );
    });

    it('happyPath_logsGoToCloudLoggingRedacted', () => {
        const deps = createDeps(EMULATOR, app);

        deps.log.warn('mapbox rejected', { token: 'sk.e2e' });

        expect(write).toHaveBeenCalledWith({
            severity: 'WARNING',
            message: '[functions] mapbox rejected',
            scope: 'functions',
            token: '[redacted]',
        });
    });
});

describe('getDeps', () => {
    it('happyPath_createsTheDependenciesOncePerInstance', () => {
        vi.stubEnv('GCLOUD_PROJECT', 'demo-hcm');

        const first = getDeps();

        expect(getDeps()).toBe(first);
    });
});
