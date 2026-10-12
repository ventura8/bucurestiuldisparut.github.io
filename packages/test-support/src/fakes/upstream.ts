import { FIXTURE_VALUES } from '../api-fixtures/index.js';
import { createFakeFetch, type FakeAnswer, type FakeFetch, type UpstreamRequest } from './fetch.js';
import { createBillingBudgetsFake, createCloudBillingFake, defaultBillingState, type BillingState } from './google-billing.js';
import { GoogleProjects } from './google-common.js';
import { createErrorReportingFake, type ErrorReportingState } from './google-errors.js';
import { createFirebaseManagementFake, type FirebaseState } from './google-firebase.js';
import { createIamFake, type IamState } from './google-iam.js';
import {
    createGoogleOauthFake,
    createResourceManagerFake,
    defaultIdentityState,
    type IdentityState,
    type ResourceManagerState,
} from './google-identity.js';
import { createCloudRunFake, type CloudRunState } from './google-run.js';
import { createSecretManagerFake, latestSecretValue, type SecretsState } from './google-secrets.js';
import { createServiceUsageFake, type ServiceUsageState } from './google-services.js';
import { createCloudStorageFake, type CloudStorageState } from './google-storage.js';
import { createCloudTasksFake, type CloudTasksState } from './google-tasks.js';
import { defaultMapboxState, type MapboxState } from './mapbox-state.js';
import { createMapboxFake } from './mapbox.js';
import { createNominatimFake } from './nominatim.js';
import { matchRoute } from './routes.js';
import { FAILURE_MODES, type FailureMode, type ServiceFake, type UpstreamServiceName } from './service.js';
import { createUsgsFake, defaultUsgsState, type UsgsState } from './usgs.js';

/**
 * Every fake upstream in one place (docs/research/M2-interfaces.md §7): Google Cloud (OAuth tokeninfo, Resource Manager,
 * IAM, Cloud Billing, Billing Budgets, Service Usage, Firebase Management, Secret Manager, Cloud Run Admin, Cloud Tasks,
 * the Cloud Storage bucket API, Error Reporting), Mapbox, USGS M2M and Nominatim, answering from the shared fixtures
 * with state a test can read and change. One instance is one world: a fresh Firebase project on Spark (one open
 * billing account, not linked; one web app; nothing provisioned), the Mapbox accounts of `MAPBOX_TOKENS`, the USGS
 * users of `USGS_CREDENTIALS`. Tests change it through `scenario(name)`, `fail(service, mode)` or `state` directly.
 */

export interface UpstreamState {
    readonly identity: IdentityState;
    readonly resourceManager: ResourceManagerState;
    readonly iam: IamState;
    readonly billing: BillingState;
    readonly serviceUsage: ServiceUsageState;
    readonly firebase: FirebaseState;
    readonly secrets: SecretsState;
    readonly cloudRun: CloudRunState;
    readonly cloudTasks: CloudTasksState;
    readonly cloudStorage: CloudStorageState;
    readonly errorReporting: ErrorReportingState;
    readonly mapbox: MapboxState;
    readonly usgs: UsgsState;
}

export interface UpstreamFakes extends FakeFetch {
    readonly state: UpstreamState;
    /** Every call of `service` answers `mode` until `fail(service, null)`. */
    fail(service: UpstreamServiceName, mode: FailureMode | null): void;
    /** Applies a named scenario (`usgs.m2mApproved`, `google.provisioned`); throws for an unknown name. */
    scenario(name: string): void;
    /** Every scenario name, sorted. */
    readonly scenarioNames: readonly string[];
    /** The state of every service as plain JSON (`/__upstream/snapshot`). */
    snapshot(): Readonly<Record<string, unknown>>;
    /** The latest value of a Secret Manager secret of `projectId` (default `demo-hcm`). */
    secretValue(secretId: string, projectId?: string): string | undefined;
}

/** Scenarios that span services: each runs the listed service scenarios in order. */
const PRESETS: Readonly<Record<string, readonly string[]>> = {
    /** Everything the Provision cloud step creates, on Blaze. */
    'google.provisioned': [
        'cloud-billing.enabled',
        'service-usage.allEnabled',
        'secret-manager.provisioned',
        'cloud-storage.bucketsProvisioned',
        'cloud-tasks.queueProvisioned',
        'cloud-run.jobProvisioned',
    ],
};

function initialState(): UpstreamState {
    return {
        identity: defaultIdentityState(),
        resourceManager: { policies: new Map(), allowedMemberDomains: undefined },
        iam: { projects: new Map() },
        billing: defaultBillingState(),
        serviceUsage: { enabled: new Map() },
        firebase: { projects: new Map() },
        secrets: { projects: new Map() },
        cloudRun: { jobs: new Set(), executions: new Map() },
        cloudTasks: { queues: new Map() },
        cloudStorage: { buckets: new Map(), publicAccessPrevented: false },
        errorReporting: { groups: new Map() },
        mapbox: defaultMapboxState(),
        usgs: defaultUsgsState(),
    };
}

function services(state: UpstreamState): readonly ServiceFake[] {
    const projects = new GoogleProjects();
    return [
        createGoogleOauthFake(state.identity),
        createResourceManagerFake(state.identity, state.resourceManager, projects),
        createIamFake(state.iam, projects),
        createCloudBillingFake(state.billing, projects),
        createBillingBudgetsFake(state.billing),
        createServiceUsageFake(state.serviceUsage, state.billing, projects),
        createFirebaseManagementFake(state.firebase, projects),
        createSecretManagerFake(state.secrets, projects),
        createCloudRunFake(state.cloudRun, projects),
        createCloudTasksFake(state.cloudTasks, projects),
        createCloudStorageFake(state.cloudStorage, projects),
        createErrorReportingFake(state.errorReporting, projects),
        createMapboxFake(state.mapbox),
        createUsgsFake(state.usgs),
        createNominatimFake(),
    ];
}

function scenarioTable(fakes: readonly ServiceFake[]): Map<string, () => void> {
    const table = new Map<string, () => void>();
    for (const fake of fakes) {
        for (const [name, apply] of Object.entries(fake.scenarios)) {
            table.set(`${fake.name}.${name}`, apply);
        }
    }
    for (const [name, steps] of Object.entries(PRESETS)) {
        table.set(name, () => {
            steps.forEach((step) => table.get(step)?.());
        });
    }
    return table;
}

/** Throws unless `service` exists and has failure `mode` (`null` clears, always allowed for a known service). */
function checkFailure(fakes: readonly ServiceFake[], service: UpstreamServiceName, mode: FailureMode | null): void {
    const fake = fakes.find((candidate) => candidate.name === service);
    if (fake === undefined) {
        throw new Error(`unknown upstream service ${service}`);
    }
    if (mode !== null && (!FAILURE_MODES.includes(mode) || fake.failure(mode) === undefined)) {
        throw new Error(`${service} has no failure mode ${mode}`);
    }
}

/** Every host a fake answers (the e2e admin tier forwards these to the mock APIs). */
export function upstreamHosts(): readonly string[] {
    return [...new Set(services(initialState()).flatMap((fake) => fake.routes.map((candidate) => candidate.host)))].sort((left, right) =>
        left.localeCompare(right),
    );
}

/** A fresh world of fake upstreams with its recording `fetch`. */
export function createUpstreamFakes(): UpstreamFakes {
    const state = initialState();
    const fakes = services(state);
    const failures = new Map<UpstreamServiceName, FailureMode>();
    const scenarios = scenarioTable(fakes);
    const handle = async (request: UpstreamRequest): Promise<FakeAnswer | undefined> => {
        for (const fake of fakes) {
            const found = matchRoute(fake.routes, request);
            if (found !== undefined) {
                const mode = failures.get(fake.name);
                const failed = mode === undefined ? undefined : fake.failure(mode);
                return { operation: found.route.operation, response: failed ?? (await found.route.answer(request, found.params)) };
            }
        }
        return undefined;
    };
    const fetchFake = createFakeFetch(handle);
    return {
        ...fetchFake,
        state,
        fail: (service, mode) => {
            checkFailure(fakes, service, mode);
            if (mode === null) {
                failures.delete(service);
            } else {
                failures.set(service, mode);
            }
        },
        scenario: (name) => {
            const apply = scenarios.get(name);
            if (apply === undefined) {
                throw new Error(`unknown upstream scenario ${name}`);
            }
            apply();
        },
        scenarioNames: [...scenarios.keys()].sort((left, right) => left.localeCompare(right)),
        snapshot: () => Object.fromEntries(fakes.map((fake) => [fake.name, fake.snapshot()])),
        secretValue: (secretId, projectId = String(FIXTURE_VALUES['projectId'])) => latestSecretValue(state.secrets, projectId, secretId),
    };
}
