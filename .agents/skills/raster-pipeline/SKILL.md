---
name: raster-pipeline
description: Build, test or debug the Historic City Map raster pipeline (pipeline/src/hcm_pipeline, Python 3.14 with osgeo.gdal from the pinned GDAL image, Poetry) that fetches declassified USGS scans over M2M, crops, georeferences against OSM and Sentinel-2 (never Mapbox Satellite), warps to EPSG 3857, exports COGs and publishes to Mapbox MTS only after approval and within the compute-unit guard, as a resumable Cloud Run Job. Use for any pipeline, georeferencing, USGS or Mapbox publishing task.
---

# Raster Pipeline Skill

Working notes: `.agent/skills/pipeline/raster_pipeline_skill.md`, `.agent/skills/pipeline/usgs_m2m_skill.md`, `.agent/skills/pipeline/mapbox_publishing_skill.md`. Status (M3, 2026-10-24): every step of `python -m hcm_pipeline run` is built and tested against loopback fakes and synthetic scenes, and ran once under the admin e2e tier against the emulators (`S-P01-HAPPY-ADMIN`); the contract and the as-built notes are `docs/research/M3-interfaces.md` §5 and CR-M3-19; what waits for the real cloud: `docs/research/M3-status.md`.

## Commands

```bash
PIPELINE_STAGE=tests bash scripts/ci/run-all-checks.sh   # the test stage; the pipeline's pytest gate runs pipeline/tests
python3 scripts/ci/pipeline.py --list                    # which gates exist today
# one synthetic scene with a known transform (delivery .tgz, Sentinel-2 COG, Overpass lines, truth.json), in the image:
docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp/h -v "$PWD:$PWD" -w "$PWD" hcm-quality:local \
  bash -c 'PYTHONPATH=pipeline/src /opt/hcm/pipeline-venv/bin/python pipeline/tests/synthetic/scenes.py --out reports/scene --seed 7'
# the real pipeline under the admin e2e tier (the emulators, the mock USGS, STAC and Overpass):
docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp/h -e E2E_TIER=admin -v "$PWD:$PWD" -w "$PWD" hcm-quality:local \
  bash -c 'mkdir -p $HOME && npm run build:site:e2e && cd e2e && npx playwright test admin/specs/imagery/pipeline.spec.ts --project admin-l1440-ro'
```

## Must know

- `osgeo.gdal` comes from `ghcr.io/osgeo/gdal:ubuntu-small-3.13.3` pinned by digest; Python 3.14, so `requires-python = ">=3.14,<3.15"`; no rasterio wheels, no pip GDAL; the venv uses `--system-site-packages`.
- Steps are short, idempotent and resumable: `fetch`, `extract`, `stitch`, `inspect`, `locate`, `reference`, `georef`, `warp`, `export`, `register` (`JOB_STEPS` of `@hcm/shared`), run in order by `python -m hcm_pipeline run`. The task exits while it waits on USGS or the admin's points; `imagery.tick` resumes it. Publishing to MTS is not the pipeline's: functions publish after approval (the pipeline holds no Mapbox secret).
- What it writes (job, step records, layer versions, log lines) must equal the golden documents of `pipeline/tests/contracts/`, which the shared TypeScript schemas also validate; its paths equal `paths.json`, its transforms reproduce `georef-cases.json`, its constants equal `enums.json`.
- The georeferencing reference is OSM plus Sentinel-2. **Mapbox Satellite is never used to align imagery.** No `fostulbucuresti` resource is ever used.
- MTS publishes (functions' `imagery.publish`) only after approval (or auto below the city's RMSE threshold, default 15 m) and within the compute-unit guard; over budget the admin chooses the free Studio upload, next month, or paying.
- Tests: the synthetic world and scan harness with a known transform, held-out checkpoint RMSE, hypothesis in a derandomised profile, the fake M2M server on loopback, deterministic threads and seeds; 90 % per file, lines and branches each (a `for` that can end without its `return` is a branch: test the exhausted loop).
- As built (CR-M3-19): `locate` fetches the Sentinel-2 window (the corner guess scores against it) and `reference` reuses it, so a USGS import without a STAC item fails at `locate`; Firestore writes are compare-and-set on the read's update time (five tries), Cloud Storage is its JSON API over httpx (`google-cloud-storage` is unused); OSM is cached, drawn for the georeferencer and, since M4, a matching channel of `georef` (below); every client follows no redirect except the USGS delivery, each hop through the address guard.
- Under the emulators (`FIRESTORE_EMULATOR_HOST` or `STORAGE_EMULATOR_HOST` set) the pipeline is sealed: every service root and every address from data must be on this machine (`check_emulated_url`), and `EmulatorSecrets` answers the shared fakes' USGS user of the scenario (`e2e-ok` with `e2e-usgs-app-token-ok`); a fake that hands it an address hands a loopback one (`docs/LESSONS.md` 164, 165). Error parameters are texts (`{pairs}` as `"7"`).
- A step re-reads the job before it starts (a resumed run must not trust the launching run's copy), and the stitch template is narrower than the segments' overlap (`docs/LESSONS.md` 160).
- USGS errors arrive with any status: JSON 500 `errorCode`, HTML 403 for a bad token, 503 HTML for maintenance (backoff, not failure). Signed URLs are redacted everywhere and the pipeline never runs in GitHub Actions.
- The budget alarm pauses the pipeline and MTS, never the site; an admin resumes it from the Imagery or Jobs banner (`imagery.resumeGuard`, for the budget period).
- The publisher never pays twice (CR-M3-47, `docs/LESSONS.md` 171–174): a start with an MTS job polls it, the upload is skipped when the same file went up, the publish call is marked in a transaction before it (a retry lists the tileset's jobs), every start counts `publishAttempts` (at most `PUBLISH_MAX_ATTEMPTS`), the tick's recovery id is `stale-<job's last write>`; a 413 goes back to the admin with only the Studio way; the tileset cap counts in-flight first publishes and pending deletions. A queued `layer-delete` keeps its layer id until it runs.
- A GDAL failure on the pipeline's own files is `apiError.imagery.processingFailed`; only reading an admin's upload (`inspect`) is `unreadableRaster` (`gdal_step(..., code)`).
- M4 (contract: `docs/research/M4-interfaces.md` §2, autogcp): `georef` adds an ORB fallback, OpenStreetMap's lines as a distance-field channel matched tile by tile, a confidence (`score`) and a residual per pair and held-out checkpoints (a fifth from 15 confident pairs); pairs from `AUTO_GCP_MIN_CONFIDENCE` (0.6) join the fit, lower ones are the version's `suggestions`, which only the admin's Accept and Save put into a georeference. Constants and golden shape: `pipeline/tests/contracts/autogcp.json`, `version.needs-gcps.suggestions.json` (`packages/shared/src/schemas/autogcp.ts`). As built (CR-M4-18): the OSM channel compares the white and black top-hat of the CLAHE'd pre-warped scan (lines up to 150 m wide) with OSM's proximity field, not Canny's edges (155 m off on the synthetic world, against 13 m: `docs/LESSONS.md` 194); a tile's margin is its peak minus the next local maximum outside the peak's 3 × 3 neighbourhood; OpenCV 5's `estimateAffine2D` returns no model for collinear points and NaNs for coincident ones, so both are checked. The e2e stand-in's outcome `suggestions` writes the golden shape (`e2e/admin/support/imagery-standin.ts`).
