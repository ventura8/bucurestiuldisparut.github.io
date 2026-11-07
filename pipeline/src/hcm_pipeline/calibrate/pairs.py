"""A proved frame's pairs (docs/research/M9-calibration.md §7).

Cells of 1,600 m, doubled until the pairs fit `DENSE_MAX_PAIRS`; one pair a cell, but with no buffer between cells, so two pairs either
side of a border can share pixels. Every fifth cell is set aside **before this RANSAC** (`measure`'s earlier rounds saw it: `proof.py`);
its strongest clear tile is a checkpoint (`enabled: false`), one over 100 m dropped and counted, the rest not trimmed: a dropped check
may be a false match or a part of the map that is wrong, nothing here can tell them apart, so `checkpointRmseM` is the survivors' figure
and any dropped check keeps the version from publishing itself (`approval.ts`). Of the other cells, each one's strongest inlier is a
pair. `affine` or `poly2` by a blocked 5-fold over the pairs; `tps` is never automatic.
"""

from dataclasses import dataclass
from typing import Final

import numpy
from numpy.typing import NDArray

from hcm_pipeline.calibrate.dense import PROOF_RANSAC_M
from hcm_pipeline.calibrate.poly import Mask, fit_poly, ground_errors, rmse_m, robust_fit
from hcm_pipeline.calibrate.proof import CHECK_FOLDS, CHECK_GROSS_M, PAIR_CELL_GROUND_M, cells_of, strongest_checks
from hcm_pipeline.contract import MIN_GCPS
from hcm_pipeline.geo import FloatArray, ground_scale, to_lnglat_arrays
from hcm_pipeline.georef.autogcp import AUTO_GCP_CHECKPOINT_SHARE, AUTO_GCP_MIN_CONFIDENCE, ID_DIGITS, MIN_POLY2_PAIRS
from hcm_pipeline.georef.matcher import MAX_AUTO_GCPS
from hcm_pipeline.georef.transforms import Fit, Gcp, fit

PAIR_CELL_DOUBLINGS: Final = 8
TRANSFORM_MIN_GAIN_M: Final = 2.0
PEAK_TO_SCORE: Final = 2.0
HELD_EVERY: Final = round(1 / AUTO_GCP_CHECKPOINT_SHARE)


def _cell_size(rows: FloatArray, middle_lat: float) -> float:
    """The cell's side in EPSG:3857 metres: doubled until the cells' pairs fit `MAX_AUTO_GCPS`."""
    cell = PAIR_CELL_GROUND_M / ground_scale(middle_lat)
    for _ in range(PAIR_CELL_DOUBLINGS):
        if numpy.unique(cells_of(rows[:, 2:4], cell)).size <= MAX_AUTO_GCPS:
            break
        cell *= 2
    return cell


def _per_cell(rows: FloatArray, cells: NDArray[numpy.int64]) -> FloatArray:
    """The strongest row of each cell, by cell."""
    found = [rows[cells == cell][int(rows[cells == cell, 4].argmax())] for cell in numpy.unique(cells).tolist()]
    return numpy.array(found, numpy.float64).reshape(-1, rows.shape[1])


@dataclass(frozen=True)
class Chosen:
    """What `choose` keeps: the pairs' rows, the checks' rows, how many checks went as gross errors."""

    pairs: FloatArray
    checks: FloatArray
    dropped: int


def choose(rows: FloatArray, order: int, middle_lat: float, seed: int) -> Chosen | None:
    """Pairs and checks from a proof's tiles; None when RANSAC finds nothing on the remaining cells."""
    cell = _cell_size(rows, middle_lat)
    cells = cells_of(rows[:, 2:4], cell)
    held = numpy.unique(cells)[::HELD_EVERY]
    rest = ~numpy.isin(cells, held)
    fitted = robust_fit(rows[rest, :2], rows[rest, 2:4], order, PROOF_RANSAC_M, seed)
    if fitted is None:
        return None
    pairs = _per_cell(rows[rest][fitted[1]], cells[rest][fitted[1]])
    checks = strongest_checks(rows, cells, held)
    errors = ground_errors(fitted[0](checks[:, :2]), checks[:, 2:4]) if len(checks) else numpy.empty(0)
    return Chosen(pairs, checks[errors <= CHECK_GROSS_M], int(numpy.count_nonzero(errors > CHECK_GROSS_M)))


def blocked_figure(pairs: FloatArray, order: int, cell_m: float) -> float | None:
    """The pairs' RMSE (ground metres) under a 5-fold whose folds are whole cells; None when no fold leaves enough to fit: a missing
    figure, never an infinite one, which a document cannot hold."""
    cells = cells_of(pairs[:, 2:4], cell_m)
    unique = numpy.unique(cells)
    folds = [numpy.isin(cells, unique[fold::CHECK_FOLDS]) for fold in range(CHECK_FOLDS)]
    errors = [_held_errors(pairs, held, order) for held in folds if _can_hold(held, order)]
    return rmse_m(numpy.concatenate(errors)) if errors else None


def _can_hold(held: Mask, order: int) -> bool:
    """A fold holds something and leaves more pairs than its own order needs."""
    return bool(held.any() and numpy.count_nonzero(~held) > MIN_GCPS["affine" if order == 1 else "poly2"])


def _held_errors(pairs: FloatArray, held: Mask, order: int) -> FloatArray:
    mapped = fit_poly(order, pairs[~held, :2], pairs[~held, 2:4])(pairs[held, :2])
    return ground_errors(mapped, pairs[held, 2:4])


def transform_of(pairs: FloatArray, middle_lat: float) -> tuple[str, float | None]:
    """`affine` or `poly2`, whichever earns it, and its blocked figure (None: too few pairs to hold any out)."""
    cell = 2 * PAIR_CELL_GROUND_M / ground_scale(middle_lat)
    affine = blocked_figure(pairs, 1, cell)
    curved = blocked_figure(pairs, 2, cell) if len(pairs) >= MIN_POLY2_PAIRS else None
    earned = affine is not None and curved is not None and affine - curved >= TRANSFORM_MIN_GAIN_M
    return ("poly2", curved) if earned else ("affine", affine)


def _gcps(rows: FloatArray, offset: tuple[int, int], enabled: bool, first: int) -> list[Gcp]:
    lng, lat = to_lnglat_arrays(rows[:, 2], rows[:, 3])
    found = []
    for index, (row, place_lng, place_lat) in enumerate(zip(rows.tolist(), lng.tolist(), lat.tolist(), strict=True), start=first):
        score = max(AUTO_GCP_MIN_CONFIDENCE, min(1.0, PEAK_TO_SCORE * row[4]))
        found.append(Gcp(f"a{index:0{ID_DIGITS}d}", row[0] - offset[0], row[1] - offset[1], place_lat, place_lng, enabled, "auto", score))
    return found


@dataclass(frozen=True)
class Calibrated:
    """The frame's automatic georeference: the fit, its pairs and checks, the blocked figure and what was dropped."""

    fitted: Fit
    cross_validated_m: float | None
    checks_dropped: int


@dataclass(frozen=True)
class ScanBox:
    """Where the scan lies in the film: its corner, and its size."""

    left: int
    top: int
    width: int
    height: int


def calibrated(rows: FloatArray, order: int, scan: ScanBox, middle_lat: float, seed: int) -> Calibrated | None:
    """The fit of a proof's tiles in the scan's pixels; None when the pairs do not fit: the matcher, or the admin, goes on."""
    chosen = choose(rows[_inside(rows, scan)], order, middle_lat, seed)
    if chosen is None or len(chosen.pairs) < MIN_GCPS["poly2"]:
        return None
    kind, figure = transform_of(chosen.pairs, middle_lat)
    offset = (scan.left, scan.top)
    pairs = _gcps(chosen.pairs, offset, True, 1)
    gcps = pairs + _gcps(chosen.checks, offset, False, len(pairs) + 1)
    result = fit(kind, gcps)
    return Calibrated(result, figure, chosen.dropped) if isinstance(result, Fit) else None


def _inside(rows: FloatArray, scan: ScanBox) -> Mask:
    x, y = rows[:, 0] - scan.left, rows[:, 1] - scan.top
    return numpy.asarray((x >= 0) & (x <= scan.width) & (y >= 0) & (y <= scan.height), numpy.bool_)
