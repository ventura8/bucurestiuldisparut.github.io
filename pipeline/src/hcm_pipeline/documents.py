"""Layer versions, USGS scenes, cities and log lines as the pipeline reads and writes them (`@hcm/shared`).

`cities/{city}/layerVersions/{version}` (`layerVersionDocSchema`): the pipeline fills its `scan`, `reference`,
`georef` and `output` and moves its `state` (docs/research/M3-interfaces.md §2.2); the builders below produce the
records of `pipeline/tests/contracts/version.*.json`. The scene (`usgsSceneDocSchema`) gives the frame's corners;
the city (`cityDocSchema`) its bounds.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Final

import numpy

from hcm_pipeline.contract import GCP_ORIGINS, LAYER_VERSION_STATES, MAX_JOB_LOGS
from hcm_pipeline.geo import Bounds, to_mercator_arrays
from hcm_pipeline.georef.transforms import Gcp
from hcm_pipeline.model import (
    DocumentError,
    Record,
    Timestamp,
    bounds_of,
    id_of,
    member_of,
    metres,
    number_of,
    optional_record,
    optional_str,
    optional_text,
    record_of,
    require_transform,
    stamp,
    text_of,
)

GEOREF_METHODS: Final = ("corners", "gcps", "auto", "embedded")
VERSION_ORIGINS: Final = ("usgs", "upload", "regeoref", "crop")
LOG_LEVELS: Final = ("info", "warn", "error")
LOG_MESSAGE_MAX: Final = 2000
LatLng = tuple[float, float]


def _without_none(values: Mapping[str, object]) -> Record:
    return {key: value for key, value in values.items() if value is not None}


@dataclass(frozen=True)
class ScanInfo:
    """`version.scan`: the cropped scan the georeferencer shows, and its preview."""

    path: str
    width: int
    height: int
    sha256: str
    preview_path: str
    preview_scale: float

    @classmethod
    def of(cls, value: object) -> ScanInfo:
        record = record_of(value, "scan")
        return cls(
            text_of(record, "path"),
            int(number_of(record, "width")),
            int(number_of(record, "height")),
            text_of(record, "sha256"),
            text_of(record, "previewPath"),
            number_of(record, "previewScale"),
        )

    def as_record(self) -> Record:
        return {
            "path": self.path,
            "width": self.width,
            "height": self.height,
            "sha256": self.sha256,
            "previewPath": self.preview_path,
            "previewScale": round(self.preview_scale, 6),
        }


@dataclass(frozen=True)
class ReferenceInfo:
    """`version.reference`: the window and the reference images drawn for it."""

    bounds: Bounds
    osm_path: str | None = None
    s2_path: str | None = None
    s2_item: str | None = None
    s2_date: str | None = None

    @classmethod
    def of(cls, value: object) -> ReferenceInfo:
        record = record_of(value, "reference")
        return cls(
            bounds_of(record.get("bounds")),
            optional_text(record, "osmPath"),
            optional_text(record, "s2Path"),
            optional_text(record, "s2Item"),
            optional_text(record, "s2Date"),
        )

    def as_record(self) -> Record:
        return _without_none(
            {
                "bounds": self.bounds.as_record(),
                "osmPath": self.osm_path,
                "s2Path": self.s2_path,
                "s2Item": self.s2_item,
                "s2Date": self.s2_date,
            }
        )


def gcp_of(value: object) -> Gcp:
    record = record_of(value, "a GCP")
    pixel, geo = record_of(record.get("pixel"), "pixel"), record_of(record.get("geo"), "geo")
    score, residual = record.get("score"), record.get("residualM")
    return Gcp(
        id=id_of(record, "id"),
        x=number_of(pixel, "x"),
        y=number_of(pixel, "y"),
        lat=number_of(geo, "lat"),
        lng=number_of(geo, "lng"),
        enabled=record.get("enabled") is not False,
        origin=member_of(record, "origin", GCP_ORIGINS),
        score=float(score) if isinstance(score, int | float) else None,
        residual_m=float(residual) if isinstance(residual, int | float) else None,
    )


def _gcps_of(value: object) -> tuple[Gcp, ...]:
    if not isinstance(value, list):
        raise DocumentError("gcps must be a list")
    return tuple(gcp_of(item) for item in value)


def _optional_metres(value: float | None) -> float | None:
    return None if value is None else metres(value)


@dataclass(frozen=True)
class GeorefInfo:
    """`version.georef`: how the scan is georeferenced, its pairs and errors."""

    method: str
    transform: str
    gcps: tuple[Gcp, ...] = ()
    fit_rmse_m: float | None = None
    checkpoint_rmse_m: float | None = None
    checkpoint_count: int | None = None

    @classmethod
    def of(cls, value: object) -> GeorefInfo:
        record = record_of(value, "georef")
        return cls(
            member_of(record, "method", GEOREF_METHODS), require_transform(text_of(record, "transform")), _gcps_of(record.get("gcps"))
        )

    def as_record(self) -> Record:
        return _without_none(
            {
                "method": self.method,
                "transform": self.transform,
                "gcps": [gcp.as_record() for gcp in self.gcps],
                "fitRmseM": _optional_metres(self.fit_rmse_m),
                "checkpointRmseM": _optional_metres(self.checkpoint_rmse_m),
                "checkpointCount": self.checkpoint_count,
            }
        )


@dataclass(frozen=True)
class OutputInfo:
    """`version.output`: the COG Mapbox gets, the admin's preview and the Studio-sized file."""

    cog_path: str
    cog_bytes: int
    cog_sha256: str
    preview_path: str
    bounds: Bounds
    minzoom: int
    maxzoom: int
    area_km2: float
    studio_path: str | None = None
    studio_bytes: int | None = None

    def as_record(self) -> Record:
        return _without_none(
            {
                "cogPath": self.cog_path,
                "cogBytes": self.cog_bytes,
                "cogSha256": self.cog_sha256,
                "previewPath": self.preview_path,
                "bounds": self.bounds.as_record(),
                "minzoom": self.minzoom,
                "maxzoom": self.maxzoom,
                "areaKm2": round(self.area_km2, 3),
                "studioPath": self.studio_path,
                "studioBytes": self.studio_bytes,
            }
        )


def _latlng(value: object) -> LatLng:
    record = record_of(value, "a place")
    return number_of(record, "lat"), number_of(record, "lng")


def _ring_of(value: object) -> tuple[LatLng, ...] | None:
    return None if not isinstance(value, list) else tuple(_latlng(item) for item in value)


@dataclass(frozen=True)
class Version:
    """The parts of a layer version the pipeline reads."""

    id: str
    layer_id: str
    origin: str
    state: str
    source: Record
    based_on: str | None = None
    sensor: str | None = None
    scan: ScanInfo | None = None
    reference: ReferenceInfo | None = None
    georef: GeorefInfo | None = None
    crop: tuple[LatLng, ...] | None = None

    @classmethod
    def of(cls, version_id: str, record: Mapping[str, object]) -> Version:
        scan, reference, georef = record.get("scan"), record.get("reference"), record.get("georef")
        return cls(
            id=version_id,
            layer_id=id_of(record, "layerId"),
            origin=member_of(record, "origin", VERSION_ORIGINS),
            state=member_of(record, "state", LAYER_VERSION_STATES),
            source=optional_record(record.get("source")),
            based_on=optional_str(record.get("basedOn")),
            sensor=optional_str(record.get("sensor")),
            scan=None if scan is None else ScanInfo.of(scan),
            reference=None if reference is None else ReferenceInfo.of(reference),
            georef=None if georef is None else GeorefInfo.of(georef),
            crop=_ring_of(record.get("crop")),
        )


def _corner(record: Mapping[str, object], key: str) -> LatLng:
    return _latlng(record.get(key))


def _quad(value: object) -> tuple[LatLng, LatLng, LatLng, LatLng] | None:
    if not isinstance(value, dict):
        return None
    return _corner(value, "nw"), _corner(value, "ne"), _corner(value, "se"), _corner(value, "sw")


def _extremes(footprint: Sequence[LatLng]) -> tuple[LatLng, LatLng, LatLng, LatLng]:
    """The footprint's four extreme vertices (north-west, north-east, south-east, south-west), on a normalized box."""
    places = numpy.array(footprint, numpy.float64)
    x, y = to_mercator_arrays(places[:, 1], places[:, 0])
    u = (x - x.min()) / max(float(numpy.ptp(x)), 1e-9)
    v = (y - y.min()) / max(float(numpy.ptp(y)), 1e-9)
    nw, ne, se, sw = (
        footprint[int(index)] for index in (numpy.argmin(u - v), numpy.argmax(u + v), numpy.argmax(u - v), numpy.argmin(u + v))
    )
    return nw, ne, se, sw


@dataclass(frozen=True)
class Scene:
    """The parts of `cities/{city}/usgsScenes/{entityId}` the corner guess reads."""

    entity_id: str
    acquisition_date: str
    footprint: tuple[LatLng, ...]
    corners: tuple[LatLng, LatLng, LatLng, LatLng] | None

    @classmethod
    def of(cls, entity_id: str, record: Mapping[str, object]) -> Scene:
        footprint = record.get("footprint")
        if not isinstance(footprint, list) or len(footprint) < len(("nw", "ne", "se")):
            raise DocumentError("footprint must list at least three places")
        places = tuple(_latlng(item) for item in footprint)
        return cls(entity_id, text_of(record, "acquisitionDate"), places, _quad(record.get("corners")))

    def corner_quad(self) -> tuple[LatLng, LatLng, LatLng, LatLng]:
        """The frame's four geographic corners (north-west first, clockwise): the metadata's, else the footprint's extremes."""
        return self.corners if self.corners is not None else _extremes(self.footprint)


def city_bounds(record: Mapping[str, object]) -> Bounds:
    """`cities/{city}.bounds`."""
    return bounds_of(record.get("bounds"))


def log_line(seq: int, level: str, message: str, now: Timestamp, step: str | None = None) -> Record:
    """`jobs/{job}/logs/{seq}` (`jobLogDocSchema`): the message is already redacted and is cut to 2,000 characters."""
    if level not in LOG_LEVELS or not 0 <= seq < MAX_JOB_LOGS:
        raise DocumentError("a log line needs a known level and a sequence number under 500")
    return _without_none({"seq": seq, "level": level, "step": step, "message": message[:LOG_MESSAGE_MAX], **stamp(now)})


def log_id(seq: int) -> str:
    """A log line's document id: its sequence number zero-padded to 6 digits."""
    return f"{seq:06d}"
