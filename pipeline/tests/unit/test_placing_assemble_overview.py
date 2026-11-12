"""Pieces and atlases overview mosaic and page-size helpers (docs/research/M20-import-local.md)."""

from pathlib import Path
from typing import cast

import cv2
import numpy
import pytest
from hcm_pipeline.archive import model
from hcm_pipeline.jobs import Done, JobContext, Waiting
from hcm_pipeline.placing import assemble, maps
from hcm_pipeline.placing.stitched import Stitched, publish_stitched
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
    assert record["method"] in model.STITCH_METHODS
    assert "overview" in model.ARCHIVE_PLACE_METHODS
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


def test_happy_path_atlas_pages_with_an_overview_use_it_as_the_series_picture(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-OVERVIEW-ATLAS"""
    overview = _make_overview((800, 800))
    names = [f"Atlas/r{row}c{col}.tif" for row, col in ((1, 1), (1, 2), (2, 1), (2, 2))]
    ctx = series_context(world, tmp_path, names, {"class": "atlas", "encoding": "grey"}, lines=town_lines(TownSpec(seed=77)))
    root = originals(ctx)
    (root / "Atlas").mkdir()
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


def test_bad_path_an_atlas_with_a_blank_overview_keeps_its_page_layout(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P20-BAD-OVERVIEW-ATLAS-BLANK"""
    whole = town_map((1000, 1000))
    cuts = [whole[0:600, 0:600], whole[0:600, 400:1000], whole[400:1000, 0:600], whole[400:1000, 400:1000]]
    names = [f"Atlas/img{index:03d}.tif" for index in range(4)]
    ctx = series_context(world, tmp_path, names, {"class": "atlas", "encoding": "grey"})
    root = originals(ctx)
    (root / "Atlas").mkdir()
    write_map(root / "blank-overview.tif", numpy.dstack([numpy.full((400, 400), 255, numpy.uint8)] * 3), grey=True)
    for name, image in zip(names, cuts, strict=True):
        write_map(root / name, numpy.dstack([image] * 3), grey=True)

    result = PlaceStep().run(ctx)

    record = world.version()["archive"] if isinstance(result, Done) else world.version()["help"]
    if not isinstance(result, Done):
        assert isinstance(record, dict)
        record = record["stitched"]
    assert isinstance(record, dict)
    assert record["method"] == "atlas"


def test_happy_path_a_pages_frame_is_cropped_and_the_page_size_follows_the_count() -> None:
    page = numpy.full((300, 200), 250, numpy.uint8)
    cv2.rectangle(page, (20, 20), (180, 280), 0, 3)

    assert assemble.frame_crop(page).shape[0] < 270
    assert assemble.frame_crop(numpy.full((50, 50), 250, numpy.uint8)).shape == (50, 50)
    assert maps.page_px(95) == assemble.CANVAS_MAX_PX // 11
    assert maps.page_px(10_000) == assemble.PAGE_PX


def test_bad_path_a_stitch_method_the_server_does_not_know_is_refused_before_publishing(tmp_path: Path) -> None:
    """Scenarios: S-P20-BAD-STITCH-METHOD-UNKNOWN"""
    # harti.zip 1895: `overview` was missing from the server's list, so the worker's write was refused after the work (lesson 562).
    stitched = Stitched(numpy.zeros((4, 4), numpy.uint8), "made-up", 1)

    with pytest.raises(ValueError, match="unknown stitch method"):
        publish_stitched(cast(JobContext, None), stitched)
