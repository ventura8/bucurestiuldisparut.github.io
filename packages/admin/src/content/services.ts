/**
 * What every editor area is given (`docs/research/M2c-interfaces.md` §2.2): the city it edits, Firestore through the
 * `ContentStore` port, the shell's guarded callables, the clock, `localStorage`, the logger, who is signed in, the
 * language and the shell's snackbar. The entry builds the real ones (`../index.ts`, `../firebase/content.ts`); the node
 * tests pass `FakeContentStore` of `@hcm/test-support` and the shell's fakes.
 *
 * Services one area brings for the others (the photos' resumable uploads, the pois' map factory) are members of
 * `ContentServices` too, each declared by its owner inside its own marked section below and built inside the same
 * section of `../app/content-wiring.ts`; a workstream never edits another's section (§11.2).
 */
import type { Locale, Logger, Schema, ThemeTokens, ValidationIssue } from '@hcm/shared';
import type { ThemeTokenSet } from '@hcm/ui/dynamic-color';

import type { Clock, KeyValueStore, Unsubscribe } from '../app/ports.js';
import type { CallablesPort } from '../firebase/ports.js';
import type { FilePort, PicturePort } from '../imagery/files.js';
import type { AdminMapFactory } from '../map/factory.js';
import type { UploadPort } from '../firebase/uploads.js';
import type { PushRegistrar } from '../inbox/push.js';
import type { CropToolFactory } from '../layers/geometry/types.js';
import type { NoticeInput } from '../state/state.js';

/** A page of a list: 50 documents; More asks for the next 50 (`ContentQuery.limit`). */
export const PAGE_SIZE = 50;

/** Firestore's limit of writes per batch (`ContentStore.batch`); a larger job is split by the caller. */
export const MAX_BATCH_WRITES = 500;

/** A document's fields as written (the stamp is added by the store). */
export type Fields = Readonly<Record<string, unknown>>;

/** A document as read: `version` is its `updatedAt` (ISO), `pending` a local write the server has not acknowledged yet. */
export interface Stored<T> {
    readonly id: string;
    /** `cities/bucharest/photos/abc`: a collection-group query's results come from several parents. */
    readonly path: string;
    readonly data: T;
    readonly version: string;
    readonly pending: boolean;
}

/** One answer of a list's listener. */
export interface StoredPage<T> {
    readonly docs: readonly Stored<T>[];
    /** Documents that fail their schema: left out of `docs`, named here with their issues (never shown as data). */
    readonly invalid: readonly { readonly path: string; readonly issues: readonly ValidationIssue[] }[];
    /** The query returned its whole limit: More may find others. */
    readonly hasMore: boolean;
    /** Served from the local cache while the server is unreachable (the page says "Reconnecting…"). */
    readonly fromCache: boolean;
}

/** Why a listener stopped: `denied` (the shell asks `admin.session` again), `unavailable` (offline), `failed`. */
export interface StoreFailure {
    readonly kind: 'denied' | 'unavailable' | 'failed';
    /** Firestore's code (`permission-denied`, `unavailable`, `failed-precondition`, ...). */
    readonly code: string;
}

type QueryOperator = '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in' | 'not-in' | 'array-contains';

/** A list's query: equality and range filters, the order, the limit; `group` asks every collection of that name. */
export interface ContentQuery {
    readonly where?: readonly (readonly [field: string, operator: QueryOperator, value: unknown])[];
    readonly orderBy?: readonly (readonly [field: string, direction: 'asc' | 'desc'])[];
    /** At most this many documents (`PAGE_SIZE` when absent). */
    readonly limit?: number;
    /** A collection-group query over every collection with this id (History's recent changes, CR-M2c-6). */
    readonly group?: boolean;
}

export type WriteOutcome =
    | { readonly ok: true }
    | {
          readonly ok: false;
          readonly reason: 'conflict' | 'gone' | 'denied' | 'offline' | 'invalid';
          readonly issues?: readonly ValidationIssue[];
      };

/** One write of `ContentStore.batch`. */
export type BatchWrite =
    | { readonly kind: 'create'; readonly path: string; readonly data: Fields; readonly withCreator?: boolean }
    | { readonly kind: 'update'; readonly path: string; readonly fields: Fields }
    | { readonly kind: 'delete'; readonly path: string };

/** Firestore for the editors, over the SDK (`../firebase/content.ts`, the only editor module that imports it). */
export interface ContentStore {
    /** The document and every change of it (null: missing or deleted); a schema failure is reported as `failed`. */
    watchDoc<T>(
        path: string,
        schema: Schema<T>,
        listener: (doc: Stored<T> | null) => void,
        failed: (failure: StoreFailure) => void,
    ): Unsubscribe;
    watchQuery<T>(
        collection: string,
        schema: Schema<T>,
        query: ContentQuery,
        listener: (page: StoredPage<T>) => void,
        failed: (failure: StoreFailure) => void,
    ): Unsubscribe;
    /** How many documents match (an aggregation: one read per thousand); null when the count failed. */
    count(collection: string, query: ContentQuery): Promise<number | null>;
    /**
     * One transaction: refused when the document's `updatedAt` is not `expected` (conflict) or it is gone; stamps the
     * write. `expected` null skips the version check (a job's cancellation, which a progress update must not refuse).
     */
    update(path: string, fields: Fields, expected: string | null): Promise<WriteOutcome>;
    /** Creates the document (refused when it exists), stamped, with `createdAt` (and `createdBy` when `withCreator`). */
    create(path: string, data: Fields, options?: { readonly withCreator?: boolean }): Promise<WriteOutcome>;
    /** Deletes the document; with `expected`, only when its `updatedAt` still is that version. */
    remove(path: string, expected: string | null): Promise<WriteOutcome>;
    /** At most `MAX_BATCH_WRITES` writes, all or none, each stamped; the caller splits larger jobs and reports per document. */
    batch(writes: readonly BatchWrite[]): Promise<WriteOutcome>;
    /** A new document id (`ID_PATTERN`): a new place's address before its first Save. */
    newId(): string;
}

/** A snackbar message of an area, optionally with an action (Undo for ten seconds). */
export type ContentNotice = NoticeInput;

/** Who is signed in, as an area shows it (`createdBy` and `updatedBy` stamps carry the uid). */
interface ContentUser {
    readonly uid: string;
    readonly name: string | null;
}

export interface ContentServices {
    /** `project.cities[0]`; the `e2e` build may override it with `?city=` (CR-M2c-7). */
    readonly cityId: string;
    readonly store: ContentStore;
    /** The shell's guarded callables (a revoked admin's `apiError.notAdmin` makes the shell ask who this is again). */
    readonly callables: CallablesPort;
    /** `themeFromSeed` of `@hcm/ui/dynamic-color`, injected by the entry. */
    readonly theme: (seed: string) => ThemeTokenSet;
    readonly clock: Clock;
    /** `localStorage`: the sticky photo fields and the last pin (§5.6). */
    readonly local: KeyValueStore;
    readonly log: Logger;
    /** The signed-in admin (null only after sign-out, when no area is open). */
    readonly user: () => ContentUser | null;
    readonly locale: () => Locale;
    /** The shell's snackbar. */
    readonly notify: (notice: ContentNotice) => void;
    /** A Firestore read or write was refused (`permission-denied`): the shell asks `admin.session` again (M2b §1.5). */
    readonly denied: () => void;
    /**
     * The admins' names: asks `admins.list` once a session (again after a failure) and gives them to the shell, whose
     * pages name who saved a conflicting change (`DECISIONS-for-review.md` §42c). Fire and forget.
     */
    readonly people: () => void;
    /**
     * The admin's access was removed while editing (`revoked`, §35e): the drafts take no edit any more, so nothing on the
     * page changes until sign-out (`DECISIONS-for-review.md` §42d).
     */
    readonly readOnly: () => boolean;
    /**
     * The whole admin wears `tokens` until `null` (Settings' seed colour before Save; Save, Discard, leaving Settings and
     * signing out end it): CR-M2c-28.
     */
    readonly previewTheme: (tokens: ThemeTokens | null) => void;
    // [section photos] owner: photos (`readonly uploads: UploadPort`, `../firebase/uploads.ts`)
    /** Resumable uploads to the private bucket (the photos' adapter `../firebase/uploads.ts`, §6.2). */
    readonly uploads: UploadPort;
    // [end photos]
    // [section pois] owner: pois (`readonly maps: AdminMapFactory`, `../map/`)
    /** The admin's map: one per page visit, Standard style, the admin's token, the drawing tools (`../map/factory.ts`, §3). */
    readonly maps?: AdminMapFactory | null;
    // [end pois]
    // [section imagery] owner: admin-imagery (`files`, `pictures`: `../imagery/files.ts`, docs/research/M3-interfaces.md §10)
    /** The private bucket's files the imagery screens read with the Storage SDK (`../firebase/files.ts`). */
    readonly files?: FilePort | null;
    /** Decodes an image into a canvas the admin map shows as a canvas source (`../imagery/pictures.ts`). */
    readonly pictures?: PicturePort | null;
    /** The layer editor's Crop: loads the `layer-geometry` chunk (`../layers/crop-chunk.ts`, CR-M3-7). */
    readonly layerCrop?: (() => Promise<CropToolFactory>) | null;
    // [end imagery]
    // [section inbox] owner: assists-notify (`push`: `../firebase/messaging.ts`, docs/research/M4-interfaces.md §5.4)
    /** This browser's web push: the browser's own permission prompt and its FCM token (none without push). */
    readonly push?: PushRegistrar | null;
    // [end inbox]
}

/** The members every area gets from the shell; the rest are the areas' own (`AreaServiceParts`). */
type CoreServiceKey =
    | 'cityId'
    | 'store'
    | 'callables'
    | 'theme'
    | 'clock'
    | 'local'
    | 'log'
    | 'user'
    | 'locale'
    | 'notify'
    | 'denied'
    | 'people'
    | 'readOnly'
    | 'previewTheme';

/** What the entry builds for the areas besides the shell's members (`../app/content-wiring.ts`). */
export type AreaServiceParts = Omit<ContentServices, CoreServiceKey>;
