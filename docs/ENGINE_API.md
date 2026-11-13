# Engine API v1

The public contract of the **Historic City Map Maker** viewer engine (`@hcm/engine`) for city owners who embed it and for the agents who build it. It covers the embed configuration (`config.js`), the `<hcm-map-viewer>` element, the JavaScript API, the URL hash, the City Manifest v1 and the versioning rules. The exact TypeScript interfaces behind it, and who owns which module, are in [research/M1-interfaces.md](research/M1-interfaces.md); the architecture is in [ARCHITECTURE.md](ARCHITECTURE.md).

Status (M1): the manifest (with the POIs and overlay defaults of PLAN Addendum 3), configuration, URL hash, validation and overlay-model contracts are implemented and tested in `@hcm/shared` (`packages/shared/src/schemas/`, `packages/shared/src/url/hash.ts`, `packages/shared/src/overlays/`). The element, the JavaScript API and the auto-boot are implemented in `@hcm/engine` (`packages/engine/src/index.ts`, `packages/engine/src/mount.ts`) and `@hcm/ui` (`packages/ui/src/viewer/`) and boot the built Bucharest site in the e2e smoke (scenario S-V16-HAPPY).

## The three files of a city

A city site is a page, its `config.js` and the engine (a new city's kit has its own three files, the page, `city.json` and a README: [The starter kit](#the-starter-kit)). Mapbox GL JS **3.34.1** is loaded from `api.mapbox.com` and is never bundled; the engine finds it as the global `mapboxgl`.

```html
<!doctype html>
<html lang="ro">
    <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="referrer" content="strict-origin-when-cross-origin" />
        <title>București dispărut</title>
        <link rel="stylesheet" href="engine/engine.css" />
        <script src="https://api.mapbox.com/mapbox-gl-js/v3.34.1/mapbox-gl.js" async></script>
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

The page's body is one `main` landmark headed by a level-one heading (the site's title, for screen readers only: `hcm-visually-hidden` of `engine.css`, since the map fills the window). Everything the viewer draws (the timeline, the menu, toasts, the sheets) is then inside a landmark; a page that embeds the viewer among its own content puts it in its `main` or in a labelled region the same way. The generated city pages (`scripts/site/src/page.ts`) do this.

```js
// config.js
window.HistoricCityMapConfig = {
    cityId: 'bucharest',
    manifestUrl: 'https://storage.googleapis.com/<project>-public/cities/bucharest/manifest.json',
};
```

Bucharest serves the engine from its own origin (the site build copies every file of the engine build next to the page: `engine.mjs` with its lazy chunks, `compare-<hash>.js` for swipe compare, `firebase-sdk-<hash>.js` and `field-sdk-<hash>.js` (Google's `web-vitals` and the event guard, `ARCHITECTURE.md` → *Field measurements*) after consent, `engine.iife.js` with its extras `extra-<name>-<hash>.js` ([Extras on demand](#extras-on-demand)), `engine.css`, `fonts/` and `THIRD_PARTY_NOTICES.txt`, the licences of the packages and fonts it carries). The chunks import what they share with the entry from `engine.mjs`, which may export such internal bindings besides the names of the [JavaScript API](#javascript-api); only those names are the API.

The manifest is the one the admin publishes to the project's public bucket. A site whose `site.json` says `publicManifest: true` (Bucharest) gets the `config.js` above from a site build that names the bucket (`HCM_PUBLIC_BUCKET`, a repository variable in CI; `scripts/site/src/public-manifest.ts`): its `manifestUrl` is the bucket's `cities/<cityId>/manifest.json`, nothing is bundled, and the page's CSP names the bucket and the project's crash-report endpoint. A build without the bucket bundles the site's own manifest (Bucharest's seed snapshot, `data/manifest.json`; `site.json`'s `additions` join other seed folders' photos after it, Bucharest's the old site's 2023 additions with their corrections, `scripts/site/src/additions.ts`) and serves the committed `config.js`, which names it; the starter kit always does. The viewer never reads Firestore. A module script runs after the deferred classic scripts above it, so the configuration exists when the engine starts. Mapbox GL JS loads `async` (since 2026-11-12, `DECISIONS-for-review.md` §178f): the engine paints the viewer at once and creates the map when `mapboxgl` is there, so a cold first paint does not wait for its 526 KB; a page that still loads it `defer` (the starter kit) works as before. The page needs no `mapbox-gl.css`: the viewer links it inside its shadow root (`mapboxCssUrl`), and a copy in the page's head only held back the first paint until api.mapbox.com had answered; a page that keeps one (the starter kit) works as before. Without `mapboxgl` and without a Mapbox GL script still loading, the viewer shows its map error. `engine/engine.iife.js` with `defer` works the same way for pages that cannot load modules.

`globalThis.HistoricCityMapConfig = {…}` is the same as `window.HistoricCityMapConfig = {…}` in a classic script; the committed `config.js` files use the `window.` form (ESLint gives them the browser globals). A site build reads `config.js` without running it (`scripts/site/src/config-js.ts`), so the file must be one assignment of literal data: objects, arrays, strings, numbers, booleans and `null`. The site build refuses a `config.js` whose `cityId` is not the manifest's city; a site whose source manifest still names an older id says so in its `site.json` (`legacyCityId`: the Bucharest seed, migrated as it was, names `bucuresti`, while the project's city and every manifest the server builds is `bucharest`), and the served manifest takes `config.js`'s id. A third-party city that loads it from jsDelivr pins an exact version with `integrity` and `crossorigin`; SRI is impossible with a range URL such as `@1`. SRI covers only the file it is written on: `engine.mjs` fetches its lazy chunks (`compare-<hash>.js` for swipe compare, `firebase-sdk-<hash>.js` and `field-sdk-<hash>.js` after the analytics consent) with dynamic imports that carry no integrity, so a page that relies on SRI loads `engine.iife.js` (with `defer`) and needs one `integrity`: the IIFE loads the same code as its extras, each with the integrity the build wrote into it ([Extras on demand](#extras-on-demand); the 2026-10-24 security review; an import map with `integrity` entries for the chunks is the module build's alternative, `DECISIONS-for-review.md` §57i, §181).

### The page's tab icon

Every page has a tab icon: by default the Layers panel's map glyph (Material Symbols Rounded `map`, Apache License 2.0) on a rounded square, in the colours of the theme the user chose; a city's editors can replace their city's with an image in the admin (Settings → Browser tab icon, `cities.setIcon`: [research/M2-interfaces.md](research/M2-interfaces.md) → *The city's tab icon*). The City Manifest does not change and the engine gains no byte: the page's own script does the work.

- **Before any script runs**, every page the build writes (a city site, the generic `/city/` page, the admin, the start and legal pages, 404 and start-up) links the default twice, inlined as 32 px PNG `data:` addresses (`DEFAULT_TAB_ICONS` of `@hcm/shared`), each under its scheme: `<link rel="icon" type="image/png" sizes="32x32" media="(prefers-color-scheme: light)" href="data:…">` and the same for `dark`. The square is the theme's `primary` and the glyph its `on-primary`, of the project's default colour `#8B5E3C`: `#875329` with `#FFF7F4` in light, `#F4BB92` with `#5D3719` in dark (`DEFAULT_ICON_VARIANTS`). Every page's policy allows `data:` images; nothing is fetched.
- **The chosen theme.** A viewer page loads `tab-icon.js` after `config.js` (the generic city page's `config.js` ends with the same lines; `tabIconSource`, `scripts/site/src/hosting/city-page.ts`). `followViewerTheme` paints the icon when the page has loaded (the stored choice, else the system's scheme), when the map is ready or failed (the city's own colours arrive with its manifest), after a click or a key (the visitor picked Light, Dark or System in Settings) and when the system's scheme or contrast changes. `paintTabIcon` reads `--md-sys-color-primary` and `--md-sys-color-on-primary` from `<hcm-map-viewer>`, draws the glyph on a canvas and puts the PNG's `data:` address into the one icon link left (its `media` removed): no request, elements and attributes only, never HTML. A stored value that is no theme counts as System, as in the engine. The admin does the same from its root's theme each time the shell applies one (`packages/ui/src/admin/shell/tab-icon.ts`), so a seed colour being previewed shows in the tab too.
- **A city's own uploaded icon is never recoloured.** A page that reads the public bucket (the Hosting root, `/city/`) probes `https://storage.googleapis.com/<project>-public/cities/<cityId>/icon-own-32.png`, which exists only while the city's icon is an upload (`STORAGE_PATHS.cityOwnIcon`). Once it has loaded, the tab's link takes that address (`showCityIcon`) and `paintTabIcon` leaves it alone in every theme. The admin overwrites the object in place (`Cache-Control: public, max-age=300`), so a new icon reaches the next load of every tab without a deploy; Use the default deletes it. The same script links `…/icon-180.png` as `apple-touch-icon` once it has loaded: the upload, or the default in the city's seed colour, which the manifest's build draws (a home screen has no theme). A city with neither file keeps the themed default; each missing file is one 404 line in the console.
- **The starter kit's `index.html`** inlines the default in the project's colour (`DEFAULT_FAVICON_DATA_URL`), and a static export carries its city's own icon inlined the same way (`fillKitPage`'s optional `icon`), or the kit's default.

The default's outline is `MAP_GLYPH_PATH` (`packages/shared/src/kit/map-icon.ts`), checked against the kit's font subset by the static stage's `fonts` gate; `functions/test/cities/map-icon.test.ts` draws the three inlined PNGs again with sharp and compares the pixels.

## The starter kit

A new city copies `templates/starter-kit/` (M5; [research/M5-interfaces.md](research/M5-interfaces.md) §3), or runs `npx create-historic-city@1.0.0-beta.1 <folder>`, which writes the same three files with its name, rectangle, start view and theme ([SELF_HOST.md](SELF_HOST.md)). There is no `config.js`: the element's attributes are the configuration.

| File | Role |
| --- | --- |
| `index.html` | the page: the meta CSP first, Mapbox GL JS 3.34.1 from `api.mapbox.com` and the engine's `engine.css` and `engine.iife.js` from a pinned jsDelivr folder, each with `integrity` and `crossorigin`, and `<hcm-map-viewer manifest-url="city.json" lang="ro">` |
| `city.json` | a City Manifest v1: an example city with one place category and three places (a point, a line, an area), no photos and no layers, and the placeholder token `pk.replace-with-your-token`, which Mapbox refuses until the owner puts their own URL-restricted public token in |
| `README.md` | the steps, in English |

```html
<body class="hcm-fullpage">
    <main>
        <h1 class="hcm-visually-hidden">Orașul meu</h1>
        <hcm-map-viewer manifest-url="city.json" lang="ro">
            <p class="hcm-note" lang="ro">Harta se încarcă. …</p>
            <p class="hcm-note" lang="en">The map is loading. …</p>
        </hcm-map-viewer>
    </main>
</body>
```

- **The page frame lives in `engine.css`**, since the kit has no fourth file: `.hcm-fullpage` (on `<body>`: no margin, the system's background and text colours, the viewer filling the window in `dvh`) and `.hcm-note` (a readable line length and size for the notes). A page of its own may use them too.
- **The note**: an element the engine has not defined shows its children; once the engine defines `<hcm-map-viewer>`, its shadow root (which has no slot) hides them. The bilingual note therefore stays only when the engine was refused (a wrong `integrity`, a version that does not exist) or never came, and it names the README's check. Without JavaScript, `<noscript>` says the map needs it.
- **The engine block** sits between `<!-- hcm:engine -->` and `<!-- /hcm:engine -->`. `fillKitPage(template, values)` (`@hcm/shared`, `packages/shared/src/kit/page.ts`) replaces only the page's slots: the `lang` of `<html>` and of the element, the title, the description and theme-colour metas, the level-one heading, the element's `manifest-url`, the CSP (always recomputed from the engine's source: `kitContentSecurityPolicy`) and the engine block, either `{kind: 'cdn', release}` (the release's folder, with the integrity `release.json` publishes) or `{kind: 'local'}` (`engine/` beside the page, the static export's). A template without one of these slots, or with one twice, throws `KitPageError`. The release pins the committed template this way; `create-historic-city upgrade` carries a newer release's pins into an existing page.
- **The tab icon** is the default map glyph, inlined (see [The page's tab icon](#the-pages-tab-icon)); `fillKitPage`'s optional `icon` (a PNG as a `data:` address) replaces it, which the static export does with its city's own. The owner may put any other icon there.
- **The CSP** is the one table of every engine page (`packages/shared/src/kit/csp.ts`): with the engine from jsDelivr, `script-src`, `style-src` and `font-src` name the pinned folder instead of `'self'`; `connect-src` and `img-src` keep `'self'` for `city.json` and the photos beside it. A manifest that names tiles or photos on another host needs that origin in `img-src` and `connect-src` (the README says so).
- **Updating the engine** changes the version and both `integrity` values of the engine block together (the new release's `release.json`); a page pinned with integrity never follows a range such as `@1`.

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

**Language** is resolved in this order: the URL (`#…&lang=` or `?lang=`), the visitor's stored choice, `config.lang`, then Romanian. `<html lang>` follows the result (scenario V11). An error card shown before any manifest (a missing or invalid `config.js`) follows the URL, then `config.lang`. The visitor switches it, and the theme (system, light, dark), in the menu's **Settings** (Setări), a dialog of its own; About holds neither (the owner, 2026-11-08). `setLang` accepts any tag and resolves it like `config.lang`. On an extra-large window (1600 px and wider) the Layers pane, always docked there, minimizes with its collapse button (**Restrânge straturile** / **Collapse layers**, `aria-expanded="true"`, where narrower windows have a close) to one floating button on the map's leading edge, at its gutter (**Straturi**, a layers icon, `aria-expanded="false"`, or the `l` key's focus on it), which brings it back; there is no rail, and the map takes the whole width (the owner, 2026-11-09). The minimized pane lasts for the session, also when the window leaves the extra-large layout and comes back: it is not in the URL hash, and the switches and sliders keep their values.

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
| `hcm-map-labels-change` | `{ streets, pois }` | The basemap's own labels changed ([Map labels](#map-labels)), by the visitor, the hash or the API; a link's choice fires it after `hcm-ready`. Additive within v1. |
| `hcm-compare-change` | `{ open, mode, layerId, position }` | M4: swipe compare opened, closed, switched between `swipe` and `toggle` (the window class), changed its compared side or settled its divider (a drag once, on release; a key each time) ([Compare](#compare)); closed, `mode`, `layerId` and `position` are `null`. A compare the URL hash opens fires it after `hcm-ready`. |

## JavaScript API

The IIFE build exposes `window.HistoricCityMap`; the ES module build exports the same names.

| Export | Type |
| --- | --- |
| `ENGINE_VERSION` | `string`, `major.minor.patch` |
| `MAPBOX_GL_VERSION` | `'3.34.1'` |
| `mount(element, config)` | `(element: HTMLElement, config: EngineConfig) => HistoricCityMapController` |
| `defineElements()` | registers `<hcm-map-viewer>` and its parts; idempotent |

```ts
interface HistoricCityMapController {
    /** Settles once: the map is ready, or boot failed (it never rejects). */
    readonly ready: Promise<{ readonly ok: true; readonly cityId: string } | { readonly ok: false; readonly code: MessageKey }>;
    /** Shows the layers of `year` (null: today, no historical layer). */
    setYear(year: number | null): void;
    /**
     * Shows or hides an overlay (a layer id, `photos` or a POI category id); without `visible` it toggles. A historical layer
     * switched on moves the timeline to its year (the other visible layers stay); switching layers off leaves the timeline.
     */
    toggleLayer(layerId: string, visible?: boolean): void;
    /** Sets an overlay's opacity (0 to 1, clamped) live; an unknown id is ignored. */
    setOverlayOpacity(overlayId: string, opacity: number): void;
    /** Opens a photo's sheet (null closes it); an unknown id shows the `error.unknownPhoto` toast. */
    openPhoto(photoId: string | null): void;
    /** Opens a POI's details (null closes them); an unknown id is ignored. */
    openPoi(poiId: string | null): void;
    setLang(lang: 'ro' | 'en'): void;
    /** M4: compares the map with `layerId` (null: today, no historical layer); an unknown or non-raster id is ignored. */
    openCompare(layerId: string | null, options?: { readonly position?: number }): void;
    /** M4: moves the divider (0: the compared side fills the map, 1: the main side does; clamped). */
    setComparePosition(position: number): void;
    /** M4: closes compare and destroys its second map; nothing happens when it is closed. */
    closeCompare(): void;
    /** Draws or hides the basemap's street names and points of interest, live; a kind the basemap does not have is ignored. */
    setMapLabels(labels: { readonly streets?: boolean; readonly pois?: boolean }): void;
    /** Removes the map (one map per view), every listener and the rendered content; later calls do nothing. */
    destroy(): void;
}
```

`mount` renders an `<hcm-map-viewer>` into `element`. Calls made before `ready` settles are applied once the map is ready; calls after `destroy` are ignored. Every call that changes what the visitor sees updates the URL hash with `history.replaceState`, so a shared link restores it.

## URL hash v1

```text
#<zoom>/<lat>/<lng>[/<bearing>][&layers=<id>,<id>][&opacity=<0..1>][&op=<id>:<0..100>,...][&cmp=<id>][&sw=<0..100>][&labels=streets,pois][&photo=<id>][&pv=original|improved|colorized][&story=<id>][&lang=ro|en]
```

| Part | Rule when read |
| --- | --- |
| view | 3 or 4 plain decimals (no exponent, no `Infinity`); zoom clamped to the city's `minZoom`..`maxZoom`, the centre to the city bounds, the bearing wrapped to `[0, 360)`. The encoder writes zoom with 2 decimals, latitude and longitude with 5, the bearing with 1 and omits a bearing of 0. |
| `layers` | Visible historical layers; ids must match `^[A-Za-z0-9_-]{1,40}$`, others are dropped; duplicates removed; `layers=` (empty) means none. |
| `opacity` | Opacity of the visible historical layers, clamped to `[0, 1]`. |
| `op` | Per-overlay opacity (PLAN Addendum 3) in percent, clamped to `[0, 100]`; at most 50 entries (the encoder never writes more); wins over `opacity`. Overlays are the layer ids, `photos` and the POI category ids ([Overlays](#overlays)). An entry for an id the manifest does not have is dropped (`decodeHash` with `overlayIds`), and the viewer writes only the overlays whose opacity differs from the manifest default. |
| `cmp` | M4: swipe compare is open with this historical layer on the compared side; empty (`cmp=`) means today, no historical layer. An id that is not a layer of the manifest opens nothing and the viewer rewrites the hash without `cmp` and `sw` (scenario V06). |
| `sw` | M4: the divider in percent of the map's width, clamped to `[0, 100]`; 50 when absent, ignored without `cmp`; on a compact window 0 shows the compared side and anything else the main one. Either of `cmp` and `sw` may come first. |
| `labels` | The basemap's labels that are drawn: `streets`, `pois`, comma-separated, in any order; `labels=` (empty) means none. Absent is the city's default, and the encoder omits a default, so a link from before this parameter opens as it did. An unknown word is ignored (`labels=streets,transit` is `streets`), and a value with nothing but unknown words is ignored as a whole. A kind the city's basemap does not have is dropped and the next write omits it ([Map labels](#map-labels)). |
| `photo` | The open photo; an id that is not in the manifest shows a toast (scenario V09). |
| `pv` | The version of the open photo the visitor picked ([Photo versions](#photo-versions), V61): `original`, `improved` or `colorized`; any other word reads as `original`. Written only with `photo=`, and only once the visitor picked one; absent, each photo shows its default. A version the photo does not have shows its default. |
| `story` | M17: the open story, in its sheet, with the timeline at the stop nearest its first year; an id that is not in the manifest shows a toast (`error.unknownStory`, scenario V50) and opens nothing. The viewer writes it while a story is open, so Share copies a story's own link. With `layers=` in the same hash, the link's layers (and their year) win over the story's year. |
| `lang` | `ro` or `en`; anything else is ignored. |

Unknown parameters are ignored, a repeated one keeps its last valid value, and a hash longer than 2,048 characters is ignored as a whole. Ids are only ever looked up in a `Map`, never used in a selector. The legacy hash of the 2015–2022 site, `#zoom/lat/lng/rotation/!a3!p2`, still opens the same view: its `!…` layer codes are ignored and the viewer rewrites the hash in the v1 form. Codec: `encodeHash` and `decodeHash` in `packages/shared/src/url/hash.ts`.

## Compare

Status (2026-10-24): built by the M4 compare workstream (scenario rows V06; `e2e/specs/viewer/compare.spec.ts`, the tour's journey `compare` at every viewer viewport).

Swipe compare (M4, scenario V06; the contract is [research/M4-interfaces.md](research/M4-interfaces.md) §3) shows the map beside the same map with another historical layer, or with none (today), split by a divider the visitor drags or moves from the keyboard. It is the engine's own: no plugin is loaded.

- **Where it starts.** The Layers panel's Compare (today while the map shows a historical layer, else the newest layer; the button closes compare while it is open), the URL hash, or `openCompare`. The compare bar at the top of the map names the main side, chooses the compared side (today or another historical layer; what the main side shows already is no choice, since a side compared with itself shows nothing, unless it is the side compared now) and closes.
- **One map per view.** The second map exists only while the visitor compares: it is created the first time compare is open on a window 600 px wide or more and destroyed when compare closes (Close, Esc on the divider, the map going away, the controller's `destroy()`). A window that becomes compact hides it instead, for a minute (`COMPARE_PARK_MS`), and destroys it then: a phone turned back and forth, or a window dragged across 600 px, shows the same map again instead of paying a new map load each time (the 2026-10-24 cost review). Every Mapbox map is a billed map load, and the e2e map-instance counter checks both. The second map takes no pointer or keyboard input: the viewer's map takes every gesture on either side and the second follows its camera.
- **A lazy part of the engine.** The ES module build fetches compare's code as its own chunk, `compare-<hash>.js` (budget: 5 KB gzip), the first time it opens (the site build copies it with the engine); the IIFE build loads the same code as its extra `extra-compare-<hash>.js` (budget: 8 KB gzip), with its integrity ([Extras on demand](#extras-on-demand)). A page that pins the engine with Subresource Integrity covers the file its `integrity` is on, and `engine.mjs` fetches its chunks (`compare-<hash>.js`, `firebase-sdk-<hash>.js`, `field-sdk-<hash>.js`) with plain dynamic imports that carry no integrity: such a page loads `engine.iife.js`, whose extras carry theirs (see *config.js* below). A chunk that does not arrive closes compare with a message to try again (`error.extraLoad`); the next Compare fetches it afresh.
- **Both sides move together**: dragging, zooming or rotating either keeps both maps on the same centre, zoom and bearing.
- **Each side keeps its overlays' opacity.** The main side is the map as it was; the compared side shows the same basemap, photos and places with the same visibility and opacity, and only the compared historical layer, with its own opacity and image adjustments. An opacity slider moved while comparing changes both maps.
- **The divider** is a slider for assistive technology (its value is the main side's share in percent, its text names both sides and their shares): the arrow keys move it by 1 %, Shift and Page Up/Down by 10 %, Home and End to the edges, Esc closes compare; a pointer drags its 48 px handle (below the map's centre), and the divider settles on the whole percent.
- **Compact windows** (below 600 px) get a toggle between the two sides on the one map instead of a second map (one made on a wider window waits hidden for a minute, as above).
- **The legal line**: one Mapbox logo and one attribution, the viewer map's, stay visible above both sides at every divider position (the second map's own are hidden); the compare bar credits the compared layer's source ("Sursa: …"), and the viewer map's attribution the main side's.
- **The URL hash** carries `cmp=` and `sw=` ([URL hash v1](#url-hash-v1)); a shared link reopens compare where it was. Codec: `CompareState` in `packages/shared/src/url/hash.ts`.

## Map labels

Status (2026-11-07): the owner's request; scenario rows V31, `e2e/specs/viewer/map-labels.spec.ts`, the tour's states `layers-map-labels` and `layers-no-map-labels`. Additive within v1.

The Layers panel's **Map labels** group has two switches for the text Mapbox draws on today's map: **Street names** (Standard's `showRoadLabels`) and **Points of interest** (`showPointOfInterestLabels`), both on the `basemap` import. They apply live with `setConfigProperty`, with no new map load. Both Mapbox Standard and Mapbox Standard Satellite have them (Mapbox: the Satellite style takes all of Standard's configuration except the 3D objects and the colours). To a visitor tram, metro and rail stations are points of interest, so **Points of interest** also drives Standard's `showTransitLabels` (the owner's report of 2026-11-08: the stations stayed when the switch was off), live, in a link's mount `config` and on swipe compare's map; it is written only where the map has `showPointOfInterestLabels` too. A city's explicit `showTransitLabels` in `basemap.config` stands: `false` keeps the stations hidden, `true` keeps them while the switch is at the city's own default. `showPlaceLabels` (neighbourhood and city names, which orient a visitor) is not the visitor's choice: a city sets it in `basemap.config`.

- **Not the city's places.** A POI category of the manifest is an overlay with its own switch and opacity under **Places**. The group's note says so when the city has such categories; nothing here changes an overlay.
- **The default is the city's.** There is no field for it: `basemap.config` sets `showRoadLabels` or `showPointOfInterestLabels` to `false`, and the switch starts off and the hash omits it. Without them, a label is drawn (Standard's default, and what the map itself reports for a style with its own default). A link's choice stands over a style's own default; the choice the map was mounted with hides the default beneath it, so the hash then keeps `labels` until a link without it opens, even at what may be the default, and no reload loses it.
- **What a basemap can do is read, not assumed.** Once the map has loaded, the viewer asks it for each property. A custom style, or the base without the `basemap` import, has neither: no group shows, what a link asked for is dropped, `setMapLabels` changes nothing and fires nothing, and the style is never written to. A style with one of them gets that one switch. Without a map (no WebGL) there is no group.
- **A shared link never flashes** what it turned off: its choice goes into the map's creation options (`config`), not a later write.
- **Swipe compare** draws the same choice on both sides; a switch moved while comparing changes both maps, and the second map is created with it.

Code: `packages/engine/src/core/map-labels.ts`, `packages/shared/src/overlays/map-labels.ts`, `ViewerMapPort` in `packages/ui/src/map/viewer-map.ts` (the viewer's port: the admin's bundle does not carry it), and `packages/shared/src/i18n/map-labels/`, which `@hcm/shared/map-labels` exports with the panel's words.

## Keyboard and gamepad

Status (2026-11-07): the owner's request; scenario rows V36 and V37, `e2e/specs/viewer/input.spec.ts`, the tour's journey `input`; the contract is [research/viewer-input.md](research/viewer-input.md). Additive within v1: no property, event or method for a page to set.

Single keys, listed by the help panel (`?`, or About's button): `.` and `,` later and earlier year; `o` and `i` more and less opacity of the current layer; `n` and `p` next and previous photo; `l` Layers (on an extra-large window, the focus into its pane, or onto its floating button while minimized); `?` the panel.

- **They take a key only from the viewer**, or from the page's body for the page's first viewer, and never from a field, a text-like role, an open menu, or with Ctrl, Alt or Meta. Arrows, `+`, `-` and `=` stay Mapbox's, the timeline's and the lightbox's.
- **A visitor can turn them off**, in the help panel's switch (WCAG 2.1.4). The choice is stored per city as `hcm:<cityId>:shortcuts` in localStorage, like language and theme; it is no cookie.
- **A screen reader in browse mode keeps these letters for itself**: nothing reaches the page and nothing of its keys is overridden. Nobody using a screen reader has tested this yet.
- **A gamepad of the standard mapping** works through the browser's Gamepad API, in the lazy chunk `gamepad-<hash>.js`, fetched only once a pad connects: left stick pans, right stick and triggers zoom, D-pad up and down move a visible focus, left and right the year, A opens, B closes, Y Layers, LB and RB photos, Start the menu, Back the panel. Any other mapping is refused with a toast. The loop stops while the tab is hidden. A page embedding the viewer in a cross-origin frame must allow `gamepad` for it to work. **Only a fake pad has tested this; no real hardware was available.**

## Show my location

Status (2026-11-08): the owner's request ("when the user clicks show my location, we must show it with a blue dot"); scenario rows V10, `e2e/specs/viewer/geolocate.spec.ts`, the tour's state `my-location`. Additive within v1: no property, event or method for a page to set.

The menu's **Show my location** is a switch (`menuitemcheckbox`, `aria-checked`, a 3 px ring in its text colour while on, ButtonText under forced colours).

- **On**, the browser watches the visitor's position (`watchPosition`, high accuracy). The first position inside the city's `bounds` moves the camera there (zoom 16 at least; a jump under reduced motion, as every camera move) and a polite status says how accurate it is ("Your location: ±25 m"). Every position is drawn as a **blue dot with a white ring**, a translucent **accuracy circle** as wide as the browser's accuracy and, where the device gives a heading (moving, with GPS), a **cone** pointing that way; later positions move the dot, never the camera. Nothing pulses or moves by itself.
- **Off**: the menu again, a position outside the city (the toast says so, as before), a refused permission (its toast), the page hidden (`visibilitychange`), the viewer removed or destroyed. A position late or lost while one is shown keeps the last one; before the first one it says the location is unavailable.
- **Both maps**: while comparing, the second map draws the same dot (no new map load).
- **Privacy**: the position lives in the page's memory only. It is never written to the stored preferences or telemetry, and no request carries it (`S-V10-BAD-PAGE-HIDDEN`, `S-V19-BAD-HASH-NEVER-SENT`). The camera's view after the first move is the position itself, so the URL hash, and every link shared from it, keeps the view it had until the visitor moves the camera; a hash they type or follow wins (`S-V10-BAD-POSITION-NOT-IN-LINK`; the state's `hashView`, kept by `flyTo` and `setView` in `packages/engine/src/core/store.ts`). After the visitor moves the camera the hash follows it, as before.
- **Our own layer, not Mapbox's `GeolocateControl`**: a GeoJSON source and two layers (`hcm-my-location-area`, a fill for the accuracy circle and the cone; `hcm-my-location-dot`, a circle filtered to the Point, `geometryIs('Point')` from `packages/ui/src/map/pois.ts`, `['in', ['geometry-type'], ['literal', ['Point']]]`, because a circle layer draws a dot at every vertex of a polygon in its source: one dot only, `S-V10-BAD-ONE-DOT-ONLY`) in the `top` slot of every map, on the global `mapboxgl`. The control would cost no bundle bytes either, but it brings its own button, camera moves, errors and a pulsing marker, and one watch per map in compare; our layer keeps our menu, toasts and bounds check, and adds about 1 KB gzip to the engine (the IIFE measured 124,958 of its 125,000 bytes with the dot's filter, the ES module 97.2 of 100 KB). The canvas is not repainted by forced colours: the white ring keeps the dot apart from any basemap.

Code: `packages/ui/src/viewer/my-location.ts` (the switch and the watch), `packages/ui/src/map/my-location.ts` (the layer, `ViewerMapPort.setMyLocation`), `MapSync` in `packages/engine/src/core/map-sync.ts` (the state's `myLocation` on every map).

## Show on map

Status (2026-11-08): the owner's request ("we want for photos detail panel to be a locate image button"); scenario rows V51, `e2e/specs/viewer/locate-photo.spec.ts`, the tour's state `photo-located`. Additive within v1: no property, event or method for a page to set.

A photo's details have a tonal **Show on map** button ("Arată pe hartă", the `location_on` icon) under the image.

- **The camera** goes to the photo's place, zoomed in at least to 17, where its view cone shows, and never beyond the city's `maxZoom` (a camera already closer stays that close); Mapbox keeps it inside the city's `bounds`. It flies, and jumps under reduced motion, read when the button is pressed (a visitor may switch it after the map loaded): the engine then passes `animate` itself and a flight is `essential` to Mapbox, which would otherwise read the preference on its own and jump without the offset.
- **Beside the sheet**: the sheet stays open and the place ends in the middle of what it leaves of the map, half the bottom sheet's height above the centre on a phone, half the side sheet's width beside it on a medium window, on whichever side the sheet is (a right-to-left host page puts it on the left; the offset comes from the sheet's box and the map's, Mapbox's `offset`; a jump is an `easeTo` of no duration, since `jumpTo` takes none). From expanded up the sheet is a pane beside the map and the place is its centre. The map's padding is never changed.
- **A ring** in the cone's colour marks the place (our GeoJSON source and circle layer `hcm-photo-mark`, `top` slot) until the camera moves again or a photo opens or closes; it does not pulse or fade by itself, so nothing on the map moves on its own. A second press mid-flight, or a press while the map still glides after a swipe, keeps it: Mapbox stops the move under way first and fires that move's `moveend` at once, which the store ignores while the camera starts. The ring is the state's `photoMark`, drawn by `MapSync` on every map of the view: in swipe compare on both sides of the divider, and on a second map opened after it.
- **The URL hash follows the camera** as after any move: this is the photo's place, not the visitor's (compare *Show my location*). The photo stays in the hash.
- **No button** where it could not work: without a map (no WebGL, the photo list's sheet) and for a photo with no place (those are in the gallery of unplaced photos, which has no detail sheet). A point of interest's details have none either.
- **Keyboard, screen reader, gamepad**: a real button with its visible name; nothing extra is announced (camera moves are not announced anywhere in the viewer). The gamepad reaches it as any focusable control: D-pad to it, A to press it.
- **No JavaScript API**: `openPhoto` stays what it is; the place's offset depends on the sheet the viewer renders, so a page that wants the camera at a photo moves it with the hash.

Code: `HcmPhotoSheet` and `locateOffset` (`packages/ui/src/viewer/hcm-photo-sheet.ts`, the event `hcm-photo-locate` inside the viewer), `locatePhoto` in `packages/engine/src/core/store.ts` (its target `locateTarget` in `state.ts`, the ring `photoMark` drawn by `map-sync.ts`), `MapPort.flyTo`'s `offset` (`packages/ui/src/map/camera.ts`) and `ViewerMapPort.markPhoto` (`packages/ui/src/map/my-location.ts`). The bytes: the engine's IIFE was 53 bytes under its 125,000; zod's English messages, which the engine never shows (an issue reaches the visitor as its `validation.*` code), now resolve to the admin's empty stand-in in the engine's build too, 1,010 bytes gzip; with the button the IIFE measured 124,374 bytes, and 124,749 after the review's fixes (115g).

## Zoom buttons

Status (2026-11-08): the owner's request ("add zoom in and out buttons to the map"); scenario rows V52, `e2e/specs/viewer/zoom.spec.ts`, the tour's journey `zoom`. Additive within v1: no property, event or method for a page to set.

**Zoom in** and **Zoom out** ("Mărește harta", "Micșorează harta", as in the admin's map) are two 48 px icon buttons in one rounded group over the map, with their names as tooltips.

- **Where**: on the map's trailing edge (the left in a right-to-left page), centred over the menu button and 8 px above it; on a phone held upright, where the timeline stands on the leading edge, above the row of the "photos from around" chip, which can be as wide as the map, the group's foot level with the timeline's; on a short window (a phone held landscape), where the menu button is on the leading side and the lying timeline and the chip take the trailing one, over the menu button on the leading side. They keep the bottom 42 px free for the Mapbox logo and attribution like every floating control, and the tour checks them against the menu, the timeline, the chip, the sheets and the legal line at every window size. While the menu is open, which grows over them, they are hidden.
- **What**: one zoom level from the camera's current zoom, animated as the map's own moves (a jump under reduced motion); the URL hash follows when the camera stops. Without WebGL there is no map and no buttons.
- **At the city's limits** (`city.maxZoom`; for Zoom out the higher of `city.minZoom` and the zoom at which `city.bounds` just cover the map, where Mapbox stops because it keeps the view inside the bounds: for Bucharest about 10.8 on a phone and 11.6 at 1440 px) the button is **soft-disabled**: dimmed and `aria-disabled="true"`, but it keeps the focus and its place in the Tab order (a disabled button would drop the focus of a visitor pressing Enter), and a press changes nothing: the button drops its click listener, so the map does not move and the address keeps what it says. It shows no hover or pressed layer, and in forced colours it turns `GrayText` like a disabled button. The gamepad's zoom, the wheel, a pinch or a typed hash that reach a limit disable it too.
- **Compare**: the second map follows the first, so the one pair zooms both.
- **Our own buttons, not Mapbox's `NavigationControl`**: the control costs no bundle bytes (`mapbox-gl` is external) but brings 29 px targets, a compass and its own look and texts; ours use the kit's icon button (`soft-disabled` is new there), the city's theme and both languages. They cost about 650 bytes gzip of the IIFE, paid by a smaller baseline theme (`packages/ui/src/theme/baseline.ts`, about 630 bytes, the same tokens; the IIFE measures 124,993 of its 125,000 bytes): DECISIONS-for-review.md §128.

Code: `packages/ui/src/viewer/viewer-zoom.ts` (the group), `zoomBy` in `packages/engine/src/core/store.ts` (one level within the range), `packages/ui/src/components/icon-button.ts` (`softDisabled`).

## The full-size view

Status (2026-11-12, shipped with v1.0.0-beta.1's branch): the owner's request ("add + and - buttons for when viewing a photo full screen"); scenario rows V60, `e2e/specs/viewer/photo-versions.spec.ts`, the tour's journey `photo-versions`. Additive within v1.

- **Zoom in** and **Zoom out** ("Mărește fotografia", "Micșorează fotografia") are tonal 48 px icon buttons between the previous and next arrows. Each multiplies or divides the scale by 1.25 around the photo's centre, as `+` and `-` do (`0` resets; the wheel, a pinch and a drag still work, and a zoomed photo pans by dragging). At the photo's own size (1x) Zoom out and at 4x Zoom in are soft-disabled: `aria-disabled="true"`, the focus kept, a press changes nothing.
- **Side-loaded**: the view is not in `engine.iife.js` nor `engine.mjs` but in `engine.extras.js` beside them (see [Side-loaded parts](#side-loaded-parts)), added the first time a visitor opens a photo full size. If it cannot load (offline, or a file its integrity refuses), the view closes and a toast says the image could not be loaded; the next open tries again.

## Photo versions

Status (2026-11-09): the owner's request ("we will have multiple versions of a photo (original, improved, colorized)"); scenario rows V61, A140. Additive within v1: a manifest without `versions` is read as before.

- A photo has its original (`image`) and, optionally, an **improved** (restored) and a **colorized** version (`photos[].versions`), each with the credit of whoever made it.
- The viewer shows the improved version when there is one, else the original; the colorized one only when the visitor picks it. With more than one version the detail sheet and the full-size view show a segmented button **Original / Îmbunătățită / Colorizată** (Original / Improved / Colorized) and, under a version that names its maker, "Colorizată de Ana Pop" ("Colorized by Ana Pop"). The pick is kept for the session and in the address (`pv=`), so a shared link opens the same version.
- Code: `packages/ui/src/viewer/photo-version.ts` (which version shows, the switch), `setPhotoVersion` in `packages/engine/src/core/store.ts`, `photoVersion` in `packages/engine/src/core/state.ts` and `url-sync.ts`; the admin's side: [ADMIN_GUIDE.en.md](ADMIN_GUIDE.en.md).

## The map's menu

Status (2026-11-09): the owner's request ("go to Google Street View from a right click panel (hold on touch screen) on the map … also from a photo details panel"); scenario rows V62, `e2e/specs/viewer/map-menu.spec.ts`, the tour's journey `map-menu`. Additive within v1: no property, event or method for a page to set.

- **Opening**: a right click on the map, a long press on a touch screen (500 ms; a move of more than 8 px or a second finger cancels it), or the ContextMenu key or Shift+F10 while the map has the focus (at its centre). Only a click that did not drag opens it: Mapbox's right-drag rotates the map, so a right press that moved opens nothing, and a browser that asks for its own menu on press waits for the release. The browser's own menu never shows over the map.
- **The menu**: an M3 menu at the point, moved back inside the map near an edge, its first item focused; the arrow keys, Home and End move between the items; Esc or a press anywhere else closes it, and the focus goes back to what had it (the map) unless the visitor put it elsewhere. It covers nothing else: the controls and the legal line stay usable.
- **Items**: **Open in Google Street View** ("Deschide în Google Street View"), a plain link to Google Maps' panorama of the place in a new tab (`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=<lat>,<lng>`, `rel="noopener noreferrer"`: no Google script, no key, no cost; Google shows the nearest panorama, or none), **Copy coordinates** (`44.427040, 26.085300`, said by a toast; a clipboard that refuses is said too, `mapMenu.copyFailed`), and **Share a link to this view** ("Distribuie un link către această vedere"; the owner, 2026-11-12): the menu's Share, so the page's address, whose hash carries the view, goes to the Web Share API where there is one and to the clipboard otherwise (`share.copied`, `share.failed`).
- **A photo's sheet** has the same Street View link for the photo's place, with `&heading=<bearing>` when the photo has a bearing, so the panorama looks the way the photographer did.
- **The extension point**: the items are `MAP_MENU_ITEMS` in `packages/ui/src/viewer/map-menu.ts`, each `{id, icon, label, href?(place), copy?(place)}` (with neither, the item shares the view): a new use of the menu is one more entry (its text in both catalogues, its icon in the kit's icon set). The place is computed from the camera (`placeAt`: Web Mercator, no pitch, the bearing turning the screen). The menu is in the side-loaded part; the engine keeps only what opens it (`map-menu-trigger.ts`).

## Side-loaded parts

The owner's "Load extras on demand" (2026-11-09; DECISIONS-for-review.md §167): what only some visitors use leaves the engine's script for a small script of its own in the same folder, which the engine adds as a `<script>` with its Subresource Integrity when it is first needed. Today one part: `engine.extras.js` (about 5.5 KB gzip; `ENGINE_CHUNK_BUDGETS` of `scripts/ci/check_bundle_budget.py`) with the full-size view, About and its help panel, and the map's menu, added the first time a visitor opens any of them; it took about 2.8 KB out of the IIFE. If it cannot load, the full-size view closes with a toast and About closes.

- **Where from**: `<engineBase>engine.extras.js`, the engine's own folder unless `engineBase` names another, the same rule as the fonts. A page's Content Security Policy that allows the engine's folder in `script-src` allows the part too; nothing else is fetched.
- **Integrity**: the engine's build writes the part's `sha384-` digest into the engine (`packages/engine/src/extras-part.ts`, by `sidePartPlugin` of `scripts/site/src/side-part.ts`), and adds the script with `integrity` and `crossorigin="anonymous"`: a part that does not match the engine it came with is refused. `release.json` lists the part with its integrity like every file of the folder.
- **One Lit**: the part brings no copy of Lit or of the texts; it reads them from the engine (`packages/ui/src/viewer/extras-kit.ts`, handed over as `globalThis.__hcmExtrasKit` just before the script runs). The part's build (`packages/engine/vite.part.config.ts`) makes every import from outside the part a read of that kit, and a unit test checks that the kit names everything the part imports.
- **Who copies it**: a page that self-hosts the engine copies `engine.extras.js` with `engine.iife.js` (the static export does, `functions/build.mjs`); one that loads the engine from jsDelivr gets it from the same release folder.

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
| `basemap` | `{style, config?}` | `mapbox://styles/<owner>/<style>` or https; `config` sets Mapbox Standard configuration properties (at most 30), among them the [Map labels](#map-labels) defaults; a `lightPreset` here is kept, and without one the viewer sets it to `night` on a dark theme and `day` on a light one, live, with no new map load, where the style has the property |
| `mapbox` | `{publicToken}` | a `pk.` token (URL-restricted); a secret `sk.` token is rejected |
| `analytics` | `{measurementId?, errorEndpoint?, firebase?}` | `G-…`; https; `firebase` is `{apiKey, appId, projectId}` of the city's Firebase web app (`AIza…`, `1:<number>:web:<hex>`, a project id), written by the manifest builder and never committed. GA4 loads only with a `measurementId`, the `firebase` ids and the visitor's consent; without the ids the consent banner still asks, but nothing is sent. GA4 is told the page's origin and path, never the hash; withdrawing consent in About expires its `_ga` cookies; the viewer has no Performance Monitoring; after consent it also sends its field measurements (Core Web Vitals, the boot's timings, map failures: [ARCHITECTURE.md](ARCHITECTURE.md) → *Field measurements*) |
| `engine` | `{minVersion?}` (optional) | the oldest engine that can read this manifest |

### `layers[]`

| Field | Type | Rule |
| --- | --- | --- |
| `id` | string | unique in the manifest; also an overlay id, so never `photos` and never a POI category id |
| `year`, `date?` | integer, `YYYY-MM-DD` | 1800 to 2100; `date` within `year` |
| `label`, `description?` | `{ro, en}` | at most 200 and 5,000 characters |
| `kind` | `satellite`, `aerial` or `map` | |
| `sensor?`, `attribution` | string | at most 100 and 500 characters; the attribution is always shown with the layer, as plain text (markup in it is shown, never rendered) |
| `source` | object | `{type: 'mapbox', tilesetId: '<owner>.<id>'}`, `{type: 'xyz', tiles: [https template with {z} {x} {y}], tileSize: 256 or 512}` or `{type: 'pmtiles', url}` (M12, `docs/research/M12-own-tiles.md`: one PMTiles v3 archive of 256 px WebP tiles with alpha, what the project's own bucket holds; the address may be relative to the manifest in a static export; the engine reads it itself with one `Range` request a tile through Mapbox GL's custom source, so no tileset, compute unit or token, and a server without `Range` fails that layer only, naming it in a toast). The admin links a `mapbox` tileset of the city's own Mapbox account only, and never an address carrying a key or a token (`layers.link`, which refuses them as `apiError.layers.foreignTileset` and `apiError.layers.secretInAddress`); an `xyz` or `pmtiles` host must also be in the page's CSP (`img-src`, `connect-src`; the public bucket's already is) |
| `minzoom`, `maxzoom` | number | 0 to 24, `minzoom` ≤ `maxzoom` |
| `bounds?` | `[[w, s], [e, n]]` | where tiles exist |
| `order` | integer | the Layers panel's order within a year (higher first). The map stacks the historical layers by date, the newest on top, whatever their `order` (the owner, 2026-11-09), on the main map and in compare |
| `defaultVisible`, `opacity` | boolean, 0 to 1 | initial state |
| `adjustments?` | `{brightnessMin?, brightnessMax?, contrast?, saturation?}` | Mapbox `raster-brightness-min`, `raster-brightness-max`, `raster-contrast`, `raster-saturation` (brightness 0 to 1, min ≤ max; contrast and saturation -1 to 1; ranges and neutral values in `LAYER_ADJUSTMENT_RANGES`), applied live without reprocessing (PLAN Addendum 3). An absent adjustment is neutral; `rasterAdjustmentPaint` clamps live slider values and never lets the minimum pass the maximum. Mapbox has no gamma property: the brightness range is the levels control |

### `photos[]`

| Field | Type | Rule |
| --- | --- | --- |
| `id` | string | unique; the `#photo=` id |
| `title`, `description?` | `{ro, en?}` | at most 200 and 5,000 characters |
| `year?`, `yearEnd?` | integer | 1800 to 2100; `yearEnd` needs `year` and is not before it |
| `month?`, `day?` | integer | 1 to 12 and 1 to 31: the date's precision beyond the year. A month needs a `year` (and a `yearEnd`, when present, equal to it), a day needs a month and must exist in it, leap years counted (`validation.datePart`, `validation.dateRange`, `validation.dateImpossible`). The viewer reads them through `Intl`: `12 iulie 1936`, `12 July 1936`, `Iulie 1936`, `July 1936`; the timeline keeps using the year |
| `dateText?` | `{ro, en?}` | the source's own dating, such as `Vara lui 1936`; when present it is what the visitor reads, before any other date |
| `author?`, `rightsHolder?` | string | at most 200 characters |
| `license` | enum | `CC0`, `CC-BY-4.0`, `CC-BY-SA-4.0`, `PD`, `permission`, `permission-legacy` |
| `rightsReview?` | boolean | the rights of a migrated photo are being confirmed (the viewer shows a note) |
| `source?` | `{url, label?}` | where the photo comes from: https only, a label of at most 200 characters; the sheet shows a plain link in a new tab (`rel` with `noopener`), its text the label or else the address's host |
| `links` | `[{url, label}]` | at most 5, https only (legacy HTML was converted to these) |
| `location` | `{lat, lng}` | within the city bounds plus 0.5° |
| `bearing?`, `fov?` | number | 0 to 360 and 1 to 180; a photo with a bearing gets a view cone (default field of view 60°) |
| `image` | `{web, thumb, w, h}` | WebP derivatives (2048 px and 400 px on the long edge), metadata stripped; `w`, `h` of `web` |
| `versions?` | `{improved?, colorized?}` | each `{web, thumb, w, h, credit?}`: the improved and the colorized version beside the original `image`, made as `image` is; `credit` at most 200 characters ([Photo versions](#photo-versions)) |

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

At most 5,000 POIs. The timeline shows a POI at a year its span covers (an absent bound is open); "today" shows every POI (`poiInYear`). POI details open in the same sheet as photos, labels show from zoom 16. Lines and area outlines are drawn in the category colour over a white casing (wider strokes as the zoom grows, the area filled at 35 %), so they stay legible on a satellite basemap; the casing fades with the category's opacity like the rest (`packages/ui/src/map/pois.ts`, 2026-11-01).

### `stories[]` (optional)

M17 ([research/M17-stories.md](research/M17-stories.md) §4): a city's stories, absent when there are none. The menu offers Stories when the list is not empty; a photo's and a place's sheet list the stories that name them.

| Field | Type | Rule |
| --- | --- | --- |
| `id` | string | unique; the `#story=` id |
| `title` | `{ro, en?}` | at most 200 characters |
| `body` | `{ro, en?}` | at most 10,000 characters per language, the story format: the Markdown subset of the city's texts (paragraphs, `**bold**`, `_italic_`, https links) plus a paragraph that is exactly `![caption](photo:<id>)`, a figure of one of the city's photos. Any other image is text; a figure whose photo the manifest does not list is left out; an `http:` or `javascript:` link is refused |
| `yearStart?`, `yearEnd?` | integer | 1800 to 2100, never inverted |
| `photoIds?` | string[] | at most 20 ids of `photos[]` or `unplaced[]`; the first is the story's cover in the list |
| `poiIds?` | string[] | at most 20 ids of `pois[]` |
| `credit?` | string | the contributor's credit name, at most 100 characters |

At most 1,000 stories. Nothing in a story is rendered as HTML: the engine parses the text into paragraphs and figures (`parseStory` of `@hcm/shared`) and renders them with its own templates.

### Overlays

The viewer's Layers panel lists one **overlay** per historical layer, one for the photos (markers and view cones, id `photos`) and one per POI category, each with a switch and a 0–100 % slider that updates the map live. Layer ids, `photos` and category ids are one namespace (a clash is `validation.duplicateId`), because the URL hash's `op=` names overlays by id. Order: historical layers by year (the higher `order` first within a year), the photos, then the categories in manifest order. Switching a historical layer on moves the timeline to its year, so it always shows (with several on, the timeline follows the last one switched on; switching layers off leaves it), and the hash names the visible layers; a shared link's year is still the newest of its layers. In a photo's sheet, with a map, a date that holds a layer's year is a button (named by the date and **Harta din 1966** / **Map of 1966**) that shows the map at that year with its layers, the photo staying open; otherwise up to three chips name the layer years within ten years of the photo's, nearest first.

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

- **Engine releases follow SemVer.** jsDelivr's `@1` follows every 1.x release; Bucharest ships the exact build of its commit. The first release is **v1.0.0**: everything this document describes, the M4 compare additions included, is its baseline ([Releases on jsDelivr](#releases-on-jsdelivr)).
- **What a level means for a city.** A patch fixes behaviour behind the same surface; a minor adds an optional manifest field or a new name of the API, element or hash (a manifest that uses it sets `city.engine.minVersion`); a major (manifest v2, a removed name) documents its migration in its release notes.
- **Pre-releases** (`1.0.0-beta.1`, `1.0.0-rc.1`; only `-beta.N` and `-rc.N`) come before their release (`1.0.0-beta.1` < `1.0.0-rc.1` < `1.0.0`): jsDelivr serves one only at its full version (`@v1.0.0-beta.1`), a range such as `@1` never resolves to it, and `create-historic-city` publishes one under the dist-tag `beta` or `rc`. A manifest whose `city.engine.minVersion` is `1.0.0` refuses a 1.0.0 beta engine. The first pre-release is **v1.0.0-beta.1** (`docs/releases/v1.0.0-beta.1.md`).
- **The manifest has its own generation number** (`version: 1`). Engine 1.x reads only manifest v1.
- **Within v1 a field is only ever added, and only as optional**, in a minor engine release. A manifest that uses a new field sets `city.engine.minVersion` to that release, so an older engine shows "this map needs engine X" instead of rejecting the unknown key. The manifest builder sets `minVersion` automatically.
- **Removing, renaming or changing the meaning of a field** makes manifest v2 and engine 2.0; the builder can then write both generations side by side during the transition.
- **`config.js`, the element and the JavaScript API** change additively in minor releases; a deprecated name keeps working for at least one minor release and is removed only in a major one.
- **The URL hash** keeps v1's grammar for the whole 1.x line; new parameters are additive and old readers ignore them. The legacy hash stays readable.
- **Additions before 1.0.0 (M4, 2026-10-24)**: the hash's `cmp=` and `sw=`, the controller's `openCompare`, `setComparePosition` and `closeCompare`, and the event `hcm-compare-change` are part of the v1 baseline too; the manifest does not change.
- **Additions before 1.0.0** (the owner's requests, 2026-11-07, [research/photo-date-source.md](research/photo-date-source.md)): a photo's `month`, `day` and `source`. Optional: a manifest without them stays valid and reads as before; every 1.x engine reads them, so they need no `minVersion`. A viewer from before them refuses such a manifest, so Hosting goes before the functions in a deploy ([research/photo-date-source.md](research/photo-date-source.md) §3).
- **Additions before 1.0.0 (M17, 2026-11-08)**: `stories[]` and the hash's `story=` ([research/M17-stories.md](research/M17-stories.md) §4). Optional: a manifest without them stays valid; every 1.x engine reads them, so they need no `minVersion`.
- **Additions before 1.0.0 (M13, 2026-11-07)**: `unplaced[]`, `contributeUrl` and the optional `credit` of a photo and a place (`docs/research/M13-roles.md` §5). A photo in `photos[]` still needs its `location`; a manifest from before them stays valid. The map gains only a link: no sign-in, no Firestore, no cookie.
- **Additions before 1.0.0** (PLAN Addendum 3, 2026-10-12): `photosOverlay`, `poiCategories[]`, `pois[]`, the overlay namespace rule and the `op=` overlay ids. They are part of the v1 baseline that every 1.x engine reads, so a manifest that uses them needs no `minVersion`. A Material Symbols name outside the bundled set falls back to the default pin instead of failing validation, so new icons never need a new manifest generation.

### Extras on demand

The IIFE build cannot split into chunks, so until 2026-11-12 it carried every lazy part of the engine inline (124.9 KB gzip of its 125 KB budget). Since then (`DECISIONS-for-review.md` §181) the code no first paint needs is a classic script beside `engine.iife.js`, an *extra*, loaded the first time it is wanted:

| Extra | Loaded | Budget (gzip) |
| --- | --- | --- |
| `extra-compare-<hash>.js` | the first time the visitor compares | 8 KB |
| `extra-gamepad-<hash>.js` | once a gamepad connects | 3 KB |
| `extra-firebase-sdk-<hash>.js`, `extra-field-sdk-<hash>.js` | after the analytics consent | 16 KB, 7 KB |

- **Integrity.** The build computes each extra's `sha384-` digest and writes it into `engine.iife.js`, which adds the extra as `<script async crossorigin="anonymous" integrity="sha384-…">`. A page that pins `engine.iife.js` with `integrity` therefore covers its extras as well; a file changed on the way is refused by the browser.
- **Where from.** The engine script's own folder (`engineBaseOf`: jsDelivr's pinned release folder, a site's `engine/`, a static export's `engine/`). A site, a release and a static export copy the extras with the engine; a self-hosted copy must too. The page's Content Security Policy already names that folder in `script-src`.
- **What they share.** An extra takes Lit and the `@hcm/shared` bindings it needs (the messages, the manifest's helpers, the field chunk's event guard) from the engine through one non-enumerable global, `__hcmEngineHost`, under its release's own entry (`__hcmEngineHost.v1_0_0`), and registers its exports there; it never carries its own copy of Lit, the catalogues or zod (the build refuses one that would). Two engine releases on one page keep apart: each uses its own bindings and fetches its own extras. `__hcmEngineHost` is not part of the API.
- **Ready mark.** An extra's last statement marks it ready on its release's entry. The loader uses an extra only once it is marked; one that throws while it runs counts as not loaded, and the next wish fetches it whole again.
- **When one does not arrive** (offline, a 404, a wrong integrity, a script that throws while it runs): the loader removes its script, logs `extra not loaded` and lets the next wish fetch it afresh. Compare closes with the toast *This part of the map could not be loaded. Check your connection and try again.* (`error.extraLoad`, scenarios S-V63-HAPPY-EXTRAS-ON-DEMAND and S-V63-BAD-EXTRAS-CHUNK-FAILS); a gamepad tries again at its next connection; analytics stays off for the page, as when the Firebase SDK cannot load.
- **The ES module build** is unchanged: `engine.mjs` keeps its lazy chunks (`compare-<hash>.js`, `gamepad-<hash>.js`, `firebase-sdk-<hash>.js`, `field-sdk-<hash>.js`), fetched with dynamic imports. `npm run build --workspace @hcm/engine` runs Vite twice into `dist/`: the ES module build, then the IIFE with its extras (`vite build --mode iife`, `scripts/site/src/engine-extras.ts`).

### Releases on jsDelivr

A release is a tag `vX.Y.Z` of this repository ([releases/README.md](releases/README.md)); the root and every workspace `package.json`, `ENGINE_VERSION` and the release's `release.json` carry its version. jsDelivr's GitHub route serves only what a tag holds, so the release commit carries the built engine in `cdn/engine/`: `engine.iife.js` and its extras (`extra-<name>-<hash>.js`), `engine.mjs` and its lazy chunks (`compare-<hash>.js`, `firebase-sdk-<hash>.js`, `field-sdk-<hash>.js`), the side-loaded `engine.extras.js`, `engine.css`, `fonts/` and `THIRD_PARTY_NOTICES.txt`, each exactly as `npm run build --workspace @hcm/engine` makes it but for the source-map line (the maps are attached to the GitHub Release), and `release.json`. Each tag keeps its own folder; the tree holds one release at a time.

| Use | Address | Integrity |
| --- | --- | --- |
| A page that pins the release (the starter kit, and every city that copies it) | `https://cdn.jsdelivr.net/gh/ventura8/historic-city-map-maker@vX.Y.Z/cdn/engine/engine.iife.js` and `engine.css` | yes: the values of that release's `release.json`, also in the GitHub Release body |
| The engine's fonts, chunks and extras | the same folder: the extras and chunks always load from the engine script's folder, the fonts and `engine.extras.js` from `engineBase` (by default that folder) | not needed on the page: the IIFE adds each extra and `engine.extras.js` with the integrity the build wrote into it, and fonts are not scripts |
| A page that follows the 1.x line | `https://cdn.jsdelivr.net/gh/ventura8/historic-city-map-maker@1/cdn/engine/engine.iife.js` | never: the files change under it with every 1.x release |

- **`release.json`** (`engineReleaseSchema` in `packages/shared/src/schemas/engine-release.ts`): `version`; `repository`; `base`, the pinned folder above; `mapboxGl`, the Mapbox GL JS release the engine is written against with the address and integrity of its script and stylesheet on api.mapbox.com; `files`, every file of the folder (never `release.json` itself) with its size in bytes and its `sha384-` integrity. Its address is `<base>release.json`.
- **Pinning a page.** Load Mapbox GL JS's stylesheet and deferred script, then the engine's `engine.css` and deferred `engine.iife.js` from the pinned folder, each with `integrity` and `crossorigin="anonymous"`, and let the page's Content Security Policy name the folder in `script-src`, `style-src` and `font-src`. Pin the IIFE, not `engine.mjs`: the module build fetches its chunks with dynamic imports that carry no integrity, while the IIFE's extras carry theirs.
- **Upgrading a pinned page** changes the folder's version and the two engine integrity values (`npx create-historic-city@<version> upgrade` rewrites them in a kit's `index.html`); Mapbox GL JS's tags change only when a release names another Mapbox GL JS.
- **Where v1.0.0 stands** (2026-10-25): every version of the repository is 1.0.0 and the release notes are written; `cdn/engine/`, the kit's pinned digests and the notes' table of addresses come with the release commit, after the user's answer on the committed engine's EditorConfig exception ([research/DECISIONS-for-review.md](research/DECISIONS-for-review.md) §59c, §63c). Until the tag exists, the starter kit's engine block carries placeholder digests and no page can load the pinned addresses ([research/M5-status.md](research/M5-status.md)).
- **How a release is checked**: every version, `release.json` against the committed files, the starter kit's pins, the notes and a byte-for-byte rebuild of `cdn/engine/` from the tagged sources run before the GitHub Release is made ([CI_PIPELINE.md](CI_PIPELINE.md), stage `release`); preparing one is `.agent/skills/quality/prepare_release_skill.md`.

## Security

- No HTML is rendered from data: Lit templates and `textContent` only; Mapbox popups use `setDOMContent` (`docs/research/design-review-security-cost.md` §1.7). POI descriptions are rendered like About: by walking `parseMarkdown(...).paragraphs` into DOM nodes.
- Only https URLs and the URL-restricted Mapbox public token reach the page; a secret token cannot pass the schema.
- The page's meta CSP and headers: [research/design-review-security-cost.md](research/design-review-security-cost.md) §1.8. Analytics hosts join the CSP only for the consent-gated SDKs.
