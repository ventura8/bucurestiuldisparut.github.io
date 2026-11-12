"""How an archive series' tiles are encoded (docs/research/M20-import-local.md §6); every other layer keeps today's tiles.

`grey` is today's: lossy WebP at quality 75, bilinear at the deepest zoom, averaged above. `colour`: lossy WebP at 82, the same resampling.
`lineart` (a 1-bit or two-tone plan): lossless WebP (libwebp keeps a palette when a tile has few colours), nearest at every zoom so a
line stays one crisp pixel and no grey halo appears (overview averaging washed alpha to near-invisible — Post 1847, 2026-11-11);
with the paper transparent (`paper_transparent`), the plan overlays the basemap or a satellite layer. Paper is any pixel lighter than
the threshold; ink stays opaque black.
"""

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Final

import numpy as np
from numpy.typing import NDArray

from hcm_pipeline.raster import gdal

PAPER_THRESHOLD: Final = 128
STRIP_ROWS: Final = 1024
OPAQUE: Final = 255
WHITE: Final = 255
RGBA: Final = 4


@dataclass(frozen=True)
class TileEncoding:
    """The WebP creation options and the resampling of a pyramid."""

    options: tuple[str, ...]
    resampling: str
    overview_resampling: str = "average"


ENCODINGS: Final = {
    "grey": TileEncoding(("QUALITY=75",), "bilinear"),
    "colour": TileEncoding(("QUALITY=82",), "bilinear"),
    # Nearest for overviews too: averaging RGBA line art made ink semi-transparent (lesson: Post 1847 almost invisible).
    "lineart": TileEncoding(("LOSSLESS=YES",), "nearest", overview_resampling="nearest"),
}


def encoding_of(name: object) -> TileEncoding:
    """A job's `params.encoding` (none, or one no pyramid knows, is today's grey)."""
    return ENCODINGS.get(str(name), ENCODINGS["grey"])


def _strip(grey: NDArray[Any], alpha: NDArray[Any]) -> list[NDArray[np.uint8]]:
    """Ink opaque black, paper transparent white, outside the map transparent."""
    ink = (grey < PAPER_THRESHOLD) & (alpha > 0)
    colour = np.where(ink, 0, WHITE).astype(np.uint8)
    return [colour, colour, colour, np.where(ink, OPAQUE, 0).astype(np.uint8)]


def _created(source: gdal.Dataset, target: Path) -> gdal.Dataset:
    """An empty tiled RGBA GeoTIFF over `source`'s grid."""
    driver = gdal.GetDriverByName("GTiff")
    if driver is None:
        raise RuntimeError("GDAL has no GTiff driver")
    options = ["COMPRESS=DEFLATE", "TILED=YES", "ALPHA=YES"]
    out = driver.Create(str(target), source.RasterXSize, source.RasterYSize, RGBA, gdal.GDT_Byte, options)
    out.SetGeoTransform(source.GetGeoTransform())
    out.SetProjection(source.GetProjection())
    return out


def _alpha_rows(dataset: gdal.Dataset, grey: NDArray[Any], top: int) -> NDArray[Any]:
    """The source's own alpha (its last band) over the strip, or all opaque for a raster of one band."""
    if dataset.RasterCount == 1:
        return np.full_like(grey, OPAQUE)
    return dataset.GetRasterBand(dataset.RasterCount).ReadAsArray(0, top, dataset.RasterXSize, grey.shape[0])


def paper_transparent(source: Path, target: Path) -> Path:
    """An RGBA GeoTIFF of a grey-and-alpha (or grey) raster with its paper made transparent, strip by strip."""
    dataset = gdal.Open(str(source))
    width, height = dataset.RasterXSize, dataset.RasterYSize
    out = _created(dataset, target)
    for top in range(0, height, STRIP_ROWS):
        grey = dataset.GetRasterBand(1).ReadAsArray(0, top, width, min(STRIP_ROWS, height - top))
        for index, band in enumerate(_strip(grey, _alpha_rows(dataset, grey, top)), start=1):
            out.GetRasterBand(index).WriteArray(band, 0, top)
    out.FlushCache()
    out.Close()
    dataset.Close()
    return target
