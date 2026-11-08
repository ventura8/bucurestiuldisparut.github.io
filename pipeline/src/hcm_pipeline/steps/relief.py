"""The city's surface model for the terrain of a frame seen off nadir (docs/research/M15-calibration-accuracy.md, *Terrain*).

`georef` asks for it when it fits a KH-9 panoramic frame (`calibrate/terrain.py`), and `warp` when it renders a frame fitted over it
(`georef.terrain`'s RPC with `RPC_DEM`). It is cached in the private bucket by window as `reference/{city}/dem/{key}.tif` (the key:
FNV-1a of the window and the source), like the other references; a local worker keeps it on the computer. Without it (the tiles cannot
be read, or the address is refused: under the emulators every real address is) the frame is fitted, or rendered, flat, with a warning.
"""

from dataclasses import dataclass
from pathlib import Path
from typing import Final

from hcm_pipeline import paths
from hcm_pipeline.calibrate.joining import Proved
from hcm_pipeline.calibrate.pairs import Calibrated
from hcm_pipeline.calibrate.terrain import Heights
from hcm_pipeline.geo import MercatorBox, fnv1a
from hcm_pipeline.jobs import JobContext
from hcm_pipeline.steps.common import LOOPBACK_PREFIXES, city_window
from hcm_pipeline.surface import DEM_SOURCE, heights_of, tile_names, write_surface
from hcm_pipeline.urlguard import AddressRefusedError, check_data_url, check_emulated_url

FLAT: Final = "the frame is fitted and rendered flat"


@dataclass(frozen=True)
class Surface:
    """The cached surface: its heights and its local file (what `RPC_DEM` reads)."""

    heights: Heights
    local: Path


def _address(ctx: JobContext, href: str) -> str:
    if ctx.config.emulated:
        return check_emulated_url(href)
    return check_data_url(href, ctx.config.dem_url.startswith(LOOPBACK_PREFIXES), ctx.services.resolver)


def _fetched(ctx: JobContext, window: MercatorBox, local: Path) -> Heights | None:
    try:
        sources = [f"/vsicurl/{_address(ctx, f'{ctx.config.dem_url}/{name}')}" for name in tile_names(window.bounds())]
        heights = write_surface(sources, window, local)
    except (AddressRefusedError, RuntimeError) as error:
        ctx.checkpoint()
        ctx.log.warn(f"no surface model ({error}): {FLAT}")
        return None
    if heights is None:
        ctx.log.warn(f"no Copernicus DEM tile could be read over the city: {FLAT}")
    return heights


def city_surface(ctx: JobContext) -> Surface | None:
    """The city window's surface model: from the cache, else from the GLO-30 tiles (published to the cache); None without one."""
    window = city_window(ctx)
    object_path = paths.reference(ctx.city, "dem", fnv1a(f"{window.key()}|{DEM_SOURCE}"))
    local = ctx.local("surface.tif")
    if ctx.services.objects.stat(object_path) is not None:
        ctx.services.objects.download_file(object_path, local)
        return Surface(heights_of(local), local)
    heights = _fetched(ctx, window, local)
    if heights is None:
        return None
    ctx.publish(local, object_path, "image/tiff")
    return Surface(heights, local)


def city_heights(ctx: JobContext) -> Heights | None:
    found = city_surface(ctx)
    return None if found is None else found.heights


def terrain_summary(found: Calibrated, proved: Proved) -> str:
    """The job log's line on the terrain."""
    if found.terrain is not None:
        return f"fitted over the terrain (Copernicus DEM GLO-30): {found.terrain.relief_m:.1f} m of relief beyond a second-order fit"
    if proved.heights is None:
        return "fitted flat: no surface model, or no panoramic camera"
    return "fitted flat: the terrain this frame shows is negligible, or its camera does not hold"
