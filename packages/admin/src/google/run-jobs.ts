import { at, isRecord, records, stringAt } from './json.js';
import type { GoogleTransport } from './transport.js';

/**
 * Cloud Run Admin v2 `jobs.get` for the installer's pipeline card (`docs/research/M6-interfaces.md` §1.7): which
 * release a raster pipeline job runs (its `hcm-release` label, the install slug) and on which image. A job that does
 * not exist yet reads as undefined. The jobs themselves are created by the pipeline build's `jobs` step.
 */

const RUN = 'https://run.googleapis.com/v2';

/** The label the pipeline build puts on both jobs: the release's install slug. */
const RELEASE_LABEL = 'hcm-release';

interface RunJobView {
    /** The job's short name (`raster-pipeline`). */
    readonly name: string;
    /** The `hcm-release` label, or '' without one. */
    readonly releaseSlug: string;
    /** The first container's image, or ''. */
    readonly image: string;
}

export interface RunJobsClient {
    get(projectId: string, region: string, job: string): Promise<RunJobView | undefined>;
}

export function createRunJobsClient(transport: GoogleTransport): RunJobsClient {
    return {
        get: async (projectId, region, job) => {
            const body = await transport.find({
                operation: 'cloud-run.jobs.get',
                url: `${RUN}/projects/${projectId}/locations/${region}/jobs/${encodeURIComponent(job)}`,
            });
            if (!isRecord(body)) {
                return undefined;
            }
            const [container] = records(at(body, 'template', 'template', 'containers'));
            return {
                name: job,
                releaseSlug: stringAt(body, 'labels', RELEASE_LABEL) ?? '',
                image: stringAt(container, 'image') ?? '',
            };
        },
    };
}
