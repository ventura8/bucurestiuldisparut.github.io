import { isGoogleFailure } from '../google/failure.js';
import { ensureBindings, missingBindings, type PolicyAccess, type WantedBinding } from '../google/iam-policy.js';
import type { IdentityResource } from '../google/iam.js';
import { matchesSpec, type JsonObject } from '../google/json.js';
import { eachInTurn, lacking, type ProvisionContext, type ProvisionItemSpec } from './item.js';
import { roleTable, type PolicyBindings, type ServiceAgents } from './resources.js';

/**
 * The `iam` item (the role table of `docs/research/M2b-interfaces.md` §3.4.1 on the project, the buckets, the secrets
 * and the service accounts) and the `workload-identity` item (the GitHub pool and its `site-master` provider, whose
 * condition admits only the repository's `master` branch in the `deploy` environment, and the deployer's binding).
 */

/** The service agents by their documented names: the doctor never creates them, the fix does first. */
function conventionalAgents(projectNumber: string): ServiceAgents {
    return {
        firebaseStorage: `service-${projectNumber}@gcp-sa-firebasestorage.iam.gserviceaccount.com`,
        cloudStorage: `service-${projectNumber}@gs-project-accounts.iam.gserviceaccount.com`,
    };
}

function policyAccess(context: ProvisionContext, policy: PolicyBindings): PolicyAccess {
    const { clients, project } = context;
    switch (policy.kind) {
        case 'project':
            return clients.resourceManager.projectPolicy(project.projectId);
        case 'bucket':
            return clients.storage.bucketPolicy(policy.resource);
        case 'secret':
            return clients.secretManager.secretPolicy(project.projectId, policy.resource);
        case 'serviceAccount':
            return clients.iam.serviceAccountPolicy(project.projectId, policy.resource);
    }
}

/** The bindings a policy lacks; a resource that does not exist yet lacks them all. */
async function lackingBindings(access: PolicyAccess, wanted: readonly WantedBinding[]): Promise<readonly WantedBinding[]> {
    try {
        return missingBindings(await access.read(), wanted);
    } catch (error) {
        if (isGoogleFailure(error, 'notFound')) {
            return wanted;
        }
        throw error;
    }
}

/** Creates the service agents first (their bindings name them), then merges every policy's bindings in. */
async function bindAll(context: ProvisionContext): Promise<void> {
    const { clients, project } = context;
    const agents: ServiceAgents = {
        firebaseStorage: await clients.serviceUsage.serviceIdentity(project.projectNumber, 'firebasestorage.googleapis.com'),
        cloudStorage: await clients.storage.serviceAgent(project.projectId),
    };
    const table = roleTable(project, agents, (await context.findings()).noDefaultGrants);
    await eachInTurn(table, (policy) => ensureBindings(policyAccess(context, policy), policy.bindings));
}

const iam: ProvisionItemSpec = {
    id: 'iam',
    after: ['service-accounts', 'buckets', 'secrets', 'org-policies'],
    observe: async (context) => {
        const findings = await context.findings();
        const table = roleTable(context.project, conventionalAgents(context.project.projectNumber), findings.noDefaultGrants);
        const lacks = await Promise.all(
            table.map(async (policy) =>
                (await lackingBindings(policyAccess(context, policy), policy.bindings)).length === 0
                    ? []
                    : [`${policy.kind}:${policy.resource}`],
            ),
        );
        return lacking(lacks.flat(), () => bindAll(context));
    },
};

const POOL_ID = 'github';
const PROVIDER_ID = 'site-master';
const ISSUER = 'https://token.actions.githubusercontent.com';

/** The provider's mapping and condition: only this repository's `master` branch, from the `deploy` environment (§23g). */
function providerSpec({ project }: ProvisionContext): JsonObject {
    const { ownerId, repoId, branch, environment } = project.github;
    return {
        displayName: 'GitHub master deploys',
        attributeMapping: {
            'google.subject': 'assertion.sub',
            'attribute.repository_id': 'assertion.repository_id',
            'attribute.repository_owner_id': 'assertion.repository_owner_id',
            'attribute.ref': 'assertion.ref',
        },
        attributeCondition: [
            `assertion.repository_owner_id=='${String(ownerId)}'`,
            `assertion.repository_id=='${String(repoId)}'`,
            `assertion.ref=='refs/heads/${branch}'`,
            `assertion.environment=='${environment}'`,
        ].join(' && '),
        oidc: { issuerUri: ISSUER },
    };
}

function poolName({ project }: ProvisionContext): string {
    return `projects/${project.projectNumber}/locations/global/workloadIdentityPools/${POOL_ID}`;
}

/** The repository's principal set: who may impersonate the deployer through the pool. */
function deployerBinding(context: ProvisionContext): WantedBinding {
    const member = `principalSet://iam.googleapis.com/${poolName(context)}/attribute.repository_id/${String(context.project.github.repoId)}`;
    return { role: 'roles/iam.workloadIdentityUser', member };
}

/** `create`, `undelete` or `update` for a pool or provider; nothing when it is active and right. */
function identityPart(resource: IdentityResource | undefined, prefix: string, matches: boolean): string[] {
    if (resource === undefined) {
        return [`${prefix}:create`];
    }
    if (resource.state === 'DELETED') {
        return [`${prefix}:undelete`, ...(matches ? [] : [`${prefix}:update`])];
    }
    return matches ? [] : [`${prefix}:update`];
}

/** The steps in the order they must run: the pool before its provider, both before the deployer's binding. */
const IDENTITY_STEP_ORDER = ['pool:create', 'pool:undelete', 'provider:create', 'provider:undelete', 'provider:update', 'binding'] as const;

const IDENTITY_STEPS: Readonly<Record<(typeof IDENTITY_STEP_ORDER)[number], (context: ProvisionContext) => Promise<unknown>>> = {
    'pool:create': (context) =>
        context.clients.iam.createPool(context.project.projectNumber, POOL_ID, {
            displayName: 'GitHub Actions',
            description: 'Keyless deploys of the master branch',
        }),
    'pool:undelete': (context) => context.clients.iam.undelete(poolName(context)),
    'provider:create': (context) => context.clients.iam.createProvider(poolName(context), PROVIDER_ID, providerSpec(context)),
    'provider:undelete': (context) => context.clients.iam.undelete(`${poolName(context)}/providers/${PROVIDER_ID}`),
    'provider:update': (context) =>
        context.clients.iam.updateProvider(`${poolName(context)}/providers/${PROVIDER_ID}`, providerSpec(context), [
            'displayName',
            'attributeMapping',
            'attributeCondition',
            'oidc',
        ]),
    binding: (context) =>
        ensureBindings(context.clients.iam.serviceAccountPolicy(context.project.projectId, context.names.email('gh-deployer')), [
            deployerBinding(context),
        ]),
};

/** What the deploy job's repository variables are (§3.3 d): the provider's resource name and the deployer's address. */
function deployVariables(context: ProvisionContext): Readonly<Record<string, string>> {
    return { provider: `${poolName(context)}/providers/${PROVIDER_ID}`, serviceAccount: context.names.email('gh-deployer') };
}

const workloadIdentity: ProvisionItemSpec = {
    id: 'workload-identity',
    after: ['apis', 'service-accounts'],
    observe: async (context) => {
        const { iam: client } = context.clients;
        const pool = await client.getPool(context.project.projectNumber, POOL_ID);
        const provider = pool === undefined ? undefined : await client.getProvider(pool.name, PROVIDER_ID);
        const deployer = client.serviceAccountPolicy(context.project.projectId, context.names.email('gh-deployer'));
        const binding = await lackingBindings(deployer, [deployerBinding(context)]);
        const lacks = [
            ...identityPart(pool, 'pool', true),
            ...identityPart(provider, 'provider', matchesSpec(provider?.body, providerSpec(context))),
            ...(binding.length === 0 ? [] : ['binding']),
        ];
        const steps = IDENTITY_STEP_ORDER.filter((step) => lacks.includes(step));
        return lacking(lacks, () => eachInTurn(steps, (step) => IDENTITY_STEPS[step](context)), deployVariables(context));
    },
};

export const IAM_ITEMS: readonly ProvisionItemSpec[] = [iam, workloadIdentity];
