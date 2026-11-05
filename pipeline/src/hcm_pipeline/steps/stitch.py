"""`stitch`: where the segments lie in one frame, its film border cropped (docs/research/M3-interfaces.md §5.3).

USGS scans a long film frame in overlapping parts (`_a` to `_d`, left to right). Each pair's offset is found by
matching the right segment's left strip inside the left segment's right part (its last `MAX_OVERLAP_SHARE`, finding
76): first on images shrunk to about
2048 rows, then at full resolution within a few pixels of that, so it is exact within 1 px. The film border (the
unexposed edge and its markings) is cut where the row and column intensity profiles of a shrunk mosaic leave the dark
level. Finding 57 of 2026-11-01: the frame is never joined in memory (a KH-9 panoramic frame was killed at 32 GiB):
the step reads windows and shrunk copies of two segments at a time and writes `frame.json` (each segment's place) and
`frame-preview.tif` (the frame shrunk to at most `PREVIEW_MAX_PX` on its long side), which `locate` reads.
"""

import math
from pathlib import Path
from typing import Final

import cv2
import numpy

from hcm_pipeline.contract import Errors
from hcm_pipeline.frames import FRAME_JSON, FRAME_PREVIEW, PREVIEW_MAX_PX, FrameLayout, Placement, Segment
from hcm_pipeline.images import UInt8Array, as_uint8
from hcm_pipeline.jobs import Done, JobContext, StepFailedError, StepResult
from hcm_pipeline.objects import ObjectInfo
from hcm_pipeline.rasters import GeoTiff, write_geotiff
from hcm_pipeline.steps.common import gdal_step

# Finding 83 of 2026-11-05: at 512 rows a KH-9 frame was shrunk 48 times, too blurred to tell its snow-covered valleys
# apart, and one pair of eight matched a wrong place; at 2048 every pair agrees with the widest strip that fits.
COARSE_ROWS: Final = 2048
# The strip of the right segment matched inside the left one: narrower than any overlap USGS leaves.
TEMPLATE_PX: Final = 160
MIN_TEMPLATE_PX: Final = 8
SEARCH_PX: Final = 1200
# Finding 76 of 2026-11-03: the right segment starts in this last share of the left one. USGS leaves narrow overlaps (4 to
# 8 % on a KH-9 panoramic frame); searched across the whole segment, a snow-covered frame of repeating valleys matched a
# strip 46 % inside the left segment, and the frame was joined wrong.
MAX_OVERLAP_SHARE: Final = 0.35
REFINE_PX: Final = 6
# The strip's top and bottom left out, which is also how far up or down the right segment may lie: the scanner keeps the
# film straight (at most 0.5 % of the height on a KH-9 frame), and a jump of 11 % was a wrong match (finding 83).
MARGIN_SHARE: Final = 0.03
# A row or column belongs to the film border while its mean stays under this share of the frame's median.
BORDER_SHARE: Final = 0.35
# ... and never under this grey level (a frame that is dark everywhere holds no image).
MIN_CONTENT_LEVEL: Final = 10.0
MIN_FRAME_PX: Final = 16


def _best(area: UInt8Array, template: UInt8Array) -> tuple[int, int]:
    """Where `template` fits best inside `area` (its top-left corner)."""
    _, _, _, (x, y) = cv2.minMaxLoc(cv2.matchTemplate(area, template, cv2.TM_CCOEFF_NORMED))
    return int(x), int(y)


def _shrunk(segment: Segment, factor: int) -> UInt8Array:
    """The segment shrunk `factor` times (rounded up: placed in a preview rounded down, it leaves no blank edge)."""
    return segment.read(0, 0, segment.width, segment.height, (math.ceil(segment.width / factor), math.ceil(segment.height / factor)))


def pair_offset(left: Segment, right: Segment) -> tuple[int, int]:
    """Where `right`'s top-left pixel lies in `left`'s pixels (dx, dy), coarse to fine, from windows of the two."""
    factor = max(1, left.height // COARSE_ROWS)
    dx, dy = _coarse(_shrunk(left, factor), _shrunk(right, factor), max(MIN_TEMPLATE_PX, TEMPLATE_PX // factor))
    return _refine(left, right, (dx * factor, dy * factor), factor)


def _coarse(left: UInt8Array, right: UInt8Array, template_px: int) -> tuple[int, int]:
    height = right.shape[0]
    margin = int(height * MARGIN_SHARE)
    template = right[margin : height - margin, : min(template_px, right.shape[1])]
    reach = min(SEARCH_PX, max(template.shape[1], math.ceil(left.shape[1] * MAX_OVERLAP_SHARE)))
    start = max(0, left.shape[1] - reach)
    x, y = _best(left[:, start:], template)
    return start + x, y - margin


def _refine(left: Segment, right: Segment, guess: tuple[int, int], factor: int) -> tuple[int, int]:
    """The offset at full resolution: the right segment's left strip within `REFINE_PX` shrunk pixels of the guess."""
    reach = REFINE_PX * factor
    margin = int(right.height * MARGIN_SHARE) + reach
    template = right.read(0, margin, min(TEMPLATE_PX, right.width), max(1, right.height - 2 * margin))
    x0, y0 = max(0, guess[0] - reach), max(0, guess[1] + margin - reach)
    width = min(template.shape[1] + 2 * reach, left.width - x0)
    height = min(template.shape[0] + 2 * reach, left.height - y0)
    x, y = _best(left.read(x0, y0, width, height), template)
    return x0 + x, y0 + y - margin


def _span(profile: numpy.ndarray, level: float) -> tuple[int, int]:
    inside = numpy.flatnonzero(profile >= level)
    return (int(inside[0]), int(inside[-1]) + 1) if inside.size else (0, 0)


def border_box(frame: UInt8Array) -> tuple[int, int, int, int]:
    """The frame inside its dark film border (rows and columns whose mean stays under the border level): x, y, w, h."""
    level = max(BORDER_SHARE * float(numpy.median(frame)), MIN_CONTENT_LEVEL)
    top, bottom = _span(frame.mean(axis=1), level)
    left, right = _span(frame.mean(axis=0), level)
    if min(bottom - top, right - left) < MIN_FRAME_PX:
        raise StepFailedError(Errors.PROCESSING_FAILED, "the scan holds no image inside its film border")
    return left, top, right - left, bottom - top


def _frame_size(origins: list[tuple[int, int]], segments: list[Segment]) -> tuple[int, int, int]:
    """The joined frame's width and height, and its top (the highest segment's y, which may be negative)."""
    top = min(y for _, y in origins)
    width = max(x + segment.width for (x, _), segment in zip(origins, segments, strict=True))
    height = max(y - top + segment.height for (_, y), segment in zip(origins, segments, strict=True))
    return width, height, top


def _preview(origins: list[tuple[int, int]], previews: list[UInt8Array], factor: int, size: tuple[int, int, int]) -> UInt8Array:
    """The frame shrunk by `factor`: each segment's shrunk copy at its place (a later one covers the overlap)."""
    width, height, top = size
    frame = numpy.zeros((max(1, height // factor), max(1, width // factor)), numpy.uint8)
    for (x, y), shrunk in zip(origins, previews, strict=True):
        row, column = (y - top) // factor, x // factor
        rows, columns = min(shrunk.shape[0], frame.shape[0] - row), min(shrunk.shape[1], frame.shape[1] - column)
        frame[row : row + rows, column : column + columns] = shrunk[:rows, :columns]
    return frame


class _Walk:
    """The segments read two at a time: each staged, measured, shrunk and paired with the one before, then let go."""

    def __init__(self, ctx: JobContext, paths: list[str]) -> None:
        self.ctx = ctx
        self.paths = paths
        self.factor = 1
        self.origins: list[tuple[int, int]] = []
        self.sizes: list[Segment] = []
        self.shrunk: list[UInt8Array] = []

    def run(self) -> None:
        previous: Segment | None = None
        for path in self.paths:
            segment = Segment(self.ctx.stage(path))
            self._place(previous, segment)
            self._let_go(previous)
            previous = segment
            self.ctx.checkpoint()
        self._let_go(previous)

    def _place(self, previous: Segment | None, segment: Segment) -> None:
        if previous is None:
            # The preview's shrink: the frame's long side, about the segments side by side, to `PREVIEW_MAX_PX`.
            self.factor = max(1, math.ceil(max(len(self.paths) * segment.width, segment.height) / PREVIEW_MAX_PX))
            self.origins.append((0, 0))
        else:
            dx, dy = pair_offset(previous, segment)
            self.origins.append((self.origins[-1][0] + dx, self.origins[-1][1] + dy))
        self.sizes.append(segment)
        self.shrunk.append(_shrunk(segment, self.factor))

    def _let_go(self, segment: Segment | None) -> None:
        if segment is not None:
            segment.close()
            self.ctx.unstage(self.paths[self.sizes.index(segment)])


def _segment_paths(ctx: JobContext) -> list[str]:
    listed = ctx.services.objects.list(ctx.work_file("segments/a.tif").rsplit("/", 1)[0] + "/")
    paths = [info.path for info in sorted(listed, key=lambda info: info.path)]
    if not paths:
        raise StepFailedError(Errors.PROCESSING_FAILED, "the job has no extracted segment")
    return paths


def _layout(walk: _Walk) -> tuple[FrameLayout, UInt8Array]:
    factor = walk.factor
    size = _frame_size(walk.origins, walk.sizes)
    preview = _preview(walk.origins, walk.shrunk, factor, size)
    left, top, width, height = border_box(preview)
    x0, y0 = left * factor, top * factor + size[2]
    placements = tuple(
        Placement(path, x - x0, y - y0, segment.width, segment.height)
        for path, (x, y), segment in zip(walk.paths, walk.origins, walk.sizes, strict=True)
    )
    full = (_full_span(left, width, preview.shape[1], factor, size[0]), _full_span(top, height, preview.shape[0], factor, size[1]))
    return FrameLayout(full[0], full[1], factor, placements), as_uint8(preview[top : top + height, left : left + width])


def _full_span(start: int, span: int, preview_span: int, factor: int, full: int) -> int:
    """A preview span at full resolution: to the frame's own edge when it reaches the preview's."""
    return full - start * factor if start + span >= preview_span else span * factor


class StitchStep:
    name = "stitch"

    def run(self, ctx: JobContext) -> StepResult:
        walk = _Walk(ctx, _segment_paths(ctx))
        gdal_step(ctx, walk.run, "read the segments")
        layout, preview = _layout(walk)
        ctx.checkpoint()
        ctx.publish(write_geotiff(ctx.local(FRAME_PREVIEW), GeoTiff([preview])), ctx.work_file(FRAME_PREVIEW), "image/tiff")
        return Done(_publish_layout(ctx, layout))


def _publish_layout(ctx: JobContext, layout: FrameLayout) -> ObjectInfo:
    local: Path = ctx.local(FRAME_JSON)
    local.write_text(layout.to_json(), encoding="utf-8")
    return ctx.publish(local, ctx.work_file(FRAME_JSON), "application/json")
