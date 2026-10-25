# Raster Pipeline Skill

The Python + GDAL pipeline that turns declassified USGS film scans (Corona KH-4, KH-7, KH-9) into georeferenced historical layers. Package `pipeline/src/hcm_pipeline`, run as a Cloud Run Job: scaffolded in M0 (configuration, logging, the M2M client, the doctor step, the fakes and the synthetic world in `pipeline/tests`), every processing step built in M3 under `docs/research/M3-interfaces.md` (§2.3 who writes which job field, §4 the job model, §5 the steps and CR-M3-19 as built, §6 the georeferencing conventions); the golden documents it writes are in `pipeline/tests/contracts/`. What waits for the real cloud: `docs/research/M3-status.md`. Plan: `docs/research/PLAN.md` → *Raster pipeline*; tests: `docs/research/design-review-testability.md` §3.6; reliability: `docs/research/design-review-security-cost.md` §4.

## Toolchain

- `osgeo.gdal` from the pinned `ghcr.io/osgeo/gdal:ubuntu-small-3.13.3` image (by digest). That image ships **Python 3.14**, so `requires-python = ">=3.14,<3.15"`. Never pip-install GDAL and never use rasterio wheels (they bundle a second GDAL into the same process).
- Poetry 2.5.1 (its own venv, `pipeline/requirements-poetry.txt`) and the project `pipeline/pyproject.toml` with `poetry.lock`; the venv uses `--system-site-packages` so `osgeo` is visible, and `--without-pip` (the seeded pip had advisories). numpy and opencv-headless for image work.
- `pipeline/Dockerfile` (build context `pipeline/`) stages: `base` (GDAL image), `deps` (Poetry, locked runtime dependencies in `/opt/venv`), `test` (adds the dev group and the tests; its command runs pytest), `runtime` (uid 10001, the venv and the package only; default command `doctor`). The runtime image keeps GDAL's tcmalloc preload; only the quality image clears it.
- GDAL is imported only through `hcm_pipeline.raster` (exceptions enabled). Exit codes (`hcm_pipeline.exit_codes.ExitCode`): 0 done or waiting, 1 failed, 2 usage, 3 configuration.
- Lint like every Python here: ruff (complexity 5), mypy strict with stubs for the GDAL API we use in `pipeline/typings/osgeo/`, radon grade A, bandit; logging through the pipeline's logger with secret and signed-URL redaction, never `print`.

## Steps (short, idempotent, resumable)

1. `fetch`: M2M with the deterministic label `hcm-{job}`, a resumable stream into GCS (`pipeline/usgs_m2m_skill.md`); `extract` keeps only the TIFF segments; `stitch` mosaics them and crops the film border.
2. `inspect` (uploads): GDAL decides whether an upload carries its own georeference. Only here is a GDAL failure `apiError.imagery.unreadableRaster` ("check the file and upload it again"); every other step's is `apiError.imagery.processingFailed` (`gdal_step`'s `code`, CR-M3-47: an admin is never told to re-upload a USGS frame).
3. `locate`: the corner guess (the frame's rotation and mirror among eight, scored against Sentinel-2), the city window plus 10 %, four corner GCPs.
4. `reference`: Sentinel-2 L2A from a public STAC and OSM features from Overpass, cached in the private bucket. **The reference is OSM data plus open Sentinel-2, never Mapbox Satellite** (Mapbox terms).
5. `georef`: automatic GCPs (M3: CLAHE, SIFT and correlation over three levels, RANSAC, at most two pairs per cell, leave-one-out checkpoint RMSE; M4, `docs/research/M4-interfaces.md` §2: ORB when SIFT finds fewer than 200 keypoints, OpenStreetMap's lines as a second channel matched tile by tile against OSM's proximity field, RANSAC across both, a confidence and a residual per pair, a fifth held out as checkpoints from 15 confident pairs); pairs from 0.6 join the fit, lower ones are the version's `suggestions` for the georeferencer; too few pairs → the job waits for the admin's points (`awaiting_gcps`).
6. `warp`: `-order 1`, `-order 2` or `-tps` to EPSG:3857 on the zoom grid (KH-4 z15, KH-4A/B z16, KH-9 panoramic and KH-7 z17, KH-9 mapping z15), `-cutline` for a crop.
7. `export`: 8-bit COG, the preview, and a 300 MB or smaller GeoTIFF for the free Studio path; `register` writes the layer version for approval.
8. Publishing is functions' `imagery.publish`: only after approval, or automatically when the checkpoint RMSE is under the city's threshold, and only within the compute-unit guard (`pipeline/mapbox_publishing_skill.md`).

## Job state machine (`cities/{c}/jobs/{id}`)

- Leases and heartbeat; `waiting_usgs` with backoff for maintenance (503 HTML); re-login at 100 minutes; a cancel flag; SIGTERM → `cancelled` with temp files removed.
- The task **exits while it waits** on something outside us (USGS preparing, maintenance, a rate limit, the admin's points): it releases its lease and exits 0; `imagery.tick` (every 5 min) resumes it, re-dispatches a lost or out-of-memory run and polls MTS. A second execution of the same job finds the lease held and exits 0 untouched; SIGTERM without a cancel requeues the job and keeps the download's checkpoint; a cancel deletes the job's `work/` objects (the dispatcher then releases the layer's pending version, the scene and any compute-unit reservation, CR-M3-18).
- OOM → re-dispatch on the `-xl` job (8 CPU / 32 GB instead of 4 / 16). Logs are redacted (signed USGS URLs never appear).
- The GCP budget alarm pauses the pipeline and MTS, never the public site.

## Tests (pytest, ≥ 90 % per file, inside the GDAL test image)

- **Synthetic georeferencing harness** (`pipeline/tests/synthetic/`): a seeded EPSG:3857 reference world (roads, river, parks, noise) served as a COG with HTTP Range behind a mock STAC item; a known ground-truth transform (projective plus panoramic term, optional rotation and mirror, upsample and blur, grain, an "urban change" patch); the scan made by inverse warp, split into overlapping segments, packed like USGS delivers, with metadata corners deliberately offset.
- Assertions: stitch offsets within 1 px, rotation and mirror detected, checkpoint RMSE on held-out points within tolerance, no accepted GCP inside the changed patch, the zoom range per camera, a valid 8-bit COG (`gdalinfo -json`), the MTS recipe shape.
- Property tests with hypothesis (`ci` profile: derandomised, 25 examples). Failure paths: blank scan, no STAC coverage, corrupt archive, expired signed URL, 503 maintenance, SIGTERM, memory guard.
- Determinism: `GDAL_NUM_THREADS=1`, `cv2.setNumThreads(1)`, seeded RNG and RANSAC. Fakes: the USGS M2M server on `127.0.0.1:0`, Firestore and Storage fakes in unit tests, the emulators in integration, the MTS API mocked. Non-loopback sockets are blocked.
- Integration (scenarios P01, P02): `pipeline/tests/integration/` runs `run` against the loopback fakes (`pipeline/tests/fakes/`: documents, Cloud Storage's JSON API, M2M and the delivery host, STAC and Overpass) on synthetic scenes; `S-P01-HAPPY-ADMIN` (`e2e/admin/specs/imagery/pipeline.spec.ts`) runs the real `python -m hcm_pipeline run` of the quality image's venv from the admin's Import, against the Firestore and Storage emulators and the e2e mock APIs (the spec generates the scene into its own folder and points the server's fakes at it).
- Opt-in, local-only `real-data` stage: one known free Corona frame over Bucharest end to end, RMSE reported. Never in CI (public Actions logs would leak signed URLs).

## Wiring into the repository (done in M0)

`pipeline/pyproject.toml` holds the Poetry project and the pipeline's pytest, coverage and mypy configuration; every command runs from the repository root, so `reports/coverage/pipeline.xml` and `reports/junit/pipeline.xml` carry repository-relative paths for Sonar and `scripts/ci/check_coverage.py`. `ruff.toml` already covers every Python file. The quality image carries Poetry (`/opt/hcm/poetry`) and the locked venv (`/opt/hcm/pipeline-venv`); the gates `pipeline-lock`, `pipeline-mypy`, `pipeline-radon`, `pipeline-bandit`, `pipeline-pip-audit` (static) and `pipeline-pytest` (tests) use them. Commands, layout and the re-lock recipe: `pipeline/README.md`; decisions: `docs/research/M0-handoff.md` → *Raster pipeline*.
