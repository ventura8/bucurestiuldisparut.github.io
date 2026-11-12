"""What a drawn map is matched against (docs/research/M20-import-local.md §1.7, §3 c step 3): the reference ladder, then OpenStreetMap.

OpenStreetMap is asked once for the city's whole window (cached beside this computer's jobs) and drawn on any box inside it.
A reference is street centre lines on a north-up EPSG:3857 grid: their skeleton, its junctions in Mercator metres, and a closeness image
(1 on a line, falling off over a few pixels) the coarse search scores against. The ladder's rung is a published layer of the city, an
older or newer map already placed (`ladder`: the nearest year of the same kind, or the job's `referenceLayerIds`): its own street
network, read from its own public tiles (`tiles/{city}/{layer}/{version}.pmtiles`, only the tiles over the box, by range) through the
same classical path as the map's, and its own checkpoint error, which is added in quadrature to the figure of every map placed on it.
OpenStreetMap's highways (Overpass, cached beside the job) are the last rung. Mapbox Satellite is never a reference (its terms).
"""

import json
import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final

import cv2
import httpx
import numpy
from numpy.typing import NDArray

from hcm_pipeline.documents import city_bounds
from hcm_pipeline.geo import Grid, MercatorBox, zoom_resolution
from hcm_pipeline.jobs import JobContext
from hcm_pipeline.objects import GCS_BASE_URL
from hcm_pipeline.osm import draw
from hcm_pipeline.placing.geometry import FloatArray
from hcm_pipeline.placing.ladder import Rung
from hcm_pipeline.placing.streets import BoolArray, UInt8Array, junctions, line_skeleton, street_skeleton
from hcm_pipeline.stac import ReferenceUnavailableError
from hcm_pipeline.tiles import read

# The closeness image falls to 1/e this many pixels from a line.
CLOSENESS_PX: Final = 2.0
# Further than this many reaches from any line the closeness is nothing (and an empty reference's distances never overflow).
FAR_REACHES: Final = 10.0
# How much wider than the city a map may reach (a regional map shows the city's surroundings).
CITY_MARGIN: Final = 0.5
TILE_PX: Final = 256
PAPER: Final = 255
GREY_DIMS: Final = 2
RGBA_BANDS: Final = 4
HALF_WORLD_M: Final = 20037508.342789244
# A rung is read from at most this many tiles: a coarser zoom when a box would need more.
MAX_TILES: Final = 400
# Where a public object is read from (the published layers' tiles).
PUBLIC_BASE_URL = GCS_BASE_URL


@dataclass(frozen=True)
class Reference:
    """Street centre lines on `grid`, their junctions (Mercator metres) and the closeness image; `error_m` is the rung's own error."""

    grid: Grid
    skeleton: BoolArray
    places: FloatArray
    closeness: NDArray[numpy.float32]
    label: str
    error_m: float | None = None


def closeness_of(skeleton: BoolArray, reach_px: float = CLOSENESS_PX) -> NDArray[numpy.float32]:
    """1 on a line, falling to 1/e `reach_px` pixels from it."""
    distance = numpy.minimum(cv2.distanceTransform((~skeleton).astype(numpy.uint8), cv2.DIST_L2, 3), FAR_REACHES * reach_px)
    return numpy.asarray(numpy.exp(-((distance / reach_px) ** 2)), numpy.float32)


def reference_of(skeleton: BoolArray, grid: Grid, label: str, error_m: float | None = None) -> Reference:
    """A reference from a skeleton on `grid`: its junctions moved to Mercator metres."""
    found = junctions(skeleton)
    mx, my = grid.to_mercator(found[:, 0], found[:, 1])
    return Reference(grid, skeleton, numpy.column_stack((mx, my)), closeness_of(skeleton), label, error_m)


def city_window(ctx: JobContext, margin: float = CITY_MARGIN) -> MercatorBox | None:
    """The city's bounds grown by `margin` on every side, or None when the city has none."""
    city = ctx.read(f"cities/{ctx.city}")
    if city is None or city.get("bounds") is None:
        return None
    return city_bounds(city).mercator().expanded(margin)


def _overlaps(box: MercatorBox, outer: MercatorBox) -> bool:
    return box.left < outer.right and outer.left < box.right and box.bottom < outer.top and outer.bottom < box.top


def _asked(ctx: JobContext, box: MercatorBox) -> MercatorBox:
    """What Overpass is asked for: the city's whole window when `box` touches it (one answer serves every map of the city: a map that
    reaches past the window is matched on its part inside), else `box`."""
    window = city_window(ctx)
    return window if window is not None and _overlaps(box, window) else box


def osm_features_cached(ctx: JobContext, box: MercatorBox) -> dict[str, object] | None:
    """OpenStreetMap's lines around `box`, cached beside the jobs of this computer (one Overpass answer per city window)."""
    asked = _asked(ctx, box)
    folder = ctx.services.archive_root or ctx.workdir.parent
    cache = folder / "osm" / f"{asked.key().replace(',', '_')}.json"
    cache.parent.mkdir(parents=True, exist_ok=True)
    if cache.is_file():
        loaded = json.loads(cache.read_text(encoding="utf-8"))
        return loaded if isinstance(loaded, dict) else None
    try:
        features = ctx.services.overpass.features(asked.bounds())
    except ReferenceUnavailableError as error:
        ctx.log.warn(f"OpenStreetMap is unavailable: {error}", ctx.step)
        return None
    cache.write_text(json.dumps(features), encoding="utf-8")
    return features


def osm_reference(ctx: JobContext, box: MercatorBox, resolution: float) -> Reference | None:
    """OpenStreetMap's lines over `box` at `resolution` Mercator metres a pixel, or None when Overpass cannot answer."""
    features = osm_features_cached(ctx, box)
    if features is None:
        return None
    grid = Grid.over(box, resolution)
    return reference_of(line_skeleton(draw(features, grid)), grid, "osm")


def tile_zoom(resolution: float, minzoom: int, maxzoom: int) -> int:
    """The coarsest zoom whose pixels are at least as fine as `resolution`, within the archive's zooms."""
    for zoom in range(minzoom, maxzoom + 1):
        if zoom_resolution(zoom) <= resolution:
            return zoom
    return maxzoom


def tile_span(box: MercatorBox, zoom: int) -> tuple[int, int, int, int]:
    """The tiles at `zoom` that cover `box`: first and last column, first and last row."""
    size = TILE_PX * zoom_resolution(zoom)
    last = (1 << zoom) - 1
    column = (int((box.left + HALF_WORLD_M) // size), int((box.right + HALF_WORLD_M) // size))
    row = (int((HALF_WORLD_M - box.top) // size), int((HALF_WORLD_M - box.bottom) // size))
    return max(0, column[0]), min(last, column[1]), max(0, row[0]), min(last, row[1])


def _grey_tile(data: bytes | None) -> UInt8Array:
    """A tile as grey with its transparent parts white (paper), or all white when the archive does not hold it."""
    image = None if data is None else cv2.imdecode(numpy.frombuffer(data, numpy.uint8), cv2.IMREAD_UNCHANGED)
    if image is None:
        return numpy.full((TILE_PX, TILE_PX), PAPER, numpy.uint8)
    return numpy.asarray(cv2.resize(_on_paper(numpy.asarray(image, numpy.uint8)), (TILE_PX, TILE_PX)), numpy.uint8)


def _on_paper(image: UInt8Array) -> UInt8Array:
    """A decoded tile in grey, its transparent pixels white."""
    if image.ndim == GREY_DIMS:
        return image
    grey = numpy.asarray(cv2.cvtColor(image[:, :, :3], cv2.COLOR_BGR2GRAY), numpy.uint8)
    if image.shape[2] < RGBA_BANDS:
        return grey
    return numpy.where(image[:, :, 3] > 0, grey, PAPER).astype(numpy.uint8)


def _row(archive: read.Archive, zoom: int, columns: tuple[int, int], y: int) -> UInt8Array:
    return numpy.hstack([_grey_tile(read.tile(archive, zoom, x, y)) for x in range(columns[0], columns[1] + 1)])


def mosaic(archive: read.Archive, box: MercatorBox, grid: Grid) -> UInt8Array:
    """The archive's tiles over `box` resampled onto `grid` (both north-up Web Mercator: a crop and a resize)."""
    zoom = tile_zoom(grid.resolution, archive.minzoom, archive.maxzoom)
    while zoom > archive.minzoom and _count(tile_span(box, zoom)) > MAX_TILES:
        zoom -= 1
    first_col, last_col, first_row, last_row = tile_span(box, zoom)
    rows = [_row(archive, zoom, (first_col, last_col), y) for y in range(first_row, last_row + 1)]
    image = numpy.vstack(rows)
    size = zoom_resolution(zoom)
    factor = size / grid.resolution
    small = cv2.resize(
        image, (max(1, round(image.shape[1] * factor)), max(1, round(image.shape[0] * factor))), interpolation=cv2.INTER_AREA
    )
    left = first_col * TILE_PX * size - HALF_WORLD_M
    top = HALF_WORLD_M - first_row * TILE_PX * size
    shift = numpy.array([[1.0, 0.0, (grid.left - left) / grid.resolution], [0.0, 1.0, (top - grid.top) / grid.resolution]])
    placed = cv2.warpAffine(small, shift, (grid.width, grid.height), flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP, borderValue=255)
    return numpy.asarray(placed, numpy.uint8)


def _count(span: tuple[int, int, int, int]) -> int:
    return (span[1] - span[0] + 1) * (span[3] - span[2] + 1)


def public_fetch(ctx: JobContext, path: str) -> read.Fetch:
    """`fetch(offset, length)` of a public object: one HTTP `Range` request each."""
    url = f"{PUBLIC_BASE_URL}/{ctx.config.public_bucket}/{path}"

    def fetch(offset: int, length: int) -> bytes:
        reply = ctx.services.downloads.get(url, headers={"Range": f"bytes={offset}-{offset + length - 1}"})
        reply.raise_for_status()
        return reply.content

    return fetch


def tiles_reference(ctx: JobContext, rung: Rung, box: MercatorBox, resolution: float) -> Reference | None:
    """A published layer's own street network over `box`, read from its public tiles, with its own error; None when its tiles
    cannot be read or show nothing there."""
    path = f"tiles/{ctx.city}/{rung.layer_id}/{rung.version_id}.pmtiles"
    try:
        archive = read.open_archive(public_fetch(ctx, path))
        grid = Grid.over(box, resolution)
        image = mosaic(archive, box, grid)
    except (httpx.HTTPError, read.ArchiveError) as error:
        ctx.log.warn(f"the {rung.year} map could not be read as a reference: {error}", ctx.step)
        return None
    skeleton = street_skeleton(image)
    return reference_of(skeleton, grid, rung.label, rung.error_m) if skeleton.any() else None


def references(ctx: JobContext, ladder: Sequence[Rung], box: MercatorBox, resolution: float) -> list[Reference]:
    """The ladder's rungs in order, then OpenStreetMap: each that could be read."""
    rungs = [tiles_reference(ctx, rung, box, resolution) for rung in ladder]
    found = [*rungs, osm_reference(ctx, box, resolution)]
    return [reference for reference in found if reference is not None]


def window_resolution(box: MercatorBox, max_px: int) -> float:
    """The coarsest resolution that keeps `box` within `max_px` on its long side, rounded up to a whole metre."""
    return float(math.ceil(max(box.width, box.height) / max_px))
