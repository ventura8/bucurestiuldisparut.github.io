# Engine Viewer Skill

The public viewer engine `@hcm/engine` (`packages/engine`): a data-driven historical map of one city, embeddable by any city owner. Public contract: `docs/ENGINE_API.md` (config.js, `<hcm-map-viewer>`, the JavaScript API, the URL hash, the City Manifest v1, versioning). The interfaces the M1 workstreams build on (MapPort, the viewer store, telemetry, UI inventory, module ownership, change requests): `docs/research/M1-interfaces.md`. Architecture: `docs/ARCHITECTURE.md` → *Engine (public viewer)*; plan: `docs/research/PLAN.md` → *Engine*. Today the package holds the M0 scaffold (`boot()`, `ENGINE_VERSION`, `MAPBOX_GL_VERSION`, the sample `hcm-hello` element); the viewer arrives in M1.

## Contract

- **Build**: `packages/engine/vite.config.ts` produces `dist/engine.iife.js` (global `window.HistoricCityMap`), `dist/engine.mjs` and `dist/engine.css`. `mapbox-gl` is **external**, mapped to the global `mapboxgl`; pages load Mapbox GL JS **3.32.0** from `api.mapbox.com` (`MAPBOX_GL_VERSION`). Never bundle it.
- **Config**: `window.HistoricCityMapConfig = {cityId?, manifestUrl? | manifest?, container?, lang?, engineBase?}`, validated with `engineConfigSchema` from `@hcm/shared` (exactly one of `manifestUrl` and `manifest`; the inline manifest is the starter kit's static mode). The IIFE auto-boots into `container` (default `#historic-city-map`); a missing or invalid config shows an instructive error card (scenario V17).
- **JavaScript API**: `HistoricCityMap.mount(element, config)` returns a controller `{ready, setYear, toggleLayer, openPhoto, setLang, destroy}`; the element `<hcm-map-viewer>` fires `hcm-ready`, `hcm-error`, `hcm-layer-change`, `hcm-photo-open` (scenario V21).
- **Data**: the viewer fetches only the static `manifest.json` and the photo WebP files from the public bucket (`gs://<proj>-public/cities/{city}/...`). It **never reads Firestore** and loads no Firebase SDK for data. Analytics and performance SDKs load lazily, only with a `measurementId` in the manifest **and** the visitor's consent (`firebase/analytics_and_crash_skill.md`).
- **Manifest**: City Manifest v1, `manifestSchema` in `packages/shared/src/schemas/manifest.ts`, every object strict. Before the schema, `checkManifestCompat` refuses another `version` and a `city.engine.minVersion` newer than the engine; then `validateManifest` returns `{path, code}` issues whose codes are `validation.*` i18n keys. A failure shows a localized error card, never a blank map (V01).
- **URL hash v1**: `encodeHash` / `decodeHash` in `packages/shared/src/url/hash.ts` (`#zoom/lat/lng[/bearing]&layers=&opacity=&op=&photo=&lang=`), defensive and clamped; the legacy `#zoom/lat/lng/rotation/!a3!p2` opens its view and is rewritten.
- **Element**: the viewer is a Lit custom element `hcm-map-viewer`, no decorators, registered by an idempotent `define…()` function (`web/ui_m3_adaptive_skill.md`).

## Map

- **One seam**: the core (state, timeline, controller, manifest → layer specs) talks only to `MapPort` (`packages/engine/src/map/map-port.ts`, M1; the exact interface is `docs/research/M1-interfaces.md` §4). `packages/engine/src/map/mapbox-adapter.ts` is the only file that touches `mapbox-gl`; dependency-cruiser enforces it. The core is tested against `FakeMap`, the adapter in Vitest browser mode against the real `mapbox-gl@3.32.0` (dev dependency, exactly the CDN version) with a local style and synthetic tiles.
- **Basemap**: Mapbox Standard Satellite. Historical rasters go into the `middle` slot; 3D buildings are off while a historical layer is shown.
- **Settings**: `performanceMetricsCollection: false`; the Mapbox logo and attribution are always visible (also collapsed on compact, scenario V18).
- **Sources**: `mapbox://` tilesets, `xyz` and later `pmtiles`; each layer has `minzoom`, `maxzoom`, `bounds`, opacity and order from the manifest.
- **One map per view** (cost): Mapbox bills map loads. Swipe compare (M4) creates its second map lazily and destroys it on exit; the e2e map-instance counter asserts it.
- **No WebGL**: `mapboxgl.supported()` false or a lost context shows a fallback card; the photo list still works (scenario V02).
- The service worker (if any) never caches `api.mapbox.com` or `*.tiles.mapbox.com` (Mapbox Product Terms).

## Features (scenario ids in `e2e/scenarios.json`)

- Boot, errors and retry (V01); layer toggles with attribution (V03); timeline year scrubber with the photo year filter (V04); opacity (V05); swipe compare (V06, M4).
- Photos: clustered camera icons rotated by bearing, view cones at high zoom (`conePolygon` from `@hcm/shared`; a photo without a bearing gets no cone), bottom sheet on compact and side sheet from medium, lightbox, "photos near this year" (V07, V08).
- URL hash state (v1: the view, `layers=`, `opacity=`, `op=`, `photo=`, `lang=`; the legacy hash too), share, geolocate (V09, V10). A hash id must match `^[A-Za-z0-9_-]{1,40}$` and is looked up in a `Map`, never put into a selector.
- About, credits and privacy notice in RO and EN (V13); language and theme (V11, V12); keyboard and screen reader (V14); responsive at every window class (V15); privacy and cost (V16); starter kit (V17); legal (V18); consent (V19), crash reporting (V20) and the embed API (V21).

## Rules

- Rendering: Lit templates and `textContent` only; Mapbox popups use `setDOMContent`; About and privacy are rendered by walking `parseMarkdown(...).paragraphs` into DOM nodes (`web/web_security_skill.md`).
- Every string in `@hcm/shared` i18n catalogues, RO and EN (`web/i18n_skill.md`).
- Logging through `createLogger('engine', …)`; no `console`.
- A user-visible change edits its scenario rows (`quality/e2e_scenario_matrix_skill.md`).
