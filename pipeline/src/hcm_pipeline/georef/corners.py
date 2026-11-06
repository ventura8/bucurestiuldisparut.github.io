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
inside it, the guess moved by the best match's offset: metadata corners are often kilometres off).

The rehearsal on the real 1972 frame D3C1202-200149F039 (lesson 361): a panoramic frame's corners give no homography, so a camera
with a half angle starts from `georef/panoramic.py`'s local fit; the search correlates gradients over where the frame lies
(`georef/surface.py`), and its surface's shape can accept a guess the raw gate cannot, whose true place scores 0.18. A guess
nothing accepts is a weak guess, not a failure: nothing tells its orientations apart, so `locate` crops around every one that
reaches the window, each with `WEAK_CROP_MARGIN_M`, and the admin places the points. `CityNotFoundError` is left for a frame whose
exposure does not reach the window under any assignment: a panoramic camera's dark gap and the next exposure's fragment are no
ground of this frame.
"""

import math
from collections.abc import Sequence
from dataclasses import dataclass, replace
from typing import Final

import cv2
import numpy
from numpy.typing import NDArray

from hcm_pipeline.geo import FloatArray, Grid, MercatorBox, ground_scale, to_lnglat, to_mercator
from hcm_pipeline.georef.panoramic import PanoramicCamera, PanoramicModel
from hcm_pipeline.georef.surface import Surface, search_surface
from hcm_pipeline.georef.transforms import Gcp
from hcm_pipeline.images import UInt8Array, enhance

SCORE_RESOLUTION_M: Final = 60.0
# A candidate whose warped frame covers less of the window than this share is not scored.
MIN_COVERAGE: Final = 0.2
NO_SCORE: Final = -1.0
# A crop narrower or shorter than this many pixels misses the window.
MIN_CROP_PX: Final = 2
# The raw gate: the correlation at 60 m at which a guess is believed with no other evidence (the live KH-9 frame's wrong guess
# scored 0.03, its true place 0.126 to 0.18, wrong places at most 0.098: on a real frame the surface's shape decides).
MIN_CORRELATION: Final = 0.2
# An assignment whose ground pixel is longer one way than the other by more than this many times the best-shaped
# assignment's is not scored: a quarter turn of a 1:12 strip stretches its pixels about 140 times.
MAX_ANISOTROPY: Final = 3.0
# The search around a weak guess: the window widened by this share of its size on every side.
SEARCH_MARGIN: Final = 0.5
# The least share of the widened window the frame must cover for a search to be worth running.
MIN_SEARCH_COVERAGE: Final = 0.05
# The margin (ground metres) of a weak guess's crop on every side of the window: the first panoramic guess of the 1972 frame
# lay 7.3 km from the truth, and a few kilometres more for a frame nobody measured.
WEAK_CROP_MARGIN_M: Final = 10_000.0
LatLng = tuple[float, float]


class CityNotFoundError(ValueError):
    """The frame does not reach the city window under any assignment."""

    def __init__(self) -> None:
        super().__init__("the frame does not reach the city window under any orientation")


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
    """The assignment kept, its correlation at 60 m, how far (metres) the search moved it (0: not searched or a weak guess),
    the search's evidence, the share of the window the frame covers under it, whether nothing accepted it (`weak`), and then
    every orientation that reaches the window (`reaching`, this one among them)."""

    assignment: Assignment
    score: float
    moved_m: float = 0.0
    surface: Surface | None = None
    coverage: float = 0.0
    weak: bool = False
    reaching: tuple[Assignment, ...] = ()

    @property
    def strength(self) -> float:
        """How far the search's peak stands over its surface (`NO_SCORE`: no search, or no place to search)."""
        return NO_SCORE if self.surface is None else self.surface.z


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
    """The frame downsampled for scoring: `pixels` of the full-resolution frame shrunk `factor` times; `exposure`, the columns
    that are ground of this frame (None: all of them)."""

    pixels: UInt8Array
    factor: float
    width: int
    height: int
    exposure: tuple[int, int] | None = None

    @property
    def ground(self) -> tuple[int, int]:
        """The first column of the frame's ground and the one past its last."""
        return self.exposure or (0, self.width)


def warp_onto(frame: Frame, transform: Assignment, grid: Grid) -> tuple[UInt8Array, NDArray[numpy.bool_]]:
    """The frame resampled onto `grid` through `transform`, and the mask of grid pixels the frame covers."""
    mx, my = grid.centres()
    px, py = transform.to_pixel(mx, my)
    start, end = frame.ground
    inside = (px >= start) & (px < end) & (py >= 0) & (py < frame.height)
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


def searched(frame: Frame, transform: Assignment, reference: UInt8Array, grid: Grid, margin: float = SEARCH_MARGIN) -> Guess:
    """`transform` moved to where the window's reference matches the frame best within `margin` of the window around
    it, the moved guess's correlation and the search's evidence (NO_SCORE when the frame barely covers the widened window)."""
    wide, columns, rows = widened(grid, margin)
    warped, inside = warp_onto(frame, transform, wide)
    found = search_surface(enhance(warped), inside, enhance(reference), grid.resolution) if inside.mean() >= MIN_SEARCH_COVERAGE else None
    if found is None:
        return Guess(transform, NO_SCORE)
    dx, dy = (found.x - columns) * grid.resolution, (rows - found.y) * grid.resolution
    moved = transform.moved(-dx, -dy)
    return Guess(moved, score(frame, moved, reference, grid), math.hypot(dx, dy), found)


def first_guesses(frame: Frame, quad: Sequence[LatLng], window: MercatorBox, camera: PanoramicCamera | None) -> list[Assignment]:
    """The plausible assignments, each as the panoramic model fitted around the window when the camera has one."""
    kept = plausible(frame.width, frame.height, quad)
    return kept if camera is None else [_panoramic(candidate, frame, window, camera) for candidate in kept]


def _panoramic(candidate: Assignment, frame: Frame, window: MercatorBox, camera: PanoramicCamera) -> Assignment:
    corners = frame_corners(frame.width, frame.height)
    places = numpy.column_stack(candidate.to_mercator(corners[:, 0], corners[:, 1]))
    model = PanoramicModel(places, camera, frame.height)
    return Assignment(candidate.rotation, candidate.mirrored, model.local_matrix(window))


def on_exposure(frame: Frame, camera: PanoramicCamera | None) -> Frame:
    """The frame as scored: a panoramic camera's on its exposure, whatever else the scan holds beyond it."""
    return frame if camera is None else replace(frame, exposure=(camera.image_start, camera.image_start + camera.image_width))


def guess_corners(frame: Frame, quad: Sequence[LatLng], reference: UInt8Array, grid: Grid, camera: PanoramicCamera | None = None) -> Guess:
    """The corner guess to crop with: the best first guess when the raw gate takes it, else the best of them searched around
    that the raw gate or the surface's shape takes, else a `weak` guess. CityNotFoundError when no assignment reaches the
    window, nor a search around it."""
    film = on_exposure(frame, camera)
    firsts = [Guess(candidate, score(film, candidate, reference, grid)) for candidate in first_guesses(film, quad, grid.box(), camera)]
    best = _best(firsts)
    kept = best if best.score >= MIN_CORRELATION else _search_around(film, firsts, reference, grid)
    return replace(kept, coverage=_coverage(film, kept.assignment, grid))


def _coverage(frame: Frame, transform: Assignment, grid: Grid) -> float:
    """The share of `grid` the frame covers through `transform`."""
    return float(warp_onto(frame, transform, grid)[1].mean())


def _search_around(frame: Frame, firsts: Sequence[Guess], reference: UInt8Array, grid: Grid) -> Guess:
    """The search's guess: the best one believed, else the weak one (`firsts`: the guesses before the search)."""
    found = [searched(frame, first.assignment, reference, grid) for first in firsts]
    if max(guess.score for guess in [*firsts, *found]) <= NO_SCORE:
        raise CityNotFoundError
    return _believed(found) or _weak(firsts, found, _coverages(frame, firsts, grid))


def _coverages(frame: Frame, guesses: Sequence[Guess], grid: Grid) -> list[float]:
    return [_coverage(frame, guess.assignment, grid) for guess in guesses]


def _believed(found: Sequence[Guess]) -> Guess | None:
    """The best searched guess the raw gate takes, else the one whose surface stands out most, if any does."""
    raw = [guess for guess in found if guess.score >= MIN_CORRELATION]
    return _best(raw) if raw else max(filter(_confident, found), key=lambda guess: guess.strength, default=None)


def _confident(guess: Guess) -> bool:
    return guess.surface is not None and guess.surface.confident


def _weak(firsts: Sequence[Guess], found: Sequence[Guess], covered: Sequence[float]) -> Guess:
    """The orientation that covers the window most (the search's strength, then the first score, of equals), **not moved**: a
    move nothing believes is noise, and the corners' place is what the weak crop's margin is measured from. Which orientation is
    true stays unknown (a z of 4 to 5 is what the surface of no city gives), so the guess names all that reach the window."""
    index = max(range(len(firsts)), key=lambda each: (covered[each], found[each].strength, firsts[each].score))
    reaching = tuple(first.assignment for first, moved in zip(firsts, found, strict=True) if max(first.score, moved.score) > NO_SCORE)
    return replace(firsts[index], surface=found[index].surface, weak=True, reaching=reaching)


@dataclass(frozen=True)
class Crop:
    """The frame's pixel box over the city window, four GCPs that start the georeferencing (in the crop's pixels), and whether
    they come from a guess nothing confirmed (`weak`)."""

    left: int
    top: int
    width: int
    height: int
    gcps: tuple[Gcp, ...]
    weak: bool = False


Box = tuple[int, int, int, int]


def crop_box(transform: Assignment, window: MercatorBox, width: int, height: int, start: int = 0) -> Box:
    """The frame pixels (left, top, right, bottom) the window maps onto, clipped to the columns from `start` up to `width` (a
    panoramic camera's exposure) and the rows up to `height`."""
    px, py = transform.to_pixel(
        numpy.array([window.left, window.right, window.right, window.left]),
        numpy.array([window.top, window.top, window.bottom, window.bottom]),
    )
    left, top = max(start, int(numpy.floor(px.min()))), max(0, int(numpy.floor(py.min())))
    right, bottom = min(width, int(numpy.ceil(px.max()))), min(height, int(numpy.ceil(py.max())))
    if min(right - left, bottom - top) < MIN_CROP_PX:
        raise CityNotFoundError
    return left, top, right, bottom


def crop(transform: Assignment, window: MercatorBox, width: int, height: int, start: int = 0) -> Crop:
    """The scan's crop and its corner GCPs (`origin: 'corner'`, ids `c1` to `c4`, clockwise from the top-left)."""
    box = crop_box(transform, window, width, height, start)
    return Crop(box[0], box[1], box[2] - box[0], box[3] - box[1], _corner_gcps(transform, box, box))


def _box_reached(transform: Assignment, window: MercatorBox, limits: tuple[int, int, int]) -> Box | None:
    """`crop_box` of an orientation that may miss the widened window: None then."""
    try:
        return crop_box(transform, window, limits[0], limits[1], limits[2])
    except CityNotFoundError:
        return None


def _union(boxes: Sequence[Box]) -> Box:
    """The smallest box holding all of `boxes`."""
    return min(box[0] for box in boxes), min(box[1] for box in boxes), max(box[2] for box in boxes), max(box[3] for box in boxes)


def weak_crop(guess: Guess, window: MercatorBox, width: int, height: int, start: int = 0) -> Crop:
    """The crop of a guess nothing confirmed: the window with `WEAK_CROP_MARGIN_M` on every side under every orientation that
    reaches it, the place the admin needs to find the city in whichever is true. It may be over `MAX_SCAN_PIXELS` a side
    (`locate.within_limits` refuses that); its GCPs lie at the corners of the kept orientation's own box, where its local fit holds."""
    margin = WEAK_CROP_MARGIN_M / ground_scale(window.bounds().middle_lat)
    wide = MercatorBox(window.left - margin, window.bottom - margin, window.right + margin, window.top + margin)
    limits = (width, height, start)
    own = crop_box(guess.assignment, wide, width, height, start)
    boxes = [box for box in (_box_reached(each, wide, limits) for each in guess.reaching) if box is not None]
    union = _union([own, *boxes])
    return Crop(union[0], union[1], union[2] - union[0], union[3] - union[1], _corner_gcps(guess.assignment, own, union), True)


def _corner_gcps(transform: Assignment, box: Box, within: Box) -> tuple[Gcp, ...]:
    """Four GCPs at the corners of `box` (frame pixels) through `transform`, in the pixels of the crop `within`."""
    left, top, right, bottom = box
    corners = frame_corners(right - left, bottom - top) + numpy.array([left, top])
    mx, my = transform.to_mercator(corners[:, 0], corners[:, 1])
    gcps = []
    for index, (x, y, merc_x, merc_y) in enumerate(zip(corners[:, 0], corners[:, 1], mx, my, strict=True), start=1):
        lng, lat = to_lnglat(float(merc_x), float(merc_y))
        gcps.append(Gcp(f"c{index}", float(x - within[0]), float(y - within[1]), lat, lng, True, "corner"))
    return tuple(gcps)


def corner_transform(gcps: Sequence[Gcp]) -> Assignment:
    """The projective transform through four corner GCPs (the matcher's starting point)."""
    if len(gcps) != len(("nw", "ne", "se", "sw")):
        raise ValueError("a corner transform needs exactly four corner GCPs")
    source = numpy.array([[gcp.x, gcp.y] for gcp in gcps])
    target = numpy.array([to_mercator(gcp.lng, gcp.lat) for gcp in gcps])
    return Assignment(0, False, homography(source, target))
