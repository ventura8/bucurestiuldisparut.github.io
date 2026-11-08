"""The film's dark rim, cut from a layer's alpha before its tiles are made (docs/research/M12-own-tiles.md -> *The dark rim*).

The scan's border crop (`steps/stitch.py`) keeps a few rows of the film's dark edge where that edge is skewed or fades, and the warp's
alpha marks the whole footprint as image: an opaque black band along a frame's edge on the map (the owner's screenshot of 2026-11-08,
1980's frame: 3 to 5 rows at grey 0 to 3 under alpha 255, then about 6 fading in). The crop stays as it is, since moving it would
shift the scan's pixels under the saved points; the tiles take an alpha without the rim instead: the dark pixels the transparent
outside reaches through dark pixels only, no deeper than `RIM_MAX_M`, and one preview pixel past them for the fade. Dark detail
inside the frame is never reached, and a frame with no rim keeps its alpha untouched. The cut is found on a preview at most
`RIM_PREVIEW_MAX_PX` on its long side (about 5 m a pixel for a KH-9 frame) and drawn bilinear at full size, so its edge is soft.
"""

import html
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Final

import cv2
import numpy
from numpy.typing import NDArray

from hcm_pipeline.images import UInt8Array, as_uint8
from hcm_pipeline.raster import gdal
from hcm_pipeline.rasters import driver_of

#: The darkest grey of the image itself: the film's rim reads 0 to 3, a scene's shadow on these scans rarely under 30.
RIM_DARK_LEVEL: Final = 24
#: The deepest a rim is cut, in the raster's own (Web Mercator) metres: about 180 ground metres at Bucharest's latitude.
RIM_MAX_M: Final = 250.0
RIM_PREVIEW_MAX_PX: Final = 8192
#: An alpha at or above this shows (the preview averages the alpha's edge).
OPAQUE: Final = 128
KEEP: Final = 255
_NEIGHBOURS: Final = numpy.ones((3, 3), numpy.uint8)


@dataclass(frozen=True)
class Rim:
    """The keep-mask beside the view (0 where the rim is cut, 255 elsewhere) and its size in preview pixels."""

    path: Path
    width: int
    height: int


def preview_factor(width: int, height: int) -> int:
    """How many of the raster's pixels make one of the preview's, on each side."""
    return max(1, math.ceil(max(width, height) / RIM_PREVIEW_MAX_PX))


def alpha_band(dataset: gdal.Dataset, alpha: str) -> gdal.Band:
    """`alpha` as the view names it: a band number, or `mask` for the COG's mask (JPEG holds no alpha)."""
    return dataset.GetRasterBand(1).GetMaskBand() if alpha == "mask" else dataset.GetRasterBand(int(alpha))


def _read(band: gdal.Band, width: int, height: int) -> UInt8Array:
    return as_uint8(band.ReadAsArray(buf_xsize=width, buf_ysize=height, resample_alg=gdal.GRIORA_Average))


def rim_cut(grey: UInt8Array, alpha: UInt8Array, steps: int) -> NDArray[numpy.bool_]:
    """The opaque pixels to cut: reached from the transparent ones through dark ones in at most `steps`, and one pixel more."""
    outside = alpha < OPAQUE
    passable = (outside | (grey <= RIM_DARK_LEVEL)).astype(numpy.uint8)
    reached = outside.astype(numpy.uint8)
    for _ in range(steps):
        grown = as_uint8(cv2.dilate(reached, _NEIGHBOURS)) & passable
        if numpy.array_equal(grown, reached):
            break
        reached = grown
    rim = reached.astype(bool) & ~outside
    return cv2.dilate(rim.astype(numpy.uint8), _NEIGHBOURS).astype(bool) & ~outside


def find_rim(dataset: gdal.Dataset, alpha: str, target: Path) -> Rim | None:
    """The keep-mask of `dataset`'s rim written to `target`; None when the frame has no rim to cut."""
    factor = preview_factor(dataset.RasterXSize, dataset.RasterYSize)
    width, height = math.ceil(dataset.RasterXSize / factor), math.ceil(dataset.RasterYSize / factor)
    grey = _read(dataset.GetRasterBand(1), width, height)
    pixel_m = abs(dataset.GetGeoTransform()[1]) * dataset.RasterXSize / width
    cut = rim_cut(grey, _read(alpha_band(dataset, alpha), width, height), max(1, round(RIM_MAX_M / pixel_m)))
    if not cut.any():
        return None
    mask = driver_of("GTiff").Create(str(target), width, height, 1, gdal.GDT_Byte, ["COMPRESS=DEFLATE"])
    mask.GetRasterBand(1).WriteArray(numpy.where(cut, 0, KEEP).astype(numpy.uint8))
    mask.Close()
    return Rim(target, width, height)


def _source(path: Path, band: str, extra: str = "", resampling: str = "") -> str:
    name = html.escape(str(path.resolve()), quote=True)
    file = f'<SourceFilename relativeToVRT="0">{name}</SourceFilename>'
    return f"<SimpleSource{resampling}>{file}<SourceBand>{band}</SourceBand>{extra}</SimpleSource>"


def _rects(rim: Rim, width: int, height: int) -> str:
    """The whole preview drawn over the whole view."""
    source = f'<SrcRect xOff="0" yOff="0" xSize="{rim.width}" ySize="{rim.height}"/>'
    return f'{source}<DstRect xOff="0" yOff="0" xSize="{width}" ySize="{height}"/>'


def add_trimmed_alpha(view: Path, source: Path, alpha: str, rim: Rim) -> None:
    """A last band of `view`, its alpha: the smaller of the source's alpha and the keep-mask drawn bilinear to the view's size."""
    dataset = gdal.Open(str(view), gdal.GA_Update)
    dataset.AddBand(gdal.GDT_Byte, ["subClass=VRTDerivedRasterBand", "PixelFunctionType=min"])
    band = dataset.GetRasterBand(dataset.RasterCount)
    band.SetColorInterpretation(gdal.GCI_AlphaBand)
    mask = _source(rim.path, "1", _rects(rim, dataset.RasterXSize, dataset.RasterYSize), ' resampling="bilinear"')
    band.SetMetadataItem("source_0", _source(source, "mask,1" if alpha == "mask" else alpha), "new_vrt_sources")
    band.SetMetadataItem("source_1", mask, "new_vrt_sources")
    dataset.Close()
