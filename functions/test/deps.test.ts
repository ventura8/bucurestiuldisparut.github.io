import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { write } from 'firebase-functions/logger';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { systemClock } from '../src/adapters/system-clock.js';
import { createDeps, getDeps } from '../src/deps.js';

// Application Default Credentials and Cloud Logging are outside boundaries: stand-ins only.
vi.mock('google-auth-library', () => ({
    GoogleAuth: class {
        getAccessToken(): Promise<string> {
            return Promise.resolve('ya29.e2e-adc');
        }
    },
}));
vi.mock('firebase-functions/logger', () => ({ write: vi.fn() }));

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

describe('createDeps', () => {
    it('happyPath_theEmulatorKeepsSecretsInMemory', async () => {
        const deps = createDeps({ FUNCTIONS_EMULATOR: 'true' }, app);

        await deps.secrets.write('usgs-app-token', 'e2e-token');

        await expect(deps.secrets.read('usgs-app-token')).resolves.toBe('e2e-token');
    });

    it('happyPath_productionReadsSecretManagerOverRestWithAdc', async () => {
        const fetch = vi.fn(() => Promise.resolve(new Response('{}', { status: 404 })));
        vi.stubGlobal('fetch', fetch);

        const deps = createDeps({ GCLOUD_PROJECT: 'demo-hcm' }, app);

        await expect(deps.secrets.read('mapbox-sk-tiles')).resolves.toBeUndefined();
        expect(fetch).toHaveBeenCalledWith(
            'https://secretmanager.googleapis.com/v1/projects/demo-hcm/secrets/mapbox-sk-tiles/versions/latest:access',
            {
                method: 'GET',
                headers: { authorization: 'Bearer ya29.e2e-adc', 'content-type': 'application/json' },
            },
        );
    });

    it('badPath_productionWithoutAProjectIdFailsFast', () => {
        expect(() => createDeps({}, app)).toThrow('GCLOUD_PROJECT is not set');
    });

    it('happyPath_logsGoToCloudLoggingRedacted', () => {
        const deps = createDeps({ FUNCTIONS_EMULATOR: 'true' }, app);

        deps.log.warn('mapbox rejected', { token: 'sk.e2e' });

        expect(deps.clock).toBe(systemClock);
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
