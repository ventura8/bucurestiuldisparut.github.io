# Engine API v1

The public contract of the **Historic City Map** viewer engine (`@hcm/engine`) for city owners who embed it and for the agents who build it. It covers the embed configuration (`config.js`), the `<hcm-map-viewer>` element, the JavaScript API, the URL hash, the City Manifest v1 and the versioning rules. The exact TypeScript interfaces behind it, and who owns which module, are in [research/M1-interfaces.md](research/M1-interfaces.md); the architecture is in [ARCHITECTURE.md](ARCHITECTURE.md).

Status (M1): the manifest, configuration, URL hash and validation contracts are implemented and tested in `@hcm/shared` (`packages/shared/src/schemas/`, `packages/shared/src/url/hash.ts`). The element, the JavaScript API and the auto-boot are specified here and land with the M1 viewer.

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
        <script src="engine/engine.iife.js" defer></script>
    </head>
    <body>
        <div id="historic-city-map"></div>
    </body>
</html>
```

```js
// config.js
window.HistoricCityMapConfig = {
    cityId: 'bucuresti',
    manifestUrl: 'https://storage.googleapis.com/<project>-public/cities/bucuresti/manifest.json',
};
```

Bucharest serves the engine from its own origin (CI copies the engine build next to the page). A third-party city that loads it from jsDelivr pins an exact version with `integrity` and `crossorigin`; SRI is impossible with a range URL such as `@1`.

## config.js

`window.HistoricCityMapConfig` is validated with `engineConfigSchema` (`packages/shared/src/schemas/config.ts`); every object is strict, so an unknown key is an error.

| Field | Type | Default | Rule |
| --- | --- | --- | --- |
| `manifestUrl` | string | none | https, or relative to the page (no `..`, no `//host`). Exactly one of `manifestUrl` and `manifest`. |
| `manifest` | object | none | An inline City Manifest v1 (the starter kit's static mode, no backend). Validated like a fetched one. |
| `cityId` | string | none | `^[A-Za-z0-9_-]{1,40}$`. When present it must equal `manifest.city.id` (else `error.config.cityMismatch`); it also namespaces the stored preferences. |
| `container` | string | `#historic-city-map` | CSS selector of the element to mount into (auto-boot only). |
| `lang` | string | `ro` | A BCP 47 tag; anything that is not English resolves to Romanian. |
| `engineBase` | string | the folder of the engine script | https or relative, ending with `/`: where the engine's own CSS, fonts and icons live. |

**Auto-boot.** When the IIFE build runs it reads `window.HistoricCityMapConfig`:

- present and valid: it mounts into `container`; a missing element shows `error.config.container` in the console log and nothing on the page (there is nowhere to draw);
- present and invalid: the error card in `container` shows `error.config.invalid` with the first issue (`path` and the localized `validation.*` message), so the city owner sees what to fix;
- absent while `#historic-city-map` exists: the error card shows `error.config.missing` (scenario V17);
- absent and no default container: nothing happens (the page uses `<hcm-map-viewer>` or `HistoricCityMap.mount` itself).

**Language** is resolved in this order: the URL (`#…&lang=` or `?lang=`), the visitor's stored choice, `config.lang`, then Romanian. `<html lang>` follows the result (scenario V11).

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

Events are `CustomEvent`s that bubble and cross shadow roots (`composed: true`):

| Event | `detail` | When |
| --- | --- | --- |
| `hcm-ready` | `{ cityId, engineVersion, layers, photos }` (counts) | The manifest passed validation and the map's style loaded. |
| `hcm-error` | `{ code, retryable, detail? }` | Boot or map error; `code` is an i18n key (`error.*`), `detail` a non-localized hint (an issue path, an HTTP status). |
| `hcm-layer-change` | `{ layerId, visible, opacity, year }` | A historical layer was shown, hidden or faded (by the visitor, the hash or the API). |
| `hcm-photo-open` | `{ photoId }` | A photo's sheet opened. |

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
    /** Shows or hides a layer; without `visible` it toggles. */
    toggleLayer(layerId: string, visible?: boolean): void;
    /** Opens a photo's sheet (null closes it); an unknown id shows the `error.unknownPhoto` toast. */
    openPhoto(photoId: string | null): void;
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
| `op` | Per-overlay opacity (PLAN Addendum 3) in percent, clamped to `[0, 100]`; at most 50 entries; wins over `opacity`. Overlays are the layer ids, `photos` and, later, POI categories. |
| `photo` | The open photo; an id that is not in the manifest shows a toast (scenario V09). |
| `lang` | `ro` or `en`; anything else is ignored. |

Unknown parameters are ignored, a repeated one keeps its last valid value, and a hash longer than 2,048 characters is ignored as a whole. Ids are only ever looked up in a `Map`, never used in a selector. The legacy hash of the 2015–2022 site, `#zoom/lat/lng/rotation/!a3!p2`, still opens the same view: its `!…` layer codes are ignored and the viewer rewrites the hash in the v1 form. Codec: `encodeHash` and `decodeHash` in `packages/shared/src/url/hash.ts`.

## City Manifest v1

The only data the viewer reads: a static JSON file (from the public bucket, or inline in `config.js`). Schema: `manifestSchema` in `packages/shared/src/schemas/manifest.ts`; the Bucharest seed is `seed/bucharest/manifest.static.json`. Every object is strict: an unknown key is an error (which also blocks prototype-pollution keys).

```json
{ "version": 1, "city": { "id": "bucuresti", "...": "..." }, "layers": [], "photos": [] }
```

Common rules:

- **Text** is plain text, rendered with `textContent` or Lit templates, never as HTML; it is trimmed and must not be empty. `{ro, en}` means both languages are required, `{ro, en?}` that English falls back to Romanian.
- **Markdown subset** (`about`, `privacy`): paragraphs separated by a blank line, `**bold**`, `_italic_` or `*italic*`, `[label](https://…)` links, `\` escapes. A link that is not https makes the manifest invalid; HTML is shown as text. Parser: `parseMarkdown` in `packages/shared/src/text/markdown.ts`.
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
| `analytics` | `{measurementId?, errorEndpoint?}` | `G-…`; https. GA4 loads only with a `measurementId` and the visitor's consent |
| `engine` | `{minVersion?}` (optional) | the oldest engine that can read this manifest |

### `layers[]`

| Field | Type | Rule |
| --- | --- | --- |
| `id` | string | unique in the manifest |
| `year`, `date?` | integer, `YYYY-MM-DD` | 1800 to 2100; `date` within `year` |
| `label`, `description?` | `{ro, en}` | at most 200 and 5,000 characters |
| `kind` | `satellite`, `aerial` or `map` | |
| `sensor?`, `attribution` | string | at most 100 and 500 characters; the attribution is always shown with the layer |
| `source` | object | `{type: 'mapbox', tilesetId: '<owner>.<id>'}`, `{type: 'xyz', tiles: [https template with {z} {x} {y}], tileSize: 256 or 512}` or `{type: 'pmtiles', url}` |
| `minzoom`, `maxzoom` | number | 0 to 24, `minzoom` ≤ `maxzoom` |
| `bounds?` | `[[w, s], [e, n]]` | where tiles exist |
| `order` | integer | drawing order (higher on top) in the Standard style's `middle` slot |
| `defaultVisible`, `opacity` | boolean, 0 to 1 | initial state |
| `adjustments?` | `{brightnessMin?, brightnessMax?, contrast?, saturation?}` | Mapbox `raster-*` paint values (brightness 0 to 1, min ≤ max; contrast and saturation -1 to 1), applied live (PLAN Addendum 3) |

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

## Errors and validation

The engine checks a manifest in three steps, each with a localized message:

1. `version` must be `1`, else `error.manifest.version`;
2. `city.engine.minVersion`, when present, must not be newer than `ENGINE_VERSION`, else `error.manifest.engineTooOld` (with the version);
3. the strict schema, else `error.manifest.invalid` with the issue count; each issue is `{path, code}` where `code` is a `validation.*` key (`validateManifest`, `checkManifestCompat` in `@hcm/shared`).

A fetch that returns 404 shows `error.manifest.notFound`, a network failure `error.manifest.network`, a slow response `error.manifest.timeout`; each error card has a Retry button. No error ever leaves a blank map (scenario V01).

## Versioning and compatibility

- **Engine releases follow SemVer.** jsDelivr's `@1` follows every 1.x release; Bucharest ships the exact build of its commit.
- **The manifest has its own generation number** (`version: 1`). Engine 1.x reads only manifest v1.
- **Within v1 a field is only ever added, and only as optional**, in a minor engine release. A manifest that uses a new field sets `city.engine.minVersion` to that release, so an older engine shows "this map needs engine X" instead of rejecting the unknown key. The manifest builder sets `minVersion` automatically.
- **Removing, renaming or changing the meaning of a field** makes manifest v2 and engine 2.0; the builder can then write both generations side by side during the transition.
- **`config.js`, the element and the JavaScript API** change additively in minor releases; a deprecated name keeps working for at least one minor release and is removed only in a major one.
- **The URL hash** keeps v1's grammar for the whole 1.x line; new parameters are additive and old readers ignore them. The legacy hash stays readable.
- **Planned additions in v1** (PLAN Addendum 3): `pois[]` and `poiCategories[]` (points of interest by category), introduced with `engine.minVersion` as above.

## Security

- No HTML is rendered from data: Lit templates and `textContent` only; Mapbox popups use `setDOMContent` (`docs/research/design-review-security-cost.md` §1.7).
- Only https URLs and the URL-restricted Mapbox public token reach the page; a secret token cannot pass the schema.
- The page's meta CSP and headers: [research/design-review-security-cost.md](research/design-review-security-cost.md) §1.8. Analytics hosts join the CSP only for the consent-gated SDKs.
