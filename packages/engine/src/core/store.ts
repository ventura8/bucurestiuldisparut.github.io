/**
 * The viewer store (docs/research/M1-interfaces.md §6): one observable state, the actions that change it, and the
 * map, the URL hash, the stored preferences and telemetry kept in step with it. Pure transitions live in `state.ts`,
 * `url-sync.ts` and the overlay model of @hcm/shared; the boot sequence (manifest, hash, preferences, map) is in
 * `boot.ts`. Every action ignores what it cannot apply (an unknown id, a call before the manifest) instead of throwing.
 */
import {
    clamp,
    DEFAULT_COMPARE_POSITION,
    findOverlay,
    withOverlayOpacity,
    withOverlayVisibility,
    type DecodedHash,
    type Locale,
    type MapView,
    type MessageKey,
} from '@hcm/shared';
import { isCompactHeight, windowClassFor } from '@hcm/ui';
import { Listeners, type Unsubscribe } from '@hcm/ui/map';

import { Boot, type BootHost } from './boot.js';
import { CompareDriver, type CompareDriverHost } from './compare-driver.js';
import type { MountedMap } from './compare-port.js';
import type { ViewerDeps } from './deps.js';
import { Preferences } from './preferences.js';
import { isCompareLayer, withYear, type SheetName, type ThemeMode, type ViewerState } from './state.js';
import { encodeViewerHash, HashWriter } from './url-sync.js';

export type { ViewerDeps, ViewerLocation } from './deps.js';
export { PHOTO_YEAR_WINDOW } from './timeline.js';
export type { SheetName, ThemeMode, ViewerError, ViewerState, ViewerStatus } from './state.js';

export interface ViewerActions {
    /** Fetch (or take the inline) manifest, check compat, validate, mount the map; errors land in state.error. */
    load(): Promise<void>;
    retry(): Promise<void>;
    setLocale(locale: Locale): void;
    setYear(year: number | null): void;
    /** Any overlay id (layer, `photos`, POI category); without `visible` it toggles. The map follows. */
    toggleOverlay(overlayId: string, visible?: boolean): void;
    /** Live: the map follows on the next animation frame; `final` (slider released) also writes the hash. */
    setOverlayOpacity(overlayId: string, opacity: number, final?: boolean): void;
    openPhoto(photoId: string | null): void;
    /** Opens the POI's details in the detail sheet (`sheet: 'poi'`); null closes; an unknown id is ignored. */
    openPoi(poiId: string | null): void;
    setLightbox(open: boolean): void;
    openSheet(sheet: SheetName): void;
    /** Records the map's view (the `moveend` path); the camera does not move. */
    setView(view: MapView): void;
    /** Moves the camera to `view` (animated unless reduced motion) and records it: "show my location" (CR-17). */
    flyTo(view: MapView): void;
    /** The visitor shared the page (Web Share or the clipboard): the `share` analytics event (CR-17). */
    logShare(): void;
    setWindowSize(width: number, height: number): void;
    setTheme(theme: ThemeMode): void;
    setConsent(consent: 'granted' | 'denied'): void;
    showToast(key: MessageKey, params?: Readonly<Record<string, string>>): void;
    dismissToast(): void;
    /**
     * Applies a decoded URL hash (on load and on `hashchange`; decoded with the manifest's overlay ids as
     * `overlayIds`); opacities through `withHashOpacity`; unknown ids are ignored, an unknown photo shows a toast.
     */
    applyHash(hash: DecodedHash): void;
    /**
     * M4 (V06): compares the map with `layerId` (null: today) as the main side; a layer the manifest does not have is
     * ignored; `position` places the divider (default: where it was, else the middle). While open it changes the side.
     */
    openCompare(layerId: string | null, position?: number): void;
    /** M4: the divider's settled place (0 to 1, clamped); nothing while compare is closed. */
    setComparePosition(position: number): void;
    /** M4: closes compare; its second map goes with it. */
    closeCompare(): void;
}

export interface ViewerStore extends ViewerActions {
    getState(): ViewerState;
    subscribe(listener: (state: ViewerState, previous: ViewerState) => void): Unsubscribe;
    destroy(): void;
}

function hasPoi(state: ViewerState, poiId: string): boolean {
    return (state.manifest?.pois ?? []).some((poi) => poi.id === poiId);
}

function sheetAfterClosing(sheet: SheetName, closed: SheetName): SheetName {
    return sheet === closed ? 'none' : sheet;
}

/** Where compare's divider settles: `position` (clamped), else where it was, else the middle. */
function comparePosition(state: ViewerState, position: number | undefined): number {
    return clamp(position ?? state.compare?.position ?? DEFAULT_COMPARE_POSITION, 0, 1);
}

class Store implements ViewerStore, BootHost, CompareDriverHost {
    readonly deps: ViewerDeps;
    readonly preferences: Preferences;
    readonly hash: HashWriter;
    readonly #listeners: Listeners<[ViewerState, ViewerState]>;
    readonly #boot: Boot;
    readonly #compare: CompareDriver;
    readonly #unsubscribe: Unsubscribe[] = [];
    #state: ViewerState;
    #destroyed = false;

    constructor(deps: ViewerDeps) {
        this.deps = deps;
        this.preferences = new Preferences(deps.storage, deps.log);
        this.#listeners = new Listeners((error) => {
            deps.log.error('state listener failed', { error: String(error) });
        });
        this.#boot = new Boot(this);
        this.#compare = new CompareDriver(this);
        this.#state = this.#boot.initialState();
        this.hash = new HashWriter(deps.location, () => encodeViewerHash(this.#state, this.#boot.defaultLocale));
        this.#unsubscribe.push(
            deps.telemetry.onConsentChange((consent) => {
                this.set({ ...this.#state, consent });
            }),
        );
        const onHash = deps.location.subscribe?.(() => {
            this.#boot.applyLocationHash();
        });
        if (onHash !== undefined) {
            this.#unsubscribe.push(onHash);
        }
    }

    get destroyed(): boolean {
        return this.#destroyed;
    }

    getState(): ViewerState {
        return this.#state;
    }

    /** The one place the state changes: the map follows, then the subscribers, then telemetry's context. */
    set(next: ViewerState): void {
        const previous = this.#state;
        if (next === previous || this.#destroyed) {
            return;
        }
        this.#state = next;
        this.#boot.followState(previous, next);
        this.#compare.follow(next);
        this.#listeners.emit(next, previous);
    }

    mountedMap(): MountedMap | null {
        return this.#boot.mountedMap();
    }

    subscribe(listener: (state: ViewerState, previous: ViewerState) => void): Unsubscribe {
        return this.#listeners.add(listener);
    }

    load(): Promise<void> {
        return this.#boot.load();
    }

    retry(): Promise<void> {
        return this.#boot.load();
    }

    setLocale(locale: Locale): void {
        if (locale === this.#state.locale) {
            return;
        }
        this.set({ ...this.#state, locale });
        this.preferences.set(this.#state.manifest?.city.id ?? this.deps.config.cityId, 'lang', locale);
        this.hash.schedule();
    }

    setYear(year: number | null): void {
        const next = withYear(this.#state, year);
        if (next === this.#state) {
            return;
        }
        const changed = next.year !== this.#state.year;
        this.set(next);
        if (changed) {
            this.deps.telemetry.logEvent({ name: 'year_change', year: next.year });
        }
        this.hash.schedule();
    }

    toggleOverlay(overlayId: string, visible?: boolean): void {
        const overlays = withOverlayVisibility(this.#state.overlays, overlayId, visible);
        const overlay = findOverlay(overlays, overlayId);
        if (overlays === this.#state.overlays || overlay === undefined) {
            return;
        }
        this.set({ ...this.#state, overlays });
        this.deps.telemetry.logEvent({ name: 'layer_toggle', layerId: overlayId, visible: overlay.visible });
        this.hash.schedule();
    }

    setOverlayOpacity(overlayId: string, opacity: number, final = false): void {
        const overlays = withOverlayOpacity(this.#state.overlays, overlayId, opacity);
        if (overlays !== this.#state.overlays) {
            this.set({ ...this.#state, overlays });
        }
        if (final) {
            this.hash.schedule();
        }
    }

    openPhoto(photoId: string | null): void {
        const state = this.#state;
        if (photoId === null) {
            this.set({ ...state, selectedPhotoId: null, lightbox: false, sheet: sheetAfterClosing(state.sheet, 'photo') });
        } else if (state.manifest?.photos.some((photo) => photo.id === photoId) !== true) {
            this.showToast('error.unknownPhoto');
            return;
        } else if (photoId !== state.selectedPhotoId) {
            this.set({ ...state, selectedPhotoId: photoId, selectedPoiId: null, lightbox: false, sheet: 'photo' });
            this.deps.telemetry.logEvent({ name: 'photo_open', photoId });
        }
        this.hash.schedule();
    }

    openPoi(poiId: string | null): void {
        const state = this.#state;
        if (poiId === null) {
            this.set({ ...state, selectedPoiId: null, sheet: sheetAfterClosing(state.sheet, 'poi') });
            return;
        }
        if (poiId === state.selectedPoiId || !hasPoi(state, poiId)) {
            return;
        }
        this.set({ ...state, selectedPoiId: poiId, selectedPhotoId: null, lightbox: false, sheet: 'poi' });
        this.deps.telemetry.logEvent({ name: 'poi_open', poiId });
        this.hash.schedule();
    }

    setLightbox(open: boolean): void {
        if (!open || this.#state.selectedPhotoId !== null) {
            this.set(open === this.#state.lightbox ? this.#state : { ...this.#state, lightbox: open });
        }
    }

    openSheet(sheet: SheetName): void {
        const state = this.#state;
        if (sheet === state.sheet) {
            return;
        }
        const keepPhoto = sheet === 'photo' ? state.selectedPhotoId : null;
        const keepPoi = sheet === 'poi' ? state.selectedPoiId : null;
        this.set({ ...state, sheet, selectedPhotoId: keepPhoto, selectedPoiId: keepPoi, lightbox: false });
        this.hash.schedule();
    }

    setView(view: MapView): void {
        this.set({ ...this.#state, view });
        this.hash.schedule();
    }

    flyTo(view: MapView): void {
        this.#boot.flyMap(view);
        this.setView(view);
    }

    logShare(): void {
        this.deps.telemetry.logEvent({ name: 'share' });
    }

    setWindowSize(width: number, height: number): void {
        const windowClass = windowClassFor(width);
        const compactHeight = isCompactHeight(height);
        const state = this.#state;
        if (windowClass !== state.windowClass || compactHeight !== state.compactHeight) {
            this.set({ ...state, windowClass, compactHeight });
        }
    }

    setTheme(theme: ThemeMode): void {
        if (theme !== this.#state.theme) {
            this.set({ ...this.#state, theme });
            this.preferences.set(this.#state.manifest?.city.id ?? this.deps.config.cityId, 'theme', theme);
        }
    }

    setConsent(consent: 'granted' | 'denied'): void {
        this.deps.telemetry.setConsent(consent);
    }

    showToast(key: MessageKey, params?: Readonly<Record<string, string>>): void {
        this.set({ ...this.#state, toast: params === undefined ? { key } : { key, params } });
    }

    dismissToast(): void {
        if (this.#state.toast !== null) {
            this.set({ ...this.#state, toast: null });
        }
    }

    applyHash(hash: DecodedHash): void {
        this.#boot.applyHash(hash);
    }

    openCompare(layerId: string | null, position?: number): void {
        const state = this.#state;
        if (state.manifest === null || !isCompareLayer(state.manifest, layerId)) {
            return;
        }
        this.set({ ...state, compare: { layerId, position: comparePosition(state, position) } });
        if (state.compare === null) {
            this.deps.telemetry.logEvent({ name: 'compare_open' });
        }
        this.hash.schedule();
    }

    setComparePosition(position: number): void {
        const compare = this.#state.compare;
        const settled = clamp(position, 0, 1);
        if (compare !== null && settled !== compare.position) {
            this.set({ ...this.#state, compare: { ...compare, position: settled } });
            this.hash.schedule();
        }
    }

    closeCompare(): void {
        if (this.#state.compare !== null) {
            this.set({ ...this.#state, compare: null });
            this.hash.schedule();
        }
    }

    destroy(): void {
        if (this.#destroyed) {
            return;
        }
        this.#destroyed = true;
        this.hash.cancel();
        this.#compare.destroy();
        this.#boot.destroy();
        for (const unsubscribe of this.#unsubscribe) {
            unsubscribe();
        }
        this.#listeners.clear();
        this.deps.telemetry.destroy();
    }
}

/** The store of one viewer; `destroy` also removes the map and telemetry it was given. */
export function createViewerStore(deps: ViewerDeps): ViewerStore {
    return new Store(deps);
}
