/**
 * The three install builds as data (`docs/research/M6-interfaces.md` §1.4): what the admin submits to Cloud Build for
 * the server, the imagery pipeline and the public site. Every build runs as `hcm-installer@` (never a key, never the
 * owner's token), logs to Cloud Logging only, carries the tags the cards find it by and the substitutions its `fetch`
 * step checks the bundle with. Every image is named by digest, from the admin's own verified manifest. Nothing here
 * comes from data: the project, region and release are the admin's own, the origin and base path its own address.
 * `build-spec.test.ts` pins each definition against golden JSON.
 */
import { INSTALLER_ACCOUNT, PIPELINE_REPOSITORY, type InstallTarget } from '@hcm/shared';

import type { JsonObject } from '../google/json.js';
import { FETCH_BUNDLE_SCRIPT } from './fetch-script.js';

interface BuildImages {
    /** `node:24-bookworm-slim@sha256:…` for every Node step. */
    readonly node: string;
    /** The Docker builder of the pipeline's steps, by digest. */
    readonly docker: string;
}

export interface BuildParams {
    readonly projectId: string;
    readonly region: string;
    /** The admin's own origin (`https://<project>.web.app`). */
    readonly origin: string;
    /** The admin's base path (`/admin/`). */
    readonly basePath: string;
    readonly release: string;
    readonly slug: string;
    /** SHA-256 of `manifest.json` as the admin read it. */
    readonly manifestSha256: string;
    /** SHA-256 of the target's tarball, as the manifest names it. */
    readonly fileSha256: string;
    readonly images: BuildImages;
}

/** Every build's tag, and each target's own (the cards list builds by it). */
const INSTALL_TAG = 'hcm-install';

export function targetTag(target: InstallTarget): string {
    return `hcm-${target}`;
}

export function releaseTag(slug: string): string {
    return `hcm-r-${slug}`;
}

/** How long each build may run (§1.4) and how long it may wait in the queue. */
const TIMEOUT_SECONDS: Readonly<Record<InstallTarget, number>> = { server: 3600, pipeline: 5400, site: 1800 };
const QUEUE_TTL_SECONDS = 3600;

/** `firebase-tools` as the bundle's `tools/` folder installs it. */
const FIREBASE_BIN = 'tools/node_modules/firebase-tools/lib/bin/firebase.js';

/** Where each target's tarball is unpacked (`/workspace/<dir>`), and the steps' working folder. */
const TARGET_DIRS: Readonly<Record<InstallTarget, string>> = { server: 'server', pipeline: 'pipeline', site: 'site' };

/** The tarballs each target's `fetch` downloads, its own first. */
const FETCHED: Readonly<Record<InstallTarget, string>> = { server: 'server', pipeline: 'pipeline', site: 'site,server,pipeline' };

/** The Hosting site keeps this many releases (`hosting-config`, §1.4.3). */
const HOSTING_MAX_VERSIONS = 10;

/** The pipeline's image, tagged with the release's slug (the jobs run it by digest). */
function pipelineImage(region: string): string {
    return `${region}-docker.pkg.dev/$PROJECT_ID/${PIPELINE_REPOSITORY}/pipeline:\${_SLUG}`;
}

function fetchStep(target: InstallTarget, params: BuildParams): JsonObject {
    const keep = target === 'site' ? ['HCM_KEEP_BUNDLE=public${_BASE}install/${_SLUG}'] : [];
    return {
        id: 'fetch',
        name: params.images.node,
        entrypoint: 'node',
        args: ['--input-type=module', '--eval', FETCH_BUNDLE_SCRIPT],
        env: [
            'HCM_BUNDLE_URL=${_ORIGIN}${_BASE}install/${_SLUG}/',
            'HCM_MANIFEST_SHA256=${_MANIFEST_SHA256}',
            'HCM_FILE_SHA256=${_FILE_SHA256}',
            'HCM_RELEASE=${_RELEASE}',
            `HCM_FILES=${FETCHED[target]}`,
            `HCM_OUT=/workspace/${TARGET_DIRS[target]}`,
            ...keep,
        ],
    };
}

function toolsStep(target: InstallTarget, params: BuildParams): JsonObject {
    return {
        id: 'tools',
        name: params.images.node,
        entrypoint: 'npm',
        dir: `${TARGET_DIRS[target]}/tools`,
        args: ['ci', '--ignore-scripts', '--no-audit', '--no-fund'],
    };
}

function nodeStep(id: string, target: InstallTarget, params: BuildParams, args: readonly string[]): JsonObject {
    return { id, name: params.images.node, entrypoint: 'node', dir: TARGET_DIRS[target], args };
}

function serverSteps(params: BuildParams): readonly JsonObject[] {
    const project = ['--project', '$PROJECT_ID'];
    return [
        fetchStep('server', params),
        toolsStep('server', params),
        nodeStep('rules', 'server', params, [FIREBASE_BIN, 'deploy', '--only', 'firestore,storage', ...project, '--non-interactive']),
        nodeStep('functions', 'server', params, ['steps/deploy-with-retry.mjs', ...project, '--force']),
        nodeStep('verify', 'server', params, [
            'steps/verify-server.mjs',
            ...project,
            '--region',
            params.region,
            '--release',
            '${_RELEASE}',
        ]),
    ];
}

function pipelineSteps(params: BuildParams): readonly JsonObject[] {
    const image = pipelineImage(params.region);
    return [
        fetchStep('pipeline', params),
        {
            id: 'build',
            name: params.images.docker,
            dir: 'pipeline',
            env: ['DOCKER_BUILDKIT=1'],
            args: ['build', '-f', 'Dockerfile', '--target', 'runtime', '-t', image, '.'],
        },
        {
            id: 'push',
            name: params.images.docker,
            entrypoint: 'bash',
            dir: 'pipeline',
            args: ['-c', `docker push ${image} && docker inspect --format='{{index .RepoDigests 0}}' ${image} > /workspace/digest`],
        },
        nodeStep('jobs', 'pipeline', params, [
            'steps/run-jobs.mjs',
            ...['--project', '$PROJECT_ID', '--region', params.region, '--image-file', '/workspace/digest', '--slug', '${_SLUG}'],
        ]),
    ];
}

function siteSteps(params: BuildParams): readonly JsonObject[] {
    const project = ['--project', '$PROJECT_ID'];
    return [
        fetchStep('site', params),
        toolsStep('site', params),
        nodeStep('hosting', 'site', params, [FIREBASE_BIN, 'deploy', '--only', 'hosting', ...project, '--non-interactive']),
        nodeStep('config', 'site', params, ['steps/hosting-config.mjs', ...project, '--max-versions', String(HOSTING_MAX_VERSIONS)]),
    ];
}

const STEPS: Readonly<Record<InstallTarget, (params: BuildParams) => readonly JsonObject[]>> = {
    server: serverSteps,
    pipeline: pipelineSteps,
    site: siteSteps,
};

/** `hcm-installer@<project>.iam.gserviceaccount.com` as a build's `serviceAccount` names it. */
export function installerServiceAccount(projectId: string): string {
    return `projects/${projectId}/serviceAccounts/${INSTALLER_ACCOUNT}@${projectId}.iam.gserviceaccount.com`;
}

/** The build the admin submits for `target` (§1.4). */
export function buildDefinition(target: InstallTarget, params: BuildParams): JsonObject {
    return {
        serviceAccount: installerServiceAccount(params.projectId),
        options: { logging: 'CLOUD_LOGGING_ONLY' },
        timeout: `${String(TIMEOUT_SECONDS[target])}s`,
        queueTtl: `${String(QUEUE_TTL_SECONDS)}s`,
        tags: [INSTALL_TAG, targetTag(target), releaseTag(params.slug)],
        substitutions: {
            _ORIGIN: params.origin,
            _BASE: params.basePath,
            _SLUG: params.slug,
            _RELEASE: params.release,
            _MANIFEST_SHA256: params.manifestSha256,
            _FILE_SHA256: params.fileSha256,
        },
        steps: STEPS[target](params),
    };
}
