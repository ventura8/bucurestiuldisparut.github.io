import { parsePolicy, type PolicyAccess } from './iam-policy.js';
import { asRecord, records, stringAt, type JsonObject } from './json.js';
import { createOnce, type GoogleCall, type GoogleTransport } from './transport.js';

/**
 * IAM v1 for the `service-accounts`, `iam` and `workload-identity` items (`docs/research/M2b-interfaces.md` §3.4):
 * service accounts and their own IAM policies, and the Workload Identity Federation pool and provider the CI deploy
 * signs in through. A second create answers 409, which is success; a deleted pool or provider is undeleted, never
 * recreated (its id stays reserved for 30 days).
 */

const IAM = 'https://iam.googleapis.com/v1';
const ROLE = 'roles/iam.serviceAccountAdmin';
const WIF_ROLE = 'roles/iam.workloadIdentityPoolAdmin';

/** A pool or a provider as Google answers it; `state` is `ACTIVE` or `DELETED`. */
export interface IdentityResource {
    readonly name: string;
    readonly state: string;
    readonly body: JsonObject;
}

export interface IamClient {
    /** The account ids (`fn-admin`) of the project's service accounts. */
    listServiceAccounts(projectId: string): Promise<string[]>;
    /** Creates the account; an existing one is success. */
    createServiceAccount(projectId: string, accountId: string, displayName: string): Promise<void>;
    serviceAccountPolicy(projectId: string, email: string): PolicyAccess;
    getPool(projectNumber: string, poolId: string): Promise<IdentityResource | undefined>;
    createPool(projectNumber: string, poolId: string, body: JsonObject): Promise<void>;
    getProvider(poolName: string, providerId: string): Promise<IdentityResource | undefined>;
    createProvider(poolName: string, providerId: string, body: JsonObject): Promise<void>;
    updateProvider(name: string, body: JsonObject, updateMask: readonly string[]): Promise<void>;
    /** Undeletes a pool or a provider by its resource name. */
    undelete(name: string): Promise<void>;
}

/** `fn-admin@demo-hcm.iam.gserviceaccount.com` */
export function serviceAccountEmail(accountId: string, projectId: string): string {
    return `${accountId}@${projectId}.iam.gserviceaccount.com`;
}

function identityOf(body: unknown): IdentityResource | undefined {
    const name = stringAt(body, 'name');
    return name === undefined ? undefined : { name, state: stringAt(body, 'state') ?? 'ACTIVE', body: asRecord(body) };
}

/** Starts a long-running IAM call and waits for it. */
async function longRunning(transport: GoogleTransport, call: GoogleCall): Promise<void> {
    const request = { ...call, role: WIF_ROLE };
    const started = await transport.call(request);
    await transport.operation(IAM, started, request);
}

async function createServiceAccount(transport: GoogleTransport, projectId: string, accountId: string, displayName: string): Promise<void> {
    await createOnce(transport, {
        operation: 'iam.serviceAccounts.create',
        method: 'POST',
        url: `${IAM}/projects/${projectId}/serviceAccounts`,
        body: { accountId, serviceAccount: { displayName } },
        role: ROLE,
    });
}

function serviceAccountPolicy(transport: GoogleTransport, projectId: string, email: string): PolicyAccess {
    const resource = `${IAM}/projects/${projectId}/serviceAccounts/${email}`;
    return {
        read: async () =>
            parsePolicy(
                await transport.call({ operation: 'iam.serviceAccounts.getIamPolicy', method: 'POST', url: `${resource}:getIamPolicy` }),
            ),
        write: (policy) =>
            transport.call({
                operation: 'iam.serviceAccounts.setIamPolicy',
                method: 'POST',
                url: `${resource}:setIamPolicy`,
                body: { policy },
                role: ROLE,
            }),
    };
}

export function createIamClient(transport: GoogleTransport): IamClient {
    const pools = (projectNumber: string): string => `${IAM}/projects/${projectNumber}/locations/global/workloadIdentityPools`;
    return {
        listServiceAccounts: async (projectId) => {
            const accounts = await transport.pages(
                { operation: 'iam.serviceAccounts.list', url: `${IAM}/projects/${projectId}/serviceAccounts`, query: { pageSize: 100 } },
                'accounts',
            );
            return records(accounts).map((account) => String(account['email']).split('@', 1).join(''));
        },
        createServiceAccount: (projectId, accountId, displayName) => createServiceAccount(transport, projectId, accountId, displayName),
        serviceAccountPolicy: (projectId, email) => serviceAccountPolicy(transport, projectId, email),
        getPool: async (projectNumber, poolId) =>
            identityOf(await transport.find({ operation: 'iam.workloadIdentityPools.get', url: `${pools(projectNumber)}/${poolId}` })),
        createPool: (projectNumber, poolId, body) =>
            longRunning(transport, {
                operation: 'iam.workloadIdentityPools.create',
                method: 'POST',
                url: pools(projectNumber),
                query: { workloadIdentityPoolId: poolId },
                body,
            }),
        getProvider: async (poolName, providerId) =>
            identityOf(
                await transport.find({
                    operation: 'iam.workloadIdentityPools.providers.get',
                    url: `${IAM}/${poolName}/providers/${providerId}`,
                }),
            ),
        createProvider: (poolName, providerId, body) =>
            longRunning(transport, {
                operation: 'iam.workloadIdentityPools.providers.create',
                method: 'POST',
                url: `${IAM}/${poolName}/providers`,
                query: { workloadIdentityPoolProviderId: providerId },
                body,
            }),
        updateProvider: (name, body, updateMask) =>
            longRunning(transport, {
                operation: 'iam.workloadIdentityPools.providers.patch',
                method: 'PATCH',
                url: `${IAM}/${name}`,
                query: { updateMask: updateMask.join(',') },
                body,
            }),
        undelete: (name) =>
            longRunning(transport, {
                operation: 'iam.workloadIdentity.undelete',
                method: 'POST',
                url: `${IAM}/${name}:undelete`,
                body: {},
            }),
    };
}
