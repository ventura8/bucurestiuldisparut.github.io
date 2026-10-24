"""`warp`: the scan to EPSG:3857 on the tile grid (docs/research/M3-interfaces.md §5.3).

`gdalwarp` with the version's enabled GCPs in EPSG:3857 metres (`-order 1` for affine, `-order 2` for poly2, `-tps`),
or with the upload's own georeference; the resolution of the layer's `maxzoom` (156543.03392804097 / 2^z m, the
camera's from `SENSOR_SPECS`, else the scan's own resolution rounded to a zoom), pixels aligned on the tile grid,
bilinear, an alpha band, and `-cutline` with `-crop_to_cutline` when the version has a crop ring.
"""

import json
import math
from pathlib import Path
from typing import Final

from hcm_pipeline.contract import SENSOR_SPECS, Errors
from hcm_pipeline.documents import GeorefInfo, Version
from hcm_pipeline.geo import ZOOM0_RESOLUTION_M, to_mercator, zoom_resolution
from hcm_pipeline.jobs import Done, JobContext, StepFailedError, StepResult
from hcm_pipeline.raster import gdal
from hcm_pipeline.rasters import GTIFF_OPTIONS
from hcm_pipeline.steps.common import gdal_step

DEFAULT_MINZOOM: Final = 10
MAX_UPLOAD_ZOOM: Final = 18
POLYNOMIAL_ORDER: Final = {"affine": 1, "poly2": 2}
WARP_MEMORY_MB: Final = 2048


def gcp_source(scan: Path, georef: GeorefInfo, target: Path) -> Path:
    """A VRT of the scan carrying the enabled GCPs in EPSG:3857 metres."""
    gcps = [gdal.GCP(*to_mercator(gcp.lng, gcp.lat), 0.0, gcp.x, gcp.y) for gcp in georef.gcps if gcp.enabled]
    gdal.Translate(str(target), str(scan), format="VRT", GCPs=gcps, outputSRS="EPSG:3857").Close()
    return target


def _method(georef: GeorefInfo) -> dict[str, object]:
    if georef.method == "embedded":
        return {}
    return {"tps": True} if georef.transform == "tps" else {"polynomialOrder": POLYNOMIAL_ORDER[georef.transform]}


def native_zoom(source: Path, method: dict[str, object], probe: Path) -> int:
    """The zoom whose resolution is closest to the source's own once warped (a VRT: nothing is resampled)."""
    dataset = gdal.Warp(str(probe), str(source), format="VRT", dstSRS="EPSG:3857", **method)
    resolution = abs(dataset.GetGeoTransform()[1])
    dataset.Close()
    return max(DEFAULT_MINZOOM, min(MAX_UPLOAD_ZOOM, round(math.log2(ZOOM0_RESOLUTION_M / resolution))))


def zooms(version: Version, native: int) -> tuple[int, int]:
    """The layer's (minzoom, maxzoom): the camera's, else from the scan's resolution."""
    spec = SENSOR_SPECS.get(version.sensor or "")
    return (spec.minzoom, spec.maxzoom) if spec is not None else (DEFAULT_MINZOOM, native)


def cutline(version: Version, target: Path) -> dict[str, object]:
    """`gdalwarp -cutline -crop_to_cutline` options for the version's crop ring (a closed GeoJSON polygon in WGS84)."""
    if not version.crop:
        return {}
    ring = [[lng, lat] for lat, lng in version.crop]
    polygon = {"type": "Polygon", "coordinates": [[*ring, ring[0]]]}
    target.write_text(json.dumps({"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {}, "geometry": polygon}]}))
    return {"cutlineDSName": str(target), "cutlineSRS": "EPSG:4326", "cropToCutline": True}


class WarpStep:
    name = "warp"

    def run(self, ctx: JobContext) -> StepResult:
        version = ctx.version
        if version.scan is None or version.georef is None:
            raise StepFailedError(Errors.NO_SCAN, "the version has no georeferenced scan")
        scan = ctx.stage(version.scan.path, "scan.tif")
        georef = version.georef
        source = (
            scan
            if georef.method == "embedded"
            else gdal_step(ctx, lambda: gcp_source(scan, georef, ctx.local("scan-gcps.vrt")), "attach the GCPs")
        )
        method = _method(georef)
        native = gdal_step(ctx, lambda: native_zoom(source, method, ctx.local("probe.vrt")), "measure the scan")
        _, maxzoom = zooms(version, native)
        warped = ctx.local("warped.tif")
        resolution = zoom_resolution(maxzoom)
        options = {
            "dstSRS": "EPSG:3857",
            "xRes": resolution,
            "yRes": resolution,
            "targetAlignedPixels": True,
            "resampleAlg": "bilinear",
            "dstAlpha": True,
            "multithread": True,
            "warpMemoryLimit": WARP_MEMORY_MB,
            "creationOptions": list(GTIFF_OPTIONS),
            "callback": ctx.flags.gdal_progress,
            **method,
            **cutline(version, ctx.local("cutline.geojson")),
        }
        gdal_step(ctx, lambda: gdal.Warp(str(warped), str(source), **options).Close(), "warp the scan")
        return Done(ctx.publish(warped, ctx.work_file("warped.tif"), "image/tiff"))
