"""Tests for the overview tile placement module (synthetic data, no files)."""

from __future__ import annotations

import numpy as np
from hcm_pipeline.placing.overview import grid_hint, tile_on_overview


def _draw_cell_features(
    img: np.ndarray,
    rng: np.random.Generator,
    y0: int,
    x0: int,
) -> None:
    """Draw internal features (lines and blocks) in one cell."""
    # Horizontal lines (roads)
    for _ in range(8):
        ly = int(rng.integers(y0 + 5, y0 + 195))
        lx0 = int(rng.integers(x0, x0 + 90))
        lx1 = int(rng.integers(x0 + 90, x0 + 195))
        t = int(rng.integers(1, 3))
        img[max(0, ly - t) : ly + t + 1, lx0:lx1] = int(rng.integers(30, 100))
    # Vertical lines (roads)
    for _ in range(8):
        lx = int(rng.integers(x0 + 5, x0 + 195))
        ly0 = int(rng.integers(y0, y0 + 90))
        ly1 = int(rng.integers(y0 + 90, y0 + 195))
        t = int(rng.integers(1, 3))
        img[ly0:ly1, max(0, lx - t) : lx + t + 1] = int(rng.integers(30, 100))
    # Blocks (outlines)
    for _ in range(5):
        bx = int(rng.integers(x0 + 5, x0 + 150))
        by = int(rng.integers(y0 + 5, y0 + 150))
        bw = int(rng.integers(20, 50))
        bh = int(rng.integers(20, 50))
        val = int(rng.integers(40, 130))
        img[by : by + bh, bx : bx + 2] = val
        img[by : by + bh, bx + bw - 2 : bx + bw] = val
        img[by : by + 2, bx : bx + bw] = val
        img[by + bh - 2 : by + bh, bx : bx + bw] = val
    # Small filled rectangles
    for _ in range(4):
        bx = int(rng.integers(x0 + 5, x0 + 170))
        by = int(rng.integers(y0 + 5, y0 + 170))
        bw = int(rng.integers(10, 25))
        bh = int(rng.integers(10, 25))
        img[by : by + bh, bx : bx + bw] = int(rng.integers(50, 160))


def _make_overview(shape: tuple[int, int] = (800, 800)) -> np.ndarray:
    """Create a synthetic street-like overview with lines and blocks."""
    rng = np.random.default_rng(42)
    img = np.full(shape, 220, dtype=np.uint8)

    # Major grid streets (5 horizontal + 5 vertical for a 4x4 layout)
    for i in range(5):
        pos = i * 200
        img[max(0, pos - 3) : pos + 4, :] = 40
        img[:, max(0, pos - 3) : pos + 4] = 40

    # Internal features per cell to give ORB enough corners
    for r in range(4):
        for c in range(4):
            _draw_cell_features(img, rng, r * 200 + 20, c * 200 + 20)

    return img


def _make_tile(
    overview: np.ndarray,
    row: int,
    col: int,
    grid: tuple[int, int],
    *,
    upscale: int,
) -> np.ndarray:
    """Cut a tile from the overview and upscale it by *upscale*x."""
    rows, cols = grid
    ch = overview.shape[0] // rows
    cw = overview.shape[1] // cols
    y0 = row * ch
    x0 = col * cw
    crop = overview[y0 : y0 + ch, x0 : x0 + cw]
    return np.repeat(np.repeat(crop, upscale, axis=0), upscale, axis=1)


def test_tile_on_overview_fits_within_2px() -> None:
    """Each of 4 tiles should be placed within 2 px of the true offset."""
    overview = _make_overview((800, 800))
    rows, cols = 4, 4
    upscale = 2

    cells = [(0, 0), (0, 1), (1, 0), (1, 1)]
    for r, c in cells:
        tile = _make_tile(overview, r, c, (rows, cols), upscale=upscale)
        hint = grid_hint(f"r{r + 1:02d}c{c + 1:02d}", rows, cols, overview.shape)
        assert hint is not None

        fit = tile_on_overview(tile, overview, hint)
        assert fit is not None, f"Tile ({r},{c}) should produce a fit"

        tw, th = tile.shape[1], tile.shape[0]
        tcx, tcy = tw / 2.0, th / 2.0
        mx = fit.matrix[0, 0] * tcx + fit.matrix[0, 1] * tcy + fit.matrix[0, 2]
        my = fit.matrix[1, 0] * tcx + fit.matrix[1, 1] * tcy + fit.matrix[1, 2]

        ch = overview.shape[0] // rows
        cw = overview.shape[1] // cols
        exp_cx = (c + 0.5) * cw
        exp_cy = (r + 0.5) * ch

        err = float(np.sqrt((mx - exp_cx) ** 2 + (my - exp_cy) ** 2))
        assert err < 2.0, f"Tile ({r},{c}) error {err:.2f} px exceeds 2 px"


def test_blank_tile_returns_none() -> None:
    """A blank (uniform) tile should not produce a valid fit."""
    overview = _make_overview((800, 800))
    blank = np.full((400, 400), 128, dtype=np.uint8)
    fit = tile_on_overview(blank, overview, (400, 400))
    assert fit is None


def test_grid_hint_patterns() -> None:
    """grid_hint should parse all supported name patterns correctly."""
    rows, cols = 4, 4
    shape = (800, 800)
    cell = 200  # 800 / 4

    # r03c07 -> row 3, col 7 (1-based) -> 0-indexed row 2, col 6
    h = grid_hint("r03c07", rows, cols, shape)
    assert h is not None
    assert abs(h[0] - 6.5 * cell) < 1
    assert abs(h[1] - 2.5 * cell) < 1

    # 3_7 -> row 3, col 7 (1-based) -> 0-indexed row 2, col 6
    h = grid_hint("3_7", rows, cols, shape)
    assert h is not None
    assert abs(h[0] - 6.5 * cell) < 1
    assert abs(h[1] - 2.5 * cell) < 1

    # 03-07 -> row 3, col 7 (1-based) -> 0-indexed row 2, col 6
    h = grid_hint("03-07", rows, cols, shape)
    assert h is not None
    assert abs(h[0] - 6.5 * cell) < 1
    assert abs(h[1] - 2.5 * cell) < 1

    # A3 -> row A=1, col 3 (1-based) -> 0-indexed row 0, col 2
    h = grid_hint("A3", rows, cols, shape)
    assert h is not None
    assert abs(h[0] - 2.5 * cell) < 1
    assert abs(h[1] - 0.5 * cell) < 1

    # C12 -> row C=3, col 12 (1-based) -> 0-indexed row 2, col 11
    h = grid_hint("C12", rows, cols, shape)
    assert h is not None
    assert abs(h[0] - 11.5 * cell) < 1
    assert abs(h[1] - 2.5 * cell) < 1

    # Sheet 5 in 4x4 row-major -> 0-indexed row 1, col 0
    h = grid_hint("5", rows, cols, shape)
    assert h is not None
    assert abs(h[0] - 0.5 * cell) < 1
    assert abs(h[1] - 1.5 * cell) < 1


def test_grid_hint_no_numbers() -> None:
    """A name without any numbers should return None."""
    h = grid_hint("tile_alpha", 4, 4, (800, 800))
    assert h is None
