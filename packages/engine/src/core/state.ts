/**
 * The viewer's state (docs/research/M1-interfaces.md §6) and the pure transitions the store applies. Every transition
 * returns the same object when nothing changed, so the store skips a render and the map is never touched for nothing.
 */
import {
    findOverlay,
    overlaysFromManifest,
    withOverlayVisibility,
    type Locale,
    type Manifest,
    type MapView,
    type MessageKey,
    type Overlay,
} from '@hcm/shared';
import type { WindowClass } from '@hcm/ui';

import type { ConsentState } from '../telemetry/telemetry-port.js';
import { layerIdsOfYear, snapYear, timelineYears, yearOfLayers } from './timeline.js';

export type ViewerStatus = 'idle' | 'loading' | 'ready' | 'error';
export type ThemeMode = 'system' | 'light' | 'dark';
export type SheetName = 'none' | 'layers' | 'photo' | 'poi' | 'photos' | 'about';

export const THEME_MODES: readonly ThemeMode[] = ['system', 'light', 'dark'];

export interface ViewerError {
    readonly code: MessageKey;
    readonly retryable: boolean;
    readonly params?: Readonly<Record<string, string>>;
}

export interface Toast {
    readonly key: MessageKey;
    readonly params?: Readonly<Record<string, string>>;
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
    /**
     * Every overlay in list order (`overlaysFromManifest`: historical layers, photos, POI categories), updated only with
     * `withOverlayOpacity`, `withOverlayVisibility` and `withHashOpacity`; `[]` before the manifest loads.
     */
    readonly overlays: readonly Overlay[];
    readonly selectedPhotoId: string | null;
    readonly selectedPoiId: string | null;
    readonly lightbox: boolean;
    readonly sheet: SheetName;
    readonly windowClass: WindowClass;
    readonly compactHeight: boolean;
    readonly theme: ThemeMode;
    readonly consent: ConsentState;
    readonly toast: Toast | null;
}

const NO_VIEW: MapView = { center: [0, 0], zoom: 0, bearing: 0 };

export function initialState(locale: Locale, theme: ThemeMode, consent: ConsentState): ViewerState {
    return {
        status: 'idle',
        error: null,
        locale,
        manifest: null,
        webgl: true,
        view: NO_VIEW,
        year: null,
        overlays: [],
        selectedPhotoId: null,
        selectedPoiId: null,
        lightbox: false,
        sheet: 'none',
        windowClass: 'compact',
        compactHeight: false,
        theme,
        consent,
        toast: null,
    };
}

/** The city's own view: its centre and zoom, north up. */
export function cityView(manifest: Manifest): MapView {
    return { center: manifest.city.center, zoom: manifest.city.zoom, bearing: 0 };
}

/** A freshly loaded manifest: overlays at their defaults, the city view, the stop of the default-visible layers. */
export function withManifest(state: ViewerState, manifest: Manifest): ViewerState {
    const overlays = overlaysFromManifest(manifest);
    const visible = overlays.filter((overlay) => overlay.kind === 'raster' && overlay.visible).map((overlay) => overlay.id);
    return {
        ...state,
        manifest,
        overlays,
        view: cityView(manifest),
        year: yearOfLayers(manifest.layers, visible),
        selectedPhotoId: null,
        selectedPoiId: null,
        lightbox: false,
        sheet: 'none',
    };
}

/** Shows exactly the historical layers in `ids` (unknown ids ignored); other overlays keep their visibility. */
export function withVisibleLayers(overlays: readonly Overlay[], ids: ReadonlySet<string>): readonly Overlay[] {
    return overlays
        .filter((overlay) => overlay.kind === 'raster')
        .reduce((list, overlay) => withOverlayVisibility(list, overlay.id, ids.has(overlay.id)), overlays);
}

/** The timeline stop nearest `year`, with exactly its layers visible. */
export function withYear(state: ViewerState, year: number | null): ViewerState {
    const layers = state.manifest?.layers ?? [];
    const stop = snapYear(year, timelineYears(layers));
    const overlays = withVisibleLayers(state.overlays, layerIdsOfYear(layers, stop));
    return stop === state.year && overlays === state.overlays ? state : { ...state, year: stop, overlays };
}

/** The overlay's label in the current language (`id` when the overlay is unknown). */
export function overlayName(state: ViewerState, id: string): string {
    return findOverlay(state.overlays, id)?.label[state.locale] ?? id;
}
