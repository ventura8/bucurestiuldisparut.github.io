import { FIXTURE_VALUES, fixtureBody } from '../api-fixtures/index.js';
import { authenticated, googleError, googleFailure, type GoogleApi, type GoogleProjects } from './google-common.js';
import { applyMask, bodyField, jsonResponse, requestObject, route, type Route, type RouteParams } from './routes.js';
import { sequence, type ServiceFake } from './service.js';

/**
 * IAM v1 for the Provision cloud step (`service-accounts`, `iam`, `workload-identity` items): service accounts and
 * their own IAM policies, the project's custom roles (M4), and the Workload Identity Federation pool and provider CI
 * deploys through. Creates are idempotent the Google way (409 `ALREADY_EXISTS` for the second), a deleted custom role
 * answers with `deleted: true` until it is undeleted, long-running operations are done at once.
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
    /** Deleted pools (`<pool>`) and providers (`<pool>/<provider>`): readable with state `DELETED` for 30 days. */
    readonly deleted: Set<string>;
    /** Custom role id → its permissions and whether it is deleted (undeletable). */
    readonly roles: Map<string, Role>;
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
    return {
        accounts: new Map(),
        accountPolicies: new Map(),
        pools: new Map(),
        providers: new Map(),
        deleted: new Set(),
        roles: new Map(),
    };
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
const ROLES = 'https://iam.googleapis.com/v1/projects/{project}/roles';
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

interface Role {
    includedPermissions: readonly string[];
    deleted: boolean;
}

function permissionsOf(value: unknown): readonly string[] {
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

/** The custom role routes: get, create, patch (its permissions) and undelete. */
function roleRoutes(iamOf: ProjectOf): Route[] {
    const body = (projectId: string, roleId: string, role: Role): Response =>
        jsonResponse({
            ...(fixtureBody('iam/roles.get.ok', { projectId, roleId }) as Record<string, unknown>),
            includedPermissions: role.includedPermissions,
            ...(role.deleted ? { deleted: true } : {}),
        });
    /** Runs `answer` for an existing role (`{role}` of the path), else answers 404. */
    const existing = (params: RouteParams, answer: (projectId: string, roleId: string, role: Role) => Response): Response => {
        const { id, iam } = iamOf(String(params['project']));
        const roleId = String(params['role']);
        const role = iam.roles.get(roleId);
        return role === undefined ? googleError('google/error.not-found', IAM) : answer(id, roleId, role);
    };
    const create: Route['answer'] = (request, params) => {
        const { id, iam } = iamOf(String(params['project']));
        const roleId = bodyField(request, 'roleId');
        if (typeof roleId !== 'string') {
            return googleError('google/error.invalid-argument', IAM);
        }
        if (iam.roles.has(roleId)) {
            return googleError('google/error.already-exists', IAM);
        }
        const fields = bodyField(request, 'role');
        const role = {
            includedPermissions: permissionsOf((fields as { includedPermissions?: unknown } | undefined)?.includedPermissions),
            deleted: false,
        };
        iam.roles.set(roleId, role);
        return body(id, roleId, role);
    };
    return [
        route('POST', ROLES, 'iam.roles.create', auth(create)),
        route(
            'POST',
            `${ROLES}/{role}:undelete`,
            'iam.roles.undelete',
            auth((_request, params) =>
                existing(params, (id, roleId, role) => {
                    if (!role.deleted) {
                        return googleError('google/error.invalid-argument', IAM);
                    }
                    role.deleted = false;
                    return body(id, roleId, role);
                }),
            ),
        ),
        route(
            'PATCH',
            `${ROLES}/{role}`,
            'iam.roles.patch',
            auth((request, params) =>
                existing(params, (id, roleId, role) => {
                    if (role.deleted || request.url.searchParams.get('updateMask') !== 'includedPermissions') {
                        return googleError('google/error.invalid-argument', IAM);
                    }
                    role.includedPermissions = permissionsOf(bodyField(request, 'includedPermissions'));
                    return body(id, roleId, role);
                }),
            ),
        ),
        route(
            'GET',
            `${ROLES}/{role}`,
            'iam.roles.get',
            auth((_request, params) => existing(params, (id, roleId, role) => body(id, roleId, role))),
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
    const undelete =
        (key: (params: RouteParams) => string, name: (number: string, params: RouteParams) => string): Route['answer'] =>
        (_request, params) => {
            const { number, iam } = iamOf(String(params['project']));
            if (!iam.deleted.delete(key(params))) {
                return googleError('google/error.invalid-argument', IAM);
            }
            return operation(name(number, params));
        };
    const providerKey = (params: RouteParams): string => `${String(params['pool'])}/${String(params['provider'])}`;
    const patchProvider: Route['answer'] = (request, params) => {
        const { iam } = iamOf(String(params['project']));
        const provider = iam.providers.get(providerKey(params));
        if (provider === undefined) {
            return googleError('google/error.not-found', IAM);
        }
        const updated = applyMask(provider, requestObject(request), request.url.searchParams.get('updateMask'));
        iam.providers.set(providerKey(params), updated);
        return operation(String(updated['name']));
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
            'POST',
            `${POOLS}/{pool}:undelete`,
            'iam.workloadIdentityPools.undelete',
            auth(
                undelete(
                    (params) => String(params['pool']),
                    (number, params) => poolName(number, String(params['pool'])),
                ),
            ),
        ),
        route(
            'GET',
            `${POOLS}/{pool}`,
            'iam.workloadIdentityPools.get',
            auth((_request, params) => {
                const { number, iam } = iamOf(String(params['project']));
                const pool = String(params['pool']);
                const displayName = iam.pools.get(pool);
                return displayName === undefined
                    ? googleError('google/error.not-found', IAM)
                    : jsonResponse({ name: poolName(number, pool), displayName, state: iam.deleted.has(pool) ? 'DELETED' : 'ACTIVE' });
            }),
        ),
        route('POST', `${POOLS}/{pool}/providers`, 'iam.workloadIdentityPools.providers.create', auth(createProvider)),
        route(
            'POST',
            `${POOLS}/{pool}/providers/{provider}:undelete`,
            'iam.workloadIdentityPools.providers.undelete',
            auth(
                undelete(
                    providerKey,
                    (number, params) => `${poolName(number, String(params['pool']))}/providers/${String(params['provider'])}`,
                ),
            ),
        ),
        route('PATCH', `${POOLS}/{pool}/providers/{provider}`, 'iam.workloadIdentityPools.providers.patch', auth(patchProvider)),
        route(
            'GET',
            `${POOLS}/{pool}/providers/{provider}`,
            'iam.workloadIdentityPools.providers.get',
            auth((_request, params) => {
                const { iam } = iamOf(String(params['project']));
                const provider = iam.providers.get(providerKey(params));
                return provider === undefined
                    ? googleError('google/error.not-found', IAM)
                    : jsonResponse({ ...provider, state: iam.deleted.has(providerKey(params)) ? 'DELETED' : 'ACTIVE' });
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
        routes: [...poolRoutes(iamOf), ...accountRoutes(iamOf), ...roleRoutes(iamOf)],
        failure: (mode) => googleFailure(IAM, mode),
        scenarios: {
            /** The `github` pool of the e2e project was deleted (an earlier setup removed): it must be undeleted. */
            poolDeleted: () => {
                const { iam } = iamOf(String(FIXTURE_VALUES['projectId']));
                iam.pools.set('github', 'GitHub Actions');
                iam.deleted.add('github');
            },
            /** M4: the drafts' custom role was deleted with older permissions: it must be undeleted and corrected. */
            roleDeleted: () => {
                const { iam } = iamOf(String(FIXTURE_VALUES['projectId']));
                iam.roles.set('hcmVertexDrafts', { includedPermissions: ['aiplatform.endpoints.get'], deleted: true });
            },
        },
        snapshot: () => ({
            projects: Object.fromEntries(
                [...state.projects].map(([id, iam]) => [
                    id,
                    {
                        accounts: Object.fromEntries(iam.accounts),
                        accountPolicies: Object.fromEntries(iam.accountPolicies),
                        pools: Object.fromEntries(iam.pools),
                        providers: Object.fromEntries(iam.providers),
                        deleted: [...iam.deleted],
                        roles: Object.fromEntries(iam.roles),
                    },
                ]),
            ),
        }),
    };
}
