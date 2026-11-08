/**
 * The viewer's state (docs/research/M1-interfaces.md §6) and the pure transitions the store applies. Every transition
 * returns the same object when nothing changed, so the store skips a render and the map is never touched for nothing.
 */
import {
    clamp,
    DEFAULT_COMPARE_POSITION,
    findOverlay,
    overlaysFromManifest,
    withOverlayVisibility,
    type Locale,
    type Manifest,
    type MapView,
    type MessageKey,
    type Overlay,
    type Story,
} from '@hcm/shared';
import type { WindowClass } from '@hcm/ui';
import type { MyLocationFix } from '@hcm/ui/map';

import type { ConsentState } from '../telemetry/telemetry-port.js';
import { mapLabelsOf, NO_MAP_LABELS, type MapLabelsState } from './map-labels.js';
import { layerIdsOfYear, snapYear, timelineYears, yearOfLayers } from './timeline.js';

export type ViewerStatus = 'idle' | 'loading' | 'ready' | 'error';
export type ThemeMode = 'system' | 'light' | 'dark';
/** M17: `stories` shows the list, or the story `selectedStoryId` names. */
export type SheetName = 'none' | 'layers' | 'photo' | 'poi' | 'photos' | 'unplaced' | 'stories' | 'about' | 'help';

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

/**
 * Swipe compare (M4, scenario V06; docs/ENGINE_API.md → Compare): the historical layer the compared side shows (null:
 * today) and the divider's settled place, from 0 (the compared side fills the map) to 1 (the main side does). A compact
 * window shows it as a toggle on the one map: 0 shows the compared side, anything else the main one.
 */
export interface CompareView {
    readonly layerId: string | null;
    readonly position: number;
}

/**
 * "Show my location" (V10): off (null), on and waiting for the first position, or the latest position, drawn as a blue dot
 * on every map of the view. Only in memory: never in the hash, the stored preferences or telemetry.
 */
export type MyLocationState = MyLocationFix | 'waiting' | null;

/** How compare shows: a second map behind a divider from 600 px wide, a toggle on the one map below. */
export type CompareMode = 'swipe' | 'toggle';

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
    /** M17: the story the `stories` sheet shows; null shows their list. */
    readonly selectedStoryId: string | null;
    readonly lightbox: boolean;
    readonly sheet: SheetName;
    readonly windowClass: WindowClass;
    readonly compactHeight: boolean;
    readonly theme: ThemeMode;
    readonly consent: ConsentState;
    readonly toast: Toast | null;
    /** Swipe compare, or null when the visitor does not compare (M4). */
    readonly compare: CompareView | null;
    /** The basemap's own labels, as the visitor chose them (`map-labels.ts`); the compared side draws the same. */
    readonly mapLabels: MapLabelsState;
    /** The single-key shortcuts are on (the visitor's `shortcuts` preference, docs/research/viewer-input.md §2). */
    readonly shortcuts: boolean;
    /** `prefers-color-scheme: dark`, which the basemap's light follows under the `system` theme (`map-light.ts`). */
    readonly systemDark: boolean;
    readonly myLocation: MyLocationState;
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
        selectedStoryId: null,
        lightbox: false,
        sheet: 'none',
        windowClass: 'compact',
        compactHeight: false,
        theme,
        consent,
        toast: null,
        compare: null,
        mapLabels: NO_MAP_LABELS,
        shortcuts: true,
        systemDark: false,
        myLocation: null,
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
        selectedStoryId: null,
        lightbox: false,
        sheet: 'none',
        compare: null,
        mapLabels: mapLabelsOf(manifest),
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

/**
 * M17 §5: the story `storyId` open (null: their list), the timeline at the stop nearest the story's first year; null when the
 * manifest has no such story.
 */
export function withStory(state: ViewerState, storyId: string | null): ViewerState | null {
    const story = storyId === null ? null : storyOf(state.manifest, storyId);
    if (story === undefined) {
        return null;
    }
    const open: ViewerState = {
        ...state,
        sheet: 'stories',
        selectedStoryId: storyId,
        selectedPhotoId: null,
        selectedPoiId: null,
        lightbox: false,
    };
    return story?.yearStart === undefined ? open : withYear(open, story.yearStart);
}

function storyOf(manifest: Manifest | null, storyId: string): Story | undefined {
    return (manifest?.stories ?? []).find((candidate) => candidate.id === storyId);
}

/** The overlay's label in the current language (`id` when the overlay is unknown). */
export function overlayName(state: ViewerState, id: string): string {
    return findOverlay(state.overlays, id)?.label[state.locale] ?? id;
}

/** Compare's mode at the state's window class: a compact window toggles on its one map. */
export function compareModeOf(state: Pick<ViewerState, 'windowClass'>): CompareMode {
    return state.windowClass === 'compact' ? 'toggle' : 'swipe';
}

/** Whether `layerId` can be the compared side: today (null) or a historical layer of the manifest. */
export function isCompareLayer(manifest: Manifest, layerId: string | null): boolean {
    return layerId === null || manifest.layers.some((layer) => layer.id === layerId);
}

/** The overlays as the compared side shows them: the same photos and places, of the historical layers only `layerId`. */
export function comparedOverlays(overlays: readonly Overlay[], layerId: string | null): readonly Overlay[] {
    return withVisibleLayers(overlays, new Set(layerId === null ? [] : [layerId]));
}

/**
 * What the viewer's map shows: the overlays, except while a compact window's toggle shows the compared side (position
 * 0), when its historical layers are the compared side's.
 */
export function displayedOverlays(state: Pick<ViewerState, 'overlays' | 'compare' | 'windowClass'>): readonly Overlay[] {
    const compare = state.compare;
    if (compare === null || compare.position > 0 || compareModeOf(state) === 'swipe') {
        return state.overlays;
    }
    return comparedOverlays(state.overlays, compare.layerId);
}

export function hasPoi(state: ViewerState, poiId: string): boolean {
    return (state.manifest?.pois ?? []).some((poi) => poi.id === poiId);
}

export function sheetAfterClosing(sheet: SheetName, closed: SheetName): SheetName {
    return sheet === closed ? 'none' : sheet;
}

/** Where compare's divider settles: `position` (clamped), else where it was, else the middle. */
export function comparePosition(state: ViewerState, position: number | undefined): number {
    return clamp(position ?? state.compare?.position ?? DEFAULT_COMPARE_POSITION, 0, 1);
}
