"""Class c: one drawn map placed by its streets (docs/research/M20-import-local.md §3 c), and the path atlases and pieces end on.

1. Prepare: a working copy (long side `WORKING_PX`), its neat line found (`frame`) and everything outside it left out.
2. Street network: the classical path (`streets`). The AI path (a `RoadSegmenter` with explicitly licensed weights) is not built: no
   candidate was verified (§3 c step 2, UNVERIFIED), so the classical path is the only one.
3. Reference: the ladder's rungs, then OpenStreetMap, over the city's window grown by half (`reference`).
4. Coarse placement (`coarse`): chamfer over scales and rotations, the best few placements far from each other. The scale comes from
   the map's stated scale and its scan's dpi when both are known.
5. Fine fit and checks (`fine`) on each: the one agreeing with the most junction pairs wins, refused when the runner-up agrees with
   more than half as many (M9's rival share); the reference's own error is added in quadrature.
6. Warp: the original through the agreeing pairs, at the series' resolution (`raster_io`).

A placement that does not hold never fails the job: the version waits for a person (`low-confidence`, or `no-scale` when the map's scale
was unknown too) with the pairs that agree with one model, far above chance and spread, as suggestions (`suggest`), or none.
"""

from dataclasses import dataclass, replace
from pathlib import Path
from typing import Final

import numpy

from hcm_pipeline.geo import MercatorBox
from hcm_pipeline.jobs import JobContext, StepResult
from hcm_pipeline.placing import coarse, fine, ladder, suggest
from hcm_pipeline.placing.checks import gross_m, in_quadrature
from hcm_pipeline.placing.frame import find_frame
from hcm_pipeline.placing.geometry import FloatArray, apply
from hcm_pipeline.placing.output import Placement, finish, resolution_of, suggestions, wait_for_help
from hcm_pipeline.placing.raster_io import Pair, WarpPlan, Working, dpi_of, read_working, warp_by_pairs
from hcm_pipeline.placing.reference import Reference, city_window, references, window_resolution
from hcm_pipeline.placing.series import SeriesJob
from hcm_pipeline.placing.streets import grey_of, street_network

WORKING_PX: Final = 2400
LARGEST_WORKING_PX: Final = 6000
COARSE_WINDOW_PX: Final = 1000
MIDDLE_WINDOW_PX: Final = 1000
FINE_WINDOW_PX: Final = 2500
MIN_FINE_RESOLUTION: Final = 2.0
INCH_M: Final = 0.0254
# Without a stated scale the map may cover from this share of the city window's width up to all of it.
SMALLEST_SHARE: Final = 0.12
LARGEST_SHARE: Final = 1.0
SUGGEST_REACH_PX: Final = 40.0
# The fine pairing reaches this many pixels of the refined placement's reference.
REACH_PIXELS: Final = 4.0
# M9's rival share (`PROOF_MAX_RIVAL`): a rival agreeing with more than half the best's pairs refuses the placement.
RIVAL_MAX_SHARE: Final = 0.5
LOW_CONFIDENCE: Final = "No placement stood out against the reference: add about four points; pairs are suggested only where they agree."
NO_SCALE: Final = "The map states no scale and no placement stood out: add about four points; pairs are suggested only where they agree."
NO_WINDOW: Final = "The city has no bounds to look for this map in: set them in Settings, then retry."
NO_REFERENCE: Final = "No reference could be read for this city (OpenStreetMap did not answer): retry later, or add about four points."


@dataclass(frozen=True)
class Drawn:
    """A map's working copy: its skeleton points and junctions in working pixels, its extent, and full pixels per working pixel."""

    points: FloatArray
    junctions: FloatArray
    extent: tuple[float, float, float, float]
    scale: float
    path: Path
    name: str
    # Each junction's part (a sheet's name) when the map was assembled from parts; empty: every junction is the map's.
    parts: tuple[str, ...] = ()

    @property
    def size_px(self) -> float:
        left, top, right, bottom = self.extent
        return float(max(right - left, bottom - top))


def _crop(working: Working) -> tuple[int, int, int, int]:
    """The working copy's neat line as (left, top, right, bottom), or the whole copy when it has none."""
    corners = find_frame(grey_of(working.image))
    height, width = working.image.shape[:2]
    if corners is None:
        return 0, 0, width, height
    left, top = numpy.floor(corners.min(axis=0)).astype(int)
    right, bottom = numpy.ceil(corners.max(axis=0)).astype(int)
    return max(0, left), max(0, top), min(width, right), min(height, bottom)


def drawn_of(path: Path, name: str, size_px: int = WORKING_PX, framed: bool = True) -> Drawn:
    """The map's street skeleton and junctions inside its neat line, read with its long side at most `size_px` (never under
    `WORKING_PX`, never over `LARGEST_WORKING_PX`: an assembled atlas keeps its streets wide enough to find). An assembled canvas
    has no neat line of its own (`framed` false): all of it is the map."""
    working = read_working(path, min(LARGEST_WORKING_PX, max(WORKING_PX, size_px)))
    height, width = working.image.shape[:2]
    left, top, right, bottom = _crop(working) if framed else (0, 0, width, height)
    network = street_network(working.image[top:bottom, left:right])
    rows, cols = numpy.nonzero(network.skeleton)
    points = numpy.column_stack((cols + 0.5 + left, rows + 0.5 + top)).astype(numpy.float64)
    found = network.junctions() + numpy.array([left, top])
    return Drawn(points, found, (float(left), float(top), float(right), float(bottom)), working.scale, path, name)


def known_metres_per_px(drawn: Drawn, scale: int | None, ground: float) -> float | None:
    """Mercator metres per working pixel from the map's stated scale and its scan's dpi, when both are known."""
    dpi = dpi_of(drawn.path)
    if scale is None or dpi is None:
        return None
    return scale * INCH_M / dpi * drawn.scale / ground


@dataclass(frozen=True)
class Search:
    """How a map is searched for: the quarter turns tried, its Mercator metres per working pixel when known some other way (a grid's
    mosaic), and whether its fit stays rigid (an affine: a mosaic of sheets on a surveyed grid has no drafting distortion to absorb)."""

    turns: tuple[float, ...] = coarse.QUARTER_TURNS
    metres_per_px: float | None = None
    rigid: bool = False


def _coarse(reference: Reference, drawn: Drawn, window: MercatorBox, known: float | None, search: Search) -> coarse.Coarse | None:
    low = SMALLEST_SHARE * window.width / drawn.size_px
    high = LARGEST_SHARE * window.width / drawn.size_px
    tried = coarse.hypotheses(coarse.scales(known, low, high), search.turns)
    return coarse.search(reference, drawn.points, tried, drawn.size_px)


def footprint(matrix: FloatArray, drawn: Drawn, margin: float = 0.2) -> MercatorBox:
    """Where the coarse placement puts the map, grown by `margin`."""
    left, top, right, bottom = drawn.extent
    corners = apply(matrix, numpy.array([[left, top], [right, top], [right, bottom], [left, bottom]]))
    low, high = corners.min(axis=0), corners.max(axis=0)
    return MercatorBox(float(low[0]), float(low[1]), float(high[0]), float(high[1])).expanded(margin)


# A coarse placement (named here: the attempt's own field `coarse` hides the module in its class).
Placed = coarse.Coarse


@dataclass(frozen=True)
class Attempt:
    """What one map's placement found: the coarse placement, the fine fit, the reference it used and whether its rival was clean."""

    coarse: coarse.Coarse | None
    fit: fine.Fine | None
    reference: Reference | None
    rival_clean: bool = False
    # Without a placement that held: each reference rung's best placement and the rung's label, for the suggestions.
    tried: tuple[tuple[Placed, str], ...] = ()

    def held(self) -> tuple[fine.Fine, Reference] | None:
        """The fit and its reference when the placement holds: a fit that holds and a rival that agrees with far fewer pairs."""
        return _holding(self.fit, self.reference, self.rival_clean)


def _holding(fit: fine.Fine | None, reference: Reference | None, rival_clean: bool) -> tuple[fine.Fine, Reference] | None:
    if fit is None or reference is None:
        return None
    return (fit, reference) if fit.holds and rival_clean else None


def fit_from(ctx: JobContext, series: SeriesJob, drawn: Drawn, start: FloatArray, search: Search) -> Attempt:
    """A placement refined in fine steps on a closer reference, then fitted on junctions within a few of its pixels."""
    box = footprint(start, drawn)
    ground = fine.ground_of(box.bounds().middle_lat)
    middle = references(ctx, series.ladder, box, window_resolution(box, MIDDLE_WINDOW_PX))
    if not middle:
        return Attempt(None, None, None)
    refined = coarse.refine(middle[0], drawn.points, coarse.Coarse(start, coarse.MIN_SCORE), drawn.size_px)
    finer = references(ctx, series.ladder, box, max(MIN_FINE_RESOLUTION, window_resolution(box, FINE_WINDOW_PX)))
    parts = drawn.parts or (drawn.name,)
    problem = fine.Problem(drawn.junctions, drawn.extent, finer[0].places, ground, gross_m(series.scale), parts, search.rigid)
    reach = max(fine.MIN_REACH_M / ground, REACH_PIXELS * middle[0].grid.resolution)
    return Attempt(refined, fine.fit(problem, refined.matrix, reach), finer[0])


def rival_is_clean(best: fine.Fine | None, rival: fine.Fine | None) -> bool:
    """M9's rival search on junctions: the rival placement agrees with at most `RIVAL_MAX_SHARE` of the best's pairs."""
    if best is None:
        return False
    return rival is None or len(rival.source) <= RIVAL_MAX_SHARE * len(best.source)


def _agreeing(attempt: Attempt) -> int:
    return 0 if attempt.fit is None else len(attempt.fit.source)


def _fine(ctx: JobContext, series: SeriesJob, drawn: Drawn, found: coarse.Coarse, search: Search) -> Attempt:
    """Each candidate placement fitted; the one agreeing with the most pairs wins, the runner-up is its rival."""
    tried = sorted(
        (fit_from(ctx, series, drawn, start, search) for start in (found.matrix, *found.others)), key=lambda each: -_agreeing(each)
    )
    best, rival = tried[0], tried[1].fit if len(tried) > 1 else None
    return replace(best, coarse=best.coarse or found, rival_clean=rival_is_clean(best.fit, rival))


DEFAULT_SEARCH: Final = Search()


def attempt(ctx: JobContext, series: SeriesJob, drawn: Drawn, window: MercatorBox, search: Search = DEFAULT_SEARCH) -> Attempt | None:
    """The coarse placement on the first reference rung that gives one, then the fine fit; None when no reference could be read."""
    rungs = references(ctx, series.ladder, window, window_resolution(window, COARSE_WINDOW_PX))
    if not rungs:
        return None
    each = [_coarse(coarse.loosened(rung), drawn, window, _known(series, drawn, window, search), search) for rung in rungs]
    holding = _holding_placements(_placements(each))
    return _fine(ctx, series, drawn, holding[0], search) if holding else _unplaced(each, rungs)


def _unplaced(each: list[Placed | None], rungs: list[Reference]) -> Attempt:
    """No rung gave a placement that holds: the best of them, and each rung's own for the suggestions."""
    tried = tuple((placed, rung.label) for placed, rung in zip(each, rungs, strict=True) if placed is not None)
    return Attempt(_best(_placements(each)), None, rungs[-1], tried=tried)


def _holding_placements(found: list[coarse.Coarse]) -> list[coarse.Coarse]:
    return [placed for placed in found if placed.holds]


def _known(series: SeriesJob, drawn: Drawn, window: MercatorBox, search: Search) -> float | None:
    """The map's Mercator metres per working pixel when the search or the map's stated scale says it."""
    return search.metres_per_px or known_metres_per_px(drawn, series.scale, fine.ground_of(window.bounds().middle_lat))


def _best(found: list[coarse.Coarse]) -> coarse.Coarse | None:
    return max(found, key=lambda placed: placed.score, default=None)


def _placements(found: list[coarse.Coarse | None]) -> list[coarse.Coarse]:
    return [placed for placed in found if placed is not None]


def _pairs(source: FloatArray, target: FloatArray, scale: float) -> list[Pair]:
    return [Pair(float(x * scale), float(y * scale), float(mx), float(my)) for (x, y), (mx, my) in zip(source, target, strict=True)]


def _closer(ctx: JobContext, series: SeriesJob, drawn: Drawn, placed: coarse.Coarse, label: str) -> suggest.Offered:
    """What one rung's placement offers, against that rung read finely over where the placement puts the map."""
    box = footprint(placed.matrix, drawn)
    finer = references(ctx, series.ladder, box, max(MIN_FINE_RESOLUTION, window_resolution(box, FINE_WINDOW_PX)))
    rung = next((reference for reference in finer if reference.label == label), None)
    if rung is None:
        return suggest.NOTHING
    offered = suggest.offer(drawn.junctions, rung.places, (placed.matrix, *placed.others), SUGGEST_REACH_PX, drawn.extent)
    return replace(offered, reference=label)


def offered_pairs(ctx: JobContext, series: SeriesJob, drawn: Drawn, found: Attempt) -> suggest.Offered:
    """The pairs of the rung whose placement stands furthest above chance; `suggest.NOTHING` when none does."""
    tried = found.tried or _fitted_try(found)
    offers = [_closer(ctx, series, drawn, placed, label) for placed, label in tried]
    return max(offers, key=lambda each: each.lift, default=suggest.NOTHING)


def _fitted_try(found: Attempt) -> tuple[tuple[Placed, str], ...]:
    """A placement that was fitted but did not hold: its refined placement on the rung it was fitted on."""
    return ((found.coarse, found.reference.label),) if found.coarse and found.reference else ()


def _rung_named(series: SeriesJob, label: str) -> ladder.Rung | None:
    return next((each for each in series.ladder if each.label == label), None)


def _why(series: SeriesJob) -> tuple[str, str]:
    return ("low-confidence", LOW_CONFIDENCE) if series.scale else ("no-scale", NO_SCALE)


def _help(ctx: JobContext, series: SeriesJob, drawn: Drawn, found: Attempt) -> StepResult:
    reason, note = _why(series)
    if found.coarse is None or found.reference is None:
        return wait_for_help(ctx, reason, note)
    offered = offered_pairs(ctx, series, drawn, found)
    ctx.log.info(f"offers {offered.count} pairs from {offered.reference}, {offered.lift:.1f} times what chance gives", ctx.step)
    pairs = _pairs(offered.source, offered.target, drawn.scale)
    found_on = _rung_named(series, offered.reference)
    return wait_for_help(ctx, reason, note, suggestions(ctx, pairs, offered.scores, len(drawn.junctions), found_on))


def place_map(ctx: JobContext, series: SeriesJob, drawn: Drawn, method: str = "match", placed: int = 1) -> StepResult:
    """One map placed by its streets, or parked for a person with the closest pairs."""
    window = city_window(ctx)
    if window is None:
        return wait_for_help(ctx, "low-confidence", NO_WINDOW)
    series = replace(series, ladder=ladder.rungs(ctx, series.reference_layers))
    found = attempt(ctx, series, drawn, window)
    if found is None:
        return wait_for_help(ctx, "low-confidence", NO_REFERENCE)
    held = found.held()
    if held is None:
        return _help(ctx, series, drawn, found)
    return _warped(ctx, series, drawn, held, (method, placed))


def _warped(ctx: JobContext, series: SeriesJob, drawn: Drawn, held: tuple[fine.Fine, Reference], how: tuple[str, int]) -> StepResult:
    """The original warped through the fit's pairs, and the report with the reference's own error in quadrature."""
    fit, reference = held
    method, placed = how
    checked = replace(fit.checked, rmse_m=in_quadrature(fit.checked.rmse_m, reference.error_m))
    plan = WarpPlan(_pairs(fit.source, fit.target, drawn.scale), resolution_of(ctx.job.params), fit.transform.kind == "tps", series.nearest)
    warped = warp_by_pairs(drawn.path, ctx.local("warped.tif"), plan)
    placement = Placement(method, series.encoding, checked, True, series.scale, series.paper_transparent)
    return finish(ctx, placement, warped, placed)
