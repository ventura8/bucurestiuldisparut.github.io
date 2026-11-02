/**
 * The local worker as the admin's pages show it (`docs/research/M7-local-worker.md` §3, §4.4, §7), in the lazy `worker`
 * chunk: the city's most recently seen worker (`cities/{city}/workers`, live; connected while it was seen within
 * `WORKER_FRESH_SECONDS`), the city's choice of where new jobs run (`workers/choice`, `auto` when absent), the pipeline
 * image's digest the worker's command names (`setup.status`'s `install.pipeline.image`), this month's Cloud Run use
 * (`usage/cloudrun-<month>`) and, on a version's page, its job's place and wait. The choice and a job's place change through
 * `imagery.runOn`; a refusal is said where the change was asked for.
 */
import {
    cloudRunUsageDocSchema,
    FIRESTORE_PATHS,
    jobDocSchema,
    runChoiceDocSchema,
    usageMonth,
    WORKER_FRESH_SECONDS,
    workerDocSchema,
    type CloudRunUsageDoc,
    type JobDoc,
    type JobStatus,
    type JobWaitReason,
    type RunChoice,
    type RunChoiceDoc,
    type RunPlace,
    type WorkerDoc,
} from '@hcm/shared';

import { LiveDoc, type DocState } from '../content/doc.js';
import { isoOf, LiveList, type ListState, type LoadStatus } from '../content/list.js';
import type { ContentServices, Stored, StoreFailure } from '../content/services.js';
import { refusalOf } from '../imagery/api.js';
import { Store } from '../state/store.js';
import type { NoticeInput } from '../state/state.js';
import { estimateCloudRun, type CloudRunUse } from './estimate.js';

export interface WorkerSeen {
    readonly id: string;
    readonly state: WorkerDoc['state'];
    readonly seenAt: string;
    readonly jobId: string | null;
    readonly lastJob: { readonly id: string; readonly outcome: 'done' | 'failed'; readonly at: string } | null;
}

/** The job of a version's page: where it runs, why it waits, and what a cloud run of it would use. */
interface WorkerJob {
    readonly id: string;
    readonly status: JobStatus;
    readonly runOn: RunPlace | null;
    readonly waitReason: JobWaitReason | null;
    readonly estimate: CloudRunUse;
}

export interface WorkerState {
    /** The city the feed follows (the worker's command names it). */
    readonly city: string;
    /** The workers' listener: loading, read, or stopped with `failure`. */
    readonly status: LoadStatus;
    readonly failure: StoreFailure | null;
    /** The city's most recently seen worker, or null when none ever was. */
    readonly worker: WorkerSeen | null;
    readonly connected: boolean;
    readonly choice: RunChoice;
    /** The pipeline image's digest; null without one, undefined while asked for. */
    readonly image: string | null | undefined;
    readonly usage: CloudRunUse;
    readonly job: WorkerJob | null;
    /** `imagery.runOn` is on its way. */
    readonly acting: boolean;
    /** Why the last change was refused, or null. */
    readonly refusal: NoticeInput | null;
}

export interface WorkerIntents {
    /** The city's choice (`imagery.runOn` without a job); true once the server took it. */
    setChoice(choice: RunChoice): Promise<boolean>;
    /** The watched job's place, with the OK past the free tier when `freeTierOk`; true once the server took it. */
    runJob(runOn: RunPlace, freeTierOk: boolean): Promise<boolean>;
    /** Try again after the workers' listener stopped. */
    retry(): void;
}

const NO_USE: CloudRunUse = { vcpuSeconds: 0, gibSeconds: 0 };

const INITIAL: Omit<WorkerState, 'city'> = {
    ...{ status: 'loading', failure: null, worker: null, connected: false, choice: 'auto', image: undefined },
    ...{ usage: NO_USE, job: null, acting: false, refusal: null },
};

function seenOf(doc: Stored<WorkerDoc>): WorkerSeen {
    const { state, jobId, lastJob, lastSeenAt } = doc.data;
    const last = lastJob === undefined ? null : { id: lastJob.id, outcome: lastJob.outcome, at: isoOf(lastJob.at) };
    return { id: doc.id, state, seenAt: isoOf(lastSeenAt), jobId: jobId ?? null, lastJob: last };
}

/** The jobs the raster pipeline runs, whose place may be the computer or the cloud. */
const PIPELINE_TYPES: ReadonlySet<JobDoc['type']> = new Set<JobDoc['type']>(['usgs-import', 'geotiff-import', 'regeoref']);

/** The pipeline job of a version's page, or null (none, or a job the pipeline does not run). */
function jobOf(doc: Stored<JobDoc> | null): WorkerJob | null {
    if (doc === null || !PIPELINE_TYPES.has(doc.data.type)) {
        return null;
    }
    const job = doc.data;
    return {
        id: doc.id,
        status: job.status,
        runOn: job.runOn ?? null,
        waitReason: job.waitReason ?? null,
        estimate: estimateCloudRun(job),
    };
}

function usageOf(state: DocState<CloudRunUsageDoc>): CloudRunUse {
    const usage = state.doc?.data;
    return usage === undefined ? NO_USE : { vcpuSeconds: usage.vcpuSeconds, gibSeconds: usage.gibSeconds };
}

export class WorkerFeed {
    readonly #services: ContentServices;
    readonly #cell: Store<WorkerState>;
    readonly #workers: LiveList<WorkerDoc, WorkerSeen>;
    readonly #choice: LiveDoc<RunChoiceDoc>;
    readonly #usage: LiveDoc<CloudRunUsageDoc>;
    readonly #job: LiveDoc<JobDoc>;
    readonly intents: WorkerIntents;
    #stale: unknown = null;

    constructor(services: ContentServices) {
        this.#services = services;
        this.#cell = new Store<WorkerState>({ ...INITIAL, city: services.cityId }, services.log);
        const { store, clock } = services;
        const denied = (): void => {
            services.denied();
        };
        const common = { store, clock, denied };
        this.#workers = new LiveList({
            ...{ ...common, collection: FIRESTORE_PATHS.workers(services.cityId), pageSize: 1, schema: workerDocSchema, map: seenOf },
            changed: (list) => {
                this.#seen(list);
            },
        });
        this.#choice = new LiveDoc({
            ...{ ...common, schema: runChoiceDocSchema },
            changed: (state) => {
                this.#cell.update({ choice: state.doc?.data.choice ?? 'auto' });
            },
        });
        this.#usage = new LiveDoc({
            ...{ ...common, schema: cloudRunUsageDocSchema },
            changed: (state) => {
                this.#cell.update({ usage: usageOf(state) });
            },
        });
        this.#job = new LiveDoc({
            ...{ ...common, schema: jobDocSchema },
            changed: (state) => {
                this.#cell.update({ job: jobOf(state.doc) });
            },
        });
        this.intents = {
            setChoice: (choice) => this.#runOn({ runOn: choice }),
            runJob: (runOn, freeTierOk) => this.#runJob(runOn, freeTierOk),
            retry: () => {
                this.#workers.retry();
            },
        };
    }

    get state(): WorkerState {
        return this.#cell.state;
    }

    subscribe(listener: (state: WorkerState) => void): () => void {
        return this.#cell.subscribe(listener);
    }

    /** Starts every listener: with `jobId`, that job's too (a version's page); without, asks for the image's digest (the panel). */
    start(jobId: string | null): void {
        const { cityId, clock } = this.#services;
        this.#workers.show({ orderBy: [['lastSeenAt', 'desc']] });
        this.#choice.show(FIRESTORE_PATHS.runChoice(cityId));
        this.#usage.show(FIRESTORE_PATHS.cloudRunUsage(usageMonth(new Date(clock.now()))));
        if (jobId === null) {
            void this.#askImage();
        } else {
            this.#job.show(FIRESTORE_PATHS.job(cityId, jobId));
        }
    }

    stop(): void {
        for (const live of [this.#workers, this.#choice, this.#usage, this.#job]) {
            live.stop();
        }
        this.#services.clock.clearTimeout(this.#stale);
    }

    async #askImage(): Promise<void> {
        try {
            const status = await this.#services.callables.call('setup.status', {});
            this.#cell.update({ image: status.install?.pipeline?.image ?? null });
        } catch {
            this.#cell.update({ image: null });
        }
    }

    /** The workers' answer; while the worker counts as connected, a timer says when it no longer does. */
    #seen(list: ListState<WorkerSeen>): void {
        const { clock } = this.#services;
        const worker = list.items[0] ?? null;
        const left = worker === null ? 0 : Date.parse(worker.seenAt) + WORKER_FRESH_SECONDS * 1000 - clock.now();
        clock.clearTimeout(this.#stale);
        if (left > 0) {
            this.#stale = clock.setTimeout(() => {
                this.#cell.update({ connected: false });
            }, left);
        }
        this.#cell.update({ status: list.status, failure: list.failure, worker, connected: left > 0 });
    }

    async #runJob(runOn: RunPlace, freeTierOk: boolean): Promise<boolean> {
        const job = this.#cell.state.job;
        if (job === null) {
            return false;
        }
        return this.#runOn(freeTierOk ? { jobId: job.id, runOn, freeTierOk } : { jobId: job.id, runOn });
    }

    async #runOn(request: { readonly jobId?: string; readonly runOn: RunChoice; readonly freeTierOk?: boolean }): Promise<boolean> {
        if (this.#cell.state.acting) {
            return false;
        }
        this.#cell.update({ acting: true, refusal: null });
        try {
            await this.#services.callables.call('imagery.runOn', { cityId: this.#services.cityId, ...request });
            this.#cell.update({ acting: false });
            return true;
        } catch (error) {
            this.#cell.update({ acting: false, refusal: refusalOf(error) });
            return false;
        }
    }
}

/** The worker's feed over the area's services (the Jobs store hands it to the pages: `JobsIntents.worker`). */
export function createWorkerFeed(services: ContentServices): WorkerFeed {
    return new WorkerFeed(services);
}
