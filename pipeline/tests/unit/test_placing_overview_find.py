"""Tests for find_overview and overview_canvas (harti.zip tile import, slice 3)."""

from __future__ import annotations

from pathlib import Path

import cv2
import numpy
from hcm_pipeline.placing.overview_find import CanvasOpts, find_overview, overview_canvas

from tests.synthetic.town import write_map
from tests.unit.test_placing_overview import _make_overview, _make_tile


def _write_dummy_file(path: Path, size: int = 60_000) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"\x00" * size)


def test_happy_overview_in_parent(tmp_path: Path) -> None:
    series_dir = tmp_path / "series"
    series_dir.mkdir()
    tile1, tile2 = series_dir / "tile_001.png", series_dir / "tile_002.png"
    _write_dummy_file(tile1)
    _write_dummy_file(tile2)
    overview = tmp_path / "area-1895.png"
    _write_dummy_file(overview)

    assert find_overview(tmp_path, [tile1, tile2]) == overview


def test_same_folder_overview_beside_tiles(tmp_path: Path) -> None:
    series_dir = tmp_path / "series"
    series_dir.mkdir()
    tile1 = series_dir / "tile_001.png"
    _write_dummy_file(tile1)
    overview = series_dir / "overview.png"
    _write_dummy_file(overview)

    assert find_overview(tmp_path, [tile1]) == overview


def test_only_tiles_returns_none(tmp_path: Path) -> None:
    series_dir = tmp_path / "series"
    series_dir.mkdir()
    tile1 = series_dir / "tile_001.png"
    _write_dummy_file(tile1)

    assert find_overview(tmp_path, [tile1]) is None


def test_skips_thumbs_db(tmp_path: Path) -> None:
    series_dir = tmp_path / "series"
    series_dir.mkdir()
    tile1 = series_dir / "tile_001.png"
    _write_dummy_file(tile1)
    _write_dummy_file(tmp_path / "Thumbs.db")
    overview = tmp_path / "map.png"
    _write_dummy_file(overview)

    assert find_overview(tmp_path, [tile1]) == overview


def test_skips_small_files(tmp_path: Path) -> None:
    series_dir = tmp_path / "series"
    series_dir.mkdir()
    tile1 = series_dir / "tile_001.png"
    _write_dummy_file(tile1)
    (tmp_path / "small.png").write_bytes(b"\x00" * 100)

    assert find_overview(tmp_path, [tile1]) is None


def test_prefers_year_match(tmp_path: Path) -> None:
    series_dir = tmp_path / "series-1895"
    series_dir.mkdir()
    tile1 = series_dir / "tile_001.png"
    _write_dummy_file(tile1)
    match = tmp_path / "map-1895.png"
    other = tmp_path / "map-1900.png"
    _write_dummy_file(match)
    _write_dummy_file(other)

    assert find_overview(tmp_path, [tile1]) == match


def test_prefers_letter_token_match(tmp_path: Path) -> None:
    series_dir = tmp_path / "series-alpha"
    series_dir.mkdir()
    tile1 = series_dir / "tile_001.png"
    _write_dummy_file(tile1)
    match = tmp_path / "map-alpha.png"
    other = tmp_path / "map-beta.png"
    _write_dummy_file(match)
    _write_dummy_file(other)

    assert find_overview(tmp_path, [tile1]) == match


def test_falls_back_to_largest_size(tmp_path: Path) -> None:
    series_dir = tmp_path / "series"
    series_dir.mkdir()
    tile1 = series_dir / "tile_001.png"
    _write_dummy_file(tile1)
    small = tmp_path / "map_small.png"
    large = tmp_path / "map_large.png"
    _write_dummy_file(small, size=51_000)
    _write_dummy_file(large, size=100_000)

    assert find_overview(tmp_path, [tile1]) == large


def test_empty_sheets_returns_none(tmp_path: Path) -> None:
    assert find_overview(tmp_path, []) is None


def test_happy_overview_canvas_matches_source(tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-OVERVIEW"""
    overview = _make_overview((800, 800))
    overview_path = write_map(tmp_path / "overview.tif", numpy.dstack([overview] * 3), grey=True)
    tiles = []
    for row, col in ((0, 0), (0, 1), (1, 0), (1, 1)):
        name = f"r{row + 1:02d}c{col + 1:02d}.tif"
        image = _make_tile(overview, row, col, (2, 2), upscale=2)
        tiles.append((name, write_map(tmp_path / name, numpy.dstack([image] * 3), grey=True)))

    made = overview_canvas(tiles, overview_path, CanvasOpts(rows=2, cols=2, upscale=2.0, read_px=1200))
    assert made is not None
    canvas, report = made
    assert len(report.placed) >= 3
    expected = cv2.resize(overview, (canvas.shape[1], canvas.shape[0]), interpolation=cv2.INTER_AREA)
    mask = canvas < 250
    assert float(numpy.mean(numpy.abs(canvas[mask].astype(int) - expected[mask].astype(int)))) < 12


def test_bad_blank_overview_canvas_returns_none(tmp_path: Path) -> None:
    """Scenarios: S-P20-BAD-OVERVIEW-BLANK"""
    blank = numpy.full((400, 400), 255, dtype=numpy.uint8)
    overview_path = write_map(tmp_path / "blank.tif", numpy.dstack([blank] * 3), grey=True)
    tile_img = _make_tile(_make_overview((800, 800)), 0, 0, (2, 2), upscale=2)
    tile = write_map(tmp_path / "r01c01.tif", numpy.dstack([tile_img] * 3), grey=True)

    assert overview_canvas([("r01c01.tif", tile), ("r01c02.tif", tile)], overview_path) is None
