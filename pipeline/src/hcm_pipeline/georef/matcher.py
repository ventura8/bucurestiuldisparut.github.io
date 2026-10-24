"""Automatic GCPs (docs/research/M3-interfaces.md §5.6): the scan matched against the Sentinel-2 reference.

1. The scan is pre-warped with the current transform onto the reference grid, so scale and rotation are mostly gone.
2. Both are enhanced with CLAHE.
3. Coarse to fine over three levels (1/4, 1/2, 1 of the reference's 10 m): the pre-warped scan is cut into an 8 x 8
   grid; per cell, SIFT features are matched against the reference's within a search window (± 400 m at the
   coarsest level, halved per level) with Lowe's ratio 0.75; a cell without one falls back to the normalized
   cross-correlation of its centre patch.
4. RANSAC (`cv2.estimateAffine2D`, 3 px, confidence 0.999, 5,000 iterations, seeded) keeps the inliers, at most
   two per cell so the pairs spread; each level's pairs refit the transform the next level pre-warps with.
5. Each kept pair goes back to scan pixels through the pre-warp's inverse: a GCP with `origin: 'auto'` and a
   `score` (the ratio margin, or the correlation peak, times the RANSAC inlier share).
"""

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Final

import cv2
import numpy
from numpy.typing import NDArray

from hcm_pipeline.geo import FloatArray, Grid, to_lnglat_arrays
from hcm_pipeline.georef.transforms import Gcp, fit_transform, spread_share
from hcm_pipeline.images import UInt8Array, as_uint8, enhance, resize

PixelMap = Callable[[FloatArray, FloatArray], tuple[FloatArray, FloatArray]]
BoolArray = NDArray[numpy.bool_]

LEVELS: Final = ((4, 400.0), (2, 200.0), (1, 100.0))
CELLS: Final = 8
RATIO: Final = 0.75
RANSAC_PX: Final = 3.0
RANSAC_CONFIDENCE: Final = 0.999
RANSAC_ITERATIONS: Final = 5000
PER_CELL: Final = 2
PATCH_PX: Final = 24
MIN_CORRELATION: Final = 0.6
MIN_RANSAC: Final = 3
MAX_AUTO_GCPS: Final = 200
MIN_AFFINE_PAIRS: Final = 6
MIN_POLY2_PAIRS: Final = 12
WELL_SPREAD: Final = 0.25


@dataclass(frozen=True)
class Candidate:
    """A match on one level: a point of the pre-warped scan and its point in the reference (grid pixels)."""

    cell: int
    scan: tuple[float, float]
    reference: tuple[float, float]
    score: float


@dataclass(frozen=True)
class Scan:
    """The scan's pixels at full resolution and its approximate ground size per pixel (EPSG:3857 metres)."""

    pixels: UInt8Array
    resolution: float


def _shrunk(scan: Scan, resolution: float) -> tuple[UInt8Array, float]:
    """The scan downsampled to about two of its pixels per grid pixel, and the factor (so the pre-warp does not alias)."""
    factor = resolution / scan.resolution / 2
    if factor <= 1.0:
        return scan.pixels, 1.0
    height, width = scan.pixels.shape
    shrunk_width = max(1, round(width / factor))
    return resize(scan.pixels, (shrunk_width, max(1, round(height / factor)))), width / shrunk_width


def prewarp(scan: Scan, to_pixel: PixelMap, grid: Grid) -> tuple[UInt8Array, BoolArray]:
    """The scan resampled onto `grid` (mercator to scan pixel through `to_pixel`), and the mask it covers."""
    pixels, factor = _shrunk(scan, grid.resolution)
    px, py = to_pixel(*grid.centres())
    height, width = scan.pixels.shape
    inside = (px >= 0) & (px < width) & (py >= 0) & (py < height)
    warped = cv2.remap(
        pixels, (px / factor - 0.5).astype(numpy.float32), (py / factor - 0.5).astype(numpy.float32), cv2.INTER_LINEAR, borderValue=0
    )
    return as_uint8(warped), inside


def _keypoints(image: UInt8Array, mask: BoolArray | None) -> tuple[FloatArray, NDArray[numpy.float32]]:
    sift = cv2.SIFT.create()
    found, descriptors = sift.detectAndCompute(image, None if mask is None else mask.astype(numpy.uint8))
    points = numpy.array([point.pt for point in found], numpy.float64).reshape(-1, 2) + 0.5
    return points, numpy.asarray(descriptors if descriptors is not None else numpy.zeros((0, 128)), numpy.float32)


def _cell_of(points: FloatArray, width: int, height: int) -> NDArray[numpy.int64]:
    cx = numpy.clip((points[:, 0] / width * CELLS).astype(numpy.int64), 0, CELLS - 1)
    cy = numpy.clip((points[:, 1] / height * CELLS).astype(numpy.int64), 0, CELLS - 1)
    return cy * CELLS + cx


@dataclass(frozen=True)
class _Features:
    points: FloatArray
    descriptors: NDArray[numpy.float32]


def _passing(pair: Sequence[cv2.DMatch], scan: _Features, reference: _Features, search_px: float) -> tuple[int, int, float] | None:
    """The pair's best match when it passes Lowe's ratio and lies within the search window."""
    best, second = pair[0], pair[1]
    shift = float(numpy.hypot(*(scan.points[best.queryIdx] - reference.points[best.trainIdx])))
    passes = best.distance < RATIO * second.distance and shift <= search_px
    return (best.queryIdx, best.trainIdx, 1.0 - best.distance / max(second.distance, 1e-9)) if passes else None


def _enough(scan: _Features, reference: _Features) -> bool:
    return len(scan.points) > 0 and len(reference.points) >= PER_CELL


def _ratio_matches(scan: _Features, reference: _Features, search_px: float) -> list[tuple[int, int, float]]:
    """(scan index, reference index, ratio margin) of the matches that pass Lowe's ratio within the search window."""
    pairs = cv2.BFMatcher(cv2.NORM_L2).knnMatch(scan.descriptors, reference.descriptors, k=PER_CELL) if _enough(scan, reference) else []
    return [found for found in (_passing(pair, scan, reference, search_px) for pair in pairs) if found is not None]


def _near(points: FloatArray, centre: tuple[float, float], radius: float) -> BoolArray:
    return (numpy.abs(points[:, 0] - centre[0]) <= radius) & (numpy.abs(points[:, 1] - centre[1]) <= radius)


def _cell_box(cell: int, width: int, height: int) -> tuple[float, float, float]:
    """A cell's centre and half size (the larger side), in grid pixels."""
    row, column = divmod(cell, CELLS)
    cell_w, cell_h = width / CELLS, height / CELLS
    return (column + 0.5) * cell_w, (row + 0.5) * cell_h, max(cell_w, cell_h) / 2


def _sift_cell(cell: int, scan: _Features, reference: _Features, size: tuple[int, int], search_px: float) -> list[Candidate]:
    cx, cy, half = _cell_box(cell, *size)
    mine = numpy.flatnonzero(_cell_of(scan.points, *size) == cell)
    theirs = numpy.flatnonzero(_near(reference.points, (cx, cy), half + search_px))
    local_scan = _Features(scan.points[mine], scan.descriptors[mine])
    local_reference = _Features(reference.points[theirs], reference.descriptors[theirs])
    return [
        Candidate(cell, tuple(local_scan.points[i]), tuple(local_reference.points[j]), margin)
        for i, j, margin in _ratio_matches(local_scan, local_reference, search_px)
    ]


def _correlate_cell(cell: int, warped: UInt8Array, reference: UInt8Array, search_px: float) -> list[Candidate]:
    """The cell's centre patch found in the reference by normalized cross-correlation (the SIFT fallback)."""
    height, width = warped.shape
    cx, cy, _ = _cell_box(cell, width, height)
    x0, y0 = int(cx) - PATCH_PX // 2, int(cy) - PATCH_PX // 2
    reach = int(search_px)
    if min(x0 - reach, y0 - reach) < 0 or max(x0 + PATCH_PX + reach - width, y0 + PATCH_PX + reach - height) > 0:
        return []
    patch = warped[y0 : y0 + PATCH_PX, x0 : x0 + PATCH_PX]
    area = reference[y0 - reach : y0 + PATCH_PX + reach, x0 - reach : x0 + PATCH_PX + reach]
    _, peak, _, (best_x, best_y) = cv2.minMaxLoc(cv2.matchTemplate(area, patch, cv2.TM_CCOEFF_NORMED))
    if peak < MIN_CORRELATION or float(patch.std()) == 0.0:
        return []
    centre = (x0 + PATCH_PX / 2, y0 + PATCH_PX / 2)
    return [Candidate(cell, centre, (centre[0] + best_x - reach, centre[1] + best_y - reach), float(peak))]


def _level_candidates(warped: UInt8Array, inside: BoolArray, reference: UInt8Array, search_px: float) -> list[Candidate]:
    mask = cv2.erode(inside.astype(numpy.uint8), numpy.ones((5, 5), numpy.uint8)).astype(bool)
    scan_features, reference_features = _Features(*_keypoints(warped, mask)), _Features(*_keypoints(reference, None))
    size = (warped.shape[1], warped.shape[0])
    found: list[Candidate] = []
    for cell in range(CELLS * CELLS):
        found += _sift_cell(cell, scan_features, reference_features, size, search_px) or _correlate_cell(cell, warped, reference, search_px)
    return found


def _points(candidates: list[Candidate]) -> tuple[NDArray[numpy.float32], NDArray[numpy.float32]]:
    source = numpy.array([candidate.scan for candidate in candidates], numpy.float32)
    return source, numpy.array([candidate.reference for candidate in candidates], numpy.float32)


def _inliers(candidates: list[Candidate]) -> list[Candidate]:
    """The candidates RANSAC keeps under one affine map (none when there are too few to try)."""
    if len(candidates) < MIN_RANSAC:
        return []
    _, inliers = cv2.estimateAffine2D(
        *_points(candidates), method=cv2.RANSAC, ransacReprojThreshold=RANSAC_PX, maxIters=RANSAC_ITERATIONS, confidence=RANSAC_CONFIDENCE
    )
    flags = numpy.ravel(inliers).astype(bool).tolist() if inliers is not None else [False] * len(candidates)
    return [candidate for candidate, kept in zip(candidates, flags, strict=True) if kept]


def _consensus(candidates: list[Candidate]) -> list[Candidate]:
    """The RANSAC inliers, at most two per cell (the best scores), each scored times the inlier share."""
    kept = _inliers(candidates)
    share = len(kept) / max(1, len(candidates))
    best: dict[int, list[Candidate]] = {}
    for candidate in sorted(kept, key=lambda entry: -entry.score):
        best.setdefault(candidate.cell, []).append(Candidate(candidate.cell, candidate.scan, candidate.reference, candidate.score * share))
    return [candidate for cell in sorted(best) for candidate in best[cell][:PER_CELL]]


def _to_gcps(pairs: list[Candidate], to_pixel: PixelMap, grid: Grid) -> list[Gcp]:
    """The pairs as GCPs: the pre-warped point back to scan pixels, the reference point to WGS84."""
    if not pairs:
        return []
    scan_u, scan_v = numpy.array([pair.scan for pair in pairs]).T
    ref_u, ref_v = numpy.array([pair.reference for pair in pairs]).T
    px, py = to_pixel(*grid.to_mercator(scan_u, scan_v))
    lng, lat = to_lnglat_arrays(*grid.to_mercator(ref_u, ref_v))
    return [
        Gcp(f"a{index:03d}", float(x), float(y), float(la), float(lo), True, "auto", min(1.0, max(0.0, pair.score)))
        for index, (pair, x, y, la, lo) in enumerate(zip(pairs, px, py, lat, lng, strict=True), start=1)
    ]


def _spread(gcps: list[Gcp]) -> float:
    return spread_share(numpy.array([gcp.x for gcp in gcps]), numpy.array([gcp.y for gcp in gcps])) if gcps else 0.0


def transform_kind(gcps: list[Gcp]) -> str | None:
    """`poly2` from 12 well-spread pairs, `affine` from 6, None below (the thin-plate spline is never chosen here)."""
    if len(gcps) >= MIN_POLY2_PAIRS and _spread(gcps) >= WELL_SPREAD:
        return "poly2"
    return "affine" if len(gcps) >= MIN_AFFINE_PAIRS else None


def _inside_scan(gcps: list[Gcp], width: int, height: int) -> list[Gcp]:
    return [gcp for gcp in gcps if 0 <= gcp.x <= width and 0 <= gcp.y <= height]


def match(scan: Scan, initial: PixelMap, reference: UInt8Array, grid: Grid) -> list[Gcp]:
    """Automatic GCPs of the scan against the reference on `grid`, coarse to fine; fewer than 6 when it fails."""
    to_pixel, gcps = initial, []
    height, width = scan.pixels.shape
    for factor, search_m in LEVELS:
        level = grid.scaled(factor)
        warped, inside = prewarp(scan, to_pixel, level)
        pairs = _consensus(
            _level_candidates(enhance(warped), inside, enhance(resize(reference, (level.width, level.height))), search_m / level.resolution)
        )
        found = _inside_scan(_to_gcps(pairs, to_pixel, level), width, height)
        kind = transform_kind(found)
        refit = fit_transform(kind, found) if kind is not None else None
        if refit is not None:
            to_pixel, gcps = refit.to_pixel, found
    return sorted(gcps, key=lambda gcp: -(gcp.score or 0.0))[:MAX_AUTO_GCPS]
