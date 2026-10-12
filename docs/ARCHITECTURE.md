# Architecture

**Historic City Map** is a data-driven historical map engine plus a "do-everything" admin; **București dispărut** (Bucharest) is its first city. This document is the concise architecture; the approved plan and its reasoning are in [research/PLAN.md](research/PLAN.md), the security and cost review in [research/design-review-security-cost.md](research/design-review-security-cost.md), the testability review in [research/design-review-testability.md](research/design-review-testability.md), and what M0 actually built in [research/M0-handoff.md](research/M0-handoff.md).

## Overview

```text
            ┌──────────────── this repo (npm workspaces monorepo) ─────────────────┐
 tag vX ───►│ packages/engine → dist/engine.{iife.js,mjs,css} ──► jsDelivr @1 (other cities)
            │ packages/admin  → dist/admin.*  ──► Firebase Hosting <proj>.web.app (own origin)
            │ packages/{shared,ui,test-support}                                       │
            │ sites/bucharest (index.html + config.js; engine same-origin) ──► GitHub Pages
            │ starter-kit/ (template + static-manifest mode, no backend needed)       │
            │ functions/ (Firebase Functions v2, TS, Node 24) ──► us-central1         │
            │ pipeline/ (Python + GDAL container) ──► Cloud Run Jobs                  │
            │ firebase/ (rules, indexes, firebase.json)  infra/ (bootstrap, doctor)   │
            └─────────────────────────────────────────────────────────────────────────┘
 Public viewer ─GET→ gs://<proj>-public/cities/{city}/manifest.json + photo WebP (no Firestore, no Firebase SDK for data)
 Admin ─Auth/Firestore/Storage(private)/callables→ Functions → Secret Manager · USGS M2M · Mapbox APIs · Cloud Run Admin (REST)
 jobs doc ─trigger→ Cloud Run Job (GDAL) → GCS COG/preview → [admin approves + CU guard] → Mapbox MTS → layer published → manifest rebuilt
```

| Workspace | Package | Status |
| --- | --- | --- |
| `packages/shared` | `@hcm/shared`: zod schemas (City Manifest v1 with POIs, embed config, Firestore documents with history entries), validation with localized codes, geo helpers and POI geometries, the overlay model and its Mapbox paint mapping, the URL-hash codec, the Markdown subset, the legacy migration, i18n catalogues, logging with redaction | M1 contracts done (with PLAN Addendum 3) |
| `packages/ui` | `@hcm/ui`: Lit 3 Material 3 Expressive kit (19 elements), theme and dynamic colour (`themeFromSeed`, `applyTheme`), window classes, self-hosted fonts, and the viewer's elements (`packages/ui/src/viewer/`) | M1 done |
| `packages/engine` | `@hcm/engine`: the public viewer, global `window.HistoricCityMap`: configuration, the viewer store, the MapPort and its Mapbox adapter, consent-gated telemetry, `mount` and the auto-boot | M1 done (boots the built Bucharest site in the e2e smoke) |
| `packages/admin` | `@hcm/admin`: Setup Assistant and daily flows | scaffold |
| `packages/test-support` | `@hcm/test-support`: `FakeMap` and a fake `mapboxgl` (`@hcm/test-support/fake-map`), axe (`@hcm/test-support/axe`), recording log sinks; msw handlers later (test-only) | M1 |
| `functions/` | `@hcm/functions`: thin v2 triggers over pure handlers and ports | scaffold (`setup-status`); deploys from M2 |
| `firebase/rules-tests/` | `@hcm/rules-tests`: allow and deny matrix under the emulators | running |
| `e2e/` | `@hcm/e2e` (Playwright 1.64): `e2e/scenarios.json`, the mock APIs (`e2e/mock-apis/`), the fixture manifest, the firewall, console and placeholder guards, the tiers of `e2e/projects.ts` | harness and viewer smoke running; functional, tour, a11y and no-WebGL specs planned |
| `pipeline/` | `pipeline/src/hcm_pipeline` (Python + GDAL, Poetry) | scaffold; steps in M3 |

Layering (enforced by dependency-cruiser): `shared` below `ui` below `engine` and `admin`; engine and admin are independent; `shared` imports no DOM, Lit or Mapbox; only `packages/engine/src/map/mapbox-adapter.ts` touches Mapbox GL, and it reads the page's global `mapboxgl` through a structural type instead of importing `mapbox-gl`. Because `ui` cannot import the engine, the viewer elements in `packages/ui/src/viewer/` drive the engine's store through a mirrored port (`store-port.ts`).

## Why this shape

- **Server-side calls are required**: USGS M2M allows no CORS outside `*.usgs.gov`, and secrets must stay on the server.
- **Cloud Run, not GitHub Actions, for GDAL work**: Actions logs are public and would leak signed USGS URLs; no GitHub token or service-account key is needed anywhere.
- **The public site never reads Firestore**: no read quota, no abuse surface, no Firebase SDK for data.
- **The admin has its own origin** (`<proj>.web.app`), because `ventura8.github.io` is shared by every Pages site of the account.
- **Region**: Firestore `nam5`, everything else `us-central1`, where the free tiers apply and triggers stay in-region.

## Engine (public viewer)

The public contract (config.js, `<hcm-map-viewer>`, the JavaScript API, the URL hash, the City Manifest v1, versioning) is [ENGINE_API.md](ENGINE_API.md); the M1 module interfaces and ownership are in [research/M1-interfaces.md](research/M1-interfaces.md).

- A city page ships `index.html` and `config.js` (`window.HistoricCityMapConfig = {cityId?, manifestUrl? | manifest?, container?, lang?, engineBase?}`; the inline manifest is the starter kit's static mode). The engine fetches only the static manifest and photo WebP files from the public bucket.
- Mapbox GL JS **3.32.0** is loaded from `api.mapbox.com` as the global `mapboxgl` and never bundled; Standard Satellite basemap; historical rasters in the `middle` slot; `performanceMetricsCollection: false`; the Mapbox logo and attribution are always visible.
- The core (state, URL hash, timeline, controller) talks only to a `MapPort`; the Mapbox adapter is the only Mapbox-aware module. **One map per view**: swipe compare creates its second map lazily and destroys it.
- Features: timeline (a city without historical layers shows a "coming soon" note instead), photos as clustered camera icons rotated by bearing with view cones, bottom or side sheet, lightbox, URL state and share, geolocate, About and credits, RO/EN, light/dark/seeded theme.
- The engine build ships next to its script everything it loads at run time: the lazy Firebase chunk (ES module build) and the kit's self-hosted fonts (`dist/fonts/`). The page's CSP refuses inline styles, so elements set styles only through the CSSOM.
- **Overlays** (PLAN Addendum 3): every historical layer, the photos and every POI category is an overlay with a switch and a live opacity slider; opacities persist in the URL hash (`&op=`). The pure overlay model and the paint-property mapping (`raster-opacity`; icon, text, circle, line and fill opacity for vector overlays) live in `@hcm/shared`, so the admin's default-opacity editor uses the same code. Raster image adjustments (brightness range, contrast, saturation) are applied live as Mapbox paint properties, without reprocessing.
- **Points of interest**: city-defined categories (label, Material Symbols icon, colour, default opacity); POIs as icons, lines or fills with labels at high zoom, filtered by the timeline, details in the same sheet as photos.

## Admin

- **Setup Assistant** (first screen until green): Google Cloud billing (Blaze) and budget, Provision cloud, Mapbox (secret token pasted once, public tokens auto-minted with URL restrictions), USGS (ERS, M2M approval auto-detected), Analytics and crash reporting. Every human step happens inside the app through verified deep links.
- **Daily flows**: photos (EXIF and filename prefill, bearing by clicking what the camera looked at, published on save), satellite layers (find, import free, buy scan, upload GeoTIFF, link tileset), georeferencer (OSM and Sentinel-2 reference, never Mapbox Satellite), jobs, settings (bounds, About, seed colour), admins.
- User guide: [ADMIN_GUIDE.ro.md](ADMIN_GUIDE.ro.md), [ADMIN_GUIDE.en.md](ADMIN_GUIDE.en.md).

## UI

Lit 3 custom elements with the `hcm-` prefix and no decorators; Expressive components from `@m3e/web` and stable `@material/web` form controls behind our own wrappers; colour tokens generated from the city seed with `@material/material-color-utilities` (light, dark, high contrast); window classes measured on the host element (compact below 600, medium, expanded, large, extra-large from 1600, compact height below 480); 48 dp touch targets; self-hosted Roboto Flex and Material Symbols; reduced motion honoured.

## Data

Firestore (zod schemas in `@hcm/shared` are reused by every writer):

- `cities/{city}`: names and About (`{ro, en}`), centre, zoom, bounds, credits, theme seed and tokens, basemap, Mapbox user and public token (automatic), the photos overlay's default opacity, published flag.
- `cities/{city}/layers/{id}`: year and date, label, kind, sensor, attribution, source (`mapbox`, `xyz`, `pmtiles`, zoom range, bounds), order, opacity, image adjustments, status, provenance (USGS ids, georeferencing method, GCPs, checkpoint RMSE), Mapbox tileset id.
- `cities/{city}/photos/{id}`: title and description (`{ro, en}`), year range, author, licence (enum), rights holder, structured `links`, location, bearing, FOV, image (web, thumb, sha256, size), processing state, published flag, rights review, legacy id.
- `cities/{city}/poiCategories/{id}` (label, icon, colour, default opacity, order) and `cities/{city}/pois/{id}` (category, geometry without nested arrays, title and description, year span, links, photo ids, published flag); the manifest carries them as `poiCategories[]` and `pois[]` with GeoJSON geometries.
- Every admin-editable document (city, layer, photo, POI, POI category) carries `updatedBy` and `updatedAt` and keeps a `history` subcollection with the previous version of each change, written by a server trigger, for one-click revert.
- Also `usgsScenes/{entityId}`, `jobs/{id}` with logs, `admins/{uid}`, `setup/status` (non-secret health), `usage/mapbox-YYYY-MM`, `ops/guard`.

The Bucharest seed manifest (`seed/bucharest/manifest.static.json`, with WebP derivatives in `seed/bucharest/derived/`) is produced from the legacy data by `scripts/seed/migrate-legacy.mjs` (`npm run seed:migrate`), whose rules are pure functions in `packages/shared/src/migration/`.

Storage: a **private** bucket (`<proj>.firebasestorage.app`: uploads, rasters, USGS raw files, browse copies) and a **public** bucket (`<proj>-public`: manifest, `web.webp`, `thumb.webp` only, content-hashed and immutable). Legacy HTML is migrated to structured `links`; **no HTML is ever rendered from data**.

## Cloud Functions

Pure handlers with injected ports, thin triggers, REST adapters (Cloud Run Admin v2, Secret Manager) so tests can mock them; secrets read at runtime with a cache (no redeploy after a paste). Families: `setup.*`, `usgs.*`, `jobs.onCreate`, `ops.tick` (every 15 min), `ops.onBudget`, `photos.onUpload`, `publish.*` (debounced manifest builder), `admins.invite`, `telemetry.reportError`, `assist.*` (M4).

## Raster pipeline

Python with `osgeo.gdal` from the pinned GDAL image (Python 3.14), Poetry, as a Cloud Run Job (standard 4 CPU / 16 GB, `-xl` 8 CPU / 32 GB). Steps: fetch (M2M, resumable), locate and crop, georeference (corners plus admin GCPs; automatic suggestions in M4), warp to EPSG:3857, export (COG, preview, DZI, Studio-sized GeoTIFF), publish to Mapbox MTS only after approval and within the compute-unit guard. The job exits while waiting on USGS or MTS; `ops.tick` resumes it.

## Security

- **Rules**: default deny; admin = custom claim **and** `admins/{uid}` document; strict field validation; size and type limits; no SVG. The Admin SDK bypasses rules, so every server writer validates with zod.
- **App Check** (reCAPTCHA Enterprise) on the admin, Firestore and callables; none needed on the public viewer.
- **CSP**: strict headers on Hosting, a meta CSP on Pages; ESLint bans every HTML sink.
- **Identities**: least-privilege service accounts (`fn-admin`, `fn-events`, `job-raster`) and `gh-deployer` through Workload Identity Federation (no keys). The owner admin is granted by a bootstrap script; no email in the repository.
- **Secrets**: Mapbox and USGS secrets only in Secret Manager; `SONAR_TOKEN` is the only repository secret; the Firebase web config is never committed (the admin reads `/__/firebase/init.json` on Hosting).

## Cost guards

- GCP: a $5 budget whose alarm pauses the raster pipeline and MTS, never the site; per-function `maxInstances`.
- Mapbox: one map per view; usage alerts; MTS only after approval and within the compute-unit guard, with the free Studio upload path; at most 24 tilesets without approval; tests never hit Mapbox.
- Expected: about $0.5–2 per month on GCP; Mapbox $0 within 50,000 map loads.

## Analytics and crashes

- GA4 (the Firebase JS SDK's analytics module) and Performance Monitoring in the viewer and the admin, **loaded only after consent** (an M3 consent banner, Consent Mode v2 defaults denied). The viewer lazy-loads them only when the manifest has a `measurementId` and the visitor consented; it still never reads Firestore.
- Events without PII: `page_view`, `layer_toggle`, `year_change`, `photo_open`, `poi_open`, `share`, `compare_open`, and admin flow events.
- Crashes: global error handlers and error boundaries; GA4 `exception` events after consent; `telemetry.reportError` writes redacted structured logs that Cloud Error Reporting groups and alerts on; source maps are release artifacts; the Setup Assistant shows the latest error groups.

## Quality system

Every gate runs inside one pinned Docker image through `scripts/ci/run-all-checks.sh`; per-file coverage of 90 % or more for every language; no inline suppressions; SonarQube Cloud; a scenario registry with a happy and a bad row per behaviour. Details: [CI_PIPELINE.md](CI_PIPELINE.md), [TESTING.md](TESTING.md).
