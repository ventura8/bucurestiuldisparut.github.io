"""A proved frame's fit with the frames held still that overlap it (docs/research/M15-calibration-accuracy.md, *Joint solve*).

The pairs, the checks and the training tiles are the frame's own (`pairs.py`); a partner's ties in a cell held for checks, or outside the
scan, never count, so a checkpoint stays unseen by every fit. With a partner that counts (`joint.counts`) the frame's camera is joined
when it holds nearly the tiles the polynomial's RANSAC kept, else a polynomial restricted to the film's measured box (`together.py`);
the georeference is then the joined map's, as a lattice. With none, the frame is fitted alone and each partner is recorded as too few.
"""

from collections.abc import Sequence
from dataclasses import dataclass, replace

from hcm_pipeline.calibrate.joint import FEW, Joined, ModelFit, PartnerTies, Rows, Verdict, counts, joined
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
from hcm_pipeline.calibrate.together import (
    PANORAMIC_MODEL,
    POLYNOMIAL_MODEL,
    blocked_figure_of,
    camera_fit,
    free_of,
    kept_tiles,
    polynomial_fit,
)
from hcm_pipeline.geo import FloatArray, ground_scale

Found = tuple[Chosen, Ransac]


@dataclass(frozen=True)
class Proved:
    """What a proved frame is fitted on: its tiles, the proved order, the scan in the film and the window's middle latitude."""

    rows: FloatArray
    order: int
    scan: ScanBox
    middle_lat: float


def joined_calibration(proved: Proved, seed: int, partners: Sequence[PartnerTies] = ()) -> Calibrated | None:
    """The frame's fit, joined to `partners` held still when one counts (module docstring); None when its pairs do not fit."""
    found = chosen_of(proved.rows[inside(proved.rows, proved.scan)], proved.order, proved.middle_lat, seed)
    if found is None:
        return None
    free = free_of([ties.where(inside(ties.film, proved.scan)) for ties in partners], found[1].held, found[1].cell)
    return _with_partners(found, proved, free) if free else alone(found, proved.scan, proved.middle_lat)


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


def _camera_joined(chosen: Chosen, scan: ScanBox, partners: Sequence[PartnerTies]) -> Joined | None:
    """The camera joined, when the frame has one and it holds nearly the tiles the polynomial's RANSAC kept."""
    found = None if scan.rad_per_px is None else joined(camera_fit(scan.rad_per_px), _tiles(chosen), partners)
    holds = found is not None and kept_tiles(found.to_places, chosen.training) >= CAMERA_MIN_KEPT_SHARE * chosen.kept
    return found if holds else None


@dataclass(frozen=True)
class _Joint:
    """A joined map, the model that made it and its lattice's name."""

    result: Joined
    fit: ModelFit
    model: str


def _joint(chosen: Chosen, scan: ScanBox, partners: Sequence[PartnerTies]) -> _Joint | None:
    """The camera joined, else a restricted polynomial; None when neither fits."""
    camera = _camera_joined(chosen, scan, partners)
    if camera is not None:
        return _Joint(camera, camera_fit(float(scan.rad_per_px or 0.0)), PANORAMIC_MODEL)
    result = joined(polynomial_fit(), _tiles(chosen), partners)
    return None if result is None else _Joint(result, polynomial_fit(), POLYNOMIAL_MODEL)


def _figure(joint: _Joint, chosen: Chosen, partners: Sequence[PartnerTies], middle_lat: float) -> float | None:
    """The blocked figure of the model on the frame's tiles and the ties it used."""
    used = [ties for ties in partners if ties.partner in joint.result.used]
    return blocked_figure_of(joint.fit, _tiles(chosen).plus(used), chosen.pairs, 2 * PAIR_CELL_GROUND_M / ground_scale(middle_lat))


def _calibrated(joint: _Joint, found: Found, proved: Proved, partners: Sequence[PartnerTies]) -> Calibrated | None:
    """The georeference of a joined map, as a lattice, its verdicts recorded."""
    chosen, ransac = found
    mapped = Mapped(joint.result.to_places, joint.model, _figure(joint, chosen, partners, proved.middle_lat))
    fitted = mapped_calibration(chosen.checked_by(mapped.to_places, ransac.candidates), proved.scan, mapped, proved.middle_lat)
    return None if fitted is None else replace(fitted, alignment=joint.result.verdicts)


def _together(found: Found, proved: Proved, partners: Sequence[PartnerTies]) -> Calibrated | None:
    """The frame joined to its partners. A partner that counts brings a hundred ties or more, and one always stays (a partner's offset
    from a map that cannot be fitted is unknown, and it is kept), so the joined map fits; None only if the model itself refuses."""
    joint = _joint(found[0], proved.scan, partners)
    return None if joint is None else _calibrated(joint, found, proved, partners)
