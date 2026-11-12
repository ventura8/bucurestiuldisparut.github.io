"""The pairs offered for a map that did not place itself (docs/research/M20-import-local.md §3 c): one model, above chance, spread.

The scene: reference junctions on a jittered street grid (Mercator metres) and the map's junctions, the same streets seen through a
known similarity with a little drawing noise, some missing and some extra. Measured: how far each offered pair's reference junction
lies from where the true placement puts its map junction (the residual a person would find).
"""

import numpy
from hcm_pipeline.placing import geometry, suggest
from hcm_pipeline.placing.geometry import FloatArray

EXTENT = (0.0, 0.0, 1200.0, 1000.0)
REACH_PX = 40.0


def scene(seed: int = 3) -> tuple[FloatArray, FloatArray, FloatArray]:
    """The map's junctions (pixels), the reference's (Mercator metres) and the true placement (pixels to metres)."""
    rng = numpy.random.default_rng(seed)
    truth = numpy.array([[2.0, 0.1, 1000.0], [0.1, -2.0, 5000.0]])
    grid = numpy.array([[x, y] for x in range(30, 1200, 55) for y in range(30, 1000, 55)], numpy.float64)
    grid += rng.uniform(-15, 15, grid.shape)
    places = geometry.apply(truth, grid)
    seen = grid[rng.random(len(grid)) > 0.25]
    seen = seen + rng.normal(0, 1.5, seen.shape)
    extra = rng.uniform((0, 0), (1200, 1000), (60, 2))
    return numpy.vstack((seen, extra)), places, truth


def residuals(offered: suggest.Offered, truth: FloatArray) -> FloatArray:
    return numpy.asarray(numpy.hypot(*(geometry.apply(truth, offered.source) - offered.target).T), numpy.float64)


def nudged(truth: FloatArray, shift: tuple[float, float], scale: float = 1.0) -> FloatArray:
    placed = truth.copy()
    placed[:, :2] *= scale
    placed[:, 2] += shift
    return placed


def test_happy_path_a_near_placement_offers_spread_pairs_on_the_ground() -> None:
    """Scenarios: S-P20-HAPPY-SUGGEST"""
    points, places, truth = scene()

    offered = suggest.offer(points, places, [nudged(truth, (25.0, -20.0))], REACH_PX, EXTENT)

    assert suggest.MIN_OFFERED <= offered.count <= suggest.MAX_OFFERED
    assert offered.lift >= suggest.MIN_LIFT
    assert float(numpy.median(residuals(offered, truth))) < 10.0
    cells = {(int(x // 300), int(y // 250)) for x, y in offered.source}
    assert len(cells) >= 12
    assert all(0.6 <= score <= 1.0 for score in offered.scores)


def test_bad_path_a_wrong_placement_offers_nothing() -> None:
    """Scenarios: S-P20-BAD-SUGGEST-CHANCE"""
    points, places, truth = scene()
    wrong = [nudged(truth, (700.0, 450.0)), nudged(truth, (-300.0, 0.0), 0.6), nudged(truth, (0.0, 0.0), 1.7)]

    for placement in wrong:
        assert suggest.offer(points, places, [placement], REACH_PX, EXTENT) is suggest.NOTHING


def test_happy_path_the_rival_further_above_chance_is_offered() -> None:
    """Scenarios: S-P20-HAPPY-SUGGEST"""
    points, places, truth = scene()

    offered = suggest.offer(points, places, [nudged(truth, (700.0, 450.0)), nudged(truth, (10.0, 10.0))], REACH_PX, EXTENT)

    assert offered.count >= suggest.MIN_OFFERED
    assert float(numpy.median(residuals(offered, truth))) < 10.0


def test_bad_path_too_few_junctions_or_no_placement_offers_nothing() -> None:
    """Scenarios: S-P20-BAD-SUGGEST-CHANCE"""
    points, places, truth = scene()

    assert suggest.offer(points[:4], places, [truth], REACH_PX, EXTENT) is suggest.NOTHING
    assert suggest.offer(numpy.zeros((0, 2)), places, [truth], REACH_PX, EXTENT) is suggest.NOTHING
    assert suggest.offer(points, places[:2], [truth], REACH_PX, EXTENT) is suggest.NOTHING
    assert suggest.offer(points, places, [], REACH_PX, EXTENT) is suggest.NOTHING
    assert suggest.agreeing(points[:2], places, truth, 80.0) is suggest.EMPTY


def test_happy_path_confidence_grows_with_the_lift_and_the_closeness() -> None:
    gaps = numpy.array([0.0, 5.0, 10.0])

    assert suggest.confidence(0.0, gaps, 10.0) == (0.0, 0.0, 0.0)
    assert suggest.confidence(4.0, gaps, 10.0) == (0.75, 0.562, 0.375)


def test_happy_path_spread_keeps_the_closest_of_each_cell() -> None:
    points = numpy.array([[10.0, 10.0], [20.0, 20.0], [30.0, 30.0], [1100.0, 900.0]])
    gaps = numpy.array([3.0, 1.0, 2.0, 4.0])

    assert suggest.spread(points, gaps, EXTENT).tolist() == [1, 2, 3]
