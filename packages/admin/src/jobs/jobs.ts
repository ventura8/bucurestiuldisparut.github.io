/**
 * The jobs area (`docs/research/M2c-interfaces.md` §9.3; behaviour A18): `#/jobs` is a live query of the city's jobs,
 * newest first, filtered by status; `#/jobs/<jobId>` adds the job itself and its log lines (`jobs/{id}/logs` by `seq`,
 * live). A listener that drops attaches again by itself and the page says "Reconnecting…"; log lines are keyed by
 * `seq`, so a re-read never shows one twice. **Cancel** sets `cancelRequested` (stamped) on an unfinished job; the rules
 * refuse it on a finished one. Retry and the pipeline's own steps arrive with the raster pipeline (M3).
 */
import {
    FIRESTORE_PATHS,
    isId,
    jobDocSchema,
    jobLogDocSchema,
    type JobDoc,
    type JobLogDoc,
    type JobStatus,
    type TimestampLike,
} from '@hcm/shared';

import type { AreaModule, AreaStore } from '../content/areas.js';
import { LiveDoc, LOADING_DOC, type DocState } from '../content/doc.js';
import { isoOf, LiveList, LOADING_LIST, type ListState } from '../content/list.js';
import type { ContentQuery, ContentServices, Stored, WriteOutcome } from '../content/services.js';
import { Store } from '../state/store.js';

/** The list's status chips: every job, the unfinished ones, the failed ones, the others that ended. */
export type JobFilter = 'all' | 'active' | 'failed' | 'done';

/** Statuses of a job that has not finished (Cancel is offered, the progress moves). */
export const ACTIVE_JOB_STATUSES: readonly JobStatus[] = [
    'queued',
    'starting',
    'running',
    'waiting_usgs',
    'mts_processing',
    'awaiting_approval',
];

const FILTER_STATUSES: Readonly<Record<Exclude<JobFilter, 'all'>, readonly JobStatus[]>> = {
    active: ACTIVE_JOB_STATUSES,
    failed: ['failed'],
    done: ['succeeded', 'cancelled'],
};

/** A job's log keeps at most this many lines (`jobLogDocSchema`: 500 per job). */
const MAX_JOB_LOG_LINES = 500;

interface JobItem {
    readonly id: string;
    readonly type: string;
    readonly status: JobStatus;
    readonly finished: boolean;
    /** 0 to 1, or null when the job reports none. */
    readonly progress: number | null;
    readonly step: string | null;
    readonly steps: readonly { readonly name: string; readonly status: string }[];
    readonly createdBy: string;
    readonly createdAt: string;
    /** A job that waits for its date (a deleted layer's tileset, CR-M2c-3): when it may run. */
    readonly dispatchAt: string | null;
    readonly cancelRequested: boolean;
    /** The job's own error: a code and a redacted message, shown as text. */
    readonly error: { readonly code: string; readonly message: string } | null;
}

interface JobLogLine {
    readonly seq: number;
    readonly level: JobLogDoc['level'];
    readonly step: string | null;
    readonly message: string;
    readonly at: string;
}

interface JobDetail {
    readonly id: string;
    /** The job (`job.doc` null: not found). */
    readonly job: DocState<JobItem>;
    readonly logs: ListState<JobLogLine>;
}

export interface JobsState {
    readonly filter: JobFilter;
    readonly list: ListState<JobItem>;
    /** `#/jobs/<jobId>`, or null on the list alone. */
    readonly detail: JobDetail | null;
    readonly cancelling: boolean;
}

export interface JobsIntents {
    setFilter(filter: JobFilter): void;
    /** The next page of the list. */
    more(): void;
    /** Try again after a listener's failure (the list and the open job). */
    retry(): void;
    /** Asks the open job to stop (`cancelRequested: true`). */
    cancel(): Promise<WriteOutcome | null>;
}

const INITIAL: JobsState = { filter: 'all', list: LOADING_LIST, detail: null, cancelling: false };

function optionalIso(timestamp: TimestampLike | undefined): string | null {
    return timestamp === undefined ? null : isoOf(timestamp);
}

/** The steps of a job in their recorded order. */
function stepsOf(job: JobDoc): JobItem['steps'] {
    return Object.entries(job.steps ?? {}).map(([name, step]) => ({ name, status: step.status }));
}

function jobItemOf(doc: Stored<JobDoc>): JobItem {
    const job = doc.data;
    return {
        ...{ id: doc.id, type: job.type, status: job.status, finished: !ACTIVE_JOB_STATUSES.includes(job.status) },
        ...{ progress: job.progress ?? null, step: job.step ?? null, steps: stepsOf(job) },
        ...{ createdBy: job.createdBy, createdAt: isoOf(job.createdAt), dispatchAt: optionalIso(job.dispatchAt) },
        ...{ cancelRequested: job.cancelRequested === true, error: job.error ?? null },
    };
}

function jobLogLineOf(doc: Stored<JobLogDoc>): JobLogLine {
    const line = doc.data;
    return { seq: line.seq, level: line.level, step: line.step ?? null, message: line.message, at: isoOf(line.updatedAt) };
}

/** The list's query for a filter: newest first, one `in` filter on the status (indexed: status, createdAt). */
export function jobsQuery(filter: JobFilter): ContentQuery {
    return { where: filter === 'all' ? [] : [['status', 'in', FILTER_STATUSES[filter]]], orderBy: [['createdAt', 'desc']] };
}

const NOT_FOUND: DocState<never> = { ...LOADING_DOC, status: 'ready' };
const NO_LINES: ListState<never> = { ...LOADING_LIST, status: 'ready' };

/** The open job's detail before its listeners answer; an id that is no document id is not found at once. */
function detailFor(id: string | null): JobDetail | null {
    if (id === null) {
        return null;
    }
    return isId(id) ? { id, job: LOADING_DOC, logs: LOADING_LIST } : { id, job: NOT_FOUND, logs: NO_LINES };
}

/** The open job's id, or null on the list alone. */
function openId(detail: JobDetail | null): string | null {
    return detail === null ? null : detail.id;
}

/** The open job as read, or null. */
function openJob(detail: JobDetail | null): JobItem | null {
    return detail?.job.doc?.data ?? null;
}

/** A job Cancel may ask to stop: unfinished, and not asked yet. */
function stoppable(job: JobItem | null): job is JobItem {
    return job !== null && !job.finished && !job.cancelRequested;
}

class JobsStore implements AreaStore<JobsState, JobsIntents> {
    readonly #services: ContentServices;
    readonly #cell: Store<JobsState>;
    readonly #list: LiveList<JobDoc, JobItem>;
    readonly #job: LiveDoc<JobDoc>;
    readonly #logs: LiveList<JobLogDoc, JobLogLine>;
    readonly intents: JobsIntents;

    constructor(services: ContentServices) {
        this.#services = services;
        this.#cell = new Store<JobsState>(INITIAL, services.log);
        const { store, clock, cityId } = services;
        const denied = (): void => {
            services.denied();
        };
        this.#list = new LiveList({
            ...{ store, clock, denied, collection: FIRESTORE_PATHS.jobs(cityId), schema: jobDocSchema, map: jobItemOf },
            changed: (list) => {
                this.#cell.update({ list });
            },
        });
        const changed = (): void => {
            this.#detailChanged();
        };
        this.#job = new LiveDoc({ store, clock, denied, schema: jobDocSchema, changed });
        this.#logs = new LiveList({
            ...{ store, clock, denied, collection: '', schema: jobLogDocSchema, map: jobLogLineOf, pageSize: MAX_JOB_LOG_LINES },
            changed,
        });
        this.intents = {
            setFilter: (filter) => {
                this.#setFilter(filter);
            },
            more: () => {
                this.#list.more();
            },
            retry: () => {
                this.#retry();
            },
            cancel: () => this.#cancel(),
        };
    }

    get state(): JobsState {
        return this.#cell.state;
    }

    subscribe(listener: (state: JobsState) => void): () => void {
        return this.#cell.subscribe(listener);
    }

    open(params: readonly string[]): void {
        if (!this.#list.active) {
            this.#list.show(jobsQuery(this.#cell.state.filter));
        }
        this.#select(params[0] ?? null);
    }

    close(): void {
        this.#list.stop();
        this.#select(null);
    }

    hasUnsavedChanges(): boolean {
        return false;
    }

    destroy(): void {
        this.close();
    }

    #setFilter(filter: JobFilter): void {
        this.#cell.update({ filter });
        this.#list.show(jobsQuery(filter));
    }

    #select(id: string | null): void {
        if (id === openId(this.#cell.state.detail)) {
            return;
        }
        this.#job.stop();
        this.#logs.stop();
        const detail = detailFor(id);
        this.#cell.update({ detail });
        if (detail?.job.status === 'loading') {
            this.#watch(detail.id);
        }
    }

    /** The open job and its log lines, live. */
    #watch(id: string): void {
        const { cityId } = this.#services;
        this.#job.show(FIRESTORE_PATHS.job(cityId, id));
        this.#logs.showIn(FIRESTORE_PATHS.jobLogs(cityId, id), { orderBy: [['seq', 'asc']] });
    }

    #detailChanged(): void {
        const detail = this.#cell.state.detail;
        if (detail === null) {
            return;
        }
        const state = this.#job.state;
        const job: DocState<JobItem> = { ...state, doc: state.doc === null ? null : { ...state.doc, data: jobItemOf(state.doc) } };
        this.#cell.update({ detail: { id: detail.id, job, logs: this.#logs.list } });
    }

    #retry(): void {
        this.#list.retry();
        if (this.#cell.state.detail !== null && this.#job.path !== '') {
            this.#job.retry();
            this.#logs.retry();
        }
    }

    async #cancel(): Promise<WriteOutcome | null> {
        const job = openJob(this.#cell.state.detail);
        if (!stoppable(job) || this.#cell.state.cancelling) {
            return null;
        }
        this.#cell.update({ cancelling: true });
        const outcome = await this.#services.store.update(
            FIRESTORE_PATHS.job(this.#services.cityId, job.id),
            { cancelRequested: true },
            null,
        );
        this.#cell.update({ cancelling: false });
        this.#report(outcome);
        return outcome;
    }

    #report(outcome: WriteOutcome): void {
        if (outcome.ok) {
            this.#services.notify({ key: 'adminContent.jobs.cancelRequested' });
            return;
        }
        if (outcome.reason === 'denied') {
            this.#services.denied();
        }
        this.#services.notify({ key: outcome.reason === 'offline' ? 'adminContent.common.offline' : 'adminContent.jobs.cancelRefused' });
    }
}

export const JOBS_MODULE: AreaModule<JobsState, JobsIntents> = {
    area: 'jobs',
    create: (services) => new JobsStore(services),
};
