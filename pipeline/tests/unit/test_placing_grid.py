"""Class b, a sheet series placed from its names on the city grid (docs/research/M20-import-local.md §3 b)."""

import math
from pathlib import Path

import numpy
import pytest
from hcm_pipeline.archive.grammar import Cell
from hcm_pipeline.geo import to_mercator
from hcm_pipeline.jobs import Done, JobContext, Waiting
from hcm_pipeline.placing import grid
from hcm_pipeline.placing.gridscheme import QUARTER_ORDERS, CityGrid, scheme_for
from hcm_pipeline.steps.place import PlaceStep

from tests.fakes.world import CITY, PipelineWorld
from tests.synthetic.scenes import CENTRE
from tests.synthetic.town import Drawing, Line, TownSpec, draw_map, town_lines, write_map
from tests.unit.placing_support import originals, series_context

LETTERS = "ABCD"
TRUE_ORDER = 3
SHEET_PX = 250
MARGIN = 30
ANGLE = math.radians(1.5)


def grid_to_mercator() -> numpy.ndarray:
    """The truth: grid metres to Mercator, grid (1000, -1000) on the town's centre, turned 1.5 degrees, Mercator's scale."""
    cx, cy = to_mercator(*CENTRE)
    k = 1.0 / math.cos(math.radians(CENTRE[1]))
    linear = k * numpy.array([[math.cos(ANGLE), -math.sin(ANGLE)], [math.sin(ANGLE), math.cos(ANGLE)]])
    return numpy.column_stack((linear, numpy.array([cx, cy]) - linear @ numpy.array([1000.0, -1000.0])))


def sheet_drawing(cell: Cell, truth: numpy.ndarray) -> Drawing:
    """Mercator to the sheet's pixels: back to grid metres, then onto the sheet's frame (1 m a pixel, a slight shear)."""
    box = CityGrid().box(cell, TRUE_ORDER)
    inverse = numpy.linalg.inv(numpy.vstack((truth, [0, 0, 1])))[:2]
    to_sheet = numpy.array([[1.0, 0.004, MARGIN - box.west], [0.0, -1.0, MARGIN + box.north]])
    return Drawing(
        to_sheet @ numpy.vstack((inverse, [0, 0, 1])),
        (SHEET_PX + 2 * MARGIN, SHEET_PX + 2 * MARGIN),
        "grey",
        10,
        0.0,
        MARGIN,
        cartouche=False,
    )


def sheet_name(cell: Cell) -> str:
    return f"Plan/{cell.row}/{cell.row}{LETTERS[cell.col]}'{cell.quarter}.tif"


CELLS = [Cell("quarter", row, col, quarter) for row in range(1, 5) for col in range(4) for quarter in range(1, 5)]


def grid_series(
    world: PipelineWorld, tmp_path: Path, lines: list[Line] | None = None, params: dict[str, object] | None = None
) -> JobContext:
    """Sixty-four quarter sheets of the town (or of `lines`) on the true grid, read in `TRUE_ORDER`."""
    names = [sheet_name(cell) for cell in CELLS]
    ctx = series_context(world, tmp_path, names, {"class": "grid", "encoding": "lineart", "maxzoom": 15, **(params or {})})
    for cell, name in zip(CELLS, names, strict=True):
        write_sheet(originals(ctx) / name, cell, town_lines() if lines is None else lines)
    return ctx


def write_sheet(target: Path, cell: Cell, lines: list[Line]) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    write_map(target, draw_map(lines, sheet_drawing(cell, grid_to_mercator())), grey=True)


def test_happy_path_a_sheet_series_is_placed_from_its_names_its_quarter_order_read_from_its_seams(
    world: PipelineWorld, tmp_path: Path
) -> None:
    """Scenarios: S-P20-HAPPY-GRID"""
    ctx = grid_series(world, tmp_path)

    result = PlaceStep().run(ctx)

    assert isinstance(result, Done)
    report = world.version()["archive"]
    assert isinstance(report, dict)
    assert report["method"] == "grid"
    assert report["paperTransparent"] is True
    assert report["checkpointRmseM"] < 15
    assert report["checksDropped"] == 0
    assert '"order": 3' in (tmp_path / "scratch" / "placed.json").read_text(encoding="utf-8")
    source = world.version()["source"]
    assert isinstance(source, dict)
    assert source["placedCount"] == 64


def test_happy_path_a_grid_the_owner_confirmed_places_the_series_without_a_search(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-GRID"""
    ctx = grid_series(world, tmp_path, params={"gridId": "bucharest-grid"})
    truth = grid_to_mercator()
    scale = math.hypot(truth[0, 0], truth[1, 0])
    record = {"originX": truth[0, 2], "originY": truth[1, 2], "scale": scale, "rotationDeg": math.degrees(ANGLE)}
    world.store.seed(f"cities/{CITY}/grids/bucharest-grid", record)

    assert isinstance(PlaceStep().run(ctx), Done)


def test_bad_path_a_series_of_another_town_does_not_prove_its_grid(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P20-BAD-GRID-NOT-PROVED"""
    ctx = grid_series(world, tmp_path, lines=town_lines(TownSpec(seed=41, block_m=140.0)))

    result = PlaceStep().run(ctx)

    assert isinstance(result, Waiting)
    help_item = world.version()["help"]
    assert isinstance(help_item, dict)
    assert help_item["note"] == grid.NOT_PROVED


def test_bad_path_sheets_without_frames_or_a_scheme_wait_for_a_person(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P20-BAD-FRAME-NOT-FOUND"""
    ctx = series_context(world, tmp_path, ["Plan/1/1A'1.tif", "Plan/12-07.tif"], {"class": "grid", "encoding": "grey"})
    for name in ("Plan/1/1A'1.tif", "Plan/12-07.tif"):
        (originals(ctx) / name).parent.mkdir(parents=True, exist_ok=True)
        write_map(originals(ctx) / name, numpy.full((60, 60, 3), 250, numpy.uint8), grey=True)

    assert isinstance(PlaceStep().run(ctx), Waiting)
    help_item = world.version()["help"]
    assert isinstance(help_item, dict)
    assert help_item["reason"] == "frame-not-found"

    other = series_context(world, tmp_path / "b", ["Plan/12-07.tif"], {"class": "grid", "encoding": "grey"})
    assert isinstance(PlaceStep().run(other), Waiting)
    help_item = world.version()["help"]
    assert isinstance(help_item, dict)
    assert help_item["note"] == grid.NO_SCHEME


def test_happy_path_the_city_grid_places_quarters_blocks_and_cells() -> None:
    city = CityGrid()

    quarter = city.box(Cell("quarter", 17, 0, 3), 0)
    block = city.box(Cell("block", 29, -3, 0, 2))
    cell = city.box(Cell("folder-row", -1, 2))

    assert (quarter.west, quarter.north, quarter.width, quarter.height) == (0.0, -8750.0, 250.0, 250.0)
    assert (block.west, block.north, block.width) == (-1500.0, -14500.0, 1000.0)
    assert (cell.west, cell.north, cell.south) == (1000.0, 500.0, 0.0)
    assert len(set(QUARTER_ORDERS)) == 8
    assert scheme_for("row-col") is None
    assert scheme_for("quarter", 400.0) == CityGrid(400.0)


def test_bad_path_a_grid_record_that_is_not_a_similarity_is_ignored() -> None:
    mosaic = grid.Mosaic(numpy.zeros((2, 2), numpy.uint8), numpy.zeros((2, 2), numpy.int32), 0.0, 0.0)

    assert grid._grid_matrix({"originX": "x"}, mosaic) is None
    assert grid._grid_matrix({}, mosaic) is None
    assert grid.quarter_order([], CityGrid()) == 0
    assert grid.seam_score([], CityGrid(), 0) == pytest.approx(0.0)
