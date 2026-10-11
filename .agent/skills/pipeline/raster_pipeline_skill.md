# Raster Pipeline Skill

The Python + GDAL pipeline that turns declassified USGS film scans (Corona KH-4, KH-7, KH-9) into georeferenced historical layers. Package `pipeline/src/hcm_pipeline`, run as a Cloud Run Job: scaffolded in M0 (configuration, logging, the M2M client, the doctor step, the fakes and the synthetic world in `pipeline/tests`), the processing steps arrive in M3. Plan: `docs/research/PLAN.md` → *Raster pipeline*; tests: `docs/research/design-review-testability.md` §3.6; reliability: `docs/research/design-review-security-cost.md` §4.

## Toolchain

- `osgeo.gdal` from the pinned `ghcr.io/osgeo/gdal:ubuntu-small-3.13.3` image (by digest). That image ships **Python 3.14**, so `requires-python = ">=3.14,<3.15"`. Never pip-install GDAL and never use rasterio wheels (they bundle a second GDAL into the same process).
- Poetry 2.5.1 (its own venv, `pipeline/requirements-poetry.txt`) and the project `pipeline/pyproject.toml` with `poetry.lock`; the venv uses `--system-site-packages` so `osgeo` is visible, and `--without-pip` (the seeded pip had advisories). numpy and opencv-headless for image work.
- `pipeline/Dockerfile` (build context `pipeline/`) stages: `base` (GDAL image), `deps` (Poetry, locked runtime dependencies in `/opt/venv`), `test` (adds the dev group and the tests; its command runs pytest), `runtime` (uid 10001, the venv and the package only; default command `doctor`). The runtime image keeps GDAL's tcmalloc preload; only the quality image clears it.
- GDAL is imported only through `hcm_pipeline.raster` (exceptions enabled). Exit codes (`hcm_pipeline.exit_codes.ExitCode`): 0 done or waiting, 1 failed, 2 usage, 3 configuration.
- Lint like every Python here: ruff (complexity 5), mypy strict with stubs for the GDAL API we use in `pipeline/typings/osgeo/`, radon grade A, bandit; logging through the pipeline's logger with secret and signed-URL redaction, never `print`.

## Steps (short, idempotent, resumable)

1. `fetch`: M2M with deterministic labels, a resumable stream into GCS, extract only the needed segments (`pipeline/usgs_m2m_skill.md`).
2. `locate` / `crop`: corner homography, city window plus margin, `-srcwin`, aft-frame rotation.
3. `georef`: M3 first guess from the corners plus the admin's GCPs from the georeferencer; M4 automatic GCP suggestions (CLAHE + SIFT/RANSAC against Sentinel-2) with checkpoint RMSE. **The reference is OSM data plus open Sentinel-2, never Mapbox Satellite** (Mapbox terms).
4. `warp`: `-tps` or `-order 2` to EPSG:3857, zoom-aligned bbox (KH-4 z16, KH-9 panoramic and KH-7 z17, KH-9 mapping z15).
5. `export`: 8-bit COG, preview, DZI tiles of the raw crop (OpenSeadragon), and a 300 MB or smaller GeoTIFF for the free Studio path.
6. `publish`: only after approval, or automatically when RMSE is under the threshold, and only within the compute-unit guard (`pipeline/mapbox_publishing_skill.md`).

## Job state machine (`cities/{c}/jobs/{id}`)

- Leases and heartbeat; `waiting_usgs` with backoff for maintenance (503 HTML); re-login at 100 minutes; a cancel flag; SIGTERM → `cancelled` with temp files removed.
- The task **exits while it waits** on something outside us (USGS preparing, maintenance, MTS processing); `ops.tick` (every 15 min) resumes or finalises it.
- OOM → re-dispatch on the `-xl` job (8 CPU / 32 GB instead of 4 / 16). Logs are redacted (signed USGS URLs never appear).
- The GCP budget alarm pauses the pipeline and MTS, never the public site.

## Tests (pytest, ≥ 90 % per file, inside the GDAL test image)

- **Synthetic georeferencing harness** (`pipeline/tests/synthetic/`): a seeded EPSG:3857 reference world (roads, river, parks, noise) served as a COG with HTTP Range behind a mock STAC item; a known ground-truth transform (projective plus panoramic term, optional rotation and mirror, upsample and blur, grain, an "urban change" patch); the scan made by inverse warp, split into overlapping segments, packed like USGS delivers, with metadata corners deliberately offset.
- Assertions: stitch offsets within 1 px, rotation and mirror detected, checkpoint RMSE on held-out points within tolerance, no accepted GCP inside the changed patch, the zoom range per camera, a valid 8-bit COG (`gdalinfo -json`), the MTS recipe shape.
- Property tests with hypothesis (`ci` profile: derandomised, 25 examples). Failure paths: blank scan, no STAC coverage, corrupt archive, expired signed URL, 503 maintenance, SIGTERM, memory guard.
- Determinism: `GDAL_NUM_THREADS=1`, `cv2.setNumThreads(1)`, seeded RNG and RANSAC. Fakes: the USGS M2M server on `127.0.0.1:0`, Firestore and Storage fakes in unit tests, the emulators in integration, the MTS API mocked. Non-loopback sockets are blocked.
- Compose tier (scenarios P01, P02): the worker (`hcm_pipeline.devtools.poller`, itself covered) against the emulators and the mock M2M server.
- Opt-in, local-only `real-data` stage: one known free Corona frame over Bucharest end to end, RMSE reported. Never in CI (public Actions logs would leak signed URLs).

## Wiring into the repository (done in M0)

`pipeline/pyproject.toml` holds the Poetry project and the pipeline's pytest, coverage and mypy configuration; every command runs from the repository root, so `reports/coverage/pipeline.xml` and `reports/junit/pipeline.xml` carry repository-relative paths for Sonar and `scripts/ci/check_coverage.py`. `ruff.toml` already covers every Python file. The quality image carries Poetry (`/opt/hcm/poetry`) and the locked venv (`/opt/hcm/pipeline-venv`); the gates `pipeline-lock`, `pipeline-mypy`, `pipeline-radon`, `pipeline-bandit`, `pipeline-pip-audit` (static) and `pipeline-pytest` (tests) use them. Commands, layout and the re-lock recipe: `pipeline/README.md`; decisions: `docs/research/M0-handoff.md` → *Raster pipeline*.
