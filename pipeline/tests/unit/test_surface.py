"""The search surface of `locate`: a correlation over only the pixels the frame covers, and what its peak is worth (lesson 361)."""

from typing import Final

import numpy
from hcm_pipeline.georef.surface import (
    MIN_PEAK_RATIO,
    MIN_PEAK_Z,
    MIN_PLACE_COVERAGE,
    Surface,
    masked_correlation,
    search_surface,
    surface_of,
)

SIZE: Final = (60, 80)
TEMPLATE: Final = (20, 24)
PLACE: Final = (17, 31)


def noisy(seed: int, shape: tuple[int, int]) -> numpy.ndarray:
    return numpy.random.default_rng(seed).normal(100.0, 20.0, shape)


def by_hand(image: numpy.ndarray, mask: numpy.ndarray, template: numpy.ndarray, y: int, x: int) -> float:
    """The correlation at one place, the slow way."""
    held = mask[y : y + template.shape[0], x : x + template.shape[1]]
    a, b = image[y : y + template.shape[0], x : x + template.shape[1]][held], template[held]
    a, b = a - a.mean(), b - b.mean()
    return float((a * b).sum() / numpy.sqrt((a * a).sum() * (b * b).sum()))


def test_happy_path_the_masked_correlation_is_the_correlation_of_the_covered_pixels_at_every_place() -> None:
    """Scenarios: S-P01-HAPPY-PANORAMIC-LOCATE"""
    image, template = noisy(1, SIZE), noisy(2, TEMPLATE)
    mask = numpy.zeros(SIZE, bool)
    mask[10:, 15:] = True

    correlations, shares = masked_correlation(image, mask, template)

    assert correlations.shape == (SIZE[0] - TEMPLATE[0] + 1, SIZE[1] - TEMPLATE[1] + 1)
    for y, x in ((10, 15), (17, 31), (5, 20), (30, 50)):
        assert abs(correlations[y, x] - by_hand(image, mask, template, y, x)) < 1e-6
    assert shares[10, 15] == 1.0
    # At the corner the mask holds 10 of the template's 20 rows and 9 of its 24 columns.
    assert shares[0, 0] == 10 * 9 / (20 * 24)


def test_bad_path_a_blank_area_around_the_frame_does_not_attract_the_peak() -> None:
    """Scenarios: S-P01-HAPPY-PANORAMIC-LOCATE"""
    # The frame covers the image's lower right; the rest is 0, whose edge against the frame would correlate with any gradient.
    image = noisy(3, SIZE)
    template = image[PLACE[0] : PLACE[0] + TEMPLATE[0], PLACE[1] : PLACE[1] + TEMPLATE[1]].copy()
    mask = numpy.zeros(SIZE, bool)
    mask[12:, 25:] = True
    image[~mask] = 0.0

    correlations, shares = masked_correlation(image, mask, template)
    found = surface_of(correlations, shares, 600.0)

    assert found is not None
    assert (found.y, found.x) == PLACE
    assert found.peak > 0.99
    assert found.confident


def test_happy_path_a_lone_peak_is_confident_and_a_peak_among_equals_is_not() -> None:
    """Scenarios: S-P01-HAPPY-PANORAMIC-LOCATE, S-P01-BAD-WEAK-GUESS-TO-POINTS"""
    surface = numpy.random.default_rng(4).normal(0.0, 0.02, (200, 200))
    surface[50, 60] = 0.5
    shares = numpy.ones_like(surface)

    alone = surface_of(surface, shares, 60.0)
    surface[150, 160] = 0.48
    twin = surface_of(surface, shares, 60.0)

    assert alone is not None
    assert (alone.y, alone.x, alone.peak) == (50, 60, 0.5)
    assert alone.ratio >= MIN_PEAK_RATIO
    assert alone.z >= MIN_PEAK_Z
    assert alone.confident
    assert twin is not None
    assert twin.second == 0.48
    assert not twin.confident


def test_bad_path_only_places_covered_enough_count_and_a_peak_with_nothing_beyond_it_proves_nothing() -> None:
    """Scenarios: S-P01-BAD-WEAK-GUESS-TO-POINTS"""
    correlations = numpy.zeros((10, 10))
    correlations[2, 2] = 0.9
    thin = numpy.full((10, 10), MIN_PLACE_COVERAGE - 0.01)

    assert surface_of(correlations, thin, 60.0) is None

    # Every place within 2 km of the peak at a 1 km cell: there is no second best to tell it from.
    found = surface_of(correlations, numpy.ones((10, 10)), 1000.0)
    assert found is not None
    assert found.second == 0.0
    alone = numpy.zeros((3, 3))
    alone[1, 1] = 0.9
    near = surface_of(alone, numpy.ones((3, 3)), 1000.0)
    assert near is not None
    assert near.ratio == 1.0
    assert not near.confident
    flat = surface_of(numpy.zeros((10, 10)), numpy.ones((10, 10)), 60.0)
    assert flat == Surface(0, 0, 0.0, 0.0, 0.0, 0.0)


def test_happy_path_the_search_finds_a_crop_of_a_grey_image_by_its_gradient() -> None:
    """Scenarios: S-P01-HAPPY-PANORAMIC-LOCATE"""
    image = numpy.clip(noisy(5, (120, 120)), 0, 255).astype(numpy.uint8)
    reference = image[30:90, 40:100].copy()
    inside = numpy.ones((120, 120), bool)

    found = search_surface(image, inside, reference, 60.0)

    assert found is not None
    assert (found.y, found.x) == (30, 40)
