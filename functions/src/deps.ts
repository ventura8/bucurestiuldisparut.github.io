import { createLogger, type Logger } from '@hcm/shared';
import { initializeApp, type App, type AppOptions } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getFunctions } from 'firebase-admin/functions';
import { getStorage } from 'firebase-admin/storage';
import { write } from 'firebase-functions/logger';
import { GoogleAuth } from 'google-auth-library';

import { createAuthAdmin } from './adapters/auth-admin.js';
import { createCloudRunJobs } from './adapters/cloud-run.js';
import { createCloudTaskQueue } from './adapters/cloud-tasks.js';
import { createDocumentStore } from './adapters/documents.js';
import { createEmulatorFetch } from './adapters/emulator-fetch.js';
import { createErrorReporter } from './adapters/error-reporting.js';
import { createFcm } from './adapters/fcm.js';
import { createFirebaseManagement } from './adapters/firebase-management.js';
import { firestoreAdminDirectory, firestoreSetupRecords } from './adapters/firestore.js';
import { createFunctionsLogSink } from './adapters/functions-log-sink.js';
import { createGoogleTokenProvider } from './adapters/google-token-provider.js';
import { createSharpImageProcessor } from './adapters/image.js';
import { createMapboxTilesets } from './adapters/mapbox-tilesets.js';
import { createMapboxApi } from './adapters/mapbox.js';
import { createNominatim } from './adapters/nominatim.js';
import { createRemoteFiles, fetchPinnedGet, httpsPinnedGet, systemResolver } from './adapters/remote-files.js';
import { createGoogleIam } from './adapters/resource-manager.js';
import { createSecretManagerStore, secretsRevision } from './adapters/secret-manager.js';
import { createMemorySecretStore } from './adapters/secret-store-memory.js';
import { createStorageBlobReader } from './adapters/storage-reader.js';
import { createStorageBlobStore } from './adapters/storage.js';
import { systemClock } from './adapters/system-clock.js';
import type { Fetch } from './adapters/upstream-http.js';
import { createUsgsApi, createUsgsScenes } from './adapters/usgs.js';
import { createVertexAi } from './adapters/vertex-ai.js';
import type { Ports } from './ports/index.js';
import type { RemoteFiles } from './ports/remote-files.js';
import type { RuntimeConfig } from './ports/runtime-config.js';
import type { SecretStore } from './ports/secret-store.js';
import type { SetupRecords } from './ports/setup-records.js';
import type { TokenProvider } from './ports/token-provider.js';

/**
 * Every port of `docs/research/M2-interfaces.md` §4, `docs/research/M3-interfaces.md` §9.3 and the three of
 * `docs/research/M4-interfaces.md` §4, §5 (Nominatim, Vertex AI Gemini, FCM web push).
 */
export type Deps = Ports;

export type Env = Readonly<Record<string, string | undefined>>;

/** Secrets are re-read at most every five minutes per instance (or at once after `setup/status.secretsRev` moves). */
const SECRET_CACHE_TTL_MS = 5 * 60 * 1000;

const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

const REGION = 'us-central1';

/** The city sites when `HCM_VIEWER_ORIGINS` is unset: the GitHub Pages origin of București dispărut. */
const DEFAULT_VIEWER_ORIGINS: readonly string[] = ['https://ventura8.github.io'];

/** The Functions emulator's stand-in for Application Default Credentials: the fake upstreams accept any bearer token. */
const EMULATOR_TOKENS: TokenProvider = { accessToken: () => Promise.resolve('emulator-access-token') };

function requireProjectId(env: Env): string {
    const projectId = env['GCLOUD_PROJECT'];
    if (!projectId) {
        throw new Error('GCLOUD_PROJECT is not set: the Functions runtime and the emulators always set it');
    }
    return projectId;
}

/** A comma-separated list (`HCM_VIEWER_ORIGINS`, `HCM_OAUTH_CLIENT_IDS`), blanks dropped. */
function listOf(value: string | undefined): string[] {
    return (value ?? '')
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item !== '');
}

/** The `storageBucket` of a parsed `FIREBASE_CONFIG`, or undefined when it names none. */
function bucketIn(config: unknown): string | undefined {
    const bucket: unknown = (config as { readonly storageBucket?: unknown } | null)?.storageBucket;
    return typeof bucket === 'string' && bucket !== '' ? bucket : undefined;
}

/** The bucket a `FIREBASE_CONFIG` value names, or undefined (none, or no JSON at all). */
function configuredBucket(config: string | undefined): string | undefined {
    try {
        return bucketIn(JSON.parse(config ?? '{}'));
    } catch {
        return undefined;
    }
}

/**
 * The project's default bucket, which the Storage rules, the admin's uploads and `photos.onUpload` share: the
 * `storageBucket` of `FIREBASE_CONFIG` (set by the runtime, the deploy and the emulators), else
 * `<project>.firebasestorage.app`, the default bucket of every project created since October 2024.
 */
export function privateBucket(env: Env): string {
    return configuredBucket(env['FIREBASE_CONFIG']) ?? `${requireProjectId(env)}.firebasestorage.app`;
}

/** `RuntimeConfig` (M2-interfaces §4.2) from the environment: values only, nothing secret. */
export function runtimeConfig(env: Env): RuntimeConfig {
    const projectId = requireProjectId(env);
    const viewerOrigins = listOf(env['HCM_VIEWER_ORIGINS']);
    return {
        projectId,
        region: REGION,
        buckets: { private: privateBucket(env), public: `${projectId}-public` },
        viewerOrigins: viewerOrigins.length > 0 ? viewerOrigins : DEFAULT_VIEWER_ORIGINS,
        adminOrigins: [`https://${projectId}.web.app`, `https://${projectId}.firebaseapp.com`],
        adminUrl: `https://${projectId}.web.app/`,
        oauthClientIds: listOf(env['HCM_OAUTH_CLIENT_IDS']),
        errorEndpoint: `https://${REGION}-${projectId}.cloudfunctions.net/telemetry-reportError`,
        appCheck: env['HCM_APP_CHECK'] === 'enforce' ? 'enforce' : 'monitor',
    };
}

interface Upstream {
    readonly fetch: Fetch;
    readonly tokens: TokenProvider;
}

/**
 * How the REST adapters reach the outside: in production the global `fetch` with the runtime service account's tokens
 * (Application Default Credentials); in the Functions emulator only the fake upstreams at `HCM_UPSTREAM_BASE`, with a
 * placeholder token, so no local run can call Google, Mapbox or USGS (CR-M2-14, CR-M2-22).
 */
function upstreamOf(env: Env): Upstream {
    if (env['FUNCTIONS_EMULATOR'] === 'true') {
        return { fetch: createEmulatorFetch(env['HCM_UPSTREAM_BASE'], globalThis.fetch), tokens: EMULATOR_TOKENS };
    }
    return { fetch: globalThis.fetch, tokens: createGoogleTokenProvider(new GoogleAuth({ scopes: [CLOUD_PLATFORM_SCOPE] })) };
}

interface SecretContext {
    readonly projectId: string;
    readonly upstream: Upstream;
    readonly log: Logger;
    readonly setup: SetupRecords;
}

/**
 * No local run can reach the real Secret Manager: in the Functions emulator the secrets live in the fake Secret Manager
 * of the fake upstreams (`HCM_UPSTREAM_BASE`), which every function's worker process shares (the e2e admin tier saves a
 * token with one function and reads it with another), or in memory when no fakes are configured.
 */
function secretStoreOf(env: Env, context: SecretContext): SecretStore {
    if (env['FUNCTIONS_EMULATOR'] === 'true' && env['HCM_UPSTREAM_BASE'] === undefined) {
        return createMemorySecretStore();
    }
    return createSecretManagerStore({
        projectId: context.projectId,
        tokens: context.upstream.tokens,
        fetch: context.upstream.fetch,
        clock: systemClock,
        log: context.log,
        ttlMs: SECRET_CACHE_TTL_MS,
        revision: secretsRevision(context.setup),
    });
}

/**
 * The address guard (`RemoteFiles`): in production it resolves the host itself and connects to the address it checked;
 * in the Functions emulator it keeps its address rules and sends the request to the fake upstreams, without DNS.
 */
function remoteFilesOf(env: Env, upstream: Upstream): RemoteFiles {
    if (env['FUNCTIONS_EMULATOR'] === 'true') {
        return createRemoteFiles({ get: fetchPinnedGet(upstream.fetch), resolve: undefined });
    }
    return createRemoteFiles({ get: httpsPinnedGet(), resolve: systemResolver });
}

/**
 * Nominatim at `HCM_NOMINATIM_URL` (a mirror, set at deploy time) or its own address. In the Functions emulator only the
 * fake's address is reachable (`createEmulatorFetch`), so a configured mirror is ignored there.
 */
function nominatimOptions(env: Env, upstream: Upstream): { readonly fetch: Fetch; readonly url?: string } {
    const mirror = env['FUNCTIONS_EMULATOR'] === 'true' ? undefined : env['HCM_NOMINATIM_URL'];
    return mirror === undefined || mirror === '' ? { fetch: upstream.fetch } : { fetch: upstream.fetch, url: mirror };
}

/** The composition root: the only place that picks adapters (tests build their ports from fakes instead). */
export function createDeps(env: Env, app: App): Deps {
    const config = runtimeConfig(env);
    const db = getFirestore(app);
    const log = createLogger('functions', { sink: createFunctionsLogSink(write) });
    const upstream = upstreamOf(env);
    const setup = firestoreSetupRecords(db);
    return {
        log,
        clock: systemClock,
        config,
        documents: createDocumentStore(db),
        auth: createAuthAdmin(getAuth(app)),
        secrets: secretStoreOf(env, { projectId: config.projectId, upstream, log, setup }),
        iam: createGoogleIam({ fetch: upstream.fetch }),
        firebase: createFirebaseManagement(upstream),
        errors: createErrorReporter({ projectId: config.projectId, tokens: upstream.tokens, fetch: upstream.fetch, write }),
        tasks: createCloudTaskQueue(getFunctions(app), config.region, { named: env['FUNCTIONS_EMULATOR'] !== 'true' }),
        blobs: createStorageBlobStore(getStorage(app), config.buckets),
        images: createSharpImageProcessor(),
        mapbox: createMapboxApi({ fetch: upstream.fetch }),
        usgs: createUsgsApi({ fetch: upstream.fetch, log }),
        jobs: createCloudRunJobs({ fetch: upstream.fetch, tokens: upstream.tokens, projectId: config.projectId, region: config.region }),
        tilesets: createMapboxTilesets({ fetch: upstream.fetch }),
        scenes: createUsgsScenes({ fetch: upstream.fetch, log }),
        remote: remoteFilesOf(env, upstream),
        reader: createStorageBlobReader(getStorage(app), config.buckets),
        geocoder: createNominatim(nominatimOptions(env, upstream)),
        translator: createVertexAi({ projectId: config.projectId, tokens: upstream.tokens, fetch: upstream.fetch }),
        push: createFcm({ projectId: config.projectId, tokens: upstream.tokens, fetch: upstream.fetch }),
        admins: firestoreAdminDirectory(db),
        setup,
    };
}

/**
 * The Admin SDK's options. In the Functions emulator the task queue's service account is named, because the SDK would
 * otherwise ask the metadata server, which does not exist locally, and wait for its timeout on every enqueue (14 s per
 * manifest request in the e2e admin tier); the Cloud Tasks emulator ignores the account. Deployed, the runtime's own
 * account comes from the metadata server.
 */
export function appOptions(env: Env): AppOptions | undefined {
    return env['FUNCTIONS_EMULATOR'] === 'true'
        ? { serviceAccountId: `fn-events@${requireProjectId(env)}.iam.gserviceaccount.com` }
        : undefined;
}

let deps: Deps | undefined;

/** The instance-wide dependencies, created by the first call that needs them (not at cold start). */
export function getDeps(): Deps {
    deps ??= createDeps(process.env, initializeApp(appOptions(process.env)));
    return deps;
}
