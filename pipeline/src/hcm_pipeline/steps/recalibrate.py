"""M16: a published layer, or a version waiting for approval, calibrated again (docs/research/M16-recalibrate.md §2, §3).

A recalibration is a `regeoref` version carrying `recalibration`. `RecalibratedGeorefStep` is the `georef` step for every job: a version
with the route `auto` (Refine automatically) or `points` (Snap my points) is measured again here, the rest goes to `GeorefStep` unchanged.

- **The start.** `auto`: the current fit (refitted from the current version's pairs). `points`: the current pairs moved by the rough
  points' corrections (the nearest point weighs most, so one point moves the whole map and several bend it), plus the points themselves,
  fitted with the current transform.
- **The references.** A `regeoref` job has no `reference` step: the city window's cached Sentinel-2 and OpenStreetMap lines are read here.
- **The proof** and the pairs are M9's own (`measured_on_scan`, `calibrated`), every gate unchanged.
- **The ruler** (§2): the current fit and the new one are measured on **the same checks**, the new version's disabled pairs, in ground
  metres (`transforms.residuals_m`). A manual version (the georeferencer's Save) is compared the same way when it holds at least
  `RECALIBRATE_MIN_CHECKS` disabled pairs.
- **Endings.** The proof refused: declined (`refineRefused`). `auto` with too few held-out checks to compare: declined
  (`refineUnmeasured`, not `refineRefused`: the tiles agreed). `auto` not better by `RECALIBRATE_MIN_GAIN_M`: declined (`notImproved`).
  Declined is `DeclinedError`: the job and its version end cancelled with the reason, nothing rendered.

To reconcile with track/accuracy (§9): `current_fit` refits the current pairs with their recorded transform; a camera model or a rendered
lattice must be built here instead, and `figure_on` is the one place the ruler lives.
"""

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from typing import Final

import numpy

from hcm_pipeline.calibrate.dense import PROOF_SEARCH_GROUND_M
from hcm_pipeline.calibrate.pairs import Calibrated, ScanBox, calibrated
from hcm_pipeline.calibrate.proof import Proof
from hcm_pipeline.contract import MIN_GCPS, RECALIBRATE_MIN_CHECKS, RECALIBRATE_MIN_GAIN_M, Errors
from hcm_pipeline.documents import GeorefInfo, ScanInfo, Version
from hcm_pipeline.geo import to_lnglat, to_mercator
from hcm_pipeline.georef.matcher import References
from hcm_pipeline.georef.transforms import Fit, Gcp, Transform, enabled_gcps, fit, fit_transform, residuals_m, rmse
from hcm_pipeline.jobs import DeclinedError, Done, JobContext, StepFailedError, StepResult
from hcm_pipeline.model import number_of, record_of
from hcm_pipeline.steps.common import city_window, gdal_step, grey_reference, sentinel2
from hcm_pipeline.steps.georef import (
    AUTO_METHOD,
    SEED_MAX_SEARCH_M,
    SEED_SEARCH_RMSE_SHARE,
    GeorefStep,
    TransformMap,
    job_seed,
    measured_on_scan,
    osm_lines,
    recorded,
    references,
)
from hcm_pipeline.store import DELETE

# The new pairs this close to a rough point are what Snap proposes there (ground metres).
POINT_REACH_GROUND_M: Final = 1500.0
# How far the tiles search around a start the rough points bent: at least twice the furthest the start misses a point by.
POINT_SEARCH_SHARE: Final = 2.0
STARTED_ROUTES: Final = frozenset({"auto", "points"})


@dataclass(frozen=True)
class Figure:
    """A checkpoint figure: ground metres over `checks` pairs (`recalibration.before`, `after`)."""

    rmse_m: float
    checks: int

    def as_record(self) -> dict[str, object]:
        return {"rmseM": round(self.rmse_m, 2), "checks": self.checks}


@dataclass(frozen=True)
class Compared:
    """The current fit and the new one on the same checks."""

    before: Figure
    after: Figure

    @property
    def better(self) -> bool:
        """The one reading of the figures (`recalibrationVerdict` in `@hcm/shared`): better by at least `RECALIBRATE_MIN_GAIN_M`."""
        return self.after.rmse_m <= self.before.rmse_m - RECALIBRATE_MIN_GAIN_M

    def as_record(self) -> dict[str, object]:
        return {"before": self.before.as_record(), "after": self.after.as_record()}

    def text(self) -> str:
        return f"{self.after.rmse_m:.1f} m against the current {self.before.rmse_m:.1f} m on the same {self.after.checks} checks"


def figure_on(transform: Transform, checks: Sequence[Gcp]) -> Figure:
    """A transform's error on `checks`, the product's ruler: ground metres between each place and where the transform puts its pixel."""
    return Figure(rmse(residuals_m(transform, checks).tolist()), len(checks))


def held_out(georef: GeorefInfo) -> list[Gcp]:
    """The fit's checkpoints that it never saw: its disabled pairs."""
    return [gcp for gcp in georef.gcps if not gcp.enabled]


def compared(current: Fit | None, georef: GeorefInfo) -> Compared | None:
    """Both fits on the new fit's held-out pairs, when there are enough of them; None otherwise."""
    checks = held_out(georef)
    if current is None or len(checks) < RECALIBRATE_MIN_CHECKS:
        return None
    return Compared(figure_on(current.transform, checks), Figure(georef.checkpoint_rmse_m or 0.0, len(checks)))


def figures_record(figures: Compared | None) -> dict[str, object]:
    return {} if figures is None else figures.as_record()


def figures_text(figures: Compared | None) -> str:
    return "not compared: too few held-out checks" if figures is None else figures.text()


def refitted(georef: GeorefInfo | None) -> Fit | None:
    """A recorded georeference's fit, from its pairs; None without pairs to fit."""
    fitted = None if georef is None or not georef.gcps else fit(georef.transform, georef.gcps)
    return fitted if isinstance(fitted, Fit) else None


def current_fit(ctx: JobContext) -> Fit | None:
    """The current version's fit (`basedOn`), refitted from its pairs; None when it has none."""
    based_on = ctx.version.based_on
    record = None if based_on is None else ctx.services.store.get(f"cities/{ctx.city}/layerVersions/{based_on}")
    return None if record is None or based_on is None else refitted(Version.of(based_on, record).georef)


@dataclass(frozen=True)
class RoughPoint:
    """A pixel of the scan and where the admin says it lies (`recalibration.points`)."""

    x: float
    y: float
    lat: float
    lng: float

    @classmethod
    def of(cls, value: object) -> RoughPoint:
        record = record_of(value, "a rough point")
        pixel, geo = record_of(record.get("pixel"), "its pixel"), record_of(record.get("geo"), "its place")
        return cls(number_of(pixel, "x"), number_of(pixel, "y"), number_of(geo, "lat"), number_of(geo, "lng"))

    def as_gcp(self, index: int) -> Gcp:
        return Gcp(f"r{index + 1}", self.x, self.y, self.lat, self.lng)


def ground_m(lat_a: float, lng_a: float, lat_b: float, lng_b: float) -> float:
    """Ground metres between two places (Mercator distance at their mean latitude)."""
    (xa, ya), (xb, yb) = to_mercator(lng_a, lat_a), to_mercator(lng_b, lat_b)
    return math.hypot(xb - xa, yb - ya) * math.cos(math.radians((lat_a + lat_b) / 2))


def near(gcp: Gcp, points: Sequence[RoughPoint]) -> bool:
    return any(ground_m(gcp.lat, gcp.lng, point.lat, point.lng) <= POINT_REACH_GROUND_M for point in points)


def points_of(ctx: JobContext) -> list[RoughPoint]:
    raw = ctx.version.recalibration.get("points")
    return [RoughPoint.of(point) for point in raw] if isinstance(raw, list) else []


def offsets(current: Fit, points: Sequence[RoughPoint]) -> list[tuple[float, float, float, float]]:
    """Each rough point's place in Mercator and how far the current fit is from it there: `(x, y, dx, dy)`."""
    found = []
    for point in points:
        fx, fy = current.transform.to_mercator(numpy.array([point.x]), numpy.array([point.y]))
        x, y = to_mercator(point.lng, point.lat)
        found.append((x, y, x - float(fx[0]), y - float(fy[0])))
    return found


def moved(gcp: Gcp, shifts: Sequence[tuple[float, float, float, float]]) -> Gcp:
    """A current pair moved by the rough points' corrections, each weighing by the inverse square of its distance."""
    x, y = to_mercator(gcp.lng, gcp.lat)
    weights = [1.0 / max(math.hypot(x - sx, y - sy), 1.0) ** 2 for sx, sy, _, _ in shifts]
    total = sum(weights)
    dx = sum(weight * shift[2] for weight, shift in zip(weights, shifts, strict=True)) / total
    dy = sum(weight * shift[3] for weight, shift in zip(weights, shifts, strict=True)) / total
    lng, lat = to_lnglat(x + dx, y + dy)
    return replace(gcp, lat=lat, lng=lng)


def bent_start(current: Fit, points: Sequence[RoughPoint]) -> Transform:
    """The current fit bent to the rough points: every current pair moved by their corrections, nearest weighing most, and the points
    themselves, fitted with the current transform (affine when too few)."""
    shifts = offsets(current, points)
    pairs = [moved(gcp, shifts) for gcp in enabled_gcps(current.gcps)] + [point.as_gcp(index) for index, point in enumerate(points)]
    kind = current.transform.kind if len(pairs) >= MIN_GCPS[current.transform.kind] else "affine"
    bent = fit_transform(kind, pairs)
    if bent is None:
        raise StepFailedError(Errors.DEGENERATE_GCPS, "the rough points and the pairs around them are collinear or coincident")
    return bent


def start_of(current: Fit, points: Sequence[RoughPoint]) -> Transform:
    """Where the tiles start: the current fit, or the current fit bent to the rough points."""
    return bent_start(current, points) if points else current.transform


def search_m(current: Fit, start: Transform, points: Sequence[RoughPoint]) -> float:
    """How far the tiles search: as M9's seeded points for Refine; from bent points, at least twice the furthest the start misses one by,
    as the admin reads them roughly."""
    if points:
        missed = max(float(residuals_m(start, [point.as_gcp(index)])[0]) for index, point in enumerate(points))
        return max(PROOF_SEARCH_GROUND_M, min(POINT_SEARCH_SHARE * missed, SEED_MAX_SEARCH_M))
    rmse_m = current.checkpoint_rmse_m or 0.0
    return max(PROOF_SEARCH_GROUND_M, min(SEED_SEARCH_RMSE_SHARE * rmse_m, SEED_MAX_SEARCH_M))


def window_references(ctx: JobContext) -> References:
    """The job's reference when it has one, else the city window's cached Sentinel-2 and OpenStreetMap lines (a `regeoref` job)."""
    if ctx.job.step("reference").gcs_path is not None:
        return references(ctx)
    source = sentinel2(ctx, city_window(ctx))
    grid = source.grid()
    return References(grid, grey_reference(source), osm_lines(ctx, grid))


def proved_pairs(ctx: JobContext, proof: Proof, scan: ScanInfo) -> Calibrated:
    """The proof's pairs and checks, or the refine declines: the current fit stays."""
    found = None
    if proof.accepted:
        order = proof.forward.order if proof.forward is not None else 2
        middle = city_window(ctx).bounds().middle_lat
        found = calibrated(proof.measured.rows, order, ScanBox(0, 0, scan.width, scan.height), middle, job_seed(ctx))
    if found is None:
        raise DeclinedError(Errors.REFINE_REFUSED, f"the tiles were not proved ({proof.refusal or 'no fit'}): the current fit stays")
    return found


def require_better(figures: Compared | None) -> None:
    """Refine renders only a better fit: too few checks to tell, or not better, and it declines."""
    if figures is None:
        raise DeclinedError(Errors.REFINE_UNMEASURED, "too few checks to compare the two fits: the current fit stays")
    if not figures.better:
        params = {"before": f"{figures.before.rmse_m:.1f}", "after": f"{figures.after.rmse_m:.1f}"}
        raise DeclinedError(Errors.NOT_IMPROVED, f"{figures.text()}: not better, the current fit stays", params)


def proposed(georef: GeorefInfo, points: Sequence[RoughPoint]) -> int:
    """The new pairs near a rough point: what Snap proposes there."""
    return sum(1 for gcp in enabled_gcps(georef.gcps) if near(gcp, points))


def route_of(ctx: JobContext) -> object:
    return ctx.version.recalibration.get("route")


class RecalibratedGeorefStep(GeorefStep):
    """`georef`, with M16's refine for a version that asks for one and the figures of a manual recalibration."""

    def run(self, ctx: JobContext) -> StepResult:
        return self._refine(ctx) if route_of(ctx) in STARTED_ROUTES else super().run(ctx)

    def _refine(self, ctx: JobContext) -> Done:
        scan, current = ctx.version.scan, current_fit(ctx) or refitted(ctx.version.georef)
        if scan is None or current is None:
            raise StepFailedError(Errors.NO_SCAN, "the version has no scan or no fit to refine")
        points = points_of(ctx)
        start, given = start_of(current, points), window_references(ctx)
        reach = search_m(current, start, points)
        proof = gdal_step(ctx, lambda: measured_on_scan(ctx, TransformMap(start), scan, reach, given), "measure the scan")
        georef = recorded(proved_pairs(ctx, proof, scan).fitted, AUTO_METHOD)
        figures = compared(current, georef)
        ctx.log.info(f"refined: {proof.inliers} of {proof.tried} tiles agree; {figures_text(figures)}", self.name)
        return GeorefStep._fitted(self, ctx, georef, {"recalibration": self._record(ctx, proof, figures, georef), "suggestions": DELETE})

    def _record(self, ctx: JobContext, proof: Proof, figures: Compared | None, georef: GeorefInfo) -> dict[str, object]:
        """What the new version records; Refine with no points declines unless it is better."""
        points = points_of(ctx)
        if not points:
            require_better(figures)
        near_points = {"proposed": proposed(georef, points)} if points else {}
        tiles = {"agreed": proof.inliers, "tried": proof.tried}
        return {**ctx.version.recalibration, **figures_record(figures), "tiles": tiles, **near_points}

    def _fitted(self, ctx: JobContext, georef: GeorefInfo, fields: Mapping[str, object]) -> Done:
        """A manual recalibration (the georeferencer's Save) is fitted as saved, with the two fits on its disabled pairs."""
        if route_of(ctx) != "manual":
            return super()._fitted(ctx, georef, fields)
        figures = compared(current_fit(ctx), georef)
        ctx.log.info(figures_text(figures), self.name)
        return super()._fitted(ctx, georef, {**fields, "recalibration": {**ctx.version.recalibration, **figures_record(figures)}})
