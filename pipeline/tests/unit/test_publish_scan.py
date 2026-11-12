"""The scan the georeferencer shows (`steps/common.publish_scan`): its preview and, for a longer scan, its sharper detail (2026-11-12)."""

from pathlib import Path

import numpy
from hcm_pipeline.contract import SCAN_DETAIL_MAX_PX, SCAN_PREVIEW_MAX_PX
from hcm_pipeline.documents import ScanInfo
from hcm_pipeline.rasters import GeoTiff, write_geotiff
from hcm_pipeline.steps.common import publish_scan

from tests.fakes.world import PipelineWorld
from tests.unit.placing_support import series_context


def _published(world: PipelineWorld, tmp_path: Path, size: tuple[int, int]) -> ScanInfo:
    ctx = series_context(world, tmp_path, [], {"class": "atlas", "encoding": "grey"})
    pixels = numpy.zeros((size[1], size[0]), numpy.uint8)
    pixels[:, ::7] = 255
    local = write_geotiff(ctx.local("scan.tif"), GeoTiff([pixels]))
    return publish_scan(ctx, local, pixels)


def test_happy_path_a_scan_longer_than_its_preview_gets_a_sharper_detail(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-A16-HAPPY-GEOREF-FULL-RES"""
    scan = _published(world, tmp_path, (SCAN_PREVIEW_MAX_PX * 2, 300))

    assert scan.preview_scale == 0.5
    assert scan.detail_scale == 1.0
    assert scan.detail_path is not None
    assert scan.detail_path.endswith("/scan-detail.jpg")
    assert scan.detail_path in world.gcs.objects
    record = scan.as_record()
    assert (record["detailPath"], record["detailScale"]) == (scan.detail_path, 1.0)
    assert ScanInfo.of(record) == scan
    assert SCAN_DETAIL_MAX_PX > SCAN_PREVIEW_MAX_PX


def test_bad_path_a_scan_no_longer_than_its_preview_gets_no_detail(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-A16-BAD-GEOREF-FULL-RES-NONE"""
    scan = _published(world, tmp_path, (1200, 300))

    assert (scan.preview_scale, scan.detail_path, scan.detail_scale) == (1.0, None, None)
    record = scan.as_record()
    assert "detailPath" not in record
    assert "detailScale" not in record
    assert not any(path.endswith("/scan-detail.jpg") for path in world.gcs.objects)
    assert ScanInfo.of(record) == scan
