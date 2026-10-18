# Engine API v1

The public contract of the **Historic City Map** viewer engine (`@hcm/engine`) for city owners who embed it and for the agents who build it. It covers the embed configuration (`config.js`), the `<hcm-map-viewer>` element, the JavaScript API, the URL hash, the City Manifest v1 and the versioning rules. The exact TypeScript interfaces behind it, and who owns which module, are in [research/M1-interfaces.md](research/M1-interfaces.md); the architecture is in [ARCHITECTURE.md](ARCHITECTURE.md).

Status (M1): the manifest (with the POIs and overlay defaults of PLAN Addendum 3), configuration, URL hash, validation and overlay-model contracts are implemented and tested in `@hcm/shared` (`packages/shared/src/schemas/`, `packages/shared/src/url/hash.ts`, `packages/shared/src/overlays/`). The element, the JavaScript API and the auto-boot are implemented in `@hcm/engine` (`packages/engine/src/index.ts`, `packages/engine/src/mount.ts`) and `@hcm/ui` (`packages/ui/src/viewer/`) and boot the built Bucharest site in the e2e smoke (scenario S-V16-HAPPY).

## The three files of a city

A city site is a page, its `config.js` and the engine. Mapbox GL JS **3.32.0** is loaded from `api.mapbox.com` and is never bundled; the engine finds it as the global `mapboxgl`.

```html
<!doctype html>
<html lang="ro">
    <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="referrer" content="strict-origin-when-cross-origin" />
        <title>București dispărut</title>
        <link rel="stylesheet" href="https://api.mapbox.com/mapbox-gl-js/v3.32.0/mapbox-gl.css" />
        <link rel="stylesheet" href="engine/engine.css" />
        <script src="https://api.mapbox.com/mapbox-gl-js/v3.32.0/mapbox-gl.js" defer></script>
        <script src="config.js" defer></script>
        <script type="module" src="engine/engine.mjs"></script>
    </head>
    <body>
        <main>
            <h1 class="hcm-visually-hidden" lang="ro">București dispărut</h1>
            <div id="historic-city-map"></div>
        </main>
    </body>
</html>
```

The page's body is one `main` landmark headed by a level-one heading (the site's title, for screen readers only: `hcm-visually-hidden` of `engine.css`, since the map fills the window). Everything the viewer draws (the timeline, the menu, toasts, the legal bar) is then inside a landmark; a page that embeds the viewer among its own content puts it in its `main` or in a labelled region the same way. The generated city pages (`scripts/site/src/page.ts`) do this.

```js
// config.js
window.HistoricCityMapConfig = {
    cityId: 'bucharest',
    manifestUrl: 'https://storage.googleapis.com/<project>-public/cities/bucharest/manifest.json',
};
```

Bucharest serves the engine from its own origin (the site build copies every file of the engine build next to the page: `engine.mjs` with its lazy `firebase-sdk-<hash>.js` chunk, `engine.iife.js`, `engine.css` and `fonts/`). A module script runs after the deferred classic scripts above it, so `mapboxgl` and the configuration exist when the engine starts; `engine/engine.iife.js` with `defer` works the same way for pages that cannot load modules.

`globalThis.HistoricCityMapConfig = {…}` is the same as `window.HistoricCityMapConfig = {…}` in a classic script; the committed `config.js` files use the `window.` form (ESLint gives them the browser globals). A site build reads `config.js` without running it (`scripts/site/src/config-js.ts`), so the file must be one assignment of literal data: objects, arrays, strings, numbers, booleans and `null`. The site build refuses a `config.js` whose `cityId` is not the manifest's city; a site whose source manifest still names an older id says so in its `site.json` (`legacyCityId`: the Bucharest seed, migrated as it was, names `bucuresti`, while the project's city and every manifest the server builds is `bucharest`), and the served manifest takes `config.js`'s id. A third-party city that loads it from jsDelivr pins an exact version with `integrity` and `crossorigin`; SRI is impossible with a range URL such as `@1`.

## config.js

`window.HistoricCityMapConfig` is validated with `engineConfigSchema` (`packages/shared/src/schemas/config.ts`); every object is strict, so an unknown key is an error.

| Field | Type | Default | Rule |
| --- | --- | --- | --- |
| `manifestUrl` | string | none | https, or relative to the page (no `..`, no `//host`). Exactly one of `manifestUrl` and `manifest`. |
| `manifest` | object | none | An inline City Manifest v1 (the starter kit's static mode, no backend). Validated like a fetched one. |
| `cityId` | string | none | `^[A-Za-z0-9_-]{1,40}$`. When present it must equal `manifest.city.id` (else `error.config.cityMismatch`); it also namespaces the stored preferences. |
| `container` | string | `#historic-city-map` | CSS selector of the element to mount into (auto-boot only). |
| `lang` | string | `ro` | A BCP 47 tag; anything that is not English resolves to Romanian. |
| `engineBase` | string | the folder of the engine script | https or relative, ending with `/`: where the engine's own files live (`fonts/`: the self-hosted Roboto Flex and Material Symbols subset). |

**Auto-boot.** When either build runs (the ES module or the IIFE), it registers the elements and, once the document is parsed, reads `window.HistoricCityMapConfig`:

- present and valid: it mounts into `container`; a missing element shows `error.config.container` in the console log and nothing on the page (there is nowhere to draw);
- present and invalid: the error card in `container` shows `error.config.invalid` with the first issue (`path` and the localized `validation.*` message), so the city owner sees what to fix;
- absent while `#historic-city-map` exists: the error card shows `error.config.missing` (scenario V17);
- absent and no default container: nothing happens (the page uses `<hcm-map-viewer>` or `HistoricCityMap.mount` itself).

**Language** is resolved in this order: the URL (`#…&lang=` or `?lang=`), the visitor's stored choice, `config.lang`, then Romanian. `<html lang>` follows the result (scenario V11). An error card shown before any manifest (a missing or invalid `config.js`) follows the URL, then `config.lang`. The visitor switches it in the menu (the item names the other language) and in About; the theme (system, light, dark) is in About. `setLang` accepts any tag and resolves it like `config.lang`.

## `<hcm-map-viewer>`

The engine's custom element (Lit, registered by the engine; the tag never changes within v1). It fills its box: give it, or its container, a height.

| Attribute | Property | Type | Meaning |
| --- | --- | --- | --- |
| `manifest-url` | `manifestUrl` | string | As in `config.js`. |
| `city-id` | `cityId` | string | As in `config.js`. |
| `lang` | `lang` | `ro` or `en` | Reflected; changing it switches the language live. |
| `engine-base` | `engineBase` | string | As in `config.js`. |
| (none) | `manifest` | object | An inline manifest; set it before the element is connected. |
| (none) | `controller` | `HistoricCityMapController` or `null` | Read-only; the same object `mount` returns, `null` before connection. |
| (none) | `mapContainer` | `HTMLElement` or `null` | Read-only; the stable element inside the shadow root the map is mounted into (after the first render). |

The engine also sets `mapboxCssUrl` (mapbox-gl.css of the pinned release, linked inside the shadow root, where the page's copy cannot reach), `engineVersion` and `bootError` (a configuration error found before any store exists), and connects its store with `attach(store, controller)` / `detach()`. Pages never set these. A page may style the element itself (its size, `display`); the viewer's layout lives inside its shadow root. While a sheet, the lightbox or About covers the map, the Mapbox logo and attribution show in a bar at the element's bottom (or at the foot of About) instead of on the map, so they are never covered. Floating controls keep the bottom 42 px of the map free for them, and a language switch also renames Mapbox's own controls (the map canvas, the logo link, the attribution toggle).

Events are `CustomEvent`s that bubble and cross shadow roots (`composed: true`):

| Event | `detail` | When |
| --- | --- | --- |
| `hcm-ready` | `{ cityId, engineVersion, layers, photos }` (counts) | The manifest passed validation and the map's style loaded. |
| `hcm-error` | `{ code, retryable, detail? }` | Boot or map error; `code` is an i18n key (`error.*`), `detail` a non-localized hint (an issue path, an HTTP status). |
| `hcm-layer-change` | `{ layerId, visible, opacity, year }` | A historical layer was shown, hidden or faded (by the visitor, the hash or the API). |
| `hcm-overlay-change` | `{ overlayId, kind, visible, opacity }` | Any overlay (a historical layer, `photos`, a POI category) was shown, hidden or faded; fired once per change, after a slider is released. |
| `hcm-photo-open` | `{ photoId }` | A photo's sheet opened. |
| `hcm-poi-open` | `{ poiId }` | A POI's details opened (in the same sheet as photos). |

## JavaScript API

The IIFE build exposes `window.HistoricCityMap`; the ES module build exports the same names.

| Export | Type |
| --- | --- |
| `ENGINE_VERSION` | `string`, `major.minor.patch` |
| `MAPBOX_GL_VERSION` | `'3.32.0'` |
| `mount(element, config)` | `(element: HTMLElement, config: EngineConfig) => HistoricCityMapController` |
| `defineElements()` | registers `<hcm-map-viewer>` and its parts; idempotent |

```ts
interface HistoricCityMapController {
    /** Settles once: the map is ready, or boot failed (it never rejects). */
    readonly ready: Promise<{ readonly ok: true; readonly cityId: string } | { readonly ok: false; readonly code: MessageKey }>;
    /** Shows the layers of `year` (null: today, no historical layer). */
    setYear(year: number | null): void;
    /** Shows or hides an overlay (a layer id, `photos` or a POI category id); without `visible` it toggles. */
    toggleLayer(layerId: string, visible?: boolean): void;
    /** Sets an overlay's opacity (0 to 1, clamped) live; an unknown id is ignored. */
    setOverlayOpacity(overlayId: string, opacity: number): void;
    /** Opens a photo's sheet (null closes it); an unknown id shows the `error.unknownPhoto` toast. */
    openPhoto(photoId: string | null): void;
    /** Opens a POI's details (null closes them); an unknown id is ignored. */
    openPoi(poiId: string | null): void;
    setLang(lang: 'ro' | 'en'): void;
    /** Removes the map (one map per view), every listener and the rendered content; later calls do nothing. */
    destroy(): void;
}
```

`mount` renders an `<hcm-map-viewer>` into `element`. Calls made before `ready` settles are applied once the map is ready; calls after `destroy` are ignored. Every call that changes what the visitor sees updates the URL hash with `history.replaceState`, so a shared link restores it.

## URL hash v1

```text
#<zoom>/<lat>/<lng>[/<bearing>][&layers=<id>,<id>][&opacity=<0..1>][&op=<id>:<0..100>,...][&photo=<id>][&lang=ro|en]
```

| Part | Rule when read |
| --- | --- |
| view | 3 or 4 plain decimals (no exponent, no `Infinity`); zoom clamped to the city's `minZoom`..`maxZoom`, the centre to the city bounds, the bearing wrapped to `[0, 360)`. The encoder writes zoom with 2 decimals, latitude and longitude with 5, the bearing with 1 and omits a bearing of 0. |
| `layers` | Visible historical layers; ids must match `^[A-Za-z0-9_-]{1,40}$`, others are dropped; duplicates removed; `layers=` (empty) means none. |
| `opacity` | Opacity of the visible historical layers, clamped to `[0, 1]`. |
| `op` | Per-overlay opacity (PLAN Addendum 3) in percent, clamped to `[0, 100]`; at most 50 entries (the encoder never writes more); wins over `opacity`. Overlays are the layer ids, `photos` and the POI category ids ([Overlays](#overlays)). An entry for an id the manifest does not have is dropped (`decodeHash` with `overlayIds`), and the viewer writes only the overlays whose opacity differs from the manifest default. |
| `photo` | The open photo; an id that is not in the manifest shows a toast (scenario V09). |
| `lang` | `ro` or `en`; anything else is ignored. |

Unknown parameters are ignored, a repeated one keeps its last valid value, and a hash longer than 2,048 characters is ignored as a whole. Ids are only ever looked up in a `Map`, never used in a selector. The legacy hash of the 2015–2022 site, `#zoom/lat/lng/rotation/!a3!p2`, still opens the same view: its `!…` layer codes are ignored and the viewer rewrites the hash in the v1 form. Codec: `encodeHash` and `decodeHash` in `packages/shared/src/url/hash.ts`.

## City Manifest v1

The only data the viewer reads: a static JSON file (from the public bucket, or inline in `config.js`). Schema: `manifestSchema` in `packages/shared/src/schemas/manifest.ts`; the Bucharest seed is `seed/bucharest/manifest.static.json`. Every object is strict: an unknown key is an error (which also blocks prototype-pollution keys).

```json
{ "version": 1, "city": { "id": "bucharest", "...": "..." }, "layers": [], "photos": [], "photosOverlay": { "defaultOpacity": 1 }, "poiCategories": [], "pois": [] }
```

`photosOverlay`, `poiCategories` and `pois` are optional (the Bucharest seed has none of them yet).

Common rules:

- **Text** is plain text, rendered with `textContent` or Lit templates, never as HTML; it is trimmed and must not be empty. `{ro, en}` means both languages are required, `{ro, en?}` that English falls back to Romanian.
- **Markdown subset** (`about`, `privacy`, POI `description`): paragraphs separated by a blank line, `**bold**`, `_italic_` or `*italic*`, `[label](https://…)` links, `\` escapes. A link that is not https makes the manifest invalid; HTML is shown as text. Parser: `parseMarkdown` in `packages/shared/src/text/markdown.ts`.
- **URLs** are https without credentials. Image and archive addresses may also be relative to the manifest (no `..`, no `//host`, no query).
- **Coordinates** are `[lng, lat]` in degrees; bounds are `[[west, south], [east, north]]` with west < east and south < north.

### `city`

| Field | Type | Rule |
| --- | --- | --- |
| `id` | string | `^[A-Za-z0-9_-]{1,40}$` |
| `name` | `{ro, en}` | at most 100 characters |
| `center` | `[lng, lat]` | inside `bounds` |
| `zoom`, `minZoom`, `maxZoom` | number | 0 to 24, `minZoom` ≤ `zoom` ≤ `maxZoom` |
| `bounds` | `[[w, s], [e, n]]` | the area the map and the hash stay in |
| `about`, `privacy` | `{ro, en}` | Markdown subset, at most 10,000 characters |
| `credits` | `[{label: {ro, en}, url?}]` | at most 50 |
| `theme` | `{seedColor, tokens}` | `seedColor` `#rrggbb`; `tokens.light`, `.dark`, `.highContrastLight`, `.highContrastDark` each map 1 to 200 `--md-sys-*` names to values without `;`, braces, quotes, `:` or `url(` |
| `basemap` | `{style, config?}` | `mapbox://styles/<owner>/<style>` or https; `config` sets Mapbox Standard configuration properties (at most 30) |
| `mapbox` | `{publicToken}` | a `pk.` token (URL-restricted); a secret `sk.` token is rejected |
| `analytics` | `{measurementId?, errorEndpoint?, firebase?}` | `G-…`; https; `firebase` is `{apiKey, appId, projectId}` of the city's Firebase web app (`AIza…`, `1:<number>:web:<hex>`, a project id), written by the manifest builder and never committed. GA4 loads only with a `measurementId`, the `firebase` ids and the visitor's consent; without the ids the consent banner still asks, but nothing is sent. GA4 is told the page's origin and path, never the hash; withdrawing consent in About expires its `_ga` cookies; the viewer has no Performance Monitoring |
| `engine` | `{minVersion?}` (optional) | the oldest engine that can read this manifest |

### `layers[]`

| Field | Type | Rule |
| --- | --- | --- |
| `id` | string | unique in the manifest; also an overlay id, so never `photos` and never a POI category id |
| `year`, `date?` | integer, `YYYY-MM-DD` | 1800 to 2100; `date` within `year` |
| `label`, `description?` | `{ro, en}` | at most 200 and 5,000 characters |
| `kind` | `satellite`, `aerial` or `map` | |
| `sensor?`, `attribution` | string | at most 100 and 500 characters; the attribution is always shown with the layer, as plain text (markup in it is shown, never rendered) |
| `source` | object | `{type: 'mapbox', tilesetId: '<owner>.<id>'}`, `{type: 'xyz', tiles: [https template with {z} {x} {y}], tileSize: 256 or 512}` or `{type: 'pmtiles', url}`. The admin links a `mapbox` tileset of the city's own Mapbox account only, and never an address carrying a key or a token (`layers.link`, which refuses them as `apiError.layers.foreignTileset` and `apiError.layers.secretInAddress`); an `xyz` host must also be in the page's CSP (`img-src`, `connect-src`) |
| `minzoom`, `maxzoom` | number | 0 to 24, `minzoom` ≤ `maxzoom` |
| `bounds?` | `[[w, s], [e, n]]` | where tiles exist |
| `order` | integer | drawing order (higher on top) in the Standard style's `middle` slot |
| `defaultVisible`, `opacity` | boolean, 0 to 1 | initial state |
| `adjustments?` | `{brightnessMin?, brightnessMax?, contrast?, saturation?}` | Mapbox `raster-brightness-min`, `raster-brightness-max`, `raster-contrast`, `raster-saturation` (brightness 0 to 1, min ≤ max; contrast and saturation -1 to 1; ranges and neutral values in `LAYER_ADJUSTMENT_RANGES`), applied live without reprocessing (PLAN Addendum 3). An absent adjustment is neutral; `rasterAdjustmentPaint` clamps live slider values and never lets the minimum pass the maximum. Mapbox has no gamma property: the brightness range is the levels control |

### `photos[]`

| Field | Type | Rule |
| --- | --- | --- |
| `id` | string | unique; the `#photo=` id |
| `title`, `description?` | `{ro, en?}` | at most 200 and 5,000 characters |
| `year?`, `yearEnd?` | integer | 1800 to 2100; `yearEnd` needs `year` and is not before it |
| `dateText?` | `{ro, en?}` | the source's own dating, such as `Iulie 1936` |
| `author?`, `rightsHolder?` | string | at most 200 characters |
| `license` | enum | `CC0`, `CC-BY-4.0`, `CC-BY-SA-4.0`, `PD`, `permission`, `permission-legacy` |
| `rightsReview?` | boolean | the rights of a migrated photo are being confirmed (the viewer shows a note) |
| `links` | `[{url, label}]` | at most 5, https only (legacy HTML was converted to these) |
| `location` | `{lat, lng}` | within the city bounds plus 0.5° |
| `bearing?`, `fov?` | number | 0 to 360 and 1 to 180; a photo with a bearing gets a view cone (default field of view 60°) |
| `image` | `{web, thumb, w, h}` | WebP derivatives (2048 px and 400 px on the long edge), metadata stripped; `w`, `h` of `web` |

### `photosOverlay` (optional)

| Field | Type | Rule |
| --- | --- | --- |
| `defaultOpacity` | number | 0 to 1: the photo markers' and view cones' opacity until the visitor moves the slider; without `photosOverlay` it is 1 |

### `poiCategories[]` (optional)

Points of interest (PLAN Addendum 3) are places, buildings, vanished streets, events or notes beyond the photos. Each belongs to one city-defined category, which is also an overlay with its own slider.

| Field | Type | Rule |
| --- | --- | --- |
| `id` | string | unique; also an overlay id: never `photos`, never a layer id |
| `label` | `{ro, en}` | at most 100 characters |
| `icon` | string | a Material Symbols name, `^[a-z0-9_]{1,64}$`. The engine bundles the names of `POI_ICONS` (`packages/shared/src/schemas/poi.ts`); any other valid name is drawn as `location_on`, so an older engine never refuses a newer icon |
| `color` | `#rrggbb` | the icon background, line and fill colour of the category's POIs |
| `defaultOpacity` | number | 0 to 1 |

At most 50 categories.

### `pois[]` (optional)

| Field | Type | Rule |
| --- | --- | --- |
| `id` | string | unique |
| `category` | string | the id of one of `poiCategories` |
| `geometry` | GeoJSON | `Point`, `LineString` (2 positions or more) or `Polygon` (closed rings of 4 positions or more, at most 20 rings); `[lng, lat]` positions only (no altitude, no `bbox`); at most 500 positions per geometry; every position within the city bounds plus 0.5° |
| `title`, `description?` | `{ro, en?}` | at most 200 and 5,000 characters; `description` is Markdown subset |
| `yearStart?`, `yearEnd?` | integer | 1800 to 2100; either may be absent (an open end), never `yearEnd` before `yearStart` |
| `links` | `[{url, label}]` | at most 5, https only |
| `photoIds?` | string[] | at most 20 ids of manifest photos, shown in the POI's details |

At most 5,000 POIs. The timeline shows a POI at a year its span covers (an absent bound is open); "today" shows every POI (`poiInYear`). POI details open in the same sheet as photos, labels show from zoom 16.

### Overlays

The viewer's Layers panel lists one **overlay** per historical layer, one for the photos (markers and view cones, id `photos`) and one per POI category, each with a switch and a 0–100 % slider that updates the map live. Layer ids, `photos` and category ids are one namespace (a clash is `validation.duplicateId`), because the URL hash's `op=` names overlays by id. Order: historical layers by year (the higher `order` first within a year), the photos, then the categories in manifest order.

| Kind | Starts | Opacity paint (`overlayOpacityPaint`) |
| --- | --- | --- |
| `raster` | `defaultVisible`, `opacity` | `raster-opacity` |
| `photos` | visible, `photosOverlay.defaultOpacity` (1) | `icon-opacity`, `text-opacity` (markers, cluster counts), `fill-opacity` and `line-opacity` (view cones) |
| `poi` | visible, `defaultOpacity` | `icon-opacity`, `text-opacity`, `circle-opacity`, `circle-stroke-opacity`, `line-opacity`, `fill-opacity` |

Each paint value is the overlay's opacity times the map layer's designed opacity (a view cone drawn at 25 % stays at 25 % of the overlay). Model and mapping: `packages/shared/src/overlays/model.ts` and `packages/shared/src/overlays/paint.ts`.

## Errors and validation

The engine checks a manifest in three steps, each with a localized message:

1. `version` must be `1`, else `error.manifest.version`;
2. `city.engine.minVersion`, when present, must not be newer than `ENGINE_VERSION`, else `error.manifest.engineTooOld` (with the version);
3. the strict schema, else `error.manifest.invalid` with the issue count; each issue is `{path, code}` where `code` is a `validation.*` key (`validateManifest`, `checkManifestCompat` in `@hcm/shared`). The error card also names the first issue, `path: message` in the visitor's language (`layers[0].adjustments.brightnessMax: Valoarea nu este permisă.`), so the city owner sees what to fix; `hcm-error`'s `detail` carries the same issue untranslated (`layers[0].adjustments.brightnessMax validation.value`). The cross-value rules report `validation.duplicateId` (ids, overlay ids), `validation.outsideCity` (photos, POI geometries), `validation.reference` (a POI's category or photo that does not exist) and `validation.ringClosed` (an open polygon ring).

A fetch that returns 404 shows `error.manifest.notFound`, a network failure `error.manifest.network`, a slow response `error.manifest.timeout`; each error card has a Retry button. No error ever leaves a blank map (scenario V01).

## Versioning and compatibility

- **Engine releases follow SemVer.** jsDelivr's `@1` follows every 1.x release; Bucharest ships the exact build of its commit.
- **The manifest has its own generation number** (`version: 1`). Engine 1.x reads only manifest v1.
- **Within v1 a field is only ever added, and only as optional**, in a minor engine release. A manifest that uses a new field sets `city.engine.minVersion` to that release, so an older engine shows "this map needs engine X" instead of rejecting the unknown key. The manifest builder sets `minVersion` automatically.
- **Removing, renaming or changing the meaning of a field** makes manifest v2 and engine 2.0; the builder can then write both generations side by side during the transition.
- **`config.js`, the element and the JavaScript API** change additively in minor releases; a deprecated name keeps working for at least one minor release and is removed only in a major one.
- **The URL hash** keeps v1's grammar for the whole 1.x line; new parameters are additive and old readers ignore them. The legacy hash stays readable.
- **Additions before 1.0.0** (PLAN Addendum 3, 2026-10-12): `photosOverlay`, `poiCategories[]`, `pois[]`, the overlay namespace rule and the `op=` overlay ids. They are part of the v1 baseline that every 1.x engine reads, so a manifest that uses them needs no `minVersion`. A Material Symbols name outside the bundled set falls back to the default pin instead of failing validation, so new icons never need a new manifest generation.

## Security

- No HTML is rendered from data: Lit templates and `textContent` only; Mapbox popups use `setDOMContent` (`docs/research/design-review-security-cost.md` §1.7). POI descriptions are rendered like About: by walking `parseMarkdown(...).paragraphs` into DOM nodes.
- Only https URLs and the URL-restricted Mapbox public token reach the page; a secret token cannot pass the schema.
- The page's meta CSP and headers: [research/design-review-security-cost.md](research/design-review-security-cost.md) §1.8. Analytics hosts join the CSP only for the consent-gated SDKs.
