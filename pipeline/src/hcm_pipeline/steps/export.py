"""`export`: the COG Mapbox gets, the admin's preview and the Studio file (docs/research/M3-interfaces.md §5.3).

An 8-bit COG (`COMPRESS=JPEG`, `QUALITY=85`, 512 px blocks, overviews; the alpha band becomes a mask, which JPEG
needs), an RGBA PNG preview of at most 2048 px, and a JPEG-compressed GeoTIFF of at most `STUDIO_MAX_BYTES`
(halved until it fits) for the free Mapbox Studio upload. The valid area in km² (the alpha's share of the
extent, on the ground) feeds the compute-unit estimate. The version's `output` records all of it.
"""

import math
from dataclasses import dataclass
from pathlib import Path
from typing import Final

import numpy

from hcm_pipeline.contract import STUDIO_MAX_BYTES
from hcm_pipeline.documents import OutputInfo
from hcm_pipeline.geo import ZOOM0_RESOLUTION_M, Grid, ground_scale
from hcm_pipeline.jobs import Done, JobContext, StepResult
from hcm_pipeline.objects import sha256_of
from hcm_pipeline.raster import gdal
from hcm_pipeline.rasters import fit_long_side, raster_info, read_band
from hcm_pipeline.steps.common import gdal_step
from hcm_pipeline.steps.warp import zooms

COG_OPTIONS: Final = ("COMPRESS=JPEG", "QUALITY=85", "BLOCKSIZE=512", "OVERVIEWS=AUTO")
STUDIO_OPTIONS: Final = ("COMPRESS=JPEG", "JPEG_QUALITY=85", "TILED=YES", "BIGTIFF=IF_SAFER")
PREVIEW_MAX_PX: Final = 2048
AREA_SAMPLE_PX: Final = 2048
STUDIO_HALVINGS: Final = 6
SQUARE_METRES_PER_KM2: Final = 1e6


@dataclass(frozen=True)
class Warped:
    """The warped raster's grid and bands (colour bands, then the alpha band last)."""

    path: Path
    grid: Grid
    bands: int

    @classmethod
    def of(cls, path: Path) -> Warped:
        info = raster_info(path)
        left, resolution, _, top, _, _ = info.geotransform or (0.0, 1.0, 0.0, 0.0, 0.0, -1.0)
        return cls(path, Grid(left, top, resolution, info.width, info.height), info.bands)

    @property
    def colour(self) -> list[int]:
        return list(range(1, self.bands))

    @property
    def zoom(self) -> int:
        return round(math.log2(ZOOM0_RESOLUTION_M / self.grid.resolution))


def write_cog(warped: Warped, target: Path) -> Path:
    gdal.Translate(str(target), str(warped.path), format="COG", creationOptions=list(COG_OPTIONS)).Close()
    return target


def write_preview(warped: Warped, target: Path) -> Path:
    """An RGBA PNG (a grey layer repeats its band three times), the long side at most 2048 px."""
    width, height, _ = fit_long_side(warped.grid.width, warped.grid.height, PREVIEW_MAX_PX)
    colour = warped.colour if len(warped.colour) >= len("rgb") else warped.colour * len("rgb")
    gdal.Translate(str(target), str(warped.path), format="PNG", bandList=[*colour[:3], warped.bands], width=width, height=height).Close()
    return target


def write_studio(warped: Warped, target: Path, max_bytes: int = STUDIO_MAX_BYTES) -> Path | None:
    """A JPEG-compressed GeoTIFF of at most `max_bytes`, halved until it fits (None when even 1/64 does not)."""
    for halving in range(STUDIO_HALVINGS):
        percent = 100.0 / 2**halving
        options = {"bandList": warped.colour, "maskBand": warped.bands, "widthPct": percent, "heightPct": percent}
        gdal.Translate(str(target), str(warped.path), format="GTiff", creationOptions=list(STUDIO_OPTIONS), **options).Close()
        if target.stat().st_size <= max_bytes:
            return target
    return None


def valid_area_km2(warped: Warped) -> float:
    """The ground area under the alpha band, km² (sampled at most 2048 px a side)."""
    width, height, scale = fit_long_side(warped.grid.width, warped.grid.height, AREA_SAMPLE_PX)
    alpha = read_band(warped.path, warped.bands, (width, height))
    pixel_area = (warped.grid.resolution / scale) ** 2
    middle = warped.grid.box().bounds().middle_lat
    return float(numpy.count_nonzero(alpha)) * pixel_area * ground_scale(middle) ** 2 / SQUARE_METRES_PER_KM2


class ExportStep:
    name = "export"

    def __init__(self, studio_max_bytes: int = STUDIO_MAX_BYTES) -> None:
        self._studio_max_bytes = studio_max_bytes

    def run(self, ctx: JobContext) -> StepResult:
        warped = gdal_step(ctx, lambda: Warped.of(ctx.stage(ctx.work_file("warped.tif"), "warped.tif")), "read the warped layer")
        cog = gdal_step(ctx, lambda: write_cog(warped, ctx.local("cog.tif")), "write the COG")
        preview = gdal_step(ctx, lambda: write_preview(warped, ctx.local("preview.png")), "write the preview")
        studio = gdal_step(ctx, lambda: write_studio(warped, ctx.local("studio.tif"), self._studio_max_bytes), "write the Studio file")
        cog_sha256 = sha256_of(cog)
        cog_info = ctx.publish(cog, ctx.version_file("cog.tif"), "image/tiff")
        preview_path = ctx.publish(preview, ctx.version_file("preview.png"), "image/png").path
        studio_info = None if studio is None else ctx.publish(studio, ctx.version_file("studio.tif"), "image/tiff")
        minzoom, maxzoom = zooms(ctx.version, warped.zoom)
        output = OutputInfo(
            cog_path=cog_info.path,
            cog_bytes=cog_info.size,
            cog_sha256=cog_sha256,
            preview_path=preview_path,
            bounds=warped.grid.box().bounds(),
            minzoom=minzoom,
            maxzoom=maxzoom,
            area_km2=valid_area_km2(warped),
            studio_path=None if studio_info is None else studio_info.path,
            studio_bytes=None if studio_info is None else studio_info.size,
        )
        ctx.update_version({"output": output.as_record()})
        return Done(cog_info, cog_sha256)
