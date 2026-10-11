import type { Clock } from '../ports/clock.js';
import type { SecretName, SecretStore } from '../ports/secret-store.js';
import type { TokenProvider } from '../ports/token-provider.js';

/**
 * Secret Manager over its REST API with `fetch` (docs/research/design-review-testability.md F11):
 * the gRPC client cannot be intercepted in tests and costs cold-start time. Values are cached per
 * instance for `ttlMs`; a write drops that secret's cached value.
 */
export const SECRET_MANAGER_API = 'https://secretmanager.googleapis.com/v1';

export interface RestSecretStoreOptions {
    readonly projectId: string;
    readonly tokens: TokenProvider;
    readonly fetch: typeof fetch;
    readonly clock: Clock;
    readonly ttlMs: number;
}

/** A failed Secret Manager call. The message names the secret and status, never a value or a token. */
export class SecretStoreError extends Error {
    readonly status: number;

    constructor(message: string, status: number) {
        super(message);
        this.name = 'SecretStoreError';
        this.status = status;
    }
}

function httpError(operation: string, name: SecretName, status: number): SecretStoreError {
    return new SecretStoreError(`Secret Manager ${operation} of ${name} failed (HTTP ${String(status)})`, status);
}

function malformed(operation: string, name: SecretName): SecretStoreError {
    return new SecretStoreError(`Secret Manager ${operation} of ${name} returned an unexpected body`, 200);
}

interface CacheEntry {
    readonly value: string | undefined;
    readonly expiresAt: number;
}

type Call = (url: string, init: RequestInit) => Promise<Response>;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null;
}

function decodePayload(body: unknown, name: SecretName): string {
    const payload = isRecord(body) ? body['payload'] : undefined;
    const data = isRecord(payload) ? payload['data'] : undefined;
    if (typeof data !== 'string') {
        throw malformed('access', name);
    }
    return Buffer.from(data, 'base64').toString('utf8');
}

function versionName(body: unknown, name: SecretName): string {
    const version = isRecord(body) ? body['name'] : undefined;
    if (typeof version !== 'string') {
        throw malformed('addVersion', name);
    }
    return version;
}

/** The latest version's value; a 404 (no such secret or no version yet) is "not set". */
async function accessLatest(call: Call, secretUrl: string, name: SecretName): Promise<string | undefined> {
    const response = await call(`${secretUrl}/versions/latest:access`, { method: 'GET' });
    if (response.status === 404) {
        return undefined;
    }
    if (!response.ok) {
        throw httpError('access', name, response.status);
    }
    return decodePayload(await response.json(), name);
}

async function addVersion(call: Call, secretUrl: string, name: SecretName, value: string): Promise<string> {
    const body = JSON.stringify({ payload: { data: Buffer.from(value, 'utf8').toString('base64') } });
    const response = await call(`${secretUrl}:addVersion`, { method: 'POST', body });
    if (!response.ok) {
        throw httpError('addVersion', name, response.status);
    }
    return versionName(await response.json(), name);
}

export function createRestSecretStore(options: RestSecretStoreOptions): SecretStore {
    const cache = new Map<SecretName, CacheEntry>();
    const secretUrl = (name: SecretName): string =>
        `${SECRET_MANAGER_API}/projects/${encodeURIComponent(options.projectId)}/secrets/${name}`;
    const call: Call = async (url, init) => {
        const token = await options.tokens.accessToken();
        return options.fetch(url, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } });
    };
    return {
        read: async (name) => {
            const now = options.clock.now().getTime();
            const cached = cache.get(name);
            if (cached !== undefined && cached.expiresAt > now) {
                return cached.value;
            }
            const value = await accessLatest(call, secretUrl(name), name);
            cache.set(name, { value, expiresAt: now + options.ttlMs });
            return value;
        },
        write: async (name, value) => {
            const version = await addVersion(call, secretUrl(name), name, value);
            cache.delete(name);
            return version;
        },
        invalidate: () => {
            cache.clear();
        },
    };
}
