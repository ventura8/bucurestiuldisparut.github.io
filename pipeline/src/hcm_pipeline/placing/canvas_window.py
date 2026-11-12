"""The mosaic written in windows (docs/research/M20-import-local.md §19.6): never the whole canvas in memory.

The canvas is a tiled, compressed GeoTIFF (not georeferenced) created paper white. The sheets are pasted one at a time: each is read from
its own scan once, already reduced to the canvas's scale (GDAL's average, `raster_io.read_working`), cropped to its content box, turned
and stretched to its cell (`Tile`); then the canvas is visited in windows of at most `WINDOW_PX` over the sheet's box, each read,
the pixels this sheet owns set and written back. A pixel belongs to the covering sheet whose centre is nearest (a hard seam, never a
feather: blending line art doubles its lines), worked out per window from the sheets' boxes alone. Peak memory is one sheet and two
windows, whatever the series' size; GDAL's own block cache is held to `CANVAS_CACHE_BYTES` while the canvas is written.
"""

from collections.abc import Iterator, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Final

import cv2
import numpy

from hcm_pipeline.placing.raster_io import RGB, read_working
from hcm_pipeline.placing.sheetwork import Box, oriented
from hcm_pipeline.placing.streets import UInt8Array, grey_of
from hcm_pipeline.raster import gdal
from hcm_pipeline.rasters import GTIFF_OPTIONS, driver_of

WINDOW_PX: Final = 2048
OWNER_STEP: Final = 4
CANVAS_CACHE_BYTES: Final = 128 * 1024 * 1024
PAPER: Final = 255


@dataclass(frozen=True)
class Tile:
    """A sheet on the canvas: its scan, its content box there (scan pixels), its variant, and its box on the canvas (left, top, width,
    height in canvas pixels)."""

    path: Path
    box: Box
    variant: int
    left: int
    top: int
    width: int
    height: int

    @property
    def centre(self) -> tuple[float, float]:
        return self.left + self.width / 2, self.top + self.height / 2

    def meets(self, window: Box) -> bool:
        x0, y0, x1, y1 = window
        return self.left < x1 and self.left + self.width > x0 and self.top < y1 and self.top + self.height > y0


def _read_px(tile: Tile) -> int:
    """The long side the scan is read at so its content box comes out at least the tile's size (never more than the scan)."""
    across = max(1, tile.box[2] - tile.box[0])
    down = max(1, tile.box[3] - tile.box[1])
    shrink = max(tile.width, tile.height) / max(across, down)
    return max(64, round(1.05 * shrink * max(_scan_size(tile.path))))


def _scan_size(path: Path) -> tuple[int, int]:
    dataset = gdal.Open(str(path))
    size = dataset.RasterXSize, dataset.RasterYSize
    dataset.Close()
    return size


def picture(tile: Tile, colour: bool) -> UInt8Array:
    """The tile's pixels on the canvas: read reduced, cropped to its box, turned and stretched to its canvas size."""
    working = read_working(tile.path, _read_px(tile))
    left, top, right, bottom = (round(value / working.scale) for value in tile.box)
    image = working.image if colour else grey_of(working.image)
    image = _colour(image) if colour else image
    crop = oriented(image[top:bottom, left:right], tile.variant)
    return numpy.asarray(cv2.resize(crop, (tile.width, tile.height), interpolation=cv2.INTER_AREA), numpy.uint8)


def _colour(image: UInt8Array) -> UInt8Array:
    return image if image.ndim == RGB else numpy.dstack([image] * RGB)


def windows(tile: Tile, size: tuple[int, int]) -> Iterator[Box]:
    """The canvas windows over the tile's box, each at most `WINDOW_PX` on a side, cut at the canvas's edge."""
    x_end, y_end = min(size[0], tile.left + tile.width), min(size[1], tile.top + tile.height)
    for y in range(max(0, tile.top), y_end, WINDOW_PX):
        for x in range(max(0, tile.left), x_end, WINDOW_PX):
            yield x, y, min(x + WINDOW_PX, x_end), min(y + WINDOW_PX, y_end)


def owners(tiles: Sequence[Tile], window: Box) -> numpy.ndarray:
    """Which tile each window pixel takes: the covering one whose centre is nearest (-1 where none covers)."""
    x0, y0, x1, y1 = window
    v, u = numpy.mgrid[y0:y1:OWNER_STEP, x0:x1:OWNER_STEP].astype(numpy.float64) + OWNER_STEP / 2
    best = numpy.full(u.shape, numpy.inf)
    owner = numpy.full(u.shape, -1, numpy.int32)
    for index, tile in enumerate(tiles):
        if not tile.meets(window):
            continue
        inside = (u >= tile.left) & (u < tile.left + tile.width) & (v >= tile.top) & (v < tile.top + tile.height)
        distance = numpy.hypot(u - tile.centre[0], v - tile.centre[1])
        better = inside & (distance < best)
        best[better], owner[better] = distance[better], index
    return numpy.asarray(cv2.resize(owner, (x1 - x0, y1 - y0), interpolation=cv2.INTER_NEAREST), numpy.int32)


def _read(dataset: gdal.Dataset, window: Box) -> UInt8Array:
    x0, y0, x1, y1 = window
    bands = [dataset.GetRasterBand(band).ReadAsArray(x0, y0, x1 - x0, y1 - y0) for band in range(1, dataset.RasterCount + 1)]
    return numpy.asarray(numpy.dstack(bands) if len(bands) > 1 else bands[0], numpy.uint8)


def _write(dataset: gdal.Dataset, window: Box, pixels: UInt8Array) -> None:
    planes = [pixels[:, :, band] for band in range(pixels.shape[2])] if pixels.ndim == RGB else [pixels]
    for band, plane in enumerate(planes, start=1):
        dataset.GetRasterBand(band).WriteArray(plane, window[0], window[1])


@dataclass(frozen=True)
class Canvas:
    """Where the canvas goes, its size (width, height), and whether it is in colour."""

    target: Path
    size: tuple[int, int]
    colour: bool


def _paste(dataset: gdal.Dataset, tiles: Sequence[Tile], index: int, pixels: UInt8Array, size: tuple[int, int]) -> None:
    tile = tiles[index]
    for window in windows(tile, size):
        mine = owners(tiles, window) == index
        region = _read(dataset, window)
        x0, y0, x1, y1 = window
        piece = pixels[y0 - tile.top : y1 - tile.top, x0 - tile.left : x1 - tile.left]
        region[mine] = piece[mine]
        _write(dataset, window, region)


def render(tiles: Sequence[Tile], canvas: Canvas) -> Path:
    """Every tile pasted on the canvas, one sheet and one window at a time; the canvas's path."""
    width, height = canvas.size
    bands = RGB if canvas.colour else 1
    previous = gdal.GetCacheMax()
    gdal.SetCacheMax(CANVAS_CACHE_BYTES)
    try:
        dataset = driver_of("GTiff").Create(str(canvas.target), width, height, bands, gdal.GDT_Byte, list(GTIFF_OPTIONS))
        for band in range(1, bands + 1):
            dataset.GetRasterBand(band).Fill(PAPER)
        for index, tile in enumerate(tiles):
            _paste(dataset, tiles, index, picture(tile, canvas.colour), canvas.size)
            dataset.FlushCache()
        dataset.Close()
    finally:
        gdal.SetCacheMax(previous)
    return canvas.target
