"""Historic City Map raster pipeline, run as Cloud Run Jobs: `python -m hcm_pipeline run`.

Steps are short, idempotent and resumable (docs/research/M3-interfaces.md §5): fetch from USGS M2M,
extract, stitch, inspect, locate, reference, georeference, warp, export and register a layer version for
approval; functions publish it to Mapbox afterwards. GDAL comes from the pinned ghcr.io/osgeo/gdal base
image (`osgeo.gdal`), never from a wheel.
"""

__version__ = "0.0.0"
