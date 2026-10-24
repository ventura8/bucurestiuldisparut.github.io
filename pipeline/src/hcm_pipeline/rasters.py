"""Raster files through GDAL: open, read (whole or downsampled), write GeoTIFFs and the image formats.

Settings of docs/research/M3-interfaces.md §5.2: `GDAL_NUM_THREADS=ALL_CPUS` (unless the environment sets it: 1 in tests),
`GDAL_CACHEMAX` 4096 MB, `CPL_VSIL_USE_TEMP_FILE_FOR_RANDOM_WRITE=YES`; every write is a local file under the
job's scratch folder, uploaded by the step afterwards. GDAL calls a step makes long enough to matter pass a
progress callback that returns 0 when the run must stop (SIGTERM, cancel), which makes GDAL raise.
"""

import os
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Final

import numpy
from numpy.typing import NDArray

from hcm_pipeline.raster import gdal, osr

WEB_MERCATOR: Final = 3857
WGS84: Final = 4326
GTIFF_OPTIONS: Final = ("COMPRESS=DEFLATE", "TILED=YES", "BIGTIFF=IF_SAFER")
DEFAULT_SETTINGS: Final = {
    "GDAL_CACHEMAX": "4096",
    "CPL_VSIL_USE_TEMP_FILE_FOR_RANDOM_WRITE": "YES",
    "GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR",
    "GDAL_HTTP_MAX_RETRY": "3",
    "GDAL_HTTP_RETRY_DELAY": "2",
}
ENV_THREADS: Final = "GDAL_NUM_THREADS"

UInt8Array = NDArray[numpy.uint8]


class RasterError(RuntimeError):
    """A raster could not be read or written (the step fails: `processingFailed`, `unreadableRaster` for an upload)."""


def configure_gdal(threads: str | None = None) -> None:
    """The process-wide GDAL settings of the pipeline (`GDAL_NUM_THREADS` from the environment when it is set)."""
    for key, value in DEFAULT_SETTINGS.items():
        gdal.SetConfigOption(key, value)
    gdal.SetConfigOption(ENV_THREADS, threads or os.environ.get(ENV_THREADS) or "ALL_CPUS")


def srs_wkt(epsg: int) -> str:
    srs = osr.SpatialReference()
    srs.ImportFromEPSG(epsg)
    return srs.ExportToWkt()


@dataclass(frozen=True)
class RasterInfo:
    width: int
    height: int
    bands: int
    data_type: int
    geotransform: tuple[float, float, float, float, float, float] | None
    projection: str
    gcp_count: int
    gcp_projection: str

    @property
    def georeferenced(self) -> bool:
        """True when the file carries its own georeference: a geotransform with a CRS, or GCPs with one."""
        with_transform = self.geotransform is not None and bool(self.projection)
        return with_transform or (self.gcp_count > 0 and bool(self.gcp_projection))


def open_raster(path: Path) -> gdal.Dataset:
    try:
        return gdal.Open(str(path))
    except RuntimeError as error:
        raise RasterError(f"GDAL cannot read {path.name}: {error}") from error


def raster_info(path: Path) -> RasterInfo:
    dataset = open_raster(path)
    info = RasterInfo(
        width=dataset.RasterXSize,
        height=dataset.RasterYSize,
        bands=dataset.RasterCount,
        data_type=dataset.GetRasterBand(1).DataType if dataset.RasterCount else gdal.GDT_Byte,
        geotransform=dataset.GetGeoTransform(can_return_null=True),
        projection=dataset.GetProjection(),
        gcp_count=dataset.GetGCPCount(),
        gcp_projection=dataset.GetGCPProjection(),
    )
    dataset.Close()
    return info


def read_band(path: Path, band: int = 1, size: tuple[int, int] | None = None) -> NDArray[numpy.generic]:
    """One band, whole, or resampled by GDAL to `size` (width, height): a cheap overview of a large file."""
    dataset = open_raster(path)
    raster = dataset.GetRasterBand(band)
    width, height = size if size is not None else (dataset.RasterXSize, dataset.RasterYSize)
    array = raster.ReadAsArray(0, 0, dataset.RasterXSize, dataset.RasterYSize, width, height)
    dataset.Close()
    return numpy.asarray(array)


@dataclass(frozen=True)
class GeoTiff:
    """What `write_geotiff` writes: bands of 8-bit pixels, and optionally a north-up grid in EPSG:3857."""

    bands: Sequence[UInt8Array]
    geotransform: tuple[float, float, float, float, float, float] | None = None
    epsg: int = WEB_MERCATOR
    alpha: bool = False


def write_geotiff(path: Path, image: GeoTiff, options: Sequence[str] = GTIFF_OPTIONS) -> Path:
    driver = gdal.GetDriverByName("GTiff")
    if driver is None:
        raise RasterError("GDAL has no GTiff driver")
    height, width = image.bands[0].shape
    dataset = driver.Create(str(path), width, height, len(image.bands), gdal.GDT_Byte, list(options))
    if image.geotransform is not None:
        dataset.SetGeoTransform(image.geotransform)
        dataset.SetProjection(srs_wkt(image.epsg))
    for index, band in enumerate(image.bands, start=1):
        dataset.GetRasterBand(index).WriteArray(band)
    if image.alpha:
        dataset.GetRasterBand(len(image.bands)).SetColorInterpretation(gdal.GCI_AlphaBand)
    dataset.Close()
    return path


def to_uint8(array: NDArray[numpy.generic], low_pct: float = 2.0, high_pct: float = 98.0) -> UInt8Array:
    """8-bit pixels: kept as they are when already 8-bit, else stretched between two percentiles."""
    if array.dtype == numpy.uint8:
        return numpy.asarray(array, numpy.uint8)
    values = numpy.asarray(array, numpy.float64)
    low, high = numpy.percentile(values, [low_pct, high_pct])
    scaled = (values - low) / max(float(high - low), 1e-9) * 255.0
    return numpy.asarray(numpy.clip(scaled, 0, 255), numpy.uint8)


def fit_long_side(width: int, height: int, max_px: int) -> tuple[int, int, float]:
    """A size whose long side is at most `max_px`, and its scale (at most 1)."""
    scale = min(1.0, max_px / max(width, height))
    return max(1, round(width * scale)), max(1, round(height * scale)), scale
