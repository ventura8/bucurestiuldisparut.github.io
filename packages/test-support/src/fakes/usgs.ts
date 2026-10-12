import { fixtureBody, fixtureResponse, type FixtureName } from '../api-fixtures/index.js';
import { bodyField, route, type Route } from './routes.js';
import { sequence, type FailureMode, type ServiceFake } from './service.js';

/**
 * USGS M2M (`m2m.cr.usgs.gov/api/api/json/stable/`, scenario A07; scene search and downloads for M3): `login-token`
 * trades an ERS username and application token for a two-hour API key (`X-Auth-Token`), `permissions` lists the
 * M2M roles, `logout` ends the key. The credentials of `USGS_CREDENTIALS` encode their scenario: approved, awaiting
 * the M2M approval (no `download` until `usgs.m2mApproved`), an expired token (HTML 403); anything else is
 * `AUTH_INVALID`. JSON errors arrive as HTTP 500 with an `errorCode`, as M2M sends them.
 */

/** ERS usernames and application tokens (generated test values, never JWT-shaped). */
export const USGS_CREDENTIALS = {
    /** M2M access approved: `permissions` includes `download`. */
    approved: { username: 'e2e-ok', applicationToken: 'e2e-usgs-app-token-ok' },
    /** M2M access requested, not yet approved (S-A07-BAD-ROLE-PENDING). */
    pending: { username: 'e2e-m2m-pending', applicationToken: 'e2e-usgs-app-token-pending' },
    /** An expired application token: `login-token` answers the HTML 403 (S-A07-BAD-INVALID-TOKEN). */
    expired: { username: 'e2e-expired', applicationToken: 'e2e-usgs-app-token-expired' },
    /** An ERS account without M2M access: `login-token` answers `AUTH_UNAUTHROIZED` (sic) until `usgs.m2mApproved`. */
    noAccess: { username: 'e2e-no-m2m', applicationToken: 'e2e-usgs-app-token-no-m2m' },
    /** Unknown to USGS: `AUTH_INVALID`. */
    unknown: { username: 'e2e-bad', applicationToken: 'e2e-usgs-app-token-bad' },
} as const;

const APPROVED_PERMISSIONS = ['user', 'download', 'order'];

interface UsgsUser {
    readonly applicationToken: string;
    permissions: readonly string[];
    expired: boolean;
    /** False: the account may not use M2M at all (`login-token` refuses it). */
    m2mAccess: boolean;
}

export interface UsgsState {
    /** ERS username → account. */
    readonly users: Map<string, UsgsUser>;
    /** API key → username, while the key is logged in. */
    readonly sessions: Map<string, string>;
}

export function defaultUsgsState(): UsgsState {
    return {
        users: new Map([
            [
                USGS_CREDENTIALS.approved.username,
                {
                    applicationToken: USGS_CREDENTIALS.approved.applicationToken,
                    permissions: APPROVED_PERMISSIONS,
                    expired: false,
                    m2mAccess: true,
                },
            ],
            [
                USGS_CREDENTIALS.pending.username,
                { applicationToken: USGS_CREDENTIALS.pending.applicationToken, permissions: ['user'], expired: false, m2mAccess: true },
            ],
            [
                USGS_CREDENTIALS.expired.username,
                {
                    applicationToken: USGS_CREDENTIALS.expired.applicationToken,
                    permissions: APPROVED_PERMISSIONS,
                    expired: true,
                    m2mAccess: true,
                },
            ],
            [
                USGS_CREDENTIALS.noAccess.username,
                { applicationToken: USGS_CREDENTIALS.noAccess.applicationToken, permissions: [], expired: false, m2mAccess: false },
            ],
        ]),
        sessions: new Map(),
    };
}

/** Why `login-token` refuses `user` with `token`: unknown credentials, an expired token, no M2M access; else undefined. */
function loginRefusal(user: UsgsUser | undefined, token: unknown): FixtureName | undefined {
    if (user === undefined || user.applicationToken !== token) {
        return 'usgs/login-token.auth-invalid';
    }
    if (user.expired) {
        return 'usgs/login-token.html-403';
    }
    return user.m2mAccess ? undefined : 'usgs/login-token.no-m2m-access';
}

/** An M2M envelope around `data`. */
function m2m(data: unknown): Response {
    return fixtureResponse('usgs/logout.ok', { merge: { data } });
}

const FAILURES: Readonly<Partial<Record<FailureMode, FixtureName>>> = {
    maintenance: 'usgs/maintenance.html-503',
    rateLimited: 'usgs/error.rate-limit',
    unavailable: 'usgs/error.unavailable',
    unauthorized: 'usgs/login-token.html-403',
};

/** The scene the fixtures make downloadable at once; any other scene must be ordered (bought) first. */
const SCANNED_SCENE = 'DS1105-1071DF075';
const BASE = 'https://m2m.cr.usgs.gov/api/api/json/stable';

type KeyedAnswer = (request: Parameters<Route['answer']>[0], user: UsgsUser, apiKey: string) => Response;
type Keyed = (answer: KeyedAnswer) => Route['answer'];

/** Scene search and downloads (M3's harvest and scan downloads): search works with any key, downloads need `download`. */
function sceneRoutes(keyed: Keyed): Route[] {
    const downloadOptions = keyed((request) => {
        const ids = bodyField(request, 'entityIds');
        const entityIds = Array.isArray(ids) ? ids.map(String) : [];
        const available = (fixtureBody('usgs/download-options.available') as { data: unknown[] }).data;
        const orderOnly = (fixtureBody('usgs/download-options.order-only') as { data: Record<string, unknown>[] }).data;
        return m2m(
            entityIds.flatMap((entityId) =>
                entityId === SCANNED_SCENE ? available : orderOnly.map((option) => ({ ...option, entityId, displayId: entityId })),
            ),
        );
    });
    const downloadRequest = keyed((_request, user) => {
        if (user.permissions.includes('download')) {
            return fixtureResponse('usgs/download-request.available');
        }
        return fixtureResponse('usgs/login-token.no-m2m-access');
    });
    return [
        route(
            'POST',
            `${BASE}/dataset-search`,
            'usgs.dataset-search',
            keyed(() => fixtureResponse('usgs/dataset-search.declass')),
        ),
        route(
            'POST',
            `${BASE}/scene-search`,
            'usgs.scene-search',
            keyed((request) =>
                fixtureResponse(
                    bodyField(request, 'datasetName') === 'corona2' ? 'usgs/scene-search.two-scenes' : 'usgs/scene-search.empty',
                ),
            ),
        ),
        route('POST', `${BASE}/download-options`, 'usgs.download-options', downloadOptions),
        route('POST', `${BASE}/download-request`, 'usgs.download-request', downloadRequest),
        route(
            'POST',
            `${BASE}/download-retrieve`,
            'usgs.download-retrieve',
            keyed(() => fixtureResponse('usgs/download-retrieve.available')),
        ),
        route(
            'GET',
            'https://dds.cr.usgs.gov/e2e/download/{download}',
            'usgs.download',
            (_request, params) =>
                new Response(new TextEncoder().encode(`E2E-SCAN-${String(params['download'])}`), {
                    status: 200,
                    headers: { 'content-type': 'application/octet-stream' },
                }),
        ),
    ];
}

/** The fake USGS M2M API and its download host. */
export function createUsgsFake(state: UsgsState): ServiceFake {
    const nextKey = sequence('e2e-usgs-api-key-');
    const login: Route['answer'] = (request) => {
        const username = bodyField(request, 'username');
        const refusal = loginRefusal(typeof username === 'string' ? state.users.get(username) : undefined, bodyField(request, 'token'));
        if (refusal !== undefined) {
            return fixtureResponse(refusal);
        }
        const apiKey = nextKey();
        state.sessions.set(apiKey, String(username));
        return fixtureResponse('usgs/login-token.ok', { values: { usgsApiKey: apiKey } });
    };
    /** Wraps an endpoint that needs a logged-in API key (`X-Auth-Token`). */
    const keyed: Keyed = (answer) => (request) => {
        const apiKey = request.headers.get('x-auth-token') ?? '';
        const user = state.users.get(state.sessions.get(apiKey) ?? '');
        return user === undefined ? fixtureResponse('usgs/error.api-key-invalid') : answer(request, user, apiKey);
    };
    return {
        name: 'usgs',
        routes: [
            route('POST', `${BASE}/login-token`, 'usgs.login-token', login),
            route(
                'POST',
                `${BASE}/permissions`,
                'usgs.permissions',
                keyed((_request, user) => m2m(user.permissions)),
            ),
            route(
                'POST',
                `${BASE}/logout`,
                'usgs.logout',
                keyed((_request, _user, apiKey) => {
                    state.sessions.delete(apiKey);
                    return m2m(null);
                }),
            ),
            ...sceneRoutes(keyed),
        ],
        failure: (mode) => {
            const name = FAILURES[mode];
            return name === undefined ? undefined : fixtureResponse(name);
        },
        scenarios: {
            m2mApproved: () => {
                state.users.forEach((user) => {
                    user.permissions = APPROVED_PERMISSIONS;
                    user.m2mAccess = true;
                });
            },
            tokenExpired: () => {
                state.users.forEach((user) => {
                    user.expired = true;
                });
            },
        },
        snapshot: () => ({
            users: Object.fromEntries(
                [...state.users].map(([name, user]) => [name, { permissions: user.permissions, expired: user.expired }]),
            ),
            sessions: state.sessions.size,
        }),
    };
}
