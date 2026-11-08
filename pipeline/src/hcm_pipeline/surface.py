"""The surface model under a city: Copernicus DEM GLO-30, for the terrain a frame seen off nadir shows (M15-calibration-accuracy.md,
*Terrain*).

GLO-30's public tiles (AWS open data, bucket `copernicus-dem-30m`, anonymous https; free licence, its notice `DEM_NOTICE` goes with
every layer corrected with it: `functions/src/imagery/finalize.ts`) are one degree each, named by their south-west corner; a tile that
does not exist (open sea) or cannot be read is ground at 0 m. The window's tiles are warped to EPSG:3857 at 30 ground metres a cell, at
most `MAX_CELLS` a side (a larger window, coarser cells), averaged over a 900 m square: the area a tile of the proof measures, and a
scale at which today's buildings and trees, which the 1970s city lacked, weigh little. Float32, deflated: 3.1 MB for Bucharest.
"""

import math
from collections.abc import Sequence
from pathlib import Path
from typing import Final

import cv2
import numpy
from numpy.typing import NDArray

from hcm_pipeline.calibrate.terrain import Heights
from hcm_pipeline.geo import Bounds, Grid, MercatorBox, ground_scale
from hcm_pipeline.raster import gdal, osr
from hcm_pipeline.rasters import GTIFF_OPTIONS, driver_of

DEM_SOURCE: Final = "glo30"
DEM_CELL_GROUND_M: Final = 30.0
SMOOTH_GROUND_M: Final = 900.0
MAX_CELLS: Final = 4096
MIN_CELLS: Final = 2
DEM_NOTICE: Final = (
    "Copernicus DEM GLO-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the "
    "European Union and ESA; all rights reserved"
)
TILE_EPSILON_DEG: Final = 1e-9


def tile_name(lat: int, lng: int) -> str:
    """The GLO-30 tile whose south-west corner is (`lat`, `lng`), as its folder and file."""
    north, east = "N" if lat >= 0 else "S", "E" if lng >= 0 else "W"
    name = f"Copernicus_DSM_COG_10_{north}{abs(lat):02d}_00_{east}{abs(lng):03d}_00_DEM"
    return f"{name}/{name}.tif"


def tile_names(bounds: Bounds) -> list[str]:
    """Every tile the bounds touch."""
    lats = range(math.floor(bounds.south), math.floor(bounds.north - TILE_EPSILON_DEG) + 1)
    lngs = range(math.floor(bounds.west), math.floor(bounds.east - TILE_EPSILON_DEG) + 1)
    return [tile_name(lat, lng) for lat in lats for lng in lngs]


def surface_grid(window: MercatorBox) -> Grid:
    """30 ground metres a cell over the window, coarser when a side would pass `MAX_CELLS`."""
    resolution = max(DEM_CELL_GROUND_M / ground_scale(window.bounds().middle_lat), max(window.width, window.height) / MAX_CELLS)
    return Grid.over(window, resolution)


def _readable(sources: Sequence[str]) -> list[str]:
    found = []
    for source in sources:
        try:
            gdal.Open(source).Close()
        except RuntimeError:
            continue
        found.append(source)
    return found


def _smoothed(values: NDArray[numpy.float32], grid: Grid, middle_lat: float) -> NDArray[numpy.float32]:
    cells = max(1, round(SMOOTH_GROUND_M / (grid.resolution * ground_scale(middle_lat))))
    return numpy.asarray(cv2.blur(values, (cells, cells), borderType=cv2.BORDER_REFLECT), numpy.float32)


def _write(local: Path, grid: Grid, values: NDArray[numpy.float32]) -> None:
    dataset = driver_of("GTiff").Create(str(local), grid.width, grid.height, 1, gdal.GDT_Float32, list(GTIFF_OPTIONS))
    dataset.SetGeoTransform(grid.geotransform())
    reference = osr.SpatialReference()
    reference.ImportFromEPSG(3857)
    dataset.SetProjection(reference.ExportToWkt())
    dataset.GetRasterBand(1).WriteArray(values)
    dataset.Close()


def write_surface(sources: Sequence[str], window: MercatorBox, local: Path) -> Heights | None:
    """The window's smoothed surface written to `local` (EPSG:3857, float32), and its heights; None when no tile can be read or the
    window holds under 2 x 2 cells."""
    grid, readable = surface_grid(window), _readable(sources)
    if not readable or min(grid.width, grid.height) < MIN_CELLS:
        return None
    box = grid.box()
    warped = gdal.Warp(
        "",
        readable,
        format="MEM",
        dstSRS="EPSG:3857",
        outputBounds=(box.left, box.bottom, box.right, box.top),
        width=grid.width,
        height=grid.height,
        resampleAlg="average",
        warpOptions=["INIT_DEST=0"],
    )
    values = numpy.asarray(warped.GetRasterBand(1).ReadAsArray(), numpy.float32)
    warped.Close()
    smooth = _smoothed(values, grid, window.bounds().middle_lat)
    _write(local, grid, smooth)
    return Heights(grid.left, grid.top, grid.resolution, smooth)


def heights_of(local: Path) -> Heights:
    """A surface `write_surface` wrote."""
    dataset = gdal.Open(str(local))
    left, resolution, _, top, _, _ = dataset.GetGeoTransform()
    values = numpy.asarray(dataset.GetRasterBand(1).ReadAsArray(), numpy.float32)
    dataset.Close()
    return Heights(left, top, resolution, values)
