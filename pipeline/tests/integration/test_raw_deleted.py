"""The raw USGS delivery is deleted once the city crop exists (M7, docs/research/M7-local-worker.md §5)."""

from hcm_pipeline.runner import RunOutcome

from tests.fakes.http import Reply
from tests.fakes.world import CITY, ENTITY_ID, JOB_ID, LAYER_ID, OVERPASS_PATH, PipelineWorld, dig

RAW = f"usgs-raw/corona2/{ENTITY_ID}/{ENTITY_ID}.tgz"
SCAN = f"rasters/{CITY}/{LAYER_ID}/{JOB_ID}/scan.tif"
DELETED = f"the USGS delivery {RAW} is deleted: the city crop is recorded"


def deliveries(world: PipelineWorld) -> int:
    return sum(1 for request in world.http.requests if request.path.endswith(f"{ENTITY_ID}.tgz"))


def test_happy_path_the_delivery_is_deleted_once_the_city_crop_exists(world: PipelineWorld) -> None:
    """Scenarios: S-P01-HAPPY-RAW-DELETED"""
    world.seed_import()

    assert world.run() is RunOutcome.DONE

    assert world.gcs.names("usgs-raw/") == []
    assert SCAN in world.gcs.names(f"rasters/{CITY}/")
    assert dig(world.version(), "scan", "path") == SCAN
    lines = world.log_lines()
    assert lines.index("step locate started") < lines.index(DELETED) < lines.index("step locate done")


def test_happy_path_a_retry_after_locate_needs_no_delivery(world: PipelineWorld) -> None:
    """Scenarios: S-P01-HAPPY-RAW-DELETED"""
    for _ in range(3):
        world.http.enqueue(OVERPASS_PATH, Reply(503, b"<html>busy</html>", "text/html"))
    world.seed_import()
    assert world.run() is RunOutcome.FAILED
    assert dig(world.job(), "steps", "reference", "status") == "failed"
    # The dispatcher's retry: `locate`'s crop exists, so the deleted delivery is not downloaded again.
    world.store.update(world.job_path(), {"status": "starting"})

    assert world.run() is RunOutcome.DONE

    assert deliveries(world) == 1
    assert world.job()["status"] == "awaiting_approval"
    assert world.log_lines().count("step fetch started") == 1


def test_bad_path_a_retry_after_the_delivery_was_deleted_downloads_it_again(world: PipelineWorld) -> None:
    """Scenarios: S-P01-BAD-RAW-GONE-RETRY"""
    world.seed_import()
    world.store.update(world.job_path(), {"machine": "fetch"})
    assert world.run() is RunOutcome.DONE
    # `extract` failed, and the delivery was deleted meanwhile (another city's `locate` of the same frame); the retry.
    del world.gcs.objects[RAW]
    world.store.update(world.job_path(), {"status": "starting", "machine": "std", "steps.extract.status": "failed"})

    assert world.run() is RunOutcome.DONE

    assert deliveries(world) == 2
    assert world.log_lines().count("step fetch started") == 2
    assert world.job()["status"] == "awaiting_approval"
    assert dig(world.job(), "steps", "fetch", "status") == "done"
    assert world.gcs.names("usgs-raw/") == []
