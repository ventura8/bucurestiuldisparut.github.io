"""A sheet's frame, its neat line (docs/research/M20-import-local.md §3 b step 2, §3 c step 1).

On a reduced copy: the outermost rows and columns of ink (darker than Otsu's threshold, or a shade under the paper) that run across half
the sheet, each fitted as a line, their crossings the corners; failing that, the largest four-cornered convex outline in the ink that
holds most of the sheet but is not the scan's own edge. Its corners are returned in the full scan's pixels, top left first and
clockwise. A sheet with no such outline has no frame (`frame-not-found`): it is reported and left out, never guessed.
"""

from typing import Final

import cv2
import numpy

from hcm_pipeline.placing.geometry import FloatArray
from hcm_pipeline.placing.streets import UInt8Array

MIN_FRAME_SHARE: Final = 0.3
MAX_FRAME_SHARE: Final = 0.995
CLOSE_SHARE: Final = 0.006
CORNERS: Final = 4
POLY_EPSILON: Final = 0.02
FAINT_LEVELS: Final = 25.0
# A neat line runs straight across at least this share of the sheet.
LINE_SHARE: Final = 0.5
# Where a side's line is looked for (this share of the sheet from that side), how far from the scan's own edge, and how thick a band.
SIDE_SHARE: Final = 0.5
EDGE_PX: Final = 3
BAND_PX: Final = 4


def order_corners(points: FloatArray) -> FloatArray:
    """Four points as top left, top right, bottom right, bottom left."""
    total, difference = points.sum(axis=1), points[:, 0] - points[:, 1]
    ordered = [points[numpy.argmin(total)], points[numpy.argmax(difference)], points[numpy.argmax(total)], points[numpy.argmin(difference)]]
    return numpy.asarray(ordered, numpy.float64)


def _ink(grey: UInt8Array) -> UInt8Array:
    """Ink: darker than Otsu's threshold, or than the paper by `FAINT_LEVELS` (a thin line of a reduced 1-bit scan is only a shade of
    grey), closed so a broken line joins."""
    threshold, _ = cv2.threshold(grey, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)
    level = max(float(threshold), float(numpy.median(grey)) - FAINT_LEVELS)
    ink = numpy.where(grey < level, 255, 0).astype(numpy.uint8)
    size = max(3, round(CLOSE_SHARE * max(grey.shape)) | 1)
    return numpy.asarray(cv2.morphologyEx(ink, cv2.MORPH_CLOSE, numpy.ones((size, size), numpy.uint8)), numpy.uint8)


def _quad(contour: numpy.ndarray) -> FloatArray | None:
    outline = cv2.approxPolyDP(contour, POLY_EPSILON * cv2.arcLength(contour, True), True)
    if len(outline) != CORNERS or not cv2.isContourConvex(outline):
        return None
    return numpy.asarray(outline.reshape(CORNERS, 2), numpy.float64)


def _fits(quad: FloatArray, area: float) -> bool:
    share = abs(cv2.contourArea(quad.astype(numpy.float32))) / area
    return MIN_FRAME_SHARE <= share <= MAX_FRAME_SHARE


def _band_rows(ink: UInt8Array) -> numpy.ndarray:
    """Rows where, within `BAND_PX` rows, ink runs across `LINE_SHARE` of the sheet (a line tilted by a few pixels still counts)."""
    counts = (ink > 0).sum(axis=1).astype(numpy.float64)
    window = numpy.convolve(counts, numpy.ones(2 * BAND_PX + 1), mode="same")
    return numpy.flatnonzero(window >= LINE_SHARE * ink.shape[1])


def _outermost(ink: UInt8Array, first: bool) -> FloatArray | None:
    """The outermost long line of `ink` (along its rows) in the first or last `SIDE_SHARE` of the sheet, away from the scan's own
    edge, fitted as `row = a column + b` on the darkest row of each column within its band; None when that side has none."""
    side = _side_rows(_band_rows(ink), ink.shape[0], first)
    if len(side) == 0:
        return None
    low = max(0, int(side[0] if first else side[-1]) - 2 * BAND_PX)
    return _fitted(ink, low)


def _side_rows(rows: numpy.ndarray, size: int, first: bool) -> numpy.ndarray:
    """The long-line rows in the sheet's first (or last) `SIDE_SHARE`, away from the scan's own edge."""
    if first:
        return rows[(rows >= EDGE_PX) & (rows < size * SIDE_SHARE)]
    return rows[(rows < size - EDGE_PX) & (rows >= size * (1 - SIDE_SHARE))]


def _fitted(ink: UInt8Array, low: int) -> FloatArray | None:
    """The line through the ink of the band starting at row `low`: `row = a column + b`."""
    band = ink[low : low + 4 * BAND_PX + 1] > 0
    columns = numpy.flatnonzero(band.any(axis=0))
    if len(columns) < LINE_SHARE * ink.shape[1]:
        return None
    rows_at = numpy.array([numpy.flatnonzero(band[:, column]).mean() for column in columns]) + low
    return numpy.polyfit(columns.astype(numpy.float64), rows_at, 1)


def _crossing(horizontal: FloatArray, vertical: FloatArray) -> FloatArray:
    """Where `row = a col + b` meets `col = c row + d`."""
    a, b = horizontal
    c, d = vertical
    row = (a * d + b) / (1 - a * c)
    return numpy.array([c * row + d, row])


def line_frame(grey: UInt8Array) -> FloatArray | None:
    """The frame as the outermost long lines on each side, their crossings its corners (top left first, clockwise)."""
    ink = _ink(grey)
    sides = [
        side
        for side in (_outermost(ink, True), _outermost(ink.T, False), _outermost(ink, False), _outermost(ink.T, True))
        if side is not None
    ]
    if len(sides) < CORNERS:
        return None
    top, right, bottom, left = sides
    corners = numpy.array([_crossing(top, left), _crossing(top, right), _crossing(bottom, right), _crossing(bottom, left)])
    return corners if _fits(corners, float(grey.shape[0] * grey.shape[1])) else None


def _largest_quad(mask: UInt8Array, area: float) -> FloatArray | None:
    contours, _ = cv2.findContours(mask, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    quads = [quad for quad in map(_quad, contours) if quad is not None and _fits(quad, area)]
    return max(quads, key=lambda quad: abs(cv2.contourArea(quad.astype(numpy.float32))), default=None)


def find_frame(grey: UInt8Array, scale: float = 1.0) -> FloatArray | None:
    """The frame's four corners in the full scan's pixels (`scale`: full pixels per pixel of `grey`), or None: first from the outermost
    long straight lines (a hand-drawn blot or a title touching the frame cannot bend them), then as the largest outline in the ink."""
    found = line_frame(grey)
    found = _largest_quad(_ink(grey), float(grey.shape[0] * grey.shape[1])) if found is None else found
    return None if found is None else order_corners((found + 0.5) * scale)


# A sheet with no printed neat line (the cadastral sheets): the drawing's own extent, where ink is dense along both axes.
CONTENT_DENSITY: Final = 0.04
CONTENT_SMOOTH: Final = 0.02
# The drawing must hold its cell's shape within this share (a title block beside it would stretch it).
ASPECT_SLACK: Final = 0.2


def _span(profile: numpy.ndarray, size: int) -> tuple[int, int] | None:
    """The longest run of `profile` (ink share per row or column, smoothed) at or above `CONTENT_DENSITY`, or None."""
    width = max(1, round(CONTENT_SMOOTH * size))
    dense = numpy.convolve(profile, numpy.ones(width) / width, mode="same") >= CONTENT_DENSITY
    edges = numpy.flatnonzero(numpy.diff(numpy.concatenate(([0], dense.astype(numpy.int8), [0]))))
    runs = list(zip(edges[::2], edges[1::2], strict=True))
    return max(runs, key=lambda run: run[1] - run[0], default=None)


def content_frame(grey: UInt8Array, aspect: float, scale: float = 1.0) -> FloatArray | None:
    """The drawing's extent as a frame (corners in the full scan's pixels, top left first, clockwise) for a sheet without a neat line:
    the longest dense run of ink across and down, kept when it holds 30-99.5 % of the sheet and its cell's shape (`aspect`, width over
    height) within `ASPECT_SLACK`; else None."""
    ink = _ink(grey) > 0
    height, width = ink.shape
    across, down = _span(ink.mean(axis=0), width), _span(ink.mean(axis=1), height)
    if across is None or down is None:
        return None
    (left, right), (top, bottom) = across, down
    box = numpy.array([[left, top], [right, top], [right, bottom], [left, bottom]], numpy.float64)
    shape = (right - left) / max(1, bottom - top)
    if not _fits(box, float(width * height)) or abs(shape / aspect - 1.0) > ASPECT_SLACK:
        return None
    return order_corners((box + 0.5) * scale)


# M20 §19.2: before seams are measured, a page's margins and frame are cropped, and a blank page is told apart.
# A page is blank when less than this share of it is ink (a separator, the back of a sheet, an empty grid cell).
BLANK_INK: Final = 0.003
# The paper's level: this percentile of the page (a map filled with dark blocks has little paper; its lightest pixels are the paper).
PAPER_PERCENTILE: Final = 98
# The frame's own line is left outside the content (it would read as a seam of its own): the frame's box is trimmed while its edge row
# or column is mostly ink (`LINE_INK`), by at most `FRAME_LINE_SHARE` of the side.
LINE_INK: Final = 0.9
OUTSIDE_INK: Final = 0.1
OUTSIDE_MIN_SHARE: Final = 0.02
FRAME_LINE_SHARE: Final = 0.015
# A margin row or column holds less ink than this share.
MARGIN_INK: Final = 0.004
MARGIN_MIN_SHARE: Final = 0.02


def ink_share(grey: UInt8Array) -> float:
    """The share of the page that is ink (darker than the paper by `FAINT_LEVELS`, or than Otsu's threshold on an inked page)."""
    paper = float(numpy.percentile(grey, PAPER_PERCENTILE))
    return float((grey < paper - 2 * FAINT_LEVELS).mean())


def is_blank(grey: UInt8Array) -> bool:
    return ink_share(grey) < BLANK_INK


def _margin(profile: numpy.ndarray) -> int:
    """How many leading entries of an ink profile are paper margin: under `MARGIN_INK`, and at least `MARGIN_MIN_SHARE` of it (a
    street along the edge is narrower, and is content)."""
    inked = numpy.flatnonzero(profile >= MARGIN_INK)
    run = int(inked[0]) if len(inked) else 0
    return run if run >= MARGIN_MIN_SHARE * len(profile) else 0


def _inked_span(profile: numpy.ndarray) -> tuple[int, int]:
    """The span inside the paper margins at both ends of an ink profile."""
    return _margin(profile), len(profile) - _margin(profile[::-1])


def _line_trim(profile: numpy.ndarray) -> int:
    """How many leading entries of an edge's ink profile are the frame's line (mostly ink), at most `FRAME_LINE_SHARE` of it."""
    limit = max(1, round(FRAME_LINE_SHARE * len(profile)))
    light = numpy.flatnonzero(profile[:limit] < LINE_INK)
    return int(light[0]) if len(light) else limit


def _inside_frame(ink: numpy.ndarray, corners: FloatArray) -> tuple[int, int, int, int]:
    """The frame's box, its line trimmed off each side."""
    height, width = ink.shape
    left, top = (max(0, int(value)) for value in numpy.ceil(corners.min(axis=0)))
    right, bottom = min(width, int(numpy.floor(corners.max(axis=0)[0])) + 1), min(height, int(numpy.floor(corners.max(axis=0)[1])) + 1)
    inside = ink[top:bottom, left:right]
    columns, rows = inside.mean(axis=0), inside.mean(axis=1)
    return left + _line_trim(columns), top + _line_trim(rows), right - _line_trim(columns[::-1]), bottom - _line_trim(rows[::-1])


def _paper_outside(ink: numpy.ndarray, corners: FloatArray) -> bool:
    """True when the frame has a paper margin around it: at least `OUTSIDE_MIN_SHARE` of the page lies outside it, under `OUTSIDE_INK`
    of that ink. An outline found inside the drawing (a ring of streets, a block) has the drawing around it and is no frame."""
    height, width = ink.shape
    low = numpy.maximum(0, numpy.floor(corners.min(axis=0))).astype(int)
    high = numpy.minimum([width, height], numpy.ceil(corners.max(axis=0)) + 1).astype(int)
    outside = numpy.ones_like(ink, dtype=bool)
    outside[low[1] : high[1], low[0] : high[0]] = False
    return float(outside.mean()) >= OUTSIDE_MIN_SHARE and float(ink[outside].mean()) < OUTSIDE_INK


def content_box(grey: UInt8Array) -> tuple[int, int, int, int]:
    """The page's content (left, top, right, bottom): inside its frame, its line trimmed off; else with its paper margins trimmed."""
    ink = grey < float(numpy.percentile(grey, PAPER_PERCENTILE)) - 2 * FAINT_LEVELS
    corners = find_frame(grey)
    if corners is not None and _paper_outside(ink, corners):
        return _inside_frame(ink, corners)
    (left, right), (top, bottom) = _inked_span(ink.mean(axis=0)), _inked_span(ink.mean(axis=1))
    return left, top, right, bottom
