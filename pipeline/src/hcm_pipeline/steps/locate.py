"""`locate`: the corner guess and the city crop (docs/research/M3-interfaces.md §5.4).

The scene's corners (else its footprint's extremes) and the eight assignments of the frame's corners to them,
scored against the Sentinel-2 window at 60 m (`georef/corners.py`); the best one maps the city window (bounds plus
10 %) back into the frame: that crop is `scan.tif`, with its preview and four corner GCPs (`method: 'corners'`)
that start the georeferencing. A frame that does not cover the window fails with
`apiError.imagery.referenceUnavailable`.
"""

import math
from pathlib import Path
from typing import Final

from hcm_pipeline.contract import Errors
from hcm_pipeline.documents import GeorefInfo, Scene
from hcm_pipeline.geo import Grid, MercatorBox, to_mercator
from hcm_pipeline.georef.corners import SCORE_RESOLUTION_M, Crop, Frame, WindowMissedError, best_assignment, crop
from hcm_pipeline.images import UInt8Array, resize
from hcm_pipeline.jobs import Done, JobContext, StepFailedError, StepResult
from hcm_pipeline.model import UsgsImportParams
from hcm_pipeline.rasters import GeoTiff, raster_info, read_band, to_uint8, write_geotiff
from hcm_pipeline.steps.common import city_window, gdal_step, grey_reference, publish_scan, sentinel2

# The frame is shrunk until a pixel is about this many metres before it is scored at 60 m.
SCORING_PIXEL_M: Final = 30.0


def _scene(ctx: JobContext, entity: UsgsImportParams) -> Scene:
    record = ctx.read(f"cities/{ctx.city}/usgsScenes/{entity.entity_id}")
    if record is None:
        raise StepFailedError(Errors.NOT_FOUND, f"the scene {entity.entity_id} is not harvested")
    return Scene.of(entity.entity_id, record)


def _frame_pixel_m(scene: Scene, width: int) -> float:
    """The frame's approximate pixel size in EPSG:3857 metres, from its corners."""
    (nw_lat, nw_lng), (ne_lat, ne_lng), _, _ = scene.corner_quad()
    (x0, y0), (x1, y1) = to_mercator(nw_lng, nw_lat), to_mercator(ne_lng, ne_lat)
    return max(math.hypot(x1 - x0, y1 - y0) / width, 1e-3)


def scoring_frame(path: Path, width: int, height: int, pixel_m: float) -> Frame:
    """The frame read by GDAL shrunk to about `SCORING_PIXEL_M` per pixel."""
    factor = max(1.0, SCORING_PIXEL_M / pixel_m)
    size = (max(1, round(width / factor)), max(1, round(height / factor)))
    pixels = to_uint8(read_band(path, 1, size))
    return Frame(pixels, width / size[0], width, height)


def _crop_pixels(frame_path: Path, box: Crop) -> UInt8Array:
    whole = to_uint8(read_band(frame_path))
    return whole[box.top : box.top + box.height, box.left : box.left + box.width]


class LocateStep:
    name = "locate"

    def run(self, ctx: JobContext) -> StepResult:
        entity = UsgsImportParams.of(ctx.job.params)
        scene = _scene(ctx, entity)
        window = city_window(ctx)
        frame_path = ctx.stage(ctx.work_file("frame.tif"), "frame.tif")
        info = gdal_step(ctx, lambda: raster_info(frame_path), "read the frame")
        located = self._located(ctx, scene, window, frame_path, (info.width, info.height))
        pixels = gdal_step(ctx, lambda: _crop_pixels(frame_path, located), "crop the frame")
        scan = publish_scan(ctx, write_geotiff(ctx.local("scan.tif"), GeoTiff([pixels])), pixels)
        georef = GeorefInfo("corners", "affine", located.gcps)
        ctx.update_version({"scan": scan.as_record(), "georef": georef.as_record()})
        return Done(ctx.services.objects.stat(scan.path), scan.sha256)

    def _located(self, ctx: JobContext, scene: Scene, window: MercatorBox, frame_path: Path, size: tuple[int, int]) -> Crop:
        grid = Grid.over(window, SCORE_RESOLUTION_M)
        reference = resize(grey_reference(sentinel2(ctx, window)), (grid.width, grid.height))
        frame = scoring_frame(frame_path, *size, _frame_pixel_m(scene, size[0]))
        try:
            best, score = best_assignment(frame, scene.corner_quad(), reference, grid)
            located = crop(best, window, *size)
        except WindowMissedError as error:
            raise StepFailedError(Errors.REFERENCE_UNAVAILABLE, str(error)) from error
        mirror = ", mirrored" if best.mirrored else ""
        ctx.log.info(f"corner guess: rotation {best.rotation * 90} degrees{mirror}, correlation {score:.2f}", self.name)
        return located
