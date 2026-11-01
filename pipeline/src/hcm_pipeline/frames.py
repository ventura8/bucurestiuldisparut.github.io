"""A scanned frame as its segments, never as one image in memory (finding 57 of 2026-11-01).

A KH-9 panoramic frame is tens of gigapixels: joining its parts into one array was killed for its memory even at 32 GiB.
`stitch` records where each segment lies in the frame (`frame.json`) and a shrunk preview of the whole frame
(`frame-preview.tif`); `locate` scores the preview and reads only the city's window out of the segments that cover it.
Each segment is read through GDAL by windows (`Segment.read`), stretched to 8 bits by its own linear scale, so the
memory a step needs is that of a window, a template strip or a preview, whatever the frame's size.
"""

import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Final

import numpy

from hcm_pipeline.images import UInt8Array, as_uint8
from hcm_pipeline.raster import gdal
from hcm_pipeline.rasters import open_raster

FRAME_JSON: Final = "frame.json"
FRAME_PREVIEW: Final = "frame-preview.tif"
# The preview's long side at most (about 20 m a pixel on a KH-9 panoramic frame: finer than the 30 m locate scores at).
PREVIEW_MAX_PX: Final = 16384
STRETCH_PCT: Final = (2.0, 98.0)


class Segment:
    """One segment's GDAL dataset, read by windows as 8-bit pixels."""

    def __init__(self, path: Path) -> None:
        self._dataset = open_raster(path)
        self.width: int = self._dataset.RasterXSize
        self.height: int = self._dataset.RasterYSize
        self._band = self._dataset.GetRasterBand(1)
        self.offset, self.ratio = 0.0, 1.0
        if self._band.DataType != gdal.GDT_Byte:
            self.offset, self.ratio = self._stretch()

    def _stretch(self) -> tuple[float, float]:
        """The linear scale of a deeper segment to 8 bits: its 2nd and 98th percentiles, from a shrunk read."""
        sample = numpy.asarray(self._raw(0, 0, self.width, self.height, (min(self.width, 1024), min(self.height, 1024))), numpy.float64)
        low, high = numpy.percentile(sample, STRETCH_PCT)
        ratio = 255.0 / max(float(high - low), 1e-9)
        return -float(low) * ratio, ratio

    def _raw(self, x: int, y: int, width: int, height: int, size: tuple[int, int]) -> numpy.ndarray:
        # GDAL raises on a failed read (`UseExceptions`, `hcm_pipeline.raster`): `gdal_step` turns that into the step's failure.
        return numpy.asarray(self._band.ReadAsArray(x, y, width, height, size[0], size[1]))

    def read(self, x: int, y: int, width: int, height: int, size: tuple[int, int] | None = None) -> UInt8Array:
        """The window (x, y, width, height), resampled by GDAL to `size` (width, height) when given."""
        raw = self._raw(x, y, width, height, size or (width, height))
        if self.ratio == 1.0 and self.offset == 0.0 and raw.dtype == numpy.uint8:
            return as_uint8(raw)
        return as_uint8(numpy.clip(raw * self.ratio + self.offset, 0, 255))

    def close(self) -> None:
        self._dataset.Close()


@dataclass(frozen=True)
class Placement:
    """A segment's object and its place in the frame's pixels (it may start before 0: the border was cropped)."""

    path: str
    x: int
    y: int
    width: int
    height: int

    def window(self, box: tuple[int, int, int, int]) -> tuple[int, int, int, int] | None:
        """The part of `box` (left, top, width, height in the frame) this segment covers, in the frame's pixels."""
        left, top = max(box[0], self.x), max(box[1], self.y)
        right, bottom = min(box[0] + box[2], self.x + self.width), min(box[1] + box[3], self.y + self.height)
        return (left, top, right - left, bottom - top) if right > left and bottom > top else None


@dataclass(frozen=True)
class FrameLayout:
    """`frame.json`: the frame's size, the preview's shrink factor and the segments' placements, a later one on top."""

    width: int
    height: int
    preview_factor: int
    placements: tuple[Placement, ...]

    def to_json(self) -> str:
        return json.dumps({**asdict(self), "placements": [asdict(each) for each in self.placements]})

    @classmethod
    def from_json(cls, text: str) -> FrameLayout:
        record = json.loads(text)
        placements = tuple(Placement(**each) for each in record["placements"])
        return cls(int(record["width"]), int(record["height"]), int(record["preview_factor"]), placements)

    def covering(self, box: tuple[int, int, int, int]) -> list[Placement]:
        """The placements that hold some of `box`, in drawing order."""
        return [each for each in self.placements if each.window(box) is not None]
