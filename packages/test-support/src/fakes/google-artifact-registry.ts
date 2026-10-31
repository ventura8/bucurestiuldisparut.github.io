import { FIXTURE_VALUES } from '../api-fixtures/index.js';
import { authenticated, googleError, googleFailure, type GoogleApi, type GoogleProjects } from './google-common.js';
import { PolicyStore } from './google-policies.js';
import { jsonResponse, requestObject, route, type Route, type RouteParams } from './routes.js';
import { sequence, type ServiceFake } from './service.js';

/**
 * Artifact Registry v1 (`docs/research/M6-interfaces.md` §1.6, §1.10): the Docker repositories of a project's region,
 * created at once (the operation reads back as done; a second create answers 409 `ALREADY_EXISTS`), and each repository's
 * IAM policy, where Prepare the project's `iam` item gives the installer `roles/artifactregistry.writer` on `hcm` only.
 * Made by server-bugs for the `artifact-registry` item; the installer's pipeline build reads the same repositories.
 */

export interface ArtifactRegistryState {
    /** `<project id>/<region>/<repository>` → the repository as created (its spec with its name). */
    readonly repositories: Map<string, Readonly<Record<string, unknown>>>;
    readonly policies: PolicyStore;
}

export function defaultArtifactRegistryState(): ArtifactRegistryState {
    return { repositories: new Map(), policies: new PolicyStore() };
}

const API: GoogleApi = {
    service: 'artifactregistry.googleapis.com',
    title: 'Artifact Registry API',
    permission: 'artifactregistry.repositories.create',
};
const BASE = 'https://artifactregistry.googleapis.com/v1/projects/{project}/locations/{region}/repositories';

/** The fake Artifact Registry API. */
export function createArtifactRegistryFake(state: ArtifactRegistryState, projects: GoogleProjects): ServiceFake {
    const nextOperation = sequence('e2e-repository-');
    const keyOf = (params: RouteParams, repository: string): string =>
        `${projects.resolve(String(params['project'])).id}/${String(params['region'])}/${repository}`;
    const nameOf = (params: RouteParams, repository: string): string =>
        `projects/${projects.resolve(String(params['project'])).id}/locations/${String(params['region'])}/repositories/${repository}`;
    const withRepository = (params: RouteParams, answer: (key: string) => Response): Response => {
        const key = keyOf(params, String(params['repository']));
        return state.repositories.has(key) ? answer(key) : googleError('google/error.not-found', API);
    };
    const create: Route['answer'] = (request, params) => {
        const repository = request.url.searchParams.get('repositoryId') ?? '';
        const key = keyOf(params, repository);
        if (repository === '' || state.repositories.has(key)) {
            return googleError(repository === '' ? 'google/error.invalid-argument' : 'google/error.already-exists', API);
        }
        const created = { ...requestObject(request), name: nameOf(params, repository) };
        state.repositories.set(key, created);
        return jsonResponse({
            name: `projects/${String(params['project'])}/locations/${String(params['region'])}/operations/${nextOperation()}`,
            done: true,
            response: created,
        });
    };
    const setPolicy: Route['answer'] = (request, params) =>
        withRepository(params, (key) => {
            const stored = state.policies.write(key, request);
            return stored === undefined ? googleError('google/error.aborted', API) : jsonResponse(stored);
        });
    const auth = (answer: Route['answer']): Route['answer'] => authenticated(API, answer);
    return {
        name: 'artifact-registry',
        routes: [
            route(
                'GET',
                `${BASE}/{repository}:getIamPolicy`,
                'artifact-registry.repositories.getIamPolicy',
                auth((_request, params) => withRepository(params, (key) => jsonResponse(state.policies.read(key)))),
            ),
            route('POST', `${BASE}/{repository}:setIamPolicy`, 'artifact-registry.repositories.setIamPolicy', auth(setPolicy)),
            route(
                'GET',
                `${BASE}/{repository}`,
                'artifact-registry.repositories.get',
                auth((_request, params) => withRepository(params, (key) => jsonResponse(state.repositories.get(key)))),
            ),
            route('POST', BASE, 'artifact-registry.repositories.create', auth(create)),
        ],
        failure: (mode) => googleFailure(API, mode),
        scenarios: {
            // What Prepare the project leaves: the pipeline's repository of the demo project (its writer bound by `iam`).
            provisioned: () => {
                const name = `projects/${String(FIXTURE_VALUES['projectId'])}/locations/us-central1/repositories/hcm`;
                state.repositories.set(`${String(FIXTURE_VALUES['projectId'])}/us-central1/hcm`, { name, format: 'DOCKER' });
            },
        },
        snapshot: () => ({ repositories: Object.fromEntries(state.repositories), policies: state.policies.snapshot() }),
    };
}
