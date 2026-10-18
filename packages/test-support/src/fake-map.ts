/**
 * Map fakes for the engine's and the admin's tests (docs/research/M1-interfaces.md §4, M2c-interfaces.md §3):
 *
 * - `FakeMap` implements `MapPort` and records every call, so the store and the viewer are tested by what they ask
 *   the map to do; `emit`, `clickPhoto`, `clickPoi` and `clickMap` play the map's side.
 * - `FakeMapboxGl` stands in for the global `mapboxgl` (Mapbox GL JS 3.32.0) in the adapter's tests: `FakeMapboxMap`
 *   keeps sources, layers, paint and layout properties, images and configuration, records calls, and `fire` plays
 *   Mapbox's events. Nothing here renders; the browser tests with the real `mapbox-gl` come with CR-2.
 */
import type { BBox, LngLat, Locale, MapView } from '@hcm/shared';

import type {
    MapEventMap,
    MapOptions,
    MapPadding,
    MapPort,
    MapSlot,
    PhotoFeatureCollection,
    RasterLayerSpec,
    Unsubscribe,
    VectorOverlaySpec,
} from '../../ui/src/map/map-port.js';
import type {
    MapboxCameraOptions,
    MapboxCompareConstructor,
    MapboxEvent,
    MapboxFeature,
    MapboxGeoJsonSource,
    MapboxGl,
    MapboxListener,
    MapboxMap,
    MapboxMapOptions,
    MapImage,
    MapPoint,
} from '../../ui/src/map/mapbox-types.js';

export interface RecordedCall {
    readonly method: string;
    readonly args: readonly unknown[];
}

export interface FakeMapOptions {
    /** What `isWebGLSupported` answers (default true). */
    readonly webgl?: boolean;
    /** When set, `mount` rejects with this error (`new Error('style')`, `new Error('webgl')`). */
    readonly mountError?: Error;
}

type Handlers = { [E in keyof MapEventMap]: Set<(payload: MapEventMap[E]) => void> };

/** A recording `MapPort`. */
export class FakeMap implements MapPort {
    readonly calls: RecordedCall[] = [];
    webgl: boolean;
    mountError: Error | undefined;
    view: MapView = { center: [0, 0], zoom: 0, bearing: 0 };
    mounted = false;
    #loads = 0;
    readonly #photoHandlers = new Set<(photoId: string) => void>();
    readonly #poiHandlers = new Set<(poiId: string) => void>();
    readonly #mapClickHandlers = new Set<(position: LngLat) => void>();
    readonly #handlers: Handlers = { moveend: new Set(), error: new Set(), webglcontextlost: new Set(), webglcontextrestored: new Set() };

    constructor(options: FakeMapOptions = {}) {
        this.webgl = options.webgl ?? true;
        this.mountError = options.mountError;
    }

    get mapLoadCount(): number {
        return this.#loads;
    }

    /** The calls of one method, oldest first. */
    callsOf(method: string): readonly (readonly unknown[])[] {
        return this.calls.filter((call) => call.method === method).map((call) => call.args);
    }

    #record(method: string, ...args: readonly unknown[]): void {
        this.calls.push({ method, args });
    }

    isWebGLSupported(): boolean {
        this.#record('isWebGLSupported');
        return this.webgl;
    }

    mount(container: HTMLElement, options: MapOptions): Promise<void> {
        this.#record('mount', container, options);
        this.#loads += 1;
        if (this.mountError !== undefined) {
            return Promise.reject(this.mountError);
        }
        this.mounted = true;
        this.view = options.view;
        return Promise.resolve();
    }

    addRasterLayer(spec: RasterLayerSpec, slot: MapSlot): void {
        this.#record('addRasterLayer', spec, slot);
    }

    addVectorOverlay(spec: VectorOverlaySpec, slot: MapSlot): void {
        this.#record('addVectorOverlay', spec, slot);
    }

    setOverlayVisibility(overlayId: string, visible: boolean): void {
        this.#record('setOverlayVisibility', overlayId, visible);
    }

    setOverlayOpacity(overlayId: string, opacity: number): void {
        this.#record('setOverlayOpacity', overlayId, opacity);
    }

    setLayerPaint(layerId: string, paint: unknown): void {
        this.#record('setLayerPaint', layerId, paint);
    }

    removeLayer(layerId: string): void {
        this.#record('removeLayer', layerId);
    }

    setPhotosData(data: PhotoFeatureCollection): void {
        this.#record('setPhotosData', data);
    }

    onPhotoClick(handler: (photoId: string) => void): Unsubscribe {
        this.#photoHandlers.add(handler);
        return () => this.#photoHandlers.delete(handler);
    }

    onPoiClick(handler: (poiId: string) => void): Unsubscribe {
        this.#poiHandlers.add(handler);
        return () => this.#poiHandlers.delete(handler);
    }

    onMapClick(handler: (position: LngLat) => void): Unsubscribe {
        this.#mapClickHandlers.add(handler);
        return () => this.#mapClickHandlers.delete(handler);
    }

    flyTo(view: Partial<MapView>, options?: { readonly animate?: boolean }): void {
        this.#record('flyTo', view, options);
        this.view = { ...this.view, ...view };
    }

    fitBounds(bounds: BBox, options?: { readonly padding?: number; readonly animate?: boolean }): void {
        this.#record('fitBounds', bounds, options);
    }

    setPadding(padding: MapPadding): void {
        this.#record('setPadding', padding);
    }

    getView(): MapView {
        return this.view;
    }

    on<E extends keyof MapEventMap>(event: E, handler: (payload: MapEventMap[E]) => void): Unsubscribe {
        const handlers = this.#handlers[event] as Set<(payload: MapEventMap[E]) => void>;
        handlers.add(handler);
        return () => handlers.delete(handler);
    }

    setLocale(locale: Locale): void {
        this.#record('setLocale', locale);
    }

    resize(): void {
        this.#record('resize');
    }

    destroy(): void {
        this.#record('destroy');
        this.mounted = false;
        this.#photoHandlers.clear();
        this.#poiHandlers.clear();
        this.#mapClickHandlers.clear();
        for (const handlers of Object.values(this.#handlers)) {
            handlers.clear();
        }
    }

    /** Plays a map event to the subscribers (a `moveend` also moves the fake's view). */
    emit<E extends keyof MapEventMap>(event: E, payload: MapEventMap[E]): void {
        if (event === 'moveend') {
            this.view = payload as MapView;
        }
        for (const handler of this.#handlers[event] as Set<(payload: MapEventMap[E]) => void>) {
            handler(payload);
        }
    }

    clickPhoto(photoId: string): void {
        for (const handler of this.#photoHandlers) {
            handler(photoId);
        }
    }

    clickPoi(poiId: string): void {
        for (const handler of this.#poiHandlers) {
            handler(poiId);
        }
    }

    /** A click on the map that hit no photo or POI (`onMapClick`). */
    clickMap(position: LngLat): void {
        for (const handler of this.#mapClickHandlers) {
            handler(position);
        }
    }

    /** How many subscribers are listening (photo, POI and map clicks plus every event). */
    get listenerCount(): number {
        const events = Object.values(this.#handlers).reduce((sum, handlers) => sum + handlers.size, 0);
        return events + this.#photoHandlers.size + this.#poiHandlers.size + this.#mapClickHandlers.size;
    }
}

/** A canvas element as the adapter uses it: cursor style, size, keyboard listeners. */
export class FakeCanvas {
    readonly style = { cursor: '' };
    clientWidth = 800;
    clientHeight = 600;
    readonly #listeners = new Map<string, Set<(event: unknown) => void>>();

    addEventListener(type: string, listener: (event: unknown) => void): void {
        const set = this.#listeners.get(type) ?? new Set();
        set.add(listener);
        this.#listeners.set(type, set);
    }

    removeEventListener(type: string, listener: (event: unknown) => void): void {
        this.#listeners.get(type)?.delete(listener);
    }

    /** Dispatches a key press; returns whether a listener called `preventDefault`. */
    pressKey(key: string): boolean {
        let prevented = false;
        const event = {
            key,
            preventDefault: () => {
                prevented = true;
            },
        };
        for (const listener of this.#listeners.get('keydown') ?? []) {
            listener(event);
        }
        return prevented;
    }

    listenerCount(type: string): number {
        return this.#listeners.get(type)?.size ?? 0;
    }
}

/** A GeoJSON source that keeps its last data and answers cluster expansion. */
export class FakeGeoJsonSource implements MapboxGeoJsonSource {
    data: unknown;
    expansionZoom: number | Error = 16;
    readonly expandedClusters: number[] = [];

    constructor(data: unknown) {
        this.data = data;
    }

    setData(data: unknown): void {
        this.data = data;
    }

    getClusterExpansionZoom(clusterId: number, callback: (error: unknown, zoom: number) => void): void {
        this.expandedClusters.push(clusterId);
        const answer = this.expansionZoom;
        if (answer instanceof Error) {
            callback(answer, Number.NaN);
        } else {
            callback(null, answer);
        }
    }
}

/** A recording stand-in for `mapboxgl.Map`. */
export class FakeMapboxMap implements MapboxMap {
    readonly options: MapboxMapOptions;
    readonly calls: RecordedCall[] = [];
    readonly sources = new Map<string, Readonly<Record<string, unknown>> & { readonly fake: FakeGeoJsonSource }>();
    /** Layer ids in drawing order (bottom first). */
    readonly layerOrder: string[] = [];
    readonly layers = new Map<string, Readonly<Record<string, unknown>>>();
    readonly paint = new Map<string, Record<string, unknown>>();
    readonly layout = new Map<string, Record<string, unknown>>();
    readonly images = new Map<string, MapImage>();
    readonly config = new Map<string, unknown>();
    readonly canvas = new FakeCanvas();
    /** What `queryRenderedFeatures` returns (filtered by the queried layers). */
    rendered: MapboxFeature[] = [];
    /** Thrown by `getConfigProperty` when set (a style without imports). */
    configError: Error | null = null;
    center = { lng: 0, lat: 0 };
    zoom = 0;
    bearing = 0;
    removed = false;
    readonly #listeners = new Map<string, Set<MapboxListener>>();

    constructor(options: MapboxMapOptions) {
        this.options = options;
        this.center = { lng: options.center[0], lat: options.center[1] };
        this.zoom = options.zoom;
        this.bearing = options.bearing;
        for (const [key, value] of Object.entries(options.config?.['basemap'] ?? {})) {
            this.config.set(`basemap.${key}`, value);
        }
    }

    #record(method: string, ...args: readonly unknown[]): void {
        this.calls.push({ method, args });
    }

    callsOf(method: string): readonly (readonly unknown[])[] {
        return this.calls.filter((call) => call.method === method).map((call) => call.args);
    }

    on(type: string, listener: MapboxListener): this {
        const set = this.#listeners.get(type) ?? new Set();
        set.add(listener);
        this.#listeners.set(type, set);
        return this;
    }

    off(type: string, listener: MapboxListener): this {
        this.#listeners.get(type)?.delete(listener);
        return this;
    }

    /** Plays a Mapbox event. */
    fire(type: string, event: MapboxEvent = {}): void {
        for (const listener of [...(this.#listeners.get(type) ?? [])]) {
            listener(event);
        }
    }

    listenerCount(type: string): number {
        return this.#listeners.get(type)?.size ?? 0;
    }

    addSource(id: string, source: Readonly<Record<string, unknown>>): this {
        this.#record('addSource', id, source);
        if (this.sources.has(id)) {
            throw new Error(`source ${id} already exists`);
        }
        this.sources.set(id, { ...source, fake: new FakeGeoJsonSource(source['data']) });
        return this;
    }

    getSource(id: string): FakeGeoJsonSource | undefined {
        return this.sources.get(id)?.fake;
    }

    removeSource(id: string): this {
        this.#record('removeSource', id);
        this.sources.delete(id);
        return this;
    }

    addLayer(layer: Readonly<Record<string, unknown>>, beforeId?: string): this {
        this.#record('addLayer', layer, beforeId);
        const id = String(layer['id']);
        if (this.layers.has(id)) {
            throw new Error(`layer ${id} already exists`);
        }
        const index = beforeId === undefined ? -1 : this.layerOrder.indexOf(beforeId);
        this.layerOrder.splice(index < 0 ? this.layerOrder.length : index, 0, id);
        this.layers.set(id, layer);
        this.paint.set(id, { ...(layer['paint'] as Record<string, unknown> | undefined) });
        this.layout.set(id, { ...(layer['layout'] as Record<string, unknown> | undefined) });
        return this;
    }

    getLayer(id: string): unknown {
        return this.layers.get(id);
    }

    removeLayer(id: string): this {
        this.#record('removeLayer', id);
        this.layers.delete(id);
        this.layerOrder.splice(this.layerOrder.indexOf(id), 1);
        return this;
    }

    setLayoutProperty(layerId: string, name: string, value: unknown): this {
        this.#record('setLayoutProperty', layerId, name, value);
        this.layout.set(layerId, { ...this.layout.get(layerId), [name]: value });
        return this;
    }

    setPaintProperty(layerId: string, name: string, value: unknown): this {
        this.#record('setPaintProperty', layerId, name, value);
        this.paint.set(layerId, { ...this.paint.get(layerId), [name]: value });
        return this;
    }

    getConfigProperty(importId: string, name: string): unknown {
        if (this.configError !== null) {
            throw this.configError;
        }
        return this.config.get(`${importId}.${name}`) ?? null;
    }

    setConfigProperty(importId: string, name: string, value: unknown): this {
        this.#record('setConfigProperty', importId, name, value);
        this.config.set(`${importId}.${name}`, value);
        return this;
    }

    hasImage(id: string): boolean {
        return this.images.has(id);
    }

    addImage(id: string, image: MapImage, options?: { readonly pixelRatio?: number }): this {
        this.#record('addImage', id, image, options);
        this.images.set(id, image);
        return this;
    }

    updateImage(id: string, image: MapImage): this {
        this.#record('updateImage', id, image);
        this.images.set(id, image);
        return this;
    }

    triggerRepaint(): this {
        this.#record('triggerRepaint');
        return this;
    }

    flyTo(options: MapboxCameraOptions): this {
        this.#record('flyTo', options);
        return this.#move(options);
    }

    fitBounds(bounds: readonly [LngLat, LngLat], options: { readonly padding: number; readonly animate: boolean }): this {
        this.#record('fitBounds', bounds, options);
        return this;
    }

    setPadding(padding: MapPadding): this {
        this.#record('setPadding', padding);
        return this;
    }

    jumpTo(options: MapboxCameraOptions): this {
        this.#record('jumpTo', options);
        return this.#move(options);
    }

    easeTo(options: MapboxCameraOptions): this {
        this.#record('easeTo', options);
        return this.#move(options);
    }

    #move(options: MapboxCameraOptions): this {
        this.center = options.center === undefined ? this.center : { lng: options.center[0], lat: options.center[1] };
        this.zoom = options.zoom ?? this.zoom;
        this.bearing = options.bearing ?? this.bearing;
        return this;
    }

    getCenter(): { readonly lng: number; readonly lat: number } {
        return this.center;
    }

    getZoom(): number {
        return this.zoom;
    }

    getBearing(): number {
        return this.bearing;
    }

    queryRenderedFeatures(
        geometry: MapPoint | readonly [MapPoint, MapPoint],
        options: { readonly layers: readonly string[] },
    ): readonly MapboxFeature[] {
        this.#record('queryRenderedFeatures', geometry, options);
        return this.rendered.filter((feature) => options.layers.includes(feature.layer?.id ?? ''));
    }

    getCanvas(): HTMLElement {
        return this.canvas as unknown as HTMLElement;
    }

    setLanguage(language: string): this {
        this.#record('setLanguage', language);
        return this;
    }

    resize(): this {
        this.#record('resize');
        return this;
    }

    remove(): void {
        this.#record('remove');
        this.removed = true;
    }
}

/** A stand-in for the global `mapboxgl`: `maps` holds every map created, in order. */
export class FakeMapboxGl implements MapboxGl {
    readonly maps: FakeMapboxMap[] = [];
    readonly Map: new (options: MapboxMapOptions) => MapboxMap;
    supported?: (failIfMajorPerformanceCaveat?: boolean) => boolean;
    Compare?: MapboxCompareConstructor;
    /** When set, `new Map` throws it (WebGL context creation failed). */
    constructError: Error | null = null;

    constructor(options: { readonly supported?: boolean } = {}) {
        const created = this.maps;
        const fail = (): Error | null => this.constructError;
        if (options.supported !== undefined) {
            const answer = options.supported;
            this.supported = () => answer;
        }
        this.Map = class extends FakeMapboxMap {
            constructor(mapOptions: MapboxMapOptions) {
                const error = fail();
                if (error !== null) {
                    throw error;
                }
                super(mapOptions);
                created.push(this);
            }
        };
    }

    /** The newest map. */
    get map(): FakeMapboxMap {
        const map = this.maps.at(-1);
        if (map === undefined) {
            throw new Error('no map created');
        }
        return map;
    }
}
