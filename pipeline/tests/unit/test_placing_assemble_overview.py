"""Pieces overview mosaic and page-size helpers (docs/research/M20-import-local.md)."""

from pathlib import Path

import cv2
import numpy
from hcm_pipeline.jobs import Done, Waiting
from hcm_pipeline.placing import assemble, maps
from hcm_pipeline.steps.place import PlaceStep

from tests.fakes.world import PipelineWorld
from tests.synthetic.town import TownSpec, town_lines, write_map
from tests.unit.placing_support import originals, series_context
from tests.unit.test_placing_assemble import town_map
from tests.unit.test_placing_overview import _make_overview, _make_tile


def test_happy_path_pieces_with_an_overview_use_it_as_the_series_picture(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-OVERVIEW"""
    overview = _make_overview((800, 800))
    names = [f"Sheet/r{row}c{col}.tif" for row, col in ((1, 1), (1, 2), (2, 1), (2, 2))]
    ctx = series_context(world, tmp_path, names, {"class": "pieces", "encoding": "grey"}, lines=town_lines(TownSpec(seed=77)))
    root = originals(ctx)
    (root / "Sheet").mkdir()
    write_map(root / "area-1895.tif", numpy.dstack([overview] * 3), grey=True)
    for index, (row, col) in enumerate(((0, 0), (0, 1), (1, 0), (1, 1))):
        image = _make_tile(overview, row, col, (2, 2), upscale=2)
        write_map(root / names[index], numpy.dstack([image] * 3), grey=True)

    result = PlaceStep().run(ctx)

    assert isinstance(result, Waiting)
    help_item = world.version()["help"]
    assert isinstance(help_item, dict)
    record = help_item["stitched"]
    assert isinstance(record, dict)
    assert record["method"] == "overview"
    assert record["joined"] >= 3


def test_bad_path_a_blank_overview_falls_back_to_joining_pieces(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P20-BAD-OVERVIEW-BLANK"""
    whole = town_map((1000, 1000))
    cuts = [whole[0:600, 0:600], whole[0:600, 400:1000], whole[400:1000, 0:600], whole[400:1000, 400:1000]]
    names = [f"Bucata/img{index:03d}.tif" for index in range(4)]
    ctx = series_context(world, tmp_path, names, {"class": "pieces", "encoding": "grey"})
    root = originals(ctx)
    (root / "Bucata").mkdir()
    write_map(root / "blank-overview.tif", numpy.dstack([numpy.full((400, 400), 255, numpy.uint8)] * 3), grey=True)
    for name, image in zip(names, cuts, strict=True):
        write_map(root / name, numpy.dstack([image] * 3), grey=True)

    result = PlaceStep().run(ctx)

    assert isinstance(result, Done)
    report = world.version()["archive"]
    assert isinstance(report, dict)
    assert report["method"] == "pieces"


def test_happy_path_a_pages_frame_is_cropped_and_the_page_size_follows_the_count() -> None:
    page = numpy.full((300, 200), 250, numpy.uint8)
    cv2.rectangle(page, (20, 20), (180, 280), 0, 3)

    assert assemble.frame_crop(page).shape[0] < 270
    assert assemble.frame_crop(numpy.full((50, 50), 250, numpy.uint8)).shape == (50, 50)
    assert maps.page_px(95) == assemble.CANVAS_MAX_PX // 11
    assert maps.page_px(10_000) == assemble.PAGE_PX
