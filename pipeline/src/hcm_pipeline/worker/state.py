"""What the local page shows (`GET /state`, docs/research/M7-local-worker.md §2.1, §10.3): the account signed in (its
e-mail only, never a token), the city, idle or the job and its step, and the last error; and what `worker.hello`
answered (how often to claim, how often the heartbeat writes). Thread-safe: the page's server reads it while the loop
writes it.
"""

import threading
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Final

from hcm_pipeline.log import get_logger
from hcm_pipeline.worker.session import Session

LOG = get_logger("worker.state")

# `WORKER_POLL_SECONDS` of @hcm/shared, until `worker.hello` answers its own.
DEFAULT_POLL_SECONDS: Final = 30.0


@dataclass
class Timing:
    """`worker.hello`'s answer: the claim interval and the heartbeat's (None: the runner's own)."""

    poll_seconds: float = DEFAULT_POLL_SECONDS
    heartbeat_seconds: float | None = None


class WorkerState:
    def __init__(self, city: str, project: str, session: Session) -> None:
        self._city = city
        self._project = project
        self._session = session
        self._lock = threading.Lock()
        self._job: str | None = None
        self._step: str | None = None
        self._error: str | None = None
        self._outdated = False
        self.timing = Timing()

    def busy(self, job_id: str) -> None:
        with self._lock:
            self._job, self._step, self._error = job_id, None, None

    def idle(self) -> None:
        with self._lock:
            self._job, self._step = None, None

    def failed(self, code: str | None) -> None:
        """The last error the page shows (an `apiError.*` code), or none."""
        with self._lock:
            self._error = code

    def outdated(self, outdated: bool) -> None:
        """Finding 67: whether this worker's image is no longer the installed pipeline's (it takes no job until updated)."""
        with self._lock:
            if outdated and not self._outdated:
                LOG.warning(
                    "the imagery pipeline was updated in the admin: this computer runs an older image and takes no job; "
                    "copy the command from the admin (Jobs, Your computer) and run it to update"
                )
            self._outdated = outdated

    def observe(self, path: str, fields: Mapping[str, object]) -> None:
        """A document write of the run: the job's `step` becomes the page's step line."""
        step = fields.get("step")
        with self._lock:
            if self._job is not None and path.endswith(f"/jobs/{self._job}") and isinstance(step, str):
                self._step = step

    def _phase(self) -> str:
        if not self._session.active:
            return "signed-out"
        return "idle" if self._job is None else "busy"

    def snapshot(self) -> dict[str, object]:
        with self._lock:
            return {
                "signedIn": self._session.active,
                "email": self._session.email,
                "city": self._city,
                "project": self._project,
                "state": self._phase(),
                "jobId": self._job,
                "step": self._step,
                "lastError": self._error or self._session.ended_because,
                "outdated": self._outdated,
            }
