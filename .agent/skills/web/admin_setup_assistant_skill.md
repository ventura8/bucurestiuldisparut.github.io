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
| **USGS** | ERS registration; M2M access request (pre-written justification); application token (the paste box opens first, a 60 s countdown is shown); `setup.saveUsgs` verifies with `login-token` and `permissions`; while the role is pending it re-checks every 6 h and turns green on approval. |
| **Analytics and crash reporting** | Deep link to enable Google Analytics on the project (the admin accepts the GA terms); the `measurementId` is detected through the Firebase Management API and written to the city doc and the manifest; a "Crash reports" panel lists the latest Error Reporting groups. |

`setup/status` (Firestore) is the single non-secret source of truth shared by the bootstrap and the app; secrets go only to Secret Manager through the `setup.*` callables (`firebase/functions_skill.md`).

## Daily flows

- **Photos**: drag-and-drop batch; EXIF and filename fill location, year and bearing (EXIF date ignored when later than the filename year); the last pin as fallback; sticky author, source and licence; "click what the camera looked at" sets the bearing, FOV 60° by default; published on save; a rights-review queue for legacy photos.
- **Satellite layers**: "Find imagery" ranks USGS scenes with footprints and browse previews; "Import (free)" for scanned frames; "Buy scan" prepares the EarthExplorer order (Claude never pays); "Upload GeoTIFF"; "Link tileset/XYZ".
- **Georeferencer**: raw crop (OpenSeadragon) against the OSM / Sentinel-2 reference, residual table, transform choice, live overlay, snap to OSM intersections. **Never** Mapbox Satellite as a reference.
- **Jobs** (live progress, retry, cancel), **Settings** (bounds, About RO/EN, credits, seed colour with live M3 preview, basemap), **Admins** (invite by email link, revoke; the owner cannot be revoked; the last admin is protected).

## Implementation rules

- The Setup Assistant is a **pure state machine** (`packages/admin/src/setup/`, M2) driven by ports; unit tests cover every transition, e2e rows A03–A07 and A22 cover it from outside with the mock APIs.
- The admin-input budget fixture counts fills, clicks and file inputs per flow; a flow that needs more input than its budget is a regression.
- Every API error shape becomes an actionable, localized message (missing scopes listed by name, HTML 403 from USGS means a bad token, 503 means maintenance).
- Deep links live in `packages/admin/src/setup/links.json` (verified ones only, `{name}` placeholders with a `sample`) and are verified weekly by `.github/workflows/contract.yml` (`scripts/ci/check_contracts.py`, which also probes the USGS M2M, Mapbox CDN and Earth Search shapes); a broken link is a bug.
- App Check (reCAPTCHA Enterprise) on Firestore and callables; sensitive callables consume the token (`web/web_security_skill.md`).
