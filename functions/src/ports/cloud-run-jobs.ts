/**
 * Cloud Run Admin API v2 over REST (`jobs/{job}:run` with container env overrides): the raster
 * pipeline's executions (docs/research/design-review-security-cost.md §4.1). Adapter: M3.
 */
interface JobExecution {
    /** projects/{p}/locations/{l}/jobs/{job}/executions/{id} */
    readonly name: string;
}

export interface CloudRunJobs {
    run(job: string, env: Readonly<Record<string, string>>): Promise<JobExecution>;
    cancel(execution: string): Promise<void>;
}
