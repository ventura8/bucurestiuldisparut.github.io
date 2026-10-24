/**
 * The Imagery area (`#/imagery`, `docs/research/M3-interfaces.md` §1, §10.2; behaviours A11, A12, A14, A17, A42): the
 * USGS scenes ranked for the city with their footprints and browse images, Import in one click, the unfinished versions
 * with their jobs' progress (in progress, or waiting for the admin), a version's page with the approval card and the
 * compute-unit choices, and the GeoTIFF upload. The happy path is search (by itself when the harvest is stale), Import,
 * then nothing: the pipeline georeferences and the policy publishes under the city's threshold.
 */
import { isId, type PublishChoice } from '@hcm/shared';

import type { AreaModule, AreaStore } from '../content/areas.js';
import type { ContentServices } from '../content/services.js';
import { Store } from '../state/store.js';
import { callImagery, refusalOf } from './api.js';
import { BrowseImages } from './browse.js';
import { ImageryFeeds, type FeedsPatch } from './feeds.js';
import { resumeGuard } from './guard.js';
import { NO_FILES } from './files.js';
import { BROWSE_PICTURE, ImageryMap, PREVIEW_PICTURE, sceneCorners } from './imagery-map.js';
import { visibleScenes, type SceneFilters, type SceneItem } from './model.js';
import { cornersOfBox } from './overlay.js';
import { HarvestSearch } from './search.js';
import { INITIAL_IMAGERY, type ImageryDetail, type ImageryIntents, type ImageryState } from './state.js';
import { RasterUploader } from './upload.js';
import { VersionPage, type VersionPageState } from './version.js';
import type { VersionView } from './version-view.js';

/** The routed item of `#/imagery/<kind>/<id>`, or null for the area alone (or an address that names none). */
export function detailOf(params: readonly string[]): ImageryDetail | null {
    const [kind, id] = params;
    return isDetailKind(kind) && isId(id) ? { kind, id } : null;
}

/** The layer of `#/imagery/replace/<layerId>` (the layer editor's Replace image), or null. */
export function replaceOf(params: readonly string[]): string | null {
    const [kind, id] = params;
    return kind === 'replace' && isId(id) ? id : null;
}

function isDetailKind(kind: string | undefined): kind is ImageryDetail['kind'] {
    return kind === 'scene' || kind === 'version';
}

/** The same routed item (or none on both sides). */
function sameDetail(a: ImageryDetail | null, b: ImageryDetail | null): boolean {
    return a === b || (a !== null && b !== null && a.kind === b.kind && a.id === b.id);
}

/** The preview a version's page shows on the map (`<version>@<path>`), when its output exists. */
function previewOf(version: VersionPageState | null): { readonly key: string; readonly output: NonNullable<VersionView['output']> } | null {
    if (version === null) {
        return null;
    }
    const output = version.version.doc?.data.output ?? null;
    return output === null ? null : { key: `${version.id}@${output.previewPath}`, output };
}

class ImageryStore implements AreaStore<ImageryState, ImageryIntents> {
    readonly #services: ContentServices;
    readonly #cell: Store<ImageryState>;
    readonly #feeds: ImageryFeeds;
    readonly #search: HarvestSearch;
    readonly #browse: BrowseImages;
    readonly #uploader: RasterUploader;
    readonly #version: VersionPage;
    readonly #map: ImageryMap;
    #newest: string | null | undefined = undefined;
    /** The preview on the map now (`<version>@<path>`), '' for none. */
    #previewShown = '';
    readonly intents: ImageryIntents;

    constructor(services: ContentServices) {
        this.#services = services;
        this.#cell = new Store<ImageryState>(INITIAL_IMAGERY, services.log);
        const files = services.files ?? NO_FILES;
        this.#feeds = new ImageryFeeds(services, (patch) => {
            this.#fed(patch);
        });
        this.#search = new HarvestSearch(services, (search) => {
            this.#cell.update({ search });
        });
        this.#browse = new BrowseImages(services, files, (browse) => {
            this.#cell.update({ browse });
        });
        this.#uploader = new RasterUploader(services, services.uploads, (upload) => {
            this.#cell.update({ upload });
        });
        this.#version = new VersionPage(services, files, (version) => {
            this.#versionChanged(version);
        });
        this.#map = new ImageryMap({
            ...{ maps: services.maps ?? null, locale: services.locale, files, pictures: services.pictures ?? null },
            status: (map) => {
                this.#cell.update({ map });
            },
            picked: (id) => {
                this.#picked(id);
            },
        });
        this.intents = this.#intents();
    }

    get state(): ImageryState {
        return this.#cell.state;
    }

    subscribe(listener: (state: ImageryState) => void): () => void {
        return this.#cell.subscribe(listener);
    }

    open(params: readonly string[]): void {
        if (!this.#feeds.active) {
            this.#feeds.start(this.#cell.state.filters.freeOnly);
        }
        const replaceLayer = replaceOf(params);
        this.#cell.update(replaceLayer === null ? { replaceLayer } : { replaceLayer, tab: 'upload' });
        this.#select(detailOf(params));
    }

    close(): void {
        this.#feeds.stop();
        this.#select(null);
        this.#browse.clear();
        this.#map.detach();
    }

    hasUnsavedChanges(): boolean {
        return false;
    }

    destroy(): void {
        this.close();
        this.#uploader.reset();
    }

    #intents(): ImageryIntents {
        const resumeGuard = (): Promise<boolean> => this.#resumeGuard();
        return { ...this.#findIntents(), ...this.#versionIntents(), ...this.#uploadIntents(), resumeGuard };
    }

    /** Find: the tabs, the filters, the search, the scenes and their import. */
    #findIntents(): Pick<ImageryIntents, 'setTab' | 'setFilters' | 'search' | 'more' | 'retry' | 'importScene' | 'retryBrowse'> {
        return {
            setTab: (tab) => {
                this.#cell.update({ tab });
            },
            setFilters: (patch) => {
                this.#setFilters(patch);
            },
            search: () => this.#search.search(),
            more: () => {
                this.#feeds.moreScenes();
            },
            retry: () => {
                this.#retry();
            },
            importScene: (id) => this.#import(id),
            retryBrowse: (id) => {
                this.#retryBrowse(id);
            },
        };
    }

    /** The version's page: its decisions, its job, its preview on the map. */
    #versionIntents(): Pick<
        ImageryIntents,
        | 'approve'
        | 'reject'
        | 'choose'
        | 'studioDone'
        | 'download'
        | 'retryJob'
        | 'cancelJob'
        | 'setPreviewOpacity'
        | 'attachMap'
        | 'zoomBy'
    > {
        const version = this.#version;
        return {
            ...{
                approve: () => version.approve(),
                reject: () => version.reject(),
                choose: (choice: PublishChoice) => version.choose(choice),
            },
            ...{ studioDone: () => version.studioDone(), download: () => version.download(), retryJob: () => version.retry() },
            cancelJob: () => version.cancel(),
            setPreviewOpacity: (percent) => {
                this.#setOpacity(percent);
            },
            attachMap: (container) => {
                this.#map.attach(container);
            },
            zoomBy: (delta) => {
                this.#map.zoomBy(delta);
            },
        };
    }

    /** The GeoTIFF upload. */
    #uploadIntents(): Pick<ImageryIntents, 'chooseFile' | 'setYear' | 'startUpload' | 'cancelUpload' | 'resetUpload'> {
        const uploader = this.#uploader;
        return {
            chooseFile: (file) => uploader.choose(file, this.#cell.state.replaceLayer),
            setYear: (text) => {
                uploader.setYear(text);
            },
            startUpload: () => {
                uploader.start();
            },
            cancelUpload: () => {
                uploader.cancel();
            },
            resetUpload: () => {
                uploader.reset();
            },
        };
    }

    #fed(patch: FeedsPatch): void {
        const { frame, newest, ...rest } = patch;
        if (frame !== undefined) {
            this.#map.setFrame(frame);
        }
        if (newest !== undefined) {
            this.#newest = newest;
        }
        this.#cell.update(rest);
        if (rest.scenes !== undefined) {
            this.#scenesChanged();
        }
        this.#search.known(this.#cell.state.usgs, this.#newest);
    }

    #setFilters(patch: Partial<SceneFilters>): void {
        const before = this.#cell.state.filters;
        const filters = { ...before, ...patch };
        this.#cell.update({ filters });
        if (filters.freeOnly !== before.freeOnly) {
            this.#feeds.showScenes(filters.freeOnly);
        }
        this.#scenesChanged();
    }

    /** The filters or the scenes changed: the list, its thumbnails and the map follow. */
    #scenesChanged(): void {
        const state = this.#cell.state;
        const visible = visibleScenes(state.scenes.items, state.filters);
        this.#cell.update({ visible });
        this.#browse.thumbnails(visible);
        this.#showFind();
    }

    #select(detail: ImageryDetail | null): void {
        if (sameDetail(detail, this.#cell.state.detail)) {
            return;
        }
        this.#cell.update({ detail, importRefusal: null });
        this.#map.clearPictures();
        this.#previewShown = '';
        this.#version.show(detail?.kind === 'version' ? detail.id : null);
        this.#showFind();
    }

    /** The scene the route names, once the list has it. */
    #selectedScene(): SceneItem | null {
        const detail = this.#cell.state.detail;
        return detail?.kind === 'scene' ? (this.#cell.state.scenes.items.find((scene) => scene.id === detail.id) ?? null) : null;
    }

    /** Find's map: the footprints, the selected scene and its browse image. */
    #showFind(): void {
        if (this.#cell.state.detail?.kind === 'version') {
            return;
        }
        const scene = this.#selectedScene();
        this.#map.showScenes(this.#cell.state.visible, scene);
        if (scene !== null && !this.#map.overlays.has(BROWSE_PICTURE)) {
            void this.#browse.open(scene).then(() => this.#showBrowse(scene));
        }
    }

    async #showBrowse(scene: SceneItem): Promise<void> {
        const path = this.#browse.pathOf(scene.id);
        if (path !== null && this.#selectedScene()?.id === scene.id) {
            await this.#map.showPicture(BROWSE_PICTURE, path, sceneCorners(scene), 1);
        }
    }

    #retryBrowse(id: string): void {
        const scene = this.#cell.state.scenes.items.find((candidate) => candidate.id === id);
        if (scene !== undefined) {
            void this.#browse.retry(scene).then(() => this.#showBrowse(scene));
        }
    }

    async #import(id: string): Promise<string | null> {
        if (this.#cell.state.importing !== null) {
            return null;
        }
        this.#cell.update({ importing: id, importRefusal: null });
        try {
            const answer = await callImagery(this.#services.callables, 'imagery.import', { cityId: this.#services.cityId, entityId: id });
            this.#cell.update({ importing: null });
            this.#services.notify({ key: 'adminContent.imagery.notice.imported' });
            return answer.versionId;
        } catch (error) {
            this.#cell.update({ importing: null, importRefusal: { id, notice: refusalOf(error) } });
            return null;
        }
    }

    #versionChanged(version: VersionPageState | null): void {
        this.#cell.update({ version });
        const preview = previewOf(version);
        if (preview !== null && preview.key !== this.#previewShown) {
            const { output } = preview;
            this.#previewShown = preview.key;
            this.#map.fitBox(output.bounds);
            void this.#map.showPicture(PREVIEW_PICTURE, output.previewPath, cornersOfBox(output.bounds), this.#cell.state.previewOpacity);
        }
    }

    /** A footprint was clicked on the map: the page opens that scene (`pickedScene`). */
    #picked(id: string): void {
        const seq = (this.#cell.state.pickedScene?.seq ?? 0) + 1;
        this.#cell.update({ pickedScene: { id, seq } });
    }

    #setOpacity(percent: number): void {
        const previewOpacity = Math.min(100, Math.max(0, Math.round(percent))) / 100;
        this.#cell.update({ previewOpacity });
        this.#map.overlays.setOpacity(PREVIEW_PICTURE, previewOpacity);
    }

    #retry(): void {
        this.#feeds.retry();
        this.#version.retryListeners();
    }

    /** The budget guard's Resume processing (the page asks first). */
    async #resumeGuard(): Promise<boolean> {
        if (this.#cell.state.resuming) {
            return false;
        }
        this.#cell.update({ resuming: true });
        const resumed = await resumeGuard(this.#services);
        this.#cell.update({ resuming: false });
        return resumed;
    }
}

export const IMAGERY_MODULE: AreaModule<ImageryState, ImageryIntents> = {
    area: 'imagery',
    create: (services) => new ImageryStore(services),
};
