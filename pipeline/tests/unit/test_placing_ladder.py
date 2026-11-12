"""An old map matched against the city's published layers first (docs/research/M20-import-local.md §1.7, §3 c step 3): the ladder.

The rungs are published versions of other layers, the same kind and the nearest year first, read from their own public tiles (a PMTiles
archive, by range: `tiles.read`); OpenStreetMap is the last rung. The town of `tests.synthetic.town` is both the published layer's
picture and the map to place.
"""

from pathlib import Path

import cv2
import numpy
import pytest
from hcm_pipeline.geo import Bounds, MercatorBox
from hcm_pipeline.jobs import Done
from hcm_pipeline.placing import ladder, reference
from hcm_pipeline.placing.ladder import Rung
from hcm_pipeline.placing.output import suggestions
from hcm_pipeline.placing.raster_io import Pair
from hcm_pipeline.steps.place import PlaceStep
from hcm_pipeline.tiles import pack, read

from tests.fakes.world import CITY, PipelineWorld
from tests.unit.placing_support import publish_layer, series_context, serve_public
from tests.unit.test_placing_single import drawn_map, town_drawing


def test_happy_path_the_same_kind_and_the_nearest_year_come_first() -> None:
    rungs = [Rung("a", "v1", 1900, "map", 0.5), Rung("b", "v2", 1966, "satellite", 1.0), Rung("c", "v3", 1911, "map", 0.9)]

    assert [rung.layer_id for rung in ladder.ranked(rungs, 1914, "map")] == ["c", "a", "b"]
    assert [rung.layer_id for rung in ladder.ranked(rungs, 1964, "satellite")] == ["b", "c", "a"]
    assert [rung.layer_id for rung in ladder.ranked(rungs, None, "map")] == ["c", "a", "b"]
    assert ladder.cover_of({"west": 0, "south": 0, "east": 1, "north": 1}, {"west": 0, "south": 0, "east": 2, "north": 2}) == 0.25


def test_bad_path_what_is_not_a_published_tiled_layer_with_a_year_is_no_rung() -> None:
    tiles = {"tiles": {"path": "x"}}
    good = {"state": "published", "layerId": "a", "year": 1911, "origin": "join", "output": tiles}

    assert ladder.rung_of("v", None, None) is None
    assert ladder.rung_of("v", {**good, "state": "needs_gcps"}, None) is None
    assert ladder.rung_of("v", {**good, "output": {}}, None) is None
    assert ladder.rung_of("v", {**good, "year": True}, None) is None
    assert ladder.rung_of("v", {**good, "layerId": 3}, None) is None
    assert ladder.rung_of("v", good, None) == Rung("a", "v", 1911, "satellite", 0.0, None)
    assert ladder.cover_of([{"lat": 1}], {"west": 0, "south": 0, "east": 1, "north": 1}) == 0.0
    assert ladder.cover_of(None, None) == 0.0
    assert ladder.cover_of({"west": 0, "south": 0, "east": 1, "north": 1}, {"west": 0, "south": 0, "east": 0, "north": 1}) == 0.0


def test_happy_path_the_city_ladder_skips_its_own_layer_and_keeps_the_nearest(
    world: PipelineWorld, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    ctx = series_context(world, tmp_path, ["map.tif"], {"class": "single", "encoding": "grey"})
    serve_public(world, monkeypatch)
    world.store.seed(ctx.version_path(), {**world.version(), "year": 1913})
    for layer, year in (("plan-1847", 1847), ("plan-1911", 1911), ("plan-1921", 1921)):
        publish_layer(world, tmp_path, layer, year)
    publish_layer(world, tmp_path, ctx.version.layer_id, 1913)

    assert [rung.layer_id for rung in ladder.rungs(ctx)] == ["plan-1911", "plan-1921"]
    assert [rung.layer_id for rung in ladder.rungs(ctx, ("plan-1847",))] == ["plan-1847"]


def test_happy_path_a_map_with_no_openstreetmap_is_placed_on_a_published_older_map(
    world: PipelineWorld, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Scenarios: S-P20-HAPPY-LADDER"""
    ctx = series_context(world, tmp_path, ["Harti/plan 1914.tif"], {"class": "single", "encoding": "grey", "maxzoom": 15}, lines=None)
    serve_public(world, monkeypatch)
    publish_layer(world, tmp_path, "plan-1911", 1911, archive={"checkpointRmseM": 3.0})
    drawn_map(ctx, "Harti/plan 1914.tif", town_drawing())

    assert isinstance(PlaceStep().run(ctx), Done)
    report = world.version()["archive"]
    assert isinstance(report, dict)
    assert report["checkpointRmseM"] < 20


def test_bad_path_an_unreadable_layer_is_skipped_for_openstreetmap(
    world: PipelineWorld, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Scenarios: S-P20-BAD-LADDER"""
    ctx = series_context(world, tmp_path, ["map.tif"], {"class": "single", "encoding": "grey"})
    serve_public(world, monkeypatch)
    window = reference.city_window(ctx)
    assert window is not None
    gone = Rung("gone", "v-gone", 1911, "map")
    world.http.serve(f"/{world.config.public_bucket}/tiles/{CITY}/bad/v-bad.pmtiles", b"not an archive" * 2000)

    found = reference.references(ctx, [gone, Rung("bad", "v-bad", 1911, "map")], window, 20.0)

    assert [rung.label for rung in found] == ["osm"]


def test_happy_path_suggestions_name_the_published_map_they_were_found_on(world: PipelineWorld, tmp_path: Path) -> None:
    ctx = series_context(world, tmp_path, ["a.tif"], {"class": "single", "encoding": "grey"})
    pairs = [Pair(1.0, 2.0, 2_900_000.0, 5_530_000.0)]

    made = suggestions(ctx, pairs, [0.8], 7, Rung("plan-1911", "v", 1911, "map"))["suggestions"]
    plain = suggestions(ctx, [], [], 7)["suggestions"]

    assert isinstance(made, dict)
    assert isinstance(plain, dict)
    assert made["channels"] == ["layer"]
    assert made["reference"] == {"layerId": "plan-1911", "year": 1911}
    assert plain["channels"] == ["osm"]
    assert plain["pairs"] == []
    assert "reference" not in plain


def _archive(tmp_path: Path, tiles: list[tuple[int, int, int]]) -> tuple[Path, dict[tuple[int, int, int], bytes]]:
    """An archive of noisy tiles (so its directory does not compress away) and each tile's bytes."""
    tree, rng, written = tmp_path / "tree", numpy.random.default_rng(5), {}
    for zoom, x, y in tiles:
        target = tree / str(zoom) / str(x) / f"{y}.webp"
        target.parent.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(target), rng.integers(0, 255, (8 + x, 8 + y, 4), numpy.uint8))
        written[(zoom, x, y)] = target.read_bytes()
    archive = tmp_path / "a.pmtiles"
    pack.pack(tree, archive, pack.ArchiveInfo("a", Bounds(0, 0, 1, 1), 1, 3))
    return archive, written


def _file_fetch(path: Path) -> read.Fetch:
    data = path.read_bytes()
    return lambda offset, length: data[offset : offset + length]


def test_happy_path_an_archive_is_read_back_tile_by_tile_through_its_leaves(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(pack, "ROOT_BUDGET", 60)
    monkeypatch.setattr(pack, "LEAF_ENTRIES_START", 4)
    path, written = _archive(tmp_path, [(3, x, y) for x in range(8) for y in range(8)])
    archive = read.open_archive(_file_fetch(path))

    for (zoom, x, y), data in written.items():
        assert read.tile(archive, zoom, x, y) == data
    assert read.tile(archive, 1, 0, 0) is None
    assert read.tile(archive, 4, 0, 0) is None
    assert archive.leaves
    assert (archive.minzoom, archive.maxzoom) == (1, 3)


def test_bad_path_what_is_not_an_archive_is_refused() -> None:
    with pytest.raises(read.ArchiveError):
        read.open_archive(lambda _offset, _length: b"PMTiles\x02" + bytes(200))
    with pytest.raises(read.ArchiveError):
        read.open_archive(lambda _offset, _length: b"short")
    assert read.decoded(b"", gzipped=False) == []


def test_happy_path_a_box_of_tiles_is_resampled_onto_its_grid() -> None:
    assert reference.tile_zoom(4.0, 10, 18) == 16
    assert reference.tile_zoom(0.1, 10, 15) == 15
    assert reference.tile_span(MercatorBox(-10.0, -10.0, 10.0, 10.0), 1) == (0, 1, 0, 1)
