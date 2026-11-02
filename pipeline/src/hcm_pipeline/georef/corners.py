"""The corner guess of `locate` (docs/research/M3-interfaces.md §5.4).

The scene's four geographic corners give the frame's footprint, but the film's first pixel row may lie at any of
them (forward or aft camera, the flight's direction), so each of the eight assignments of the frame's pixel
corners to the geographic ones (four rotations, each mirrored or not) gives a projective transform; each is scored
by the normalized correlation of the frame warped onto the city window at 60 m against the Sentinel-2 reference at
60 m, and the best one is kept. It maps the city window back into frame pixels: that crop is the scan, and four
GCPs at the crop's corners start the georeferencing.

Findings 62 and 63 of 2026-11-02 (a KH-9 Hexagon panoramic frame, a 1:12 strip): the best of the eight scored a
correlation of 0.03, a quarter turn, and was cropped anyway; the quarter turn stretched the window across the strip's
whole length (a scan over the 200 000 pixels a version may hold, which the admin then could not read) and its scan
matched nothing. Now an assignment whose ground pixel is far longer one way than the best-shaped assignment's is not
scored (`MAX_ANISOTROPY`: a quarter turn or a transposition of a strip); a guess under `MIN_CORRELATION` is searched
again over a window widened by `SEARCH_MARGIN` on every side (the frame warped onto it, the city's reference matched
inside it, the guess moved by the best match's offset: metadata corners are often kilometres off); a guess still under
it is `CityNotFoundError`, never a crop.
"""

import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final

import cv2
import numpy
from numpy.typing import NDArray

from hcm_pipeline.geo import FloatArray, Grid, MercatorBox, to_lnglat, to_mercator
from hcm_pipeline.georef.transforms import Gcp
from hcm_pipeline.images import UInt8Array, enhance

SCORE_RESOLUTION_M: Final = 60.0
# A candidate whose warped frame covers less of the window than this share is not scored.
MIN_COVERAGE: Final = 0.2
NO_SCORE: Final = -1.0
# A crop narrower or shorter than this many pixels misses the window.
MIN_CROP_PX: Final = 2
# The least correlation at 60 m a guess must reach to be cropped (the live KH-9 frame's wrong guess scored 0.03).
MIN_CORRELATION: Final = 0.2
# An assignment whose ground pixel is longer one way than the other by more than this many times the best-shaped
# assignment's is not scored: a quarter turn of a 1:12 strip stretches its pixels about 140 times.
MAX_ANISOTROPY: Final = 3.0
# The search around a weak guess: the window widened by this share of its size on every side.
SEARCH_MARGIN: Final = 0.5
# The least share of the widened window the frame must cover for a search to be worth running.
MIN_SEARCH_COVERAGE: Final = 0.05
LatLng = tuple[float, float]


class WindowMissedError(ValueError):
    """The frame does not cover the city window under any assignment."""


class CityNotFoundError(ValueError):
    """The frame covers the window, but no assignment, searched around too, correlates with it well enough."""

    def __init__(self, best: float) -> None:
        super().__init__(f"the city was not found on the frame: the best guess correlates {best:.2f}, under {MIN_CORRELATION:.2f}")
        self.best = best


def homography(source: FloatArray, target: FloatArray) -> FloatArray:
    """The 3x3 projective map taking the four `source` points onto the four `target` points."""
    rows, values = [], []
    for (x, y), (u, v) in zip(source.tolist(), target.tolist(), strict=True):
        rows += [[x, y, 1.0, 0.0, 0.0, 0.0, -u * x, -u * y], [0.0, 0.0, 0.0, x, y, 1.0, -v * x, -v * y]]
        values += [u, v]
    solution = numpy.linalg.solve(numpy.array(rows), numpy.array(values))
    return numpy.append(solution, 1.0).reshape(3, 3)


def apply(matrix: FloatArray, x: FloatArray, y: FloatArray) -> tuple[FloatArray, FloatArray]:
    """`matrix` applied to the points (x, y)."""
    w = matrix[2, 0] * x + matrix[2, 1] * y + matrix[2, 2]
    return (matrix[0, 0] * x + matrix[0, 1] * y + matrix[0, 2]) / w, (matrix[1, 0] * x + matrix[1, 1] * y + matrix[1, 2]) / w


@dataclass(frozen=True)
class Assignment:
    """Which geographic corner the frame's top-left pixel corner lies at, and the transform it gives."""

    rotation: int
    mirrored: bool
    matrix: FloatArray

    def to_mercator(self, x: FloatArray, y: FloatArray) -> tuple[FloatArray, FloatArray]:
        return apply(self.matrix, x, y)

    def to_pixel(self, mx: FloatArray, my: FloatArray) -> tuple[FloatArray, FloatArray]:
        return apply(numpy.linalg.inv(self.matrix), mx, my)

    def moved(self, dx: float, dy: float) -> Assignment:
        """The same assignment with every place moved by (`dx`, `dy`) EPSG:3857 metres."""
        shift = numpy.array([[1.0, 0.0, dx], [0.0, 1.0, dy], [0.0, 0.0, 1.0]])
        return Assignment(self.rotation, self.mirrored, shift @ self.matrix)


@dataclass(frozen=True)
class Guess:
    """The assignment kept, its correlation at 60 m, and how far (metres) the search moved it (0: not searched)."""

    assignment: Assignment
    score: float
    moved_m: float = 0.0


def frame_corners(width: int, height: int) -> FloatArray:
    """The frame's pixel corners: top-left, top-right, bottom-right, bottom-left."""
    return numpy.array([[0.0, 0.0], [width, 0.0], [width, height], [0.0, height]])


def assignments(width: int, height: int, quad: Sequence[LatLng]) -> list[Assignment]:
    """The eight assignments of the frame's corners to the geographic corners (north-west first, clockwise)."""
    places = [to_mercator(lng, lat) for lat, lng in quad]
    orders = (places, [places[0], places[3], places[2], places[1]])
    found = []
    for mirrored, order in enumerate(orders):
        for rotation in range(4):
            target = numpy.array(order[rotation:] + order[:rotation])
            found.append(Assignment(rotation, bool(mirrored), homography(frame_corners(width, height), target)))
    return found


def anisotropy(transform: Assignment, width: int, height: int) -> float:
    """How many times longer the ground pixel at the frame's centre is one way than the other (1: square)."""
    x = numpy.array([width / 2, width / 2 + 1, width / 2])
    y = numpy.array([height / 2, height / 2, height / 2 + 1])
    mx, my = transform.to_mercator(x, y)
    along_x, along_y = math.hypot(mx[1] - mx[0], my[1] - my[0]), math.hypot(mx[2] - mx[0], my[2] - my[0])
    return max(along_x, along_y) / max(min(along_x, along_y), 1e-12)


def plausible(width: int, height: int, quad: Sequence[LatLng]) -> list[Assignment]:
    """The assignments whose ground pixels are about as square as the best-shaped one's (`MAX_ANISOTROPY`)."""
    found = assignments(width, height, quad)
    shapes = [anisotropy(candidate, width, height) for candidate in found]
    least = min(shapes)
    return [candidate for candidate, shape in zip(found, shapes, strict=True) if shape <= least * MAX_ANISOTROPY]


@dataclass(frozen=True)
class Frame:
    """The frame downsampled for scoring: `pixels` of the full-resolution frame shrunk `factor` times."""

    pixels: UInt8Array
    factor: float
    width: int
    height: int


def warp_onto(frame: Frame, transform: Assignment, grid: Grid) -> tuple[UInt8Array, NDArray[numpy.bool_]]:
    """The frame resampled onto `grid` through `transform`, and the mask of grid pixels the frame covers."""
    mx, my = grid.centres()
    px, py = transform.to_pixel(mx, my)
    inside = (px >= 0) & (px < frame.width) & (py >= 0) & (py < frame.height)
    map_x = (px / frame.factor - 0.5).astype(numpy.float32)
    map_y = (py / frame.factor - 0.5).astype(numpy.float32)
    warped = cv2.remap(frame.pixels, map_x, map_y, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    return numpy.asarray(warped, numpy.uint8), inside


def correlation(a: FloatArray, b: FloatArray) -> float:
    """The normalized cross-correlation of two equal-sized samples."""
    a, b = a - a.mean(), b - b.mean()
    spread = float(numpy.sqrt((a * a).sum() * (b * b).sum()))
    return float((a * b).sum() / spread) if spread > 0 else 0.0


def score(frame: Frame, transform: Assignment, reference: UInt8Array, grid: Grid) -> float:
    """How well the frame warped through `transform` matches the reference (NO_SCORE when it barely covers it)."""
    warped, inside = warp_onto(frame, transform, grid)
    if inside.mean() < MIN_COVERAGE:
        return NO_SCORE
    return correlation(enhance(warped)[inside].astype(numpy.float64), enhance(reference)[inside].astype(numpy.float64))


def _best(guesses: Sequence[Guess]) -> Guess:
    """The highest-scoring guess (the first of equals)."""
    return max(enumerate(guesses), key=lambda entry: (entry[1].score, -entry[0]))[1]


def widened(grid: Grid, margin: float) -> tuple[Grid, int, int]:
    """`grid` grown by `margin` of its size on every side (whole pixels), and the columns and rows it grew by."""
    columns, rows = max(1, round(grid.width * margin)), max(1, round(grid.height * margin))
    left, top = grid.left - columns * grid.resolution, grid.top + rows * grid.resolution
    return Grid(left, top, grid.resolution, grid.width + 2 * columns, grid.height + 2 * rows), columns, rows


def window_coverage(inside: NDArray[numpy.bool_], height: int, width: int) -> FloatArray:
    """For each place a `height` by `width` window can take inside the mask (`cv2.matchTemplate`'s result layout), the
    share of the window the mask covers."""
    sums = numpy.pad(numpy.cumsum(numpy.cumsum(inside.astype(numpy.float64), 0), 1), ((1, 0), (1, 0)))
    total = sums[height:, width:] - sums[:-height, width:] - sums[height:, :-width] + sums[:-height, :-width]
    return numpy.asarray(total / (height * width), numpy.float64)


def searched(frame: Frame, transform: Assignment, reference: UInt8Array, grid: Grid, margin: float = SEARCH_MARGIN) -> Guess:
    """`transform` moved to where the window's reference matches the frame best within `margin` of the window around
    it, and the moved guess's correlation (NO_SCORE when the frame barely covers the widened window)."""
    wide, columns, rows = widened(grid, margin)
    warped, inside = warp_onto(frame, transform, wide)
    if inside.mean() < MIN_SEARCH_COVERAGE:
        return Guess(transform, NO_SCORE)
    matches = cv2.matchTemplate(enhance(warped), enhance(reference), cv2.TM_CCOEFF_NORMED)
    # A place where the frame covers too little of the window is no match (a blank area correlates with anything).
    covered = window_coverage(inside, reference.shape[0], reference.shape[1]) >= MIN_COVERAGE
    _, _, _, (x, y) = cv2.minMaxLoc(numpy.where(covered, numpy.nan_to_num(matches, nan=NO_SCORE), NO_SCORE).astype(numpy.float32))
    dx, dy = (x - columns) * grid.resolution, (rows - y) * grid.resolution
    moved = transform.moved(-dx, -dy)
    return Guess(moved, score(frame, moved, reference, grid), math.hypot(dx, dy))


def guess_corners(frame: Frame, quad: Sequence[LatLng], reference: UInt8Array, grid: Grid) -> Guess:
    """The corner guess to crop with: the best plausible assignment, searched around when it scores under
    `MIN_CORRELATION`. WindowMissedError when the frame covers neither the window nor its surroundings,
    CityNotFoundError when the best guess still scores under `MIN_CORRELATION`."""
    candidates = plausible(frame.width, frame.height, quad)
    first = _best([Guess(candidate, score(frame, candidate, reference, grid)) for candidate in candidates])
    if first.score >= MIN_CORRELATION:
        return first
    return _search_around(frame, candidates, (reference, grid), first.score)


def _search_around(frame: Frame, candidates: Sequence[Assignment], window: tuple[UInt8Array, Grid], first: float) -> Guess:
    """The best of the candidates searched around the window (`first`: the best score before the search)."""
    reference, grid = window
    second = _best([searched(frame, candidate, reference, grid) for candidate in candidates])
    if max(first, second.score) <= NO_SCORE:
        raise WindowMissedError("the frame does not cover the city window")
    if second.score < MIN_CORRELATION:
        raise CityNotFoundError(max(first, second.score))
    return second


@dataclass(frozen=True)
class Crop:
    """The frame's pixel box over the city window, and the four GCPs at its corners (in the crop's pixels)."""

    left: int
    top: int
    width: int
    height: int
    gcps: tuple[Gcp, ...]


def crop_box(transform: Assignment, window: MercatorBox, width: int, height: int) -> tuple[int, int, int, int]:
    """The frame pixels (left, top, right, bottom) the window maps onto, clipped to the frame."""
    px, py = transform.to_pixel(
        numpy.array([window.left, window.right, window.right, window.left]),
        numpy.array([window.top, window.top, window.bottom, window.bottom]),
    )
    left, top = max(0, int(numpy.floor(px.min()))), max(0, int(numpy.floor(py.min())))
    right, bottom = min(width, int(numpy.ceil(px.max()))), min(height, int(numpy.ceil(py.max())))
    if min(right - left, bottom - top) < MIN_CROP_PX:
        raise WindowMissedError("the city window lies outside the frame")
    return left, top, right, bottom


def crop(transform: Assignment, window: MercatorBox, width: int, height: int) -> Crop:
    """The scan's crop and its corner GCPs (`origin: 'corner'`, ids `c1` to `c4`, clockwise from the top-left)."""
    left, top, right, bottom = crop_box(transform, window, width, height)
    corners = frame_corners(right - left, bottom - top)
    mx, my = transform.to_mercator(corners[:, 0] + left, corners[:, 1] + top)
    gcps = []
    for index, (x, y, merc_x, merc_y) in enumerate(zip(corners[:, 0], corners[:, 1], mx, my, strict=True), start=1):
        lng, lat = to_lnglat(float(merc_x), float(merc_y))
        gcps.append(Gcp(f"c{index}", float(x), float(y), lat, lng, True, "corner"))
    return Crop(left, top, right - left, bottom - top, tuple(gcps))


def corner_transform(gcps: Sequence[Gcp]) -> Assignment:
    """The projective transform through four corner GCPs (the matcher's starting point)."""
    if len(gcps) != len(("nw", "ne", "se", "sw")):
        raise ValueError("a corner transform needs exactly four corner GCPs")
    source = numpy.array([[gcp.x, gcp.y] for gcp in gcps])
    target = numpy.array([to_mercator(gcp.lng, gcp.lat) for gcp in gcps])
    return Assignment(0, False, homography(source, target))
