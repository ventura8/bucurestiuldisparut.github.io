"""`pyramid`: the version's own tiles and its small picture (docs/research/M12-own-tiles.md).

256 px WebP at quality 75 with alpha, from the output's minimum to its maximum zoom, packed into one PMTiles archive, uploaded
privately as `rasters/C/L/V/tiles.pmtiles` beside `thumb.webp`, and recorded as `output.tiles`. The approval view reads the archive
before anyone approves; `imagery.publish` copies it to the public bucket after. No Mapbox is involved. An import or a join makes it
from its `warped.tif`; a `layer-tiles` job, for a version rendered before this step existed, from the `cog.tif` that version has
(measured on a real frame: 85 s against 87 s, 174.8 MB against 175.7 MB).
"""

import shutil
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Final

from hcm_pipeline.contract import SIDE_JOB_TYPES, Errors
from hcm_pipeline.geo import Bounds
from hcm_pipeline.jobs import Done, JobContext, StepFailedError, StepResult
from hcm_pipeline.model import DocumentError, bounds_of, number_of
from hcm_pipeline.objects import sha256_of
from hcm_pipeline.raster import gdal
from hcm_pipeline.steps.common import gdal_step
from hcm_pipeline.tiles.pack import ArchiveInfo, Packed, PackError, pack

TILE_SIZE_PX: Final = 256
TILE_QUALITY: Final = 75
THUMB_WIDTH_PX: Final = 320
THUMB_QUALITY: Final = 70
ARCHIVE_TYPE: Final = "application/vnd.pmtiles"
THUMB_TYPE: Final = "image/webp"
RGB_BANDS: Final = 3
RGBA_INTERPRETATION: Final = "red,green,blue,alpha"
THREADS_OPTION: Final = "GDAL_NUM_THREADS"
ALL_CPUS: Final = "ALL_CPUS"


@dataclass(frozen=True)
class Rendered:
    """What the step reads of `output`: the zooms and the bounds, and the COG when the version has one."""

    minzoom: int
    maxzoom: int
    bounds: Bounds
    cog_path: str | None

    @classmethod
    def of(cls, record: Mapping[str, object] | None) -> Rendered:
        output = (record or {}).get("output")
        if not isinstance(output, dict):
            raise StepFailedError(Errors.PROCESSING_FAILED, "the version has no exported output")
        cog = output.get("cogPath")
        return cls(*_zooms_and_bounds(output), cog if isinstance(cog, str) else None)


def _zooms_and_bounds(output: Mapping[str, object]) -> tuple[int, int, Bounds]:
    try:
        return int(number_of(output, "minzoom")), int(number_of(output, "maxzoom")), bounds_of(output.get("bounds"))
    except DocumentError as error:
        raise StepFailedError(Errors.PROCESSING_FAILED, f"the version's output is unreadable: {error}") from error


def _alpha_of(dataset: gdal.Dataset) -> str:
    """The band that says what shows: the warped raster's alpha band, or the COG's mask (JPEG holds no alpha)."""
    last = dataset.RasterCount
    return str(last) if dataset.GetRasterBand(last).GetColorInterpretation() == gdal.GCI_AlphaBand else "mask"


def _band_options(dataset: gdal.Dataset) -> list[str]:
    """RGBA of a grey or a colour layer."""
    alpha = _alpha_of(dataset)
    colours = dataset.RasterCount - (alpha != "mask")
    colour = list(range(1, RGB_BANDS + 1)) if colours >= RGB_BANDS else [1] * RGB_BANDS
    return [option for band in (*map(str, colour), alpha) for option in ("-b", band)]


def rgba_view(source: Path, target: Path) -> Path:
    """A VRT of `source` as RGBA, which the tiler and the picture read."""
    dataset = gdal.Open(str(source))
    gdal.Translate(str(target), dataset, options=["-of", "VRT", *_band_options(dataset), "-colorinterp", RGBA_INTERPRETATION]).Close()
    dataset.Close()
    return target


def write_tree(view: Path, tree: Path, rendered: Rendered, ctx: JobContext) -> Path:
    """The tile pyramid: blank tiles skipped, bilinear at the deepest zoom, averaged above it."""
    arguments: dict[str, object] = {
        "input": str(view),
        "output": str(tree),
        "output-format": "WEBP",
        "creation-option": [f"QUALITY={TILE_QUALITY}"],
        "min-zoom": rendered.minzoom,
        "max-zoom": rendered.maxzoom,
        "tile-size": TILE_SIZE_PX,
        "skip-blank": True,
        "resampling": "bilinear",
        "overview-resampling": "average",
        "webviewer": "none",
        "num-threads": gdal.GetConfigOption(THREADS_OPTION) or ALL_CPUS,
    }
    gdal.Run(["raster", "tile"], arguments=arguments, progress=ctx.flags.gdal_progress)
    return tree


def write_thumb(view: Path, target: Path) -> Path:
    gdal.Translate(
        str(target), str(view), format="WEBP", width=THUMB_WIDTH_PX, height=0, creationOptions=[f"QUALITY={THUMB_QUALITY}"]
    ).Close()
    return target


def _source_of(ctx: JobContext, rendered: Rendered) -> Path:
    if ctx.job.type not in SIDE_JOB_TYPES:
        return ctx.stage(ctx.work_file("warped.tif"), "warped.tif")
    if rendered.cog_path is None:
        raise StepFailedError(Errors.PROCESSING_FAILED, "the version has neither tiles nor a COG to make them from")
    return ctx.stage(rendered.cog_path, "cog.tif")


class PyramidStep:
    name = "pyramid"

    def run(self, ctx: JobContext) -> StepResult:
        rendered = Rendered.of(ctx.read(ctx.version_path()))
        source = _source_of(ctx, rendered)
        view = gdal_step(ctx, lambda: rgba_view(source, ctx.local("rgba.vrt")), "read the rendered layer")
        tree = gdal_step(ctx, lambda: write_tree(view, ctx.local("tree"), rendered, ctx), "make the tiles")
        thumb = gdal_step(ctx, lambda: write_thumb(view, ctx.local("thumb.webp")), "make the picture")
        archive = ctx.local("tiles.pmtiles")
        packed = _packed(tree, archive, ArchiveInfo(ctx.version.layer_id, rendered.bounds, rendered.minzoom, rendered.maxzoom))
        shutil.rmtree(tree)
        sha256 = sha256_of(archive)
        info = ctx.publish(archive, ctx.version_file("tiles.pmtiles"), ARCHIVE_TYPE)
        thumb_info = ctx.publish(thumb, ctx.version_file("thumb.webp"), THUMB_TYPE)
        tiles = {"path": info.path, "bytes": info.size, "count": packed.count, "sha256": sha256, "thumbPath": thumb_info.path}
        ctx.update_version({"output.tiles": tiles})
        return Done(info, sha256)


def _packed(tree: Path, archive: Path, info: ArchiveInfo) -> Packed:
    try:
        return pack(tree, archive, info)
    except PackError as error:
        raise StepFailedError(Errors.PROCESSING_FAILED, str(error)) from error
