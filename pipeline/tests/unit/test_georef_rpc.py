"""The RPC a frame over terrain renders through, and the surface model it reads (M15-calibration-accuracy.md, *Terrain*)."""

from pathlib import Path

import numpy
import pytest
from hcm_pipeline.geo import Bounds, FloatArray, MercatorBox, to_lnglat_arrays, to_mercator
from hcm_pipeline.georef.rpc import TERMS, Rpc, fit_rpc
from hcm_pipeline.raster import gdal, osr
from hcm_pipeline.rasters import driver_of
from hcm_pipeline.surface import MAX_CELLS, heights_of, surface_grid, tile_name, tile_names, write_surface

ORIGIN = numpy.array(to_mercator(26.1, 44.43))
SIZE = (2000, 1500)
PARALLAX = numpy.array([0.6, -0.1])


def ground_at(film: FloatArray, height_m: float) -> tuple[FloatArray, FloatArray]:
    """A frame 1.5 m a pixel, turned a little, seen 31 degrees off nadir: higher ground shows further east."""
    x, y = film[:, 0], film[:, 1]
    flat = ORIGIN + numpy.column_stack((2.1 * x + 0.1 * y, -0.12 * x - 2.1 * y))
    places = flat - (height_m / 0.714) * PARALLAX
    return to_lnglat_arrays(places[:, 0], places[:, 1])


def test_happy_path_an_rpc_holds_a_map_over_heights_and_round_trips_its_record() -> None:
    """Scenarios: S-P06-HAPPY-TERRAIN"""
    rpc = fit_rpc(ground_at, SIZE, (40.0, 120.0))

    assert rpc is not None
    film = numpy.array([[0.0, 0.0], [1234.5, 777.0], [2000.0, 1500.0]])
    for height in (40.0, 87.0, 120.0):
        lng, lat = ground_at(film, height)
        assert numpy.abs(rpc.to_pixel(lng, lat, numpy.full(3, height)) - film).max() < 1e-3
    again = Rpc.of(rpc.as_record())
    assert again == rpc
    metadata = rpc.metadata()
    assert len(metadata["LINE_NUM_COEFF"].split()) == TERMS
    assert {"LINE_OFF", "SAMP_SCALE", "LONG_OFF", "HEIGHT_SCALE"} <= metadata.keys()


def test_happy_path_gdal_reads_the_rpc_and_the_surface_as_the_fit_does(tmp_path: Path) -> None:
    """Scenarios: S-P06-HAPPY-TERRAIN"""
    rpc = fit_rpc(ground_at, SIZE, (40.0, 120.0))
    assert rpc is not None
    surface = tmp_path / "surface.tif"
    dataset = driver_of("GTiff").Create(str(surface), 50, 50, 1, gdal.GDT_Float32)
    dataset.SetGeoTransform((ORIGIN[0] - 5000, 400.0, 0.0, ORIGIN[1] + 5000, 0.0, -400.0))
    reference = osr.SpatialReference()
    reference.ImportFromEPSG(3857)
    dataset.SetProjection(reference.ExportToWkt())
    dataset.GetRasterBand(1).WriteArray(numpy.full((50, 50), 90.0, numpy.float32))
    dataset.Close()
    scan = driver_of("MEM").Create("", *SIZE, 1)
    for key, value in rpc.metadata().items():
        scan.SetMetadataItem(key, value, "RPC")
    options = ["METHOD=RPC", f"RPC_DEM={surface}", "RPC_DEM_APPLY_VDATUM_SHIFT=FALSE", "DST_SRS=EPSG:4326"]
    transformer = gdal.Transformer(scan, None, options)
    lng, lat = ground_at(numpy.array([[700.0, 400.0]]), 90.0)

    pixels, _ = transformer.TransformPoints(1, [(float(lng[0]), float(lat[0]), 0.0)])

    assert tuple(pixels[0][:2]) == pytest.approx((700.0, 400.0), abs=0.01)


def test_bad_path_a_map_no_rational_cubic_holds_gives_no_rpc() -> None:
    """Scenarios: S-P06-BAD-TERRAIN-NEGLIGIBLE"""

    def torn(film: FloatArray, height_m: float) -> tuple[FloatArray, FloatArray]:
        lng, lat = ground_at(film, height_m)
        return lng + numpy.where(film[:, 0] > 1000, 0.01, 0.0), lat

    assert fit_rpc(torn, SIZE, (40.0, 120.0)) is None


@pytest.mark.parametrize(
    "record",
    [
        None,
        {"offset": {}, "scale": {}},
        {"offset": {"line": True}},
    ],
)
def test_bad_path_a_malformed_rpc_record_is_refused(record: object) -> None:
    """Scenarios: S-P06-BAD-TERRAIN-NEGLIGIBLE"""
    with pytest.raises(ValueError, match="rpc"):
        Rpc.of(record)


def test_bad_path_an_rpc_record_with_too_few_coefficients_is_refused() -> None:
    """Scenarios: S-P06-BAD-TERRAIN-NEGLIGIBLE"""
    rpc = fit_rpc(ground_at, SIZE, (40.0, 120.0))
    assert rpc is not None
    record = rpc.as_record()

    with pytest.raises(ValueError, match="twenty"):
        Rpc.of({**record, "lineNum": [1.0, 2.0]})
    with pytest.raises(ValueError, match="number"):
        Rpc.of({**record, "sampDen": [True] * TERMS})


def test_happy_path_glo30_tiles_are_named_by_their_south_west_corner() -> None:
    """Scenarios: S-P06-HAPPY-TERRAIN"""
    assert tile_name(44, 26) == "Copernicus_DSM_COG_10_N44_00_E026_00_DEM/Copernicus_DSM_COG_10_N44_00_E026_00_DEM.tif"
    assert tile_name(-55, -68).startswith("Copernicus_DSM_COG_10_S55_00_W068_00_DEM/")
    assert len(tile_names(Bounds(26.1, 44.2, 26.4, 44.6))) == 1
    assert len(tile_names(Bounds(25.5, 43.5, 27.0, 45.0))) == 4


def glo30_tile(path: Path, lat: int, lng: int, height: float) -> Path:
    """A one-degree tile at 3 arc minutes: `height` plus a ridge along its middle longitude."""
    dataset = driver_of("GTiff").Create(str(path), 20, 20, 1, gdal.GDT_Float32)
    dataset.SetGeoTransform((lng, 0.05, 0.0, lat + 1, 0.0, -0.05))
    reference = osr.SpatialReference()
    reference.ImportFromEPSG(4326)
    dataset.SetProjection(reference.ExportToWkt())
    values = numpy.full((20, 20), height, numpy.float32)
    values[:, 10] += 200.0
    dataset.GetRasterBand(1).WriteArray(values)
    dataset.Close()
    return path


def test_happy_path_a_surface_is_warped_smoothed_and_read_back(tmp_path: Path) -> None:
    """Scenarios: S-P06-HAPPY-TERRAIN"""
    tile = glo30_tile(tmp_path / "tile.tif", 44, 26, 80.0)
    window = Bounds(26.2, 44.3, 26.8, 44.6).mercator()

    heights = write_surface([str(tile), str(tmp_path / "missing.tif")], window, tmp_path / "surface.tif")

    assert heights is not None
    again = heights_of(tmp_path / "surface.tif")
    assert numpy.array_equal(again.values, heights.values)
    middle = numpy.array([to_mercator(26.525, 44.45)])
    away = numpy.array([to_mercator(26.25, 44.45)])
    edge = numpy.array([to_mercator(26.5, 44.45)])
    # A ridge 4 km wide keeps its 280 m in its middle; its edge is averaged over the 900 m square.
    assert float(heights.at(middle)[0]) == pytest.approx(280.0, abs=0.5)
    assert float(heights.at(away)[0]) == pytest.approx(80.0, abs=0.5)
    assert 100.0 < float(heights.at(edge)[0]) < 260.0
    assert heights.resolution * 0.714 == pytest.approx(30.0, rel=0.01)


def test_bad_path_no_readable_tile_or_a_window_too_small_gives_no_surface(tmp_path: Path) -> None:
    """Scenarios: S-P06-BAD-TERRAIN-UNAVAILABLE"""
    window = Bounds(26.2, 44.3, 26.8, 44.6).mercator()
    tile = glo30_tile(tmp_path / "tile.tif", 44, 26, 80.0)
    tiny = MercatorBox(window.left, window.bottom, window.left + 20.0, window.bottom + 20.0)

    assert write_surface([str(tmp_path / "missing.tif")], window, tmp_path / "a.tif") is None
    assert write_surface([str(tile)], tiny, tmp_path / "b.tif") is None


def test_happy_path_a_wide_window_takes_coarser_cells() -> None:
    """Scenarios: S-P06-HAPPY-TERRAIN"""
    grid = surface_grid(Bounds(20.0, 40.0, 30.0, 48.0).mercator())

    assert max(grid.width, grid.height) <= MAX_CELLS + 1
