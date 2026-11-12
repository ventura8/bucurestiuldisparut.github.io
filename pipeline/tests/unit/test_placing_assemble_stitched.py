"""Atlas stitched waiting pictures (docs/research/M22-help-calibrate.md §4.1)."""

from pathlib import Path

import numpy
import pytest
from hcm_pipeline.jobs import Waiting
from hcm_pipeline.placing import stitched
from hcm_pipeline.steps.place import PlaceStep

from tests.fakes.world import PipelineWorld
from tests.synthetic.town import TownSpec, town_lines, write_map
from tests.unit.placing_support import originals, series_context
from tests.unit.test_placing_assemble import cut_pages, texture, town_map


def test_happy_path_an_atlas_that_does_not_place_itself_leaves_its_stitched_picture_with_the_pages_left_out(
    world: PipelineWorld, tmp_path: Path
) -> None:
    """Scenarios: S-P22-HAPPY-STITCHED-PREVIEW, S-P22-BAD-ATLAS-PAGES-APART, S-P22-HAPPY-GEOREF-SCAN"""
    # Another town's streets on the pages: no placement holds; one blank page joins nothing.
    names = [f"Atlas/{index}.tif" for index in range(1, 6)]
    ctx = series_context(world, tmp_path, names, {"class": "atlas", "encoding": "grey"}, lines=town_lines(TownSpec(seed=41)))
    (originals(ctx) / "Atlas").mkdir()
    page_images = [*cut_pages(town_map((1000, 1000)), 2, 2).values(), numpy.full((500, 500), 250, numpy.uint8)]
    for name, image in zip(names, page_images, strict=True):
        write_map(originals(ctx) / name, numpy.dstack([image] * 3), grey=True)

    assert isinstance(PlaceStep().run(ctx), Waiting)

    help_item = world.version()["help"]
    assert isinstance(help_item, dict)
    record = help_item["stitched"]
    assert isinstance(record, dict)
    assert record["method"] == "atlas"
    assert (record["parts"], record["joined"], record["leftOutCount"]) == (5, 4, 1)
    assert record["leftOut"] == [{"name": "5.tif", "reason": stitched.NO_JOIN}]
    assert record["width"] == 1000
    assert str(record["previewPath"]).endswith("/stitched.jpg")
    assert str(record["previewPath"]) in world.gcs.objects
    # The georeferencer opens it like any frame: its scan and the city window's OpenStreetMap lines.
    version = world.version()
    scan, reference = version["scan"], version["reference"]
    assert isinstance(scan, dict)
    assert isinstance(reference, dict)
    assert (scan["width"], scan["height"]) == (1000, 1000)
    assert str(scan["previewPath"]).endswith("/scan-preview.jpg")
    assert str(reference["osmPath"]) in world.gcs.objects


def test_happy_path_overlapping_atlas_pages_are_joined_by_their_overlaps(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P22-HAPPY-JOIN-QUALITY"""
    whole = texture((900, 900))
    pages = [whole[0:500, 0:500], whole[0:500, 400:900], whole[400:900, 0:500], whole[400:900, 400:900]]
    names = [f"Atlas/{index}.tif" for index in range(1, 5)]
    ctx = series_context(world, tmp_path, names, {"class": "atlas", "encoding": "grey"}, lines=town_lines(TownSpec(seed=41)))
    for path, image in zip(names, pages, strict=True):
        (originals(ctx) / path).parent.mkdir(parents=True, exist_ok=True)
        write_map(originals(ctx) / path, numpy.dstack([image] * 3), grey=True)

    assert isinstance(PlaceStep().run(ctx), Waiting)

    help_item = world.version()["help"]
    assert isinstance(help_item, dict)
    record = help_item["stitched"]
    assert isinstance(record, dict)
    assert record["joined"] == 4
    assert record["joins"]["links"] == 3


def test_happy_path_a_preview_is_never_larger_than_the_georeferencers(world: PipelineWorld, tmp_path: Path) -> None:
    ctx = series_context(world, tmp_path, ["a.tif"], {"class": "single", "encoding": "grey"})
    record = stitched.publish_stitched(ctx, stitched.Stitched(numpy.full((10, 5000), 200, numpy.uint8), "single", 1, (), 2.0))

    assert record["previewScale"] == pytest.approx(stitched.PREVIEW_PX / 5000)
    assert record["metresPerPx"] == 2.0
