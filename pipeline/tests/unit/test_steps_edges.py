"""The steps' refusals and less common paths, driven through the runner against the loopback world."""

import io
import tarfile
import zipfile
from pathlib import Path

import numpy
import pytest
from hcm_pipeline.config import Config, load_config
from hcm_pipeline.contract import Errors
from hcm_pipeline.rasters import GeoTiff, write_geotiff
from hcm_pipeline.runner import RunOutcome

from tests.fakes.http import Reply
from tests.fakes.world import CITY, ENTITY_ID, JOB_ID, PipelineWorld, dig

RAW = f"usgs-raw/corona2/{ENTITY_ID}/{ENTITY_ID}"
WORK = f"work/{CITY}/{JOB_ID}/"


def only(world: PipelineWorld, step: str, config: Config | None = None) -> RunOutcome:
    return world.runner(config).run(step)


def error_code(world: PipelineWorld, job_id: str = JOB_ID) -> str:
    error = world.job(job_id).get("error")
    assert isinstance(error, dict)
    return str(error["code"])


def fetched(world: PipelineWorld, path: str, data: bytes) -> None:
    world.seed_import()
    world.gcs.put(path, data)
    world.store.update(world.job_path(), {"steps.fetch": {"status": "done", "gcsPath": path}})


def tiff_bytes(tmp_path: Path, pixels: numpy.ndarray) -> bytes:
    return write_geotiff(tmp_path / "member.tif", GeoTiff([numpy.asarray(pixels, numpy.uint8)])).read_bytes()


def test_happy_path_a_zip_delivery_gives_its_segments(world: PipelineWorld, tmp_path: Path) -> None:
    packed = io.BytesIO()
    with zipfile.ZipFile(packed, "w") as archive:
        archive.writestr(f"{ENTITY_ID}/", "")
        archive.writestr(f"{ENTITY_ID}/{ENTITY_ID}_b.TIF", tiff_bytes(tmp_path, numpy.ones((4, 4))))
    fetched(world, f"{RAW}.zip", packed.getvalue())

    assert only(world, "extract") is RunOutcome.DONE
    assert world.gcs.names(WORK) == [f"{WORK}segments/b.tif"]


def test_bad_path_a_delivery_without_a_tiff_is_corrupt_and_deleted(world: PipelineWorld) -> None:
    packed = io.BytesIO()
    with tarfile.open(fileobj=packed, mode="w:gz") as archive:
        folder = tarfile.TarInfo("folder")
        folder.type = tarfile.DIRTYPE
        archive.addfile(folder)
        notes = tarfile.TarInfo("folder/README.txt")
        notes.size = 2
        archive.addfile(notes, io.BytesIO(b"hi"))
    fetched(world, f"{RAW}.tgz", packed.getvalue())

    assert only(world, "extract") is RunOutcome.FAILED
    assert error_code(world) == Errors.ARCHIVE_CORRUPT
    assert world.gcs.names("usgs-raw/") == []


def test_bad_path_extract_without_a_fetched_delivery_fails(world: PipelineWorld) -> None:
    world.seed_import()

    assert only(world, "extract") is RunOutcome.FAILED
    assert error_code(world) == Errors.ARCHIVE_CORRUPT


def test_bad_path_stitch_without_segments_or_with_a_blank_frame_fails(world: PipelineWorld, tmp_path: Path) -> None:
    world.seed_import()
    assert only(world, "stitch") is RunOutcome.FAILED
    assert error_code(world) == Errors.PROCESSING_FAILED

    world.seed_import()
    world.gcs.put(f"{WORK}segments/a.tif", tiff_bytes(tmp_path, numpy.zeros((64, 64))))
    assert only(world, "stitch") is RunOutcome.FAILED
    assert "no image inside its film border" in str(dig(world.job(), "error", "message"))


def test_bad_path_a_corrupt_usgs_segment_is_a_processing_failure_not_an_upload_to_redo(world: PipelineWorld) -> None:
    """Scenarios: S-P01-BAD-PROCESSING-FAILED"""
    world.seed_import()
    world.gcs.put(f"{WORK}segments/a.tif", b"II*\x00broken")

    assert only(world, "stitch") is RunOutcome.FAILED
    assert error_code(world) == Errors.PROCESSING_FAILED


def test_bad_path_locate_needs_the_scene_the_city_and_a_frame_over_the_window(world: PipelineWorld) -> None:
    world.seed_import()
    world.store.documents.pop(f"cities/{CITY}/usgsScenes/{ENTITY_ID}")
    assert only(world, "locate") is RunOutcome.FAILED
    assert error_code(world) == Errors.NOT_FOUND

    world.seed_import()
    world.store.documents.pop(f"cities/{CITY}")
    world.gcs.put(f"{WORK}frame.tif", b"")
    assert only(world, "locate") is RunOutcome.FAILED
    assert "the city bucharest does not exist" in str(dig(world.job(), "error", "message"))


def test_bad_path_a_frame_far_from_the_city_misses_the_window(world: PipelineWorld, tmp_path: Path) -> None:
    world.seed_import()
    world.store.update(f"cities/{CITY}", {"bounds": {"west": 2.30, "south": 48.84, "east": 2.36, "north": 48.87}})
    world.gcs.put(f"{WORK}frame.tif", tiff_bytes(tmp_path, numpy.full((300, 400), 120)))

    assert only(world, "locate") is RunOutcome.FAILED
    assert error_code(world) == Errors.REFERENCE_UNAVAILABLE


@pytest.mark.parametrize(
    ("href", "problem"),
    [("https://api.mapbox.com/v4/mapbox.satellite/0/0/0.jpg", "a Mapbox address"), ("http://127.0.0.1:9/missing.tif", "")],
)
def test_bad_path_a_refused_or_unreadable_sentinel2_asset_is_no_reference(
    world: PipelineWorld, tmp_path: Path, href: str, problem: str
) -> None:
    world.stac_href = href
    world.seed_import()

    assert only(world, "reference") is RunOutcome.FAILED
    assert error_code(world) == Errors.REFERENCE_UNAVAILABLE
    assert problem in str(dig(world.job(), "error", "message"))


def test_bad_path_under_the_emulators_an_asset_off_the_machine_is_no_reference(world: PipelineWorld) -> None:
    emulated = load_config(world.env(FIRESTORE_EMULATOR_HOST="127.0.0.1:8080", STORAGE_EMULATOR_HOST="127.0.0.1:9199"))
    world.seed_import()
    assert only(world, "reference", emulated) is RunOutcome.DONE

    # A real bucket's address in the item: the e2e tier's pipeline never leaves the machine (never resolved, never read).
    world.stac_href = "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/35/T/MK/TCI.tif"
    world.seed_import()
    world.gcs.objects = {name: data for name, data in world.gcs.objects.items() if not name.startswith("reference/")}

    assert only(world, "reference", emulated) is RunOutcome.FAILED
    assert error_code(world) == Errors.REFERENCE_UNAVAILABLE
    assert "off this machine under the emulators" in str(dig(world.job(), "error", "message"))


def test_bad_path_a_failing_stac_search_is_no_reference(world: PipelineWorld) -> None:
    for _ in range(3):
        world.http.enqueue("/stac/search", Reply(502))
    world.seed_import()

    assert only(world, "reference") is RunOutcome.FAILED
    assert error_code(world) == Errors.REFERENCE_UNAVAILABLE


def test_happy_path_a_second_job_over_the_same_window_reuses_the_cached_references(world: PipelineWorld) -> None:
    world.seed_import()
    assert only(world, "reference") is RunOutcome.DONE
    fetched_once = len(world.http.paths())

    world.seed_import()
    assert only(world, "reference") is RunOutcome.DONE

    assert [path for path in world.http.paths()[fetched_once:] if path != "/stac/search"] == []
