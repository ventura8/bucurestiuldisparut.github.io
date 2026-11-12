"""The governor's loop, the owner's choice, the gate and `/state`'s machine (docs/research/M26-governor.md §4, §6)."""

import json
import threading
from dataclasses import dataclass, field, replace
from pathlib import Path

import pytest
from hcm_pipeline.governor.actuate import Actuators, Gate, apply_gdal, lower_priority
from hcm_pipeline.governor.budget import budget_for
from hcm_pipeline.governor.governor import CHOICE_FILE, Governor, load_choice
from hcm_pipeline.governor.policy import Choice
from hcm_pipeline.governor.signals import Power, Signals
from hcm_pipeline.matcher.box import MatcherBudget

from tests.fakes.machines import LINUX_INTEL_ARC_NPU, LINUX_NVIDIA_CDI, SMALL_NO_GPU
from tests.fakes.world import FakeClock


@dataclass
class FakeProbe:
    signals: Signals
    fail: bool = False

    def read(self) -> Signals:
        if self.fail:
            raise OSError("gone")
        return self.signals


@dataclass
class Options:
    set: dict[str, str] = field(default_factory=dict)

    def __call__(self, key: str, value: str) -> None:
        self.set[key] = value


def _governor(tmp_path: Path, signals: Signals, clock: FakeClock | None = None) -> tuple[Governor, FakeProbe, Options, Gate]:
    probe, options, gate = FakeProbe(signals), Options(), Gate()
    return Governor(probe, tmp_path, Actuators(options, gate), clock or FakeClock()), probe, options, gate


def test_a_tick_applies_the_budget_and_says_the_machine(tmp_path: Path) -> None:
    clock = FakeClock()
    governor, probe, options, _gate = _governor(tmp_path, LINUX_NVIDIA_CDI, clock)
    assert governor.machine() is None
    assert governor.budget is None
    governor.tick()
    options.set.clear()
    governor.tick()
    assert options.set == {}
    governor.tick()
    probe.signals = replace(LINUX_NVIDIA_CDI, idle_s=0.0)
    governor.tick()
    assert options.set == {"GDAL_NUM_THREADS": "4", "GDAL_CACHEMAX": "2015"}
    probe.signals = LINUX_NVIDIA_CDI
    governor.tick()
    clock.now += 1000.0
    governor.tick()
    assert options.set == {"GDAL_NUM_THREADS": "14", "GDAL_CACHEMAX": "3456"}
    assert governor.machine() == {
        "cpu": {"cores": 16},
        "memory": {"totalMb": 30_720, "availableMb": 23_040},
        "power": {"source": "ac"},
        "gpus": [{"vendor": "nvidia", "name": "NVIDIA GeForce RTX 3080 Laptop GPU", "vramMb": 8192, "via": "cuda"}],
        "npus": [],
        "backend": {"matcher": "cuda"},
        "profile": {"chosen": "auto", "active": "full", "why": "idle"},
        "budget": {"threads": 14, "memoryMb": 13_824, "gpuFraction": 0.7},
        "usage": {"cpuPct": 0.0, "othersCpuPct": 0.0, "memoryMb": 0, "vramMb": 0},
    }


def test_the_nuc_says_its_npu(tmp_path: Path) -> None:
    governor, *_ = _governor(tmp_path, LINUX_INTEL_ARC_NPU)
    governor.tick()
    machine = governor.machine()
    assert machine is not None
    assert machine["npus"] == [{"vendor": "intel", "name": "Core Ultra NPU", "via": "openvino"}]
    assert machine["backend"] == {"matcher": "cpu", "why": "no-image"}


def test_the_owners_choice_is_kept_in_the_volume(tmp_path: Path) -> None:
    governor, *_ = _governor(tmp_path, SMALL_NO_GPU)
    assert not governor.choose("turbo")
    assert governor.choose("quiet", battery_allowed=True)
    assert json.loads((tmp_path / CHOICE_FILE).read_text(encoding="utf-8")) == {"chosen": "quiet", "batteryAllowed": True}
    assert governor.choose("full")
    assert load_choice(tmp_path) == Choice("full", battery_allowed=True)
    machine = governor.machine()
    assert machine is not None
    assert machine["profile"] == {"chosen": "full", "active": "full", "why": "owner"}


@pytest.mark.parametrize("text", ["{", "[]", '{"chosen": "x"}'])
def test_an_unreadable_choice_is_auto(tmp_path: Path, text: str) -> None:
    (tmp_path / CHOICE_FILE).write_text(text, encoding="utf-8")
    assert load_choice(tmp_path) == Choice()


def test_a_low_battery_closes_the_gate_and_the_mains_opens_it(tmp_path: Path) -> None:
    low = replace(LINUX_NVIDIA_CDI, power=Power("battery", 10))
    governor, probe, _options, gate = _governor(tmp_path, low)
    governor.tick()
    assert gate.paused
    machine = governor.machine()
    assert machine is not None
    assert machine["backend"] == {"matcher": "off", "why": "paused"}
    probe.signals = LINUX_NVIDIA_CDI
    governor.tick()
    assert not gate.paused


def test_a_busy_card_says_why_and_the_matcher_leaves_it(tmp_path: Path) -> None:
    busy = replace(LINUX_NVIDIA_CDI, gpus=(replace(LINUX_NVIDIA_CDI.gpus[0], others_mb=7000, busy_pct=83, temp_c=81.0),))
    governor, *_ = _governor(tmp_path, busy)
    assert governor.matcher_budget() == MatcherBudget()
    governor.tick()
    assert governor.matcher_budget() == MatcherBudget(14, 2048, 0.0, yield_gpu=True)
    machine = governor.machine()
    assert machine is not None
    assert machine["profile"] == {"chosen": "auto", "active": "full", "why": "gpu-busy"}
    assert machine["usage"] == {"cpuPct": 0.0, "othersCpuPct": 0.0, "memoryMb": 0, "gpuPct": 83, "vramMb": 7000}


@dataclass
class StoppingProbe:
    """Fails once, then reads and stops the loop."""

    stop: threading.Event
    reads: int = 0

    def read(self) -> Signals:
        self.reads += 1
        if self.reads == 1:
            raise OSError("gone")
        self.stop.set()
        return SMALL_NO_GPU


def test_the_loop_ticks_until_stopped_and_survives_a_fault(tmp_path: Path) -> None:
    stop = threading.Event()
    probe = StoppingProbe(stop)
    governor = Governor(probe, tmp_path, Actuators(Options(), Gate()), lambda: 0.0)
    governor.tick_s = 0.0
    governor.run(stop)
    assert probe.reads == 2
    assert governor.machine() is not None


def test_the_gate_holds_until_resumed_or_stopped() -> None:
    times = iter([0.0, 7.0])
    gate = Gate(lambda: next(times))
    assert gate.hold(lambda: False) == 7.0
    gate.pause()
    gate.pause()
    stops = iter([False, True])
    assert Gate().hold(lambda: True) >= 0.0
    waited = Gate()
    waited.pause()
    assert waited.hold(lambda: next(stops)) >= 0.0
    threading.Timer(0.05, waited.resume).start()
    waited.hold(lambda: False)
    assert not waited.paused
    waited.resume()


def test_priority_and_gdal_settings() -> None:
    commands: list[list[str]] = []

    def refused(_value: int) -> int:
        raise OSError("not permitted")

    lower_priority(refused, commands.append, lambda _name: "/usr/bin/ionice")
    assert commands[0][1:3] == ["-c", "3"]
    lower_priority(lambda value: value, commands.append, lambda _name: None)
    assert len(commands) == 1
    options = Options()
    apply_gdal(budget_for("paused", SMALL_NO_GPU), options)
    assert options.set == {}
