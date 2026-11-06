"""The local worker runs a claimed import through the API and signed URLs (M7, docs/research/M7-local-worker.md §1).

The real worker (`Worker.build`, its loop, runtime, stores and proxy) against the fake server side of
`tests/fakes/worker_api.py` and the pipeline's loopback world (the USGS delivery, STAC and Overpass): the steps are the
pipeline's own, unchanged.
"""

import hashlib
import os
import shutil
import time
from collections.abc import Callable, Iterator, Mapping
from pathlib import Path
from types import SimpleNamespace

import pytest
from hcm_pipeline.contract import Errors
from hcm_pipeline.m2m import M2MClient, http_client
from hcm_pipeline.secrets import EmulatorSecrets, usgs_credentials
from hcm_pipeline.store import DELETE
from hcm_pipeline.worker.args import Endpoints, WorkerArgs
from hcm_pipeline.worker.local_store import DAY_SECONDS
from hcm_pipeline.worker.loop import Pass
from hcm_pipeline.worker.worker import Worker

from tests.fakes.http import FakeHttpServer, Reply
from tests.fakes.worker_api import PROJECT, FakeWorkerApi
from tests.fakes.world import CITY, ENTITY_ID, JOB_ID, LAYER_ID, OVERPASS_PATH, STAC_PATH, FakeClock, PipelineWorld, dig

STEPS = ("fetch", "extract", "stitch", "locate", "reference", "georef", "warp", "export", "register")
VERSION_FILES = ("cog.tif", "preview.png", "reference-osm.png", "reference-s2.jpg", "scan-preview.jpg", "scan.tif", "studio.tif")
RAW = f"usgs-raw/corona2/{ENTITY_ID}/{ENTITY_ID}.tgz"


@pytest.fixture
def api(world: PipelineWorld) -> Iterator[FakeWorkerApi]:
    with FakeHttpServer() as server:
        fake = FakeWorkerApi(world.store, server, FakeClock(world.clock.now)).install()
        secrets = EmulatorSecrets("e2e-ok")
        fake.m2m = lambda: M2MClient(http_client(world.m2m.base_url), usgs_credentials(secrets))
        yield fake


def local_import(world: PipelineWorld) -> None:
    """An import queued for the owner's computer, as the dispatcher leaves it (no machine, waiting for a worker)."""
    world.seed_import(status="queued")
    world.store.update(world.job_path(), {"runOn": "local", "waitReason": "worker", "machine": DELETE})


@pytest.fixture
def built() -> Iterator[list[Worker]]:
    """The workers a test builds, closed after it (their page sockets and clients)."""
    workers: list[Worker] = []
    yield workers
    for worker in workers:
        worker.close()


def signed_in_worker(
    world: PipelineWorld, api: FakeWorkerApi, work: Path, built: list[Worker], clock: Callable[[], float] = time.time
) -> Worker:
    args = WorkerArgs(
        city=CITY,
        project=PROJECT,
        port=0,
        work=work,
        emulators=True,
        endpoints=Endpoints.emulated(PROJECT, api.env()),
        stac_url=world.http.url(STAC_PATH),
        overpass_url=world.http.url(OVERPASS_PATH),
    )
    worker = Worker.build(args, "127.0.0.1", clock)
    built.append(worker)
    assert worker.actions.sign_in(*api.sign_in_tokens(api.clock() + 3600)) is None
    return worker


def aged(work: Path, name: str, moment: float) -> Path:
    """A file of the work folder last written at `moment`."""
    file = work / name
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_bytes(b"left by an earlier import")
    os.utime(file, (moment, moment))
    return file


def statuses(world: PipelineWorld) -> dict[str, str]:
    steps = world.job()["steps"]
    assert isinstance(steps, dict)
    return {name: str(record["status"]) for name, record in steps.items()}


def step_requests(api: FakeWorkerApi) -> list[Mapping[str, object]]:
    found = [call.data.get("request") for call in api.calls if call.name == "worker-step"]
    return [request for request in found if isinstance(request, dict)]


def test_happy_path_the_worker_runs_a_claimed_import_through_the_api_and_signed_urls(
    world: PipelineWorld, api: FakeWorkerApi, tmp_path: Path, built: list[Worker]
) -> None:
    """Scenarios: S-P04-HAPPY-WORKER-RUN"""
    local_import(world)
    worker = signed_in_worker(world, api, tmp_path / "work", built)

    assert worker.loop.run_once() is Pass.RAN

    # Every step ran, unchanged; the version awaits approval.
    job = world.job()
    assert (job["status"], job["waitReason"]) == ("awaiting_approval", "approval")
    assert statuses(world) == dict.fromkeys(STEPS, "done")
    assert world.version()["state"] == "awaiting_approval"
    assert dig(job, "worker", "id") == worker.worker_id
    # The documents went through worker.step: the job, its version, its log lines.
    paths = {str(request.get("path") or request.get("collection")) for request in step_requests(api)}
    assert {world.job_path(), world.version_path(), f"{world.job_path()}/logs", f"cities/{CITY}"} <= paths
    # The version's files went up through signed PUTs, and nothing else was ever signed or sent.
    version_files = [f"rasters/{CITY}/{LAYER_ID}/{JOB_ID}/{name}" for name in VERSION_FILES]
    assert sorted(path for method, path in api.sent if method == "PUT") == version_files
    assert sorted(api.objects) == version_files
    assert all(path.startswith(f"rasters/{CITY}/{LAYER_ID}/{JOB_ID}/") for _method, path in api.signed)
    assert world.gcs.names() == []
    # The delivery, the segments and the frame were the work folder's: recorded there, never signed.
    assert (dig(job, "steps", "fetch", "gcsPath"), dig(job, "steps", "fetch", "sha256")) == (
        RAW,
        hashlib.sha256(world.delivery).hexdigest(),
    )
    assert str(dig(job, "steps", "extract", "gcsPath")).startswith(f"work/{CITY}/{JOB_ID}/segments/")
    assert str(dig(job, "steps", "stitch", "gcsPath")) == f"work/{CITY}/{JOB_ID}/frame.json"
    assert not (tmp_path / "work" / RAW).exists()
    assert list((tmp_path / "work" / "reference" / CITY / "s2").glob("*.tif"))
    # The run's end was reported.
    assert api.ended() == [{"cityId": CITY, "workerId": worker.worker_id, "jobId": JOB_ID, "outcome": "done"}]
    assert worker.state.snapshot()["state"] == "idle"


def test_happy_path_an_idle_pass_sweeps_what_failed_imports_left_on_the_disk(
    world: PipelineWorld, api: FakeWorkerApi, tmp_path: Path, built: list[Worker]
) -> None:
    """Scenarios: S-P04-HAPPY-DISK-SWEPT"""
    work = tmp_path / "work"
    worker = signed_in_worker(world, api, work, built, api.clock)
    old = api.clock() - 15 * DAY_SECONDS
    scratch = aged(work, f"work/{CITY}/failed-job/segments/a.tif", old)
    delivery = aged(work, "usgs-raw/corona2/E1/E1.tgz", api.clock() - 8 * DAY_SECONDS)
    recent = aged(work, f"work/{CITY}/waiting-job/segments/a.tif", api.clock() - DAY_SECONDS)

    assert worker.loop.run_once() is Pass.IDLE

    assert not scratch.exists()
    assert not delivery.exists()
    assert recent.exists()


def test_bad_path_the_sweep_of_a_claimed_pass_leaves_the_claimed_jobs_scratch_and_the_deliveries(
    world: PipelineWorld, api: FakeWorkerApi, tmp_path: Path, built: list[Worker]
) -> None:
    """Scenarios: S-P04-BAD-SWEEP-KEEPS-CLAIMED"""
    for _ in range(3):
        world.http.enqueue(OVERPASS_PATH, Reply(503, b"<html>busy</html>", "text/html"))
    local_import(world)
    work = tmp_path / "work"
    worker = signed_in_worker(world, api, work, built, api.clock)
    old = api.clock() - 30 * DAY_SECONDS
    claimed = aged(work, f"work/{CITY}/{JOB_ID}/old-scratch.bin", old)
    other = aged(work, f"work/{CITY}/failed-job/segments/a.tif", old)
    delivery = aged(work, "usgs-raw/corona2/E1/E1.tgz", old)

    assert worker.loop.run_once() is Pass.RAN

    # The run failed after `locate`: nothing but the sweep could have touched its scratch.
    assert world.job()["status"] == "failed"
    assert claimed.exists()
    assert not other.exists()
    assert delivery.exists()

    assert worker.loop.run_once() is Pass.IDLE
    assert not delivery.exists()


def test_bad_path_a_disk_too_small_fails_the_import_before_its_download(
    world: PipelineWorld, api: FakeWorkerApi, tmp_path: Path, built: list[Worker], monkeypatch: pytest.MonkeyPatch
) -> None:
    """Scenarios: S-P04-BAD-NO-FREE-SPACE"""
    local_import(world)
    worker = signed_in_worker(world, api, tmp_path / "work", built)
    monkeypatch.setattr(shutil, "disk_usage", lambda _path: SimpleNamespace(free=len(world.delivery)))

    assert worker.loop.run_once() is Pass.RAN

    job = world.job()
    assert (job["status"], dig(job, "error", "code")) == ("failed", Errors.PROCESSING_FAILED)
    assert "free some disk" in str(dig(job, "error", "message"))
    assert statuses(world)["fetch"] == "failed"
    assert not list((tmp_path / "work" / "usgs-raw").glob("**/*.tgz"))
    assert [part.stat().st_size for part in (tmp_path / "work" / ".sessions").glob("*")] == []


def test_bad_path_a_worker_that_lost_its_job_stops_writing_and_reports_the_end(
    world: PipelineWorld, api: FakeWorkerApi, tmp_path: Path, built: list[Worker]
) -> None:
    """Scenarios: S-P04-BAD-NOT-HOLDER"""
    local_import(world)
    worker = signed_in_worker(world, api, tmp_path / "work", built)

    refused: list[int] = []

    def stitch_starts(request: Mapping[str, object]) -> bool:
        """The server gives the job to another worker as `stitch` is about to start (the call being answered is the last)."""
        fields = request.get("fields")
        starts = isinstance(fields, dict) and fields.get("step") == "stitch"
        refused.extend([len(api.calls) - 1] if starts and not refused else [])
        return starts

    api.revoke_when = stitch_starts

    assert worker.loop.run_once() is Pass.RAN

    assert api.names()[refused[0] + 1 :] == ["worker-end"]
    assert api.ended()[0]["outcome"] == "done"
    assert statuses(world) == {"fetch": "done", "extract": "done"}
    assert "step stitch started" not in world.log_lines()
    assert world.job()["status"] == "running"
    assert api.objects == {}
