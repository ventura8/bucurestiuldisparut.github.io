"""Class c, a drawn map placed by its streets (docs/research/M20-import-local.md §3 c): found, refused, or parked with pairs."""

import math
import shutil
from collections.abc import Sequence
from pathlib import Path

import numpy
import pytest
from hcm_pipeline.geo import to_mercator
from hcm_pipeline.jobs import Done, JobContext, Waiting
from hcm_pipeline.placing import fine, single, suggest
from hcm_pipeline.placing.geometry import apply, invert
from hcm_pipeline.placing.raster_io import Pair, WarpPlan, dpi_of, read_working, warp_by_pairs
from hcm_pipeline.placing.series import series_of
from hcm_pipeline.raster import gdal
from hcm_pipeline.rasters import GeoTiff, driver_of, write_geotiff
from hcm_pipeline.steps.place import PlaceStep

from tests.fakes.world import CITY, PipelineWorld
from tests.synthetic.scenes import CENTRE
from tests.synthetic.town import Drawing, Line, TownSpec, draw_map, placement, town_lines, write_map
from tests.unit.placing_support import answer_with, originals, series_context

SIZE = (1100, 1000)


def drawn_map(ctx: JobContext, name: str, drawing: Drawing, dpi: int | None = None, lines: Sequence[Line] | None = None) -> str:
    image = draw_map(town_lines() if lines is None else lines, drawing)
    target = originals(ctx) / name
    target.parent.mkdir(parents=True, exist_ok=True)
    write_map(target, image, grey=drawing.style != "colour", dpi=dpi)
    return name


def off_the_ground(pairs: Sequence[object], truth: numpy.ndarray) -> numpy.ndarray:
    """Ground metres between each offered pair's place and where the map's true placement puts its pixel."""
    back = invert(truth)
    gaps = []
    for pair in pairs:
        assert isinstance(pair, dict)
        x, y = to_mercator(pair["geo"]["lng"], pair["geo"]["lat"])
        expected = apply(back, numpy.array([[pair["pixel"]["x"], pair["pixel"]["y"]]]))[0]
        gaps.append(math.hypot(expected[0] - x, expected[1] - y) * fine.ground_of(pair["geo"]["lat"]))
    return numpy.array(gaps)


def town_drawing(rotation: float = 3.0, style: str = "grey", metres_per_px: float = 5.2) -> Drawing:
    return Drawing(placement(metres_per_px, rotation, (550, 500)), SIZE, style, street_px=5, wobble_px=2.0, margin_px=40)


def test_happy_path_a_drawn_map_is_placed_by_its_streets_and_warped(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-MATCH"""
    ctx = series_context(world, tmp_path, ["Harti/plan 1900.tif"], {"class": "single", "encoding": "grey", "maxzoom": 15})
    drawn_map(ctx, "Harti/plan 1900.tif", town_drawing())

    result = PlaceStep().run(ctx)

    assert isinstance(result, Done)
    report = world.version()["archive"]
    assert isinstance(report, dict)
    assert report["method"] == "match"
    assert report["rivalClean"] is True
    assert report["checkpointRmseM"] < 15
    assert report["checkpointCount"] >= 5
    assert report["checksDropped"] == 0
    assert report["measuredPct"] >= 70
    assert "scaleDenominator" not in report
    assert (tmp_path / "scratch" / "warped.tif").is_file()


def test_happy_path_a_map_turned_upside_down_is_still_found(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-MATCH"""
    ctx = series_context(world, tmp_path, ["Harti/turned.tif"], {"class": "single", "encoding": "colour", "scaleDenominator": 20_000})
    drawn_map(ctx, "Harti/turned.tif", town_drawing(181.0, "colour"))

    assert isinstance(PlaceStep().run(ctx), Done)
    report = world.version()["archive"]
    assert isinstance(report, dict)
    assert report["scaleDenominator"] == 20_000
    assert report["encoding"] == "colour"


def test_bad_path_a_map_of_another_town_is_never_placed(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P20-BAD-OTHER-CITY"""
    ctx = series_context(world, tmp_path, ["Harti/elsewhere.tif"], {"class": "single", "encoding": "grey"})
    other = town_lines(TownSpec(seed=99, block_m=150.0, jitter_m=60.0))
    drawn_map(ctx, "Harti/elsewhere.tif", town_drawing(), lines=other)

    result = PlaceStep().run(ctx)

    assert isinstance(result, Waiting)
    assert result.status == "awaiting_gcps"
    version = world.version()
    assert "archive" not in version
    assert version["state"] == "needs_gcps"
    suggestions = version["suggestions"]
    assert isinstance(suggestions, dict)
    assert suggestions["pairs"] == []


def test_bad_path_a_map_with_no_scale_that_does_not_place_waits_with_suggested_pairs(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P20-BAD-LOW-CONFIDENCE"""
    ctx = series_context(world, tmp_path, ["Harti/blur.tif"], {"class": "single", "encoding": "grey"})
    drawn_map(ctx, "Harti/blur.tif", Drawing(placement(5.2, 3.0, (550, 500)), SIZE, "grey", street_px=5, wobble_px=40.0, margin_px=40))

    result = PlaceStep().run(ctx)

    assert isinstance(result, Waiting)
    version = world.version()
    help_item = version["help"]
    assert isinstance(help_item, dict)
    assert help_item["reason"] == "no-scale"
    suggestions = version["suggestions"]
    assert isinstance(suggestions, dict)
    assert suggestions["method"] == "junctions"
    pairs = suggestions["pairs"]
    assert isinstance(pairs, list)
    # None rather than bad ones: whatever is offered lies on the ground (a wobbled drawing may offer nothing at all).
    assert len(pairs) <= suggest.MAX_OFFERED
    assert all(gap < 80.0 for gap in off_the_ground(pairs, placement(5.2, 3.0, (550, 500))))


def test_bad_path_with_no_city_bounds_or_no_reference_the_map_waits(world: PipelineWorld, tmp_path: Path) -> None:
    ctx = series_context(world, tmp_path, ["Harti/plan.tif"], {"class": "single", "encoding": "grey"}, lines=None)
    drawn_map(ctx, "Harti/plan.tif", town_drawing())

    assert isinstance(PlaceStep().run(ctx), Waiting)
    help_item = world.version()["help"]
    assert isinstance(help_item, dict)
    assert help_item["note"] == single.NO_REFERENCE

    world.store.seed(f"cities/{CITY}", {"name": {"ro": "B", "en": "B"}})
    assert isinstance(PlaceStep().run(ctx), Waiting)
    help_item = world.version()["help"]
    assert isinstance(help_item, dict)
    assert help_item["note"] == single.NO_WINDOW


def test_happy_path_a_stated_scale_and_the_scans_dpi_narrow_the_search(world: PipelineWorld, tmp_path: Path) -> None:
    ctx = series_context(world, tmp_path, ["Harti/stated.tif"], {"class": "single", "encoding": "grey"})
    name = drawn_map(ctx, "Harti/stated.tif", town_drawing(), dpi=254)
    drawn = single.drawn_of(originals(ctx) / name, "stated")

    known = single.known_metres_per_px(drawn, 52_000, 0.7)

    assert dpi_of(originals(ctx) / name) == pytest.approx(254)
    assert known == pytest.approx(52_000 * 0.0001 / 0.7)
    assert single.known_metres_per_px(drawn, None, 0.7) is None


def test_bad_path_a_rival_with_as_many_pairs_is_not_clean() -> None:
    assert single.rival_is_clean(None, None) is False


def test_happy_path_the_warp_keeps_line_art_crisp_and_one_bit_scans_read_as_grey(tmp_path: Path) -> None:
    """Scenarios: S-P20-HAPPY-LINEART"""
    bits = numpy.zeros((64, 64), numpy.uint8)
    bits[::8, :] = 1
    source = tmp_path / "g4.tif"
    dataset = driver_of("GTiff").Create(str(source), 64, 64, 1, gdal.GDT_Byte, ["NBITS=1", "COMPRESS=CCITTFAX4"])
    dataset.GetRasterBand(1).WriteArray(bits)
    dataset.Close()
    x, y = to_mercator(*CENTRE)
    pairs = [Pair(0, 0, x, y), Pair(64, 0, x + 64, y), Pair(64, 64, x + 64, y - 64), Pair(0, 64, x, y - 64)]

    working = read_working(source, 32)
    warped = warp_by_pairs(source, tmp_path / "out.tif", WarpPlan(pairs, 1.0, nearest=True))

    assert set(numpy.unique(working.image)) <= set(range(256))
    assert working.image.max() > 0
    output = gdal.Open(str(warped))
    values = numpy.unique(output.GetRasterBand(1).ReadAsArray())
    output.Close()
    assert set(values.tolist()) <= {0, 255}


def palette_scan(path: Path, entries: list[tuple[int, int, int, int]]) -> Path:
    dataset = driver_of("GTiff").Create(str(path), 8, 8, 1, gdal.GDT_Byte)
    table = gdal.ColorTable()
    for index, entry in enumerate(entries):
        table.SetColorEntry(index, entry)
    dataset.GetRasterBand(1).SetColorTable(table)
    dataset.GetRasterBand(1).WriteArray(numpy.tile(numpy.arange(2, dtype=numpy.uint8), (8, 4)))
    dataset.Close()
    return path


def test_happy_path_colour_and_palette_scans_are_read_as_their_colours(tmp_path: Path) -> None:
    rgb = write_geotiff(tmp_path / "rgb.tif", GeoTiff([numpy.full((8, 8), value, numpy.uint8) for value in (200, 30, 30)], None))
    coloured = palette_scan(tmp_path / "pal.tif", [(200, 30, 30, 255), (250, 250, 240, 255)])
    greys = palette_scan(tmp_path / "grey.tif", [(0, 0, 0, 255), (255, 255, 255, 255)])

    assert read_working(rgb, 8).image.shape == (8, 8, 3)
    assert read_working(coloured, 8).image.shape == (8, 8, 3)
    assert read_working(greys, 8).image.shape == (8, 8)
    assert fine.ground_of(60.0) == pytest.approx(0.5)


def test_bad_path_a_sheet_with_no_streets_or_no_reference_finds_no_placement(world: PipelineWorld, tmp_path: Path) -> None:
    ctx = series_context(world, tmp_path, ["Harti/blank.tif"], {"class": "single", "encoding": "grey"})
    blank = originals(ctx) / "Harti" / "blank.tif"
    blank.parent.mkdir(parents=True)
    write_map(blank, numpy.full((300, 400, 3), 250, numpy.uint8), grey=True)

    result = PlaceStep().run(ctx)
    drawn = single.drawn_of(blank, "blank")

    assert isinstance(result, Waiting)
    assert drawn.extent == (0.0, 0.0, 400.0, 300.0)
    answer_with(world, None)
    shutil.rmtree(tmp_path / "work" / "osm")
    unreached = single.fit_from(ctx, series_of(ctx), drawn, numpy.array([[5.0, 0.0, 0.0], [0.0, -5.0, 0.0]]), single.Search())
    assert unreached.fit is None


def test_happy_path_a_one_bit_scan_reads_through_its_palette(tmp_path: Path) -> None:
    source = tmp_path / "bits.tif"
    dataset = driver_of("GTiff").Create(str(source), 16, 16, 1, gdal.GDT_Byte, ["NBITS=1"])
    dataset.GetRasterBand(1).WriteArray(numpy.eye(16, dtype=numpy.uint8))
    dataset.Close()

    assert read_working(source, 16).image.max() == 255
