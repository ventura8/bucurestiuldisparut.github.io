/**
 * What the photos page needs from the admin's photos area (`docs/research/M2c-interfaces.md` §2.3): `@hcm/ui` sits
 * below `@hcm/admin` (dependency-cruiser `ui-below-apps`), so these types mirror `packages/admin/src/photos/state.ts`
 * and the store's intents structurally; `packages/admin/test/photos/port.test.ts` checks at compile time that the real
 * store satisfies `PhotosAreaPort`. The elements render the state and call the intents; they never touch Firestore,
 * Storage or the map's library themselves.
 */
import type { AdminContentKey, ApiErrorCode, FirestoreLicense, ValidationIssue } from '@hcm/shared';

/** A live list's or document's status (`LoadStatusPort` of `content-port.ts`, which imports this file). */
type PhotosLoadStatusPort = 'loading' | 'ready' | 'error';

/** Why a listener stopped (`StoreFailurePort` of `content-port.ts`). */
interface PhotosFailurePort {
    readonly kind: 'denied' | 'unavailable' | 'failed';
    readonly code: string;
}

export type PhotoFilterPort = 'all' | 'published' | 'unpublished' | 'processing' | 'failed' | 'rightsReview';

export type PublishBlockPort = 'processing' | 'failed' | 'license' | 'place';

export type PhotoMessageKey = AdminContentKey | ApiErrorCode;

interface PhotoSearchPort {
    readonly text: string;
    readonly yearFrom: number | null;
    readonly yearTo: number | null;
}

export interface PhotoRowPort {
    readonly id: string;
    readonly title: { readonly ro: string; readonly en?: string | undefined };
    readonly year: number | null;
    readonly yearEnd: number | null;
    readonly author: string | null;
    readonly thumb: string | null;
    readonly published: boolean;
    readonly processing: 'pending' | 'done' | 'failed';
    readonly error: ApiErrorCode | null;
    readonly duplicateOf: string | null;
    readonly rightsReview: boolean;
    readonly checkPlace: boolean;
    readonly block: PublishBlockPort | null;
}

interface PhotosListPort {
    readonly status: PhotosLoadStatusPort;
    readonly reconnecting: boolean;
    readonly failure: PhotosFailurePort | null;
    readonly filter: PhotoFilterPort;
    readonly search: PhotoSearchPort;
    readonly rows: readonly PhotoRowPort[];
    readonly loaded: number;
    readonly hasMore: boolean;
    readonly selection: readonly string[];
}

export type UploadPhasePort = 'refused' | 'queued' | 'uploading' | 'processing' | 'done' | 'failed' | 'interrupted' | 'cancelled';

export interface UploadItemPort {
    readonly key: number;
    readonly name: string;
    readonly photoId: string | null;
    readonly phase: UploadPhasePort;
    readonly percent: number;
    readonly error: PhotoMessageKey | null;
    readonly params: Readonly<Record<string, string>> | null;
    readonly duplicateOf: string | null;
}

export interface StickyPort {
    readonly author?: string | undefined;
    readonly sourceLabel?: string | undefined;
    readonly sourceUrl?: string | undefined;
    readonly license?: FirestoreLicense | undefined;
    readonly rightsHolder?: string | undefined;
}

export interface LocalizedPort {
    readonly ro: string;
    readonly en?: string | undefined;
}

/** The editor's draft: the editable fields of a photo. */
export interface PhotoValuePort extends StickyPort {
    readonly title: LocalizedPort;
    readonly description?: LocalizedPort | undefined;
    readonly dateText?: LocalizedPort | undefined;
    readonly year?: number | undefined;
    readonly yearEnd?: number | undefined;
    readonly license: FirestoreLicense;
    readonly permissionNote?: string | undefined;
    readonly links?: readonly { readonly url: string; readonly label: string }[] | undefined;
    readonly location: { readonly lat: number; readonly lng: number };
    readonly bearing?: number | undefined;
    readonly fov?: number | undefined;
    readonly published: boolean;
    readonly rightsReview?: boolean | undefined;
}

type PhotoFieldPort = keyof PhotoValuePort;

/** A change of the draft; `undefined` clears an optional field. */
export type PhotoPatchPort = { readonly [K in PhotoFieldPort]?: PhotoValuePort[K] | undefined };

type SuggestionFieldPort = 'location' | 'year' | 'bearing' | 'title';

export interface SuggestionPort {
    readonly field: SuggestionFieldPort;
    readonly text: string;
    readonly outside: boolean;
}

export interface ReplacePort {
    readonly phase: 'uploading' | 'processing' | 'replaced' | 'same' | 'refused' | 'failed';
    readonly percent: number;
    readonly error: PhotoMessageKey | null;
    readonly params: Readonly<Record<string, string>> | null;
    readonly duplicateOf: string | null;
}

export interface PhotoEditorPort {
    readonly id: string;
    readonly status: 'loading' | 'ready' | 'notFound' | 'gone' | 'error';
    readonly reconnecting: boolean;
    readonly failure: PhotosFailurePort | null;
    readonly value: PhotoValuePort | null;
    readonly dirty: readonly string[];
    readonly touched: boolean;
    readonly issues: readonly ValidationIssue[];
    readonly saving: boolean;
    readonly conflict: { readonly by: string; readonly at: string; readonly fields: readonly string[] } | null;
    readonly image: { readonly web: string; readonly thumb: string; readonly w: number; readonly h: number } | null;
    readonly processing: 'pending' | 'done' | 'failed';
    readonly processingError: ApiErrorCode | null;
    readonly duplicateOf: string | null;
    readonly block: PublishBlockPort | null;
    readonly checkPlace: boolean;
    readonly suggestions: readonly SuggestionPort[];
    readonly picking: boolean;
    readonly replace: ReplacePort | null;
}

export type BulkKindPort = 'publish' | 'unpublish' | 'confirmRights' | 'setFields' | 'delete';

export interface BulkReportPort {
    readonly kind: BulkKindPort;
    readonly done: number;
    readonly skipped: readonly { readonly id: string; readonly title: string; readonly reason: string }[];
}

export type MapStatusPort = 'none' | 'loading' | 'ready' | 'unavailable' | 'no-token' | 'no-webgl' | 'failed';

export interface PhotosViewState {
    readonly list: PhotosListPort;
    readonly uploads: readonly UploadItemPort[];
    readonly sticky: StickyPort;
    readonly editor: PhotoEditorPort | null;
    readonly map: MapStatusPort;
    readonly confirm: { readonly ids: readonly string[]; readonly title: string | null } | null;
    readonly report: BulkReportPort | null;
    readonly busy: boolean;
}

/** A chosen file, as the page hands it to the area (a `File`). */
export interface PhotoFilePort {
    readonly name: string;
    readonly size: number;
    readonly data: Blob;
}

type PhotoBulkActionPort =
    | { readonly kind: 'publish' }
    | { readonly kind: 'unpublish' }
    | { readonly kind: 'confirmRights' }
    | { readonly kind: 'setFields'; readonly fields: StickyPort };

export interface PhotosIntentsPort {
    setFilter(filter: PhotoFilterPort): void;
    search(search: PhotoSearchPort): void;
    more(): void;
    retry(): void;
    toggleSelected(photoId: string): void;
    selectAll(): void;
    clearSelection(): void;
    bulk(action: PhotoBulkActionPort): Promise<void>;
    upload(files: readonly PhotoFilePort[]): void;
    retryUpload(key: number): void;
    cancelUpload(key: number): void;
    dismissUpload(key: number): void;
    clearUploads(): void;
    confirmPlace(photoId: string): void;
    confirmRights(photoId: string): Promise<void>;
    edit(patch: PhotoPatchPort): void;
    applySuggestion(field: SuggestionFieldPort): void;
    save(): Promise<boolean>;
    discard(): void;
    keepMine(): void;
    takeTheirs(): void;
    /** Try again after the open photo's listener stopped. */
    retryPhoto(): void;
    setDirection(): Promise<void>;
    cancelDirection(): void;
    pointAtCentre(): void;
    replaceImage(file: PhotoFilePort): void;
    cancelReplace(): void;
    dismissReplace(): void;
    requestDelete(ids?: readonly string[]): void;
    cancelConfirm(): void;
    confirmDelete(): Promise<boolean>;
    showReport(): void;
    closeReport(): void;
    attachMap(container: HTMLElement, open: (photoId: string) => void): void;
    detachMap(): void;
    /** The admin map box's zoom buttons: one step in (+1) or out (-1). */
    zoomBy(delta: number): void;
    focusPhoto(photoId: string): void;
}

/** The photos area as the page reads it (`AreaPort<PhotosViewState, PhotosIntentsPort>`, §2.3). */
export interface PhotosAreaPort {
    readonly state: PhotosViewState;
    subscribe(listener: (state: PhotosViewState) => void): () => void;
    readonly intents: PhotosIntentsPort;
    open(params: readonly string[]): void;
    close(): void;
}
