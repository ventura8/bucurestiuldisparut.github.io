"""Historic City Map raster pipeline, run as Cloud Run Jobs: `python -m hcm_pipeline <step>`.

Steps are short, idempotent and resumable (docs/research/PLAN.md, "Raster pipeline"): fetch from USGS
M2M, locate/crop, georeference, warp, export and publish to Mapbox MTS. GDAL comes from the pinned
ghcr.io/osgeo/gdal base image (`osgeo.gdal`), never from a wheel.
"""

__version__ = "0.0.0"
