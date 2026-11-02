# M7 contract: "Run on my computer" (the local worker) and the cheap cloud defaults

Written on 2026-11-02 from the user's decisions of 2026-11-01 ("make this as free as possible"), before any code. The
decisions log entry is `DECISIONS-for-review.md` §83. Read it with `M3-interfaces.md` (§2.3–§2.7 the job model and paths,
§4 the dispatcher, the lease and the tick, §5 the pipeline and its ports, §7 publishing and the compute-unit guard),
`M6-interfaces.md` (§1.4.2 the pipeline install, §1.9 the free tier) and its addenda of 2026-11-01 (the three Cloud Run
jobs since `DECISIONS-for-review.md` §82f).

The user's words, which every section serves:

- **A. Local worker.** Each imagery job can run on the admin's own computer instead of Cloud Run: the same pinned
  pipeline image in a `worker` mode, signed in through a local page with the owner's Google account, talking to the
  server through new admin-only callables and short-lived signed URLs; raw scans never leave the computer.
- **B. Cheap cloud defaults.** (1) Show this month's Cloud Run free-tier use and ask before a cloud run would cross it;
  (2) delete the raw USGS delivery once the city crop exists; (3) publish through Mapbox's Uploads API when the file fits
  its free allowance, MTS (behind the compute-unit guard) otherwise.

Nothing here calls a real Google, Mapbox or USGS endpoint, deploys or pushes. What only a real project can prove is
marked **UNVERIFIED**, each with how the first real run proves it (§11).

## 0. What this contract decides

1. **Where a job runs** is a job field, `runOn: 'local' | 'cloud'`, decided by the dispatcher the first time it sees the
   job queued (§3): the job's own choice, else the city's remembered choice (`auto` by default), and `auto` means
   `local` when one of the city's workers was seen within `WORKER_FRESH_SECONDS` (180 s), else `cloud`. A `local` job is
   never sent to Cloud Run: it waits (`waitReason: 'worker'`) until a worker claims it. The admin changes a job's place
   (and with it the city's choice) with `imagery.runOn` while the job holds no run.
2. **The worker** is `python -m hcm_pipeline worker` in the same pipeline image (§1). It holds the owner's Firebase ID
   token and refresh token in memory only, polls `worker.claim`, and runs the claimed job's steps **unchanged**: only
   the two ports the steps use are swapped, `DocumentStore` for the `worker.step` API and `ObjectStore` for a routing
   store (the delivery and the scratch stay on the computer; the version's files go through signed URLs). The M2M calls
   the `fetch` step makes go through `worker.urls` (`kind: 'usgs'`), which the server makes with its own USGS key.
3. **Five admin-only callables** (`worker.hello`, `worker.claim`, `worker.step`, `worker.urls`, `worker.end`; access
   `cityEditor`, App Check `off`: §2.4 says why) and one more for the admin, `imagery.runOn` (App Check enforced).
4. **Cloud Run's free tier** (§4): every cloud run is counted, when it ends, into `usage/cloudrun-YYYY-MM` (seconds from
   its dispatch to its end × the machine's vCPUs and GiB); a cloud job whose estimate would cross the free tier waits
   (`waitReason: 'free-tier'`) until the admin says OK; one made by automation also leaves an inbox item
   (`job.needsOk`).
5. **The raw USGS delivery** is deleted by `locate` once the city crop (`scan.tif`) and the version's `scan` are recorded
   (§5); the bucket's lifecycle for `usgs-raw/` drops from 30 to 7 days as the backstop.
6. **Mapbox's Uploads API** publishes a version whose `studio.tif` is at most `UPLOADS_FREE_MAX_BYTES` (300 MB) while
   the month's Uploads API megabytes stay within `MAPBOX_FREE_UPLOAD_MB` (10,000) and the layer's tileset is not an MTS
   one (§6). Otherwise MTS behind the compute-unit guard, as today. The version records `mapbox.via`.
7. **The admin** (§7): one new lazy chunk, `worker` (the worker's panel, the run choice, the free-tier meter and the OK),
   loaded by the Jobs page, the pipeline card and the version page; its words in a catalogue of their own
   (`packages/shared/src/i18n/admin-worker/`) so the entry does not grow.

## 1. The worker

### 1.1 The command

```text
docker run --rm -p 127.0.0.1:8765:8765 -v "$HOME/hcm-worker:/work" \
  us-central1-docker.pkg.dev/<project>/hcm/pipeline@sha256:<digest> worker --city <city> --project <project>
```

- The admin shows it ready to copy (§7), with the digest of the image the pipeline install pushed (the build log's
  `image` event, recorded by `setup.recordInstall` as `setup/status.install.pipeline.image`). Without a recorded digest
  the panel says to update the imagery pipeline first.
- **Pulling the image** (least friction, the owner needs nothing beyond Docker): Provision's repository policy of
  Artifact Registry `hcm` adds `allUsers` → `roles/artifactregistry.reader` (the repository holds only the pipeline
  image: the open-source pipeline, no secret, no configuration). Cost: a pull is internet egress billed to the owner
  (about 0.6 GB at list price, cents); anyone who learns the project id could pull it too (§10.5). Where an
  organisation policy forbids `allUsers` (domain-restricted sharing), Provision records the refusal and goes on, and the
  panel's note gives the alternative: `gcloud auth configure-docker us-central1-docker.pkg.dev` once, then the same
  command.
- `-p 127.0.0.1:8765:8765` publishes the local page on the computer's loopback only; inside the container the server
  binds `0.0.0.0:8765` (Docker's port publishing needs it), so nothing outside the computer reaches it.
- `/work` is the work folder: the delivery, the scratch and the reference cache (§1.3). The container runs as the image's
  user `10001`; the folder must be writable by it (Docker Desktop maps it; on Linux `mkdir -m 777` once, the panel's
  note says so).
- `worker --city <id> --project <id>` (`WorkerArgs`): the project gives the Hosting origin
  (`https://<project>.web.app`), the callables' origin (`https://us-central1-<project>.cloudfunctions.net`) and the
  bucket names; nothing else is configured. Under the emulators (`--emulators`, loopback addresses from the same
  variables the e2e pipeline tier uses) the same code talks to the Auth, Functions and Storage emulators.

### 1.2 The loop

1. Serve the local page (§2) and wait for a session.
2. `worker.hello {cityId, workerId, version}` once (`workerId`: `w-` and 16 hex characters, new per process), which
   records `cities/{city}/workers/{workerId}` and answers the poll interval.
3. Every `WORKER_POLL_SECONDS` (30) while idle: `worker.claim {cityId, workerId}` (which also refreshes the worker's
   `lastSeenAt`). A claimed job runs at once; one job at a time.
4. A claimed job runs as `run` does on Cloud Run (`runner.py`: the lease is taken by the owner
   `worker:<workerId>`, which the claim already wrote, so the run proceeds; the heartbeat, the step loop, the waits, the
   failures, the cancel), with every step of the job's type (a worker job names no machine, `DECISIONS-for-review.md`
   §82f).
5. `worker.end {cityId, workerId, jobId, outcome}` after the run: `done` whatever state the run left the job in, or
   `failed` with the error when the run crashed outside a step (the server fails the job if the worker still holds it).
6. Ctrl-C or SIGTERM: the running step stops at its next checkpoint and the job goes back to `queued` (the runner's
   SIGTERM path, unchanged); the process exits 0.

### 1.3 The ports in worker mode (`hcm_pipeline/worker/`)

| Port | Cloud Run | Worker |
| --- | --- | --- |
| `DocumentStore` | Firestore | `ApiDocumentStore`: `get`, `update`, `create`, `list_ids` as `worker.step` operations; `transact` = `get` with its update time, then `update` with `ifUpdateTime` (the same compare-and-set the Firestore adapter does, five tries) |
| `ObjectStore` | GCS JSON API | `RoutedObjectStore`: `usgs-raw/`, `work/` and `reference/` → `LocalObjectStore` under `/work` (resumable sessions are local files); `rasters/` and `uploads/` → `SignedObjectStore` (stat from `worker.urls`' metadata, GET and PUT on the signed URLs; list, delete and resumable sessions refused: no step needs them there) |
| `m2m` | `M2MClient` with the USGS secrets | `ProxyM2MSession`: each `request(endpoint, payload)` is `worker.urls {kind: 'usgs', endpoint, payload}`; login and logout are the server's |
| `secrets` | Secret Manager | `NoSecrets` (asking for one is a bug: it raises) |
| `downloads`, `stac`, `overpass` | httpx behind the address guard | the same |

`raw scans never leave the worker`: the delivery (`usgs-raw/`), the segments and the frame (`work/`) are local files;
only the version's files (`scan.tif` the city crop, its preview, the two reference images, `cog.tif`, `preview.png`,
`studio.tif`) are uploaded, each to its signed URL.

## 2. Sign-in and the local page

### 2.1 The page

- `GET http://localhost:8765/` (the panel's link says `localhost`, which Firebase Auth authorizes by default;
  `127.0.0.1` is not, **UNVERIFIED** per project): a small page served by the worker (`worker/page.py`, no template
  engine; the only dynamic values are the project id, the city id and the CSRF token, each checked against its pattern
  before it is written into the page and the page's inline JSON) that loads the Firebase JS SDK 13.1.0 from
  `www.gstatic.com/firebasejs/13.1.0/` (the admin's version, a test keeps them equal) and the project's web config from
  `https://<project>.web.app/__/firebase/init.json` at run time (never committed, never stored).
- **Sign in with Google** (`signInWithPopup`), then the page posts `{idToken, refreshToken}` to `POST /session` with
  the page's CSRF token in `X-HCM-Worker` and shows the worker's state (signed in as, the city, idle or the job and its
  step, the last error). **Sign out** posts `DELETE /session`: the worker forgets the tokens and stops claiming.
- Headers: `Content-Security-Policy: default-src 'none'; script-src 'self' https://www.gstatic.com; connect-src 'self'
  https://<project>.web.app https://*.googleapis.com; frame-src https://<project>.firebaseapp.com; style-src 'self';
  base-uri 'none'; form-action 'none'; frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: no-referrer`, `Cache-Control: no-store`.

### 2.2 What the worker holds

- The ID token (an hour) and the refresh token, **in memory only** (never on disk, never logged: the logger redacts
  both shapes). It refreshes the ID token through `securetoken.googleapis.com/v1/token?key=<web API key>` five minutes
  before it expires; a refused refresh ends the session (the page says sign in again).
- No service-account key, no USGS token, no Mapbox token, no Google OAuth token: everything the server allows is what
  the signed-in account may do through the five callables (§2.4), for the city given on the command line.

### 2.3 The local server's guards

- `Host` must be `localhost:8765` or `127.0.0.1:8765` (a DNS-rebinding page gets 421).
- State-changing requests (`POST`, `DELETE`) need `Origin` equal to `http://localhost:8765` or `http://127.0.0.1:8765`,
  `Content-Type: application/json` and the CSRF token (32 random bytes, per process, in the page only); anything else is
  403. `GET /state` (the page's status poll) answers the same origin only (no CORS headers at all).
- The token must be a Firebase ID token of this project: the worker calls `worker.hello` with it before keeping it, so
  a token of another project or a non-admin is refused at once and the page shows why.

### 2.4 The callables (registry rows; access `cityEditor`, App Check `off`)

App Check cannot attest a process on the owner's computer (no reCAPTCHA, no device attestation), so the worker family
runs with `enforceAppCheck: false`, the first callables without App Check; the ID token of a city editor is the
credential, and each callable is narrowed to what one job needs (§10).

| Callable | Request | Does | Answers |
| --- | --- | --- | --- |
| `worker.hello` | `{cityId, workerId, version}` | sets `cities/{city}/workers/{workerId}` (`uid`, `version`, `startedAt` once, `lastSeenAt`, `state: 'idle'`) | `{pollSeconds, heartbeatSeconds}` |
| `worker.claim` | `{cityId, workerId}` | refreshes `lastSeenAt`; in one transaction, the oldest `queued` job of the city with `runOn: 'local'`, due, not cancelled, a pipeline type, attempts left → `starting`, `attempt + 1`, `dispatchAt`, `lease {owner: 'worker:<id>', until: now + LEASE_SECONDS}`, `worker {id, uid, claimedAt}`, `machine` removed, `waitReason` removed; the worker doc `busy` with `jobId` | `{job: {jobId} \| null}` |
| `worker.step` | `{cityId, workerId, jobId, op}` with `op` one of `get {path}`, `update {path, fields, ifUpdateTime?}`, `create {path, data}`, `list {collection}` | the document operation, on the allow-list of §2.5 only, while the caller's worker holds the job (`job.worker.id == workerId`, `job.worker.uid == uid`, and no other owner's live lease) | `get`: `{data, updateTime}`; `update`: `{ok}` (`ok: false` when `ifUpdateTime` no longer matches); `create`: `{created}`; `list`: `{ids}` |
| `worker.urls` | `{cityId, workerId, jobId, request}`: `{kind: 'objects', objects: [{path, method: 'GET' \| 'PUT', contentType?}]}` (at most 20) or `{kind: 'usgs', endpoint, payload}` | objects: each path on the allow-list of §2.5 → a V4 signed URL valid `WORKER_URL_SECONDS` (900 s), a PUT bound to its content type, with the object's metadata when it exists; usgs: the M2M call with the server's key, its payload checked (§2.5) | `{objects: [{path, url, method, headers, expiresAt, exists, size?, generation?, md5?}]}` or `{usgs: <M2M data>}` |
| `worker.end` | `{cityId, workerId, jobId, outcome: 'done' \| 'failed', error?: {code, message}}` | the worker doc `idle` with `lastJob`; `failed` on a job the worker still holds unfinished → the job and its version `failed` (`error.code` an `apiError.*` code, else `apiError.imagery.processingFailed`) | `{status}` |

Every callable refuses when `ops/guard` is red (`apiError.guardPaused`), except `worker.end` and `worker.step`'s writes
that end a job (a run in progress must be able to stop cleanly).

### 2.5 The allow-lists

Documents (`worker.step`), for the claimed job `J` of city `C` with its version `V`, layer `L` and parameters:

| Path | get | update | create | list |
| --- | --- | --- | --- | --- |
| `cities/C` | yes | | | |
| `cities/C/jobs/J` | yes | the pipeline's fields only (`WORKER_JOB_FIELDS`); `status` to `running`, `queued`, `waiting_usgs`, `awaiting_gcps`, `awaiting_approval`, `failed`, `cancelled` (the last only after `cancelRequested`); `lease` only its own owner or removed | | |
| `cities/C/jobs/J/logs/*` | | | yes (`jobLogDocSchema`) | yes |
| `cities/C/layerVersions/V` | yes | the pipeline's fields only (`WORKER_VERSION_FIELDS`); `state` to `processing`, `needs_gcps`, `awaiting_approval`, `failed`, `cancelled` | | |
| `cities/C/layerVersions/<params.basedOn>` (`regeoref`) | yes | | | |
| `cities/C/layers/L` | yes | | | |
| `cities/C/usgsScenes/<params.entityId>` (`usgs-import`) | yes | | | |

Each write is merged into the current document and the result validated with the shared schema before it is stored
(`jobDocSchema`, `layerVersionDocSchema`, `jobLogDocSchema`); `updatedBy` is `system:pipeline`, as the Cloud Run run
writes. A finished job (`succeeded`, `failed`, `cancelled`) takes no more writes but its log lines.

Objects (`worker.urls`): GET `rasters/C/L/V/*`, `rasters/C/L/<basedOn>/scan.tif` (`regeoref`), the job's
`params.uploadPath` (`geotiff-import`); PUT `rasters/C/L/V/<VERSION_FILES>` only. Nothing else: the delivery, the scratch
and the reference cache stay on the computer, so no signed URL ever names them.

USGS (`worker.urls`, `kind: 'usgs'`): `download-options` with `datasetName == params.dataset` and `entityIds ==
[params.entityId]`; `download-request` with one download of `params.entityId` and `label == 'hcm-<J>'`;
`download-retrieve` and `download-order-remove` with `label == 'hcm-<J>'`. Any other endpoint or payload →
`apiError.worker.refused`. The answer is M2M's `data` as USGS sent it (the delivery URLs in it are USGS's own short-lived
signed addresses).

## 3. Where a job runs (the dispatcher)

- `JOB_WAIT_REASONS` gains `worker` (a `local` job waits for a worker to claim it) and `free-tier` (a `cloud` job waits for
  the admin's OK, §4). `RUN_PLACES = ['local', 'cloud']`, `RUN_CHOICES = ['auto', 'local', 'cloud']`.
- `cities/{city}/workers/choice` (`runChoiceDocSchema`: `{choice}` + the stamp) is the city's remembered choice, written by
  `imagery.runOn` only; absent → `auto`.
- `dispatchJob` for a queued pipeline job, after the attempts check: `place = job.runOn ?? placeFor(city)`; a job without
  `runOn` gets it written. `local` → `waitReason: 'worker'`, nothing else. `cloud` → the free-tier check (§4.3), then
  the guard and the capacity as before. A local run takes no Cloud Run slot (`RUNNING_JOBS_MAX` counts executions).
- `imagery.runOn {cityId, jobId?, runOn, freeTierOk?}` (access `cityEditor`, App Check enforced): without `jobId`, the
  city's choice (`auto`, `local` or `cloud`); with `jobId`, the job's place (`local` or `cloud`) and the city's choice
  too, allowed while the job holds no run (`queued`, `waiting_usgs`, `awaiting_gcps`; else `apiError.imagery.versionState`):
  `runOn` written, `worker` and `waitReason` cleared, and `freeTierOk: {by, at}` when `freeTierOk` is true and the place
  is `cloud`; a `queued` job is then dispatched again by its trigger.
- `imagery.tick`'s lost-run step: a `running` (or `starting`) job with `runOn: 'local'` whose lease lapsed (no worker
  heartbeat for `LEASE_SECONDS`) goes back to `queued` (`waitReason: 'worker'`, `worker` removed) with a log line
  `apiError.imagery.workerLost`; its attempt stays counted (the dispatcher fails it past `JOB_MAX_ATTEMPTS`).

## 4. Cloud Run's free tier

### 4.1 The numbers

`CLOUD_RUN_FREE_TIER = {vcpuSeconds: 180_000, gibSeconds: 360_000}` a month (the user's figures; Cloud Run's
request-based free tier; jobs may be billed against the instance-based tier's 240,000 and 450,000 instead: **UNVERIFIED**,
the lower figures are the conservative ones). `JOB_MACHINE_SIZES`: `fetch` 1 vCPU / 4 GiB, `std` 4 / 16, `xl` 8 / 32
(`CLOUD_RUN_JOBS`). `CLOUD_RUN_ESTIMATE_SECONDS`: a download phase 1,800 s on `fetch`, a processing phase 2,700 s on `std`
and 3,600 s on `xl`.

### 4.2 Counting

`imagery.onJobWrite`, on a transition out of `starting` / `running` of a job with `runOn` not `local`, a `machine` and a
`dispatchAt`, in one transaction: unless `job.usageCountedAt` already equals `dispatchAt` (a redelivered event), adds
`(now − dispatchAt)` seconds × the machine's vCPUs and GiB to `usage/cloudrun-<usageMonth(now)>`
(`cloudRunUsageDocSchema`: `month`, `vcpuSeconds`, `gibSeconds`, `runs`, the stamp) and sets `usageCountedAt`. The
document is the project's (every city's runs); admins read it (`usage/*`).

### 4.3 The OK

`estimateCloudRun(job)`: the phases still to run (the download phase when `DOWNLOAD_STEPS` are pending, then the
processing phase on `xl` for a KH-9 panoramic frame or after an escalation, else `std`) × `CLOUD_RUN_ESTIMATE_SECONDS` ×
the sizes. Before a cloud dispatch that is not a hand-over (§82f), when `job.freeTierOk` is absent and this month's use
plus the estimate passes either figure, the job stays `queued` with `waitReason: 'free-tier'`; a job created by
automation (`createdBy` a `system:` writer) also raises the notification `job.needsOk` (warning, push) whose inbox item
opens the version. The admin's OK is `imagery.runOn {jobId, runOn: 'cloud', freeTierOk: true}`; "Run on my computer" is
`runOn: 'local'`.

### 4.4 What the admin shows

On the Jobs page and the pipeline card: "Cloud Run this month (estimate): 12,345 of 180,000 vCPU-seconds · 45,678 of
360,000 GiB-seconds", a bar for the larger share, from `usage/cloudrun-<month>`; on a version waiting for the OK, the
estimate and the two buttons.

## 5. The raw USGS delivery

- `locate`, after `scan.tif` is uploaded and the version's `scan` written, deletes the job's delivery
  (`steps.fetch.gcsPath`, a `usgs-raw/` object) and logs it. A retry that needs it again finds `fetch`'s recorded
  output gone and downloads again (`M3-interfaces.md` §5.2's skip rule, unchanged). On the worker the same call deletes
  the local file.
- `PRIVATE_BUCKET_LIFECYCLE`'s `usgs-raw/` goes from 30 to 7 days: the backstop for a delivery whose job never reached
  `locate` (Provision applies it when the owner runs step c again).
- Another city's job of the same frame that is between `fetch` and `extract` at that moment fails `extract` and its
  retry downloads again (accepted: two cities importing the same frame within minutes is rare).

## 6. Mapbox's Uploads API

- What the research says (`platform-research.json`, the Mapbox area, verified 2026-10-11): the Uploads API takes an 8-bit
  GeoTIFF up to 10 GB; its processing is billed by the megabyte, 10,000 MB a month free, then $0.007/MB, and uses **no
  compute units**; it is "legacy" (no end date); it picks the zooms itself (no `maxzoom`); a tileset made by MTS cannot be
  replaced through it; Console uploads of at most 300 MB, 20 a month, are free and go through it.
- The publisher's `guard` step chooses the path: **uploads** when `output.studio` exists with `bytes <=
  UPLOADS_FREE_MAX_BYTES` (300 MB, `STUDIO_MAX_BYTES`), the month's `uploadsApiMb + bytes / 1e6 <=
  MAPBOX_FREE_UPLOAD_MB`, and the layer's `mapbox.origin` is absent, `uploads` or `studio`; otherwise **mts**, the guard of
  `M3-interfaces.md` §7.2 unchanged.
- **uploads** path: `upload` = `POST /uploads/v1/{user}/credentials` → the S3 `PUT` of `studio.tif` (SigV4 with the
  temporary credentials, streamed from the private bucket) → `POST /uploads/v1/{user}` `{tileset: tilesetIdFor(user,
  name), url, name}`; `tiles` polls `GET /uploads/v1/{user}/{upload}` (`complete`, `error`) then the TileJSON smoke test;
  `finalize` as for MTS with `mapbox.origin: 'uploads'`, `uploadsApiMb += bytes / 1e6`, `uploadsApiPublishes + 1`, no
  compute units. The token is the same `mapbox-sk-tiles`, which must also carry `uploads:read` and `uploads:write`
  (Setup's Mapbox step lists them); a 401 or 403 on the credentials call, or an upload that ends in `error`, falls back to
  the MTS path once (the log says why).
- The version records `mapbox.via`: `uploads`, `mts` or `studio`; the version page says which.

## 7. The admin

- One lazy chunk, `worker` (`packages/admin/src/worker/`, `packages/ui/src/admin/worker/`), budget row
  `"worker": 5` (KB gzip), loaded by the Jobs page, the pipeline card (`hcm-setup-pipeline`) and the version page only
  when they show it; its words in `packages/shared/src/i18n/admin-worker/{ro,en}.ts`, a catalogue the entry does not
  import (the `i18n` gate checks its parity like every folder's).
- `<hcm-worker-panel>` (Jobs page, pipeline card): the worker's state ("Your computer is connected" with when it was last
  seen and the job it works on, or "No computer connected"), the command with **Copy**, the notes (the work folder, the
  gcloud alternative), the city's choice (**Run on my computer when it is connected** / **Always on my computer** /
  **Always in Google Cloud**: `auto`, `local`, `cloud`), and the free-tier meter (§4.4).
- `<hcm-run-place>` (the version page of an unfinished version whose job holds no run): where it runs, **Run on my
  computer** / **Run in Google Cloud**; for `waitReason: 'free-tier'` the estimate, the month's use and **Run in Google
  Cloud anyway** (the OK) / **Run on my computer**; for `waitReason: 'worker'` "Waiting for your computer" and the
  command's link to the Jobs page.
- Every state joins the tour's inventory (`e2e/tour/states.ts`) and passes `expectStateSound`.

## 8. Data model changes (done with this contract: `packages/shared`)

| Where | Change |
| --- | --- |
| `JOB_WAIT_REASONS` | + `worker`, `free-tier` (and `pipeline/tests/contracts/enums.json`) |
| `jobDocSchema` | + `runOn`, `worker {id, uid, claimedAt}`, `freeTierOk {by, at}`, `usageCountedAt` |
| `LAYER_TILESET_ORIGINS` | + `uploads` |
| `layerVersionDocSchema.mapbox` | + `via` (`PUBLISH_PATHS`: `uploads`, `mts`, `studio`) |
| `usageDocSchema` (`usage/mapbox-*`) | + `uploadsApiMb`, `uploadsApiPublishes` |
| new | `workerDocSchema`, `runChoiceDocSchema`, `cloudRunUsageDocSchema`; `FIRESTORE_PATHS.workers`, `.worker`, `.runChoice`, `.cloudRunUsage` |
| `NOTIFICATION_KINDS` | + `job.needsOk` |
| `PRIVATE_BUCKET_LIFECYCLE` | `usgs-raw/` 30 → 7 days |
| `API_ERRORS` | + `apiError.worker.notHolder`, `apiError.worker.refused`, `apiError.imagery.workerLost` |
| `CALLABLES` | + the five `worker.*` rows (owner `fn-worker`) and `imagery.runOn` |
| `@hcm/shared` `api/worker.ts` | the constants of §1–§4 and the request and response schemas |

Rules: `cities/{city}/workers/{doc}` read for the city's members, never written by a client (rules tests: the
allow/deny pair). Indexes: `jobs` by `runOn`, `status` then `createdAt` (the claim's query).

## 9. Scenarios (behaviours A62–A64 and P04; registered with this contract as `planned`)

| Behaviour | Happy | Bad |
| --- | --- | --- |
| A62 Run on my computer (admin) | the panel shows the connected worker and the command; a job chosen for the computer is claimed and finishes | no worker: the job waits and says so; the choice cannot change while the job runs |
| A63 Cloud Run's free tier (admin, functions) | the meter shows the month's use; the OK starts the run | a run past the free tier waits for the OK, an automated one with an inbox item |
| A64 The free Uploads path (functions) | a small file publishes through the Uploads API without compute units, `via: 'uploads'` | too large, the month's allowance used, an MTS tileset or a token without the scope → MTS behind the guard |
| P04 The local worker (pipeline) | the worker claims a job and finishes it through `worker.step` and signed URLs; raw files never uploaded | another worker's job, a path off the allow-list, a forged origin or Host on the local page, a refused refresh |
| P01 (added rows) | the delivery is deleted after `locate` | a retry after the deletion downloads again |

The exact ids are in `e2e/scenarios.json`.

## 10. Security review

1. **Token scope.** The worker holds a Firebase ID token and refresh token of the signed-in Google account, in memory.
   What that token can do is what that account can already do in the admin (it is a city editor's token: the rules and
   every callable apply as in the browser); the worker family adds the job-scoped document and object operations of
   §2.5 and nothing project-wide. It holds no service-account key and no USGS or Mapbox secret, so a stolen worker
   process leaks no long-lived credential; the refresh token is the long-lived part, revoked by signing out of the
   Google account's sessions (Firebase revokes refresh tokens on a password change or `revokeRefreshTokens`), which the
   admin guide says.
2. **Signed URL scope and lifetime.** One object per URL, 15 minutes, PUT bound to its content type, only the claimed
   job's version files (PUT) and its inputs (GET), only while that worker holds the job. A leaked PUT URL can overwrite
   one file of one unfinished version for 15 minutes: the version is then wrong, not the public map (nothing reaches the
   map before approval; the georeferencer shows the files).
3. **A malicious local process.** A process of the same user on the computer can read the container's memory or the
   work folder anyway: it gets the token (the account's access) and the raw scans (public-domain imagery). The local page
   does not widen that: the tokens never travel back out of the worker (`/state` says only the account's e-mail and the
   job), and a process of another user cannot reach the container's memory. Out of scope: an attacker who already runs
   code as the owner.
4. **CSRF and DNS rebinding on 127.0.0.1.** Any web page the owner visits can send requests to `localhost:8765`: the
   `Host` check stops a rebinding name; the `Origin` check, the JSON content type (a cross-origin form cannot send it
   without a preflight the server does not answer) and the per-process CSRF token stop a cross-site `POST /session` that
   would plant an attacker's token (which would make the worker work for the attacker's project: harmless to the owner
   but refused anyway) or `DELETE /session`; `GET /state` sends no CORS headers, so another origin cannot read it.
   `frame-ancestors 'none'` stops clickjacking of the Sign in button.
5. **Public image.** `allUsers` may pull the pipeline image: it holds no secret (the gates' secret scans run on the
   tree it is built from); the cost of others' pulls is the owner's egress (§1.1). The alternative keeps the repository
   private (`gcloud auth configure-docker`).
6. **App Check off for `worker.*`.** The calls carry a verified ID token of a city editor; each is bound to a job the
   caller's worker claimed; the guard pauses them; `worker.urls` signs at most 20 objects a call and the instance cap is
   two. The admin's own callables keep App Check.
7. **USGS through the server.** The worker never sees the USGS application token or API key; the proxy accepts four
   endpoints with payloads bound to the claimed job's scene and label, so a worker cannot use the project's USGS account
   for anything else.

## 11. UNVERIFIED, and how the first real run proves it

- Firebase Auth's default authorized domains include `localhost` on this project: the first sign-in on the local page.
- V4 signed PUT URLs from the functions' runtime account (`signBlob` on itself, as the export's GET): the first local
  run's `scan.tif` upload.
- The Uploads API's billing (no compute units, 10,000 MB free) and its replacement of an Uploads-made tileset: the first
  publish through it, then the Mapbox account's statistics page.
- Cloud Run jobs' free tier (request-based 180,000 / 360,000 versus instance-based 240,000 / 450,000): the first month's
  billing report against `usage/cloudrun-<month>`.
- `allUsers` reader on the `hcm` repository in a project without an organisation: the first `docker pull`.

## 12. Ownership

One milestone, four workstreams in one tree: **shared** (this contract, `packages/shared`, the scenario rows; first),
**fn-worker** (`functions/src/worker/`, the signer's PUT, the USGS proxy, the tick's lost local run, the rules, the
install record's image), **fn-cost** (the dispatcher's place and free tier, the usage count, `imagery.runOn`, the
notification, the Uploads API path), **pipeline** (`hcm_pipeline/worker/`, the raw deletion, pytest), **admin** (the
`worker` chunk, Provision's repository binding, the tour states and the admin specs). The integrator (shared) runs the
gates and writes the docs.

## Addendum (2026-11-02, the integrator)

- §8's `CALLABLES` row as built: the registry is split by its consumers (`DECISIONS-for-review.md` §83b, `docs/LESSONS.md`
  337). `ADMIN_CALLABLES` (`packages/shared/src/api/registry.ts`) holds every callable but the worker's, `imagery.runOn`
  included; `WORKER_CALLABLES` and the five request and response schemas are in `worker-calls.ts`; `CALLABLES`
  (`callables.ts`) is both, for the functions, the tests and the e2e mock server. The admin imports `ADMIN_CALLABLES` and
  `CALLABLE_NAMES` only, so the worker's schemas never reach its bundle.
- §7's budget row is `"worker": 7` (5.5 KB measured); the admin's total budget went from 620 to 630 KB (§83b).
- §6 as built: the publish records the path as a job step of its own, `uploads` (§83f); the minted `mapbox-sk-tiles`
  token does not carry `uploads:read` and `uploads:write` yet, so a publish falls back to MTS once (§83i, PROPOSED).
- §1.2 step 6: the first SIGTERM or Ctrl-C after the worker ran a job was lost in three of five e2e runs; a second one
  stops it (§83j, OPEN).

## Addendum (2026-11-02, after the split `all` of `d7fe0c9`)

- §1.2 step 6 as fixed (`DECISIONS-for-review.md` §83j RESOLVED, `docs/LESSONS.md` 342): one SIGTERM or Ctrl-C stops the
  worker at any moment. The runner's handler tells the loop's, neither takes a lock, the loop's waits look at the signal's
  flag every 0.25 s, and a stop taken while a job is claimed requeues it at the run's first checkpoint, no step started.
  `pipeline/tests/integration/test_worker_stop.py` (S-P04-BAD-ONE-SIGNAL) pins it.
- §4.3's notification `job.needsOk` is one of the push kinds the rules allow (`firebase/firestore.rules`
  `validPushKinds`, §83k, `docs/LESSONS.md` 340); it was missing, and every save of the push settings was refused.
