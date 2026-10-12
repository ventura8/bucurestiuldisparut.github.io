import { fixtureBody } from '../api-fixtures/index.js';
import { authenticated, googleError, googleFailure, type GoogleApi, type GoogleProjects } from './google-common.js';
import { bodyField, jsonResponse, requestObject, route, type Route, type RouteParams } from './routes.js';
import { sequence, type ServiceFake } from './service.js';

/**
 * IAM v1 for the Provision cloud step (`service-accounts`, `iam`, `workload-identity` items): service accounts and
 * their own IAM policies, and the Workload Identity Federation pool and provider CI deploys through. Creates are
 * idempotent the Google way (409 `ALREADY_EXISTS` for the second), long-running operations are done at once.
 */

interface Binding {
    readonly role: string;
    readonly members: readonly string[];
}

interface ProjectIam {
    /** Account id (`fn-admin`) → display name. */
    readonly accounts: Map<string, string>;
    /** Account e-mail → its IAM policy bindings. */
    readonly accountPolicies: Map<string, readonly Binding[]>;
    /** Pool id → display name. */
    readonly pools: Map<string, string>;
    /** `<pool>/<provider>` → the provider as created (the request body plus its name and state). */
    readonly providers: Map<string, Readonly<Record<string, unknown>>>;
}

export interface IamState {
    /** Project id → its IAM resources. */
    readonly projects: Map<string, ProjectIam>;
}

const IAM: GoogleApi = {
    service: 'iam.googleapis.com',
    title: 'Identity and Access Management (IAM) API',
    permission: 'iam.serviceAccounts.create',
};

function emptyIam(): ProjectIam {
    return { accounts: new Map(), accountPolicies: new Map(), pools: new Map(), providers: new Map() };
}

function bindingsOf(value: unknown): readonly Binding[] {
    const bindings = typeof value === 'object' && value !== null ? (value as { bindings?: unknown }).bindings : undefined;
    return Array.isArray(bindings) ? (bindings as Binding[]) : [];
}

/** A service account id Google accepts (6–30 characters, a letter first). */
function isAccountId(value: unknown): value is string {
    return typeof value === 'string' && /^[a-z][a-z\d-]{4,28}[a-z\d]$/.test(value);
}

/** `serviceAccount.displayName` of a create request, or ''. */
function displayNameOf(details: unknown): string {
    const name = typeof details === 'object' && details !== null ? (details as { displayName?: unknown }).displayName : undefined;
    return typeof name === 'string' ? name : '';
}

type ProjectOf = (segment: string) => { readonly id: string; readonly number: string; readonly iam: ProjectIam };

const ACCOUNTS = 'https://iam.googleapis.com/v1/projects/{project}/serviceAccounts';
const POOLS = 'https://iam.googleapis.com/v1/projects/{project}/locations/global/workloadIdentityPools';

function auth(answer: Route['answer']): Route['answer'] {
    return authenticated(IAM, answer);
}

function accountBody(projectId: string, accountId: string, displayName: string): unknown {
    return fixtureBody('iam/accounts.get.ok', { projectId, accountId, displayName });
}

/** The service account routes: create, list, get, and the account's own IAM policy. */
function accountRoutes(iamOf: ProjectOf): Route[] {
    const create: Route['answer'] = (request, params) => {
        const { id, iam } = iamOf(String(params['project']));
        const accountId = bodyField(request, 'accountId');
        if (!isAccountId(accountId)) {
            return googleError('google/error.invalid-argument', IAM);
        }
        if (iam.accounts.has(accountId)) {
            return googleError('iam/accounts.create.exists', IAM, { projectId: id, accountId });
        }
        const displayName = displayNameOf(bodyField(request, 'serviceAccount'));
        iam.accounts.set(accountId, displayName);
        return jsonResponse(accountBody(id, accountId, displayName));
    };
    /** Runs `answer` for an existing account (`{email}` of the path), else answers 404. */
    const existing = (
        params: RouteParams,
        answer: (project: { id: string; iam: ProjectIam }, email: string, accountId: string) => Response,
    ): Response => {
        const project = iamOf(String(params['project']));
        const email = String(params['email']);
        const accountId = email.split('@')[0] ?? '';
        return project.iam.accounts.has(accountId) ? answer(project, email, accountId) : googleError('iam/accounts.get.not-found', IAM);
    };
    return [
        route('POST', ACCOUNTS, 'iam.serviceAccounts.create', auth(create)),
        route(
            'GET',
            ACCOUNTS,
            'iam.serviceAccounts.list',
            auth((_request, params) => {
                const { id, iam } = iamOf(String(params['project']));
                return jsonResponse({
                    accounts: [...iam.accounts].map(([accountId, displayName]) => accountBody(id, accountId, displayName)),
                });
            }),
        ),
        route(
            'POST',
            `${ACCOUNTS}/{email}:getIamPolicy`,
            'iam.serviceAccounts.getIamPolicy',
            auth((_request, params) =>
                existing(params, ({ iam }, email) =>
                    jsonResponse({ version: 1, etag: 'ACAB', bindings: iam.accountPolicies.get(email) ?? [] }),
                ),
            ),
        ),
        route(
            'POST',
            `${ACCOUNTS}/{email}:setIamPolicy`,
            'iam.serviceAccounts.setIamPolicy',
            auth((request, params) =>
                existing(params, ({ iam }, email) => {
                    const bindings = bindingsOf(bodyField(request, 'policy'));
                    iam.accountPolicies.set(email, bindings);
                    return jsonResponse({ version: 1, etag: 'ACAC', bindings });
                }),
            ),
        ),
        route(
            'GET',
            `${ACCOUNTS}/{email}`,
            'iam.serviceAccounts.get',
            auth((_request, params) =>
                existing(params, ({ id, iam }, _email, accountId) =>
                    jsonResponse(accountBody(id, accountId, iam.accounts.get(accountId) ?? '')),
                ),
            ),
        ),
    ];
}

/** The Workload Identity Federation routes: the pool, its provider, and their operations (done at once). */
function poolRoutes(iamOf: ProjectOf): Route[] {
    const nextOperation = sequence('e2e-iam-op-');
    const operation = (resource: string): Response => jsonResponse({ name: `${resource}/operations/${nextOperation()}` });
    const poolName = (number: string, pool: string): string => `projects/${number}/locations/global/workloadIdentityPools/${pool}`;
    const createPool: Route['answer'] = (request, params) => {
        const { number, iam } = iamOf(String(params['project']));
        const poolId = request.url.searchParams.get('workloadIdentityPoolId') ?? '';
        if (iam.pools.has(poolId)) {
            return googleError('google/error.already-exists', IAM);
        }
        const displayName = bodyField(request, 'displayName');
        iam.pools.set(poolId, typeof displayName === 'string' ? displayName : poolId);
        return operation(poolName(number, poolId));
    };
    const createProvider: Route['answer'] = (request, params) => {
        const { number, iam } = iamOf(String(params['project']));
        const pool = String(params['pool']);
        const key = `${pool}/${request.url.searchParams.get('workloadIdentityPoolProviderId') ?? ''}`;
        if (!iam.pools.has(pool) || iam.providers.has(key)) {
            return googleError(iam.pools.has(pool) ? 'google/error.already-exists' : 'google/error.not-found', IAM);
        }
        const name = `${poolName(number, pool)}/providers/${String(key.split('/')[1])}`;
        iam.providers.set(key, { ...requestObject(request), name, state: 'ACTIVE' });
        return operation(name);
    };
    return [
        route(
            'GET',
            'https://iam.googleapis.com/v1/{resource*}/operations/{operation}',
            'iam.getOperation',
            auth((_request, params) =>
                jsonResponse({ name: `${String(params['resource'])}/operations/${String(params['operation'])}`, done: true, response: {} }),
            ),
        ),
        route('POST', POOLS, 'iam.workloadIdentityPools.create', auth(createPool)),
        route(
            'GET',
            `${POOLS}/{pool}`,
            'iam.workloadIdentityPools.get',
            auth((_request, params) => {
                const { number, iam } = iamOf(String(params['project']));
                const displayName = iam.pools.get(String(params['pool']));
                return displayName === undefined
                    ? googleError('google/error.not-found', IAM)
                    : jsonResponse({ name: poolName(number, String(params['pool'])), displayName, state: 'ACTIVE' });
            }),
        ),
        route('POST', `${POOLS}/{pool}/providers`, 'iam.workloadIdentityPools.providers.create', auth(createProvider)),
        route(
            'GET',
            `${POOLS}/{pool}/providers/{provider}`,
            'iam.workloadIdentityPools.providers.get',
            auth((_request, params) => {
                const provider = iamOf(String(params['project'])).iam.providers.get(
                    `${String(params['pool'])}/${String(params['provider'])}`,
                );
                return provider === undefined ? googleError('google/error.not-found', IAM) : jsonResponse(provider);
            }),
        ),
    ];
}

/** The fake IAM API. */
export function createIamFake(state: IamState, projects: GoogleProjects): ServiceFake {
    const iamOf: ProjectOf = (segment) => {
        const project = projects.resolve(segment);
        const existing = state.projects.get(project.id);
        const iam = existing ?? emptyIam();
        if (existing === undefined) {
            state.projects.set(project.id, iam);
        }
        return { ...project, iam };
    };
    return {
        name: 'iam',
        routes: [...poolRoutes(iamOf), ...accountRoutes(iamOf)],
        failure: (mode) => googleFailure(IAM, mode),
        scenarios: {},
        snapshot: () => ({
            projects: Object.fromEntries(
                [...state.projects].map(([id, iam]) => [
                    id,
                    {
                        accounts: Object.fromEntries(iam.accounts),
                        accountPolicies: Object.fromEntries(iam.accountPolicies),
                        pools: Object.fromEntries(iam.pools),
                        providers: Object.fromEntries(iam.providers),
                    },
                ]),
            ),
        }),
    };
}
