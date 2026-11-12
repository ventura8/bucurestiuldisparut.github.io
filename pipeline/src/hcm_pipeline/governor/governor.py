"""The governor's loop (docs/research/M26-governor.md): every `TICK_S` it reads the computer, picks the profile, sizes the budget,
applies it and keeps what `/state` says of this computer (`machine`, `WorkerMachine` of @hcm/shared).

The owner's choice (`POST /profile` from the admin's "This computer" card) is kept in the worker's volume, `governor.json`: it stays on
this computer, never in Firestore, and survives a restart or an update of the worker.
"""

import json
import math
import threading
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Final

from hcm_pipeline.governor.actuate import Actuators, apply_budget
from hcm_pipeline.governor.backends import IMAGES, Backend, Matcher, choose
from hcm_pipeline.governor.budget import Budget, budget_for
from hcm_pipeline.governor.policy import TICK_S, Choice, PolicyState, decide, effective
from hcm_pipeline.governor.probe import Probe
from hcm_pipeline.governor.record import machine_record
from hcm_pipeline.governor.signals import Chosen, Signals, Why
from hcm_pipeline.log import get_logger
from hcm_pipeline.matcher.box import MatcherBudget

LOG = get_logger("governor")
CHOICE_FILE: Final = "governor.json"
CHOICES: Final[dict[object, Chosen]] = {"auto": "auto", "quiet": "quiet", "full": "full"}
# The owner's own thread count (the starter's `HCM_WORKER_THREADS`, passed as `GDAL_NUM_THREADS`): no profile goes above it.
THREADS_ENV: Final = "GDAL_NUM_THREADS"


def owner_threads(env: Mapping[str, str]) -> int | None:
    """The threads the owner set for the worker (a positive number), else None."""
    text = env.get(THREADS_ENV, "")
    return int(text) if text.isdigit() and int(text) > 0 else None


def load_choice(volume: Path) -> Choice:
    """The owner's last choice; auto when there is none (or it is unreadable)."""
    try:
        raw = json.loads((volume / CHOICE_FILE).read_text(encoding="utf-8"))
    except OSError, ValueError:
        return Choice()
    if not isinstance(raw, dict):
        return Choice()
    return Choice(CHOICES.get(raw.get("chosen"), "auto"), raw.get("batteryAllowed") is True)


@dataclass(frozen=True)
class Reading:
    """One tick's outcome."""

    signals: Signals
    policy: PolicyState
    why: Why
    budget: Budget
    backend: Backend


class Governor:
    def __init__(
        self,
        probe: Probe,
        volume: Path,
        actuators: Actuators,
        max_threads: int | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._probe, self._volume, self._actuators, self._clock = probe, volume, actuators, clock
        self._max_threads = max_threads
        self._lock = threading.Lock()
        self._choice = load_choice(volume)
        self._reading: Reading | None = None
        self.images: frozenset[Matcher] = IMAGES
        self.tick_s = TICK_S
        self._cap: float | None = None

    @property
    def choice(self) -> Choice:
        with self._lock:
            return self._choice

    @property
    def budget(self) -> Budget | None:
        with self._lock:
            return None if self._reading is None else self._reading.budget

    def choose(self, chosen: object, battery_allowed: object = None) -> bool:
        """The owner's profile (and, when given, work on a low battery), kept in the volume; False for anything else."""
        found = CHOICES.get(chosen)
        if found is None:
            return False
        with self._lock:
            allowed = battery_allowed if isinstance(battery_allowed, bool) else self._choice.battery_allowed
            self._choice = Choice(found, allowed)
        (self._volume / CHOICE_FILE).write_text(json.dumps({"chosen": found, "batteryAllowed": allowed}), encoding="utf-8")
        LOG.info("the owner chose the %s profile for this computer", found)
        self.tick()
        return True

    def _capped(self, signals: Signals) -> Signals:
        """The cores within the quota the container started with (the slot of a shared machine, a `--cpus` the owner set): the starter's
        own `docker update` comes later and only lowers it, so the first quota read is the cap, never one of ours."""
        if self._cap is None:
            self._cap = signals.cpu.quota or float(signals.cpu.cores)
        cores = max(1, min(signals.cpu.cores, math.floor(self._cap)))
        return replace(signals, cpu=replace(signals.cpu, cores=cores))

    def _owners(self, budget: Budget) -> Budget:
        """The budget within the owner's own thread count, when there is one."""
        cap = self._max_threads
        if cap is None or budget.threads <= cap:
            return budget
        return replace(budget, threads=cap, tile_processes=min(budget.tile_processes, cap))

    def _read(self, before: PolicyState) -> Reading:
        signals = self._capped(self._probe.read())
        policy = decide(signals, self.choice, before, self._clock())
        profile, why = effective(policy)
        budget = self._owners(budget_for(profile, signals))
        backend = choose(signals, budget, self.images)
        return Reading(signals, policy, "gpu-busy" if why == "idle" and backend.why == "gpu-busy" else why, budget, backend)

    def tick(self) -> Reading:
        """One reading, applied."""
        with self._lock:
            before = self._reading
        reading = self._read(PolicyState() if before is None else before.policy)
        if before is None or before.budget != reading.budget:
            LOG.info(
                "this computer: %s (%s), %d threads, %d MB",
                reading.budget.profile,
                reading.why,
                reading.budget.threads,
                reading.budget.memory_mb,
            )
            apply_budget(reading.budget, self._actuators)
        self._gate(reading.budget.profile == "paused")
        with self._lock:
            self._reading = reading
        return reading

    def _gate(self, paused: bool) -> None:
        gate = self._actuators.gate
        if paused:
            gate.pause()
        else:
            gate.resume()

    def matcher_budget(self) -> MatcherBudget:
        """Each matcher request's budget: the profile's threads and keypoints, the card's share, or the card left alone."""
        with self._lock:
            reading = self._reading
        if reading is None:
            return MatcherBudget()
        budget, backend = reading.budget, reading.backend
        held = backend.matcher == "cpu" and backend.why == "gpu-busy"
        return MatcherBudget(budget.threads, budget.keypoints or 1, backend.gpu_fraction, held)

    def machine(self) -> dict[str, object] | None:
        """`/state`'s `machine`; None before the first tick."""
        with self._lock:
            reading, choice = self._reading, self._choice
        if reading is None:
            return None
        return machine_record(reading.signals, replace(reading.policy, why=reading.why), choice.chosen, reading.budget, reading.backend)

    def run(self, stop: threading.Event) -> None:
        """Ticks until `stop`; a fault in one tick is logged and the next one tries again."""
        while not stop.is_set():
            try:
                self.tick()
            except (OSError, ValueError) as error:
                LOG.warning("the governor's tick failed: %s", error)
            stop.wait(self.tick_s)
