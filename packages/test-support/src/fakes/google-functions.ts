import { BACKGROUND_FUNCTIONS, CALLABLES, deployedName, HTTP_ENDPOINTS } from '@hcm/shared';

import { FIXTURE_VALUES, fixtureBody } from '../api-fixtures/index.js';
import { authenticated, googleError, googleFailure, type GoogleApi, type GoogleProjects } from './google-common.js';
import { enableService, serviceEnabled, type ServiceUsageState } from './google-services.js';
import { jsonResponse, route, type Route } from './routes.js';
import type { ServiceFake } from './service.js';

/**
 * The server's deployment as the admin's step (d) sees it (`docs/research/M2b-interfaces.md` §3.3 d, §6.1): Cloud
 * Functions v2's list of the project's functions and Cloud Scheduler's jobs (the `scheduler` doctor item). Nothing is
 * deployed in a fresh project, whose Cloud Functions API is still off (403 `SERVICE_DISABLED`); the scenarios
 * `none`, `partial`, `deployed` and `failed` play a deploy.
 */

export const DEPLOYMENTS = ['none', 'partial', 'deployed', 'failed'] as const;

export type Deployment = (typeof DEPLOYMENTS)[number];

export interface DeploymentState {
    deployment: Deployment;
    /** firebase-tools created the `ops.tick` Scheduler job (set by every scenario that deploys). */
    schedulerJob: boolean;
}

const FUNCTIONS: GoogleApi = {
    service: 'cloudfunctions.googleapis.com',
    title: 'Cloud Functions API',
    permission: 'cloudfunctions.functions.list',
};
const SCHEDULER: GoogleApi = {
    service: 'cloudscheduler.googleapis.com',
    title: 'Cloud Scheduler API',
    permission: 'cloudscheduler.jobs.list',
};

/** Every function the backend deploys, by its deployed name (32 today). */
export function registryFunctions(): string[] {
    return [...Object.keys(CALLABLES), ...Object.keys(HTTP_ENDPOINTS), ...Object.keys(BACKGROUND_FUNCTIONS)].map(deployedName);
}

/** The deployed functions and their states: `partial` has a third of them, `failed` all but one `FAILED`. */
function deployedFunctions(deployment: Deployment): readonly (readonly [string, string])[] {
    const names = registryFunctions();
    switch (deployment) {
        case 'none':
            return [];
        case 'partial':
            return names.slice(0, Math.floor(names.length / 3)).map((name) => [name, 'ACTIVE'] as const);
        case 'deployed':
            return names.map((name) => [name, 'ACTIVE'] as const);
        case 'failed':
            return names.map((name, index) => [name, index === 0 ? 'FAILED' : 'ACTIVE'] as const);
    }
}

/** One page of `items` for the request's `pageSize` and `pageToken` (the index of the page's first item). */
function page(items: readonly unknown[], query: URLSearchParams, field: string): Record<string, unknown> {
    const size = Number(query.get('pageSize') ?? items.length);
    const start = Number(query.get('pageToken') ?? 0);
    const next = start + size < items.length ? { nextPageToken: String(start + size) } : {};
    return { [field]: items.slice(start, start + size), ...next };
}

/** The fake Cloud Functions v2 list (needs the API enabled, as Google does). */
export function createCloudFunctionsFake(state: DeploymentState, services: ServiceUsageState, projects: GoogleProjects): ServiceFake {
    const list: Route['answer'] = (request, params) => {
        const project = projects.resolve(String(params['project']));
        if (!serviceEnabled(services, project.id, FUNCTIONS.service)) {
            return googleError('google/error.service-disabled', FUNCTIONS, { projectNumber: project.number });
        }
        const functions = deployedFunctions(state.deployment).map(([functionId, functionState]) =>
            fixtureBody('cloud-functions/function.get', {
                projectId: project.id,
                region: String(params['region']),
                functionId,
                functionState,
            }),
        );
        return jsonResponse(page(functions, request.url.searchParams, 'functions'));
    };
    const scenarios = Object.fromEntries(
        DEPLOYMENTS.map((deployment) => [
            deployment,
            () => {
                state.deployment = deployment;
                state.schedulerJob = deployment === 'deployed' || deployment === 'failed';
                // A deploy enables the API; `none` leaves it as it is (off in a fresh project: 403 SERVICE_DISABLED).
                if (deployment !== 'none') {
                    enableService(services, String(FIXTURE_VALUES['projectId']), FUNCTIONS.service);
                }
            },
        ]),
    );
    return {
        name: 'cloud-functions',
        routes: [
            route(
                'GET',
                'https://cloudfunctions.googleapis.com/v2/projects/{project}/locations/{region}/functions',
                'cloud-functions.list',
                authenticated(FUNCTIONS, list),
            ),
        ],
        failure: (mode) => googleFailure(FUNCTIONS, mode),
        scenarios,
        snapshot: () => ({ deployment: state.deployment }),
    };
}

/** The fake Cloud Scheduler: the `ops.tick` job exists once the server is deployed (firebase-tools creates it). */
export function createCloudSchedulerFake(state: DeploymentState, projects: GoogleProjects): ServiceFake {
    const list: Route['answer'] = (_request, params) => {
        const project = projects.resolve(String(params['project']));
        const jobs = state.schedulerJob
            ? [fixtureBody('cloud-scheduler/job.get', { projectId: project.id, region: String(params['region']) })]
            : [];
        return jsonResponse(jobs.length === 0 ? {} : { jobs });
    };
    return {
        name: 'cloud-scheduler',
        routes: [
            route(
                'GET',
                'https://cloudscheduler.googleapis.com/v1/projects/{project}/locations/{region}/jobs',
                'cloud-scheduler.jobs.list',
                authenticated(SCHEDULER, list),
            ),
        ],
        failure: (mode) => googleFailure(SCHEDULER, mode),
        scenarios: {},
        snapshot: () => ({ schedulerJob: state.schedulerJob }),
    };
}
