"""The film's dark rim cut from a layer's alpha (`tiles/rim.py`, docs/research/M12-own-tiles.md -> *The dark rim*): real GDAL, real tiles.

A synthetic warped frame like 1980's KH-9: a diagonal edge, an 8-pixel black rim inside it under an opaque alpha, a black building deep
inside, and a dark street that runs from the edge far into the frame. The tiles' alpha loses the rim and keeps the rest.
"""

from pathlib import Path

import numpy
import pytest
from hcm_pipeline.geo import ZOOM0_RESOLUTION_M, to_mercator
from hcm_pipeline.images import UInt8Array, as_uint8
from hcm_pipeline.raster import gdal, osr
from hcm_pipeline.rasters import driver_of
from hcm_pipeline.runner import RunOutcome
from hcm_pipeline.steps.export import Warped, write_cog
from hcm_pipeline.steps.pyramid import rgba_view
from hcm_pipeline.tiles.rim import RIM_MAX_M, RIM_PREVIEW_MAX_PX, preview_factor

from tests.fakes.world import PipelineWorld
from tests.integration.tiling import FILES, run_tiles_job, seed_old_version
from tests.integration.tiling import ZOOM as TILING_ZOOM
from tests.unit.pmtiles_reader import Archive

SIZE = 600
#: A z14 grid, as the other tiling tests: about 9.6 m a pixel, so the cut reaches at most 26 pixels in.
ZOOM = TILING_ZOOM
RESOLUTION = ZOOM0_RESOLUTION_M / 2**ZOOM
REACH_PX = round(RIM_MAX_M / RESOLUTION)
RIM_PX = 8
SCENE_GREY = 120
BLACK = 2


def edge_row(column: int) -> int:
    """The frame's skewed northern edge: the first opaque row of each column."""
    return 100 + column // 3


def framed(path: Path, rim_px: int = RIM_PX, street: bool = True) -> Path:
    """The frame: opaque below its edge, a black rim `rim_px` deep along it, a black building and a long dark street inside."""
    rows = numpy.indices((SIZE, SIZE))[0]
    edge = numpy.array([edge_row(column) for column in range(SIZE)])[numpy.newaxis, :]
    alpha = numpy.where(rows >= edge, 255, 0).astype(numpy.uint8)
    grey = numpy.full((SIZE, SIZE), SCENE_GREY, numpy.uint8)
    grey[(rows >= edge) & (rows < edge + rim_px)] = BLACK
    grey[400:440, 100:140] = BLACK
    if street:
        grey[:, 500:506] = BLACK
    return write_frame(path, grey, alpha)


def frame_origin() -> tuple[float, float]:
    """Where the other tiling tests' layer lies (`grey_warped`), so the version's recorded bounds hold this frame too."""
    left, top = to_mercator(26.1, 44.43)
    return left - left % RESOLUTION, top - top % RESOLUTION


def write_frame(path: Path, grey: UInt8Array, alpha: UInt8Array) -> Path:
    left, top = frame_origin()
    dataset = driver_of("GTiff").Create(str(path), SIZE, SIZE, 2, gdal.GDT_Byte)
    dataset.SetGeoTransform((left, RESOLUTION, 0, top, 0, -RESOLUTION))
    srs = osr.SpatialReference()
    srs.ImportFromEPSG(3857)
    dataset.SetProjection(srs.ExportToWkt())
    dataset.GetRasterBand(1).WriteArray(grey)
    dataset.GetRasterBand(2).SetColorInterpretation(gdal.GCI_AlphaBand)
    dataset.GetRasterBand(2).WriteArray(alpha)
    dataset.Close()
    return path


def alpha_of(view: Path) -> UInt8Array:
    dataset = gdal.Open(str(view))
    band = dataset.GetRasterBand(4)
    assert band.GetColorInterpretation() == gdal.GCI_AlphaBand
    return as_uint8(band.ReadAsArray())


def test_happy_path_the_rim_is_cut_and_the_frame_inside_kept(tmp_path: Path) -> None:
    """Scenarios: S-P08-HAPPY-RIM-CUT"""
    alpha = alpha_of(rgba_view(framed(tmp_path / "warped.tif"), tmp_path / "rgba.vrt"))

    column = 60
    edge = edge_row(column)
    assert alpha[edge - 5, column] == 0, "outside stays transparent"
    assert alpha[edge + 1 : edge + RIM_PX - 1, column].max() == 0, "the black rim no longer shows"
    assert alpha[edge + RIM_PX + 4, column] == 255, "the scene right past the rim shows"
    assert alpha[400:440, 100:140].min() == 255, "a black building deep inside is the picture's own"
    assert alpha[300:400, 200:300].min() == 255


def test_happy_path_the_tiles_of_a_frame_with_a_rim_show_no_black_band(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P08-HAPPY-RIM-CUT"""
    seed_old_version(world, tmp_path)
    cog = write_cog(Warped.of(framed(tmp_path / "framed.tif")), tmp_path / "framed-cog.tif")
    world.gcs.put(f"{FILES}cog.tif", cog.read_bytes())

    assert run_tiles_job(world) is RunOutcome.DONE

    archive = Archive(world.gcs.objects[f"{FILES}tiles.pmtiles"].data)
    black = sum(opaque_black(data, tmp_path) for data in tiles_of(archive))
    # The building (40 x 40) and the street past the reach are black and opaque; the rim (8 deep along 600 columns) no longer is.
    assert 0 < black < 40 * 40 + 6 * SIZE


def tiles_of(archive: Archive) -> list[bytes]:
    """Every z14 tile of the frame, found by its grid."""
    span = ZOOM0_RESOLUTION_M * 256 / 2**ZOOM
    origin = ZOOM0_RESOLUTION_M * 256 / 2
    left, top = frame_origin()
    first_x, first_y = int((left + origin) // span), int((origin - top) // span)
    found = [archive.tile(ZOOM, first_x + dx, first_y + dy) for dx in range(4) for dy in range(4)]
    return [data for data in found if data is not None]


def opaque_black(data: bytes, folder: Path) -> int:
    file = folder / "tile.webp"
    file.write_bytes(data)
    dataset = gdal.Open(str(file))
    pixels = numpy.asarray(dataset.ReadAsArray())
    dataset.Close()
    if pixels.shape[0] != 4:
        return int((pixels[0] <= BLACK + 8).sum())
    return int(((pixels[0] <= BLACK + 8) & (pixels[3] >= 250)).sum())


def test_bad_path_a_dark_street_from_the_edge_is_cut_only_to_the_limit(tmp_path: Path) -> None:
    """Scenarios: S-P08-BAD-RIM-LIMITS"""
    alpha = alpha_of(rgba_view(framed(tmp_path / "warped.tif"), tmp_path / "rgba.vrt"))

    street = 502
    edge = edge_row(street)
    assert alpha[edge + RIM_PX + 2, street] == 0, "within the reach, the street is taken for the rim"
    assert alpha[edge + REACH_PX + 6 :, street].min() == 255, "past the reach, the street is the picture's"


def test_bad_path_a_frame_without_a_rim_keeps_its_alpha_untouched(tmp_path: Path) -> None:
    """Scenarios: S-P08-BAD-RIM-LIMITS"""
    source = framed(tmp_path / "warped.tif", rim_px=0, street=False)
    dataset = gdal.Open(str(source))
    before = as_uint8(dataset.GetRasterBand(2).ReadAsArray())
    dataset.Close()

    view = rgba_view(source, tmp_path / "rgba.vrt")

    assert not (tmp_path / "rgba-rim.tif").exists()
    assert numpy.array_equal(alpha_of(view), before)


def test_happy_path_a_cogs_mask_loses_its_rim_too(tmp_path: Path) -> None:
    """Scenarios: S-P08-HAPPY-RIM-CUT"""
    cog = write_cog(Warped.of(framed(tmp_path / "warped.tif")), tmp_path / "cog.tif")

    alpha = alpha_of(rgba_view(cog, tmp_path / "rgba.vrt"))

    column = 60
    assert alpha[edge_row(column) + 2 : edge_row(column) + RIM_PX - 2, column].max() == 0
    assert alpha[300:400, 200:300].min() == 255


@pytest.mark.parametrize(("width", "height", "factor"), [(600, 600, 1), (8192, 100, 1), (8193, 100, 2), (30_370, 22_980, 4)])
def test_happy_path_the_preview_stays_small(width: int, height: int, factor: int) -> None:
    """Scenarios: S-P08-HAPPY-RIM-CUT"""
    assert preview_factor(width, height) == factor
    assert RIM_PREVIEW_MAX_PX == 8192
