# Raster pipeline (`hcm_pipeline`)

The Python + GDAL pipeline that turns declassified USGS film scans (and uploaded GeoTIFFs) into georeferenced layer
versions awaiting approval, run as the Cloud Run Jobs `raster-pipeline` and `raster-pipeline-xl`. `python -m
hcm_pipeline run` walks a job's remaining steps; publishing to Mapbox is not the pipeline's (functions' `imagery.publish`
runs after approval, so the pipeline holds no Mapbox secret). Contract: `docs/research/M3-interfaces.md` (§4 the job
model, §5 the steps, §6 the georeferencing conventions); plan: `docs/research/PLAN.md` → *Raster pipeline*; skill:
`.agent/skills/pipeline/raster_pipeline_skill.md`.

## Steps

| Job type | Steps (`JOB_STEPS`, the pipeline's part) |
| --- | --- |
| `usgs-import` | `fetch` → `extract` → `stitch` → `locate` → `reference` → `georef` → `warp` → `export` → `register` |
| `geotiff-import` | `inspect` → `reference` → `georef` → `warp` → `export` → `register` (an upload with its own georeference skips `reference` and `georef`) |
| `regeoref` (new points, or a crop) | `georef` → `warp` → `export` → `register`, on the base version's scan |

- `fetch`: `download-options`, `download-request` labelled `hcm-{job}`, `download-retrieve`; the signed address streamed
  into a Cloud Storage resumable session in 64 MiB chunks (checkpoint `work/{city}/{job}/fetch.checkpoint.json`); a
  resume asks the session what it holds and sends `Range`; a 403 or 410 retrieves a fresh address; a redirect is
  followed only through the address guard; the size must equal
  `download-options`; SHA-256 read back in-region. Maintenance waits 30 minutes doubling to 12 hours; a rate limit waits
  its `Retry-After`; a preparing download waits 10 minutes.
- `extract` keeps the TIFF segments of the `.tgz` (streamed) or `.zip`; `stitch` mosaics them (template matching, coarse
  to fine, exact within 1 px) and cuts the film border.
- `locate`: the corner guess (`georef/corners.py`): eight assignments of the frame's corners to the scene's, scored
  against Sentinel-2 at 60 m; the city window (bounds ± 10 %) cropped as `scan.tif` with four corner GCPs.
- `reference`: Sentinel-2 L2A from the STAC API (`stac.py`, the `visual` COG through `/vsicurl/` after the address
  guard `urlguard.py`) and OpenStreetMap from Overpass (`osm.py`), cached under `reference/{city}/`; the
  georeferencer's `reference-s2.jpg` and `reference-osm.png`. **Never Mapbox Satellite**: `config.py` refuses a Mapbox
  host as a reference service and the guard refuses one as an asset.
- `georef`: automatic GCPs (`georef/matcher.py`: CLAHE, SIFT per cell within a search window, NCC fallback, RANSAC, three
  levels, at most two pairs per cell; `poly2` from 12 well-spread pairs, else `affine` from 6) or the fit of the admin's
  points (`georef/transforms.py`: affine, poly2, thin-plate spline, leave-one-out checkpoints, residuals in ground
  metres). Too few pairs make the job wait for points (`awaiting_gcps`, the version `needs_gcps`).
- `warp`: `gdalwarp` with the enabled GCPs in EPSG:3857 (or the upload's own georeference) at the resolution of the
  layer's `maxzoom` on the tile grid, an alpha band, `-cutline` for a crop; `export`: the 8-bit JPEG COG (alpha as a
  mask), the RGBA preview, the Studio GeoTIFF of at most 300 MB, the valid area; `register`: the version
  `awaiting_approval`, the job's scratch objects deleted.

## Layout

| Path | What |
| --- | --- |
| `main.py`, `steps/run.py` | `python -m hcm_pipeline run` (or one step, `doctor`, `--list`): logging, configuration, exit codes |
| `config.py` | the job environment (below), validated; secrets are never part of it |
| `runner.py`, `lease.py`, `jobs.py` | the lease, the heartbeat, the step loop, SIGTERM, cancel, waits and failures; what a step gets and returns |
| `contract.py`, `paths.py`, `model.py`, `documents.py` | the constants, paths and documents shared with `@hcm/shared` (`tests/contracts/`) |
| `store.py`, `objects.py`, `tokens.py`, `secrets.py` | Firestore (precondition writes), Cloud Storage (JSON API over httpx: resumable sessions, create-only writes), tokens, Secret Manager |
| `m2m.py`, `usgs.py` | the USGS M2M client and its download calls |
| `stac.py`, `osm.py`, `urlguard.py` | the references and the guard for addresses from data |
| `georef/` | `transforms.py`, `corners.py`, `matcher.py` |
| `raster.py`, `rasters.py`, `images.py` | the one GDAL import, GDAL file helpers, OpenCV images |
| `services.py` | the composition root: the real adapters (the emulators under `FIRESTORE_EMULATOR_HOST` and `STORAGE_EMULATOR_HOST`) |
| `steps/` | one file per step, `common.py` for what they share, `doctor.py` |
| `typings/osgeo/` | mypy stubs for the GDAL API the code calls |

## Configuration

`JOB_ID`, `CITY_ID`, `GOOGLE_CLOUD_PROJECT`, `HCM_PRIVATE_BUCKET`, `HCM_PUBLIC_BUCKET`, `USGS_M2M_BASE_URL` (optional),
`HCM_STAC_URL` (default Earth Search), `HCM_OVERPASS_URL` (default overpass-api.de), `CLOUD_RUN_EXECUTION` and
`CLOUD_RUN_TASK_ATTEMPT` (the lease owner). The e2e pipeline tier adds `FIRESTORE_EMULATOR_HOST` and
`STORAGE_EMULATOR_HOST` (loopback only) and `HCM_E2E_USGS_TOKEN` (a scenario test value); `GDAL_NUM_THREADS`, when
set, replaces the default `ALL_CPUS`. The USGS credentials (`usgs-username`, `usgs-app-token`) are read from Secret Manager at
run time.

## Exit codes

`0` done, waiting (USGS, the admin's points, approval), cancelled, requeued after SIGTERM, or not this execution's job
(a live lease elsewhere); `1` the job failed (an invalid job included; retries are the dispatcher's); `2` bad command
line; `3` incomplete or invalid environment.

## Tests

- `tests/integration/`: whole jobs against the loopback world (`tests/fakes/world.py`: the fake M2M server, one fake
  HTTP host for the USGS delivery, the STAC API with its Sentinel-2 COG and Overpass, the fake Cloud Storage JSON API,
  an in-memory Firestore); they carry the `S-P01-*` and `S-P02-*` scenarios in their docstrings.
- `tests/unit/`: each module, the golden contracts (`tests/contracts/`, owned by the contract: both languages must pass
  a change) and hypothesis properties of the transforms.
- `tests/synthetic/scenes.py`: a seeded world, its Sentinel-2-like GeoTIFF and Overpass answer, a film frame made by
  inverse warp through a known transform (projective, panoramic term, rotation and mirror), split into segments and
  packed as a `.tgz`, with offset metadata corners. For the e2e mock servers:

  ```bash
  PYTHONPATH=pipeline/src python pipeline/tests/synthetic/scenes.py --out reports/e2e-fixtures/imagery --seed 7
  ```

- Every test runs behind the loopback firewall; GDAL and OpenCV run on one thread with fixed seeds.

## Toolchain

- `osgeo.gdal` comes from `ghcr.io/osgeo/gdal:ubuntu-small-3.13.3` (by digest, Python 3.14); it is never
  pip-installed. The venv is created with `--system-site-packages` and without pip.
- Poetry 2.5.1 (`requirements-poetry.txt`, every transitive dependency pinned) locks `poetry.lock`. Regenerate the lock
  inside the quality image, never on the host:

  ```bash
  docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp/hcm-home -v "$PWD:$PWD" -w "$PWD" hcm-quality:local \
    bash -c 'mkdir -p $HOME && /opt/hcm/poetry/bin/poetry --directory pipeline lock'
  ```

- Every pipeline command runs from the repository root: `pyproject.toml` holds the pytest, coverage and mypy settings
  with repository-relative paths, so the reports land in `reports/coverage/pipeline.xml` and `reports/junit/pipeline.xml`.

## Quality gates

The quality image (`docker/Dockerfile.quality`) carries Poetry in `/opt/hcm/poetry` and the locked dependencies in
`/opt/hcm/pipeline-venv`, so the gates run there like every other gate (`python3 scripts/ci/pipeline.py --list`):

| Gate | Stage | Checks |
| --- | --- | --- |
| `ruff-check`, `ruff-format` | static | the repository-wide `ruff.toml` (complexity 5) |
| `pipeline-lock` | static | `poetry check --lock --strict`: the lock matches `pyproject.toml` |
| `pipeline-mypy` | static | mypy strict over `src` and `tests`, against the pipeline venv |
| `pipeline-radon` | static | radon grade A (complexity and maintainability) for `src` and `tests` |
| `pipeline-bandit` | static | bandit, every severity, for `src` |
| `pipeline-pip-audit` | static | the pipeline venv and the Poetry pins |
| `pipeline-pytest` | tests | the suite with branch coverage; `coverage` then holds every file to 90 % |

## Images

`Dockerfile` (build context `pipeline/`) has the stages `base` → `deps` → `test` | `runtime`:

```bash
docker build -f pipeline/Dockerfile --target runtime -t hcm-pipeline:local pipeline && docker run --rm hcm-pipeline:local
docker build -f pipeline/Dockerfile --target test -t hcm-pipeline:test pipeline && docker run --rm hcm-pipeline:test
```

`runtime` runs as uid 10001 with the venv and the package only (no pip, no test tools, no secret); its entry point is
`/opt/venv/bin/python -m hcm_pipeline` with the default command `doctor`; the Cloud Run executions pass `run`.
Configuration arrives in environment variables, the USGS credentials from Secret Manager at run time.
