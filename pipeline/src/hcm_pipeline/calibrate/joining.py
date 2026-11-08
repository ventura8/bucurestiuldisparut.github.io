"""A proved frame's fit with the frames held still that overlap it (docs/research/M15-calibration-accuracy.md, *Joint solve*).

The pairs, the checks and the training tiles are the frame's own (`pairs.py`); a partner's ties in a cell held for checks, or outside the
scan, never count, so a checkpoint stays unseen by every fit. With a partner that counts (`joint.counts`) the frame's camera is joined
when it holds nearly the tiles the polynomial's RANSAC kept, else a polynomial restricted to the film's measured box (`together.py`);
the georeference is then the joined map's, as a lattice. With none, the frame is fitted alone and each partner is recorded as too few.

A KH-9 panoramic frame over relief its camera shows (`terrain.py`, `Proved.heights`) is fitted the same way on its rows' flat places, with
or without partners: its map goes back to the ground through the heights, its lattice is the flat map, and the warp renders it through an
RPC with the surface model (`georef/rpc.py`). A camera that does not hold leaves the frame flat, as before.
"""

from collections.abc import Sequence
from dataclasses import dataclass, replace

import numpy

from hcm_pipeline.calibrate.camera import fit_panoramic
from hcm_pipeline.calibrate.joint import FEW, Joined, ModelFit, PartnerTies, PlaceFn, Rows, Verdict, counts, joined
from hcm_pipeline.calibrate.pairs import (
    CAMERA_MIN_KEPT_SHARE,
    Calibrated,
    Chosen,
    Mapped,
    Ransac,
    ScanBox,
    alone,
    chosen_of,
    inside,
    mapped_calibration,
)
from hcm_pipeline.calibrate.proof import PAIR_CELL_GROUND_M
from hcm_pipeline.calibrate.terrain import Heights, OnGround, Terrain, TerrainFit, terrain_of
from hcm_pipeline.calibrate.together import (
    PANORAMIC_MODEL,
    POLYNOMIAL_MODEL,
    blocked_figure_of,
    camera_fit,
    free_of,
    kept_tiles,
    polynomial_fit,
)
from hcm_pipeline.geo import FloatArray, ground_scale, to_lnglat_arrays
from hcm_pipeline.georef.rpc import fit_rpc

Found = tuple[Chosen, Ransac]


@dataclass(frozen=True)
class Proved:
    """What a proved frame is fitted on: its tiles, the proved order, the scan in the film and the window's middle latitude; `heights`,
    the surface model under the city (None: the frame is fitted flat)."""

    rows: FloatArray
    order: int
    scan: ScanBox
    middle_lat: float
    heights: Heights | None = None


def joined_calibration(proved: Proved, seed: int, partners: Sequence[PartnerTies] = ()) -> Calibrated | None:
    """The frame's fit, joined to `partners` held still when one counts (module docstring); None when its pairs do not fit."""
    found = chosen_of(proved.rows[inside(proved.rows, proved.scan)], proved.order, proved.middle_lat, seed)
    if found is None:
        return None
    free = free_of([ties.where(inside(ties.film, proved.scan)) for ties in partners], found[1].held, found[1].cell)
    terrain = _terrain(found[0], proved)
    on_ground = None if terrain is None else _together(found, proved, free, terrain)
    return on_ground or _flat(found, proved, free)


def _flat(found: Found, proved: Proved, free: Sequence[PartnerTies]) -> Calibrated | None:
    return _with_partners(found, proved, free) if free else alone(found, proved.scan, proved.middle_lat)


def _terrain(chosen: Chosen, proved: Proved) -> Terrain | None:
    """The frame's terrain: a KH-9 panoramic frame with a surface model (`_over_terrain`)."""
    rad_per_px, heights = proved.scan.rad_per_px, proved.heights
    return None if rad_per_px is None or heights is None else _over_terrain(chosen, rad_per_px, heights)


def _over_terrain(chosen: Chosen, rad_per_px: float, heights: Heights) -> Terrain | None:
    """Its camera fitted flat holds (as `alone` asks) and the relief it shows is not negligible."""
    film, places = chosen.training[:, :2], chosen.training[:, 2:4]
    camera = fit_panoramic(film, places, rad_per_px)
    if camera is None or camera.kept < CAMERA_MIN_KEPT_SHARE * chosen.kept:
        return None
    return terrain_of(camera, film, places, heights)


def _with_partners(found: Found, proved: Proved, partners: Sequence[PartnerTies]) -> Calibrated | None:
    if any(counts(ties) for ties in partners):
        return _together(found, proved, partners) or alone(found, proved.scan, proved.middle_lat)
    return _noted(alone(found, proved.scan, proved.middle_lat), partners)


def _noted(fitted: Calibrated | None, partners: Sequence[PartnerTies]) -> Calibrated | None:
    """The frame fitted alone, each partner recorded as too few."""
    few = tuple(Verdict(ties.partner, len(ties.film), ties.tried, FEW) for ties in partners)
    return None if fitted is None else replace(fitted, alignment=few)


def _tiles(chosen: Chosen) -> Rows:
    return Rows.tiles(chosen.training[:, :2], chosen.training[:, 2:4])


@dataclass(frozen=True)
class _Joint:
    """A joined map, the model that made it and its lattice's name."""

    result: Joined
    fit: ModelFit
    model: str


def _camera_joined(chosen: Chosen, scan: ScanBox, partners: Sequence[PartnerTies], terrain: Terrain | None) -> _Joint | None:
    """The camera joined (over its terrain, when it has one), when the frame has one and it holds nearly the tiles the polynomial's
    RANSAC kept."""
    if scan.rad_per_px is None:
        return None
    fit = camera_fit(scan.rad_per_px) if terrain is None else terrain.fitted(camera_fit(scan.rad_per_px))
    found = joined(fit, _tiles(chosen), partners)
    return None if found is None else _holding(_Joint(found, fit, PANORAMIC_MODEL), chosen)


def _holding(joint: _Joint, chosen: Chosen) -> _Joint | None:
    """The joined camera when it holds nearly the tiles the polynomial's RANSAC kept."""
    holds = kept_tiles(joint.result.to_places, chosen.training) >= CAMERA_MIN_KEPT_SHARE * chosen.kept
    return joint if holds else None


def _joint(chosen: Chosen, scan: ScanBox, partners: Sequence[PartnerTies], terrain: Terrain | None) -> _Joint | None:
    """The camera joined, else (flat only) a restricted polynomial; None when neither fits."""
    camera = _camera_joined(chosen, scan, partners, terrain)
    if camera is not None or terrain is not None:
        return camera
    result = joined(polynomial_fit(), _tiles(chosen), partners)
    return None if result is None else _Joint(result, polynomial_fit(), POLYNOMIAL_MODEL)


def _figure(joint: _Joint, chosen: Chosen, partners: Sequence[PartnerTies], middle_lat: float) -> float | None:
    """The blocked figure of the model on the frame's tiles and the ties it used."""
    used = [ties for ties in partners if ties.partner in joint.result.used]
    return blocked_figure_of(joint.fit, _tiles(chosen).plus(used), chosen.pairs, 2 * PAIR_CELL_GROUND_M / ground_scale(middle_lat))


def _calibrated(joint: _Joint, found: Found, proved: Proved, partners: Sequence[PartnerTies]) -> Calibrated | None:
    """The georeference of a joined map, as a lattice (the flat map's, over terrain), its verdicts recorded."""
    chosen, ransac = found
    to_places = joint.result.to_places
    flat = to_places.flat if isinstance(to_places, OnGround) else None
    mapped = Mapped(to_places, joint.model, _figure(joint, chosen, partners, proved.middle_lat), flat)
    fitted = mapped_calibration(chosen.checked_by(mapped.to_places, ransac.candidates), proved.scan, mapped, proved.middle_lat)
    if fitted is None:
        return None
    return _on_ground(replace(fitted, alignment=joint.result.verdicts), to_places, proved, chosen)


def _on_ground(fitted: Calibrated, to_places: PlaceFn, proved: Proved, chosen: Chosen) -> Calibrated | None:
    """A flat map as it is; one over terrain with its RPC, None when no RPC holds it."""
    if not isinstance(to_places, OnGround):
        return fitted
    rendered = _rendered(to_places, proved, chosen)
    return None if rendered is None else replace(fitted, terrain=rendered)


def _rendered(to_places: OnGround, proved: Proved, chosen: Chosen) -> TerrainFit | None:
    """The RPC a warp renders a map over terrain through, over the scan and every height of the surface model."""
    offset, values = numpy.array([proved.scan.left, proved.scan.top], numpy.float64), to_places.terrain.heights.values

    def ground_at(film: FloatArray, height_m: float) -> tuple[FloatArray, FloatArray]:
        places = to_places.terrain.ground(to_places.flat(film + offset), height_m)
        return to_lnglat_arrays(places[:, 0], places[:, 1])

    rpc = fit_rpc(ground_at, (proved.scan.width, proved.scan.height), (float(values.min()), float(values.max())))
    relief = to_places.terrain.relief_m(chosen.training[:, :2], chosen.training[:, 2:4])
    return None if rpc is None else TerrainFit(rpc, relief)


def _together(found: Found, proved: Proved, partners: Sequence[PartnerTies], terrain: Terrain | None = None) -> Calibrated | None:
    """The frame joined to its partners. A partner that counts brings a hundred ties or more, and one always stays (a partner's offset
    from a map that cannot be fitted is unknown, and it is kept), so the joined map fits; None only if the model itself refuses. Over
    terrain, with or without partners, the camera alone: None when it does not hold."""
    joint = _joint(found[0], proved.scan, partners, terrain)
    return None if joint is None else _calibrated(joint, found, proved, partners)
