"""The worker's loop (docs/research/M7-local-worker.md §1.2).

While a session is held: `worker.claim {cityId, workerId}` every `pollSeconds` (which also tells the server the worker
is alive); a claimed job runs at once, one at a time, with the normal runner (`runtime.py`); then `worker.end` reports
`done` whatever state the run left the job in, or `failed` with the error when the run crashed outside a step (the
server fails the job if the worker still holds it). A job the server says this worker no longer holds, or a session
that ended, stops the run where it is without another write (a lost lease to the runner). SIGTERM or Ctrl-C: between
jobs the loop ends; during a run the step stops at its next checkpoint and the job goes back to `queued` (the runner's
path), then the loop ends; the process exits 0. One signal is enough at any moment: the runner's handler tells the
loop's (a signal after the run's last checkpoint was once lost), and the loop's takes no lock (docs/LESSONS.md 342).
Finding 67 of 2026-11-02: without a session each pass first lets the connector try (the command's pairing code, or the
session kept in the work folder); a call answered `apiError.worker.revoked` (Disconnect this computer) ends the session
and deletes the kept one; a claim answered `outdated` (the pipeline was updated in the admin) is said on the page.
Finding 72 (the starter file, M7 §1.5): under the starter's supervisor (`supervised`) an outdated claim ends the loop
instead (`outdated_exit`), and the command exits with `ExitCode.OUTDATED`, so the supervisor pulls the installed image.
"""

import enum
import signal
import threading
import time
from collections.abc import Callable, Iterator, Mapping
from contextlib import contextmanager
from dataclasses import dataclass
from types import FrameType
from typing import Final, Protocol

from hcm_pipeline.contract import Errors
from hcm_pipeline.joblog import scrub
from hcm_pipeline.jobs import LeaseLostError, RunStoppedError
from hcm_pipeline.log import get_logger
from hcm_pipeline.paths import ID
from hcm_pipeline.runner import STOP_SIGNALS, RunOutcome
from hcm_pipeline.worker.api import CLAIM, END, REVOKED, RevokedError, WorkerApi, WorkerApiError
from hcm_pipeline.worker.session import RefreshUnavailableError, Session
from hcm_pipeline.worker.state import WorkerState

LOG = get_logger("worker.loop")
# What a call to the server may raise besides answering: a refusal, the job lost or the session ended, Google's token
# service out of reach.
CALL_ERRORS: Final = (WorkerApiError, LeaseLostError, RefreshUnavailableError)
# How often a worker without a session looks again (the page's sign-in wakes it sooner).
NO_SESSION_SECONDS: Final = 1.0
ERROR_MESSAGE_MAX: Final = 2000
# The longest a wait goes without looking at the signal's flag: the handler sets it without waking the wait.
SIGNAL_CHECK_SECONDS: Final = 0.25


class Pass(enum.Enum):
    """What one pass of the loop did."""

    NO_SESSION = "no-session"
    IDLE = "idle"
    RAN = "ran"
    INTERRUPTED = "interrupted"


class JobRunning(Protocol):
    def run(self, job_id: str, asked_to_stop: Callable[[], bool]) -> RunOutcome: ...


class Connecting(Protocol):
    """Signs the worker in without the page (`pairing.Connector`)."""

    def attempt(self) -> None: ...

    def forget(self) -> None: ...


class NoConnector:
    """A worker without a pairing code or kept session: only the page signs it in."""

    def attempt(self) -> None:
        return None

    def forget(self) -> None:
        return None


@dataclass(frozen=True)
class Ending:
    """What `worker.end` reports."""

    outcome: str
    error: dict[str, str] | None = None

    @classmethod
    def crashed(cls, error: Exception) -> Ending:
        message = scrub(f"{type(error).__name__}: {error}")[:ERROR_MESSAGE_MAX]
        return cls("failed", {"code": Errors.PROCESSING_FAILED, "message": message})


DONE: Final = Ending("done")


def _job_of(answer: Mapping[str, object]) -> str | None:
    """The claimed job's id, when the answer names one of the right shape."""
    job = answer.get("job")
    job_id = job.get("jobId") if isinstance(job, dict) else None
    return job_id if isinstance(job_id, str) and ID.fullmatch(job_id) else None


class WorkerLoop:
    def __init__(self, session: Session, api: WorkerApi, state: WorkerState, runtime: JobRunning, ids: dict[str, str]) -> None:
        self._session = session
        self._connector: Connecting = NoConnector()
        self._api = api
        self._state = state
        self._runtime = runtime
        self._ids = ids
        self.stopping = threading.Event()
        # Set by the signal handler alone: one assignment, no lock (`_stopped` turns it into `stopping`).
        self._signalled = False
        self.no_session_seconds = NO_SESSION_SECONDS
        # Finding 72: under the starter's supervisor an outdated image ends the loop (the supervisor updates it).
        self.supervised = False
        self.outdated_exit = False

    def connect_with(self, connector: Connecting) -> None:
        """The connector each pass without a session lets try first (finding 67: pairing, the kept session)."""
        self._connector = connector

    def stop(self) -> None:
        self.stopping.set()

    def run(self) -> None:
        """Passes until a signal (or `stop`) ends the loop."""
        with self._signals():
            while not self._stopped():
                self._pause(self.run_once())

    def _asked_to_stop(self) -> bool:
        """A signal or `stop` (read without a lock: the run asks at every checkpoint, from any thread)."""
        return self._signalled or self.stopping.is_set()

    def _stopped(self) -> bool:
        if self._signalled:
            self.stop()
        return self.stopping.is_set()

    def _pause(self, done: Pass) -> None:
        if done is Pass.INTERRUPTED:
            self.stop()
        elif done is not Pass.RAN:
            self._wait(self.no_session_seconds if done is Pass.NO_SESSION else self._state.timing.poll_seconds)

    def _wait(self, seconds: float) -> None:
        """Until `seconds` passed or the loop stops, looking at the signal's flag every `SIGNAL_CHECK_SECONDS`."""
        deadline = time.monotonic() + seconds
        while not self._stopped() and (left := deadline - time.monotonic()) > 0:
            self.stopping.wait(min(left, SIGNAL_CHECK_SECONDS))

    def _on_signal(self, _signum: int, _frame: FrameType | None) -> None:
        """SIGTERM or Ctrl-C. No lock here: Python runs a handler in the main thread between two bytecodes, also while
        that thread holds `stopping`'s own lock inside `wait`, and `Event.set` would then wait for itself forever."""
        self._signalled = True

    @contextmanager
    def _signals(self) -> Iterator[None]:
        """SIGTERM and SIGINT end the loop (handlers only in the main thread, where Python delivers signals)."""
        if threading.current_thread() is not threading.main_thread():
            yield
            return
        previous = {number: signal.signal(number, self._on_signal) for number in STOP_SIGNALS}
        try:
            yield
        finally:
            for number, before in previous.items():
                signal.signal(number, before)

    def run_once(self) -> Pass:
        """One pass: nothing without a session (the connector tries first); else a claim, and the claimed job's run."""
        if not self._session.active:
            self._connector.attempt()
        if not self._session.active:
            return Pass.NO_SESSION
        job_id = self._claim()
        return Pass.IDLE if job_id is None else self._work(job_id)

    def _claim(self) -> str | None:
        try:
            answer = self._api.call(CLAIM, self._ids)
        except CALL_ERRORS as error:
            LOG.warning("worker.claim failed: %s", error)
            self._refused(error)
            return None
        self._state.outdated(answer.get("outdated") is True)
        return None if self._ends_outdated() else _job_of(answer)

    def _ends_outdated(self) -> bool:
        """Under the starter's supervisor, an outdated image ends the loop (finding 72); true when it did."""
        if not (self.supervised and self._state.is_outdated):
            return False
        LOG.warning("this image is older than the installed pipeline's: stopping, so the supervisor starts the new one")
        self.outdated_exit = True
        self.stop()
        return True

    def _work(self, job_id: str) -> Pass:
        LOG.info("claimed job %s", job_id)
        self._state.busy(job_id)
        outcome, ending = self._run(job_id)
        self._state.idle()
        self._end(job_id, ending)
        return Pass.INTERRUPTED if outcome is RunOutcome.REQUEUED else Pass.RAN

    def _run(self, job_id: str) -> tuple[RunOutcome, Ending]:
        try:
            return self._runtime.run(job_id, self._asked_to_stop), DONE
        except RunStoppedError as stop:
            LOG.warning("job %s stopped without another write: %s", job_id, stop)
            return RunOutcome.UNTOUCHED, DONE
        except Exception as error:  # a crash outside a step: the server fails the job if this worker still holds it
            LOG.exception("job %s crashed outside a step", job_id)
            self._state.failed(Errors.PROCESSING_FAILED)
            return RunOutcome.FAILED, Ending.crashed(error)

    def _end(self, job_id: str, ending: Ending) -> None:
        if not self._session.active:
            LOG.warning("job %s ended without a session: worker.end cannot be sent", job_id)
            return
        report: dict[str, object] = {**self._ids, "jobId": job_id, "outcome": ending.outcome}
        try:
            self._api.call(END, {**report, **({"error": ending.error} if ending.error else {})})
        except CALL_ERRORS as error:
            LOG.warning("worker.end failed: %s", error)
            self._refused(error)

    def _refused(self, error: Exception) -> None:
        """The page's last error; Disconnect this computer also ends the session and deletes the kept one."""
        self._state.failed(getattr(error, "code", None))
        if isinstance(error, RevokedError):
            LOG.warning("this computer was disconnected in the admin; run the admin's command again to reconnect it")
            self._session.end(REVOKED)
            self._connector.forget()
