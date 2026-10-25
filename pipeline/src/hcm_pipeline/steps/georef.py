"""`georef`: automatic GCPs and suggestions, or the fit of the admin's points (M3-interfaces.md §5.6, §6; M4 §2).

A version still on its corner GCPs (`method: 'corners'`, a USGS import) is matched against the Sentinel-2 window and
OpenStreetMap's lines (`georef/matcher.py`). With at least six confident pairs (`AUTO_GCP_MIN_CONFIDENCE`) the
version gets its `georef` (`poly2` from 12 well-spread pairs, else `affine`; a fifth held out as checkpoints from 15)
and the weaker pairs are its `suggestions`; with fewer, every candidate is a suggestion and the job waits for the
admin's points (`awaiting_gcps`, the version `needs_gcps` with `apiError.imagery.noMatch {pairs}`, the confident
count, or `apiError.imagery.noSpread {pairs}` when enough confident pairs lie almost in a line), which is not a failure
(`georef/autogcp.py`). A version that holds the admin's points (or any other method) is
only fitted with its own transform, and its suggestions are done with; a scan without any georeference waits for
points; an upload's own georeference needs none (`skipped`).
"""

import math
from collections.abc import Mapping
from typing import Final, NoReturn

from hcm_pipeline.contract import MIN_GCPS, Errors
from hcm_pipeline.documents import GeorefInfo, ScanInfo
from hcm_pipeline.geo import Grid, fnv1a, to_mercator
from hcm_pipeline.georef.autogcp import Decision, GcpSuggestions, decide
from hcm_pipeline.georef.corners import corner_transform
from hcm_pipeline.georef.matcher import MatchResult, References, Scan, match
from hcm_pipeline.georef.transforms import Fit, FitRefusal, Gcp, fit
from hcm_pipeline.images import UInt8Array, seeded
from hcm_pipeline.jobs import Done, JobContext, Skipped, StepFailedError, StepResult, Waiting
from hcm_pipeline.osm import draw
from hcm_pipeline.rasters import read_band, to_uint8
from hcm_pipeline.steps.common import Sentinel2, city_window, gdal_step, grey_reference, osm_features
from hcm_pipeline.store import DELETE

NEEDS_POINTS: Final = "the scan needs the admin's points (georeferencer)"


def recorded(fitted: Fit, method: str) -> GeorefInfo:
    """The version's `georef` for a fit."""
    return GeorefInfo(method, fitted.transform.kind, fitted.gcps, fitted.fit_rmse_m, fitted.checkpoint_rmse_m, fitted.checkpoint_count)


def wait_for_points(ctx: JobContext, pairs: int, fields: Mapping[str, object] | None = None, code: str = Errors.NO_MATCH) -> Waiting:
    """The job waits for the admin's points; the version is `needs_gcps` with `code {pairs}` (and `fields`)."""
    # Error parameters are texts (`apiErrorParamsSchema`): the page fills `{pairs}` in; a number made the version unreadable.
    error = {"code": code, "params": {"pairs": str(pairs)}}
    ctx.update_version({"state": "needs_gcps", "error": error, **(fields or {})})
    why = "lie almost in a line" if code == Errors.NO_SPREAD else "are too few"
    return Waiting("awaiting_gcps", "gcps", f"{pairs} automatic pairs {why}: {NEEDS_POINTS}")


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


def _missing(path: str) -> NoReturn:
    raise StepFailedError(Errors.REFERENCE_UNAVAILABLE, f"the reference {path} is gone")


def osm_lines(ctx: JobContext, grid: Grid) -> UInt8Array | None:
    """The window's cached OpenStreetMap lines drawn on the reference grid; None without them (Sentinel-2 alone)."""
    try:
        features, _ = osm_features(ctx, city_window(ctx))
    except StepFailedError as error:
        ctx.log.warn(f"no OpenStreetMap lines ({error}): matching on Sentinel-2 alone", "georef")
        return None
    return draw(features, grid)


def references(ctx: JobContext) -> References:
    """The job's Sentinel-2 window (the `reference` step's) in grey, and the OpenStreetMap lines on its grid."""
    reference_path = ctx.job.step("reference").gcs_path
    if reference_path is None:
        raise StepFailedError(Errors.REFERENCE_UNAVAILABLE, "the job has no reference window")
    info = ctx.services.objects.stat(reference_path) or _missing(reference_path)
    source = Sentinel2(ctx.stage(reference_path, "reference-s2.tif"), info, ())
    grid = source.grid()
    return References(grid, grey_reference(source), osm_lines(ctx, grid))


def match_scan(ctx: JobContext, georef: GeorefInfo, scan: ScanInfo) -> MatchResult:
    """Automatic pairs of the scan against the references, seeded from the job id (a job matches the same way twice)."""
    found = references(ctx)
    pixels = gdal_step(ctx, lambda: to_uint8(read_band(ctx.stage(scan.path, "scan.tif"))), "read the scan")
    initial = corner_transform(georef.gcps)
    seeded(int(fnv1a(ctx.job.id)[:7], 16))
    return match(Scan(pixels, scan_resolution(georef.gcps, scan.width)), initial.to_pixel, found)


def _scan_of(scan: ScanInfo | None) -> ScanInfo:
    if scan is None:
        raise StepFailedError(Errors.NO_SCAN, "the version has no scan")
    return scan


def _embedded(georef: GeorefInfo | None) -> bool:
    return georef is not None and georef.method == "embedded"


def _suggestions(ctx: JobContext, result: MatchResult, decision: Decision) -> dict[str, object]:
    record = GcpSuggestions(result.method, result.channels, ctx.now(), result.tiles.total, decision.suggestions).as_record()
    return {"suggestions": record}


class GeorefStep:
    name = "georef"

    def run(self, ctx: JobContext) -> StepResult:
        georef = ctx.version.georef
        if _embedded(georef):
            return Skipped("the upload carries its own georeference")
        scan = _scan_of(ctx.version.scan)
        if georef is None or not georef.gcps:
            return wait_for_points(ctx, 0)
        if georef.method != "corners":
            return self._fitted(ctx, fit_points(georef, scan), {"suggestions": DELETE})
        return self._matched(ctx, match_scan(ctx, georef, scan))

    def _matched(self, ctx: JobContext, result: MatchResult) -> StepResult:
        decision = decide(result.pairs)
        matched, total = result.tiles.total
        ctx.log.info(
            f"{result.method} over {', '.join(result.channels)}: {decision.confident} confident pairs, "
            f"{len(decision.suggestions)} suggestions, {matched} of {total} tiles matched",
            self.name,
        )
        suggestions = _suggestions(ctx, result, decision)
        if decision.fitted is None:
            code = Errors.NO_SPREAD if decision.degenerate else Errors.NO_MATCH
            return wait_for_points(ctx, decision.confident, suggestions, code)
        return self._fitted(ctx, recorded(decision.fitted, "auto"), suggestions)

    def _fitted(self, ctx: JobContext, georef: GeorefInfo, fields: Mapping[str, object]) -> Done:
        ctx.update_version({"georef": georef.as_record(), **fields})
        ctx.log.info(_summary(georef), self.name)
        return Done()


def _summary(georef: GeorefInfo) -> str:
    checkpoint = "no checkpoint" if georef.checkpoint_rmse_m is None else f"checkpoint RMSE {georef.checkpoint_rmse_m:.1f} m"
    return f"{georef.transform} through {len(georef.gcps)} pairs, fit RMSE {georef.fit_rmse_m or 0:.1f} m, {checkpoint}"
