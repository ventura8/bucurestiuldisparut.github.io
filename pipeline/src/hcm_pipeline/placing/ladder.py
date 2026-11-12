"""The reference ladder picked on its own (docs/research/M20-import-local.md §1.7, §3 c step 3): the city's published layers first.

An old map is matched far more easily against another old map of the city than against today's streets: the same streets, a similar
drawing, a similar extent (the owner, 2026-11-13). Every rung is a published version of another layer of the city, with its own
tiles and a year: the same kind first (a drawn map against drawn maps, a frame against frames and joins), then the nearest year, then
the one whose outline covers most of the city; at most `LADDER_LAYERS` of them. A series that names `referenceLayerIds` gets those
layers' published versions instead. OpenStreetMap stays the last rung (`reference.references`), used when no layer covers the map or
none of them places it. A rung is read from its own public tiles (`reference.tiles_reference`); Mapbox Satellite is never a reference.

The versions are what a worker may read of the city (its versions, M15), not its layers: a version names its layer, its year, its
origin and its outline.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Final

import numpy

from hcm_pipeline.jobs import JobContext

LADDER_LAYERS: Final = 2
PUBLISHED: Final = "published"
DRAWN: Final = "map"
FRAME: Final = "satellite"
# A version's origin and the kind of layer it makes: an archive map is drawn; a frame, a join or an upload of a photo is not.
DRAWN_ORIGINS: Final = ("archive",)


@dataclass(frozen=True)
class Rung:
    """A published version another map can be matched against: its layer, its year, its kind, its share of the city, its error."""

    layer_id: str
    version_id: str
    year: int
    kind: str
    cover: float = 0.0
    error_m: float | None = None

    @property
    def label(self) -> str:
        return f"layer:{self.layer_id}"


def _year(record: Mapping[str, object] | None) -> int | None:
    value = (record or {}).get("year")
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _number(value: object) -> float | None:
    return float(value) if isinstance(value, int | float) and not isinstance(value, bool) else None


def _corner(point: object) -> tuple[float, float] | None:
    """One `{lat, lng}` as (longitude, latitude), or None."""
    if not isinstance(point, Mapping):
        return None
    lng, lat = _number(point.get("lng")), _number(point.get("lat"))
    return None if lng is None or lat is None else (lng, lat)


def _corners(found: object) -> list[object]:
    """An outline's points, or a bounds record's two corners."""
    if isinstance(found, Mapping):
        return [{"lng": found.get("west"), "lat": found.get("south")}, {"lng": found.get("east"), "lat": found.get("north")}]
    return list(found) if isinstance(found, list) else []


def _span(found: object) -> tuple[float, float, float, float] | None:
    """An outline (a list of `{lat, lng}`) or a bounds record as (west, south, east, north), or None."""
    corners = [_corner(point) for point in _corners(found)]
    if not corners or None in corners:
        return None
    box = numpy.array(corners, numpy.float64)
    low, high = box.min(axis=0), box.max(axis=0)
    return float(low[0]), float(low[1]), float(high[0]), float(high[1])


def cover_of(outline: object, city: object) -> float:
    """The share (0 to 1) of the city's bounds the outline's box covers; 0 when either is unknown."""
    inner, outer = _span(outline), _span(city)
    if inner is None or outer is None:
        return 0.0
    width = max(0.0, min(inner[2], outer[2]) - max(inner[0], outer[0]))
    height = max(0.0, min(inner[3], outer[3]) - max(inner[1], outer[1]))
    area = (outer[2] - outer[0]) * (outer[3] - outer[1])
    return width * height / area if area > 0 else 0.0


def _error(version: Mapping[str, object]) -> float | None:
    for field in ("archive", "georef"):
        found = version.get(field)
        value = found.get("checkpointRmseM") if isinstance(found, Mapping) else None
        if isinstance(value, int | float):
            return float(value)
    return None


def _tiled(version: Mapping[str, object]) -> bool:
    output = version.get("output")
    return isinstance(output, Mapping) and isinstance(output.get("tiles"), Mapping)


def _usable(version: Mapping[str, object] | None) -> Mapping[str, object]:
    """The version when it is published with its own tiles, a layer and a year; else an empty record."""
    found = version or {}
    return found if _published(found) and isinstance(found.get("layerId"), str) and _year(found) is not None else {}


def _published(version: Mapping[str, object]) -> bool:
    return version.get("state") == PUBLISHED and _tiled(version)


def rung_of(version_id: str, version: Mapping[str, object] | None, city: object) -> Rung | None:
    """A published version with its own tiles, a layer and a year as a rung; None otherwise."""
    found = _usable(version)
    output, year = found.get("output"), _year(found)
    if not isinstance(output, Mapping) or year is None:
        return None
    kind = DRAWN if found.get("origin") in DRAWN_ORIGINS else FRAME
    return Rung(str(found.get("layerId")), version_id, year, kind, cover_of(output.get("outline"), city), _error(found))


def ranked(rungs: Sequence[Rung], year: int | None, kind: str) -> list[Rung]:
    """The rungs best first: the same kind, then the nearest year (any when the map's is unknown), then the widest cover."""
    return sorted(rungs, key=lambda rung: (rung.kind != kind, abs(rung.year - (year or rung.year)), -rung.cover, rung.layer_id))


def _wanted(rung: Rung, own: str, named: Sequence[str]) -> bool:
    return rung.layer_id != own and (not named or rung.layer_id in named)


def rungs(ctx: JobContext, named: Sequence[str] = (), kind: str = DRAWN, limit: int = LADDER_LAYERS) -> tuple[Rung, ...]:
    """The published versions the version is best matched against, best first, never its own layer's: those of the `named` layers
    when the series names some, else the nearest of the city's."""
    city = (ctx.read(f"cities/{ctx.city}") or {}).get("bounds")
    collection = f"cities/{ctx.city}/layerVersions"
    found = [rung_of(version_id, ctx.read(f"{collection}/{version_id}"), city) for version_id in ctx.services.store.list_ids(collection)]
    usable = [rung for rung in _present(found) if _wanted(rung, ctx.version.layer_id, named)]
    return tuple(ranked(usable, _year(ctx.read(ctx.version_path())), kind)[:limit])


def _present(found: Sequence[Rung | None]) -> list[Rung]:
    return [rung for rung in found if rung is not None]
