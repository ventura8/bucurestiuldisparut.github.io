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
2. `worker.hello {cityId, workerId, version}` once (`workerId`: `w-` and 16 hex characters, kept in the work folder across restarts since finding 77 and forgotten with the session), which
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
| `cities/C/layerVersions/<params.parts[].versionId>` (`layer-join`, M8) | yes | | | |
| `cities/C/layers/L` | yes | | | |
| `cities/C/usgsScenes/<params.entityId>` (`usgs-import`) | yes | | | |

Each write is merged into the current document and the result validated with the shared schema before it is stored
(`jobDocSchema`, `layerVersionDocSchema`, `jobLogDocSchema`); `updatedBy` is `system:pipeline`, as the Cloud Run run
writes. A finished job (`succeeded`, `failed`, `cancelled`) takes no more writes but its log lines.

Objects (`worker.urls`): GET `rasters/C/L/V/*`, `rasters/C/L/<basedOn>/scan.tif` (`regeoref`), each
`rasters/C/<part.layerId>/<part.versionId>/scan.tif` (`layer-join`, M8), the job's `params.uploadPath` (`geotiff-import`); PUT `rasters/C/L/V/<VERSION_FILES>` only. Nothing else: the delivery, the scratch
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

## Addendum (2026-11-02, the live test of the local worker: findings 65–69)

The owner's request: "make sure all of this is automagic for the admin!!!" (`docs/research/manual-test-2026-10-25.md`
findings 65–69, `DECISIONS-for-review.md` §85). What changes in this contract:

- **§1.1, the command (finding 66)**, one line with nothing to prepare, written for the owner's shell:

  ```text
  docker rm -f hcm-worker 2>&1 | true; docker run -d --name hcm-worker --restart unless-stopped \
    -p 127.0.0.1:8765:8765 -v hcm-worker:/work \
    us-central1-docker.pkg.dev/<project>/hcm/pipeline@sha256:<digest> worker --city <city> --project <project> --pair <code>
  ```

  (on Windows PowerShell `2>&1 | Out-Null` instead of `2>&1 | true`; one line in the panel). `/work` is the named volume
  `hcm-worker`, initialised from the image's `/work` (owned by the worker's user `10001`), so the `mkdir -m 777` note is
  gone; the worker runs detached and comes back after a reboot; the same line replaces an older worker. One worker per
  computer (the container's name and the port).
- **§1.4 (new), the image a worker runs (finding 67).** The command names the image by digest, and Docker's restart
  policy never pulls, so the worker cannot update itself. The pairing records the digest its command named;
  `worker.hello` answers the installed one (`image`) and `outdated`; `worker.claim` gives an outdated worker no job
  (`{job: null, outdated: true}`); the worker's page and log, and the admin's panel, say to run the command again (its
  new code replaces the pairing: one paste, no sign-in).
- **§2.1, the page (finding 69)** is for the worker's state; its Google sign-in is a fallback that gives up after 90
  seconds with a message pointing at the admin's command, and the page shows the state when the SDK cannot be loaded.
- **§2.6 (new), pairing (finding 67).** `worker.pairCode {cityId}` (admin, `cityEditor`) mints the command's one-time
  code (26 base32 characters, 130 bits, 10 minutes) into `cities/{c}/pairings/{sha256(code)[:40]}` `{uid, image?,
  expiresAt}`, renewed by the panel a minute before it ends; `worker.pair {cityId, code, replaces?}` (no sign-in, App
  Check off, 20 attempts per city per 10 minutes) exchanges it once for a custom token of that owner with the claims
  `worker: true`, `city`, `pair`; the worker signs in with it at Identity Toolkit (`accounts:signInWithCustomToken`,
  the web API key, the Hosting origin as `Referer`), keeps `{refreshToken, pairId, codeHash}` in
  `/work/.hcm-session-<city>.json` (mode 600), and resumes it at the next start; `worker.revoke {cityId, workerId}`
  (admin, Disconnect this computer) revokes the worker and its pairing. The worker's five callables admit a paired
  token for its city (`workerToken` in their rows) as well as a city editor's Google sign-in; each finds its pairing
  standing (`apiError.worker.revoked` otherwise). `cities/{city}/pairings/*` has no client rule.
- **§3.1 (new), a computer that does not come (finding 68).** `imagery.tick` marks a local job that waited
  `WORKER_WAIT_MINUTES` (15) with no worker seen (`workerOverdueAt`, once) and leaves the inbox item `job.noWorker`; its
  version page offers Run in Google Cloud instead; a claim or a move clears the mark. The Jobs panel follows the busy
  worker's job live (step and progress).
- **§2.2 as changed**: a paired session's refresh token is on disk, in the volume only (mode 600, the code never), so a
  restart needs no new pairing; a session from the page's Google sign-in stays in memory only.
- **Provision (finding 65)** is versioned: an update runs the items whose definition changed since the project was
  last prepared (`DECISIONS-for-review.md` §85a), so this contract's `artifact-registry` and `bucket-lifecycle` changes
  reach a project with Update the map.

### §10, the security review of pairing (added)

1. **Code entropy and lifetime (§10.8).** 26 base32 characters from `crypto.randomBytes`: 130 bits. Valid 10 minutes, one use
   (marked used in the transaction that reads it), stored only as the first 40 hex characters of its SHA-256 (160 bits:
   a read of the collection gives no usable code). Guessing is hopeless; the per-city attempt limit (20 in 10 minutes,
   counted before the code is read) bounds the cost of trying, and one answer covers unknown, used, expired and revoked.
   The code is in the command the owner copies (a terminal's history, the clipboard): it is spent at the first start,
   and an unused one lapses in 10 minutes.
2. **Token scope (§10.9).** The custom token is the owner's uid with `worker: true`, `city`, `pair`, `sign_in_provider:
   'custom'`. `requireAccess` admits it only for the worker's own callables (`workerToken` rows), only for its `city`,
   only while the owner still has a role there and the pairing stands. Every other callable and every security rule wants
   `sign_in_provider == 'google.com'`, so the token reads no Firestore and calls no admin callable. It can do what §10.1
   says a worker can, for one city.
3. **Persistence on disk (§10.10).** The refresh token is in the named volume (`.hcm-session-<city>.json`, mode 600, owned by the
    container's user), never the ID token, never the code (its SHA-256 only, to tell a new command). Anyone with root or
    the Docker group on the computer can read it, as they can read the container's memory (§10.3).
4. **Revocation (§10.11).** Disconnect this computer revokes the pairing and the worker document in one transaction: every call
    of that worker, and of a restart with the kept refresh token, is refused (`apiError.worker.revoked`) and the worker
    deletes its kept session. The refresh token itself stays valid at Google until the owner's sessions are revoked, but
    it opens nothing: the worker's callables check the pairing on every call, and nothing else admits the token. A new
    command revokes the pairing it replaces.
5. **`worker.pair` without App Check or sign-in (§10.12).** The only callable of its kind: it reads one document by a hash, writes
    two (the limit, the pairing), and mints a token only for a code an editor minted minutes before. The rate limit is
    per city, so a stranger can make the owner's pairing wait 10 minutes at worst, not take it.
6. **The Referer header (§10.13).** The worker names the project's Hosting origin as `Referer` to Identity Toolkit and the token
    service, because Provision restricts the browser key to the Hosting origins; that restriction guards the key in
    browsers, not against a client that sets headers, so this widens nothing.

**UNVERIFIED** (§11, added): fn-admin's `signBlob` for `createCustomToken` (the role Provision grants it since M5), the
custom-token sign-in with the Hosting origin as `Referer`, a reboot resuming the kept session, the image pull through
the new command; the first real pairing proves the first two, a reboot the third.

## Addendum (2026-11-02, the starter file and auto-pair: finding 72)

The owner's request after the live update: "I should not have to copy and paste. Fix."; the decision **Starter file +
auto-pair** (`docs/research/manual-test-2026-10-25.md` finding 72, `DECISIONS-for-review.md` §86). What changes in this
contract:

- **§1.5 (new), the starter file.** The worker's panel leads with **Use this computer**: the browser saves a file for the
  system it picks from the user agent (switchable): Linux `hcm-worker.sh`, macOS `hcm-worker.command` (the same POSIX
  template), Windows `hcm-worker.bat` (cmd, then a PowerShell part after its `exit /b`). The templates are
  `packages/admin/starter/hcm-worker.sh` and `hcm-worker.bat`; the admin's site build publishes them at
  `/admin/worker/` and the admin fills `__HCM_PROJECT__`, `__HCM_CITY__` and `__HCM_ACTION__` (`install` or `uninstall`),
  each value checked against its pattern first, CRLF line ends for Windows (`packages/admin/src/worker/local.ts`). The file
  holds no secret. Opened once (Linux: `sh ~/Downloads/hcm-worker.sh`; macOS: a double-click, or the same `sh` line when
  Gatekeeper refuses a downloaded script; Windows: a double-click, past SmartScreen's **More info** → **Run anyway**), it
  checks Docker (`docker info`; else it says so and opens Get Docker), copies itself to a folder of the user's
  (`~/.local/share/hcm-worker`, `~/Library/Application Support/hcm-worker`, `%LOCALAPPDATA%\hcm-worker`) and installs a
  per-user supervisor with no administrator rights:

  | System | Supervisor | Back after |
  | --- | --- | --- |
  | Linux | `~/.config/systemd/user/hcm-worker.service` (`Restart=always`, `WantedBy=default.target`, the install's `PATH` and `DOCKER_HOST`); without `systemd --user`, `~/.config/autostart/hcm-worker.desktop` and the supervisor started now | login (and a reboot's login) |
  | macOS | `~/Library/LaunchAgents/org.historiccitymap.worker.plist` (`RunAtLoad`, `KeepAlive`, a `PATH` with Docker Desktop's folders, a log in `~/Library/Logs`) | login |
  | Windows | the scheduled task `hcm-worker` at the user's logon running the installed `hcm-worker.ps1` hidden; without the Task Scheduler, a `.cmd` in the Startup folder | logon |

  The supervisor's loop: ask the server for the installed image (`worker.image`, no sign-in: `{image, digest, release}`
  of `setup/status.install.pipeline`; `apiError.notFound` while none), accept only
  `us-central1-docker.pkg.dev/<project>/hcm/pipeline@sha256:<64 hex>`, `docker pull` it, remove an older `hcm-worker`
  container, `docker run --rm --name hcm-worker -p 127.0.0.1:8765:8765 -v hcm-worker:/work <image> worker --city <c>
  --project <p> --supervised --image sha256:<digest>` in the foreground, with **no** restart policy (the supervisor
  restarts it). When the worker ends: at once after `75` (`WORKER_OUTDATED_EXIT`, `ExitCode.OUTDATED`: under
  `--supervised` a claim answered `outdated` ends the worker), after a wait that grows from 10 s to 5 minutes after any
  other end (small again after a run of over 10 minutes); then it reads the installed image again. So an update of the
  pipeline reaches the computer within minutes, with no paste and no Docker socket in the container. **Stop using this
  computer** gives the same file with `uninstall`: it removes the supervisor, the container, the volume `hcm-worker` and the
  copied folder. One worker per computer, as before.
- **Why `worker.image` and not a file of the site build**: the image's digest is known only once the pipeline's own build
  has pushed it (`setup.recordInstall` records it); the site's build cannot know it, and a pipeline updated without the site
  would leave a static file naming an older image, which the supervisor would pull and the server call outdated, again
  and again. The callable reads the record the moment it asks.
- **§1.4 as changed, the image a worker runs**: `worker.hello` takes `image` (the digest the supervisor named); the worker's
  document records it, and `worker.hello` and `worker.claim` compare it (else the pairing's, as before) with the installed
  one. A kept pairing outlives many images, so the pairing's own image no longer decides for a supervised worker.
- **§2.7 (new), auto-pair.** The worker's local server answers two requests of the project's Hosting origins
  (`https://<project>.web.app`, `https://<project>.firebaseapp.com`; under the emulators `http://<HCM_HOSTING_HOST>`):
  `GET /state` (now also `workerId` and `pairable`: no session, and not disconnected in the admin) with
  `Access-Control-Allow-Origin: <origin>` and `Vary: Origin`, and `POST /pair {code}` (a JSON body, so a preflight: `OPTIONS`
  answers 204 with the methods, `content-type`, `Access-Control-Max-Age: 600` and, when asked,
  `Access-Control-Allow-Private-Network: true`); 202 with the state, or 409 with why (`paired`, an invalid code). The code
  goes to the connector (`Connector.offer`), which pairs at the loop's next pass exactly as `--pair` does. Any other origin
  gets 403 and no CORS header. The admin (`LocalComputer`, the lazy `worker-local` chunk) looks every 5 s while the panel is
  shown, and while the admin is open (`packages/admin/src/app/local-watch.ts`), but only in a browser that set this
  computer up for the city (`localStorage` `hcm:admin:workerLocal`, written by **Use this computer**, removed by **Stop
  using this computer**): a worker of this city and project that is `pairable` gets a code from `worker.pairCode` posted to
  `/pair` (again after a minute at most); a signed-in one shows **This computer is connected**. The admin's CSP
  `connect-src` names `http://127.0.0.1:8765` and `http://localhost:8765`. The copyable command stays behind **Advanced**,
  its code minted when Advanced opens (no code is minted any more when the panel merely shows).
- **§7 as changed**: the `worker` chunk keeps the panel; the new lazy chunk `worker-local` (budget 5 KB, 4.3 KB measured)
  holds the starter file, the auto-pair, Stop using this computer, the command and `<hcm-worker-local>`, with its texts in
  `packages/shared/src/i18n/admin-worker-local/`.

### §10, the security review of the starter file and auto-pair (added)

1. **A malicious site cannot pair the worker (§10.14).** The worker answers `/state` and `/pair` with CORS only for the
   project's Hosting origins; a page of any other origin gets 403 and no `Access-Control-Allow-Origin`, so it can neither
   read the state nor send the JSON `POST` (a JSON body needs a preflight, which the worker refuses for that origin; a
   `text/plain` or form body is refused by the server itself). A browser sets `Origin`, which a page cannot forge. A DNS
   rebinding name still meets the `Host` check (421). Even a code that reached the worker could only pair it to the account
   that minted the code, in this project and city: the server's `worker.pair` binds the code to its minter and city.
2. **No CSRF token on `/pair` (§10.15).** The admin's page cannot know the worker's per-process token; the guard is the
   origin allow-list above, the preflight, and the code itself (single use, ten minutes, minted by a signed-in city editor
   through App Check). Replaying a seen code fails (`apiError.worker.pairCode`); a worker already paired answers 409.
3. **A malicious local process (§10.16), as before §10.3.** A process of the same user can send any `Origin` to
   `127.0.0.1:8765`, but it can already run `docker` and read the volume, which hold more than a pairing could give it; a
   process of another user cannot reach Docker. Nothing changes there.
4. **Private Network Access, Local Network Access (§10.17).** A page on a public origin reaching `127.0.0.1` is what PNA and
   Chrome's Local Network Access permission guard: the worker answers PNA's preflight for the Hosting origins only, and the
   admin looks at the computer only in a browser that set it up (`hcm:admin:workerLocal`), so a visitor who never chose to
   use a computer is never asked. **UNVERIFIED**: the prompt Chrome shows the first time, and whether
   `upgrade-insecure-requests` leaves a loopback address alone in every browser (a potentially trustworthy URL: Chrome
   does).
5. **The starter file (§10.18).** It holds the project id and the city id, both public, and no secret; the values are checked
   against their patterns before they are written, so no quote or command reaches the script. It runs nothing but `docker`
   and `curl`/`Invoke-RestMethod` against the project's `cloudfunctions.net` address, and runs only an image of the
   project's own repository named by digest (the supervisor rejects any other answer). The container gets no Docker socket.
6. **`worker.image` without a sign-in (§10.19).** It reads one document and answers the image the repository already makes
   public (`allUsers` reader, §1.1), with the release; two instances at most, App Check off like `worker.pair`.

**UNVERIFIED** (§11, added): each system's first double-click (macOS Gatekeeper on a downloaded `.command`, Windows
SmartScreen, a Linux file manager that opens `.sh` in an editor: hence the `sh` line), `Register-ScheduledTask` at logon
without administrator rights, `launchctl bootstrap` from a double-clicked script, Chrome's Local Network Access prompt for
the admin's look at the loopback, Safari's and Firefox's handling of it, and the supervisor's update after a real Update the
map. A `.desktop` launcher for Linux was not made: GNOME's Files no longer launches an untrusted downloaded launcher.

## Addendum (2026-11-03, the installed image from the job, and the starter file as a download: findings 73–74)

The live test of 2026-11-03 after Update the map to `1.0.0+bf74d17` (`docs/research/manual-test-2026-10-25.md` findings
73–74, `DECISIONS-for-review.md` §87). What changes in this contract:

- **§1.5 as changed, which image is installed (finding 74).** The installed pipeline image is the one the Cloud Run job
  `raster-pipeline` runs (Run Admin v2 `jobs.get`, `template.template.containers[0].image`, `…/hcm/pipeline@sha256:<64
  hex>`), which the pipeline build's `jobs` step sets in the build that pushed it, with the release its `hcm-release`
  label names (`releaseOfSlug`). `worker.image`, `worker.hello`, `worker.claim` and `worker.pairCode` read it through one
  resolver (`functions/src/worker/installed-image.ts`), each instance keeping it a minute; the record
  `setup/status.install.pipeline.image` answers only while the job cannot be read (no job yet, a refusal: logged), and its
  `release` only for the digest it names: a release is never paired with another digest. `fn-admin@` reads the job with
  `roles/run.viewer` (Provision's `iam`, item set version 3: an update applies it in the same consent; until then the
  record answers). The admin reads the same job image on every look of the pipeline card (`InstalledInfo.image`), before
  the build log's `image` event (which Cloud Logging may not have yet when the build has just ended), and records the
  pipeline again when the image changes, not only its state. `worker.image` answers `{image, digest, release?}` as before.
- **The supervisor and an image older than it (finding 74).** A worker that ends with its usage error (`2`, argparse: an
  image from before `--supervised --image`) three times in a row makes the supervisor say once, in its log (the journal,
  `~/Library/Logs/hcm-worker.log`, the task's output), "The server named an image that does not support this computer's
  starter: update the map." and ask again every 5 minutes until the image changes; an outdated worker (`75`) is still
  started again at once.
- **§1.5 as changed, the starter file is a download the server answers (finding 73).** Live, Chrome saved nothing of the
  file the admin made in the page (a Blob URL behind a synthetic click after an `await`; cause **UNVERIFIED**: a `.sh` is a
  type Chrome lets through only for a download the user starts). **Use this computer** and **Stop using this computer** are
  now links (`<a href download>`) to the public HTTPS function `worker.starter` (`worker-starter`, `fn-admin@`, two
  instances, App Check off, no sign-in): `GET ?city=<city>&os=<linux|mac|windows>&action=<install|uninstall>`
  (`workerStarterQuerySchema`) answers the template of the system filled with this project, the city and the action, CRLF
  for Windows, with `Content-Type: application/octet-stream`, `Content-Disposition: attachment; filename="<name>"`
  (`WORKER_STARTER_FILE_NAMES`), `Cache-Control: no-store` and `Access-Control-Allow-Origin: *`; a bad query 400, another
  method 405, an unreadable template 503 (logged). `HEAD` answers the same headers: the panel makes one `HEAD` when it first
  shows, and a server that does not make the file (one from before this release) gets no link but "The map's server does
  not give the file yet: update the map (Setup, Update the map), then come back." The templates stay in
  `packages/admin/starter/`; `functions/build.mjs` copies them into `functions/dist/starter/` (the install bundle's
  `server.tgz` allows exactly those two files), and the admin's site build no longer publishes `/admin/worker/`.
- **§7 as changed, after the click.** The region says "Your browser may ask whether to keep the file: choose Keep. It is
  saved in your Downloads folder.", then how to open it: on Linux (a double-click opens a `.sh` as text) the exact line
  `sh ~/Downloads/hcm-worker.sh` with **Copy the line**; macOS and Windows as before. When the worker comes up and takes a
  code the panel turns to **Connecting this computer…** by itself, then **This computer is connected**.

### §10, the security review of `worker.starter` (added)

1. **A public file endpoint (§10.20).** It answers the same file anyone can derive from the open templates: the project id
   (in its own address) and a city id the query names, checked against `cityIdSchema`, so no quote or command reaches the
   script; nothing is read from Firestore, nothing is written. The action and the system are enums. `Cache-Control:
   no-store`, `nosniff`; two instances at most.
2. **CORS `*` (§10.21).** Only for the panel's `HEAD`; no credentials are sent or accepted, and the answer is public.
3. **`roles/run.viewer` for `fn-admin@` (§10.22).** Read-only: Cloud Run services', jobs' and executions' definitions and
   states of this project (the jobs' environment names the buckets, no secret). `fn-events@` already holds it.

**UNVERIFIED** (§11, added): what Chrome does with the server's attachment on each system (the keep prompt is expected for
`.bat` and possibly `.sh` and `.command`), and the cause of finding 73 itself.

## Addendum of 2026-11-03: the first import on the owner's computer

Findings 75 to 80 of `manual-test-2026-10-25.md` (`DECISIONS-for-review.md` §88e–§88h). The panel gains **Already set up? Look
for it** (`LocalIntents.find`, phase `looking`, the mark with no file); the worker's id is kept in
`<work>/.hcm-worker-<city>.id` and forgotten with the session (§1.2's "new per process" no longer holds); a Retry
(`imagery.retry`) keeps only the first finished of `locate`, `inspect`, `extract`, `fetch` and what came before it, so a
pipeline updated since the failure redoes the rest, on the computer or in Cloud Run alike.

## Addendum of 2026-11-06: the work folder

The worker's idle pass sweeps its work folder (`LocalObjectStore.sweep`, `worker/local_store.py`): a job's scratch and a scene's delivery
go whole once nothing in them was written for 14 and 7 days, never the scratch of the job just claimed. A new download session is refused
when the disk could not hold the delivery and its unpacked segments, before its first byte (`_require_room`, 2.6 times the delivery); a
retry after the delivery's week with its segments left downloads nothing (`runner.py` `_consumed`). **Known limit, decided for now:** a
dismissal or a rejection deletes only the bucket's `work/` (`functions/src/imagery/work-files.ts`); a job run here keeps its segments, about
13 GB, until the sweep's 14 days, as the server cannot reach this folder and tells the worker of no ended job. After a reload the panel
starts `looking` for the computer it remembers, not `downloaded`: nothing says the file was just saved, and the first answer says the rest.
An id file that holds no valid id is not read: the worker takes a new one at its next start.

## Addendum of 2026-11-06: a join on the worker (M8)

A `layer-join` runs here as any pipeline job (`docs/research/M8-join-interfaces.md`). `worker/allow-list.ts` reads `inputVersionsOf(job)`: a re-georeference's base or a join's frames, each read-only, and `inputsOf` adds each frame's `scan.tif`; the worker writes only the join's own version files, and `WORKER_VERSION_FIELDS` gains `join`. A worker cannot write `joined`: `WORKER_VERSION_STATES` does not hold it, as the finalize does that. `worker.claim` refuses a job waiting on `parts`, and `run-on.ts` keeps that reason when the city's choice moves the job. A scan is staged for its preview, its seams, its re-warp and its `merge`, so up to four downloads per frame with at most two scans on disk; `S-P05-HAPPY-WORKER` runs the job under the Python fake's copy of these lists and the callable's own lists have their tests in `functions/test/worker/`. **UNVERIFIED** on real frames: the time and the disk, measured by decision D3 of the M8 contract, where the worker may be the only practical runner.
