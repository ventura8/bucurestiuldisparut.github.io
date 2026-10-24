/**
 * The dashboard (`#/home`, the M2c brief's "dashboard home"; `docs/research/M2c-interfaces.md` §13, CR-M2c-24): what
 * the city holds (photos, places, categories, layers), what waits for an admin (photos in rights review, unpublished
 * photos, unfinished and failed jobs, from M3 the layer versions to approve or to georeference), the integrations' health from `setup/status` (one chip per Setup area, live) and
 * the public map's state from `manifests/{city}` (live). Counts are Firestore aggregations (one read per thousand
 * documents), counted when the page opens and on Refresh.
 */
import {
    FIRESTORE_PATHS,
    manifestStateDocSchema,
    SETUP_AREAS,
    setupStatusDocSchema,
    type ManifestStateDoc,
    type ServiceState,
    type SetupArea,
    type SetupStatusDoc,
} from '@hcm/shared';

import type { AreaModule, AreaStore } from '../content/areas.js';
import { LiveDoc, LOADING_DOC, type DocState } from '../content/doc.js';
import { isoOf, type LoadStatus } from '../content/list.js';
import type { ContentQuery, ContentServices } from '../content/services.js';
import { ACTIVE_JOB_STATUSES } from '../jobs/jobs.js';
import type { NoticeInput } from '../state/state.js';
import { Store } from '../state/store.js';

/** What the dashboard counts, in the order it shows them. */
const HOME_COUNTS = [
    ...['photos', 'pois', 'categories', 'layers', 'rightsReviews', 'unpublishedPhotos', 'activeJobs', 'failedJobs'],
    // M3 (admin-imagery): the layer versions waiting for an admin, an approval or georeferencing points.
    ...['versionsToApprove', 'versionsNeedingPoints'],
] as const;

type HomeCount = (typeof HOME_COUNTS)[number];

/** Each count's collection and condition. */
const COUNT_QUERIES: Readonly<Record<HomeCount, { readonly collection: (cityId: string) => string; readonly query: ContentQuery }>> = {
    photos: { collection: FIRESTORE_PATHS.photos, query: {} },
    pois: { collection: FIRESTORE_PATHS.pois, query: {} },
    categories: { collection: FIRESTORE_PATHS.poiCategories, query: {} },
    layers: { collection: FIRESTORE_PATHS.layers, query: {} },
    rightsReviews: { collection: FIRESTORE_PATHS.photos, query: { where: [['rightsReview', '==', true]] } },
    unpublishedPhotos: { collection: FIRESTORE_PATHS.photos, query: { where: [['published', '==', false]] } },
    activeJobs: { collection: FIRESTORE_PATHS.jobs, query: { where: [['status', 'in', ACTIVE_JOB_STATUSES]] } },
    failedJobs: { collection: FIRESTORE_PATHS.jobs, query: { where: [['status', '==', 'failed']] } },
    versionsToApprove: { collection: FIRESTORE_PATHS.layerVersions, query: { where: [['state', '==', 'awaiting_approval']] } },
    versionsNeedingPoints: { collection: FIRESTORE_PATHS.layerVersions, query: { where: [['state', '==', 'needs_gcps']] } },
};

/** One integration's chip: its Setup area, its state (`missing` until it was ever checked) and why. */
export interface HealthChip {
    readonly area: SetupArea;
    readonly state: ServiceState;
    readonly detail: NoticeInput | null;
}

/** A document the last manifest build left out, with its first issue (`manifests/{city}.skipped`). */
interface SkippedDocument {
    readonly entity: NonNullable<ManifestStateDoc['skipped']>[number]['entity'];
    readonly id: string;
    readonly code: NonNullable<ManifestStateDoc['skipped']>[number]['code'];
    readonly path: string;
}

/** The public map: the build's state, when it last published, the documents it left out (S-A38-BAD-SKIPPED-SHOWN). */
export interface PublicMapState {
    readonly status: ManifestStateDoc['status'];
    readonly builtAt: string | null;
    readonly skipped: readonly SkippedDocument[];
    readonly error: NoticeInput | null;
}

/** `setup/status` as chips (nothing checked yet: every chip `missing`). */
interface HealthState {
    readonly status: LoadStatus;
    readonly chips: readonly HealthChip[];
    readonly reconnecting: boolean;
}

export interface HomeState {
    readonly countsStatus: LoadStatus;
    /** Null for a count that failed (shown as a dash). */
    readonly counts: Readonly<Record<HomeCount, number | null>> | null;
    readonly health: HealthState;
    /** `manifests/{city}` (`doc` null: never built). */
    readonly publicMap: DocState<PublicMapState>;
}

export interface HomeIntents {
    /** Counts again (the live parts follow by themselves). */
    refresh(): Promise<void>;
    /** Try again after a listener's failure. */
    retry(): void;
}

const INITIAL: HomeState = {
    countsStatus: 'loading',
    counts: null,
    health: { status: 'loading', chips: [], reconnecting: false },
    publicMap: LOADING_DOC,
};

type HealthRecord = NonNullable<SetupStatusDoc[SetupArea]>;

function detailOf(record: HealthRecord | undefined): NoticeInput | null {
    if (record?.detail === undefined) {
        return null;
    }
    return record.params === undefined ? { key: record.detail } : { key: record.detail, params: record.params };
}

/** One chip per Setup area, in screen order. */
export function healthChipsOf(status: SetupStatusDoc | null): readonly HealthChip[] {
    return SETUP_AREAS.map((area) => {
        const record = status?.[area];
        return { area, state: record?.state ?? 'missing', detail: detailOf(record) };
    });
}

export function publicMapOf(manifest: ManifestStateDoc): PublicMapState {
    return {
        status: manifest.status,
        builtAt: manifest.builtAt === undefined ? null : isoOf(manifest.builtAt),
        skipped: manifest.skipped ?? [],
        error: manifest.error === undefined ? null : { key: manifest.error },
    };
}

function mapDoc<From, To>(state: DocState<From>, map: (data: From) => To): DocState<To> {
    return { ...state, doc: state.doc === null ? null : { ...state.doc, data: map(state.doc.data) } };
}

class HomeStore implements AreaStore<HomeState, HomeIntents> {
    readonly #services: ContentServices;
    readonly #cell: Store<HomeState>;
    readonly #status: LiveDoc<SetupStatusDoc>;
    readonly #manifest: LiveDoc<ManifestStateDoc>;
    #counting = 0;
    readonly intents: HomeIntents;

    constructor(services: ContentServices) {
        this.#services = services;
        this.#cell = new Store<HomeState>(INITIAL, services.log);
        const { store, clock } = services;
        const denied = (): void => {
            services.denied();
        };
        this.#status = new LiveDoc({
            ...{ store, clock, denied, schema: setupStatusDocSchema },
            changed: (state) => {
                this.#cell.update({
                    health: { status: state.status, chips: healthChipsOf(state.doc?.data ?? null), reconnecting: state.reconnecting },
                });
            },
        });
        this.#manifest = new LiveDoc({
            ...{ store, clock, denied, schema: manifestStateDocSchema },
            changed: (state) => {
                this.#cell.update({ publicMap: mapDoc(state, publicMapOf) });
            },
        });
        this.intents = {
            refresh: () => this.#count(),
            retry: () => {
                this.#status.retry();
                this.#manifest.retry();
                void this.#count();
            },
        };
    }

    get state(): HomeState {
        return this.#cell.state;
    }

    subscribe(listener: (state: HomeState) => void): () => void {
        return this.#cell.subscribe(listener);
    }

    open(): void {
        if (this.#status.path === '') {
            this.#status.show(FIRESTORE_PATHS.setupStatus);
            this.#manifest.show(FIRESTORE_PATHS.manifestState(this.#services.cityId));
            void this.#count();
        }
    }

    close(): void {
        this.#status.stop();
        this.#manifest.stop();
    }

    hasUnsavedChanges(): boolean {
        return false;
    }

    destroy(): void {
        this.close();
        this.#counting += 1;
        this.#cell.update(INITIAL);
    }

    async #count(): Promise<void> {
        this.#counting += 1;
        const run = this.#counting;
        this.#cell.update({ countsStatus: 'loading' });
        const { store, cityId } = this.#services;
        const values = await Promise.all(
            HOME_COUNTS.map((name) => store.count(COUNT_QUERIES[name].collection(cityId), COUNT_QUERIES[name].query)),
        );
        if (run === this.#counting) {
            const counts = Object.fromEntries(HOME_COUNTS.map((name, index) => [name, values[index] ?? null])) as Record<
                HomeCount,
                number | null
            >;
            this.#cell.update({ counts, countsStatus: values.every((value) => value === null) ? 'error' : 'ready' });
        }
    }
}

export const HOME_MODULE: AreaModule<HomeState, HomeIntents> = {
    area: 'home',
    create: (services) => new HomeStore(services),
};
