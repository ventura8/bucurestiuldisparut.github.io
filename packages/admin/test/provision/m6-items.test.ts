import { GOOGLE_TOKENS } from '@hcm/test-support/fakes';
import { describe, expect, it } from 'vitest';

import { createGoogleClients } from '../../src/google/clients.js';
import { createApiWaits, withApiPropagation, API_PROPAGATION_RETRY_MS } from '../../src/google/transport.js';
import { applyProvision, doctorProvision, planProvision, type ProvisionItemResult } from '../../src/provision/provisioner.js';
import { provisionWorld, writes, type ProvisionWorld } from './world.js';

/**
 * What Prepare the project adds in M6 (`docs/research/M6-interfaces.md` §1.2, §1.5, §1.6; findings 4, 12 and 17 of
 * `docs/research/manual-test-2026-10-25.md`): the pipeline's repository (the 16th item), the installer's account and
 * roles, `roles/run.invoker` for the function accounts, the Eventarc and Pub/Sub service identities before the role
 * table, and the wait for an API Google is still switching on.
 */

function only(items: readonly ProvisionItemResult[], ...ids: readonly string[]): ProvisionItemResult[] {
    return items.filter((item) => ids.includes(item.id));
}

/** The world's deps with clients that wait out propagation, and every line the run reported. */
function propagating(world: ProvisionWorld, slept: number[]) {
    const waits = createApiWaits();
    const clients = createGoogleClients(
        withApiPropagation(
            {
                fetch: world.fakes.fetch,
                token: () => GOOGLE_TOKENS.owner,
                sleep: (ms) => {
                    slept.push(ms);
                    return Promise.resolve();
                },
                log: world.log,
            },
            world.deps.project.projectNumber,
            waits,
        ),
    );
    return { ...world.deps, clients, waits };
}

const PREFIX = ['apis', 'service-accounts'] as const;

describe('the pipeline repository (the artifact-registry item)', () => {
    it('happyPath_theDockerRepositoryHcmIsCreatedOnceWithItsCleanupPolicy', async () => {
        const world = provisionWorld();

        const doctor = await doctorProvision(world.deps, ['artifact-registry']);
        const report = await applyProvision(planProvision(null, ['apis', 'artifact-registry']), world.deps);
        const again = await applyProvision(planProvision(null, ['artifact-registry']), world.deps);

        expect(doctor.items).toEqual([{ id: 'artifact-registry', state: 'missing' }]);
        expect(only(report.items, 'artifact-registry')).toEqual([{ id: 'artifact-registry', state: 'ok' }]);
        expect(again.items).toEqual([{ id: 'artifact-registry', state: 'ok' }]);
        expect(world.fakes.callsTo('artifact-registry.repositories.create')).toHaveLength(1);
        const repository = world.fakes.state.artifactRegistry.repositories.get('demo-hcm/us-central1/hcm');
        expect(repository).toMatchObject({
            name: 'projects/demo-hcm/locations/us-central1/repositories/hcm',
            format: 'DOCKER',
            cleanupPolicies: { 'keep-two-newest': { action: 'KEEP', mostRecentVersions: { keepCount: 2 } } },
        });
    });

    it('badPath_anOutageLeavesTheRepositoryUnavailableAndThePermissionsWaiting', async () => {
        const world = provisionWorld();
        await world.createBudget();
        world.fakes.fail('artifact-registry', 'unavailable');

        const report = await applyProvision(planProvision(null), world.deps);

        expect(only(report.items, 'artifact-registry', 'iam')).toEqual([
            { id: 'iam', state: 'pending', params: { item: 'artifact-registry' } },
            { id: 'artifact-registry', state: 'unavailable', detail: 'apiError.unavailable' },
        ]);
    });
});

describe('the installer, the invokers and the service agents (the iam item)', () => {
    it('happyPath_aFreshProjectGetsTheInstallerTheInvokersAndTheAgentsBeforeTheTable @S-A04-HAPPY-INSTALLER-ACCOUNT', async () => {
        const world = provisionWorld();
        await world.createBudget();

        const report = await applyProvision(planProvision(null), world.deps);
        const firstWrites = writes(world.fakes).length;
        const again = await applyProvision(planProvision(null), world.deps);

        expect(report.items.filter((item) => item.state !== 'ok').map((item) => item.id)).toEqual(['scheduler']);
        expect(report.items).toHaveLength(16);
        expect(world.fakes.state.iam.projects.get('demo-hcm')?.accounts.has('hcm-installer')).toBe(true);
        expect(world.fakes.state.iam.projects.get('demo-hcm')?.roles.get('hcmInstaller')?.includedPermissions).toEqual([
            'run.services.get',
            'run.services.getIamPolicy',
            'run.services.setIamPolicy',
            'run.jobs.create',
            'run.jobs.get',
            'run.jobs.update',
            'run.operations.get',
            'resourcemanager.projects.getIamPolicy',
            'artifactregistry.repositories.get',
            'artifactregistry.repositories.update',
        ]);
        const project = JSON.stringify(world.fakes.snapshot()['resource-manager']);
        expect(project).toContain(
            '"role":"roles/run.invoker","members":["serviceAccount:fn-admin@demo-hcm.iam.gserviceaccount.com","serviceAccount:fn-events@demo-hcm.iam.gserviceaccount.com"]',
        );
        expect(project).toContain('projects/demo-hcm/roles/hcmInstaller');
        expect(project).toContain('service-123456789012@gcp-sa-pubsub.iam.gserviceaccount.com');
        expect(JSON.stringify(world.fakes.state.artifactRegistry.policies.snapshot())).toContain(
            '"role":"roles/artifactregistry.writer","members":["serviceAccount:hcm-installer@demo-hcm.iam.gserviceaccount.com"]',
        );
        // The service identities first: Eventarc's and Pub/Sub's agents exist before any binding names them (finding 12).
        const operations = world.fakes.calls.map((call) => `${call.operation} ${call.url}`);
        const identity = (service: string): number => operations.findIndex((call) => call.includes(`${service}:generateServiceIdentity`));
        const firstPolicyWrite = operations.findIndex((call) => call.startsWith('resource-manager.setIamPolicy'));
        expect(identity('eventarc.googleapis.com')).toBeGreaterThan(-1);
        expect(identity('pubsub.googleapis.com')).toBeGreaterThan(-1);
        expect(identity('eventarc.googleapis.com')).toBeLessThan(firstPolicyWrite);
        expect(identity('pubsub.googleapis.com')).toBeLessThan(firstPolicyWrite);
        // A second run writes nothing.
        expect(again.items.filter((item) => item.state !== 'ok').map((item) => item.id)).toEqual(['scheduler']);
        expect(writes(world.fakes)).toHaveLength(firstWrites);
    });

    it('badPath_aRefusedEventarcIdentityNamesItsRoleAndTheOtherItemsAreProvisioned @S-A04-BAD-IDENTITY-REFUSED', async () => {
        const world = provisionWorld();
        await world.createBudget();
        world.fakes.scenario('service-usage.identityRefused');

        const report = await applyProvision(planProvision(null), world.deps);

        expect(only(report.items, 'iam')).toEqual([
            { id: 'iam', state: 'invalid', detail: 'apiError.cloud.permission', params: { role: 'roles/serviceusage.serviceUsageAdmin' } },
        ]);
        const fine = ['apis', 'service-accounts', 'buckets', 'artifact-registry', 'secrets', 'app-check', 'api-key'];
        expect(only(report.items, ...fine).map((item) => [item.id, item.state])).toEqual(
            report.items.filter((item) => fine.includes(item.id)).map((item) => [item.id, 'ok']),
        );
        expect(world.fakes.callsTo('resource-manager.setIamPolicy')).toEqual([]);
    });

    it('happyPath_theComputeDefaultAccountIsBoundOnlyWhenTheProjectHasOne', async () => {
        const world = provisionWorld();
        await applyProvision(
            planProvision(null, ['apis', 'service-accounts', 'buckets', 'artifact-registry', 'secrets', 'org-policies', 'iam']),
            world.deps,
        );
        const compute = 'serviceAccount:123456789012-compute@developer.gserviceaccount.com';
        const computeRoles = (): string[] =>
            (world.fakes.state.resourceManager.policies.get('demo-hcm')?.bindings ?? [])
                .filter((binding) => binding.members.includes(compute))
                .map((binding) => binding.role);
        // The fake project's compute account keeps only its Editor role while the project has no such account to bind.
        expect(computeRoles()).toEqual(['roles/editor']);

        world.fakes.state.iam.projects.get('demo-hcm')?.accounts.set('123456789012-compute', 'Compute Engine default service account');
        const doctor = await doctorProvision(world.deps, ['iam']);
        const report = await applyProvision(planProvision(null, ['iam']), world.deps);

        expect(doctor.items).toEqual([{ id: 'iam', state: 'missing' }]);
        expect(report.items).toEqual([{ id: 'iam', state: 'ok' }]);
        expect(computeRoles()).toEqual(['roles/editor', 'roles/run.invoker', 'roles/eventarc.eventReceiver']);
    });
});

describe('an API Google is still switching on (finding 4)', () => {
    it('happyPath_theItemWaitsForGoogleOnTheClockAndSettlesWithNoClick @S-A04-HAPPY-API-PROPAGATION', async () => {
        const world = provisionWorld();
        world.fakes.scenario('service-usage.propagation');
        const slept: number[] = [];
        const heard: ProvisionItemResult[] = [];

        const report = await applyProvision(planProvision(null, [...PREFIX]), propagating(world, slept), (item) => heard.push(item));

        expect(report.items).toEqual([
            { id: 'apis', state: 'ok' },
            { id: 'service-accounts', state: 'ok' },
        ]);
        expect(slept).toEqual(API_PROPAGATION_RETRY_MS.slice(0, 3));
        const waiting = {
            id: 'service-accounts',
            state: 'pending',
            detail: 'adminSetup.provision.apiWaiting',
            params: { api: 'iam.googleapis.com' },
        };
        expect(heard).toEqual([{ id: 'apis', state: 'ok' }, waiting, waiting, waiting, { id: 'service-accounts', state: 'ok' }]);
        expect(world.fakes.state.iam.projects.get('demo-hcm')?.accounts.has('fn-admin')).toBe(true);
        // Service Usage was asked once whether the API is on at all.
        expect(world.fakes.callsTo('service-usage.get')).toHaveLength(1);
    });

    it('badPath_anApiStillOffAfterAboutThreeMinutesIsMissingWithItsNameAndARetryFinishes @S-A04-BAD-API-STILL-DISABLED', async () => {
        const world = provisionWorld();
        world.fakes.scenario('service-usage.propagationSlow');
        const slept: number[] = [];
        const deps = propagating(world, slept);

        const report = await applyProvision(planProvision(null, [...PREFIX, 'iam', 'workload-identity']), deps);
        const waited = [...slept];
        const retried = await applyProvision(planProvision(report.items), deps);

        expect(waited).toEqual(API_PROPAGATION_RETRY_MS);
        expect(waited.reduce((total, ms) => total + ms, 0)).toBe(190_000);
        expect(only(report.items, 'service-accounts', 'iam', 'workload-identity')).toEqual([
            { id: 'service-accounts', state: 'missing', detail: 'apiError.cloud.apiPropagation', params: { api: 'iam.googleapis.com' } },
            { id: 'iam', state: 'pending', params: { item: 'service-accounts' } },
            { id: 'workload-identity', state: 'pending', params: { item: 'service-accounts' } },
        ]);
        expect(only(retried.items, 'service-accounts', 'workload-identity')).toEqual([
            { id: 'service-accounts', state: 'ok' },
            expect.objectContaining({ id: 'workload-identity', state: 'ok' }),
        ]);
    });

    it('badPath_anApiServiceUsageReportsOffIsNotWaitedFor', async () => {
        // Nobody enabled IAM (the apis item did not run): its SERVICE_DISABLED is the truth, not a propagation.
        const world = provisionWorld();
        world.fakes.fail('iam', 'apiDisabled');
        const slept: number[] = [];

        const report = await applyProvision(planProvision(null, ['service-accounts']), propagating(world, slept));

        expect(slept).toEqual([]);
        expect(only(report.items, 'service-accounts')).toEqual([
            { id: 'service-accounts', state: 'missing', detail: 'apiError.cloud.apiDisabled', params: { api: 'iam.googleapis.com' } },
        ]);
    });

    it('badPath_withoutTheWaitsTheTransportFailsAtOnceAsBefore', async () => {
        const world = provisionWorld();
        world.fakes.scenario('service-usage.propagation');

        const report = await applyProvision(planProvision(null, [...PREFIX]), world.deps);

        expect(only(report.items, 'service-accounts')).toEqual([
            { id: 'service-accounts', state: 'missing', detail: 'apiError.cloud.apiDisabled', params: { api: 'iam.googleapis.com' } },
        ]);
    });
});
