"""The pairs offered for a map that did not place itself (docs/research/M20-import-local.md §3 c, M4 §2.5): none rather than bad ones.

A placement that did not hold is often wrong as a whole. Pairing each junction with the nearest reference junction under it gave a
hundred pairs that agreed with each other (they were made from one placement) but not with the ground: on the owner's maps of
1886 to 1921 the offered pairs lay 13 to 24 km from where the owner's own points put them, every one scored above 0.9 because the
score was only how close the nearest junction was (2026-11-13, lesson in `docs/LESSONS.md`). So a pair is offered only when:

1. **One model.** Each junction is paired with its nearest reference junction within `reach` of where a placement puts it; a seeded
   RANSAC similarity, then an affine through its inliers, keeps the pairs within `reach / TIGHTEN` of that model, one to one.
2. **Above chance.** A street net agrees with any placement a little. The same count is taken with the placement moved
   `SHIFT_REACHES` reaches in each of eight directions; the pairs stand only when they number at least `MIN_OFFERED` and at least
   `MIN_LIFT` times the best moved count. Each candidate placement (the best and its rivals) is tried; the one with the highest
   lift is offered, or nothing.
3. **Spread.** At most `PER_CELL` per cell of a `CELLS` x `CELLS` grid over the map, the closest to the model first, at most
   `MAX_OFFERED` in all: a person needs a few good pairs across the map, not a hundred in one corner.
4. **Confidence** in plain words on the page ("likely", "check this"): the lift over chance times how close the pair is to the model,
   so `AUTO_GCP_MIN_CONFIDENCE` ("likely") needs a placement clearly better than chance and a pair on its model.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final

import numpy

from hcm_pipeline.placing.fine import CANDIDATES, TIGHTEN, nearest, one_to_one
from hcm_pipeline.placing.geometry import FloatArray, affine, apply, ransac_similarity, scale_of

MIN_OFFERED: Final = 6
MIN_LIFT: Final = 2.0
SHIFT_REACHES: Final = 4.0
CELLS: Final = 4
PER_CELL: Final = 2
MAX_OFFERED: Final = 24
DIRECTIONS: Final = 8


@dataclass(frozen=True)
class Offered:
    """The pairs offered (map junctions in working pixels, reference junctions in Mercator metres) and each one's confidence."""

    source: FloatArray
    target: FloatArray
    scores: tuple[float, ...]
    lift: float
    # The reference they were found on: `osm`, or `layer:{id}` for a published layer of the city.
    reference: str = "osm"

    @property
    def count(self) -> int:
        return len(self.scores)


NOTHING: Final = Offered(numpy.zeros((0, 2)), numpy.zeros((0, 2)), (), 0.0)


@dataclass(frozen=True)
class Agreeing:
    """The pairs one model agrees with, and how far (Mercator metres) each lies from it."""

    source: FloatArray
    target: FloatArray
    gaps: FloatArray

    @property
    def count(self) -> int:
        return len(self.source)


EMPTY: Final = Agreeing(numpy.zeros((0, 2)), numpy.zeros((0, 2)), numpy.zeros(0))


def closest_pairs(points: FloatArray, places: FloatArray, matrix: FloatArray, reach: float) -> tuple[FloatArray, FloatArray]:
    """Each junction and its nearest reference junction, when that one lies within `reach` of where `matrix` puts it."""
    if len(points) == 0 or len(places) < CANDIDATES:
        return numpy.zeros((0, 2)), numpy.zeros((0, 2))
    index, gap = nearest(apply(matrix, points), places, 1)
    close = gap[:, 0] <= reach
    return points[close], places[index[close, 0]]


def agreeing(points: FloatArray, places: FloatArray, matrix: FloatArray, reach: float) -> Agreeing:
    """The closest pairs under `matrix` that one similarity (refitted as an affine) agrees with, within `reach / TIGHTEN`, one to one."""
    source, target = closest_pairs(points, places, matrix, reach)
    tolerance = reach / TIGHTEN
    consensus = ransac_similarity(source, target, tolerance, start=matrix)
    if consensus is None:
        return EMPTY
    model = affine(source[consensus.inliers], target[consensus.inliers])
    model = consensus.matrix if model is None else model
    kept_source, kept_target = one_to_one(source[consensus.inliers], target[consensus.inliers], model)
    gaps = numpy.hypot(*(apply(model, kept_source) - kept_target).T) if len(kept_source) else numpy.zeros(0)
    close = gaps <= tolerance
    return Agreeing(kept_source[close], kept_target[close], gaps[close])


def moved(matrix: FloatArray, shift: float) -> list[FloatArray]:
    """`matrix` moved `shift` Mercator metres in each of `DIRECTIONS` directions."""
    found = []
    for step in range(DIRECTIONS):
        angle = 2 * numpy.pi * step / DIRECTIONS
        copy = matrix.copy()
        copy[:, 2] += shift * numpy.array([numpy.cos(angle), numpy.sin(angle)])
        found.append(copy)
    return found


def chance(points: FloatArray, places: FloatArray, matrix: FloatArray, reach: float) -> int:
    """The most pairs any placement `SHIFT_REACHES` reaches away agrees with: what the street net gives by chance."""
    return max(agreeing(points, places, other, reach).count for other in moved(matrix, SHIFT_REACHES * reach))


def spread(points: FloatArray, gaps: FloatArray, extent: tuple[float, float, float, float]) -> numpy.ndarray:
    """The indices kept: the closest `PER_CELL` of each cell of a `CELLS` x `CELLS` grid over `extent`, at most `MAX_OFFERED`."""
    left, top, right, bottom = extent
    col = numpy.clip(((points[:, 0] - left) / max(right - left, 1e-9) * CELLS).astype(numpy.int64), 0, CELLS - 1)
    row = numpy.clip(((points[:, 1] - top) / max(bottom - top, 1e-9) * CELLS).astype(numpy.int64), 0, CELLS - 1)
    cells = col + CELLS * row
    order = numpy.lexsort((gaps, cells))
    rank = numpy.zeros(len(order), numpy.int64)
    for position in range(1, len(order)):
        same = cells[order[position]] == cells[order[position - 1]]
        rank[position] = rank[position - 1] + 1 if same else 0
    kept = order[rank < PER_CELL]
    return kept[numpy.argsort(gaps[kept], kind="stable")][:MAX_OFFERED]


def confidence(lift: float, gaps: FloatArray, tolerance: float) -> tuple[float, ...]:
    """Each pair's confidence: how far above chance the placement is (0 at chance, towards 1 far above) times how close it lies."""
    above = max(0.0, 1.0 - 1.0 / lift) if lift > 0 else 0.0
    close = 1.0 - 0.5 * numpy.clip(gaps / max(tolerance, 1e-9), 0.0, 1.0)
    return tuple(round(float(above * value), 3) for value in close)


def offer_from(
    points: FloatArray, places: FloatArray, matrix: FloatArray, reach: float, extent: tuple[float, float, float, float]
) -> Offered:
    """The pairs one placement offers, or `NOTHING` when they are too few or no better than chance."""
    found = agreeing(points, places, matrix, reach)
    if found.count < MIN_OFFERED:
        return NOTHING
    lift = found.count / max(1, chance(points, places, matrix, reach))
    if lift < MIN_LIFT:
        return NOTHING
    kept = spread(found.source, found.gaps, extent)
    return Offered(found.source[kept], found.target[kept], confidence(lift, found.gaps[kept], reach / TIGHTEN), lift)


def offer(
    points: FloatArray, places: FloatArray, placements: Sequence[FloatArray], reach_px: float, extent: tuple[float, float, float, float]
) -> Offered:
    """The pairs of the placement (the best, then its rivals) furthest above chance, each placement searched `reach_px` of the map's
    pixels around; `NOTHING` when none stands out."""
    tried = [offer_from(points, places, matrix, reach_px * scale_of(matrix), extent) for matrix in placements]
    return max(tried, key=lambda each: each.lift, default=NOTHING)
