import { CLOUD_RUN_JOBS, INSTALLER_ACCOUNT, installLogLine, type InstallTarget } from '@hcm/shared';

import { FIXTURE_VALUES } from '../api-fixtures/index.js';
import { authenticated, googleError, googleFailure, type GoogleApi, type GoogleProjects } from './google-common.js';
import { registryFunctions, type DeploymentState } from './google-functions.js';
import type { IamState } from './google-iam.js';
import { setJobSpec, type CloudRunState } from './google-run.js';
import { enableService, serviceEnabled, type ServiceUsageState } from './google-services.js';
import { jsonResponse, requestObject, route, type Route } from './routes.js';
import { sequence, type ServiceFake } from './service.js';

/**
 * Cloud Build v1 for the in-app installer (`docs/research/M6-interfaces.md` §1.4, §1.10): builds are created (queued),
 * read and listed by tag, newest first. No step runs: each target's next builds play the outcome its scenario names
 * (`serverSucceeds`, `serverRetries`, `serverFailsAtFunctions`, `serverRetriesExhausted`, `serverInternalError`, the
 * same for `pipeline` and `site`), when a test applies `start` (queued → working, a retrying server build printing its
 * retry line) and `finish` (→ the outcome). A successful build changes the world as the real one would: the server's
 * functions deployed with the build's `HCM_RELEASE` and their Scheduler job; the pipeline's two Cloud Run jobs on the
 * pushed image with the release label; the public site's `release.json`. The build's log lines (Cloud Logging,
 * `google-logging.ts`) come from the same state, a stopped step's with a planted token for the redaction checks.
 */

const CLOUD_BUILD: GoogleApi = { service: 'cloudbuild.googleapis.com', title: 'Cloud Build API', permission: 'cloudbuild.builds.create' };

export const BUILD_OUTCOMES = [
    'succeeds',
    'retries',
    'failsAtFetch',
    'failsAtFunctions',
    'failsAtBuild',
    'failsAtHosting',
    'retriesExhausted',
    'internalError',
] as const;

export type BuildOutcome = (typeof BUILD_OUTCOMES)[number];

type BuildStatus = 'QUEUED' | 'WORKING' | 'SUCCESS' | 'FAILURE' | 'INTERNAL_ERROR';

interface FakeLogLine {
    readonly step: string;
    readonly text: string;
}

export interface FakeBuild {
    readonly id: string;
    readonly projectId: string;
    readonly region: string;
    readonly target: InstallTarget;
    /** The definition the admin submitted, as it sent it. */
    readonly request: Readonly<Record<string, unknown>>;
    readonly stepIds: readonly string[];
    readonly tags: readonly string[];
    readonly substitutions: Readonly<Record<string, string>>;
    readonly outcome: BuildOutcome;
    status: BuildStatus;
    /** Index of the step under way (WORKING), or of the step a stopped build stopped at. */
    current: number;
    readonly createTime: string;
    startTime?: string;
    finishTime?: string;
    readonly log: FakeLogLine[];
}

/** The public site the site build published (`release.json`: what the e2e Hosting answers). */
interface HostingRelease {
    readonly release: string;
    readonly variant: 'public' | 'start-up';
}

export interface CloudBuildState {
    /** Build id → build, in creation order. */
    readonly builds: Map<string, FakeBuild>;
    /** Each target's outcome for its next builds (default `succeeds`). */
    readonly outcomes: Map<InstallTarget, BuildOutcome>;
    /** The public site's release, once a site build succeeded. */
    hosting: HostingRelease | null;
}

export function defaultCloudBuildState(): CloudBuildState {
    return { builds: new Map(), outcomes: new Map(), hosting: null };
}

/** The world a successful build changes. */
export interface BuildWorld {
    readonly deployment: DeploymentState;
    readonly serviceUsage: ServiceUsageState;
    readonly cloudRun: CloudRunState;
    /** The IAM fake's projects: `installerAccount` adds the installer's account as Prepare the project makes it. */
    readonly iam: IamState;
}

type ProjectIam = IamState['projects'] extends Map<string, infer Project> ? Project : never;

/** The installer's account in `projectId`, as Provision's `service-accounts` item creates it (a map set up before M6). */
function addInstallerAccount(iam: IamState, projectId: string): void {
    const existing = iam.projects.get(projectId);
    const project: ProjectIam = existing ?? {
        ...{ accounts: new Map(), accountPolicies: new Map(), pools: new Map() },
        ...{ providers: new Map(), deleted: new Set(), roles: new Map() },
    };
    project.accounts.set(INSTALLER_ACCOUNT, 'Cloud Build: the in-app installer');
    iam.projects.set(projectId, project);
}

/** A token and a secret planted in a stopped step's log: the admin must redact both (S-A55-BAD-BUILD-FAILED). */
export const PLANTED_LOG_SECRETS = ['ya29.e2e-planted-access-token-0001', 'sk.e2e-planted-mapbox-secret-0001-abcdefgh'] as const;

/** The release an older site build published (S-A57-HAPPY-UPDATE). */
export const OLDER_SITE_RELEASE = '0.9.0+e2e0000';

/** The image digest a pipeline build pushes. */
export const PIPELINE_DIGEST = `sha256:${'e2'.repeat(32)}`;

const TARGETS: readonly InstallTarget[] = ['server', 'pipeline', 'site'];

function targetOf(tags: readonly string[]): InstallTarget | undefined {
    return TARGETS.find((target) => tags.includes(`hcm-${target}`));
}

function strings(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function stepId(step: unknown): string {
    const id = typeof step === 'object' && step !== null ? (step as Record<string, unknown>)['id'] : undefined;
    return typeof id === 'string' ? id : '';
}

function stepIdsOf(request: Readonly<Record<string, unknown>>): string[] {
    const steps = Array.isArray(request['steps']) ? (request['steps'] as unknown[]) : [];
    return steps.map(stepId);
}

function substitutionsOf(request: Readonly<Record<string, unknown>>): Record<string, string> {
    const value = request['substitutions'];
    const entries = typeof value === 'object' && value !== null ? Object.entries(value) : [];
    return Object.fromEntries(entries.filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

/** The step a stopping outcome stops at (the last step for an exhausted retry, which `verify` ends). */
function stopStep(build: FakeBuild): number {
    const stops: Partial<Record<BuildOutcome, string>> = {
        failsAtFetch: 'fetch',
        failsAtFunctions: 'functions',
        failsAtBuild: 'build',
        failsAtHosting: 'hosting',
        retriesExhausted: 'verify',
    };
    const step = stops[build.outcome];
    return step === undefined ? build.stepIds.length - 1 : Math.max(0, build.stepIds.indexOf(step));
}

function now(): string {
    return new Date().toISOString();
}

function retryLines(attempt: number): FakeLogLine[] {
    return [
        { step: 'functions', text: 'Error: Permission denied while using the Eventarc Service Agent. This may take a few minutes.' },
        { step: 'functions', text: installLogLine({ event: 'retry', attempt, waitSeconds: 60 * attempt, reason: 'eventarcAgent' }) },
    ];
}

function failureLines(step: string): FakeLogLine[] {
    const [token, secret] = PLANTED_LOG_SECRETS;
    return [
        { step, text: `Error: ${step} failed` },
        { step, text: `Authorization: Bearer ${token}` },
        { step, text: `MAPBOX_TOKEN=${secret}` },
        { step, text: `The ${step} step exited with status 1.` },
    ];
}

/** `verify` names the two functions an exhausted retry left out (the registry's first two). */
function missingLines(): FakeLogLine[] {
    return registryFunctions()
        .slice(0, 2)
        .map((name) => ({ step: 'verify', text: installLogLine({ event: 'missing', name }) }));
}

function start(build: FakeBuild): void {
    if (build.status !== 'QUEUED') {
        return;
    }
    build.status = 'WORKING';
    build.startTime = now();
    build.log.push({ step: 'fetch', text: `fetch: ${build.target} checked and unpacked` });
    const retrying = build.outcome === 'retries' || build.outcome === 'retriesExhausted';
    build.current = retrying ? Math.max(0, build.stepIds.indexOf('functions')) : 0;
    if (retrying) {
        build.log.push(...retryLines(1));
    }
}

function stopLines(build: FakeBuild): FakeLogLine[] {
    if (build.outcome === 'retriesExhausted') {
        return [...retryLines(2), ...retryLines(3), ...missingLines()];
    }
    return build.outcome.startsWith('failsAt') ? failureLines(build.stepIds[stopStep(build)] ?? 'fetch') : [];
}

function finalStatus(outcome: BuildOutcome): BuildStatus {
    if (outcome === 'internalError') {
        return 'INTERNAL_ERROR';
    }
    return outcome === 'succeeds' || outcome === 'retries' ? 'SUCCESS' : 'FAILURE';
}

/** The build ends as its outcome says, and a success changes the world. */
function finish(build: FakeBuild, state: CloudBuildState, world: BuildWorld): void {
    start(build);
    if (build.status !== 'WORKING') {
        return;
    }
    build.status = finalStatus(build.outcome);
    build.current = stopStep(build);
    build.finishTime = now();
    build.log.push(...stopLines(build));
    if (build.status === 'SUCCESS') {
        succeed(build, state, world);
    }
}

function succeed(build: FakeBuild, state: CloudBuildState, world: BuildWorld): void {
    const release = build.substitutions['_RELEASE'] ?? '';
    const slug = build.substitutions['_SLUG'] ?? '';
    if (build.target === 'server') {
        world.deployment.deployment = 'deployed';
        world.deployment.schedulerJob = true;
        world.deployment.release = release;
        // A server build deploys every function of the registry (a server from before M6 lacked some).
        delete world.deployment.lacking;
        enableService(world.serviceUsage, build.projectId, 'cloudfunctions.googleapis.com');
        return;
    }
    if (build.target === 'pipeline') {
        const image = `${build.region}-docker.pkg.dev/${build.projectId}/hcm/pipeline@${PIPELINE_DIGEST}`;
        Object.values(CLOUD_RUN_JOBS).forEach((job) => {
            setJobSpec(world.cloudRun, `${build.projectId}/${build.region}/${job}`, { labels: { 'hcm-release': slug }, image });
        });
        return;
    }
    state.hosting = { release, variant: 'public' };
}

/** The step under way's status, or the step a stopped build stopped at: the build's own. */
function currentStatus(build: FakeBuild): string {
    return build.status === 'SUCCESS' ? 'SUCCESS' : build.status;
}

function stepStatus(build: FakeBuild, index: number): string {
    if (build.status === 'QUEUED' || index > build.current) {
        return 'QUEUED';
    }
    return index < build.current ? 'SUCCESS' : currentStatus(build);
}

/** A build as Google answers it. */
function buildBody(build: FakeBuild): Record<string, unknown> {
    return {
        id: build.id,
        projectId: build.projectId,
        status: build.status,
        createTime: build.createTime,
        ...(build.startTime === undefined ? {} : { startTime: build.startTime }),
        ...(build.finishTime === undefined ? {} : { finishTime: build.finishTime }),
        steps: build.stepIds.map((id, index) => ({ id, status: stepStatus(build, index) })),
        tags: build.tags,
        substitutions: build.substitutions,
        serviceAccount: build.request['serviceAccount'],
        options: build.request['options'],
    };
}

/** A request that is not a build definition the installer would send. */
function refusal(request: Readonly<Record<string, unknown>>): boolean {
    const tags = strings(request['tags']);
    return stepIdsOf(request).length === 0 || !tags.includes('hcm-install') || targetOf(tags) === undefined;
}

function scenarioTable(state: CloudBuildState, world: BuildWorld, create: (target: InstallTarget, outcome: BuildOutcome) => void) {
    const outcomes = Object.fromEntries(
        TARGETS.flatMap((target) =>
            BUILD_OUTCOMES.map((outcome) => [
                `${target}${outcome[0]?.toUpperCase() ?? ''}${outcome.slice(1)}`,
                () => {
                    state.outcomes.set(target, outcome);
                },
            ]),
        ),
    );
    return {
        ...outcomes,
        /** Every queued build starts (a retrying server build prints its first retry). */
        start: () => {
            state.builds.forEach((build) => {
                start(build);
            });
        },
        /** Every build that runs ends as its outcome says. */
        finish: () => {
            state.builds.forEach((build) => {
                finish(build, state, world);
            });
        },
        /** The installer's account of the demo project, for a map whose Prepare the project ran in an earlier session. */
        installerAccount: () => {
            addInstallerAccount(world.iam, String(FIXTURE_VALUES['projectId']));
        },
        /** A site build of an older release published the public variant (S-A57-HAPPY-UPDATE). */
        siteOlderRelease: () => {
            state.hosting = { release: OLDER_SITE_RELEASE, variant: 'public' };
        },
        /** A server build queued from another tab (S-A55-BAD-SECOND-BUILD). */
        serverQueuedElsewhere: () => {
            create('server', 'succeeds');
        },
    };
}

/** The fake Cloud Build API. */
export function createCloudBuildFake(state: CloudBuildState, world: BuildWorld, projects: GoogleProjects): ServiceFake {
    const nextBuild = sequence('0e2e0b1d-0000-4000-8000-', 12);
    const nextOperation = sequence('e2e-build-op-');
    const add = (projectId: string, region: string, request: Readonly<Record<string, unknown>>, outcome: BuildOutcome): FakeBuild => {
        const tags = strings(request['tags']);
        const build: FakeBuild = {
            ...{ id: nextBuild(), projectId, region, target: targetOf(tags) ?? 'server', request, stepIds: stepIdsOf(request), tags },
            ...{ substitutions: substitutionsOf(request), outcome, status: 'QUEUED', current: 0, createTime: now(), log: [] },
        };
        state.builds.set(build.id, build);
        return build;
    };
    const create: Route['answer'] = (request, params) => {
        const project = projects.resolve(String(params['project']));
        if (!serviceEnabled(world.serviceUsage, project.id, CLOUD_BUILD.service)) {
            return googleError('google/error.service-disabled', CLOUD_BUILD, { projectNumber: project.number });
        }
        const body = requestObject(request);
        if (refusal(body)) {
            return googleError('google/error.invalid-argument', CLOUD_BUILD);
        }
        const target = targetOf(strings(body['tags'])) ?? 'server';
        const build = add(project.id, String(params['region']), body, state.outcomes.get(target) ?? 'succeeds');
        return jsonResponse({
            name: `projects/${project.number}/locations/${String(params['region'])}/operations/${nextOperation()}`,
            metadata: { '@type': 'type.googleapis.com/google.devtools.cloudbuild.v1.BuildOperationMetadata', build: buildBody(build) },
        });
    };
    const get: Route['answer'] = (_request, params) => {
        const build = state.builds.get(String(params['build']));
        return build === undefined ? googleError('google/error.not-found', CLOUD_BUILD) : jsonResponse(buildBody(build));
    };
    const list: Route['answer'] = (request) => {
        const tag = /^tags="([\w.-]+)"$/.exec(request.url.searchParams.get('filter') ?? '')?.[1];
        const size = Number(request.url.searchParams.get('pageSize') ?? 25);
        const builds = [...state.builds.values()].filter((build) => tag === undefined || build.tags.includes(tag)).reverse();
        return jsonResponse({ builds: builds.slice(0, size).map(buildBody) });
    };
    const base = 'https://cloudbuild.googleapis.com/v1/projects/{project}/locations/{region}/builds';
    const auth = (answer: Route['answer']): Route['answer'] => authenticated(CLOUD_BUILD, answer);
    const elsewhere = (target: InstallTarget, outcome: BuildOutcome): void => {
        const projectId = String(FIXTURE_VALUES['projectId']);
        const request = { tags: ['hcm-install', `hcm-${target}`, 'hcm-r-elsewhere'], steps: [{ id: 'fetch' }], substitutions: {} };
        add(projectId, String(FIXTURE_VALUES['region']), request, outcome);
    };
    return {
        name: 'cloud-build',
        routes: [
            route('GET', `${base}/{build}`, 'cloud-build.builds.get', auth(get)),
            route('GET', base, 'cloud-build.builds.list', auth(list)),
            route('POST', base, 'cloud-build.builds.create', auth(create)),
        ],
        failure: (mode) => googleFailure(CLOUD_BUILD, mode),
        scenarios: scenarioTable(state, world, elsewhere),
        snapshot: () => ({
            builds: [...state.builds.values()].map((build) => ({ ...buildBody(build), target: build.target, request: build.request })),
            hosting: state.hosting,
        }),
    };
}
