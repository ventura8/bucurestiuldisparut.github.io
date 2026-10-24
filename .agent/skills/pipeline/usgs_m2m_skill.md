# USGS M2M Skill

Facts about the USGS Machine-to-Machine (M2M) API and EarthExplorer that the functions, the pipeline and the Setup Assistant depend on. Sources: `docs/research/design-review-onboarding.md` §2C, `docs/research/design-review-security-cost.md` §4.2.

## Access (human steps first)

1. ERS registration (`https://ers.cr.usgs.gov/register`) — the user.
2. M2M access request (ERS profile → Access Request) with the pre-written justification: datasets `corona2`, `declassii`, `declassiii`; the city bbox; non-commercial; a few scenes per month. USGS approves in 24–48 business hours.
3. Application token (`https://ers.cr.usgs.gov/password/appgenerate`), name `historic-map-<city>`, scope "M2M API". It is shown for about 60 s: the paste box opens **before** the user generates it. Whether the M2M scope can be ticked before approval is unverified; if it is missing, the wizard asks the admin to come back after the approval email.
4. The admin pastes username and token into the Setup Assistant; `setup.saveUsgs` stores them in Secret Manager (`usgs-username`, `usgs-app-token`).

## API behaviour

- `login-token` returns an API key; re-login before 2 hours (the pipeline re-logs at 100 minutes).
- `permissions` lists the roles; without the download role the card shows "Awaiting approval" and re-checks every 6 hours. Search (`dataset-search`, `scene-search`) works before approval, so the harvest can start.
- **Errors arrive with any HTTP status**: parse JSON on every response. HTTP 500 with a JSON `errorCode` is an API error; an **HTML 403** means an invalid or expired token; a **503 HTML page** means maintenance (monthly, often Wednesdays) and is retried with backoff, never shown as a failure.
- How the functions' adapter (`functions/src/adapters/usgs.ts`) reads a failure (CR-M2-20): a non-JSON 403 → `unauthorized` (bad token), a non-JSON 503 → `maintenance`, `AUTH_INVALID` and `AUTH_KEY_INVALID` → `unauthorized`, `AUTH_UNAUTHORIZED` (M2M spells it `AUTH_UNAUTHROIZED` too; the account has no M2M access) → `forbidden`, `RATE_LIMIT*` → `rateLimited`, any other `errorCode` → `invalid`, other statuses as usual. `setup.saveUsgs` and `ops.tick` turn `forbidden`, and a `permissions` list without `download`, into `pending` with `apiError.usgs.accessPending` (checked again 6 h later); a paste during maintenance or an outage is kept as `unavailable` and checked again 6 h later; `logout` always runs after a successful login.
- M2M has **no CORS** outside `*.usgs.gov`, so every call is server-side (functions, pipeline); the browser never talks to USGS.
- Downloads: `download-options` → `download-request` → `download-retrieve`; signed URLs are secrets in practice (redacted in every log; never in public CI logs).

## Imagery

- Harvest when the Imagery area opens and the city's newest scene is over 30 days old, and monthly (`imagery.search`, `imagery.tick`): `scene-search` over the city bbox × `corona2` / `declassii` / `declassiii`; browse JPEGs are copied server-side to our private bucket (`imagery.browse`), never fetched by the browser (`docs/research/M3-interfaces.md` §3).
- Every harvest attempt is recorded in `ops/harvest-{city}` and the tick's monthly harvest is keyed on its `nextAt` (a month after an answer, `HARVEST_RETRY_HOURS` after a failure, doubled): a harvest that writes no scene never repeats every tick (`docs/LESSONS.md` 166, 175). A search no dataset answered is `apiError.usgs.unavailable` (or `maintenance`), never "nothing over the area"; a tick harvest USGS refuses for the credentials or the access marks `setup/status.usgs`, which stops the tick until Setup. A USGS record `unavailable` with its role kept (the daily check met maintenance) still searches and imports, and the admin's Imagery area reads it as its role allows.
- Ranking (0–100, `RANKING_WEIGHTS` of `@hcm/shared`): free (already scanned) 30, coverage of the city 25, the city's target years 15, the gap to existing layers 10, clouds 10, resolution 10, each explained to the admin in plain words; the reasons that explain a low rank come first (a card shows three), a city without layers says so (`noLayers`), counts take their plural form. An Import USGS answers "not scanned" marks the scene not free and ranks it again. Target years for Bucharest: 1966 (1966-07-12 KH-4A), 1976 (1976-02-20), 1977 (1977-09-13), 1978 (1978-03-30 KH-9 mapping), 1980 (1980-07-16 KH-9).
- Labels: acquisition date plus camera ("KH-4A Corona, 1966-07-12"); attribution "USGS EROS, declassified (public domain)".

## Buying a scan (human pays)

- EarthExplorer deep link per scene: `https://earthexplorer.usgs.gov/scene/metadata/full/{datasetId}/{entityId}/`; Item Basket → On-Demand → Start Order; recommended 7 µm; $30 per frame plus $5 per order. **Claude never pays.**
- Clicking "Buy" records the order intent; a daily `download-options` check per watched scene auto-creates the import job when the scene becomes available and notifies the admin. Reminders on days 7 and 12 (USGS deletes unpaid orders after two weeks).

## Tests

- TypeScript adapters: the fake USGS M2M of `@hcm/test-support/fakes` and its fixtures (`usgs/login-token.*`: 500 JSON `errorCode`, HTML 403, 503 maintenance page, `RATE_LIMIT`, `AUTH_UNAUTHROIZED` for `USGS_CREDENTIALS.noAccess`; `usgs.m2mApproved` approves the pending account).
- Python client (`hcm_pipeline.m2m.M2MClient`): parses the body on any status and raises `AuthError` (`AUTH_*` or a non-JSON 403), `MaintenanceError` (non-JSON 503), `RateLimitError` (429 or `RATE_LIMIT*`, `retry_after` from Retry-After seconds or date), `ProtocolError`, `UnreachableError` or `M2MError`; logs in again after 100 minutes (injected clock) and once on a rejected key; `logout` is best effort; the key travels only in `X-Auth-Token`.
- Python: the fake M2M server (`pipeline/tests/fakes/usgs_m2m.py`: `127.0.0.1:0`, scenario state, `/__reset`, scripted replies, `expire_keys()`) covers login, any endpoint with a key, the 403 page, the 503 maintenance page and 429; M3 adds download request and retrieve, corrupt payload and checksum mismatch.
- Test tokens encode the scenario: `e2e-ok`, `e2e-m2m-pending`, `e2e-bad`.
