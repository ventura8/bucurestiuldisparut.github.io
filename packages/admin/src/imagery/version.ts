/**
 * The version's page (`#/imagery/version/<versionId>`, `docs/research/M3-interfaces.md` §10.2): the version, its job
 * and the job's log lines, live, and this month's Mapbox usage (`usage/mapbox-YYYY-MM`) for the compute-unit figures;
 * and what the admin does there: Approve, Reject, a way out of a publish that does not fit the month (the free Studio
 * upload with its download and "I uploaded it", next month, or pay), Retry a failed job, Cancel an unfinished one. The
 * page asks before Reject, Pay and Cancel; every refusal stays on the card as its error code's text.
 */
import {
    FIRESTORE_PATHS,
    jobDocSchema,
    jobLogDocSchema,
    layerVersionDocSchema,
    tilesetName,
    usageDocSchema,
    usageMonth,
    type JobDoc,
    type JobLogDoc,
    type LayerVersionDoc,
    type PublishChoice,
    type UsageDoc,
} from '@hcm/shared';

import { LiveDoc, LOADING_DOC, type DocState } from '../content/doc.js';
import { isoOf, LiveList, LOADING_LIST, type ListState } from '../content/list.js';
import type { ContentServices, Stored } from '../content/services.js';
import type { NoticeInput } from '../state/state.js';
import { callImagery, refusalOf, type ImageryCallName, type ImageryRequest } from './api.js';
import type { FilePort } from './files.js';
import { jobViewOf, versionViewOf, type JobView, type VersionView } from './version-view.js';

export type VersionAction = 'approve' | 'reject' | 'choose' | 'studioDone' | 'download' | 'retry' | 'cancel';

export interface JobLogLine {
    readonly seq: number;
    readonly level: JobLogDoc['level'];
    readonly step: string | null;
    readonly message: string;
    readonly at: string;
}

export interface VersionPageState {
    readonly id: string;
    readonly version: DocState<VersionView>;
    readonly job: DocState<JobView>;
    readonly logs: ListState<JobLogLine>;
    /** This month's counters (null: none yet, the month is untouched). */
    readonly usage: UsageView | null;
    readonly acting: VersionAction | null;
    /** The last action's refusal, shown on the card. */
    readonly refusal: NoticeInput | null;
    /** The Studio file was saved (the next step is Mapbox Studio). */
    readonly downloaded: boolean;
}

const LOG_LINES = 500;

/** The month's counters as the approval card reads them (absent ones are zero). */
interface UsageView {
    readonly computeUnits: number;
    readonly computeUnitBudget: number;
    readonly overageComputeUnits: number;
    readonly reservations: Readonly<Record<string, { readonly computeUnits: number }>>;
}

function usageViewOf(usage: UsageDoc): UsageView {
    return {
        ...{ computeUnits: usage.computeUnits, computeUnitBudget: usage.computeUnitBudget },
        ...{ overageComputeUnits: usage.overageComputeUnits ?? 0, reservations: usage.reservations ?? {} },
    };
}

function logLineOf(doc: Stored<JobLogDoc>): JobLogLine {
    const line = doc.data;
    return { seq: line.seq, level: line.level, step: line.step ?? null, message: line.message, at: isoOf(line.updatedAt) };
}

function mapped<From, To>(state: DocState<From>, map: (doc: Stored<From>) => To): DocState<To> {
    return { ...state, doc: state.doc === null ? null : { ...state.doc, data: map(state.doc) } };
}

interface StudioFile {
    readonly path: string;
    readonly name: string;
}

/** The Studio file of `version`, saved as `<tileset name>.tif` so the tileset Studio makes is named after it. */
function studioFileOf(cityId: string, version: VersionView): StudioFile | null {
    const path = version.output?.studioPath ?? null;
    return path === null ? null : { path, name: `${tilesetName(cityId, version.layerId)}.tif` };
}

function usageOf(state: DocState<UsageDoc>): UsageView | null {
    return state.doc === null ? null : usageViewOf(state.doc.data);
}

function emptyVersionPage(id: string): VersionPageState {
    return { id, version: LOADING_DOC, job: LOADING_DOC, logs: LOADING_LIST, usage: null, acting: null, refusal: null, downloaded: false };
}

export class VersionPage {
    readonly #services: ContentServices;
    readonly #files: FilePort;
    readonly #changed: (state: VersionPageState | null) => void;
    readonly #version: LiveDoc<LayerVersionDoc>;
    readonly #job: LiveDoc<JobDoc>;
    readonly #usage: LiveDoc<UsageDoc>;
    readonly #logs: LiveList<JobLogDoc, JobLogLine>;
    #state: VersionPageState | null = null;

    constructor(services: ContentServices, files: FilePort, changed: (state: VersionPageState | null) => void) {
        this.#services = services;
        this.#files = files;
        this.#changed = changed;
        const { store, clock } = services;
        const denied = (): void => {
            services.denied();
        };
        const update = (): void => {
            this.#refresh();
        };
        this.#version = new LiveDoc({ store, clock, denied, schema: layerVersionDocSchema, changed: update });
        this.#job = new LiveDoc({ store, clock, denied, schema: jobDocSchema, changed: update });
        this.#usage = new LiveDoc({ store, clock, denied, schema: usageDocSchema, changed: update });
        this.#logs = new LiveList({
            ...{ store, clock, denied, collection: '', schema: jobLogDocSchema, map: logLineOf, pageSize: LOG_LINES },
            changed: update,
        });
    }

    get state(): VersionPageState | null {
        return this.#state;
    }

    /** Opens version `id` (its job has the same id); null closes the page. */
    show(id: string | null): void {
        if (id === (this.#state?.id ?? null)) {
            return;
        }
        this.close();
        if (id === null) {
            return;
        }
        const { cityId } = this.#services;
        this.#set(emptyVersionPage(id));
        this.#version.show(FIRESTORE_PATHS.layerVersion(cityId, id));
        this.#job.show(FIRESTORE_PATHS.job(cityId, id));
        this.#usage.show(FIRESTORE_PATHS.usage(usageMonth(new Date(this.#services.clock.now()))));
        this.#logs.showIn(FIRESTORE_PATHS.jobLogs(cityId, id), { orderBy: [['seq', 'asc']] });
    }

    close(): void {
        this.#version.stop();
        this.#job.stop();
        this.#usage.stop();
        this.#logs.stop();
        this.#set(null);
    }

    retryListeners(): void {
        if (this.#state !== null) {
            this.#version.retry();
            this.#job.retry();
            this.#logs.retry();
        }
    }

    approve(): Promise<boolean> {
        return this.#act('approve', 'imagery.approve', (id) => ({ cityId: this.#services.cityId, versionId: id }), {
            key: 'adminContent.imagery.notice.approved',
        });
    }

    /** Rejects a waiting version, or dismisses a failed one (the same call: CR-M3-47). */
    reject(): Promise<boolean> {
        const failed = this.#state?.version.doc?.data.state === 'failed';
        return this.#act('reject', 'imagery.reject', (id) => ({ cityId: this.#services.cityId, versionId: id }), {
            key: failed ? 'adminContent.imagery.notice.dismissed' : 'adminContent.imagery.notice.rejected',
        });
    }

    choose(choice: PublishChoice): Promise<boolean> {
        return this.#act('choose', 'imagery.choose', (id) => ({ cityId: this.#services.cityId, versionId: id, choice }), {
            key: `adminContent.imagery.notice.chose.${choice}`,
        });
    }

    studioDone(): Promise<boolean> {
        return this.#act('studioDone', 'imagery.studioDone', (id) => ({ cityId: this.#services.cityId, versionId: id }), {
            key: 'adminContent.imagery.notice.studioLinked',
        });
    }

    retry(): Promise<boolean> {
        return this.#act('retry', 'imagery.retry', (id) => ({ cityId: this.#services.cityId, jobId: id }), {
            key: 'adminContent.imagery.notice.retrying',
        });
    }

    /** Saves the Studio file under the tileset's name, so Studio names the tileset after it (§7.5). */
    async download(): Promise<boolean> {
        const file = this.#studioFile();
        if (file === null || !this.#start('download')) {
            return false;
        }
        const saved = await this.#files.save(file.path, file.name);
        this.#finish(saved ? null : { key: 'adminContent.imagery.studio.downloadFailed' }, saved);
        return saved;
    }

    /** Asks the job to stop (`cancelRequested`); the dispatcher or the pipeline ends it. */
    async cancel(): Promise<boolean> {
        const job = this.#stoppable();
        if (job === null || !this.#start('cancel')) {
            return false;
        }
        const outcome = await this.#services.store.update(
            FIRESTORE_PATHS.job(this.#services.cityId, job.id),
            { cancelRequested: true },
            null,
        );
        this.#finish(outcome.ok ? null : { key: 'adminContent.imagery.notice.cancelRefused' });
        this.#notifyIf(outcome.ok, { key: 'adminContent.jobs.cancelRequested' });
        return outcome.ok;
    }

    /** The open version's Studio file and the name it is saved under, when the export made one. */
    #studioFile(): StudioFile | null {
        const version = this.#state?.version.doc?.data ?? null;
        return version === null ? null : studioFileOf(this.#services.cityId, version);
    }

    /** The open job, when it may still be asked to stop. */
    #stoppable(): JobView | null {
        const job = this.#openJob();
        return job === null || job.finished || job.cancelRequested || job.atMapbox ? null : job;
    }

    #openJob(): JobView | null {
        return this.#state?.job.doc?.data ?? null;
    }

    async #act<N extends ImageryCallName>(
        action: VersionAction,
        name: N,
        request: (id: string) => ImageryRequest<N>,
        done: NoticeInput,
    ): Promise<boolean> {
        const id = this.#state?.id;
        if (id === undefined || !this.#start(action)) {
            return false;
        }
        try {
            await callImagery(this.#services.callables, name, request(id));
            this.#finish(null);
            this.#services.notify(done);
            return true;
        } catch (error) {
            this.#finish(refusalOf(error));
            return false;
        }
    }

    /** Starts `action` unless another one runs. */
    #start(action: VersionAction): boolean {
        const state = this.#state;
        if (state?.acting !== null) {
            return false;
        }
        this.#set({ ...state, acting: action, refusal: null });
        return true;
    }

    #finish(refusal: NoticeInput | null, downloaded = false): void {
        const state = this.#state;
        if (state !== null) {
            this.#set({ ...state, acting: null, refusal, downloaded: state.downloaded || downloaded });
        }
    }

    #notifyIf(condition: boolean, notice: NoticeInput): void {
        if (condition) {
            this.#services.notify(notice);
        }
    }

    #refresh(): void {
        const state = this.#state;
        if (state === null) {
            return;
        }
        this.#set({
            ...state,
            version: mapped(this.#version.state, versionViewOf),
            job: mapped(this.#job.state, jobViewOf),
            logs: this.#logs.list,
            usage: usageOf(this.#usage.state),
        });
    }

    #set(state: VersionPageState | null): void {
        this.#state = state;
        this.#changed(state);
    }
}
