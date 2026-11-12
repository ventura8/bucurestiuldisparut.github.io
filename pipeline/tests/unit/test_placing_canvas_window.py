"""The mosaic written in windows (docs/research/M20-import-local.md §19.6): never the whole canvas in memory."""

import os
import subprocess
import sys
from pathlib import Path

import numpy
import pytest
from hcm_pipeline.placing import canvas_window
from hcm_pipeline.placing.canvas_window import Canvas, Tile
from hcm_pipeline.raster import gdal

from tests.synthetic.sheets import SheetsSpec, make_series
from tests.synthetic.town import write_map

# The low-resource principle (M7): the worker runs in 4 GB with two cores; a 100-sheet series of 6000 px scans stays within this.
PEAK_RSS_BYTES = 1_500_000_000


def _scan(tmp_path: Path, name: str, value: int, size: tuple[int, int] = (200, 100)) -> Path:
    picture = numpy.full((size[1], size[0], 3), value, numpy.uint8)
    picture[:, : size[0] // 2] = 255 - value
    return write_map(tmp_path / name, picture, grey=True)


def _read(path: Path) -> numpy.ndarray:
    dataset = gdal.Open(str(path))
    pixels = numpy.dstack([dataset.GetRasterBand(band).ReadAsArray() for band in range(1, dataset.RasterCount + 1)])
    dataset.Close()
    return pixels


def test_happy_path_tiles_are_pasted_turned_cropped_and_split_at_the_nearest_centre(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Scenarios: S-P20-HAPPY-STITCH-WINDOWED"""
    monkeypatch.setattr(canvas_window, "WINDOW_PX", 64)
    first = Tile(_scan(tmp_path, "a.tif", 20), (0, 0, 200, 100), 0, 0, 0, 200, 100)
    second = Tile(_scan(tmp_path, "b.tif", 200), (0, 0, 200, 100), 2, 150, 0, 200, 100)

    path = canvas_window.render([first, second], Canvas(tmp_path / "canvas.tif", (350, 120), False))

    pixels = _read(path)[:, :, 0]
    assert pixels.shape == (120, 350)
    assert (pixels[50, 10], pixels[50, 120]) == (235, 20)
    # The second scan turned half round: its light half is now on the right; the seam between them at the centres' midpoint.
    assert (pixels[50, 200], pixels[50, 340]) == (200, 55)
    assert pixels[110, 10] == canvas_window.PAPER


def test_happy_path_a_colour_canvas_keeps_three_bands_and_a_grey_scan_is_spread_over_them(tmp_path: Path) -> None:
    tile = Tile(_scan(tmp_path, "a.tif", 20), (100, 0, 200, 100), 1, 0, 0, 50, 50)

    path = canvas_window.render([tile], Canvas(tmp_path / "canvas.tif", (50, 60), True))

    pixels = _read(path)
    assert pixels.shape == (60, 50, 3)
    assert numpy.all(pixels[:50, :, 0] == 20)
    assert numpy.all(pixels[55:, :, 1] == canvas_window.PAPER)


def test_happy_path_windows_cover_a_tile_and_stop_at_the_canvas_edge() -> None:
    tile = Tile(Path("x.tif"), (0, 0, 10, 10), 0, -10, 100, 5000, 100)

    windows = list(canvas_window.windows(tile, (4100, 150)))

    assert windows == [(0, 100, 2048, 150), (2048, 100, 4096, 150), (4096, 100, 4100, 150)]
    assert not tile.meets((0, 0, 50, 50))


def test_bad_path_a_window_no_tile_covers_has_no_owner() -> None:
    tile = Tile(Path("x.tif"), (0, 0, 10, 10), 0, 0, 0, 10, 10)

    assert numpy.all(canvas_window.owners([tile], (100, 100, 108, 108)) == -1)


_CHILD = """
import resource, sys
from pathlib import Path
from hcm_pipeline.placing import autostitch
from hcm_pipeline.placing.canvas_window import Canvas, render
named = [(line.split("\\t")[0], Path(line.split("\\t")[1])) for line in Path(sys.argv[1]).read_text().splitlines()]
proposal = autostitch.propose(named)
tiles, size = proposal.tiles()
render([tile for _index, tile in tiles], Canvas(Path(sys.argv[2]), size, False))
print(len(proposal.solved.positions), size[0], size[1], resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)
"""


def test_happy_path_a_hundred_large_scans_are_laid_out_and_mosaicked_within_the_memory_budget(tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-STITCH-WINDOWED"""
    spec = SheetsSpec(rows=10, cols=10, cell=(400, 300), overlap=0.06, names="rc", style="lineart", out_px=6000)
    series = make_series(tmp_path / "scans", spec)
    listing = tmp_path / "named.tsv"
    listing.write_text("\n".join(f"{name}\t{path}" for name, path in series.named), encoding="utf-8")
    env = {**os.environ, "PYTHONPATH": os.pathsep.join(sys.path)}

    done = subprocess.run(
        [sys.executable, "-c", _CHILD, str(listing), str(tmp_path / "canvas.tif")], env=env, capture_output=True, text=True, check=True
    )

    placed, width, height, peak_kib = (int(value) for value in done.stdout.split())
    assert placed == 100
    assert max(width, height) <= 20_000
    assert peak_kib * 1024 <= PEAK_RSS_BYTES
