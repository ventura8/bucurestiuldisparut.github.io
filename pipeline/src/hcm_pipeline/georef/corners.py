"""The corner guess of `locate` (docs/research/M3-interfaces.md §5.4).

The scene's four geographic corners give the frame's footprint, but the film's first pixel row may lie at any of
them (forward or aft camera, the flight's direction), so each of the eight assignments of the frame's pixel
corners to the geographic ones (four rotations, each mirrored or not) gives a projective transform; each is scored
by the normalized correlation of the frame warped onto the city window at 60 m against the Sentinel-2 reference at
60 m, and the best one is kept. It maps the city window back into frame pixels: that crop is the scan, and four
GCPs at the crop's corners start the georeferencing.
"""

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
LatLng = tuple[float, float]


class WindowMissedError(ValueError):
    """The frame does not cover the city window under any assignment."""


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


def best_assignment(frame: Frame, quad: Sequence[LatLng], reference: UInt8Array, grid: Grid) -> tuple[Assignment, float]:
    """The assignment whose warped frame correlates best with the reference at 60 m; WindowMissedError when none covers it."""
    scored = [
        (score(frame, candidate, reference, grid), index, candidate)
        for index, candidate in enumerate(assignments(frame.width, frame.height, quad))
    ]
    best_score, _, best = max(scored, key=lambda entry: (entry[0], -entry[1]))
    if best_score <= NO_SCORE:
        raise WindowMissedError("the frame does not cover the city window")
    return best, best_score


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
