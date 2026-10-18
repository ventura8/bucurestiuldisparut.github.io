/**
 * `@hcm/ui/map`: the map both apps draw on (docs/research/M2c-interfaces.md §3.1, CR-M2c-1). `MapPort` is the only map
 * surface the viewer's store and the admin's editors see; `createMapboxPort` implements it on the page's global
 * `mapboxgl` (Mapbox GL JS 3.32.0, never bundled), and `FakeMap` (`@hcm/test-support`) for the tests. It moved here from
 * the engine because the admin may not import the engine (dependency-cruiser `engine-and-admin-independent`). No Lit:
 * the admin's DOM-free logic imports it too.
 */
export { EventListeners, Listeners } from './listeners.js';
export { PHOTOS_OVERLAY_ID } from './map-port.js';
export type {
    MapErrorKind,
    MapEventMap,
    MapOptions,
    MapPadding,
    MapPort,
    MapSlot,
    PhotoConeFeature,
    PhotoFeatureCollection,
    PhotoPointFeature,
    PhotoPointProperties,
    PoiFeature,
    RasterLayerSpec,
    Unsubscribe,
    VectorOverlaySpec,
} from './map-port.js';
export type {
    MapboxCameraOptions,
    MapboxCompare,
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
} from './mapbox-types.js';
export { createMapboxPort, nativeMap } from './mapbox-adapter.js';
export { MAPBOX_GL_CSS_URL, MAPBOX_GL_SCRIPT_URL, MAPBOX_GL_VERSION, loadMapboxGl } from './mapbox-loader.js';
export type { MapboxLoaderScope } from './mapbox-loader.js';
export type { FrameScheduler } from './overlay-registry.js';
export { browserAdapterEnv } from './env.js';
export type { AdapterEnv, BrowserScope } from './env.js';
export { COMPARE_PLUGIN_VERSION, COMPARE_SCRIPT_URL, COMPARE_STYLE_URL, comparePlugin, openCompare } from './compare.js';
export type { CompareDeps, CompareOptions, CompareSession } from './compare.js';
