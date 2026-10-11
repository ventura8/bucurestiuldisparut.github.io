# Engine Viewer Skill

The public viewer engine `@hcm/engine` (`packages/engine`): a data-driven historical map of one city, embeddable by any city owner. Architecture: `docs/ARCHITECTURE.md` → *Engine (public viewer)*; plan: `docs/research/PLAN.md` → *Engine*. Today the package holds the M0 scaffold (`boot()`, `ENGINE_VERSION`, `MAPBOX_GL_VERSION`, the sample `hcm-hello` element); the viewer arrives in M1.

## Contract

- **Build**: `packages/engine/vite.config.ts` produces `dist/engine.iife.js` (global `window.HistoricCityMap`), `dist/engine.mjs` and `dist/engine.css`. `mapbox-gl` is **external**, mapped to the global `mapboxgl`; pages load Mapbox GL JS **3.32.0** from `api.mapbox.com` (`MAPBOX_GL_VERSION`). Never bundle it.
- **Config**: a city page ships `index.html` and `config.js` (`export default { cityId, manifestUrl }`, or an inline static manifest for the starter kit, which needs no backend). `config.js` is validated by a unit test against the shared zod schema.
- **Data**: the viewer fetches only the static `manifest.json` and the photo WebP files from the public bucket (`gs://<proj>-public/cities/{city}/...`). It **never reads Firestore** and loads no Firebase SDK for data. Analytics and performance SDKs load lazily, only with a `measurementId` in the manifest **and** the visitor's consent (`firebase/analytics_and_crash_skill.md`).
- **Manifest**: zod-strict (`z.strictObject`), so unknown and prototype-pollution keys are stripped; a parse failure shows a localized error card, never a blank map.
- **Element**: the viewer is a Lit custom element with the `hcm-` prefix (planned `hcm-map-viewer`), no decorators, registered by an idempotent `define…()` function (`web/ui_m3_adaptive_skill.md`).

## Map

- **One seam**: the core (state, URL hash codec, timeline, controller, manifest → layer specs) talks only to `MapPort` (`packages/engine/src/map/map-port.ts`, M1). `packages/engine/src/map/mapbox-adapter.ts` is the only file that touches `mapbox-gl`; dependency-cruiser enforces it. The core is tested against `FakeMap`, the adapter in Vitest browser mode against the real `mapbox-gl@3.32.0` (dev dependency, exactly the CDN version) with a local style and synthetic tiles.
- **Basemap**: Mapbox Standard Satellite. Historical rasters go into the `middle` slot; 3D buildings are off while a historical layer is shown.
- **Settings**: `performanceMetricsCollection: false`; the Mapbox logo and attribution are always visible (also collapsed on compact, scenario V18).
- **Sources**: `mapbox://` tilesets, `xyz` and later `pmtiles`; each layer has `minzoom`, `maxzoom`, `bounds`, opacity and order from the manifest.
- **One map per view** (cost): Mapbox bills map loads. Swipe compare (M4) creates its second map lazily and destroys it on exit; the e2e map-instance counter asserts it.
- **No WebGL**: `mapboxgl.supported()` false or a lost context shows a fallback card; the photo list still works (scenario V02).
- The service worker (if any) never caches `api.mapbox.com` or `*.tiles.mapbox.com` (Mapbox Product Terms).

## Features (scenario ids in `e2e/scenarios.json`)

- Boot, errors and retry (V01); layer toggles with attribution (V03); timeline year scrubber with the photo year filter (V04); opacity (V05); swipe compare (V06, M4).
- Photos: clustered camera icons rotated by bearing, view cones at high zoom, bottom sheet on compact and side sheet from medium, lightbox, "photos near this year" (V07, V08).
- URL hash state (`#photo=`, `#layers=&view=`), share, geolocate (V09, V10). A hash id must match `^[A-Za-z0-9_-]{1,40}$` and is looked up in a `Map`, never put into a selector.
- About, credits and privacy notice in RO and EN (V13); language and theme (V11, V12); keyboard and screen reader (V14); responsive at every window class (V15); privacy and cost (V16); starter kit (V17); legal (V18); consent (V19) and crash reporting (V20).

## Rules

- Rendering: Lit templates and `textContent` only; Mapbox popups use `setDOMContent` (`web/web_security_skill.md`).
- Every string in `@hcm/shared` i18n catalogues, RO and EN (`web/i18n_skill.md`).
- Logging through `createLogger('engine', …)`; no `console`.
- A user-visible change edits its scenario rows (`quality/e2e_scenario_matrix_skill.md`).
