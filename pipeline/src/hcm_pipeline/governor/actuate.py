"""The budget applied (docs/research/M26-governor.md §4): inside the worker's process; the starter applies the container's CPU quota.

- At start, `lower_priority`: nice 10 and the idle I/O class, so the person's programs always go first, whatever the budget.
- At each change, `apply_gdal`: GDAL's thread count (also the tile step's `num-threads`) and its block cache.
- `Gate`: paused, a running step's next checkpoint or GDAL progress call waits until the profile allows work again. Its memory stays
  held, its processor time drops to nothing, and the time it waited is added to the step's time limit (`jobs.RunFlags`).
- Outside: the starter (`hcm-worker.sh`, `.bat`) runs `docker update --cpus <threads>` when the budget's threads change; the cgroup's
  `cpu.max` the probe reads back is the proof it took.
"""

import os
import shutil
import subprocess
import threading
import time
from collections.abc import Callable
from typing import Final

from hcm_pipeline.governor.budget import Budget
from hcm_pipeline.log import get_logger

LOG = get_logger("governor.actuate")
NICENESS: Final = 10
IDLE_IO_CLASS: Final = "3"
WAIT_S: Final = 1.0
THREADS_OPTION: Final = "GDAL_NUM_THREADS"
CACHE_OPTION: Final = "GDAL_CACHEMAX"


def lower_priority(
    nice: Callable[[int], int] = os.nice,
    run: Callable[[list[str]], object] = lambda command: subprocess.run(command, check=False, capture_output=True),
    which: Callable[[str], str | None] = shutil.which,
) -> None:
    """Nice 10, and the idle I/O class when `ionice` is there (a priority only: nothing fails without it)."""
    try:
        nice(NICENESS)
    except OSError as error:
        LOG.warning("the worker could not lower its priority: %s", error)
    ionice = which("ionice")
    if ionice is not None:
        run([ionice, "-c", IDLE_IO_CLASS, "-p", str(os.getpid())])


def apply_gdal(budget: Budget, set_option: Callable[[str, str], None]) -> None:
    """GDAL's threads and cache under the budget; a paused budget leaves them (the step waits at the gate instead)."""
    if budget.threads == 0:
        return
    set_option(THREADS_OPTION, str(budget.threads))
    set_option(CACHE_OPTION, str(budget.gdal_cache_mb))


class Gate:
    """Open while work is allowed; `hold` waits while it is closed, unless the run must stop."""

    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self._open = threading.Event()
        self._open.set()
        self._clock = clock

    @property
    def paused(self) -> bool:
        return not self._open.is_set()

    def pause(self) -> None:
        if not self.paused:
            LOG.info("the worker pauses: the running step waits until this computer has room again")
        self._open.clear()

    def resume(self) -> None:
        if self.paused:
            LOG.info("the worker resumes")
        self._open.set()

    def hold(self, stopping: Callable[[], bool]) -> float:
        """Seconds waited at the gate (0 when it was open)."""
        started = self._clock()
        while self.paused and not stopping():
            self._open.wait(WAIT_S)
        return self._clock() - started


# The process's gate: the worker's governor closes it, every run's checkpoints wait at it.
GATE: Final = Gate()
