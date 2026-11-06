"""The corner guess of `locate` on a KH-9-like panoramic strip (findings 62 and 63 of 2026-11-02).

The live frame (KH-9 Hexagon, 1972-02-02, a 1:12 strip) was cropped under a quarter turn that correlated 0.03: the crop
ran along the strip's whole length (a scan over `MAX_SCAN_PIXELS`) and matched nothing. Here a synthetic strip (1:3.75,
4 m pixels, its film stored turned and mirrored) is made from the seeded world through a known assignment, its metadata
corners a little or kilometres off; the guess must keep only the square-pixel assignments, recover the right one,
search around the window when the corners are far off, and leave a frame that shows another place to the admin's points.
"""

import math
from dataclasses import replace
from typing import Final

import cv2
import numpy
import pytest
from hcm_pipeline.contract import MAX_SCAN_PIXELS, Errors
from hcm_pipeline.geo import Grid, MercatorBox, to_lnglat, to_mercator
from hcm_pipeline.georef import corners
from hcm_pipeline.georef.corners import (
    MAX_ANISOTROPY,
    MIN_CORRELATION,
    NO_SCORE,
    SCORE_RESOLUTION_M,
    Assignment,
    CityNotFoundError,
    Crop,
    Frame,
    Guess,
    anisotropy,
    assignments,
    crop,
    crop_box,
    guess_corners,
    plausible,
    weak_crop,
)
from hcm_pipeline.georef.surface import Surface
from hcm_pipeline.images import UInt8Array, as_uint8, resize
from hcm_pipeline.jobs import StepFailedError
from hcm_pipeline.steps.georef import scan_resolution
from hcm_pipeline.steps.locate import guess_line, within_limits

from tests.synthetic.scenes import CENTRE, World, render_world

# The strip: 2 400 by 640 film pixels of 4 m (9.6 by 2.56 km), its long side turned 15 degrees from east.
WIDTH: Final = 2400
HEIGHT: Final = 640
PIXEL_M: Final = 4.0
STRIP_ANGLE_DEG: Final = 15.0
# The film's top-left corner lies at the strip's north-east corner, its top edge along the north side, mirrored.
TRUE_ROTATION: Final = 1
TRUE_MIRRORED: Final = True
# The frame is scored shrunk to about 32 m a pixel, as `locate` shrinks it to about 30.
SHRINK: Final = 8
# The city window: 3.6 km square, 1.5 km along the strip from its middle.
WINDOW_SIDE_M: Final = 3600.0
WINDOW_ALONG_M: Final = 1500.0


def strip_quad(offset: tuple[float, float] = (0.0, 0.0)) -> list[tuple[float, float]]:
    """The strip's geographic corners (lat, lng), north-west first and clockwise, moved by `offset` metres."""
    cx, cy = to_mercator(*CENTRE)
    angle = math.radians(STRIP_ANGLE_DEG)
    half_long, half_short = WIDTH * PIXEL_M / 2, HEIGHT * PIXEL_M / 2
    quad = []
    for sx, sy in ((-1, 1), (1, 1), (1, -1), (-1, -1)):
        x, y = sx * half_long, sy * half_short
        mx = cx + x * math.cos(angle) - y * math.sin(angle) + offset[0]
        my = cy + x * math.sin(angle) + y * math.cos(angle) + offset[1]
        lng, lat = to_lnglat(mx, my)
        quad.append((lat, lng))
    return quad


def true_assignment() -> Assignment:
    found = [
        candidate
        for candidate in assignments(WIDTH, HEIGHT, strip_quad())
        if (candidate.rotation, candidate.mirrored) == (TRUE_ROTATION, TRUE_MIRRORED)
    ]
    return found[0]


def render_strip(world: World, transform: Assignment) -> UInt8Array:
    """The film: every pixel the world's grey at the place `transform` gives it, with film grain."""
    u, v = numpy.meshgrid(numpy.arange(WIDTH) + 0.5, numpy.arange(HEIGHT) + 0.5)
    mx, my = transform.to_mercator(u.astype(numpy.float64), v.astype(numpy.float64))
    gx, gy = world.grid.to_pixel(mx, my)
    pixels = cv2.remap(world.pixels, (gx - 0.5).astype(numpy.float32), (gy - 0.5).astype(numpy.float32), cv2.INTER_LINEAR, borderValue=128)
    grain = numpy.random.default_rng(5).normal(0, 3, pixels.shape)
    return as_uint8(numpy.clip(pixels + grain, 0, 255))


def window() -> MercatorBox:
    cx, cy = to_mercator(*CENTRE)
    angle = math.radians(STRIP_ANGLE_DEG)
    x, y = cx + WINDOW_ALONG_M * math.cos(angle), cy + WINDOW_ALONG_M * math.sin(angle)
    half = WINDOW_SIDE_M / 2
    return MercatorBox(x - half, y - half, x + half, y + half)


def reference_of(world: World, box: MercatorBox) -> tuple[UInt8Array, Grid]:
    """The world's grey over `box` at 60 m (what Sentinel-2 gives `locate`)."""
    grid = Grid.over(box, SCORE_RESOLUTION_M)
    mx, my = grid.centres()
    gx, gy = world.grid.to_pixel(mx, my)
    pixels = cv2.remap(world.pixels, (gx - 0.5).astype(numpy.float32), (gy - 0.5).astype(numpy.float32), cv2.INTER_AREA, borderValue=128)
    return as_uint8(pixels), grid


@pytest.fixture(scope="module")
def world() -> World:
    return render_world(7)


@pytest.fixture(scope="module")
def strip(world: World) -> Frame:
    film = render_strip(world, true_assignment())
    return Frame(resize(film, (WIDTH // SHRINK, HEIGHT // SHRINK)), float(SHRINK), WIDTH, HEIGHT)


def box_error_px(found: Crop) -> int:
    """The largest distance, in film pixels, between the crop's box and the box the true assignment gives."""
    left, top, right, bottom = crop_box(true_assignment(), window(), WIDTH, HEIGHT)
    return max(abs(found.left - left), abs(found.top - top), abs(found.left + found.width - right), abs(found.top + found.height - bottom))


def test_happy_path_only_the_square_pixel_assignments_of_a_strip_are_scored() -> None:
    """Scenarios: S-P01-HAPPY-KH9-STRIP"""
    shapes = sorted(anisotropy(candidate, WIDTH, HEIGHT) for candidate in assignments(WIDTH, HEIGHT, strip_quad()))
    kept = plausible(WIDTH, HEIGHT, strip_quad())

    # The film's long side along the strip's long side: two turns, and two turns of the mirror image.
    assert {(candidate.rotation, candidate.mirrored) for candidate in kept} == {(0, False), (2, False), (1, True), (3, True)}
    assert shapes[3] <= MAX_ANISOTROPY < shapes[4]
    assert shapes[4] > (WIDTH / HEIGHT) ** 2 * 0.9


def test_happy_path_a_turned_mirrored_strip_with_corners_tens_of_metres_off_is_found_at_once(world: World, strip: Frame) -> None:
    """Scenarios: S-P01-HAPPY-KH9-STRIP"""
    reference, grid = reference_of(world, window())

    guess = guess_corners(strip, strip_quad((40.0, -30.0)), reference, grid)
    located = crop(guess.assignment, window(), WIDTH, HEIGHT)

    assert (guess.assignment.rotation, guess.assignment.mirrored) == (TRUE_ROTATION, TRUE_MIRRORED)
    assert guess.score >= MIN_CORRELATION
    assert guess.moved_m == 0
    assert box_error_px(located) <= 30
    assert max(located.width, located.height) < MAX_SCAN_PIXELS
    assert guess_line(guess) == (
        f"corner guess: rotation 90 degrees, mirrored, correlation {guess.score:.2f}, the frame covers {guess.coverage:.0%} of the window"
    )


def test_happy_path_corners_kilometres_off_are_found_by_the_search_around_the_window(world: World, strip: Frame) -> None:
    """Scenarios: S-P01-HAPPY-KH9-STRIP"""
    reference, grid = reference_of(world, window())
    quad = strip_quad((1300.0, 900.0))

    guess = guess_corners(strip, quad, reference, grid)
    located = crop(guess.assignment, window(), WIDTH, HEIGHT)

    assert (guess.assignment.rotation, guess.assignment.mirrored) == (TRUE_ROTATION, TRUE_MIRRORED)
    assert guess.score >= MIN_CORRELATION
    assert 1000 < guess.moved_m < 2200
    assert box_error_px(located) <= 40
    assert "moved 1." in guess_line(guess)


def test_bad_path_a_frame_of_another_place_is_a_weak_guess_not_a_failure(strip: Frame) -> None:
    """Scenarios: S-P01-BAD-WEAK-GUESS-TO-POINTS, S-P01-BAD-CITY-NOT-FOUND"""
    elsewhere = render_world(99)
    reference, grid = reference_of(elsewhere, window())

    guess = guess_corners(strip, strip_quad(), reference, grid)

    assert guess.weak
    assert guess.moved_m == 0
    assert guess.score < MIN_CORRELATION
    assert guess.coverage > 0.5


def test_bad_path_a_frame_far_from_the_window_does_not_reach_it(world: World, strip: Frame) -> None:
    """Scenarios: S-P01-BAD-CITY-NOT-FOUND, S-P01-BAD-CITY-OFF-FRAME"""
    reference, grid = reference_of(world, window())

    with pytest.raises(CityNotFoundError):
        guess_corners(strip, strip_quad((40_000.0, 40_000.0)), reference, grid)


def test_bad_path_a_crop_box_outside_the_frame_does_not_reach_it() -> None:
    """Scenarios: S-P01-BAD-CITY-OFF-FRAME"""
    far = MercatorBox(window().left + 1e6, window().bottom, window().right + 1e6, window().top)

    with pytest.raises(CityNotFoundError):
        crop_box(true_assignment(), far, WIDTH, HEIGHT)


def test_bad_path_a_weak_crop_holds_the_margin_and_a_side_over_the_limit_is_refused_uncut() -> None:
    """Scenarios: S-P01-BAD-WEAK-GUESS-TO-POINTS, S-P01-BAD-WEAK-GUESS-TOO-WIDE"""
    plain = crop(true_assignment(), window(), WIDTH, HEIGHT)
    assert plain.width < WIDTH

    wide = weak_crop(Guess(true_assignment(), 0.0, weak=True), window(), WIDTH, HEIGHT)
    # The strip is under 10 km long: the margin takes all of it.
    assert (wide.left, wide.top, wide.width, wide.height) == (0, 0, WIDTH, HEIGHT)
    assert wide.weak
    assert not plain.weak

    # A film scale so fine that the margin alone is over the limit: never cut (a cut crop may hold none of the city), refused.
    fine = Assignment(0, False, numpy.array([[0.01, 0.0, window().left - 1e4], [0.0, -0.01, window().top + 1e4], [0.0, 0.0, 1.0]]))
    over = weak_crop(Guess(fine, 0.0, weak=True), window(), 10 * MAX_SCAN_PIXELS, 10 * MAX_SCAN_PIXELS)
    assert max(over.width, over.height) > MAX_SCAN_PIXELS
    with pytest.raises(StepFailedError):
        within_limits(over)


def weak_guesses() -> tuple[list[Guess], list[Guess]]:
    """Four orientations before the search and after it, the first's search the strongest, which on a real frame is noise."""
    firsts = [Guess(candidate, 0.0) for candidate in plausible(WIDTH, HEIGHT, strip_quad())]
    strengths = [5.0, 1.0, 1.0, 1.0]
    return firsts, [replace(first, surface=Surface(0, 0, 0.1, 0.1, 1.0, z)) for first, z in zip(firsts, strengths, strict=True)]


def test_bad_path_a_weak_guess_keeps_the_orientation_that_covers_the_window_most_whatever_noise_says() -> None:
    """Scenarios: S-P01-BAD-WEAK-GUESS-TO-POINTS"""
    firsts, found = weak_guesses()

    kept = corners._weak(firsts, found, [0.0, 1.0, 1.0, 0.5])

    assert kept.assignment is firsts[1].assignment
    assert kept.weak
    # Of equal covers, the search's strength decides.
    assert corners._weak(firsts, found, [1.0, 1.0, 1.0, 1.0]).assignment is firsts[0].assignment


def test_bad_path_a_weak_guess_names_only_the_orientations_that_reach_the_window() -> None:
    """Scenarios: S-P01-BAD-WEAK-GUESS-TO-POINTS"""
    firsts, found = weak_guesses()
    away = [replace(first, score=NO_SCORE) for first in firsts]
    # The second orientation reaches it through its search alone; the third neither way.
    found = [replace(each, score=NO_SCORE) if index != 1 else each for index, each in enumerate(found)]
    away[0] = firsts[0]

    kept = corners._weak(away, found, [1.0, 0.0, 0.0, 0.0])

    assert kept.reaching == (firsts[0].assignment, firsts[1].assignment)


def test_happy_path_a_frames_own_gcps_lie_at_its_corners_and_give_its_transform_back() -> None:
    """Scenarios: S-P01-HAPPY-KH9-STRIP"""
    located = crop(true_assignment(), window(), WIDTH, HEIGHT)

    assert [(gcp.x, gcp.y) for gcp in located.gcps] == [
        (0.0, 0.0),
        (float(located.width), 0.0),
        (float(located.width), float(located.height)),
        (0.0, float(located.height)),
    ]
    assert scan_resolution(located.gcps, located.width) == pytest.approx(PIXEL_M, rel=0.2)


def test_bad_path_a_crop_over_the_largest_scan_side_fails_before_it_is_read() -> None:
    """Scenarios: S-P01-BAD-CITY-NOT-FOUND"""
    with pytest.raises(StepFailedError) as raised:
        within_limits(Crop(0, 0, MAX_SCAN_PIXELS + 1, 2300, ()))

    assert raised.value.code == Errors.PROCESSING_FAILED
    assert f"over the {MAX_SCAN_PIXELS}" in str(raised.value)
    assert within_limits(Crop(0, 0, MAX_SCAN_PIXELS, 2300, ())).width == MAX_SCAN_PIXELS
