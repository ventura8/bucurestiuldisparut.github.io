import { FIXTURE_VALUES, fixtureBody, fixtureResponse } from '../api-fixtures/index.js';
import { billingEnabled, type BillingState } from './google-billing.js';
import { authenticated, googleError, googleFailure, type GoogleApi, type GoogleProjects } from './google-common.js';
import { bodyField, jsonResponse, route, type Route } from './routes.js';
import { sequence, type ServiceFake } from './service.js';

/**
 * Service Usage v1 (the Provision cloud step's `apis` item): which APIs a project has enabled, `batchEnable` and
 * `enable` (done at once; the operation reads back as done), and the billing precondition: enabling a billed API on a
 * project without billing answers 400 `UREQ_PROJECT_BILLING_NOT_FOUND`, as Google does on Spark.
 */

/** What a new Firebase project (Spark) has enabled. */
export const SPARK_SERVICES: readonly string[] = [
    'cloudresourcemanager.googleapis.com',
    'firebase.googleapis.com',
    'firebasehosting.googleapis.com',
    'firebaserules.googleapis.com',
    'firestore.googleapis.com',
    'identitytoolkit.googleapis.com',
    'serviceusage.googleapis.com',
];

/** APIs Google enables only on a project with billing (the ones the provisioner needs; the list is not exhaustive). */
export const BILLED_SERVICES: readonly string[] = [
    'artifactregistry.googleapis.com',
    'cloudbuild.googleapis.com',
    'cloudfunctions.googleapis.com',
    'cloudscheduler.googleapis.com',
    'cloudtasks.googleapis.com',
    'eventarc.googleapis.com',
    'run.googleapis.com',
    'secretmanager.googleapis.com',
];

export interface ServiceUsageState {
    /** Project id → enabled API names. A project not listed has `SPARK_SERVICES`. */
    readonly enabled: Map<string, Set<string>>;
}

/** Whether `service` is enabled in the project (a project never seen has `SPARK_SERVICES`). */
export function serviceEnabled(state: ServiceUsageState, projectId: string, service: string): boolean {
    return (state.enabled.get(projectId) ?? new Set(SPARK_SERVICES)).has(service);
}

/** Enables `service` in the project, as a deploy or an earlier step would. */
export function enableService(state: ServiceUsageState, projectId: string, service: string): void {
    const enabled = state.enabled.get(projectId) ?? new Set(SPARK_SERVICES);
    enabled.add(service);
    state.enabled.set(projectId, enabled);
}

const SERVICE_USAGE: GoogleApi = {
    service: 'serviceusage.googleapis.com',
    title: 'Service Usage API',
    permission: 'serviceusage.services.enable',
};

function stringList(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/** v1beta1 `generateServiceIdentity`: the service agent's address, done at once. */
function identityRoute(projects: GoogleProjects, nextOperation: () => string): Route {
    return route(
        'POST',
        'https://serviceusage.googleapis.com/v1beta1/projects/{project}/services/{service}:generateServiceIdentity',
        'service-usage.generateServiceIdentity',
        authenticated(SERVICE_USAGE, (_request, params) => {
            const project = projects.resolve(String(params['project']));
            const service = String(params['service']);
            return fixtureResponse('service-usage/generate-service-identity.operation', {
                values: {
                    projectNumber: project.number,
                    serviceAgent: service.replace(/\.googleapis\.com$/, ''),
                    operationId: nextOperation(),
                },
            });
        }),
    );
}

/** The fake Service Usage API; `billing` decides the billing precondition. */
export function createServiceUsageFake(state: ServiceUsageState, billing: BillingState, projects: GoogleProjects): ServiceFake {
    const nextOperation = sequence('e2e-enable-');
    const operations = new Map<string, { readonly project: string; readonly services: readonly string[] }>();
    const enabledOf = (projectId: string): Set<string> => {
        const existing = state.enabled.get(projectId);
        if (existing !== undefined) {
            return existing;
        }
        const created = new Set(SPARK_SERVICES);
        state.enabled.set(projectId, created);
        return created;
    };
    const serviceBody = (projectSegment: string, service: string): Readonly<Record<string, unknown>> => {
        const project = projects.resolve(projectSegment);
        const name = enabledOf(project.id).has(service) ? 'service-usage/service.enabled' : 'service-usage/service.disabled';
        return fixtureBody(name, { projectNumber: project.number, service, serviceTitle: service }) as Readonly<Record<string, unknown>>;
    };
    const enable = (projectSegment: string, services: readonly string[]): Response => {
        const project = projects.resolve(projectSegment);
        if (services.length === 0) {
            return googleError('google/error.invalid-argument', SERVICE_USAGE);
        }
        const billed = services.filter((service) => BILLED_SERVICES.includes(service));
        if (billed.length > 0 && !billingEnabled(billing, project.id)) {
            return fixtureResponse('service-usage/enable.billing-required', {
                values: { projectNumber: project.number, service: billed.join(',') },
            });
        }
        services.forEach((service) => enabledOf(project.id).add(service));
        const name = `operations/acat.p2-${project.number}-${nextOperation()}`;
        operations.set(name, { project: project.id, services });
        return jsonResponse({
            name,
            done: true,
            response: { '@type': 'type.googleapis.com/google.api.serviceusage.v1.BatchEnableServicesResponse' },
        });
    };
    const operation: Route['answer'] = (_request, params) => {
        const name = `operations/${String(params['operation'])}`;
        const found = operations.get(name);
        if (found === undefined) {
            return googleError('google/error.not-found', SERVICE_USAGE);
        }
        const body = fixtureBody('service-usage/operation.done', { operationName: name }) as { response: Record<string, unknown> };
        return jsonResponse({
            ...body,
            response: { ...body.response, services: found.services.map((service) => serviceBody(found.project, service)) },
        });
    };
    const base = 'https://serviceusage.googleapis.com/v1/projects/{project}/services';
    const auth = (answer: Route['answer']): Route['answer'] => authenticated(SERVICE_USAGE, answer);
    return {
        name: 'service-usage',
        routes: [
            route(
                'POST',
                `${base}:batchEnable`,
                'service-usage.batchEnable',
                auth((request, params) => enable(String(params['project']), stringList(bodyField(request, 'serviceIds')))),
            ),
            route(
                'POST',
                `${base}/{service}:enable`,
                'service-usage.enable',
                auth((_request, params) => enable(String(params['project']), [String(params['service'])])),
            ),
            route(
                'POST',
                `${base}/{service}:disable`,
                'service-usage.disable',
                auth((_request, params) => {
                    enabledOf(projects.resolve(String(params['project'])).id).delete(String(params['service']));
                    return jsonResponse({ name: `operations/acf.p2-${nextOperation()}`, done: true, response: {} });
                }),
            ),
            route(
                'GET',
                `${base}/{service}`,
                'service-usage.get',
                auth((_request, params) => jsonResponse(serviceBody(String(params['project']), String(params['service'])))),
            ),
            route(
                'GET',
                base,
                'service-usage.list',
                auth((_request, params) => {
                    const project = projects.resolve(String(params['project']));
                    return jsonResponse({
                        services: [...enabledOf(project.id)]
                            .sort((left, right) => left.localeCompare(right))
                            .map((service) => serviceBody(project.id, service)),
                    });
                }),
            ),
            route('GET', 'https://serviceusage.googleapis.com/v1/operations/{operation*}', 'service-usage.getOperation', auth(operation)),
            identityRoute(projects, nextOperation),
        ],
        failure: (mode) => googleFailure(SERVICE_USAGE, mode),
        scenarios: {
            allEnabled: () => {
                enabledOf(String(FIXTURE_VALUES['projectId']));
                state.enabled.forEach((services) => {
                    BILLED_SERVICES.forEach((service) => services.add(service));
                });
            },
        },
        snapshot: () => ({
            enabled: Object.fromEntries(
                [...state.enabled].map(([project, services]) => [project, [...services].sort((left, right) => left.localeCompare(right))]),
            ),
        }),
    };
}
