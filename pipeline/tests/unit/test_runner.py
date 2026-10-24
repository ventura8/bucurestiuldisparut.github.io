"""The run loop with scripted steps: lease, step records, skips, waits, failures, crashes, cancels and resumes."""

from collections.abc import Callable
from dataclasses import dataclass, field

import pytest
from hcm_pipeline.config import Config
from hcm_pipeline.contract import Errors
from hcm_pipeline.jobs import Done, InterruptedRunError, JobContext, LeaseLostError, Skipped, StepFailedError, StepResult, Waiting
from hcm_pipeline.model import Timestamp
from hcm_pipeline.objects import ObjectInfo
from hcm_pipeline.runner import JobRunner, RunOutcome, RunSettings

from tests.fakes.world import CITY, NOW, PipelineWorld, dig

JOB = "job-regeoref-9"
STEPS = ("georef", "warp", "export", "register")


@dataclass
class Scripted:
    name: str
    result: StepResult = field(default_factory=Done)
    action: Callable[[JobContext], None] | None = None
    runs: int = 0

    def run(self, ctx: JobContext) -> StepResult:
        self.runs += 1
        if self.action is not None:
            self.action(ctx)
        return self.result


def scripted(**overrides: Scripted) -> dict[str, Scripted]:
    return {name: overrides.get(name, Scripted(name)) for name in STEPS}


def seed(world: PipelineWorld, params: dict[str, object] | None = None, version: bool = True) -> Config:
    world.seed_city()
    world.seed_job(JOB, "regeoref", params if params is not None else {"basedOn": "v0"})
    if version:
        world.store.seed(
            world.version_path(JOB),
            {"layerId": "layer-1", "jobId": JOB, "origin": "regeoref", "state": "processing", "label": {"ro": "x"}, "year": 1966},
        )
    return Config(**{**world.config.__dict__, "job_id": JOB})


def runner(world: PipelineWorld, config: Config, steps: dict[str, Scripted]) -> JobRunner:
    return JobRunner(config, world.services(), steps, RunSettings(heartbeat_seconds=3600))


def statuses(world: PipelineWorld) -> dict[str, str]:
    steps = world.job(JOB).get("steps", {})
    assert isinstance(steps, dict)
    return {name: str(record["status"]) for name, record in steps.items()}


def test_happy_path_every_step_runs_once_and_is_recorded(world: PipelineWorld) -> None:
    steps = scripted(georef=Scripted("georef", Skipped("nothing to fit")))

    outcome = runner(world, seed(world), steps).run()

    job = world.job(JOB)
    assert outcome is RunOutcome.DONE
    assert statuses(world) == {"georef": "skipped", "warp": "done", "export": "done", "register": "done"}
    assert [step.runs for step in steps.values()] == [1, 1, 1, 1]
    assert dig(job, "steps", "warp") == {"status": "done", "startedAt": Timestamp.at(NOW), "finishedAt": Timestamp.at(NOW)}
    assert "step georef skipped: nothing to fit" in world.log_lines(JOB)


def test_happy_path_a_done_step_whose_output_still_exists_is_not_run_again(world: PipelineWorld) -> None:
    config = seed(world)
    world.gcs.put("work/bucharest/job-regeoref-9/warped.tif", b"tif")
    generation = str(world.gcs.objects["work/bucharest/job-regeoref-9/warped.tif"].generation)
    world.store.update(
        world.job_path(JOB),
        {"steps.warp": {"status": "done", "gcsPath": "work/bucharest/job-regeoref-9/warped.tif", "generation": generation}},
    )
    world.store.update(world.job_path(JOB), {"steps.georef": {"status": "done", "gcsPath": "work/bucharest/job-regeoref-9/gone.tif"}})
    steps = scripted()

    runner(world, config, steps).run()

    assert (steps["georef"].runs, steps["warp"].runs) == (1, 0)


def test_happy_path_a_recorded_output_is_kept_with_its_generation(world: PipelineWorld) -> None:
    output = ObjectInfo("work/bucharest/job-regeoref-9/warped.tif", 3, "1792000000000009")
    steps = scripted(warp=Scripted("warp", Done(output, "a" * 64)))

    runner(world, seed(world), steps).run()

    assert dig(world.job(JOB), "steps", "warp", "generation") == "1792000000000009"
    assert dig(world.job(JOB), "steps", "warp", "bytes") == 3


def test_happy_path_one_step_on_its_own_leaves_the_job_queued(world: PipelineWorld) -> None:
    steps = scripted()

    outcome = runner(world, seed(world), steps).run("warp")

    assert outcome is RunOutcome.DONE
    assert [step.runs for step in steps.values()] == [0, 1, 0, 0]
    assert world.job(JOB)["status"] == "queued"


def test_bad_path_an_invalid_job_fails_without_running_a_step(world: PipelineWorld) -> None:
    steps = scripted()

    outcome = runner(world, seed(world, {"basedOn": "../x"}), steps).run()

    job = world.job(JOB)
    assert outcome is RunOutcome.FAILED
    assert dig(job, "error", "code") == Errors.INVALID_REQUEST
    assert job["status"] == "failed"
    assert all(step.runs == 0 for step in steps.values())


def test_bad_path_a_job_without_its_version_is_invalid(world: PipelineWorld) -> None:
    outcome = runner(world, seed(world, version=False), scripted()).run()

    assert outcome is RunOutcome.FAILED
    assert "does not exist" in str(dig(world.job(JOB), "error", "message"))


def test_bad_path_a_job_naming_no_version_is_invalid(world: PipelineWorld) -> None:
    config = seed(world)
    world.store.update(world.job_path(JOB), {"versionId": __import__("hcm_pipeline.store", fromlist=["DELETE"]).DELETE})

    assert runner(world, config, scripted()).run() is RunOutcome.FAILED
    assert "names no layer version" in str(dig(world.job(JOB), "error", "message"))


def test_bad_path_a_step_failure_fails_the_job_and_the_version_with_its_params(world: PipelineWorld) -> None:
    def fail(_ctx: JobContext) -> None:
        raise StepFailedError(Errors.TOO_FEW_GCPS, "too few enabled points; token=abc", {"min": 6})

    outcome = runner(world, seed(world), scripted(georef=Scripted("georef", action=fail))).run()

    job, version = world.job(JOB), world.version(JOB)
    assert outcome is RunOutcome.FAILED
    assert job["error"] == {"code": Errors.TOO_FEW_GCPS, "message": "too few enabled points; token=[REDACTED]", "params": {"min": 6}}
    assert job["finishedAt"] == Timestamp.at(NOW)
    assert statuses(world)["georef"] == "failed"
    assert version["state"] == "failed"
    assert version["error"] == {"code": Errors.TOO_FEW_GCPS, "params": {"min": 6}}


def test_bad_path_a_crash_fails_the_job_as_internal(world: PipelineWorld) -> None:
    def crash(_ctx: JobContext) -> None:
        raise KeyError("boom")

    outcome = runner(world, seed(world), scripted(warp=Scripted("warp", action=crash))).run()

    assert outcome is RunOutcome.FAILED
    assert dig(world.job(JOB), "error", "code") == Errors.INTERNAL
    assert world.version(JOB)["error"] == {"code": Errors.INTERNAL}


def test_bad_path_a_lost_lease_stops_without_writing(world: PipelineWorld) -> None:
    def lose(ctx: JobContext) -> None:
        world.store.update(world.job_path(JOB), {"lease.owner": "raster-pipeline-z/0"})
        raise LeaseLostError("taken")

    outcome = runner(world, seed(world), scripted(warp=Scripted("warp", action=lose))).run()

    assert outcome is RunOutcome.UNTOUCHED
    assert world.job(JOB)["status"] == "running"


def test_bad_path_a_cancel_seen_between_steps_cancels_the_job(world: PipelineWorld) -> None:
    def ask_to_cancel(_ctx: JobContext) -> None:
        world.store.update(world.job_path(JOB), {"cancelRequested": True})

    world.gcs.put(f"work/{CITY}/{JOB}/warped.tif", b"x")
    steps = scripted(georef=Scripted("georef", action=ask_to_cancel))

    outcome = runner(world, seed(world), steps).run()

    assert outcome is RunOutcome.CANCELLED
    assert steps["warp"].runs == 0
    assert world.version(JOB)["state"] == "cancelled"
    assert world.gcs.names(f"work/{CITY}/{JOB}/") == []


def test_bad_path_an_interrupted_step_is_requeued_with_its_start_kept(world: PipelineWorld) -> None:
    def interrupt(ctx: JobContext) -> None:
        raise InterruptedRunError("SIGTERM")

    outcome = runner(world, seed(world), scripted(export=Scripted("export", action=interrupt))).run()

    job = world.job(JOB)
    assert outcome is RunOutcome.REQUEUED
    assert (job["status"], job["retryAt"]) == ("queued", Timestamp.at(NOW + 60))
    assert dig(job, "steps", "export") == {"status": "pending", "startedAt": Timestamp.at(NOW)}


@pytest.mark.parametrize(
    ("waiting", "status"),
    [
        (Waiting("awaiting_gcps", "gcps", "needs points"), "awaiting_gcps"),
        (Waiting("waiting_usgs", "rate-limited", "slow down", Timestamp.at(NOW + 900)), "waiting_usgs"),
    ],
)
def test_bad_path_a_waiting_step_releases_the_lease_and_waits(world: PipelineWorld, waiting: Waiting, status: str) -> None:
    steps = scripted(georef=Scripted("georef", waiting))

    outcome = runner(world, seed(world), steps).run()

    job = world.job(JOB)
    assert outcome is RunOutcome.WAITING
    assert (job["status"], job["waitReason"]) == (status, waiting.reason)
    assert job.get("retryAt") == waiting.retry_at
    assert "lease" not in job
    assert steps["warp"].runs == 0
    assert waiting.message in world.log_lines(JOB)


def test_bad_path_a_job_document_without_a_type_is_invalid(world: PipelineWorld) -> None:
    config = seed(world)
    world.store.update(world.job_path(JOB), {"type": ""})

    assert runner(world, config, scripted()).run() is RunOutcome.FAILED
    assert dig(world.job(JOB), "error", "code") == Errors.INVALID_REQUEST
