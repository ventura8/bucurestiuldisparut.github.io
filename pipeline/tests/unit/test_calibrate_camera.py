"""A KH-9 panoramic frame's camera map (docs/research/M15-calibration-accuracy.md §2)."""

import math

import numpy
from hcm_pipeline.calibrate.camera import MIN_PANORAMIC_TILES, Frame, fit_panoramic
from hcm_pipeline.calibrate.pairs import ScanBox, calibrated
from hcm_pipeline.calibrate.poly import fit_poly, ground_errors
from hcm_pipeline.geo import FloatArray
from hcm_pipeline.georef.lattice import LATTICE_SIDE

# A KH-9 frame's rate: 121 degrees over 20.2 heights of 23,000 pixels.
RAD_PER_PX = math.radians(121.0) / (20.2 * 23000)
TRUE_ANGLES = numpy.array([0.45, 0.12, 0.05, -0.04, 0.01])
MIDDLE_LAT = 44.4
SCAN = ScanBox(1000, 0, 40000, 23000, RAD_PER_PX)


def panoramic_rows(count: int, noise_m: float = 2.0, seed: int = 3) -> FloatArray:
    """Tiles over a 40,000 by 23,000 pixel crop whose map is a panoramic camera at `TRUE_ANGLES`, 1.3 m a pixel."""
    rng = numpy.random.default_rng(seed)
    film = numpy.column_stack((rng.uniform(1000, 41000, count), rng.uniform(0, 23000, count)))
    frame = Frame.of(film, RAD_PER_PX)
    rays = frame.rays(film, TRUE_ANGLES)
    rays = (rays - rays.mean(axis=0)) / rays.std(axis=0)
    places = numpy.column_stack((2.9e6 + 18000 * rays[:, 0] + 600 * rays[:, 1], 5.5e6 - 600 * rays[:, 0] + 10000 * rays[:, 1]))
    places += rng.normal(0, noise_m / math.cos(math.radians(MIDDLE_LAT)), places.shape)
    return numpy.column_stack((film, places, numpy.full(count, 0.5), numpy.full(count, 0.1)))


def test_happy_path_the_camera_holds_a_panoramic_frame_a_polynomial_cannot() -> None:
    """Scenarios: S-P06-HAPPY-PANORAMIC-CAMERA"""
    rows = panoramic_rows(900)
    film, places = rows[:, :2], rows[:, 2:4]

    camera = fit_panoramic(film, places, RAD_PER_PX)

    assert camera is not None
    errors = ground_errors(camera.to_places(film), places)
    quadratic = ground_errors(fit_poly(2, film, places)(film), places)
    assert float(numpy.sqrt(numpy.mean(errors**2))) < 4.0
    assert float(numpy.sqrt(numpy.mean(quadratic**2))) > 2 * float(numpy.sqrt(numpy.mean(errors**2)))
    assert camera.kept >= 0.95 * len(rows)


def test_happy_path_the_camera_ignores_gross_tiles_and_fits_the_same_way_twice() -> None:
    """Scenarios: S-P06-HAPPY-PANORAMIC-CAMERA"""
    rows = panoramic_rows(900)
    rows[:60, 2:4] += 800.0

    first = fit_panoramic(rows[:, :2], rows[:, 2:4], RAD_PER_PX)
    second = fit_panoramic(rows[:, :2], rows[:, 2:4], RAD_PER_PX)

    assert first is not None
    assert second is not None
    assert numpy.array_equal(first.angles, second.angles)
    clean = ground_errors(first.to_places(rows[60:, :2]), rows[60:, 2:4])
    assert float(numpy.sqrt(numpy.mean(clean**2))) < 4.0


def test_bad_path_too_few_tiles_fit_no_camera() -> None:
    """Scenarios: S-P06-BAD-PANORAMIC-FALLS-BACK"""
    rows = panoramic_rows(MIN_PANORAMIC_TILES - 1)

    assert fit_panoramic(rows[:, :2], rows[:, 2:4], RAD_PER_PX) is None


def test_happy_path_a_panoramic_frame_gets_the_cameras_figures_and_a_lattice() -> None:
    """Scenarios: S-P06-HAPPY-PANORAMIC-CAMERA"""
    rows = panoramic_rows(1500)

    found = calibrated(rows, 2, SCAN, MIDDLE_LAT, 7)

    assert found is not None
    assert found.lattice is not None
    assert found.lattice.model == "panoramic"
    assert len(found.lattice.nodes) == LATTICE_SIDE * LATTICE_SIDE
    corner = found.lattice.nodes[-1]
    assert (corner.x, corner.y) == (SCAN.width, SCAN.height)
    fitted = found.fitted
    assert fitted.checkpoint_kind == "held-out"
    assert fitted.checkpoint_rmse_m is not None
    assert fitted.checkpoint_rmse_m < 6.0
    assert found.cross_validated_m is not None
    assert found.cross_validated_m < 6.0
    assert all(gcp.residual_m is not None for gcp in fitted.gcps)
    polynomial = calibrated(rows, 2, ScanBox(SCAN.left, SCAN.top, SCAN.width, SCAN.height), MIDDLE_LAT, 7)
    assert polynomial is not None
    assert polynomial.lattice is None
    assert polynomial.fitted.checkpoint_rmse_m is not None
    assert fitted.checkpoint_rmse_m < polynomial.fitted.checkpoint_rmse_m


def test_bad_path_a_camera_that_holds_fewer_tiles_than_the_polynomial_is_not_used() -> None:
    """Scenarios: S-P06-BAD-PANORAMIC-FALLS-BACK"""
    rows = panoramic_rows(1500)
    wrong = ScanBox(SCAN.left, SCAN.top, SCAN.width, SCAN.height, 2e-3)

    found = calibrated(rows, 2, wrong, MIDDLE_LAT, 7)

    assert found is not None
    assert found.lattice is None
