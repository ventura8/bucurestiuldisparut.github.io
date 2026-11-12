/**
 * The installed pipeline image (finding 74 of 2026-11-03, `docs/research/M7-local-worker.md`, its addendum of 2026-11-03):
 * what `worker.image` names for the starter's supervisor and what `worker.hello`, `worker.claim` and `worker.pairCode`
 * compare a worker's image with. The truth is the image the Cloud Run job `raster-pipeline` runs (Run Admin v2
 * `jobs.get`, `template.template.containers[0].image`, read with the function's own account), which the pipeline build's
 * `jobs` step sets in the same build that pushed it, with the release its `hcm-release` label names; it is kept a minute
 * per instance (`JOB_CACHE_MS`). Only when the job cannot be read (no job yet, Run Admin refused, a project Provision has
 * not granted `roles/run.viewer` yet) does the record `setup/status.install.pipeline` answer. A release name is never
 * paired with another digest: the record's release is taken only for the digest the record names.
 */
import { CLOUD_RUN_JOBS, FIRESTORE_PATHS, pipelineImageDigest, releaseOfSlug, setupStatusReadSchema } from '@hcm/shared';

import type { JobDescription } from '../ports/cloud-run-jobs.js';
import type { DocumentReader } from '../ports/documents.js';
import type { Ports } from '../ports/index.js';

export type InstalledImageDeps = Pick<Ports, 'documents' | 'jobs' | 'clock' | 'log'>;

/** The installed pipeline image by digest (`sha256:<64 hex>`), its release when known, and where it was read. */
export interface InstalledImage {
    readonly digest: string;
    readonly release?: string | undefined;
    readonly from: 'job' | 'record';
}

/** How long one instance keeps what the job runs (the supervisor and every worker's hello ask often). */
export const JOB_CACHE_MS = 60_000;
/** The label the pipeline build puts on its jobs: the release's install slug (`1-0-0-bf74d17`). */
const RELEASE_LABEL = 'hcm-release';

type JobImage = Omit<InstalledImage, 'from'>;

interface CachedJob {
    readonly until: number;
    readonly image: JobImage | null;
}

/** By the `jobs` port: one entry per instance's adapter (and per test world). */
const CACHE = new WeakMap<object, CachedJob>();

/** A job's image and the release its label names; null when it runs no pipeline image by digest. */
function imageOfJob(job: JobDescription): JobImage | null {
    const digest = pipelineImageDigest(job.image);
    if (digest === null) {
        return null;
    }
    const release = releaseOfSlug(job.labels[RELEASE_LABEL] ?? '');
    return release === null ? { digest } : { digest, release };
}

/** What the job `raster-pipeline` runs; null when it does not exist. */
async function readJob(deps: InstalledImageDeps): Promise<JobImage | null> {
    const job = await deps.jobs.job(CLOUD_RUN_JOBS.std);
    return job === undefined ? null : imageOfJob(job);
}

/** What the job runs, kept `JOB_CACHE_MS`; a refusal is logged and kept as "unknown" for as long. */
async function jobImage(deps: InstalledImageDeps): Promise<JobImage | null> {
    const now = deps.clock.now().getTime();
    const cached = CACHE.get(deps.jobs);
    if (cached !== undefined && cached.until > now) {
        return cached.image;
    }
    const image = await readJob(deps).catch((error: unknown) => {
        deps.log.warn('pipeline job not readable: the recorded image is used', { error: String(error) });
        return null;
    });
    CACHE.set(deps.jobs, { until: now + JOB_CACHE_MS, image });
    return image;
}

/** The recorded image (`setup/status.install.pipeline.image`) with its recorded release. */
async function recordedImage(reader: DocumentReader): Promise<JobImage | undefined> {
    const pipeline = (await reader.get(FIRESTORE_PATHS.setupStatus, setupStatusReadSchema).catch(() => undefined))?.install?.pipeline;
    if (pipeline?.image === undefined) {
        return undefined;
    }
    return { digest: pipeline.image, release: pipeline.release };
}

/** The job's image with its own release, or the record's release when the record names the same digest. */
function withRelease(job: JobImage, recorded: JobImage | undefined): InstalledImage {
    const release = job.release ?? (recorded?.digest === job.digest ? recorded.release : undefined);
    return { digest: job.digest, release, from: 'job' };
}

/** The installed pipeline image: the job's when it can be read, else the record's; undefined when neither names one. */
export async function installedImage(deps: InstalledImageDeps): Promise<InstalledImage | undefined> {
    const [job, recorded] = await Promise.all([jobImage(deps), recordedImage(deps.documents)]);
    if (job !== null) {
        return withRelease(job, recorded);
    }
    return recorded === undefined ? undefined : { ...recorded, from: 'record' };
}
