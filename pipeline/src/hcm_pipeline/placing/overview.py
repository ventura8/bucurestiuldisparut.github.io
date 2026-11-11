"""Place tiles on their overview map using ORB feature matching.

This module provides a pure-function pipeline that locates a tile on a
smaller-scale overview map by matching ORB features, then returns the
affine transform (tile -> overview pixels).  A helper parses the tile's
row/column from its file name to produce a positional hint.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

import cv2
import numpy as np

_MIN_MATCHES = 4
_MIN_KEYPOINTS = 10
_MIN_INLIERS = 25


@dataclass(frozen=True)
class TileFit:
    """Affine fit of a tile onto the overview in pixel coordinates."""

    matrix: np.ndarray
    inliers: int
    rms_px: float


@dataclass(frozen=True)
class MosaicReport:
    """Summary of tiles placed and unplaced in the mosaic."""

    placed: list[str]
    unplaced: list[str]
    rms_px: float


def _base_scale(tile: np.ndarray, overview: np.ndarray) -> float:
    """Estimate the downscale factor from the tile/overview size ratio."""
    th, tw = tile.shape[:2]
    oh, ow = overview.shape[:2]
    ratio = float(min(th / oh, tw / ow))
    return 1.0 / ratio


def _orb_detect(img: np.ndarray) -> tuple[list[Any], np.ndarray | None]:
    """Detect ORB keypoints and descriptors on a grey image."""
    orb = cv2.ORB.create(nfeatures=4000)
    kp, des = orb.detectAndCompute(img, None)
    return list(kp), des


def _descriptors_ok(
    des_t: np.ndarray | None,
    des_o: np.ndarray | None,
    kp_t: list[Any],
    kp_o: list[Any],
) -> tuple[np.ndarray, np.ndarray] | None:
    """Check that both descriptor sets are valid and sufficient."""
    if des_t is None:
        return None
    if des_o is None:
        return None
    if len(kp_t) < _MIN_KEYPOINTS:
        return None
    if len(kp_o) < _MIN_KEYPOINTS:
        return None
    return des_t, des_o


def _ratio_match(des_t: np.ndarray, des_o: np.ndarray) -> list[Any]:
    """Match descriptors with BFMatcher (Hamming) and ratio test 0.75."""
    bf = cv2.BFMatcher(cv2.NORM_HAMMING)
    matches = bf.knnMatch(des_t, des_o, k=2)
    return [m[0] for m in matches if m[0].distance < 0.75 * m[1].distance]


def _filter_by_hint(
    src: np.ndarray,
    dst: np.ndarray,
    hint: tuple[float, float],
    half_w: float,
    half_h: float,
) -> tuple[np.ndarray, np.ndarray]:
    """Keep only matches within 1.5 tile sizes of the hint centre."""
    hx, hy = hint
    mask = (dst[:, 0] > hx - half_w) & (dst[:, 0] < hx + half_w) & (dst[:, 1] > hy - half_h) & (dst[:, 1] < hy + half_h)
    return src[mask], dst[mask]


def _apply_hint(
    src: np.ndarray,
    dst: np.ndarray,
    hint: tuple[float, float] | None,
    half_w: float,
    half_h: float,
) -> tuple[np.ndarray, np.ndarray] | None:
    """Apply the hint window filter; return None if too few points remain."""
    if hint is None:
        return src, dst
    src, dst = _filter_by_hint(src, dst, hint, half_w, half_h)
    if len(src) < _MIN_MATCHES:
        return None
    return src, dst


def _affine_fit(src: np.ndarray, dst: np.ndarray) -> TileFit | None:
    """Estimate affine partial 2D with RANSAC and compute RMS error."""
    matrix, inliers = cv2.estimateAffinePartial2D(src, dst, method=cv2.RANSAC, ransacReprojThreshold=4.0)
    n = int(inliers.sum())
    if n < _MIN_INLIERS:
        return None
    mapped = src @ matrix[:, :2].T + matrix[:, 2]
    rms = float(np.sqrt(np.mean(np.sum((mapped - dst) ** 2, axis=1))))
    return TileFit(matrix=matrix, inliers=n, rms_px=rms)


def _match_at_scale(
    tile: np.ndarray,
    overview: np.ndarray,
    scale: float,
    hint: tuple[float, float] | None,
) -> TileFit | None:
    """Run the full matching pipeline at a given downscale factor."""
    new_w = max(1, int(tile.shape[1] / scale))
    new_h = max(1, int(tile.shape[0] / scale))
    resized = cv2.resize(tile, (new_w, new_h), interpolation=cv2.INTER_AREA)

    kp_t, des_t = _orb_detect(resized)
    kp_o, des_o = _orb_detect(overview)
    des = _descriptors_ok(des_t, des_o, kp_t, kp_o)
    if des is None:
        return None
    des_t, des_o = des

    good = _ratio_match(des_t, des_o)
    if len(good) < _MIN_MATCHES:
        return None

    src = np.array([kp_t[m.queryIdx].pt for m in good], dtype=np.float32)
    dst = np.array([kp_o[m.trainIdx].pt for m in good], dtype=np.float32)

    pts = _apply_hint(src, dst, hint, new_w * 0.75, new_h * 0.75)
    if pts is None:
        return None
    src, dst = pts

    fit = _affine_fit(src, dst)
    if fit is None:
        return None
    matrix = fit.matrix.copy()
    matrix[:, :2] /= scale
    return TileFit(matrix=matrix, inliers=fit.inliers, rms_px=fit.rms_px)


def _better(a: TileFit | None, b: TileFit) -> bool:
    """Return True if *b* is a better fit than *a*."""
    return a is None or b.inliers > a.inliers


def tile_on_overview(
    tile: np.ndarray,
    overview: np.ndarray,
    hint: tuple[float, float] | None,
) -> TileFit | None:
    """Match a tile onto the overview via ORB features.

    The tile is downscaled to the overview's scale (estimated from the
    size ratio, trying three scales around it), ORB features are detected
    on both images, matches are filtered with a ratio test, and an affine
    partial-2D transform is estimated with RANSAC (reprojection 4 px).

    When *hint* is provided the search window is limited to 1.5 tile
    sizes around the expected centre.

    Returns a :class:`TileFit` or ``None`` if fewer than 25 inliers.
    """
    base = _base_scale(tile, overview)
    scales = (base * 0.8, base, base * 1.2)
    best: TileFit | None = None
    for s in scales:
        fit = _match_at_scale(tile, overview, s, hint)
        if fit is not None and _better(best, fit):
            best = fit
    return best


def _parse_rc(name: str, rows: int, cols: int) -> tuple[int, int] | None:
    """Parse row/col from a tile file name.  Returns 0-indexed (row, col)."""
    patterns = (
        (r"r(\d+)c(\d+)", re.IGNORECASE),
        (r"(\d+)_(\d+)", 0),
        (r"(\d+)-(\d+)", 0),
    )
    for pat, flags in patterns:
        m = re.search(pat, name, flags)
        if m is not None:
            return int(m.group(1)) - 1, int(m.group(2)) - 1
    letter = _parse_letter(name)
    if letter is not None:
        return letter
    return _parse_sheet(name, rows, cols)


def _parse_letter(name: str) -> tuple[int, int] | None:
    """Parse a letter+number pattern like A3 or C12 (letter = row)."""
    m = re.search(r"([A-Z])(\d+)", name)
    if m is None:
        return None
    row = ord(m.group(1).upper()) - ord("A")
    return row, int(m.group(2)) - 1


def _parse_sheet(name: str, rows: int, cols: int) -> tuple[int, int] | None:
    """Parse a sheet number and convert to row/col (row-major, 1-indexed)."""
    m = re.search(r"(\d+)", name)
    if m is None:
        return None
    sheet = int(m.group(1))
    if not (1 <= sheet <= rows * cols):
        return None
    idx = sheet - 1
    return idx // cols, idx % cols


def grid_hint(
    name: str,
    rows: int,
    cols: int,
    overview_shape: tuple[int, int],
) -> tuple[float, float] | None:
    """Compute the expected tile centre on the overview from the file name.

    Supported patterns (1-indexed):

    * ``r03c07`` - explicit row/col
    * ``3_7`` - row_col
    * ``03-07`` - row-col
    * ``A3`` / ``C12`` - letter (row) + number (col)
    * ``123`` - sheet number, read row-major (validated against rows*cols)

    Returns ``(cx, cy)`` in overview pixels, or ``None`` if the name
    does not contain a recognisable pattern.
    """
    rc = _parse_rc(name, rows, cols)
    if rc is None:
        return None
    r, c = rc
    oh, ow = overview_shape
    cy = (r + 0.5) * oh / rows
    cx = (c + 0.5) * ow / cols
    return (cx, cy)


def _paste_tile(
    canvas: np.ndarray,
    tile: np.ndarray,
    matrix: np.ndarray,
    upscale: float,
) -> None:
    """Warp a tile onto the canvas using the scaled affine matrix."""
    m_canvas = matrix * upscale
    ch, cw = canvas.shape[:2]
    warped = cv2.warpAffine(
        tile,
        m_canvas,
        (cw, ch),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=0,
    )
    mask_src = np.full(tile.shape[:2], 255, dtype=np.uint8)
    mask = cv2.warpAffine(
        mask_src,
        m_canvas,
        (cw, ch),
        flags=cv2.INTER_NEAREST,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=0,
    )
    valid = mask > 0
    canvas[valid] = warped[valid]


def mosaic_on_overview(
    tiles: Sequence[tuple[str, np.ndarray]],
    overview: np.ndarray,
    rows: int,
    cols: int,
    upscale: float,
) -> tuple[np.ndarray, MosaicReport]:
    """Assemble a mosaic canvas from tiles placed on the overview.

    The canvas is the overview resized by *upscale*, filled with 255
    (paper) where no tile lands.  Each tile is matched via
    :func:`tile_on_overview` and warped onto the canvas with the fit
    matrix scaled by *upscale*.  Tiles that fail to match are listed in
    the report's ``unplaced`` field.

    Returns the canvas and a :class:`MosaicReport`.
    """
    oh, ow = overview.shape[:2]
    canvas_h = int(oh * upscale)
    canvas_w = int(ow * upscale)
    canvas = np.full((canvas_h, canvas_w), 255, dtype=np.uint8)

    placed: list[str] = []
    unplaced: list[str] = []
    rms_values: list[float] = []

    for name, tile in tiles:
        hint = grid_hint(name, rows, cols, overview.shape)
        fit = tile_on_overview(tile, overview, hint)
        if fit is None:
            unplaced.append(name)
            continue
        _paste_tile(canvas, tile, fit.matrix, upscale)
        placed.append(name)
        rms_values.append(fit.rms_px)

    rms = float(np.mean(rms_values)) if rms_values else 0.0
    report = MosaicReport(placed=placed, unplaced=unplaced, rms_px=rms)
    return canvas, report
