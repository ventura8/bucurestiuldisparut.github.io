/**
 * The pipeline build's `jobs` step (`docs/research/M6-interfaces.md` §1.4.2): creates or replaces the raster pipeline's
 * two Cloud Run Jobs through Run Admin v2, on the image the `push` step pushed (by digest), exactly as D5 of
 * `MANUAL_TEST_PLAN.md` did with `gcloud`: `job-raster@`, task timeout 6 h, no retries, one task, args `run`, the
 * project's buckets in the environment and the release's slug as the `hcm-release` label. Each operation is waited for.
 *
 * `node steps/run-jobs.mjs --project <p> --region <r> --image-file /workspace/digest --slug <slug>`
 */
import { parseArgs } from 'node:util';

import { CLOUD_RUN_JOBS } from '@hcm/shared';

import { GoogleCallError, googleJson, logEvent, type StepDeps } from './step-io.js';

const RUN = 'https://run.googleapis.com/v2';

/** The two jobs and their machines (M3 §4.3). */
export const PIPELINE_JOBS = [
    { name: CLOUD_RUN_JOBS.std, cpu: '4', memory: '16Gi' },
    { name: CLOUD_RUN_JOBS.xl, cpu: '8', memory: '32Gi' },
] as const;

const OPERATION_POLLS = 120;
const OPERATION_POLL_MS = 5000;

/** `<region>-docker.pkg.dev/<project>/hcm/pipeline@sha256:<64 hex>`, as `docker inspect` printed it. */
const IMAGE_DIGEST = /^[a-z0-9-]+-docker\.pkg\.dev\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/hcm\/pipeline@sha256:([0-9a-f]{64})$/;

interface Options {
    readonly project: string;
    readonly region: string;
    readonly imageFile: string;
    readonly slug: string;
}

function options(argv: readonly string[]): Options {
    const { values } = parseArgs({
        args: [...argv],
        options: { project: { type: 'string' }, region: { type: 'string' }, 'image-file': { type: 'string' }, slug: { type: 'string' } },
        strict: true,
    });
    const { project, region, slug } = values;
    const imageFile = values['image-file'];
    if (project === undefined || region === undefined || imageFile === undefined || slug === undefined) {
        throw new Error('usage: run-jobs --project <p> --region <r> --image-file <path> --slug <slug>');
    }
    return { project, region, imageFile, slug };
}

/** The pushed image by digest, from the `push` step's file (a quoted line is unquoted). */
export function imageOf(text: string): string {
    const image = text.trim().replaceAll("'", '');
    if (!IMAGE_DIGEST.test(image)) {
        throw new Error(`the push step left no image digest: ${JSON.stringify(image.slice(0, 120))}`);
    }
    return image;
}

/** A job as Run Admin v2 takes it. */
export function jobBody(opts: Options, image: string, job: (typeof PIPELINE_JOBS)[number]): Record<string, unknown> {
    const env = [
        { name: 'GOOGLE_CLOUD_PROJECT', value: opts.project },
        { name: 'HCM_PRIVATE_BUCKET', value: `${opts.project}.firebasestorage.app` },
        { name: 'HCM_PUBLIC_BUCKET', value: `${opts.project}-public` },
    ];
    return {
        labels: { 'hcm-release': opts.slug },
        template: {
            taskCount: 1,
            template: {
                serviceAccount: `job-raster@${opts.project}.iam.gserviceaccount.com`,
                timeout: '21600s',
                maxRetries: 0,
                containers: [{ image, args: ['run'], env, resources: { limits: { cpu: job.cpu, memory: job.memory } } }],
            },
        },
    };
}

async function exists(deps: StepDeps, token: string, url: string): Promise<boolean> {
    try {
        await googleJson(deps, token, url);
        return true;
    } catch (error) {
        if (error instanceof GoogleCallError && error.status === 404) {
            return false;
        }
        throw error;
    }
}

interface Operation {
    readonly name?: string;
    readonly done?: boolean;
    readonly error?: unknown;
}

async function waitFor(deps: StepDeps, token: string, started: unknown): Promise<void> {
    let operation = started as Operation;
    let polls = 0;
    while (operation.done !== true) {
        if (polls >= OPERATION_POLLS || operation.name === undefined) {
            throw new Error('the job operation did not finish');
        }
        polls += 1;
        await deps.sleep(OPERATION_POLL_MS);
        operation = (await googleJson(deps, token, `${RUN}/${operation.name}`)) as Operation;
    }
    if (operation.error !== undefined) {
        throw new Error(`the job operation failed: ${JSON.stringify(operation.error).slice(0, 300)}`);
    }
}

/** What every job of one run shares: the world, the build's token, the options and the pushed image. */
interface JobRun {
    readonly deps: StepDeps;
    readonly token: string;
    readonly opts: Options;
    readonly image: string;
}

async function upsert(run: JobRun, job: (typeof PIPELINE_JOBS)[number]): Promise<void> {
    const { deps, token, opts, image } = run;
    const jobs = `${RUN}/projects/${opts.project}/locations/${opts.region}/jobs`;
    const body = JSON.stringify(jobBody(opts, image, job));
    const started = (await exists(deps, token, `${jobs}/${job.name}`))
        ? await googleJson(deps, token, `${jobs}/${job.name}`, { method: 'PATCH', body })
        : await googleJson(deps, token, `${jobs}?jobId=${job.name}`, { method: 'POST', body });
    await waitFor(deps, token, started);
    deps.log(`jobs: ${job.name} runs ${image} (${job.cpu} CPU, ${job.memory})`);
}

/** Creates or replaces both jobs; resolves to the step's exit status. */
export async function runJobs(argv: readonly string[], deps: StepDeps): Promise<number> {
    const opts = options(argv);
    const image = imageOf(deps.readFile(opts.imageFile));
    const run: JobRun = { deps, token: await deps.token(), opts, image };
    for (const job of PIPELINE_JOBS) {
        await upsert(run, job);
    }
    logEvent(deps, { event: 'image', digest: `sha256:${String(IMAGE_DIGEST.exec(image)?.[1])}` });
    return 0;
}
