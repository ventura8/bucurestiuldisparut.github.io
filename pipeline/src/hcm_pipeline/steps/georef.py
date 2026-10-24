"""`georef`: automatic GCPs, or the fit of the admin's points (docs/research/M3-interfaces.md §5.6, §6).

A version still on its corner GCPs (`method: 'corners'`, a USGS import) is matched against the Sentinel-2 reference
(`georef/matcher.py`): `poly2` from 12 well-spread pairs, else `affine` from 6, with the leave-one-out checkpoint
error; fewer pairs make the job wait for the admin's points (`awaiting_gcps`, the version `needs_gcps` with
`apiError.imagery.noMatch {pairs}`), which is not a failure. A version that holds the admin's points (or any
other method) is only fitted with its own transform; a scan without any georeference waits for points; an
upload's own georeference needs none (`skipped`).
"""

import math
from typing import Final, NoReturn

from hcm_pipeline.contract import MIN_GCPS, Errors
from hcm_pipeline.documents import GeorefInfo, ScanInfo
from hcm_pipeline.geo import fnv1a, to_mercator
from hcm_pipeline.georef.corners import corner_transform
from hcm_pipeline.georef.matcher import Scan, match, transform_kind
from hcm_pipeline.georef.transforms import Fit, FitRefusal, Gcp, fit
from hcm_pipeline.images import seeded
from hcm_pipeline.jobs import Done, JobContext, Skipped, StepFailedError, StepResult, Waiting
from hcm_pipeline.rasters import read_band, to_uint8
from hcm_pipeline.steps.common import Sentinel2, gdal_step, grey_reference

NEEDS_POINTS: Final = "the scan needs the admin's points (georeferencer)"


def recorded(fitted: Fit, method: str) -> GeorefInfo:
    """The version's `georef` for a fit."""
    return GeorefInfo(method, fitted.transform.kind, fitted.gcps, fitted.fit_rmse_m, fitted.checkpoint_rmse_m, fitted.checkpoint_count)


def wait_for_points(ctx: JobContext, pairs: int) -> Waiting:
    """The job waits for the admin's points; the version is `needs_gcps` with `noMatch {pairs}`."""
    # Error parameters are texts (`apiErrorParamsSchema`): the page fills `{pairs}` in; a number made the version unreadable.
    ctx.update_version({"state": "needs_gcps", "error": {"code": Errors.NO_MATCH, "params": {"pairs": str(pairs)}}})
    return Waiting("awaiting_gcps", "gcps", f"{pairs} automatic pairs are too few: {NEEDS_POINTS}")


def _outside(gcps: tuple[Gcp, ...], scan: ScanInfo) -> list[str]:
    return [gcp.id for gcp in gcps if not (0 <= gcp.x <= scan.width and 0 <= gcp.y <= scan.height)]


def fit_points(georef: GeorefInfo, scan: ScanInfo) -> GeorefInfo:
    """The admin's (or any recorded) points fitted with their transform; a refusal fails the step."""
    outside = _outside(georef.gcps, scan)
    if outside:
        raise StepFailedError(Errors.GCP_OUTSIDE, f"points outside the scan: {', '.join(outside)}", {"count": len(outside)})
    result = fit(georef.transform, georef.gcps)
    if result is FitRefusal.TOO_FEW:
        raise StepFailedError(Errors.TOO_FEW_GCPS, "too few enabled points for the transform", {"min": MIN_GCPS[georef.transform]})
    if isinstance(result, FitRefusal):
        raise StepFailedError(Errors.DEGENERATE_GCPS, "the points are collinear or coincident")
    return recorded(result, georef.method)


def scan_resolution(gcps: tuple[Gcp, ...], width: int) -> float:
    """The scan's approximate pixel size in EPSG:3857 metres, from its top corner GCPs."""
    first, second = gcps[0], gcps[1]
    (x0, y0), (x1, y1) = to_mercator(first.lng, first.lat), to_mercator(second.lng, second.lat)
    return max(math.hypot(x1 - x0, y1 - y0) / max(width, 1), 1e-3)


def match_scan(ctx: JobContext, georef: GeorefInfo, scan: ScanInfo) -> Fit | int:
    """Automatic pairs against the cached Sentinel-2 window: the fit, or how few pairs were found."""
    reference_path = ctx.job.step("reference").gcs_path
    if reference_path is None:
        raise StepFailedError(Errors.REFERENCE_UNAVAILABLE, "the job has no reference window")
    info = ctx.services.objects.stat(reference_path) or _missing(reference_path)
    source = Sentinel2(ctx.stage(reference_path, "reference-s2.tif"), info, ())
    pixels = gdal_step(ctx, lambda: to_uint8(read_band(ctx.stage(scan.path, "scan.tif"))), "read the scan")
    initial = corner_transform(georef.gcps)
    seeded(int(fnv1a(ctx.job.id)[:7], 16))
    gcps = match(Scan(pixels, scan_resolution(georef.gcps, scan.width)), initial.to_pixel, grey_reference(source), source.grid())
    kind = transform_kind(gcps)
    result = fit(kind, gcps) if kind is not None else None
    return result if isinstance(result, Fit) else len(gcps)


def _missing(path: str) -> NoReturn:
    raise StepFailedError(Errors.REFERENCE_UNAVAILABLE, f"the reference {path} is gone")


def _scan_of(scan: ScanInfo | None) -> ScanInfo:
    if scan is None:
        raise StepFailedError(Errors.NO_SCAN, "the version has no scan")
    return scan


def georeference(ctx: JobContext, georef: GeorefInfo | None, scan: ScanInfo) -> GeorefInfo | int:
    """The recorded georeference, or how many automatic pairs were found when there are too few (0: no points at all)."""
    if georef is None or not georef.gcps:
        return 0
    if georef.method != "corners":
        return fit_points(georef, scan)
    found = match_scan(ctx, georef, scan)
    return found if isinstance(found, int) else recorded(found, "auto")


class GeorefStep:
    name = "georef"

    def run(self, ctx: JobContext) -> StepResult:
        georef = ctx.version.georef
        if georef is not None and georef.method == "embedded":
            return Skipped("the upload carries its own georeference")
        found = georeference(ctx, georef, _scan_of(ctx.version.scan))
        if isinstance(found, int):
            return wait_for_points(ctx, found)
        ctx.update_version({"georef": found.as_record()})
        ctx.log.info(_summary(found), self.name)
        return Done()


def _summary(georef: GeorefInfo) -> str:
    checkpoint = "no checkpoint" if georef.checkpoint_rmse_m is None else f"checkpoint RMSE {georef.checkpoint_rmse_m:.1f} m"
    return f"{georef.transform} through {len(georef.gcps)} pairs, fit RMSE {georef.fit_rmse_m or 0:.1f} m, {checkpoint}"
