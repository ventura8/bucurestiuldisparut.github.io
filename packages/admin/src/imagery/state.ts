/**
 * The Imagery area's state and intents (`docs/research/M3-interfaces.md` §10.2, §10.3): USGS's state and the city's
 * imagery settings, the search, the ranked scenes with their filters and browse images, the unfinished versions with
 * their jobs, the open scene or version, the upload, and the page's map.
 */
import { imagerySettingsOf, type ImagerySettings, type PublishChoice, type ServiceState } from '@hcm/shared';

import { LOADING_LIST, type ListState } from '../content/list.js';
import type { MapStatus } from '../layers/map-session.js';
import type { NoticeInput } from '../state/state.js';
import type { BrowseImage } from './browse.js';
import type { GuardView } from './guard.js';
import { DEFAULT_FILTERS, type JobProgress, type SceneFilters, type SceneItem, type VersionItem } from './model.js';
import { IDLE_ORDERS, type OrderActionsState } from './orders/actions.js';
import { IDLE_SEARCH, type SearchState } from './search.js';
import { IDLE_UPLOAD, type ChosenFile, type UploadState } from './upload.js';
import type { VersionPageState } from './version.js';

/** The list pane's three views: Find (the scenes), Work (in progress and waiting for you), Upload. */
type ImageryTab = 'find' | 'work' | 'upload';

/** The routed item: `#/imagery/scene/<entityId>` or `#/imagery/version/<versionId>`. */
export interface ImageryDetail {
    readonly kind: 'scene' | 'version';
    readonly id: string;
}

/** M4 (`docs/research/M4-interfaces.md` §1.7): the order card's action and refusal (`OrderActionsState`). */
export interface ImageryState extends OrderActionsState {
    readonly tab: ImageryTab;
    /** `setup/status.usgs.state` (null while reading): `missing` or `invalid` is the "set up USGS" state. */
    readonly usgs: ServiceState | null;
    readonly settings: ImagerySettings;
    readonly search: SearchState;
    readonly filters: SceneFilters;
    /** The scenes as read (free only when the filter says so, best score first). */
    readonly scenes: ListState<SceneItem>;
    /** The scenes the filters keep, in the list's order. */
    readonly visible: readonly SceneItem[];
    /** M4: the scenes that have an order, whatever the filters. */
    readonly orders: ListState<SceneItem>;
    readonly browse: Readonly<Record<string, BrowseImage>>;
    readonly versions: ListState<VersionItem>;
    /** The unfinished jobs by id (a version's job has the version's id). */
    readonly jobs: Readonly<Record<string, JobProgress>>;
    readonly detail: ImageryDetail | null;
    /** The version's page, while one is open. */
    readonly version: VersionPageState | null;
    /** The scene an Import runs for. */
    readonly importing: string | null;
    readonly importRefusal: { readonly id: string; readonly notice: NoticeInput } | null;
    readonly upload: UploadState;
    readonly map: MapStatus;
    /** The version preview's opacity on the map, 0 to 1. */
    readonly previewOpacity: number;
    /** The last footprint clicked on the map (`seq` counts the clicks): the page opens its scene. */
    readonly pickedScene: { readonly id: string; readonly seq: number } | null;
    /** `#/imagery/replace/<layerId>` (the layer editor's Replace image): the upload replaces that layer's image. */
    readonly replaceLayer: string | null;
    /** The budget guard (null while reading): paused, with the spend the alert reported (CR-M3-47). */
    readonly guard: GuardView | null;
    /** Resume processing is on its way. */
    readonly resuming: boolean;
}

export const INITIAL_IMAGERY: ImageryState = {
    ...{ tab: 'find', usgs: null, settings: imagerySettingsOf(undefined), search: IDLE_SEARCH, filters: DEFAULT_FILTERS },
    ...{ scenes: LOADING_LIST, visible: [], browse: {}, versions: LOADING_LIST, jobs: {}, detail: null, version: null },
    ...{ importing: null, importRefusal: null, upload: IDLE_UPLOAD, map: 'none', previewOpacity: 0.8, pickedScene: null },
    ...{ replaceLayer: null, guard: null, resuming: false, orders: LOADING_LIST, ...IDLE_ORDERS },
};

export interface ImageryIntents {
    setTab(tab: ImageryTab): void;
    setFilters(patch: Partial<SceneFilters>): void;
    /** Search USGS again (`imagery.search`). */
    search(): Promise<void>;
    /** The next page of scenes. */
    more(): void;
    /** Try again after a listener's failure. */
    retry(): void;
    /** `imagery.import` of a free scene: the new version's id (the page opens it), or null when refused. */
    importScene(id: string): Promise<string | null>;
    retryBrowse(id: string): void;
    approve(): Promise<boolean>;
    reject(): Promise<boolean>;
    choose(choice: PublishChoice): Promise<boolean>;
    studioDone(): Promise<boolean>;
    /** Saves the Studio file. */
    download(): Promise<boolean>;
    /** `imagery.retry` of the open version's failed job. */
    retryJob(): Promise<boolean>;
    /** Turns the budget guard green again (`imagery.resumeGuard`); true once it is. */
    resumeGuard(): Promise<boolean>;
    cancelJob(): Promise<boolean>;
    chooseFile(file: ChosenFile): Promise<void>;
    setYear(text: string): void;
    startUpload(): void;
    cancelUpload(): void;
    /** Choose another file. */
    resetUpload(): void;
    /** The preview's opacity slider, in percent. */
    setPreviewOpacity(percent: number): void;
    attachMap(container: HTMLElement): void;
    zoomBy(delta: number): void;
    /** M4: "I ordered it" (`usgs.markOrdered`); true once recorded. */
    markOrdered(id: string): Promise<boolean>;
    /** M4: "Check now" (`usgs.checkOrder`). */
    checkOrder(id: string): Promise<boolean>;
    /** M4: "Take the mark back" (`usgs.cancelOrder`). */
    cancelOrder(id: string): Promise<boolean>;
}
