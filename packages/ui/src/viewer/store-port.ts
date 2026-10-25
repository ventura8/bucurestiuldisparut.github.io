/**
 * What the viewer elements need from the engine's viewer store (docs/research/M1-interfaces.md §6).
 *
 * `@hcm/ui` sits below `@hcm/engine` (dependency-cruiser `ui-below-apps`), so the viewer elements cannot import the
 * engine-core types. This file mirrors them structurally: `createViewerStore` of `@hcm/engine` returns an object
 * that is assignable to `ViewerStorePort`, which `packages/engine/src/mount.ts` checks at compile time. The viewer
 * renders `getState()` and calls the actions; it never touches the map or the URL hash itself.
 */
import type { Locale, Manifest, MapView, MessageKey, Overlay } from '@hcm/shared';

import type { ThemeMode } from '../theme/apply.js';
import type { WindowClass } from '../theme/tokens.js';

export type { ThemeMode } from '../theme/apply.js';

export type ViewerStatus = 'idle' | 'loading' | 'ready' | 'error';
export type SheetName = 'none' | 'layers' | 'photo' | 'poi' | 'photos' | 'about';
export type ConsentState = 'unknown' | 'granted' | 'denied';
export type Unsubscribe = () => void;

/** Placeholder values of a message (`{count}`, `{detail}`, ...). */
export type MessageParams = Readonly<Record<string, string>>;

export interface ViewerError {
    readonly code: MessageKey;
    readonly retryable: boolean;
    readonly params?: MessageParams;
}

export interface ViewerToast {
    readonly key: MessageKey;
    readonly params?: MessageParams;
}

export interface ViewerState {
    readonly status: ViewerStatus;
    readonly error: ViewerError | null;
    readonly locale: Locale;
    readonly manifest: Manifest | null;
    readonly webgl: boolean;
    readonly view: MapView;
    /** The timeline stop; null is "today" (no historical layer). */
    readonly year: number | null;
    /** Every overlay in list order (historical layers, photos, POI categories); `[]` before the manifest loads. */
    readonly overlays: readonly Overlay[];
    readonly selectedPhotoId: string | null;
    readonly selectedPoiId: string | null;
    readonly lightbox: boolean;
    readonly sheet: SheetName;
    readonly windowClass: WindowClass;
    readonly compactHeight: boolean;
    readonly theme: ThemeMode;
    readonly consent: ConsentState;
    readonly toast: ViewerToast | null;
    /**
     * Swipe compare (M4, V06): the compared side's historical layer (null: today) and the divider's settled place (0..1,
     * the main side's share); null when the visitor does not compare.
     */
    readonly compare: { readonly layerId: string | null; readonly position: number } | null;
}

/** The store actions the viewer elements call (a subset of the engine's `ViewerActions`). */
export interface ViewerStorePort {
    getState(): ViewerState;
    subscribe(listener: (state: ViewerState, previous: ViewerState) => void): Unsubscribe;
    retry(): Promise<void>;
    setLocale(locale: Locale): void;
    setYear(year: number | null): void;
    toggleOverlay(overlayId: string, visible?: boolean): void;
    setOverlayOpacity(overlayId: string, opacity: number, final?: boolean): void;
    openPhoto(photoId: string | null): void;
    openPoi(poiId: string | null): void;
    setLightbox(open: boolean): void;
    openSheet(sheet: SheetName): void;
    setView(view: MapView): void;
    /** Moves the camera (and records the view): "show my location". */
    flyTo(view: MapView): void;
    /** Logs the `share` analytics event after the page was shared or its link copied. */
    logShare(): void;
    setWindowSize(width: number, height: number): void;
    setTheme(theme: ThemeMode): void;
    setConsent(consent: 'granted' | 'denied'): void;
    showToast(key: MessageKey, params?: MessageParams): void;
    dismissToast(): void;
    /** M4: compares the map with `layerId` (null: today). */
    openCompare(layerId: string | null, position?: number): void;
    setComparePosition(position: number): void;
    closeCompare(): void;
}

/** How `ready` settles (docs/ENGINE_API.md → JavaScript API). */
export type ViewerReady = { readonly ok: true; readonly cityId: string } | { readonly ok: false; readonly code: MessageKey };

/** The public controller of one mounted viewer: `HistoricCityMap.mount` returns it, `<hcm-map-viewer>.controller` too. */
export interface ViewerController {
    /** Settles once: the map is ready, or boot failed (it never rejects). */
    readonly ready: Promise<ViewerReady>;
    setYear(year: number | null): void;
    toggleLayer(layerId: string, visible?: boolean): void;
    setOverlayOpacity(overlayId: string, opacity: number): void;
    openPhoto(photoId: string | null): void;
    openPoi(poiId: string | null): void;
    setLang(lang: Locale): void;
    /** M4: compares the map with `layerId` (null: today, no historical layer); an unknown id is ignored. */
    openCompare(layerId: string | null, options?: { readonly position?: number }): void;
    /** M4: moves compare's divider (0: the compared side fills the map, 1: the main side does; clamped). */
    setComparePosition(position: number): void;
    /** M4: closes compare and destroys its second map. */
    closeCompare(): void;
    destroy(): void;
}
