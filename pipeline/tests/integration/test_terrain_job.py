"""A frame fitted over terrain renders through its RPC with the city's surface model (M15-calibration-accuracy.md, *Terrain*)."""

from pathlib import Path
from typing import Final

import cv2
import numpy
import pytest
from hcm_pipeline import paths
from hcm_pipeline.config import Config
from hcm_pipeline.documents import TerrainInfo
from hcm_pipeline.geo import Bounds, FloatArray, MercatorBox, fnv1a, ground_scale, to_lnglat_arrays
from hcm_pipeline.georef.rpc import fit_rpc
from hcm_pipeline.raster import gdal, osr
from hcm_pipeline.rasters import driver_of
from hcm_pipeline.runner import RunOutcome
from hcm_pipeline.surface import DEM_SOURCE, tile_names

from tests.fakes.world import CITY, DEM_PATH, PipelineWorld, city_bounds
from tests.integration.test_regeoref_job import BASE, JOB, SPREAD, manual_gcps, seed_regeoref
from tests.synthetic.scenes import CENTRE, AffineScan, affine_scan

HEIGHT_M: Final = 100.0
# Higher ground shows half its height further east on this film: 100 m of ground is shown 50 m east of where it lies.
PARALLAX_EAST: Final = 0.5
MARGIN_SHARE: Final = 0.2


def window() -> MercatorBox:
    return Bounds.of(city_bounds()).mercator().expanded()


def serve_surface(world: PipelineWorld, tmp_path: Path, height_m: float = HEIGHT_M) -> None:
    """Every GLO-30 tile over the city, level at `height_m`."""
    for name in tile_names(window().bounds()):
        lat = int(name[23:25]) * (1 if name[22] == "N" else -1)
        lng = int(name[30:33]) * (1 if name[29] == "E" else -1)
        local = tmp_path / name.split("/")[-1]
        dataset = driver_of("GTiff").Create(str(local), 30, 30, 1, gdal.GDT_Float32)
        dataset.SetGeoTransform((lng, 1 / 30, 0.0, lat + 1, 0.0, -1 / 30))
        reference = osr.SpatialReference()
        reference.ImportFromEPSG(4326)
        dataset.SetProjection(reference.ExportToWkt())
        dataset.GetRasterBand(1).WriteArray(numpy.full((30, 30), height_m, numpy.float32))
        dataset.Close()
        world.http.serve(f"{DEM_PATH}/{name}", local.read_bytes())


def terrain_record(scan: AffineScan) -> dict[str, object]:
    """The scan's exact map over terrain: its affine map, a place at height h shown h * 0.5 further east."""
    scale = ground_scale(CENTRE[1])

    def ground_at(film: FloatArray, height_m: float) -> tuple[FloatArray, FloatArray]:
        a, b, c, d = scan.matrix
        east = scan.origin[0] + a * film[:, 0] + b * film[:, 1] - height_m * PARALLAX_EAST / scale
        north = scan.origin[1] + c * film[:, 0] + d * film[:, 1]
        return to_lnglat_arrays(east, north)

    height, width = scan.pixels.shape
    rpc = fit_rpc(ground_at, (width, height), (0.0, 200.0))
    assert rpc is not None
    return TerrainInfo(rpc, 12.0).as_record()


def warped(world: PipelineWorld, tmp_path: Path, name: str) -> Path:
    local = tmp_path / name
    local.write_bytes(world.gcs.objects[paths.work(CITY, JOB, "warped.tif")].data)
    return local


def east_shift_m(moved: Path, flat: Path) -> float:
    """How far east `moved` shows what `flat` shows, ground metres (phase correlation over their common box)."""
    first, second = gdal.Open(str(flat)), gdal.Open(str(moved))
    left, size, _, top, _, step = first.GetGeoTransform()
    width, height = first.RasterXSize * size, -first.RasterYSize * step
    inner = (MARGIN_SHARE, 1 - MARGIN_SHARE)
    bounds = (left + inner[0] * width, top - inner[1] * height, left + inner[1] * width, top - inner[0] * height)
    images = [gdal.Warp("", dataset, format="MEM", outputBounds=bounds, xRes=size, yRes=-step) for dataset in (first, second)]
    grey = [numpy.asarray(image.GetRasterBand(1).ReadAsArray(), numpy.float32) for image in images]
    (dx, _), _ = cv2.phaseCorrelate(grey[0], grey[1])
    return float(dx * size * ground_scale(CENTRE[1]))


def warp_only(world: PipelineWorld, **config: str) -> RunOutcome:
    """The warp step alone, its job started afresh each time."""
    world.seed_job(JOB, "regeoref", {"basedOn": BASE})
    return world.runner(Config(**{**world.config.__dict__, "job_id": JOB, **config})).run("warp")


def test_happy_path_a_frame_over_terrain_renders_through_its_rpc_and_the_surface_model(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P06-HAPPY-TERRAIN"""
    scan = seed_regeoref(world, tmp_path, manual_gcps(affine_scan(world.scene.world), SPREAD))
    assert warp_only(world) is RunOutcome.DONE
    flat = warped(world, tmp_path, "flat.tif")
    serve_surface(world, tmp_path)
    world.store.update(world.version_path(JOB), {"georef.terrain": terrain_record(scan)})

    assert warp_only(world) is RunOutcome.DONE

    # 100 m of ground shown 50 m east: the layer puts each feature 50 m west of the flat render.
    assert east_shift_m(warped(world, tmp_path, "terrain.tif"), flat) == pytest.approx(-HEIGHT_M * PARALLAX_EAST, abs=3.0)
    cached = paths.reference(CITY, "dem", fnv1a(f"{window().key()}|{DEM_SOURCE}"))
    assert cached in world.gcs.names("reference/")
    fetched = len(world.http.paths("GET"))
    assert warp_only(world) is RunOutcome.DONE
    assert len(world.http.paths("GET")) == fetched


def test_bad_path_without_the_surface_model_the_frame_renders_flat_and_says_so(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P06-BAD-TERRAIN-UNAVAILABLE"""
    scan = seed_regeoref(world, tmp_path, manual_gcps(affine_scan(world.scene.world), SPREAD))
    assert warp_only(world) is RunOutcome.DONE
    flat = warped(world, tmp_path, "flat.tif")
    world.store.update(world.version_path(JOB), {"georef.terrain": terrain_record(scan)})

    assert warp_only(world) is RunOutcome.DONE

    assert abs(east_shift_m(warped(world, tmp_path, "unread.tif"), flat)) < 1.0
    logs = " ".join(world.log_lines(JOB))
    assert "no Copernicus DEM tile could be read" in logs
    assert "the surface model is gone" in logs
    assert warp_only(world, dem_url="https://copernicus-dem-30m.s3.eu-central-1.amazonaws.com") is RunOutcome.DONE
    assert "no surface model (" in " ".join(world.log_lines(JOB))
