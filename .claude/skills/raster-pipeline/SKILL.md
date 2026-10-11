---
name: raster-pipeline
description: Build, test or debug the Historic City Map raster pipeline (pipeline/src/hcm_pipeline, Python 3.14 with osgeo.gdal from the pinned GDAL image, Poetry) that fetches declassified USGS scans over M2M, crops, georeferences against OSM and Sentinel-2 (never Mapbox Satellite), warps to EPSG 3857, exports COGs and publishes to Mapbox MTS only after approval and within the compute-unit guard, as a resumable Cloud Run Job. Use for any pipeline, georeferencing, USGS or Mapbox publishing task.
---

# Raster Pipeline Skill

Working notes: `.agent/skills/pipeline/raster_pipeline_skill.md`, `.agent/skills/pipeline/usgs_m2m_skill.md`, `.agent/skills/pipeline/mapbox_publishing_skill.md`. Status: the package is scaffolded (configuration, logging, M2M client, doctor step, fakes, synthetic world); the processing steps arrive in M3.

## Commands

```bash
PIPELINE_STAGE=tests bash scripts/ci/run-all-checks.sh   # the test stage; the pipeline's pytest gate runs pipeline/tests
python3 scripts/ci/pipeline.py --list                    # which gates exist today
```

## Must know

- `osgeo.gdal` comes from `ghcr.io/osgeo/gdal:ubuntu-small-3.13.3` pinned by digest; Python 3.14, so `requires-python = ">=3.14,<3.15"`; no rasterio wheels, no pip GDAL; the venv uses `--system-site-packages`.
- Steps are short, idempotent and resumable: fetch, locate and crop, georef, warp, export, publish. The task exits while it waits on USGS or MTS; `ops.tick` resumes it.
- The georeferencing reference is OSM plus Sentinel-2. **Mapbox Satellite is never used to align imagery.** No `fostulbucuresti` resource is ever used.
- MTS publishes only after approval (or auto below the RMSE threshold) and within the compute-unit guard; over budget it offers the free Studio upload, deferral, or paying.
- Tests: the synthetic world and scan harness with a known transform, held-out checkpoint RMSE, hypothesis in a derandomised profile, the fake M2M server on loopback, deterministic threads and seeds; 90 % per file.
- USGS errors arrive with any status: JSON 500 `errorCode`, HTML 403 for a bad token, 503 HTML for maintenance (backoff, not failure). Signed URLs are redacted everywhere and the pipeline never runs in GitHub Actions.
- The budget alarm pauses the pipeline and MTS, never the site.
