"""A part through GDAL: its scan staged, its points or its nodes attached, warped clipped to the window (M8-join-interfaces.md §3).

Warps stay memory-bounded (`WARP_MEMORY_MB`) and stop with the run (`gdal_progress`). A scan is staged only while it is warped,
or while a seam it lies on is measured: on Cloud Run the scratch folder is memory.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Final

import numpy
import numpy.typing

from hcm_pipeline.documents import GeorefInfo
from hcm_pipeline.geo import FloatArray, Grid, MercatorBox, to_mercator
from hcm_pipeline.images import as_uint8
from hcm_pipeline.jobs import JobContext
from hcm_pipeline.join.canvas import COARSE_ZOOM, FINE_ZOOM, DatasetSource, Raster, level_grid
from hcm_pipeline.join.correction import BaseTransform, Mapping, Node
from hcm_pipeline.join.plan import Part
from hcm_pipeline.join.room import out_of_room
from hcm_pipeline.raster import gdal
from hcm_pipeline.rasters import GTIFF_OPTIONS, WEB_MERCATOR, driver_of, srs_wkt
from hcm_pipeline.steps.common import gdal_step
from hcm_pipeline.steps.warp import WARP_MEMORY_MB, cutline, gcp_source, rendered_points, warp_method

FLAT_GROUND: Final = 0.0
DST_SRS: Final = "DST_SRS=EPSG:3857"
FORWARD: Final = 0
REVERSE: Final = 1
TPS_METHOD: Final = ("METHOD=GCP_TPS",)


def node_source(scan: Path, nodes: Sequence[Node], target: Path) -> Path:
    """A VRT of the scan carrying the nodes (their targets in EPSG:3857 metres)."""
    gcps = [gdal.GCP(x, y, FLAT_GROUND, u, v) for u, v, x, y in nodes]
    gdal.Translate(str(target), str(scan), format="VRT", GCPs=gcps, outputSRS="EPSG:3857").Close()
    return target


def _mapping(transformer: gdal.Transformer, to_source: int) -> Mapping:
    def apply(a: FloatArray, b: FloatArray) -> tuple[FloatArray, FloatArray, numpy.typing.NDArray[numpy.bool_]]:
        points, good = transformer.TransformPoints(to_source, numpy.column_stack((a, b)).tolist())
        found = numpy.array(points, numpy.float64).reshape(-1, 3)
        return found[:, 0], found[:, 1], numpy.array(good, numpy.bool_)

    return apply


def _transformer(gcps: Sequence[gdal.GCP], size: tuple[int, int], method: Sequence[str]) -> gdal.Transformer:
    """GDAL's transformer of these points. It reads no pixel, so a band-less dataset holds them and no scan is fetched for it."""
    dataset = driver_of("MEM").Create("", size[0], size[1], 0)
    dataset.SetGCPs(list(gcps), srs_wkt(WEB_MERCATOR))
    return gdal.Transformer(dataset, None, [*method, DST_SRS])


def base_transform(georef: GeorefInfo, size: tuple[int, int]) -> BaseTransform:
    """GDAL's own transforms of the points the part renders through (`rendered_points`), pixel to EPSG:3857 and back: the very ones
    a warp through them uses."""
    gcps = [gdal.GCP(x, y, FLAT_GROUND, column, row) for x, y, column, row in rendered_points(georef, size)]
    transformer = _transformer(gcps, size, TPS_METHOD)
    return BaseTransform(_mapping(transformer, FORWARD), _mapping(transformer, REVERSE), _anchors(georef))


def _anchors(georef: GeorefInfo) -> tuple[tuple[float, float], ...]:
    """A thin-plate part's own points: no grid of samples holds what a spline through them holds."""
    if georef.transform != "tps":
        return ()
    return tuple(to_mercator(gcp.lng, gcp.lat) for gcp in georef.gcps if gcp.enabled)


def node_reverse(nodes: Sequence[Node], size: tuple[int, int]) -> Mapping:
    """What a warp through the nodes runs on: a place to the pixel it reads there."""
    gcps = [gdal.GCP(x, y, FLAT_GROUND, u, v) for u, v, x, y in nodes]
    return _mapping(_transformer(gcps, size, TPS_METHOD), REVERSE)


@dataclass
class Warper:
    """A join's warps of its parts over one box."""

    ctx: JobContext
    box: MercatorBox

    def _bounds(self) -> tuple[float, float, float, float]:
        return self.box.left, self.box.bottom, self.box.right, self.box.top

    def _options(self, part: Part, grid: Grid, method: dict[str, object]) -> dict[str, object]:
        ring = cutline(part.version, self.ctx.local(f"{part.version.id}-crop.geojson"))
        clipped = {key: value for key, value in ring.items() if key != "cropToCutline"}
        return {
            "outputBounds": self._bounds(),
            "dstSRS": "EPSG:3857",
            "xRes": grid.resolution,
            "yRes": grid.resolution,
            "resampleAlg": "bilinear",
            "dstAlpha": True,
            "warpMemoryLimit": WARP_MEMORY_MB,
            **method,
            **clipped,
        }

    def _scan(self, part: Part) -> Path:
        try:
            return self.ctx.stage(part.scan.path, f"{part.version.id}-scan.tif")
        except OSError as error:
            raise out_of_room(part.entity_id, error) from error

    def release(self, part: Part) -> None:
        self.ctx.unstage(part.scan.path)

    def attached(self, part: Part, nodes: Sequence[Node] = ()) -> tuple[Path, dict[str, object]]:
        """The staged scan as a VRT with its nodes (a thin-plate warp) or its own points (its own transform)."""
        scan = self._scan(part)
        target = self.ctx.local(f"{part.version.id}-{'nodes' if nodes else 'gcps'}.vrt")
        if nodes:
            return gdal_step(self.ctx, lambda: node_source(scan, nodes, target), "attach the nodes"), {"tps": True}
        return gdal_step(self.ctx, lambda: gcp_source(scan, part.georef, target), "attach the GCPs"), warp_method(part.georef)

    def preview(self, part: Part, nodes: Sequence[Node] = ()) -> Raster:
        """The part on the coarse level, in memory; its scan is released."""
        grid = level_grid(self.box, COARSE_ZOOM)
        source, method = self.attached(part, nodes)
        options = {**self._options(part, grid, method), "format": "MEM", "callback": self.ctx.flags.gdal_progress}

        def work() -> Raster:
            dataset = gdal.Warp("", str(source), **options)
            grey, alpha = as_uint8(dataset.GetRasterBand(1).ReadAsArray()), as_uint8(dataset.GetRasterBand(2).ReadAsArray())
            dataset.Close()
            return Raster(grid, grey, alpha)

        raster = gdal_step(self.ctx, work, "warp a frame's preview")
        self.release(part)
        return raster

    def fine(self, part: Part) -> DatasetSource:
        """The part on the fine level as a warped VRT: only the tiles read are warped."""
        grid = level_grid(self.box, FINE_ZOOM)
        source, method = self.attached(part)
        target = self.ctx.local(f"{part.version.id}-fine.vrt")
        options = {**self._options(part, grid, method), "format": "VRT"}
        gdal_step(self.ctx, lambda: gdal.Warp(str(target), str(source), **options).Close(), "prepare a frame's fine level")
        return gdal_step(self.ctx, lambda: DatasetSource(target), "open a frame's fine level")

    def rendered(self, part: Part, nodes: Sequence[Node], grid: Grid) -> Path:
        """The part on `grid` as a local file; its scan is released."""
        source, method = self.attached(part, nodes)
        target = self.ctx.local(f"{part.version.id}-warped.tif")
        options = {
            **self._options(part, grid, method),
            "multithread": True,
            "creationOptions": list(GTIFF_OPTIONS),
            "callback": self.ctx.flags.gdal_progress,
        }
        gdal_step(self.ctx, lambda: gdal.Warp(str(target), str(source), **options).Close(), "warp a frame")
        self.release(part)
        return target
