"""The film's dark rim, cut from a layer's alpha before its tiles are made (docs/research/M12-own-tiles.md -> *The dark rim*).

The scan's border crop (`steps/stitch.py`) keeps a few rows of the film's dark edge where that edge is skewed or fades, and the warp's
alpha marks the whole footprint as image: an opaque dark band along a frame's edge on the map (the owner's screenshot of 2026-11-08,
1980's frame: 3 to 5 z13 rows at grey 0 to 3 under alpha 255, then 3 to 6 more fading in at grey 29 to 70). The crop stays as it is,
since moving it would shift the scan's pixels under the saved points; the tiles take an alpha without the rim instead, a band measured
from the alpha's edge in two passes. The film's black (grey `RIM_DARK_LEVEL` or less) that the transparent outside reaches through
black pixels only is the rim's core; from the core the cut grows through the fade, every pixel darker than `RIM_FADE_SHARE` of the
scene's own level (the median of the frame deeper than the band), and stops at the first one that reaches it. Neither pass goes more
than `RIM_MAX_GROUND_M` from the alpha's edge, and one preview pixel past the cut is taken for the last of the fade. So a frame with no
black at its edge keeps its alpha untouched, and dark water or shadow inside it is never reached unless it touches the rim, and then no
deeper than the band. The cut is found on a preview at most `RIM_PREVIEW_MAX_PX` on its long side (about 5 m a pixel for a KH-9
frame), drawn bilinear at full size and written once as a tiled alpha with the source's own overview levels (`trimmed_alpha`), so the
view keeps the COG's overviews and nothing reads the full-size frame through a pixel function more than once.
"""

import html
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Final

import cv2
import numpy
from numpy.typing import NDArray

from hcm_pipeline.geo import ground_scale, to_lnglat
from hcm_pipeline.images import UInt8Array, as_uint8
from hcm_pipeline.raster import gdal
from hcm_pipeline.rasters import driver_of

#: The film's own black: its rim reads 0 to 3, a scene's shadow on these scans rarely under 30.
RIM_DARK_LEVEL: Final = 24
#: The fade ends where the image first reaches this share of the scene's median grey (1980's fade: grey 29 to 70 under a median of 88).
RIM_FADE_SHARE: Final = 0.65
#: The deepest a rim is cut, in ground metres from the alpha's edge (1980's rim and fade: about 100).
RIM_MAX_GROUND_M: Final = 150.0
RIM_PREVIEW_MAX_PX: Final = 8192
#: An alpha at or above this shows (the preview averages the alpha's edge).
OPAQUE: Final = 128
KEEP: Final = 255
#: A step of the cut moves to a side neighbour only, so `n` steps never go farther than `n` pixels from where they started.
_STEP: Final = cv2.getStructuringElement(cv2.MORPH_CROSS, (3, 3))
_TRIMMED_OPTIONS: Final = ("TILED=YES", "COMPRESS=DEFLATE", "NUM_THREADS=ALL_CPUS")


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


def _grow(seeds: NDArray[numpy.bool_], passable: NDArray[numpy.bool_], steps: int) -> NDArray[numpy.bool_]:
    """`seeds` and the `passable` pixels reached from them through passable side neighbours, in at most `steps` steps."""
    reached, through = seeds.astype(numpy.uint8), (seeds | passable).astype(numpy.uint8)
    for _ in range(steps):
        grown = as_uint8(cv2.dilate(reached, _STEP)) & through
        if numpy.array_equal(grown, reached):
            break
        reached = grown
    return reached.astype(bool)


def scene_level(grey: UInt8Array, inside: NDArray[numpy.bool_]) -> float:
    """The median grey of the frame deeper than the band, or of the whole frame when it is all band."""
    return float(numpy.median(grey[inside])) if inside.any() else 0.0


def rim_cut(grey: UInt8Array, alpha: UInt8Array, reach: int) -> NDArray[numpy.bool_]:
    """The opaque pixels to cut: the black core the outside reaches, the fade grown from it, no deeper than `reach`, and one pixel more."""
    outside = alpha < OPAQUE
    band = as_uint8(cv2.dilate(outside.astype(numpy.uint8), _STEP, iterations=reach)).astype(bool)
    deep = ~band
    level = scene_level(grey, deep if deep.any() else ~outside)
    core = _grow(outside, band & (grey <= RIM_DARK_LEVEL), reach)
    if numpy.array_equal(core, outside):
        return numpy.zeros_like(outside)
    fade = _grow(core, band & (grey < max(RIM_DARK_LEVEL, RIM_FADE_SHARE * level)), reach)
    return cv2.dilate((fade & ~outside).astype(numpy.uint8), _STEP).astype(bool) & ~outside


def reach_px(dataset: gdal.Dataset, preview_width: int) -> int:
    """`RIM_MAX_GROUND_M` in the preview's pixels, at the latitude of the frame's middle (the raster is Web Mercator)."""
    transform = dataset.GetGeoTransform()
    pixel_m = abs(transform[1]) * dataset.RasterXSize / preview_width
    middle_lat = to_lnglat(0.0, transform[3] + transform[5] * dataset.RasterYSize / 2)[1]
    return max(1, round(RIM_MAX_GROUND_M / (pixel_m * ground_scale(middle_lat))))


def find_rim(dataset: gdal.Dataset, alpha: str, target: Path) -> Rim | None:
    """The keep-mask of `dataset`'s rim written to `target`; None when the frame has no rim to cut."""
    factor = preview_factor(dataset.RasterXSize, dataset.RasterYSize)
    width, height = math.ceil(dataset.RasterXSize / factor), math.ceil(dataset.RasterYSize / factor)
    grey = _read(dataset.GetRasterBand(1), width, height)
    cut = rim_cut(grey, _read(alpha_band(dataset, alpha), width, height), reach_px(dataset, width))
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


def overview_factors(dataset: gdal.Dataset) -> list[int]:
    """The source's overview levels as factors of its full size, which the trimmed alpha repeats so the view keeps them."""
    band = dataset.GetRasterBand(1)
    return [round(dataset.RasterXSize / band.GetOverview(level).XSize) for level in range(band.GetOverviewCount())]


def trimmed_alpha(source: Path, alpha: str, rim: Rim, target: Path) -> Path:
    """The smaller of the source's alpha and the keep-mask drawn bilinear to full size, written once as a tiled GTiff with overviews."""
    dataset = gdal.Open(str(source))
    width, height, factors = dataset.RasterXSize, dataset.RasterYSize, overview_factors(dataset)
    dataset.Close()
    derived = target.with_suffix(".vrt")
    plan = driver_of("VRT").Create(str(derived), width, height, 0)
    plan.AddBand(gdal.GDT_Byte, ["subClass=VRTDerivedRasterBand", "PixelFunctionType=min"])
    band = plan.GetRasterBand(1)
    band.SetMetadataItem("source_0", _source(source, "mask,1" if alpha == "mask" else alpha), "new_vrt_sources")
    band.SetMetadataItem("source_1", _source(rim.path, "1", _rects(rim, width, height), ' resampling="bilinear"'), "new_vrt_sources")
    plan.Close()
    written = gdal.Translate(str(target), str(derived), format="GTiff", creationOptions=list(_TRIMMED_OPTIONS))
    if factors:
        written.BuildOverviews("AVERAGE", factors)
    written.Close()
    derived.unlink()
    return target


def add_trimmed_alpha(view: Path, alpha: Path) -> None:
    """A last band of `view`, its alpha: the trimmed alpha's one band, a plain source, so the view's overviews are its sources'."""
    dataset = gdal.Open(str(view), gdal.GA_Update)
    dataset.AddBand(gdal.GDT_Byte)
    band = dataset.GetRasterBand(dataset.RasterCount)
    band.SetColorInterpretation(gdal.GCI_AlphaBand)
    band.SetMetadataItem("source_0", _source(alpha, "1"), "new_vrt_sources")
    dataset.Close()
