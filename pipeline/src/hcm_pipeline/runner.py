"""`python -m hcm_pipeline run`: one execution of a raster job (docs/research/M3-interfaces.md §4.4-§4.5, §5.2).

It takes the lease, validates the job, then walks the job type's pipeline steps in order: a step recorded `done`
or `skipped` whose output still exists is passed over, so a retry or a resume continues where the job stopped.
How a run ends:

| Ending | The job | Exit |
| --- | --- | --- |
| every step done | `awaiting_approval` (`waitReason: 'approval'`), lease released | 0 |
| a step waits | `waiting_usgs` with `retryAt`, or `awaiting_gcps`; the step `pending` | 0 |
| a step fails | `failed` with `error {code, message, params}`; the version `failed` | 1 |
| an invalid job | `failed` with `apiError.invalidRequest` (a retry cannot help) | 1 |
| `cancelRequested` (heartbeat, a checkpoint, or SIGTERM after it) | `cancelled`; the version `cancelled`; its `work/` objects deleted | 0 |
| SIGTERM without a cancel | `queued` with `retryAt` + 1 minute; the step `pending`, its checkpoint kept | 0 |
| another live owner holds the lease, or the job is not runnable | untouched | 0 |

Local scratch files live in a temporary folder removed whatever the ending.
"""

import enum
import signal
import tempfile
from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from types import FrameType
from typing import Final, Protocol

from hcm_pipeline import paths
from hcm_pipeline.config import Config
from hcm_pipeline.contract import REQUEUE_SECONDS, Errors, pipeline_steps_of, step_weights
from hcm_pipeline.documents import Version
from hcm_pipeline.joblog import JobLog, scrub
from hcm_pipeline.jobs import (
    CancelledRunError,
    Done,
    InterruptedRunError,
    JobContext,
    LeaseLostError,
    RunFlags,
    RunStoppedError,
    Services,
    Skipped,
    StepFailedError,
    StepResult,
    Waiting,
)
from hcm_pipeline.lease import Heartbeat, owned_change, take_lease
from hcm_pipeline.log import get_logger
from hcm_pipeline.model import DocumentError, Job, Record, StepRecord, Timestamp, params_of, stamp
from hcm_pipeline.store import DELETE

LOG = get_logger("runner")
ERROR_MESSAGE_MAX: Final = 2000


class RunOutcome(enum.Enum):
    DONE = "done"
    WAITING = "waiting"
    CANCELLED = "cancelled"
    REQUEUED = "requeued"
    UNTOUCHED = "untouched"
    FAILED = "failed"


class JobStep(Protocol):
    """One pipeline step (`steps/<name>.py`)."""

    @property
    def name(self) -> str: ...

    def run(self, ctx: JobContext) -> StepResult: ...


@contextmanager
def sigterm_raises(flags: RunFlags) -> Iterator[None]:
    """While the run lasts, SIGTERM raises the flag the next checkpoint turns into `InterruptedRunError`."""

    def handler(_signum: int, _frame: FrameType | None) -> None:
        flags.raise_flag(InterruptedRunError)

    previous = signal.signal(signal.SIGTERM, handler)
    try:
        yield
    finally:
        signal.signal(signal.SIGTERM, previous)


@dataclass(frozen=True)
class RunSettings:
    """What tests shorten: the heartbeat's interval."""

    heartbeat_seconds: float | None = None


class JobRunner:
    def __init__(self, config: Config, services: Services, steps: Mapping[str, JobStep], settings: RunSettings | None = None) -> None:
        self._config = config
        self._services = services
        self._steps = steps
        self._settings = settings or RunSettings()
        self._path = f"cities/{config.city_id}/jobs/{config.job_id}"
        self._log = JobLog(services.store, f"{self._path}/logs", services.clock, LOG)

    def _now(self) -> Timestamp:
        return Timestamp.at(self._services.clock())

    def run(self, only: str | None = None) -> RunOutcome:
        """One execution; `only` runs that single step (debugging)."""
        decision = take_lease(self._services.store, self._path, self._config.lease_owner, self._now())
        if not decision.taken:
            LOG.info("job %s not run: %s", self._config.job_id, decision.verdict)
            return RunOutcome.UNTOUCHED
        flags = RunFlags()
        heartbeat = Heartbeat(self._services.store, self._path, self._config.lease_owner, flags, self._services.clock)
        heartbeat.interval = self._settings.heartbeat_seconds or heartbeat.interval
        with tempfile.TemporaryDirectory(prefix=f"hcm-{self._config.job_id}-") as scratch, heartbeat, sigterm_raises(flags):
            return self._leased(decision.record, flags, Path(scratch), only)

    def _leased(self, record: Record, flags: RunFlags, scratch: Path, only: str | None) -> RunOutcome:
        try:
            ctx = self._context(Job.of(self._config.job_id, record), flags, scratch)
        except DocumentError as error:
            return self._fail_job(None, StepFailedError(Errors.INVALID_REQUEST, str(error)))
        return self._guarded(ctx, only)

    def _guarded(self, ctx: JobContext, only: str | None) -> RunOutcome:
        try:
            return self._walk(ctx, only)
        except RunStoppedError as stop:
            return self._stopped(ctx, stop)
        except StepFailedError as error:
            return self._fail_job(ctx, error)
        except Exception as error:  # a crash still ends the job with a code, never a silent lapse
            LOG.exception("job %s crashed in %s", ctx.job.id, ctx.step or "start")
            return self._fail_job(ctx, StepFailedError(Errors.INTERNAL, f"{type(error).__name__}: {error}"))

    def _stopped(self, ctx: JobContext, stop: RunStoppedError) -> RunOutcome:
        if isinstance(stop, LeaseLostError):
            LOG.warning("job %s: another execution holds the lease; stopping without writing", ctx.job.id)
            return RunOutcome.UNTOUCHED
        cancel = isinstance(stop, CancelledRunError) or self._cancel_requested(ctx)
        return self._cancel(ctx) if cancel else self._requeue(ctx)

    def _context(self, job: Job, flags: RunFlags, scratch: Path) -> JobContext:
        params_of(job)
        if job.version_id is None:
            raise DocumentError("the job names no layer version")
        version = self._version(job.version_id)
        return JobContext(self._config, self._services, job, version, scratch, flags, self._log)

    def _version(self, version_id: str) -> Version:
        record = self._services.store.get(f"cities/{self._config.city_id}/layerVersions/{version_id}")
        if record is None:
            raise DocumentError(f"the layer version {version_id} does not exist")
        return Version.of(version_id, record)

    def _cancel_requested(self, ctx: JobContext) -> bool:
        record = self._services.store.get(self._path) or {}
        return ctx.flags.cancel_requested or record.get("cancelRequested") is True

    # --- the step loop ---------------------------------------------------------------------------------

    def _walk(self, ctx: JobContext, only: str | None) -> RunOutcome:
        weights, base = step_weights(ctx.job.type), 0.0
        for name in pipeline_steps_of(ctx.job.type):
            result = self._step(ctx, name, base, weights[name]) if only in (None, name) else Done()
            if isinstance(result, Waiting):
                return self._wait(ctx, name, result)
            base += weights[name]
        return self._finish(ctx) if only is None else self._release(ctx)

    def _finished(self, record: StepRecord) -> bool:
        if record.status not in ("done", "skipped"):
            return False
        info = self._services.objects.stat(record.gcs_path) if record.gcs_path else None
        return record.gcs_path is None or (info is not None and record.generation in (None, info.generation))

    def _step(self, ctx: JobContext, name: str, base: float, weight: float) -> StepResult:
        self._refresh(ctx)
        if self._finished(ctx.job.step(name)):
            return Done()
        ctx.step = name
        ctx.flags.enter(name, base, weight)
        started = self._now()
        ctx.update_job({"step": name, f"steps.{name}": StepRecord("running", started_at=started).as_record(), "progress": round(base, 4)})
        self._log.info(f"step {name} started", name)
        result = self._steps[name].run(ctx)
        if not isinstance(result, Waiting):
            ctx.update_job({f"steps.{name}": _record(result, started, self._now()), "progress": round(base + weight, 4)})
            self._log.info(f"step {name} {'skipped: ' + result.reason if isinstance(result, Skipped) else 'done'}", name)
        return result

    def _refresh(self, ctx: JobContext) -> None:
        """The job and its version as the previous steps left them; stops here when the admin asked to cancel."""
        ctx.checkpoint()
        ctx.job = Job.of(ctx.job.id, self._services.store.get(self._path) or {})
        if ctx.job.cancel_requested:
            raise CancelledRunError("the admin asked to cancel the job")
        ctx.version = self._version(ctx.version.id)

    # --- endings ------------------------------------------------------------------------------------------

    def _final(self, fields: Record) -> None:
        """A write that ends the run, made only while this execution still holds the lease."""
        self._services.store.transact(self._path, owned_change(self._config.lease_owner, {**fields, "lease": DELETE, **stamp(self._now())}))

    def _current(self, name: str) -> StepRecord:
        """The step's record as stored now (with the start this run wrote)."""
        return Job.of(self._config.job_id, self._services.store.get(self._path) or {"type": "-", "status": "-"}).step(name)

    def _pending(self, ctx: JobContext, name: str) -> Record:
        return {f"steps.{name}": StepRecord("pending", started_at=self._current(name).started_at).as_record()}

    def _wait(self, ctx: JobContext, name: str, waiting: Waiting) -> RunOutcome:
        fields: Record = {"status": waiting.status, "waitReason": waiting.reason, **self._pending(ctx, name)}
        self._final({**fields, "retryAt": waiting.retry_at or DELETE})
        self._log.info(waiting.message, name)
        return RunOutcome.WAITING

    def _finish(self, ctx: JobContext) -> RunOutcome:
        self._final({"status": "awaiting_approval", "waitReason": "approval", "progress": 1.0})
        self._log.info("the layer version awaits approval", ctx.step or None)
        return RunOutcome.DONE

    def _release(self, ctx: JobContext) -> RunOutcome:
        self._final({"status": "queued"})
        self._log.info(f"step {ctx.step} run on its own; the job is queued again", ctx.step or None)
        return RunOutcome.DONE

    def _requeue(self, ctx: JobContext) -> RunOutcome:
        self._final({"status": "queued", "retryAt": self._now().plus(REQUEUE_SECONDS), **self._pending(ctx, ctx.step)})
        self._log.warn("stopped by Cloud Run (SIGTERM); the job resumes from its checkpoint", ctx.step or None)
        return RunOutcome.REQUEUED

    def _cancel(self, ctx: JobContext) -> RunOutcome:
        now = self._now()
        self._final({"status": "cancelled", "finishedAt": now})
        self._services.store.update(ctx.version_path(), {"state": "cancelled", **stamp(now)})
        _delete_work(ctx)
        self._log.info("the job was cancelled; its scratch files are deleted", ctx.step or None)
        return RunOutcome.CANCELLED

    def _fail_job(self, ctx: JobContext | None, error: StepFailedError) -> RunOutcome:
        now = self._now()
        failed = {f"steps.{ctx.step}": {**self._current(ctx.step).as_record(), "status": "failed"}} if ctx and ctx.step else {}
        self._final({"status": "failed", "finishedAt": now, "error": _job_error(error), **failed})
        if ctx is not None:
            self._services.store.update(ctx.version_path(), {"state": "failed", "error": _version_error(error), **stamp(now)})
        self._log.error(f"{error.code}: {error}", ctx.step if ctx else None)
        return RunOutcome.FAILED


def _record(result: Done | Skipped, started: Timestamp, finished: Timestamp) -> Record:
    if isinstance(result, Skipped):
        return StepRecord("skipped", started_at=started, finished_at=finished).as_record()
    output = result.output
    return StepRecord(
        "done",
        gcs_path=output.path if output else None,
        generation=output.generation if output else None,
        sha256=result.sha256,
        bytes=output.size if output else None,
        started_at=started,
        finished_at=finished,
    ).as_record()


def _job_error(error: StepFailedError) -> Record:
    message = scrub(str(error))[:ERROR_MESSAGE_MAX]
    return {"code": error.code, "message": message, **({"params": error.params} if error.params else {})}


def _version_error(error: StepFailedError) -> Record:
    return {"code": error.code, **({"params": error.params} if error.params else {})}


def _delete_work(ctx: JobContext) -> None:
    objects = ctx.services.objects
    for info in objects.list(paths.work_prefix(ctx.city, ctx.job.id)):
        objects.delete(info.path)
