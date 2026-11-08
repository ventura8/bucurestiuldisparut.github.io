"""Which accepted frames a proved frame is held to, at their edges (M15-calibration-accuracy.md, *Joint solve*)."""

from pathlib import Path

import numpy
import pytest
from hcm_pipeline.calibrate.joint import DISAGREES, FEW, USED, Verdict
from hcm_pipeline.calibrate.ties import AlignImage
from hcm_pipeline.documents import Version
from hcm_pipeline.geo import Bounds, MercatorBox
from hcm_pipeline.joblog import JobLog
from hcm_pipeline.jobs import JobContext, RunFlags
from hcm_pipeline.log import get_logger
from hcm_pipeline.model import Job
from hcm_pipeline.raster import gdal
from hcm_pipeline.steps.aligning import (
    Held,
    alignment_record,
    held_frames,
    joined_summary,
    read_onto,
    window_box,
    write_align,
)
from hcm_pipeline.worker.api import WorkerApiError

from tests.fakes.world import CITY, JOB_ID, LAYER_ID, PipelineWorld, city_bounds

BOUNDS = city_bounds()
PROVED = {"calibration": {"how": "votes"}, "georef": {"method": "auto"}}


def context(world: PipelineWorld, workdir: Path) -> JobContext:
    world.seed_import()
    log = JobLog(world.store, f"{world.job_path()}/logs", world.clock, get_logger("test"))
    job, version = Job.of(JOB_ID, world.job()), Version.of(JOB_ID, world.version())
    return JobContext(world.config, world.services(), job, version, workdir, RunFlags(), log)


def frame(world: PipelineWorld, version_id: str, year: int, **fields: object) -> None:
    """An accepted, proved frame over the city with its image, unless `fields` say otherwise (`image=False`: none kept)."""
    keep = fields.pop("image", True)
    record = {**world.version(), "state": "published", "year": year, "output": {"bounds": BOUNDS}, **PROVED, **fields}
    world.store.seed(world.version_path(version_id), record)
    if keep:
        world.gcs.put(f"rasters/{CITY}/{LAYER_ID}/{version_id}/align.tif", b"an image")


def test_happy_path_the_accepted_proved_frames_over_it_newest_first(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P06-HAPPY-JOINT-HELD-STILL"""
    ctx = context(world, tmp_path)
    frame(world, "v-1972", 1972)
    frame(world, "v-1979", 1979, state="approved")

    found = held_frames(ctx, Bounds.of(BOUNDS))

    assert found == [
        Held("v-1979", 1979, f"rasters/{CITY}/{LAYER_ID}/v-1979/align.tif"),
        Held("v-1972", 1972, f"rasters/{CITY}/{LAYER_ID}/v-1972/align.tif"),
    ]


def test_bad_path_a_frame_that_cannot_be_held_is_passed_over(world: PipelineWorld, tmp_path: Path) -> None:
    """Scenarios: S-P06-BAD-JOINT-NOT-ACCEPTED"""
    ctx = context(world, tmp_path)
    elsewhere = {"west": 30.0, "south": 50.0, "east": 30.1, "north": 50.1}
    frame(world, "v-points", 1970, georef={"method": "gcps"})
    frame(world, "v-refused", 1971, calibration={"how": "none"})
    frame(world, "v-rejected", 1972, state="rejected")
    frame(world, "v-no-image", 1973, image=False)
    frame(world, "v-elsewhere", 1974, output={"bounds": elsewhere})
    frame(world, "v-no-bounds", 1975, output={"bounds": {"west": 1.0}})
    frame(world, "v-no-output", 1976, output=None)

    assert held_frames(ctx, Bounds.of(BOUNDS)) == []


def test_bad_path_a_version_gone_between_the_list_and_its_read_is_passed_over(
    world: PipelineWorld, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Scenarios: S-P06-BAD-JOINT-NOT-ACCEPTED"""
    ctx = context(world, tmp_path)
    frame(world, "v-1972", 1972)
    listed = ctx.services.store.list_ids
    monkeypatch.setattr(ctx.services.store, "list_ids", lambda collection: [*listed(collection), "v-gone"])

    assert [held.version_id for held in held_frames(ctx, Bounds.of(BOUNDS))] == ["v-1972"]


def test_bad_path_a_server_that_lists_no_versions_to_the_run_leaves_the_frame_alone(
    world: PipelineWorld, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Scenarios: S-P06-BAD-JOINT-NOT-ACCEPTED"""
    ctx = context(world, tmp_path)
    frame(world, "v-1972", 1972)

    listed = ctx.services.store.list_ids

    def refused(collection: str) -> list[str]:
        if collection.endswith("/layerVersions"):
            raise WorkerApiError("apiError.worker.refused", "the collection is off the allow-list")
        return listed(collection)

    monkeypatch.setattr(ctx.services.store, "list_ids", refused)

    assert held_frames(ctx, Bounds.of(BOUNDS)) == []
    assert any(line.startswith("the other frames could not be read") for line in world.log_lines())


def test_bad_path_a_version_the_server_cannot_read_is_no_partner_and_the_frame_goes_on(
    world: PipelineWorld, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Scenarios: S-P06-BAD-JOINT-UNREADABLE
    The live join of 2026-11-08: one older version failed its schema on the server, and the read answered apiError.internal."""
    ctx = context(world, tmp_path)
    frame(world, "v-1972", 1972)
    frame(world, "v-1966", 1966)
    frame(world, "v-1968", 1968)
    read = ctx.services.store.get

    def broken(path: str) -> object:
        if path.endswith(("/v-1966", "/v-1968")):
            raise WorkerApiError("apiError.internal", "the server could not read it")
        return read(path)

    monkeypatch.setattr(ctx.services.store, "get", broken)

    assert [held.version_id for held in held_frames(ctx, Bounds.of(BOUNDS))] == ["v-1972"]
    warned = [line for line in world.log_lines() if line.startswith("2 other frames could not be read")]
    assert len(warned) == 1
    assert "v-1966" in warned[0]
    assert "v-1968" in warned[0]


def test_happy_path_the_record_and_the_log_line_name_every_partner() -> None:
    """Scenarios: S-P06-HAPPY-JOINT-HELD-STILL, S-P06-BAD-JOINT-PARTNER-DISAGREES"""
    verdicts = [Verdict("v-1972", 1420, 1643, USED, 1.36), Verdict("v-1966", 78, 124, FEW), Verdict("v-x", 900, 1500, DISAGREES, 9.2)]
    held = [Held("v-1972", 1972, "a"), Held("v-1966", None, "b")]

    record = alignment_record(verdicts, held)

    assert record == {
        "partners": [
            {"versionId": "v-1972", "ties": 1420, "tried": 1643, "status": USED, "offsetM": 1.36, "year": 1972},
            {"versionId": "v-1966", "ties": 78, "tried": 124, "status": FEW},
            {"versionId": "v-x", "ties": 900, "tried": 1500, "status": DISAGREES, "offsetM": 9.2},
        ]
    }
    assert joined_summary(verdicts) == "joined to 1 accepted frames held still, 1420 film ties; left out: v-1966 (few), v-x (disagrees)"
    assert joined_summary(verdicts[:1]) == "joined to 1 accepted frames held still, 1420 film ties"


def test_happy_path_an_image_written_and_read_back_on_another_grid_keeps_its_cells(tmp_path: Path) -> None:
    """Scenarios: S-P06-HAPPY-JOINT-HELD-STILL"""
    grey = numpy.zeros((40, 60), numpy.uint8)
    grey[10:30, 20:50] = numpy.arange(1, 31, dtype=numpy.uint8)[None, :]
    path = write_align(AlignImage(grey, 2.9e6, 5.5e6, 7.0), tmp_path / "align.tif")
    dataset = gdal.Open(str(path))
    assert dataset.GetRasterBand(1).GetNoDataValue() == 0
    dataset.Close()

    wider = read_onto(path, AlignImage(numpy.zeros((50, 70), numpy.uint8), 2.9e6 - 70.0, 5.5e6 + 70.0, 7.0))

    assert numpy.array_equal(wider.grey[10:50, 10:70], grey)
    assert int(wider.grey[:10].max()) == 0
    box = window_box(MercatorBox(10.5, -3.2, 99.0, 50.1), 7.0)
    assert (box.left, box.bottom, box.right, box.top) == (7.0, -7.0, 105.0, 56.0)
