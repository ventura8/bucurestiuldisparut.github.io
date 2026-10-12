import { FIXTURE_VALUES, fixtureBody, fixtureResponse, type FixtureName } from '../api-fixtures/index.js';
import { authenticated, googleError, googleFailure, type GoogleApi, type GoogleProjects } from './google-common.js';
import { bodyField, jsonResponse, route, type Route, type RouteParams } from './routes.js';
import { sequence, type ServiceFake } from './service.js';

/**
 * Cloud Run Admin API v2 for the raster pipeline's executions (`CloudRunJobs`, security review §4.1; the adapter comes
 * with M3): `jobs/{job}:run` with container env overrides, executions that stay running until a scenario finishes
 * them, and `:cancel`. A job must be provisioned first (`cloud-run.jobProvisioned`).
 */

type ExecutionState = 'running' | 'succeeded' | 'failed' | 'cancelled';

interface Execution {
    readonly projectId: string;
    readonly region: string;
    readonly job: string;
    readonly id: string;
    /** The env overrides of the run request (`HCM_JOB_ID`, ...). */
    readonly env: Readonly<Record<string, string>>;
    state: ExecutionState;
}

export interface CloudRunState {
    /** `<project>/<region>/<job>` of every job that exists. */
    readonly jobs: Set<string>;
    /** Execution name → execution. */
    readonly executions: Map<string, Execution>;
}

const CLOUD_RUN: GoogleApi = { service: 'run.googleapis.com', title: 'Cloud Run Admin API', permission: 'run.jobs.run' };

const STATE_FIXTURES: Readonly<Record<ExecutionState, FixtureName>> = {
    running: 'cloud-run/execution.running',
    succeeded: 'cloud-run/execution.succeeded',
    failed: 'cloud-run/execution.failed',
    cancelled: 'cloud-run/execution.cancelled',
};

/** The env overrides of a run request (`overrides.containerOverrides[].env[]`). */
function envOf(overrides: unknown): Record<string, string> {
    const containers = (overrides as { containerOverrides?: unknown } | undefined)?.containerOverrides;
    const entries = (Array.isArray(containers) ? (containers as { env?: unknown }[]) : []).flatMap((container) =>
        Array.isArray(container.env) ? (container.env as { name?: unknown; value?: unknown }[]) : [],
    );
    return Object.fromEntries(
        entries
            .filter((entry) => typeof entry.name === 'string')
            .map((entry) => [String(entry.name), typeof entry.value === 'string' ? entry.value : '']),
    );
}

function executionValues(execution: Execution): Record<string, string> {
    return { projectId: execution.projectId, region: execution.region, job: execution.job, execution: execution.id };
}

/** The fake Cloud Run Admin API. */
export function createCloudRunFake(state: CloudRunState, projects: GoogleProjects): ServiceFake {
    const nextExecution = sequence('e2e', 2);
    const nextOperation = sequence('e2e-run-op-');
    const jobKey = (params: RouteParams): string =>
        `${projects.resolve(String(params['project'])).id}/${String(params['region'])}/${String(params['job'])}`;
    const executionName = (params: RouteParams): string =>
        `projects/${projects.resolve(String(params['project'])).id}/locations/${String(params['region'])}/jobs/${String(params['job'])}/executions/${String(params['execution'])}`;
    const operation = (execution: Execution, done: boolean): Response => {
        const values = { ...executionValues(execution), operationId: nextOperation() };
        const body = fixtureBody('cloud-run/jobs.run.operation', values) as Record<string, unknown>;
        return jsonResponse({ ...body, done });
    };
    const run: Route['answer'] = (request, params) => {
        if (!state.jobs.has(jobKey(params))) {
            return fixtureResponse('cloud-run/job.not-found', {
                values: {
                    projectId: projects.resolve(String(params['project'])).id,
                    region: String(params['region']),
                    job: String(params['job']),
                },
            });
        }
        const execution: Execution = {
            projectId: projects.resolve(String(params['project'])).id,
            region: String(params['region']),
            job: String(params['job']),
            id: `${String(params['job'])}-${nextExecution()}`,
            env: envOf(bodyField(request, 'overrides')),
            state: 'running',
        };
        state.executions.set(
            `projects/${execution.projectId}/locations/${execution.region}/jobs/${execution.job}/executions/${execution.id}`,
            execution,
        );
        return operation(execution, false);
    };
    const withExecution = (params: RouteParams, answer: (execution: Execution) => Response): Response => {
        const execution = state.executions.get(executionName(params));
        return execution === undefined ? googleError('google/error.not-found', CLOUD_RUN) : answer(execution);
    };
    const finish = (target: ExecutionState): void => {
        state.executions.forEach((execution) => {
            if (execution.state === 'running') {
                execution.state = target;
            }
        });
    };
    const base = 'https://run.googleapis.com/v2/projects/{project}/locations/{region}/jobs';
    const auth = (answer: Route['answer']): Route['answer'] => authenticated(CLOUD_RUN, answer);
    return {
        name: 'cloud-run',
        routes: [
            route('POST', `${base}/{job}:run`, 'cloud-run.jobs.run', auth(run)),
            route(
                'POST',
                `${base}/{job}/executions/{execution}:cancel`,
                'cloud-run.executions.cancel',
                auth((_request, params) =>
                    withExecution(params, (execution) => {
                        execution.state = execution.state === 'running' ? 'cancelled' : execution.state;
                        return operation(execution, false);
                    }),
                ),
            ),
            route(
                'GET',
                `${base}/{job}/executions/{execution}`,
                'cloud-run.executions.get',
                auth((_request, params) =>
                    withExecution(params, (execution) =>
                        fixtureResponse(STATE_FIXTURES[execution.state], { values: executionValues(execution) }),
                    ),
                ),
            ),
            route(
                'GET',
                `${base}/{job}`,
                'cloud-run.jobs.get',
                auth((_request, params) =>
                    state.jobs.has(jobKey(params))
                        ? jsonResponse({
                              name: `projects/${projects.resolve(String(params['project'])).id}/locations/${String(params['region'])}/jobs/${String(params['job'])}`,
                          })
                        : googleError('google/error.not-found', CLOUD_RUN),
                ),
            ),
        ],
        failure: (mode) => googleFailure(CLOUD_RUN, mode),
        scenarios: {
            jobProvisioned: () => {
                state.jobs.add(
                    `${String(FIXTURE_VALUES['projectId'])}/${String(FIXTURE_VALUES['region'])}/${String(FIXTURE_VALUES['job'])}`,
                );
            },
            executionsSucceed: () => {
                finish('succeeded');
            },
            executionsFail: () => {
                finish('failed');
            },
        },
        snapshot: () => ({
            jobs: [...state.jobs].sort((left, right) => left.localeCompare(right)),
            executions: Object.fromEntries(state.executions),
        }),
    };
}
