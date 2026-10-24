"""What several steps share: the city window, the cached references, the scan preview and GDAL error handling.

The references (docs/research/M3-interfaces.md §5.5) are cached in the private bucket by window: Sentinel-2 as
`reference/{city}/s2/{key}.tif` (the key: FNV-1a of the window and the item ids) and OpenStreetMap as
`reference/{city}/osm/{key}.geojson`; `locate` scores the corner guess against the first, `reference` draws both
for the georeferencer and `georef` matches against the first.
"""

import json
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Final

import numpy

from hcm_pipeline import paths
from hcm_pipeline.contract import SCAN_PREVIEW_MAX_PX, Errors
from hcm_pipeline.documents import ScanInfo, city_bounds
from hcm_pipeline.geo import Grid, MercatorBox, fnv1a
from hcm_pipeline.images import UInt8Array, resize, write_jpeg
from hcm_pipeline.jobs import JobContext, StepFailedError
from hcm_pipeline.objects import ObjectInfo, sha256_of
from hcm_pipeline.raster import gdal
from hcm_pipeline.rasters import GTIFF_OPTIONS, RasterError, read_band
from hcm_pipeline.stac import ReferenceUnavailableError, StacItem, choose
from hcm_pipeline.urlguard import AddressRefusedError, check_data_url, check_emulated_url

REFERENCE_RESOLUTION_M: Final = 10.0
LOOPBACK_PREFIXES: Final = ("http://127.0.0.1", "http://localhost", "http://[::1]")


def city_window(ctx: JobContext) -> MercatorBox:
    """The city's bounds plus 10 % on every side, in EPSG:3857."""
    record = ctx.read(f"cities/{ctx.city}")
    if record is None:
        raise StepFailedError(Errors.NOT_FOUND, f"the city {ctx.city} does not exist")
    return city_bounds(record).mercator().expanded()


def gdal_step[T](ctx: JobContext, work: Callable[[], T], what: str, code: str = Errors.PROCESSING_FAILED) -> T:
    """`work` (GDAL calls); a GDAL failure becomes the run's stop when the run must stop, else the step fails with `code`.

    `processingFailed` by default: the step works on files the pipeline made (a USGS frame, the scan, the warped layer), so
    the admin is never told to upload again a file they never uploaded (CR-M3-47); reading the admin's own upload passes
    `unreadableRaster` ("check the file and upload it again").
    """
    try:
        return work()
    except (RuntimeError, RasterError) as error:
        ctx.checkpoint()
        raise StepFailedError(code, f"GDAL could not {what}: {error}") from error


def reference_failure(error: Exception) -> StepFailedError:
    return StepFailedError(Errors.REFERENCE_UNAVAILABLE, str(error))


@dataclass(frozen=True)
class Sentinel2:
    """The cached Sentinel-2 window: local file, object, and the items it was made from."""

    local: Path
    info: ObjectInfo
    items: tuple[StacItem, ...]

    def grid(self) -> Grid:
        dataset = gdal.Open(str(self.local))
        left, resolution, _, top, _, _ = dataset.GetGeoTransform()
        grid = Grid(left, top, resolution, dataset.RasterXSize, dataset.RasterYSize)
        dataset.Close()
        return grid


def _guarded(ctx: JobContext, href: str) -> str:
    """A STAC asset's address through the guard: public https, or (under the emulators) this machine's only."""
    if ctx.config.emulated:
        return check_emulated_url(href)
    return check_data_url(href, ctx.config.stac_url.startswith(LOOPBACK_PREFIXES), ctx.services.resolver)


def _guarded_sources(ctx: JobContext, items: Sequence[StacItem]) -> list[str]:
    try:
        return [f"/vsicurl/{_guarded(ctx, item.href)}" for item in items]
    except AddressRefusedError as error:
        raise reference_failure(error) from error


def _warp_window(ctx: JobContext, sources: list[str], window: MercatorBox, local: Path) -> None:
    def work() -> None:
        options = {"dstSRS": "EPSG:3857", "xRes": REFERENCE_RESOLUTION_M, "yRes": REFERENCE_RESOLUTION_M, "resampleAlg": "bilinear"}
        bounds = (window.left, window.bottom, window.right, window.top)
        gdal.Warp(
            str(local), sources, outputBounds=bounds, creationOptions=list(GTIFF_OPTIONS), callback=ctx.flags.gdal_progress, **options
        ).Close()

    try:
        work()
    except RuntimeError as error:
        ctx.checkpoint()
        raise reference_failure(error) from error


def _items(ctx: JobContext, window: MercatorBox) -> list[StacItem]:
    try:
        items = choose(ctx.services.stac.search(window.bounds(), ctx.services.clock()), window.bounds())
    except ReferenceUnavailableError as error:
        raise reference_failure(error) from error
    if not items:
        raise reference_failure(ReferenceUnavailableError("no Sentinel-2 item under 20 % clouds covers the window"))
    return items


def sentinel2(ctx: JobContext, window: MercatorBox) -> Sentinel2:
    """The window's Sentinel-2 L2A true colour at 10 m in EPSG:3857: from the cache, else from the STAC asset."""
    items = _items(ctx, window)
    object_path = paths.reference(ctx.city, "s2", fnv1a(f"{window.key()}|{','.join(item.id for item in items)}"))
    local = ctx.local("reference-s2.tif")
    cached = ctx.services.objects.stat(object_path)
    if cached is not None:
        ctx.services.objects.download_file(object_path, local)
        return Sentinel2(local, cached, tuple(items))
    _warp_window(ctx, _guarded_sources(ctx, items), window, local)
    return Sentinel2(local, ctx.publish(local, object_path, "image/tiff"), tuple(items))


def osm_features(ctx: JobContext, window: MercatorBox) -> tuple[dict[str, object], str]:
    """The window's OpenStreetMap lines (GeoJSON) and their cache path: from the cache, else from Overpass."""
    object_path = paths.reference(ctx.city, "osm", fnv1a(window.key()))
    local = ctx.local("reference-osm.geojson")
    if ctx.services.objects.stat(object_path) is not None:
        ctx.services.objects.download_file(object_path, local)
        return json.loads(local.read_text(encoding="utf-8")), object_path
    try:
        features = ctx.services.overpass.features(window.bounds())
    except ReferenceUnavailableError as error:
        raise reference_failure(error) from error
    local.write_text(json.dumps(features), encoding="utf-8")
    ctx.publish(local, object_path, "application/geo+json")
    return features, object_path


def grey_reference(source: Sentinel2) -> UInt8Array:
    """The Sentinel-2 window as one grey band (the mean of its three)."""
    total = sum(read_band(source.local, band).astype(numpy.float64) for band in (1, 2, 3))
    return numpy.asarray(numpy.asarray(total) / 3, numpy.uint8)


def publish_scan(ctx: JobContext, local: Path, pixels: UInt8Array) -> ScanInfo:
    """`scan.tif` and its preview (long side at most `SCAN_PREVIEW_MAX_PX`) as the version's files."""
    height, width = pixels.shape[:2]
    scale = min(1.0, SCAN_PREVIEW_MAX_PX / max(width, height))
    preview = write_jpeg(ctx.local("scan-preview.jpg"), resize(pixels, (max(1, round(width * scale)), max(1, round(height * scale)))))
    sha256 = sha256_of(local)
    scan = ctx.publish(local, ctx.version_file("scan.tif"), "image/tiff")
    ctx.publish(preview, ctx.version_file("scan-preview.jpg"), "image/jpeg")
    return ScanInfo(scan.path, width, height, sha256, ctx.version_file("scan-preview.jpg"), scale)
