/**
 * Scripted fakes of the services `ops.tick` talks to (Firebase Auth, the Mapbox Tokens API, USGS M2M), recording
 * their calls; failures are scripted with `recorder.failNext`. Secrets live in the in-memory `SecretStore` the
 * Functions emulator uses. Every value is a generated test value.
 */
import { timestampFromDate } from '@hcm/shared';

import { createMemorySecretStore } from '../../src/adapters/secret-store-memory.js';
import type { AuthAdmin, AuthUser } from '../../src/ports/auth-admin.js';
import type { MapboxApi } from '../../src/ports/mapbox-api.js';
import type { SecretStore } from '../../src/ports/secret-store.js';
import type { UsgsApi } from '../../src/ports/usgs-api.js';
import { contentDeps, type ContentDeps } from '../publish/fakes.js';
import { PortRecorder } from '../support/recorder.js';

interface FakeAuth extends AuthAdmin {
    readonly recorder: PortRecorder<'listUsers' | 'deleteUser'>;
    readonly deleted: string[];
}

/** Accounts listed `pageSize` at a time (the real page holds 1000), so pagination is exercised. */
function fakeAuth(users: readonly AuthUser[], pageSize = 2): FakeAuth {
    const recorder = new PortRecorder<'listUsers' | 'deleteUser'>();
    const deleted: string[] = [];
    const unused = () => Promise.reject(new Error('not used by ops.tick'));
    return {
        recorder,
        deleted,
        getUser: unused,
        setAdminClaim: unused,
        revokeSessions: unused,
        listUsers: (pageToken) =>
            Promise.resolve().then(() => {
                recorder.enter('listUsers', [pageToken]);
                const start = Number(pageToken ?? '0');
                const next = start + pageSize;
                return { users: users.slice(start, next), ...(next < users.length ? { nextPageToken: String(next) } : {}) };
            }),
        deleteUser: (uid) =>
            Promise.resolve().then(() => {
                recorder.enter('deleteUser', [uid]);
                deleted.push(uid);
            }),
    };
}

export function account(uid: string, createdAt: string, email?: string): AuthUser {
    return {
        uid,
        emailVerified: true,
        providers: ['google.com'],
        createdAt: new Date(createdAt),
        customClaims: {},
        ...(email === undefined ? {} : { email }),
    };
}

type MapboxMethod = 'retrieveToken' | 'deleteToken';

interface FakeMapbox extends MapboxApi {
    readonly recorder: PortRecorder<MapboxMethod>;
}

function fakeMapbox(): FakeMapbox {
    const recorder = new PortRecorder<MapboxMethod>();
    const unused = () => Promise.reject(new Error('not used by ops.tick'));
    return {
        recorder,
        retrieveToken: () =>
            Promise.resolve().then(() => {
                recorder.enter('retrieveToken', []);
                return { user: 'hcm-test', usage: 'sk' as const, tokenId: 'bootstrap1' };
            }),
        listTokens: unused,
        createToken: unused,
        updateToken: unused,
        deleteToken: (user, _secret, tokenId) =>
            Promise.resolve().then(() => {
                recorder.enter('deleteToken', [user, tokenId]);
            }),
    };
}

type UsgsMethod = 'login' | 'permissions' | 'logout';

interface FakeUsgs extends UsgsApi {
    readonly recorder: PortRecorder<UsgsMethod>;
}

function fakeUsgs(permissions: readonly string[]): FakeUsgs {
    const recorder = new PortRecorder<UsgsMethod>();
    return {
        recorder,
        login: (username) =>
            Promise.resolve().then(() => {
                recorder.enter('login', [username]);
                return 'usgs-api-key-test';
            }),
        permissions: (apiKey) =>
            Promise.resolve().then(() => {
                recorder.enter('permissions', [apiKey]);
                return permissions;
            }),
        logout: (apiKey) =>
            Promise.resolve().then(() => {
                recorder.enter('logout', [apiKey]);
            }),
    };
}

export interface OpsTestDeps extends ContentDeps {
    readonly auth: FakeAuth;
    readonly secrets: SecretStore;
    readonly mapbox: FakeMapbox;
    readonly usgs: FakeUsgs;
}

export function opsDeps(now: string, options: { users?: readonly AuthUser[]; permissions?: readonly string[] } = {}): OpsTestDeps {
    return {
        ...contentDeps(now),
        auth: fakeAuth(options.users ?? []),
        secrets: createMemorySecretStore(),
        mapbox: fakeMapbox(),
        usgs: fakeUsgs(options.permissions ?? ['search', 'download']),
    };
}

/** A timestamp `hours` before `iso`. */
export function hoursBefore(iso: string, hours: number) {
    return timestampFromDate(new Date(Date.parse(iso) - hours * 3_600_000));
}
