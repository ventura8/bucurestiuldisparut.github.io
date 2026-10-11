"""Stubs for the part of `osgeo.gdal` (GDAL 3.13) the repository calls.

GDAL's names are CamelCase (GetDriverByName, WriteArray). pep8-naming (ruff N802) rejects a `def`
with such a name and the repository never relaxes N802, so each function and method is declared as
a typed callable attribute: calls type-check exactly the same way. Arguments are positional.
"""

from collections.abc import Callable, Sequence
from typing import Any

from numpy.typing import NDArray

__version__: str

GDT_Byte: int

GeoTransform = tuple[float, float, float, float, float, float]

class Band:
    WriteArray: Callable[[NDArray[Any]], int]
    ReadAsArray: Callable[[], NDArray[Any]]
    Checksum: Callable[[], int]

class Dataset:
    RasterXSize: int
    RasterYSize: int
    RasterCount: int
    GetRasterBand: Callable[[int], Band]
    GetGeoTransform: Callable[[], GeoTransform]
    SetGeoTransform: Callable[[GeoTransform], int]
    GetProjection: Callable[[], str]
    SetProjection: Callable[[str], int]
    FlushCache: Callable[[], int]
    Close: Callable[[], int]

class Driver:
    ShortName: str
    # Create(path, xsize, ysize, bands, data_type, creation_options)
    Create: Callable[[str, int, int, int, int, Sequence[str]], Dataset]

UseExceptions: Callable[[], None]
GetDriverByName: Callable[[str], Driver | None]
Open: Callable[[str], Dataset]
