# Admin and Setup Assistant Skill

The "do-everything" admin `@hcm/admin` (`packages/admin`): it takes a city owner through Google Cloud, Mapbox and USGS with **minimum input**, then runs the daily flows (photos, satellite layers, georeferencing, jobs, settings, admins). It is served from Firebase Hosting on its own origin (`<proj>.web.app`). Today the package holds the M0 scaffold; the admin arrives in M2. User-facing guide: `docs/ADMIN_GUIDE.ro.md`, `docs/ADMIN_GUIDE.en.md`. What only the human does: `workflow/human_steps_and_consent_skill.md`.

## Setup Assistant (first screen until green, re-checkable any time)

Every human step happens **inside the app** (user direction, `docs/research/PLAN.md` → *Addendum*). One Setup page with a progress ring and one card per area. Each step shows:

- a status chip detected automatically;
- why the step is needed and what it costs;
- an "Open page" deep link (new tab) to the exact console page;
- "Do it for me" where a server or Claude action exists;
- a paste box with live verification (for secrets: `type=password`, `autocomplete=off`, never kept in state or storage, cleared after the call);
- automatic advance once the step is detected.

| Card | Steps (detection) |
| --- | --- |
| **Google Cloud billing (Blaze) and budget** | Google sign-in with extra OAuth scopes; list billing accounts (`cloudbilling.googleapis.com`); deep link to create one when none exists (the card is entered on Google's page), poll until it appears; one click links it (Blaze) and creates the $5 budget (`billingbudgets.googleapis.com`). |
| **Provision cloud** | One click runs an idempotent provisioner with the admin's OAuth token: APIs, service accounts and IAM bindings, buckets with CORS and lifecycle, the Workload Identity Federation pool for CI, Secret Manager secrets. A re-checkable "doctor" shows per-item status. |
| **Mapbox** | Exit the demo plan (card and address, on Mapbox's page); usage alerts; create the secret token with the listed scopes; paste it once → `setup.saveMapbox` validates it, derives the username, checks scopes, mints a scoped tiles token and **auto-mints URL-restricted public tokens** for the viewer and the admin. Input budget: at most 2 (paste, save). |
| **USGS** | ERS registration; M2M access request (pre-written justification); application token (the paste box opens first, a 60 s countdown is shown); `setup.saveUsgs` verifies with `login-token` and `permissions`; while the role is pending (no download permission, or a login refused with `AUTH_UNAUTHORIZED`) the card shows `apiError.usgs.accessPending`, `ops.tick` re-checks every 6 h and the card turns green on approval. A paste during USGS maintenance or an outage is kept and shown `unavailable`, checked again 6 h later. |
| **Analytics and crash reporting** | Deep link to enable Google Analytics on the project (the admin accepts the GA terms); the `measurementId` is detected through the Firebase Management API and written to the city doc and the manifest; a "Crash reports" panel lists the latest Error Reporting groups. |

`setup/status` (Firestore) is the single non-secret source of truth shared by the bootstrap and the app, one record per card (`SETUP_AREAS`: billing, provision, mapbox, usgs, analytics, crash; states `missing`, `pending`, `ok`, `invalid`, `unavailable`, the reason an error code); secrets go only to Secret Manager through the `setup.*` callables (`firebase/functions_skill.md`). The callables behind the cards (`docs/research/M2-interfaces.md` §3.3; schemas in `packages/shared/src/api/setup.ts`): `setup.status` (the whole screen; ready once billing, provision, Mapbox and USGS are `ok`), `setup.selfTest` (Re-check), `setup.recordCloud` (what the browser-side billing check and the Provision cloud doctor found), `setup.saveMapbox`, `setup.saveUsgs` (with the token's optional expiry), `setup.rotatePublicToken`, `setup.analyticsConfig`, and `telemetry.listGroups` for the crash panel.

## Who is an admin

- After Google sign-in the app asks `admin.session`: an admin opens the dashboard (`refreshToken: true` means refresh the ID token once first); a map without an owner offers "I own this Google Cloud project", which asks Google for the read-only Cloud scope in a popup and sends that access token to `admin.claim` (the server proves ownership with Resource Manager `testIamPermissions` and the caller's own token, so no address is ever configured); a pending invitation offers "Join" (`admin.join`); anyone else is told and signed out.
- `admins.invite` stores only the SHA-256 of the lowercase address and answers the admin link the inviter shares; `admins.revoke` never removes the owner or oneself.
- Every callable failure arrives as an error code: show `translateApiError(locale, code, params)` (`apiErrorFromFailure` reads it from the SDK's error) and, for `apiError.invalidRequest`, each issue at its field. Pasted secrets are checked in the page first where possible (`classifyMapboxToken` explains a `pk.` before any call).

## Daily flows

- **Photos**: drag-and-drop batch; EXIF and filename fill location, year and bearing (EXIF date ignored when later than the filename year); the last pin as fallback; sticky author, source and licence; "click what the camera looked at" sets the bearing, FOV 60° by default; published on save; a rights-review queue for legacy photos.
- **Satellite layers**: "Find imagery" ranks USGS scenes with footprints and browse previews; "Import (free)" for scanned frames; "Buy scan" prepares the EarthExplorer order (Claude never pays); "Upload GeoTIFF"; "Link tileset/XYZ".
- **Georeferencer**: raw crop (OpenSeadragon) against the OSM / Sentinel-2 reference, residual table, transform choice, live overlay, snap to OSM intersections. **Never** Mapbox Satellite as a reference.
- **Jobs** (live progress, retry, cancel), **Settings** (bounds, About RO/EN, credits, seed colour with live M3 preview, basemap), **Admins** (invite by email link, revoke; the owner cannot be revoked; the last admin is protected).
- **Edit anything** (PLAN Addendum 3, M2): photos (texts, years, author, licence, links, location by drag, bearing and FOV by handle, replace the image, publish, delete); layers (texts, attribution, order by drag, default visibility and opacity, live image adjustments through `rasterAdjustmentPaint`, re-georeference, crop, replace, delete); **POIs** drawn and edited on the map behind a `MapDrawPort` (a GL v3 draw library, verified first), bulk GeoJSON import and export, written with `geometryToDoc`; POI categories in Settings (label RO/EN, icon from `POI_ICONS`, colour, default opacity). The default opacity of every overlay is set with the ui-kit's `hcm-overlay-list`, previewed live on the admin map. Every save stamps `updatedBy`/`updatedAt`; a server trigger keeps the previous version in `history` for one-click revert. Contracts: `docs/research/M1-interfaces.md` §3 and §11.

## Implementation rules

- The Setup Assistant is a **pure state machine** (`packages/admin/src/setup/`, M2) driven by ports; unit tests cover every transition, e2e rows A03–A07 and A22 cover it from outside with the mock APIs.
- The admin-input budget fixture counts fills, clicks and file inputs per flow; a flow that needs more input than its budget is a regression.
- Every API error shape becomes an actionable, localized message (missing scopes listed by name, HTML 403 from USGS means a bad token, 503 means maintenance, a demo or trial Mapbox account answers `apiError.mapbox.mintRefused`, a disabled Google API `apiError.cloud.apiDisabled` with its name). A failed save records its reason on the card unless the card already holds a working or pending configuration, which a failed attempt never overwrites.
- Before every write the admin validates with the shared zod schemas: the rules let an optional text that is blank but not empty through, the server's read refuses it (CR-M2-28 in `docs/research/M2-interfaces.md`). Its lists use the composite indexes of `firebase/firestore.indexes.json`; a history is listed by `updatedAt` descending.
- Deep links live in `packages/admin/src/setup/links.json` (verified ones only, `{name}` placeholders with a `sample`) and are verified weekly by `.github/workflows/contract.yml` (`scripts/ci/check_contracts.py`, which also probes the USGS M2M, Mapbox CDN and Earth Search shapes); a broken link is a bug.
- App Check (reCAPTCHA Enterprise) on Firestore and callables; sensitive callables consume the token (`web/web_security_skill.md`).
