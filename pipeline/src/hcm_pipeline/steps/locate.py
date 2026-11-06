"""`locate`: the corner guess and the city crop (docs/research/M3-interfaces.md §5.4).

The scene's corners (else its footprint's extremes) and the eight assignments of the frame's corners to them, scored against the
Sentinel-2 window at 60 m (`georef/corners.py`); the best one maps the city window (bounds plus 10 %) back into the frame: that
crop is `scan.tif`, with its preview and four corner GCPs (`method: 'corners'`) that start the georeferencing. A frame that does
not cover the window fails with `apiError.imagery.cityNotFound`; a panoramic camera's frame is scored and cropped on its exposure
alone. Findings 62 and 63 of 2026-11-02: only assignments whose ground pixels are about square are scored, a guess under the least
correlation is searched around a widened window; a crop with a side over `MAX_SCAN_PIXELS` fails before it is read
(`georef/corners.py`). Lesson 361: a camera with a half angle starts from the panoramic model, and a guess nothing accepts is no
failure: the crop holds every orientation that reaches the window, each with a wide margin (over `MAX_SCAN_PIXELS`: a failure that
keeps the delivery), its corners only start the matcher (`weakCorners`), and `georef` ends waiting for the admin's points
(`needs_gcps`). Finding 57 of 2026-11-01: the frame is never read whole; the guess scores `stitch`'s shrunk preview, and the crop
is read window by window out of the segments that cover it (`frame.json`), each staged, read and let go in turn. M7
(`docs/research/M7-local-worker.md` §5): once `scan.tif` and the version's `scan` are recorded, the job's USGS delivery is deleted
(and logged), unless the guess is weak: a crop nothing confirmed is the one thing a new look at the frame could need it for; a
later run needs it no more (`runner.py`).
"""

import math
from pathlib import Path
from typing import Final

import cv2
import numpy

from hcm_pipeline.contract import MAX_SCAN_PIXELS, SENSOR_SPECS, Errors
from hcm_pipeline.documents import GeorefInfo, Scene
from hcm_pipeline.frames import FRAME_JSON, FRAME_PREVIEW, FrameLayout, Segment
from hcm_pipeline.geo import Grid, MercatorBox, to_mercator
from hcm_pipeline.georef.corners import (
    SCORE_RESOLUTION_M,
    WEAK_CROP_MARGIN_M,
    CityNotFoundError,
    Crop,
    Frame,
    Guess,
    crop,
    guess_corners,
    weak_crop,
)
from hcm_pipeline.georef.panoramic import PanoramicCamera
from hcm_pipeline.images import UInt8Array, as_uint8, resize
from hcm_pipeline.jobs import Done, JobContext, StepFailedError, StepResult
from hcm_pipeline.model import UsgsImportParams
from hcm_pipeline.rasters import GeoTiff, read_band, to_uint8, write_geotiff
from hcm_pipeline.steps.common import city_window, gdal_step, grey_reference, publish_scan, sentinel2

# The frame is shrunk until a pixel is about this many metres before it is scored at 60 m.
SCORING_PIXEL_M: Final = 30.0
# The frame's blur before it is warped (in its own cells): to about the 60 m it is scored at. On the 1972 KH-9 frame's true place
# the raw correlation went from 0.167 to 0.180.
SCORING_BLUR_CELLS: Final = 1.0
# The step whose output is the USGS delivery, and the prefix every delivery lives under (`paths.usgs_raw`).
DELIVERY_STEP: Final = "fetch"
USGS_RAW_PREFIX: Final = "usgs-raw/"


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


def scoring_frame(preview: Path, width: int, height: int, pixel_m: float) -> Frame:
    """The frame (`width` by `height` at full resolution) from its preview, averaged to about `SCORING_PIXEL_M` per pixel and
    blurred. Never enlarged: it holds nothing the preview does not, and a side over 32 767 pixels is more than `cv2.remap` takes
    (a KH-9 frame over 2 m a pixel by its corners would be: its corners' pixel is the whole frame's mean, not the nadir's)."""
    pixels = to_uint8(read_band(preview, 1))
    factor = max(1.0, SCORING_PIXEL_M / pixel_m)
    size = (max(1, round(width / factor)), max(1, round(height / factor)))
    shrunk = resize(pixels, size) if size[0] < pixels.shape[1] else pixels
    blurred = as_uint8(cv2.GaussianBlur(shrunk, (0, 0), SCORING_BLUR_CELLS))
    return Frame(blurred, width / blurred.shape[1], width, height)


def camera_of(sensor: str, layout: FrameLayout) -> PanoramicCamera | None:
    """The panoramic model's camera when the sensor has a half angle; the exposure's span from `stitch`'s `exposure_span`."""
    half_angle = SENSOR_SPECS[sensor].half_angle_deg
    return None if half_angle is None else PanoramicCamera(half_angle, layout.image_width, layout.image_start)


def film_limits(camera: PanoramicCamera | None, layout: FrameLayout) -> tuple[int, int, int]:
    """What a crop may hold: up to this column, up to this row, from this column (a panoramic camera's frame: its exposure)."""
    return (
        (layout.width, layout.height, 0) if camera is None else (camera.image_start + camera.image_width, layout.height, camera.image_start)
    )


def crop_pixels(ctx: JobContext, layout: FrameLayout, box: Crop) -> UInt8Array:
    """The frame's pixels in `box`, read from the segments that cover it, one at a time (a later one on top)."""
    window = (box.left, box.top, box.width, box.height)
    pixels = numpy.zeros((box.height, box.width), numpy.uint8)
    for placement in layout.covering(window):
        x, y, width, height = placement.window(window) or window
        segment = Segment(ctx.stage(placement.path))
        part = segment.read(x - placement.x, y - placement.y, width, height)
        pixels[y - box.top : y - box.top + height, x - box.left : x - box.left + width] = part
        segment.close()
        ctx.unstage(placement.path)
        ctx.checkpoint()
    return as_uint8(pixels)


def delete_delivery(ctx: JobContext) -> None:
    """The job's USGS delivery deleted once the city crop and the version's scan are recorded (M7 §5): only a
    `usgs-raw/` object, a missing one is fine (a retry of `locate`, or another city's job deleted it first)."""
    delivery = ctx.job.step(DELIVERY_STEP).gcs_path
    if delivery is None or not delivery.startswith(USGS_RAW_PREFIX):
        return
    ctx.services.objects.delete(delivery)
    ctx.log.info(f"the USGS delivery {delivery} is deleted: the city crop is recorded", LocateStep.name)


class LocateStep:
    name = "locate"

    def run(self, ctx: JobContext) -> StepResult:
        entity = UsgsImportParams.of(ctx.job.params)
        scene = _scene(ctx, entity)
        window = city_window(ctx)
        layout = FrameLayout.from_json(ctx.stage(ctx.work_file(FRAME_JSON), FRAME_JSON).read_text(encoding="utf-8"))
        preview = ctx.stage(ctx.work_file(FRAME_PREVIEW), FRAME_PREVIEW)
        located = self._located(ctx, (scene, entity.sensor), window, preview, layout)
        pixels = gdal_step(ctx, lambda: crop_pixels(ctx, layout, located), "crop the frame")
        scan = publish_scan(ctx, write_geotiff(ctx.local("scan.tif"), GeoTiff([pixels])), pixels)
        georef = GeorefInfo("corners", "affine", located.gcps, weak_corners=located.weak)
        ctx.update_version({"scan": scan.as_record(), "georef": georef.as_record()})
        if not located.weak:
            delete_delivery(ctx)
        return Done(ctx.services.objects.stat(scan.path), scan.sha256)

    def _located(self, ctx: JobContext, shot: tuple[Scene, str], window: MercatorBox, preview: Path, layout: FrameLayout) -> Crop:
        scene, sensor = shot
        size = (layout.width, layout.height)
        grid = Grid.over(window, SCORE_RESOLUTION_M)
        reference = resize(grey_reference(sentinel2(ctx, window)), (grid.width, grid.height))
        frame = gdal_step(ctx, lambda: scoring_frame(preview, *size, _frame_pixel_m(scene, size[0])), "read the frame")
        try:
            camera = camera_of(sensor, layout)
            guess = guess_corners(frame, scene.corner_quad(), reference, grid, camera)
            limits = film_limits(camera, layout)
            located = weak_crop(guess, window, *limits) if guess.weak else crop(guess.assignment, window, *limits)
        except CityNotFoundError as error:
            raise StepFailedError(Errors.CITY_NOT_FOUND, str(error)) from error
        ctx.log.info(guess_line(guess), self.name)
        checked = within_limits(located)
        if guess.weak:
            ctx.log.warn(weak_line(checked), self.name)
        return checked


def guess_line(guess: Guess) -> str:
    """The log line of the corner guess kept: its rotation, mirror, correlation, the share of the window the frame covers, how
    far the search moved it and the search's evidence."""
    mirror = ", mirrored" if guess.assignment.mirrored else ""
    covers = f", the frame covers {guess.coverage:.0%} of the window"
    moved = f", moved {guess.moved_m / 1000:.1f} km by the search around the window" if guess.moved_m > 0 else ""
    found = guess.surface
    evidence = (
        "" if found is None else f", search peak {found.peak:.3f}, second {found.second:.3f}, ratio {found.ratio:.2f}, z {found.z:.1f}"
    )
    return (
        f"corner guess: rotation {guess.assignment.rotation * 90} degrees{mirror}, correlation {guess.score:.2f}{covers}{moved}{evidence}"
    )


def weak_line(located: Crop) -> str:
    """The log line of a guess nothing confirmed: why the crop is this large, and what happens next."""
    margin = f"{WEAK_CROP_MARGIN_M / 1000:.0f} km"
    return (
        f"the guess is weak: nothing confirms where the city lies on this frame. The crop ({located.width} x {located.height} pixels) "
        f"keeps a {margin} margin around where the corners put it under every orientation that reaches it, and the delivery stays; "
        "if the matching finds too few pairs, the admin places the points"
    )


def within_limits(located: Crop) -> Crop:
    """The crop, refused before it is read when a side is over `MAX_SCAN_PIXELS`: a version's scan is never larger
    (`scanSchema`; finding 62 of 2026-11-02: a 300 000-pixel crop made the version unreadable in the admin)."""
    if max(located.width, located.height) > MAX_SCAN_PIXELS:
        why = f"the city crop would be {located.width} x {located.height} pixels, over the {MAX_SCAN_PIXELS} a scan may have"
        raise StepFailedError(Errors.PROCESSING_FAILED, why)
    return located
