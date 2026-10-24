"""`stitch`: the segments mosaicked into one frame, its film border cropped (docs/research/M3-interfaces.md §5.3).

USGS scans a long film frame in overlapping parts (`_a` to `_d`, left to right). Each pair's offset is found by
matching the right segment's left strip inside the left segment's right part: first on images shrunk to about
512 rows, then at full resolution within a few pixels of that, so it is exact within 1 px. The film border (the
unexposed edge and its markings) is cut where the row and column intensity profiles leave the dark level.
"""

import itertools
from typing import Final

import cv2
import numpy

from hcm_pipeline.contract import Errors
from hcm_pipeline.images import UInt8Array, as_uint8, resize
from hcm_pipeline.jobs import Done, JobContext, StepFailedError, StepResult
from hcm_pipeline.rasters import GeoTiff, read_band, to_uint8, write_geotiff
from hcm_pipeline.steps.common import gdal_step

COARSE_ROWS: Final = 512
# The strip of the right segment matched inside the left one: narrower than any overlap USGS leaves.
TEMPLATE_PX: Final = 160
MIN_TEMPLATE_PX: Final = 8
SEARCH_PX: Final = 1200
REFINE_PX: Final = 6
MARGIN_SHARE: Final = 0.1
# A row or column belongs to the film border while its mean stays under this share of the frame's median.
BORDER_SHARE: Final = 0.35
# ... and never under this grey level (a frame that is dark everywhere holds no image).
MIN_CONTENT_LEVEL: Final = 10.0
MIN_FRAME_PX: Final = 16


def _best(area: UInt8Array, template: UInt8Array) -> tuple[int, int]:
    """Where `template` fits best inside `area` (its top-left corner)."""
    _, _, _, (x, y) = cv2.minMaxLoc(cv2.matchTemplate(area, template, cv2.TM_CCOEFF_NORMED))
    return int(x), int(y)


def _shrunk(image: UInt8Array, factor: int) -> UInt8Array:
    height, width = image.shape
    return resize(image, (max(1, width // factor), max(1, height // factor)))


def pair_offset(left: UInt8Array, right: UInt8Array) -> tuple[int, int]:
    """Where `right`'s top-left pixel lies in `left`'s pixels (dx, dy), coarse to fine."""
    factor = max(1, left.shape[0] // COARSE_ROWS)
    dx, dy = _coarse(_shrunk(left, factor), _shrunk(right, factor), max(MIN_TEMPLATE_PX, TEMPLATE_PX // factor))
    return _refine(left, right, (dx * factor, dy * factor), factor)


def _coarse(left: UInt8Array, right: UInt8Array, template_px: int) -> tuple[int, int]:
    height = right.shape[0]
    margin = int(height * MARGIN_SHARE)
    template = right[margin : height - margin, : min(template_px, right.shape[1])]
    start = max(0, left.shape[1] - SEARCH_PX)
    x, y = _best(left[:, start:], template)
    return start + x, y - margin


def _refine(left: UInt8Array, right: UInt8Array, guess: tuple[int, int], factor: int) -> tuple[int, int]:
    reach = REFINE_PX * factor
    height = right.shape[0]
    margin = int(height * MARGIN_SHARE) + reach
    template = right[margin : height - margin, : min(TEMPLATE_PX, right.shape[1])]
    x0, y0 = max(0, guess[0] - reach), max(0, guess[1] + margin - reach)
    area = left[y0 : y0 + template.shape[0] + 2 * reach, x0 : x0 + template.shape[1] + 2 * reach]
    x, y = _best(area, template)
    return x0 + x, y0 + y - margin


def _origins(segments: list[UInt8Array]) -> list[tuple[int, int]]:
    """Each segment's top-left pixel in the first one's pixels."""
    origins = [(0, 0)]
    for left, right in itertools.pairwise(segments):
        dx, dy = pair_offset(left, right)
        origins.append((origins[-1][0] + dx, origins[-1][1] + dy))
    return origins


def mosaic(segments: list[UInt8Array]) -> UInt8Array:
    """The segments placed at their offsets (a later one covers the overlap)."""
    placed = list(zip(_origins(segments), segments, strict=True))
    top = min(y for (_, y), _ in placed)
    width = max(x + segment.shape[1] for (x, _), segment in placed)
    height = max(y - top + segment.shape[0] for (_, y), segment in placed)
    frame = numpy.zeros((height, width), numpy.uint8)
    for (x, y), segment in placed:
        frame[y - top : y - top + segment.shape[0], x : x + segment.shape[1]] = segment
    return frame


def _span(profile: numpy.ndarray, level: float) -> tuple[int, int]:
    inside = numpy.flatnonzero(profile >= level)
    return (int(inside[0]), int(inside[-1]) + 1) if inside.size else (0, 0)


def crop_border(frame: UInt8Array) -> UInt8Array:
    """The frame without its dark film border (rows and columns whose mean stays under the border level)."""
    level = max(BORDER_SHARE * float(numpy.median(frame)), MIN_CONTENT_LEVEL)
    top, bottom = _span(frame.mean(axis=1), level)
    left, right = _span(frame.mean(axis=0), level)
    if min(bottom - top, right - left) < MIN_FRAME_PX:
        raise StepFailedError(Errors.PROCESSING_FAILED, "the scan holds no image inside its film border")
    return as_uint8(frame[top:bottom, left:right])


class StitchStep:
    name = "stitch"

    def run(self, ctx: JobContext) -> StepResult:
        listed = ctx.services.objects.list(ctx.work_file("segments/a.tif").rsplit("/", 1)[0] + "/")
        locals_ = [ctx.stage(info.path) for info in sorted(listed, key=lambda info: info.path)]
        if not locals_:
            raise StepFailedError(Errors.PROCESSING_FAILED, "the job has no extracted segment")
        segments = gdal_step(ctx, lambda: [to_uint8(read_band(path)) for path in locals_], "read the segments")
        frame = crop_border(mosaic(segments))
        ctx.checkpoint()
        local = write_geotiff(ctx.local("frame.tif"), GeoTiff([frame]))
        return Done(ctx.publish(local, ctx.work_file("frame.tif"), "image/tiff"))
