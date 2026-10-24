"""What a pipeline step runs with and returns (docs/research/M3-interfaces.md §5.2).

A step gets a `JobContext` (the configuration, the services, the job and its layer version, a scratch folder,
the run's flags and the job log) and returns `Done` (with its recorded output), `Skipped` (the job does not need
it) or `Waiting` (the job waits on USGS or on the admin's points; the run then exits 0), or raises
`StepFailedError` with an `apiError.*` code. Long work calls `ctx.checkpoint()` (and passes `ctx.gdal_progress`
to GDAL) so a SIGTERM, a cancellation or a lost lease stops it at the next checkpoint.
"""

import threading
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Final, Protocol

import httpx

from hcm_pipeline import paths
from hcm_pipeline.config import Config
from hcm_pipeline.documents import Version
from hcm_pipeline.joblog import JobLog
from hcm_pipeline.m2m import M2MClient
from hcm_pipeline.model import Job, Record, Timestamp, stamp
from hcm_pipeline.objects import ObjectInfo, ObjectStore
from hcm_pipeline.osm import OverpassClient
from hcm_pipeline.secrets import SecretSource
from hcm_pipeline.stac import StacClient
from hcm_pipeline.store import DocumentStore
from hcm_pipeline.urlguard import Resolver

GDAL_CONTINUE: Final = 1
GDAL_ABORT: Final = 0
ParamValue = str | int


class StepFailedError(Exception):
    """A failure the step understands: the job fails with `code` (an `apiError.*` code) and its `params`."""

    def __init__(self, code: str, message: str, params: Mapping[str, ParamValue] | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.params = dict(params or {})


class RunStoppedError(Exception):
    """The run must stop at this checkpoint."""


class InterruptedRunError(RunStoppedError):
    """SIGTERM (Cloud Run's cancel, the task timeout): keep the work, or cancel when the admin asked to."""


class CancelledRunError(RunStoppedError):
    """The admin set `cancelRequested`."""


class LeaseLostError(RunStoppedError):
    """Another execution holds the lease now: stop without writing anything."""


@dataclass(frozen=True)
class Done:
    """The step's work is complete; `output` is the object it recorded (skipped next time while it exists)."""

    output: ObjectInfo | None = None
    sha256: str | None = None


@dataclass(frozen=True)
class Skipped:
    """The job does not need this step (an upload with its own georeference skips `reference` and `georef`)."""

    reason: str


@dataclass(frozen=True)
class Waiting:
    """The job waits: on USGS (`waiting_usgs`, until `retry_at`) or on the admin's points (`awaiting_gcps`)."""

    status: str
    reason: str
    message: str
    retry_at: Timestamp | None = None


StepResult = Done | Skipped | Waiting


class RunFlags:
    """Thread-safe flags the SIGTERM handler and the heartbeat raise, and the progress the heartbeat writes."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._stop: type[RunStoppedError] | None = None
        self.cancel_requested = False
        self.step: str | None = None
        self.base_progress = 0.0
        self.step_weight = 0.0
        self.step_fraction = 0.0

    def raise_flag(self, stop: type[RunStoppedError]) -> None:
        with self._lock:
            if self._stop is not LeaseLostError:
                self._stop = stop
        if stop is CancelledRunError:
            self.cancel_requested = True

    @property
    def stopping(self) -> type[RunStoppedError] | None:
        with self._lock:
            return self._stop

    def check(self) -> None:
        stop = self.stopping
        if stop is not None:
            raise stop(f"the run stops: {stop.__name__}")

    def gdal_progress(self, complete: float, _message: str, _data: object) -> int:
        """GDAL's progress callback: 0 makes GDAL stop (and raise) when the run must stop."""
        self.progress_within(complete)
        return GDAL_ABORT if self.stopping is not None else GDAL_CONTINUE

    def progress_within(self, fraction: float) -> None:
        """How far the running step is (0 to 1): the heartbeat adds that share of its weight to the job's progress."""
        with self._lock:
            self.step_fraction = max(0.0, min(1.0, fraction))

    def enter(self, step: str, base: float, weight: float) -> None:
        with self._lock:
            self.step, self.base_progress, self.step_weight, self.step_fraction = step, base, weight, 0.0

    @property
    def progress(self) -> float:
        with self._lock:
            return round(min(1.0, self.base_progress + self.step_weight * self.step_fraction), 4)


class M2MFactory(Protocol):
    def __call__(self) -> M2MClient: ...


@dataclass
class Services:
    """The adapters a run uses (real ones from `services.build`, fakes in the tests)."""

    store: DocumentStore
    objects: ObjectStore
    secrets: SecretSource
    m2m: M2MFactory
    downloads: httpx.Client
    stac: StacClient
    overpass: OverpassClient
    clock: Callable[[], float]
    sleep: Callable[[float], None]
    resolver: Resolver


@dataclass
class JobContext:
    """Everything a step runs with."""

    config: Config
    services: Services
    job: Job
    version: Version
    workdir: Path
    flags: RunFlags
    log: JobLog
    step: str = ""
    staged: dict[str, Path] = field(default_factory=dict)

    def now(self) -> Timestamp:
        return Timestamp.at(self.services.clock())

    def checkpoint(self) -> None:
        self.flags.check()

    @property
    def city(self) -> str:
        return self.config.city_id

    def job_path(self) -> str:
        return f"cities/{self.city}/jobs/{self.job.id}"

    def version_path(self, version_id: str | None = None) -> str:
        return f"cities/{self.city}/layerVersions/{version_id or self.version.id}"

    def version_file(self, name: str) -> str:
        return paths.version(self.city, self.version.layer_id, self.version.id, name)

    def work_file(self, name: str) -> str:
        return paths.work(self.city, self.job.id, name)

    def local(self, name: str) -> Path:
        path = self.workdir / name
        path.parent.mkdir(parents=True, exist_ok=True)
        return path

    def stage(self, object_path: str, name: str | None = None) -> Path:
        """The object downloaded into the scratch folder (once per run)."""
        if object_path not in self.staged:
            local = self.local(name or object_path.replace("/", "_"))
            self.services.objects.download_file(object_path, local)
            self.staged[object_path] = local
        return self.staged[object_path]

    def publish(self, local: Path, object_path: str, content_type: str) -> ObjectInfo:
        """A local file uploaded create-only (an identical object already there is kept)."""
        self.checkpoint()
        return self.services.objects.upload_file(local, object_path, content_type)

    def update_version(self, fields: Mapping[str, object]) -> None:
        self.services.store.update(self.version_path(), {**fields, **stamp(self.now())})

    def update_job(self, fields: Mapping[str, object]) -> None:
        self.services.store.update(self.job_path(), {**fields, **stamp(self.now())})

    def read(self, path: str) -> Record | None:
        return self.services.store.get(path)
