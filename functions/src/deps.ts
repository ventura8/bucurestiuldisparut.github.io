import { createLogger } from '@hcm/shared';
import { initializeApp, type App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { write } from 'firebase-functions/logger';
import { GoogleAuth } from 'google-auth-library';

import { firestoreAdminDirectory, firestoreSetupRecords } from './adapters/firestore.js';
import { createFunctionsLogSink } from './adapters/functions-log-sink.js';
import { createGoogleTokenProvider } from './adapters/google-token-provider.js';
import { createMemorySecretStore } from './adapters/secret-store-memory.js';
import { createRestSecretStore } from './adapters/secret-store-rest.js';
import { systemClock } from './adapters/system-clock.js';
import type { Ports } from './ports/index.js';
import type { SecretStore } from './ports/secret-store.js';

/** The ports M0's handlers use; jobs, mapbox and usgs join together with their adapters (M2, M3). */
export type Deps = Pick<Ports, 'log' | 'clock' | 'secrets' | 'admins' | 'setup'>;

export type Env = Readonly<Record<string, string | undefined>>;

/** Secrets are re-read at most every five minutes per instance (or at once after a write). */
const SECRET_CACHE_TTL_MS = 5 * 60 * 1000;

const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

function requireProjectId(env: Env): string {
    const projectId = env['GCLOUD_PROJECT'];
    if (!projectId) {
        throw new Error('GCLOUD_PROJECT is not set: the Functions runtime and the emulators always set it');
    }
    return projectId;
}

/** In the Functions emulator secrets stay in memory, so no local run can reach the real Secret Manager. */
function createSecretStore(env: Env): SecretStore {
    if (env['FUNCTIONS_EMULATOR'] === 'true') {
        return createMemorySecretStore();
    }
    return createRestSecretStore({
        projectId: requireProjectId(env),
        tokens: createGoogleTokenProvider(new GoogleAuth({ scopes: [CLOUD_PLATFORM_SCOPE] })),
        fetch: globalThis.fetch,
        clock: systemClock,
        ttlMs: SECRET_CACHE_TTL_MS,
    });
}

/** The composition root: the only place that picks adapters (tests build Deps from fakes instead). */
export function createDeps(env: Env, app: App): Deps {
    const db = getFirestore(app);
    return {
        log: createLogger('functions', { sink: createFunctionsLogSink(write) }),
        clock: systemClock,
        secrets: createSecretStore(env),
        admins: firestoreAdminDirectory(db),
        setup: firestoreSetupRecords(db),
    };
}

let deps: Deps | undefined;

/** The instance-wide dependencies, created by the first call that needs them (not at cold start). */
export function getDeps(): Deps {
    deps ??= createDeps(process.env, initializeApp());
    return deps;
}
