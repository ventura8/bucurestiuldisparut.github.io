# M1 interfaces: the contracts the parallel agents build on

Written on 2026-10-12 by the M1 contracts agent, before the M1 workstreams start in parallel. Read it together with
`docs/ENGINE_API.md` (the public contract: `config.js`, `<hcm-map-viewer>`, the JavaScript API, the URL hash, the
City Manifest v1, versioning), `PLAN.md` (Addenda 1–3) and `M0-handoff.md` (toolchain, how to add a gate or a
workspace).

What is already implemented and tested (100 % lines and branches per file) is marked **done**; everything else is a
contract the owning workstream implements exactly as written. A change to anything here goes through
[Change requests](#change-requests) at the end of this file, never by editing another workstream's files.

## 1. Module ownership

Each workstream writes only its own paths. Reading and importing anything is fine; editing a file you do not own is a
change request.

| Workstream | Owns (writes) | Notes |
| --- | --- | --- |
| contracts (**done**) | `packages/shared/**`, `scripts/seed/**`, the migration outputs `seed/bucharest/derived/` and `seed/bucharest/manifest.static.json`, `docs/ENGINE_API.md`, this file | After M1 starts, `packages/shared/**` changes only through a change request (every workstream depends on it). |
| ui-kit | `packages/ui/**` | Already contains `src/theme/dynamic-color.ts` and `scripts/gen-theme.mjs` (**done**, by the contracts agent); their exported API is a contract (§4). |
| engine-core | `packages/engine/src/core/**`, `packages/engine/src/map/**`, `packages/engine/src/telemetry/**`, `packages/engine/src/config/**`, `packages/test-support/src/fake-map.ts` | The only workstream that touches `mapbox-gl` (`map/mapbox-adapter.ts`, dependency-cruiser rule `only-the-map-adapter-imports-mapbox`). |
| engine-ui | `packages/engine/src/ui/**`, `packages/engine/src/index.ts` | Builds the viewer from the ui-kit components and the engine-core store. |
| e2e-infra | `e2e/**` (including `e2e/scenarios.json`), `sites/**`, `starter-kit/**`, `scripts/site/**` | The site build, the starter kit, the Playwright tiers, the mock APIs. |

Shared files without an owner (`package.json`, `package-lock.json`, `tsconfig.json`, the per-package `tsconfig.json`
files, `docs/*.md` other than `docs/ENGINE_API.md`, `.agent/**`, `.agents/**`, `.claude/**`) are edited by the
integrator after the workstreams finish; a workstream that needs a change there files a change request. Ask-first files
(`AGENTS.md` → *Boundaries*) stay ask-first.

Tests live next to the code they test: `packages/<pkg>/test/**` mirrors `src/`; engine-core's tests go under
`packages/engine/test/core/**`, `test/map/**`, `test/telemetry/**`, `test/config/**`, engine-ui's under
`packages/engine/test/ui/**`.

## 2. Engine source layout

```text
packages/engine/src/
  index.ts                 engine-ui: ENGINE_VERSION, MAPBOX_GL_VERSION, mount, defineElements, the IIFE auto-boot
  config/                  engine-core: resolve the configuration, fetch the manifest (timeout), compat + validation
  core/                    engine-core: the viewer store, the overlay model, the timeline, hash sync, map specs
  map/map-port.ts          engine-core: the MapPort interface and its types (§3)
  map/mapbox-adapter.ts    engine-core: createMapboxPort, the only module that imports mapbox-gl
  telemetry/               engine-core: consent, the lazy analytics loader, the error reporter (§6)
  ui/                      engine-ui: <hcm-map-viewer> and the viewer-only elements (§5.2)
packages/test-support/src/fake-map.ts   engine-core: FakeMap implements MapPort (test-only)
```

`mapbox-gl@3.32.0` joins `@hcm/engine` as an exact devDependency (types and the adapter's browser tests only; the build
keeps it external). The engine's browser tests need a second Vitest project (`engine-browser`), which is a
`vitest.config.ts` change: change request CR-2.

## 3. Shared contracts in `@hcm/shared` (done)

Import everything from `@hcm/shared`; the public API is pinned by `packages/shared/test/index.test.ts`.

| Area | Exports | File |
| --- | --- | --- |
| Manifest v1 | `manifestSchema`, `citySchema`, `layerSchema`, `photoSchema`, `themeSchema`; types `Manifest`, `City`, `Layer`, `LayerSource`, `LayerAdjustments`, `Photo`, `PhotoImage`, `PhotoLink`, `Credit`, `Theme`, `ThemeTokens`, `ThemeScheme`, `Basemap`, `License`, `LayerKind`; constants `MANIFEST_VERSION`, `LICENSES`, `LAYER_KINDS`, `THEME_SCHEMES`, `MAX_LINKS`, `MAX_LAYERS`, `MAX_PHOTOS`, `PHOTO_LOCATION_SLACK_DEG` | `packages/shared/src/schemas/manifest.ts` |
| Embed config | `engineConfigSchema`, `EngineConfig`, `DEFAULT_CONTAINER_SELECTOR` | `packages/shared/src/schemas/config.ts` |
| Firestore (refined in M2) | `cityDocSchema`, `layerDocSchema`, `photoDocSchema`, `jobDocSchema`, `usgsSceneDocSchema`, `setupStatusDocSchema`, `adminDocSchema`, `timestampSchema` and their types; the enums `FIRESTORE_LICENSES`, `PROCESSING_STATES`, `LAYER_STATUSES`, `JOB_TYPES`, `JOB_STATUSES`, `USGS_DATASETS`, `USGS_SCENE_STATUSES`, `SERVICE_STATES`, `ADMIN_ROLES`, `GEOREF_METHODS` | `packages/shared/src/schemas/firestore.ts` |
| Validation | `validate(schema, input)`, `validateManifest`, `parseManifestJson`, `toValidationIssues`, `formatPath`, `isValidationCode`; `ValidationIssue = {path, code}`, `ValidationResult<T>`, `ValidationCode` (every `validation.*` i18n key) | `packages/shared/src/schemas/validation.ts` |
| Compatibility | `checkManifestCompat(input, engineVersion)` → `{ok: true}` or `{ok: false, code: 'error.manifest.version' \| 'error.manifest.engineTooOld', minVersion?}`; `compareVersions`, `parseVersion` | `packages/shared/src/schemas/compat.ts` |
| Ids | `ID_PATTERN` (`^[A-Za-z0-9_-]{1,40}$`), `isId` | `packages/shared/src/schemas/primitives.ts` |
| Geo | `LngLat`, `clamp`, `wrapBearing`, `bearingDelta`, `roundTo`, `toRadians`, `toDegrees`, `EARTH_RADIUS_M`, `MAX_MERCATOR_LAT`; `bearingBetween`, `distanceMeters`, `destinationPoint`; `ViewCone`, `conePolygon(location, cone, segments = 8)`, `coneFromPolygon(ring, apexHint)`, `findConeApex(ring)`, `angularSpan`, `openRing`, `DEFAULT_FOV` (60), `MIN_FOV`, `MAX_FOV`; `BBox`, `BoundsRecord`, `bboxOf`, `bboxContains`, `bboxIntersects`, `bboxExpand`, `bboxCenter`, `clampToBBox`, `bboxToRecord`, `bboxFromRecord` | `packages/shared/src/geo/` |
| URL hash v1 | `encodeHash(state)`, `decodeHash(hash, limits?)`; `HashState`, `DecodedHash` (`legacy` flag), `HashLimits`, `MapView = {center, zoom, bearing}`, `DEFAULT_HASH_LIMITS`, `MAX_HASH_LENGTH`, `MAX_OVERLAY_ENTRIES` | `packages/shared/src/url/hash.ts` |
| Text | `parseMarkdown(source)` → `{paragraphs, rejectedLinks}` of `InlineNode`s (`text`, `strong`, `em`, `link`, `break`), `markdownToPlainText`; `isHttpsUrl`, `isRelativeUrl`, `isHostOf`, `toHttpsUrl`, `MAX_URL_LENGTH` | `packages/shared/src/text/` |
| i18n | `translate(locale, key, params)`, `resolveLocale`, `LOCALES`, `DEFAULT_LOCALE`, `MessageKey` (the viewer keys of §7 are in the catalogues) | `packages/shared/src/i18n/` |
| Logging | `createLogger(scope, {sink, minLevel})` (secret-looking keys redacted) | `packages/shared/src/log.ts` |
| Legacy migration | `migrateLegacyPhotos`, `legacyHtmlToText`, `buildStaticManifest`, `photoAuthorsCredit`, `parseLegacyYear`, `slugify`, `uniqueIds`, ... (§8) | `packages/shared/src/migration/` |

Rules for every consumer: render data with Lit templates or `textContent` only; render `about` and `privacy` by walking
`parseMarkdown(...).paragraphs` into DOM nodes (links get `rel="noopener noreferrer nofollow ugc"` and
`target="_blank"`); show a validation problem as `translate(locale, issue.code)` plus `issue.path`.

## 4. MapPort (engine-core)

```ts
// packages/engine/src/map/map-port.ts
import type { BBox, LayerAdjustments, LayerSource, Locale, LngLat, MapView } from '@hcm/shared';

/** Mapbox Standard style slots: bottom (above polygons), middle (above roads, below 3D buildings), top (above POI labels). */
export type MapSlot = 'bottom' | 'middle' | 'top';

/** The overlay id of the photo markers and cones in setLayerVisibility / setLayerOpacity (PLAN Addendum 3). */
export const PHOTOS_OVERLAY_ID = 'photos';

export interface RasterLayerSpec {
    /** The manifest layer id; the adapter derives its own ids from it (`hcm-raster-<id>`, `hcm-source-<id>`). */
    readonly id: string;
    /** `mapbox` becomes `mapbox://<tilesetId>`; `xyz` a raster source with `tiles` and `tileSize`; `pmtiles` uses the official PMTiles TileProvider. */
    readonly source: LayerSource;
    readonly minzoom: number;
    readonly maxzoom: number;
    readonly bounds?: BBox;
    readonly visible: boolean;
    /** 0..1, `raster-opacity`. */
    readonly opacity: number;
    /** `raster-brightness-min/max`, `raster-contrast`, `raster-saturation`. */
    readonly adjustments?: LayerAdjustments;
    /** Higher draws on top of lower within the slot (the manifest `order`). */
    readonly order: number;
    /** Added to the attribution control while the layer is visible. */
    readonly attribution: string;
}

/** Properties of a photo point; titles are already in the current locale. */
export interface PhotoPointProperties {
    readonly id: string;
    readonly title: string;
    readonly year: number | null;
    /** Rotates the camera icon; null draws an unrotated marker and no cone. */
    readonly bearing: number | null;
}

export interface PhotoPointFeature {
    readonly type: 'Feature';
    readonly geometry: { readonly type: 'Point'; readonly coordinates: LngLat };
    readonly properties: PhotoPointProperties;
}

/** A view cone (`conePolygon` from @hcm/shared), shown from zoom 17. */
export interface PhotoConeFeature {
    readonly type: 'Feature';
    readonly geometry: { readonly type: 'Polygon'; readonly coordinates: readonly (readonly LngLat[])[] };
    readonly properties: { readonly id: string };
}

/** Points and cones in one collection; the adapter splits them (points are clustered, cones are not). */
export interface PhotoFeatureCollection {
    readonly type: 'FeatureCollection';
    readonly features: readonly (PhotoPointFeature | PhotoConeFeature)[];
}

export interface MapOptions {
    /** `basemap.style` of the manifest. */
    readonly style: string;
    /** Mapbox Standard configuration, set on the `basemap` import. */
    readonly config?: Readonly<Record<string, string | number | boolean>>;
    readonly accessToken: string;
    readonly view: MapView;
    readonly minZoom: number;
    readonly maxZoom: number;
    readonly maxBounds?: BBox;
    readonly locale: Locale;
    /** True with `prefers-reduced-motion: reduce`: flyTo jumps instead of animating. */
    readonly reducedMotion: boolean;
}

export type MapErrorKind = 'style' | 'source' | 'tile' | 'webgl' | 'unknown';

export interface MapEventMap {
    moveend: MapView;
    error: { readonly kind: MapErrorKind; readonly layerId?: string; readonly message: string };
    webglcontextlost: undefined;
    webglcontextrestored: undefined;
}

export type Unsubscribe = () => void;

export interface MapPort {
    /** False without WebGL (`mapboxgl.supported()`); the viewer then shows the photo list (scenario V02). */
    isWebGLSupported(): boolean;
    /** Creates the map in `container`; resolves when the style has loaded, rejects with a MapErrorKind message. */
    mount(container: HTMLElement, options: MapOptions): Promise<void>;
    /** Adds or replaces (same id) a historical raster layer in `slot` (the viewer uses 'middle'). */
    addRasterLayer(spec: RasterLayerSpec, slot: MapSlot): void;
    /** A raster layer id or PHOTOS_OVERLAY_ID; an unknown id is ignored. */
    setLayerVisibility(layerId: string, visible: boolean): void;
    /** A raster layer id or PHOTOS_OVERLAY_ID; clamped to 0..1; coalesced to one paint update per animation frame. */
    setLayerOpacity(layerId: string, opacity: number): void;
    removeLayer(layerId: string): void;
    /** Replaces every photo marker and cone. */
    setPhotosData(data: PhotoFeatureCollection): void;
    /** A click on a photo marker or cone (a cluster click zooms in instead). */
    onPhotoClick(handler: (photoId: string) => void): Unsubscribe;
    /** Moves the camera; animated unless `reducedMotion` or `animate: false`. */
    flyTo(view: Partial<MapView>, options?: { readonly animate?: boolean }): void;
    getView(): MapView;
    on<E extends keyof MapEventMap>(event: E, handler: (payload: MapEventMap[E]) => void): Unsubscribe;
    /** Called by the viewer's ResizeObserver. */
    resize(): void;
    /** Removes the map and every listener; mount may be called again (a new map load). */
    destroy(): void;
    /** How many maps this port has created (each is a billed Mapbox map load): 1 per view. */
    readonly mapLoadCount: number;
}

/** packages/engine/src/map/mapbox-adapter.ts */
export declare function createMapboxPort(gl: typeof import('mapbox-gl').default): MapPort;
```

Adapter rules: `performanceMetricsCollection: false`, `attributionControl` always on (compact: collapsed but reachable),
`testMode` only in tests; 3D objects (`show3dObjects`) off while a historical layer is visible; never `setHTML` (popups
use `setDOMContent`). FakeMap (`packages/test-support/src/fake-map.ts`) implements `MapPort` and records
`calls: readonly {method: string; args: readonly unknown[]}[]`, offers `emit(event, payload)` and `clickPhoto(id)`, and
lets a test choose `webgl` and whether `mount` rejects.

## 5. UI components

### 5.1 ui-kit (`packages/ui`)

Lit 3 without decorators, `hcm-` prefix, an idempotent `define…(registry = customElements)` per element plus
`defineUiKit(registry)` for all, tokens only (`--md-sys-*`), 48 dp touch targets, RO/EN strings passed in by the app (the
kit has no catalogue of its own). Every event is a bubbling, composed `CustomEvent`.

| Tag | Properties (attribute) | Events (`detail`) | Slots |
| --- | --- | --- | --- |
| `hcm-icon` | `name` (a Material Symbols Rounded name from the bundled subset), `filled` | none | none |
| `hcm-button` | `variant` (`filled`, `tonal`, `outlined`, `text`), `icon`, `disabled` | native `click` | default (label) |
| `hcm-icon-button` | `icon`, `label` (accessible name, required), `toggle`, `selected`, `disabled` | `hcm-change` (`{selected}`) when `toggle` | none |
| `hcm-fab` | `icon`, `label`, `extended`, `size` (`small`, `medium`, `large`) | native `click` | none |
| `hcm-switch` | `checked`, `label`, `disabled` | `hcm-change` (`{checked}`) | none |
| `hcm-slider` | `min`, `max`, `step`, `value`, `label`, `valueText` (`aria-valuetext`) | `hcm-input` (`{value}`, per animation frame while dragging), `hcm-change` (`{value}`) | none |
| `hcm-chip` | `label`, `icon`, `selected` (filter chip) | `hcm-change` (`{selected}`) | none |
| `hcm-segmented-button` | `options` (`{value, label, icon?}[]`), `value`, `label` | `hcm-change` (`{value}`) | none |
| `hcm-card` | `variant` (`elevated`, `filled`, `outlined`) | none | `headline`, default, `actions` |
| `hcm-list`, `hcm-list-item` | item: `headline`, `supportingText`, `interactive` | native `click` on interactive items | item: `leading`, `trailing` |
| `hcm-sheet` | `open`, `label`, `variant` (`bottom` on compact, `side` from medium), `closeLabel` | `hcm-close` | `header`, default, `actions` |
| `hcm-dialog` | `open`, `headline`, `closeLabel` | `hcm-close` (`{returnValue}`) | default, `actions` |
| `hcm-snackbar` | `message`, `actionLabel`, `closeLabel`, `timeoutMs` (default 6000, 0 = until closed) | `hcm-action`, `hcm-dismiss` | none |
| `hcm-progress` | `kind` (`circular`, `linear`), `value` (0..1), `indeterminate`, `label` | none | none |

Theme functions (`packages/ui/src/theme/`): `themeFromSeed(seed)` → `ThemeTokenSet` (**done**, also
`schemeFor`, `tokensForScheme`, `tokenName`, `contrastRatio`, `contrastIssues`, `relativeLuminance`, `isHexColor`,
`DEFAULT_SEED_COLOR`, `SPEC_VERSION = '2025'`), imported from the separate entry point `@hcm/ui/dynamic-color`, never
from `@hcm/ui`: `@material/material-color-utilities` 0.4.0 imports without file extensions, which Vite handles but
plain Node (the engine's and admin's node tests, Cloud Functions with external npm dependencies) cannot resolve; a
Cloud Function that needs it must bundle it (`noExternal` in `functions/build.mjs`). Plus, owned by ui-kit, `applyTheme(target: HTMLElement, tokens:
ThemeTokens, mode: 'light' | 'dark' | 'system', highContrast: boolean): void` (sets the custom properties on `target`
and follows `prefers-color-scheme` / `prefers-contrast` for `system`) and the existing `windowClassFor`,
`isCompactHeight`. The viewer never imports `@material/material-color-utilities` (the tokens come precomputed in the
manifest); only the admin calls `themeFromSeed` at run time.

### 5.2 Viewer elements (engine-ui, `packages/engine/src/ui`)

| Tag | Role |
| --- | --- |
| `hcm-map-viewer` | The public element of `docs/ENGINE_API.md`: owns the store, the map container, the layout per window class, the events. |
| `hcm-timeline` | Year scrubber over the layer years plus "today" (`timeline.*` keys); a year without a layer snaps to the nearest stop (V04). |
| `hcm-layer-panel` | Overlay toggles and opacity sliders (layers and `photos`), attribution lines (`layers.*`). |
| `hcm-photo-sheet` | Photo details in an `hcm-sheet`: title, years, author, licence, rights note, links, thumbnail (`photo.*`, `license.*`). |
| `hcm-lightbox` | Full image, pinch zoom, arrow keys, Esc returns focus (`lightbox.*`, V08). |
| `hcm-photo-list` | The photos without a map (no WebGL, V02) and "photos near this year". |
| `hcm-about-dialog` | About, credits, privacy (Markdown subset), engine version, consent withdrawal (`about.*`, `consent.withdraw`). |
| `hcm-consent-banner` | Analytics consent (`consent.*`, V19). |
| `hcm-error-card` | Boot and configuration errors with Retry (`error.*`, `action.retry`). |

## 6. Viewer store and telemetry (engine-core)

```ts
// packages/engine/src/core/store.ts
import type { DecodedHash, EngineConfig, Locale, Logger, Manifest, MapView, MessageKey } from '@hcm/shared';
import type { WindowClass } from '@hcm/ui';

import type { MapPort, Unsubscribe } from '../map/map-port.js';
import type { ConsentState, TelemetryPort } from '../telemetry/telemetry-port.js';

export type ViewerStatus = 'idle' | 'loading' | 'ready' | 'error';
export type ThemeMode = 'system' | 'light' | 'dark';
export type SheetName = 'none' | 'layers' | 'photo' | 'photos' | 'about';

export interface ViewerError {
    readonly code: MessageKey;
    readonly retryable: boolean;
    readonly params?: Readonly<Record<string, string>>;
}

export interface OverlayState {
    readonly visible: boolean;
    /** 0..1 */
    readonly opacity: number;
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
    /** Keyed by layer id and PHOTOS_OVERLAY_ID. */
    readonly overlays: Readonly<Record<string, OverlayState>>;
    readonly selectedPhotoId: string | null;
    readonly lightbox: boolean;
    readonly sheet: SheetName;
    readonly windowClass: WindowClass;
    readonly compactHeight: boolean;
    readonly theme: ThemeMode;
    readonly consent: ConsentState;
    readonly toast: { readonly key: MessageKey; readonly params?: Readonly<Record<string, string>> } | null;
}

export interface ViewerActions {
    /** Fetch (or take the inline) manifest, check compat, validate, mount the map; errors land in state.error. */
    load(): Promise<void>;
    retry(): Promise<void>;
    setLocale(locale: Locale): void;
    setYear(year: number | null): void;
    toggleLayer(layerId: string, visible?: boolean): void;
    setOverlayOpacity(overlayId: string, opacity: number): void;
    openPhoto(photoId: string | null): void;
    setLightbox(open: boolean): void;
    openSheet(sheet: SheetName): void;
    setView(view: MapView): void;
    setWindowSize(width: number, height: number): void;
    setTheme(theme: ThemeMode): void;
    setConsent(consent: 'granted' | 'denied'): void;
    showToast(key: MessageKey, params?: Readonly<Record<string, string>>): void;
    dismissToast(): void;
    /** Applies a decoded URL hash (on load and on `hashchange`); unknown ids are ignored, an unknown photo shows a toast. */
    applyHash(hash: DecodedHash): void;
}

export interface ViewerStore extends ViewerActions {
    getState(): ViewerState;
    subscribe(listener: (state: ViewerState, previous: ViewerState) => void): Unsubscribe;
    destroy(): void;
}

export interface ViewerDeps {
    readonly config: EngineConfig;
    /** `fetch` for the manifest (tests pass a fake); the store applies a 15 s timeout. */
    readonly fetch: (url: string, init: { readonly signal: AbortSignal }) => Promise<Response>;
    readonly map: MapPort;
    readonly telemetry: TelemetryPort;
    /** localStorage-like; preferences live under `hcm:<cityId>:<name>` (`lang`, `theme`, `consent`). */
    readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
    /** Reads and writes the URL hash (history.replaceState). */
    readonly location: { readonly hash: string; replaceHash(hash: string): void };
    readonly log: Logger;
}

export declare function createViewerStore(deps: ViewerDeps): ViewerStore;

/** Photos within this many years of the selected stop are "near this year". */
export const PHOTO_YEAR_WINDOW = 10;
```

```ts
// packages/engine/src/telemetry/telemetry-port.ts
import type { Unsubscribe } from '../map/map-port.js';

export type ConsentState = 'unknown' | 'granted' | 'denied';

export type TelemetryEvent =
    | { readonly name: 'page_view' }
    | { readonly name: 'layer_toggle'; readonly layerId: string; readonly visible: boolean }
    | { readonly name: 'year_change'; readonly year: number | null }
    | { readonly name: 'photo_open'; readonly photoId: string }
    | { readonly name: 'share' }
    | { readonly name: 'compare_open' };

export type ErrorSource = 'window' | 'promise' | 'boundary';

export interface TelemetryPort {
    readonly consent: ConsentState;
    /** Stored under `hcm:<cityId>:consent`; withdrawing stops every later analytics request (V19). */
    setConsent(consent: 'granted' | 'denied'): void;
    onConsentChange(listener: (consent: ConsentState) => void): Unsubscribe;
    /** Dropped unless consent is granted and the manifest has a measurementId; the Firebase SDK loads lazily on the first one. */
    logEvent(event: TelemetryEvent): void;
    /** Never throws. Redacted (createLogger's rules plus URL queries), at most 5 per page and one per message per 10 s,
     * POSTed to `analytics.errorEndpoint` when set; a GA4 `exception` event too when consent is granted (V20). */
    reportError(error: unknown, context: { readonly fatal: boolean; readonly source: ErrorSource }): void;
    destroy(): void;
}

/** The body sent to `telemetry.reportError` (M2 HTTPS function). No PII: no hash, no query, no visitor position. */
export interface ErrorReportPayload {
    readonly message: string;
    readonly stack?: string;
    readonly release: string;
    readonly cityId: string;
    /** `location.origin + location.pathname`. */
    readonly page: string;
    readonly viewport: { readonly width: number; readonly height: number };
    readonly windowClass: string;
    readonly locale: string;
    readonly fatal: boolean;
    readonly source: ErrorSource;
}
```

## 7. Viewer i18n keys

All keys are in `packages/shared/src/i18n/ro.ts` and `en.ts` now (112 keys, parity checked by the `i18n` gate); a
missing key is a change request. Families:

- `validation.*`: the codes `validate` returns (required, type, tooSmall, tooBig, format, value, unknownKey,
  httpsOnly, assetUrl, bounds, zoomRange, centerOutside, duplicateId, outsideCity, yearRange, markdownLink, cssValue,
  tileTemplate, manifestSource, json, invalid).
- `error.*`: `generic`; `manifest.notFound`, `.network`, `.timeout`, `.invalid` (`{count}`), `.version`,
  `.engineTooOld` (`{version}`); `config.missing`, `.invalid` (`{detail}`), `.cityMismatch` (`{cityId}`,
  `{manifestCityId}`), `.container` (`{selector}`); `webgl`, `mapLoad`, `tiles`, `layer` (`{name}`), `photoImage`,
  `unknownPhoto`; `geolocate.denied`, `.outside`, `.unavailable`.
- `action.*`: `retry`, `close`, `share`, `locate`, `menu`, `previous`, `next`.
- `viewer.loading`, `viewer.mapLabel` (`{city}`), `viewer.skipToTimeline`.
- `timeline.label`, `.year` (`{year}`), `.present`, `.noLayer` (`{year}`).
- `layers.title`, `.toggle` (`{name}`), `.opacity` (`{name}`), `.opacityValue` (`{percent}`), `.photos`,
  `.attribution` (`{attribution}`), `.empty`, `.kind.satellite`, `.kind.aerial`, `.kind.map`.
- `photos.title`, `.list`, `.count.one`, `.count.few`, `.count.other` (`{count}`; pick the form with
  `Intl.PluralRules(locale)`), `.nearYear` (`{year}`).
- `photo.marker` (`{title}`), `.author` (`{author}`), `.year` (`{year}`), `.years` (`{year}`, `{yearEnd}`),
  `.unknownYear`, `.links`, `.rightsReview`, `.openLightbox`.
- `license.<value>` for every value of `LICENSES`.
- `lightbox.label`, `.position` (`{index}`, `{total}`); `share.copied`, `.failed`.
- `about.title`, `.credits`, `.privacy`, `.engine` (`{version}`); `theme.label`, `.system`, `.light`, `.dark`;
  `language.label`, `.ro`, `.en`.
- `consent.title`, `.body`, `.accept`, `.decline`, `.withdraw`, `.granted`, `.denied`; `geolocate.locating`.

A catalogue entry stays on one line of at most 140 columns: Prettier wraps a longer one, and the `i18n` gate then
reports it.

## 8. Legacy migration (done)

```bash
docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp/hcm-home -v "$PWD:$PWD" -w "$PWD" hcm-quality:local \
  node scripts/seed/migrate-legacy.mjs   # or: npm run seed:migrate
```

- Input: `seed/bucharest/photos.legacy.geojson` and `seed/bucharest/photos/` (never modified), the city seed
  `scripts/seed/bucharest.city.json` (names, About, credits, privacy, basemap, the `pk.REPLACE_AT_DEPLOY` placeholder).
- Output (rewritten on every run): `seed/bucharest/derived/<id>/web.webp` (2048 px long edge) and `thumb.webp`
  (400 px), metadata stripped by sharp; `seed/bucharest/manifest.static.json`, schema-validated before it is written.
- Result on 2026-10-12: 45 photos (44 points, of which one file is shown from two places, plus one cone without a point,
  `fonteriei`, placed at its apex), 34 cones turned into bearing and field of view, 9.52 MB of derivatives (budget
  15 MB), three originals no feature refers to (reported, not migrated), every photo `permission-legacy` with
  `rightsReview: true`. Links: the Facebook and Flickr sources and the costingheorghe.ro page (http upgraded); the
  "Alte legături:" lead-in is dropped because the link is listed.
- The site build (e2e-infra) serves the manifest with its `derived/` folder next to it: image URLs are relative to the
  manifest.
- Theme: `themeFromSeed('#8B5E3C')` (TonalSpot, SpecVersion 2025), 53 `--md-sys-color-*` tokens per scheme;
  `node packages/ui/scripts/gen-theme.mjs --seed '#8B5E3C'` prints the same `theme` object.

## 9. Scenario rows registered for M1

New rows in `e2e/scenarios.json` (status `planned`, owned by e2e-infra from now on): `S-V01-BAD-ENGINE-TOO-OLD`,
`S-V05-HAPPY-OVERLAY-HASH`, `S-V05-BAD-UNKNOWN-OVERLAY`, `S-V07-BAD-NO-BEARING`, `S-V09-HAPPY-LEGACY-HASH`,
`S-V13-BAD-MARKUP-IS-TEXT`, `S-V17-BAD-CITY-MISMATCH`, and the new behaviour `V21` (embed API): `S-V21-HAPPY`,
`S-V21-BAD-MISSING-CONTAINER`, `S-V21-BAD-AFTER-DESTROY`. V19 (consent) and V20 (crash reporting) already had happy and
bad rows from M0; their texts now match §6.

## Change requests

A workstream that needs a change outside its paths appends a row here and continues against the current contract;
the integrator (or the owner) applies it. Ids are `CR-<n>`; status `open`, `accepted`, `done` or `rejected`.

| Id | From | Target (owner) | Change | Why | Status |
| --- | --- | --- | --- | --- | --- |
| CR-1 | contracts | `firebase/firestore.rules` (M2) | add `dateText` (i18n, ≤ 100) to `photoFields()`; require `title.ro` | `photoDocSchema` has `dateText` (legacy dates such as `Iulie 1936`) and requires a Romanian title | open |
| CR-2 | contracts | `vitest.config.ts` (ask-first) | an `engine-browser` project (Chromium) for the Mapbox adapter and the Lit viewer, and a `tools` node project for CLI tests | today the engine project is node-only and the CLI tests of `scripts/seed` and `packages/ui/scripts` run from the shared project | open (proposal in `DECISIONS-for-review.md` §9) |
| CR-3 | contracts | `.htmlvalidate.json` (ask-first) | extend `html-validate:prettier` | e2e-infra needs a committed `sites/bucharest/index.html`; until then it is generated from TypeScript templates at build time and validated with the html-validate library in a unit test | open (`DECISIONS-for-review.md` §1) |
