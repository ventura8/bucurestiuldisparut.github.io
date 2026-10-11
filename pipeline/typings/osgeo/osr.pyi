"""Stubs for the part of `osgeo.osr` (GDAL 3.13) the repository calls (callable attributes: see gdal.pyi)."""

from collections.abc import Callable

OAMS_TRADITIONAL_GIS_ORDER: int

class SpatialReference:
    ImportFromEPSG: Callable[[int], int]
    ImportFromWkt: Callable[[str], int]
    ExportToWkt: Callable[[], str]
    GetAuthorityCode: Callable[[str | None], str | None]
    SetAxisMappingStrategy: Callable[[int], None]

class CoordinateTransformation:
    def __init__(self, source: SpatialReference, target: SpatialReference, /) -> None: ...
    TransformPoint: Callable[[float, float], tuple[float, float, float]]

UseExceptions: Callable[[], None]
