"""The matcher's parts on their own (docs/research/M4-interfaces.md §2.1-§2.2): ORB when SIFT is missing, the
proximity field and the line response, the tiles and their margins, RANSAC on degenerate sets and the confidence's
agreement between channels, and the matcher on OpenStreetMap's lines alone."""

from pathlib import Path

import cv2
import numpy
import pytest
from hcm_pipeline.geo import Grid, ground_scale, to_lnglat, to_mercator
from hcm_pipeline.georef import features
from hcm_pipeline.georef.consensus import Candidate, consensus, ransac
from hcm_pipeline.georef.corners import corner_transform
from hcm_pipeline.georef.matcher import References, Scan, match
from hcm_pipeline.georef.tiles import TileMatcher, lines, lines_at, peak_margin, proximity
from hcm_pipeline.georef.transforms import Gcp
from hcm_pipeline.osm import draw, to_geojson
from hcm_pipeline.runner import RunOutcome

from tests.contracts_loader import record
from tests.fakes.http import Reply
from tests.fakes.world import OVERPASS_PATH, PipelineWorld
from tests.integration.matching import CORNER_ERROR_M, blurred, seed_matching
from tests.synthetic.scenes import affine_scan


def test_happy_path_orb_matches_when_this_opencv_has_no_sift(monkeypatch: pytest.MonkeyPatch) -> None:
    image = numpy.random.default_rng(3).integers(0, 255, (200, 200)).astype(numpy.uint8)
    monkeypatch.delattr(cv2, "SIFT")

    method = features.choose(image, None)

    assert method is features.ORB
    assert features.detect(method, image, None).descriptors.dtype == numpy.uint8


def test_happy_path_the_proximity_field_is_full_on_a_line_and_empty_far_from_it() -> None:
    drawn = numpy.zeros((40, 40), numpy.uint8)
    drawn[:, 20] = 255

    field = proximity(drawn, 10.0)

    assert (int(field[5, 20]), int(field[5, 17]), int(field[5, 0])) == (255, 127, 0)
    assert int(lines_at(drawn, (10, 10))[3, 5]) == 255


def test_happy_path_the_line_response_keeps_a_thin_road_and_drops_flat_ground() -> None:
    image = numpy.full((60, 60), 120, numpy.uint8)
    image[:, 30] = 230

    found = lines(image, 10.0)

    assert int(found[10, 30]) == 220
    assert int(found[10, 5]) == 0


def test_bad_path_a_lone_correlation_peak_keeps_its_whole_height() -> None:
    response = numpy.array([[0.1, 0.2, 0.1], [0.2, 0.9, 0.2], [0.1, 0.2, 0.1]], numpy.float32)

    margin, place = peak_margin(response)

    assert margin == pytest.approx(0.9)
    assert place == (1, 1)


def test_bad_path_a_tile_smaller_than_four_pixels_is_not_tried() -> None:
    image = numpy.random.default_rng(1).integers(0, 255, (64, 64)).astype(numpy.uint8)
    coarse = TileMatcher("s2", image, image, numpy.ones((64, 64), bool), 2.0, 1000.0)
    uncovered = TileMatcher("s2", image, image, numpy.zeros((64, 64), bool), 2.0, 10.0)

    assert not coarse.tried(0)
    assert not uncovered.tried(0)
    assert TileMatcher("s2", image, image, numpy.ones((64, 64), bool), 2.0, 10.0).tried(0)


def shifted(cell: int, channel: str, shift: tuple[float, float]) -> Candidate:
    scan = (10.0 + cell * 20.0, 15.0 + (cell % 3) * 25.0)
    return Candidate(cell, scan, (scan[0] + shift[0], scan[1] + shift[1]), 0.6, channel)


@pytest.mark.parametrize(
    ("points", "label"),
    [([(0.0, 0.0), (1.0, 1.0), (2.0, 2.0), (3.0, 3.0)], "collinear"), ([(5.0, 5.0)] * 3, "coincident")],
)
def test_bad_path_ransac_finds_no_map_in_a_degenerate_set(points: list[tuple[float, float]], label: str) -> None:
    candidates = [Candidate(index, point, point, 0.5, "s2") for index, point in enumerate(points)]

    inliers, residuals = ransac(candidates)

    assert inliers == [False] * len(points), label
    assert numpy.isinf(residuals).all()
    assert consensus(candidates, 10.0) == []


def test_happy_path_the_channels_agree_disagree_or_stand_alone() -> None:
    candidates = [
        *(shifted(cell, "s2", (5.0, 5.0)) for cell in range(6)),
        shifted(0, "osm", (5.0, 5.5)),
        shifted(1, "osm", (5.0, 6.2)),
    ]

    kept = {(pair.candidate.cell, pair.candidate.channel): pair.score for pair in consensus(candidates, 20.0)}

    assert kept[(0, "s2")] == pytest.approx(0.5 * 0.6 + 0.3 * 1.0 + 0.2 * 1.0)
    assert kept[(0, "osm")] == pytest.approx(0.5 * 0.6 + 0.3 * 1.0 + 0.2 * 1.0)
    assert kept[(1, "osm")] == pytest.approx(0.5 * 0.6 + 0.3 * 1.0 + 0.2 * 0.0)
    assert kept[(2, "s2")] == pytest.approx(0.5 * 0.6 + 0.3 * 1.0 + 0.2 * 0.5)


def test_bad_path_two_candidates_are_too_few_for_ransac() -> None:
    inliers, residuals = ransac([shifted(0, "s2", (1.0, 1.0)), shifted(1, "s2", (1.0, 1.0))])

    assert inliers == [False, False]
    assert numpy.isinf(residuals).all()


def osm_alone_world(world: PipelineWorld) -> tuple[Scan, Grid, numpy.ndarray]:
    """The affine scan, its world's 10 m grid and the world's lines drawn on it."""
    truth = affine_scan(world.scene.world)
    return Scan(truth.pixels, 6.0), world.scene.world.grid, draw(to_geojson(world.scene.overpass), world.scene.world.grid)


def ground_error_m(gcp: Gcp, truth: tuple[float, float]) -> float:
    """Ground metres between a pair's place and the true place of its scan pixel."""
    x, y = to_mercator(gcp.lng, gcp.lat)
    return float(numpy.hypot(x - truth[0], y - truth[1])) * ground_scale(gcp.lat)


def test_happy_path_openstreetmap_lines_alone_place_the_scan(world: PipelineWorld) -> None:
    truth = affine_scan(world.scene.world)
    height, width = truth.pixels.shape
    corners = []
    for index, (u, v) in enumerate(((0, 0), (width, 0), (width, height), (0, height)), start=1):
        x, y = truth.to_mercator(u, v)
        lng, lat = to_lnglat(x + CORNER_ERROR_M[0], y + CORNER_ERROR_M[1])
        corners.append(Gcp(f"c{index}", u, v, lat, lng, True, "corner"))
    scan, grid, drawn = osm_alone_world(world)

    found = match(scan, corner_transform(corners).to_pixel, References(grid, None, drawn))

    assert found.channels == ("osm",)
    assert found.tiles.matched["osm"] >= len(found.pairs) >= 6
    assert {pair.channel for pair in found.pairs} == {"osm"}
    errors = [ground_error_m(pair.gcp, truth.to_mercator(pair.gcp.x, pair.gcp.y)) for pair in found.pairs]
    assert float(numpy.median(errors)) < 25.0


def test_bad_path_the_matcher_needs_a_reference_to_match_against(world: PipelineWorld) -> None:
    scan, grid, drawn = osm_alone_world(world)

    assert References(grid, None, numpy.zeros_like(drawn)).channels == ()
    with pytest.raises(ValueError, match="Sentinel-2 image or OpenStreetMap lines"):
        match(scan, lambda x, y: (x, y), References(grid))


def test_bad_path_without_openstreetmap_lines_sentinel2_matches_alone(world: PipelineWorld, tmp_path: Path) -> None:
    for _ in range(3):
        world.http.enqueue(OVERPASS_PATH, Reply(503, b"<html>busy</html>", "text/html"))
    seed_matching(world, tmp_path, blurred(8))

    outcome = world.runner().run("georef")

    suggestions = record(world.version()["suggestions"])
    assert outcome is RunOutcome.DONE
    assert suggestions["channels"] == ["s2"]
    assert any("no OpenStreetMap lines" in line for line in world.log_lines())
