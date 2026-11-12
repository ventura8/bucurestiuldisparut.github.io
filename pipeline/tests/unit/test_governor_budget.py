"""The governor's budget and the matcher's place on every system it may meet (docs/research/M26-governor.md §4, §5)."""

from dataclasses import replace

import pytest
from hcm_pipeline.governor.backends import Backend, Matcher, choose
from hcm_pipeline.governor.budget import GPU_FRACTION, MEMORY_SHARE, budget_for, gpu_room, reserve
from hcm_pipeline.governor.signals import Cpu, Gpu, Memory, Profile, Signals, Usage
from hypothesis import given, settings
from hypothesis import strategies as st

from tests.fakes.machines import (
    LINUX_AMD_ROCM,
    LINUX_INTEL_ARC_NPU,
    LINUX_NVIDIA_CDI,
    MAC_APPLE_SILICON,
    SMALL_NO_GPU,
    WINDOWS_ARM_QUALCOMM,
    WSL2_NVIDIA,
)

PROFILES: tuple[Profile, ...] = ("full", "quiet", "paused")


def test_the_laptop_full_and_quiet() -> None:
    full = budget_for("full", LINUX_NVIDIA_CDI)
    assert (full.threads, full.memory_mb, full.gpu_fraction, full.keypoints) == (14, 13_824, 0.7, 2048)
    assert full.gdal_cache_mb == full.warp_mb == 3456
    assert full.tile_processes == 14
    quiet = budget_for("quiet", LINUX_NVIDIA_CDI)
    assert (quiet.threads, quiet.gpu_fraction, quiet.keypoints) == (4, 0.4, 1024)
    assert budget_for("paused", LINUX_NVIDIA_CDI).as_record() == {"threads": 0, "memoryMb": 0, "gpuFraction": 0.0}


def test_a_small_computer_keeps_one_core_and_few_tile_processes() -> None:
    full = budget_for("full", SMALL_NO_GPU)
    assert (full.threads, full.memory_mb, full.tile_processes) == (1, 1843, 1)
    assert budget_for("quiet", SMALL_NO_GPU).threads == 1


def test_the_container_limit_caps_memory() -> None:
    limited = replace(SMALL_NO_GPU, memory=Memory(4096, 3072, 1000))
    assert budget_for("full", limited).memory_mb == 1000


@settings(max_examples=100, deadline=None)
@given(st.integers(1, 256), st.integers(512, 1 << 20), st.floats(0, 1), st.integers(0, 4096), st.sampled_from(PROFILES))
def test_the_budget_stays_within_its_bounds(cores: int, total: int, free: float, ours: int, profile: Profile) -> None:
    signals = Signals(Cpu(cores), Memory(total, int(total * free)), usage=Usage(memory_mb=ours))
    budget = budget_for(profile, signals)
    if profile != "paused":
        assert 1 <= budget.threads <= max(1, cores - reserve(cores))
    assert budget.memory_mb <= (int(total * free) + ours) * MEMORY_SHARE[profile]
    assert 0 <= budget.gpu_fraction <= GPU_FRACTION["full"] <= 0.7
    assert budget.tile_processes <= max(budget.threads, 0)


@pytest.mark.parametrize(
    ("signals", "expected"),
    [
        (LINUX_NVIDIA_CDI, Backend("cuda", None, 0.7)),
        (LINUX_AMD_ROCM, Backend("cpu", "no-image")),
        (LINUX_INTEL_ARC_NPU, Backend("cpu", "no-image")),
        (SMALL_NO_GPU, Backend("cpu", "no-gpu")),
        (WSL2_NVIDIA, Backend("cuda", None, 0.7)),
        (WINDOWS_ARM_QUALCOMM, Backend("cpu", "no-passthrough")),
        (MAC_APPLE_SILICON, Backend("cpu", "no-passthrough")),
    ],
)
def test_the_matcher_goes_where_this_release_can_run_it(signals: Signals, expected: Backend) -> None:
    assert choose(signals, budget_for("full", signals)) == expected


def test_with_their_images_rocm_openvino_and_the_npu_are_chosen_in_order() -> None:
    every: frozenset[Matcher] = frozenset({"cuda", "rocm", "openvino-gpu", "openvino-npu", "cpu"})
    assert choose(LINUX_AMD_ROCM, budget_for("full", LINUX_AMD_ROCM), every).matcher == "rocm"
    arc = budget_for("full", LINUX_INTEL_ARC_NPU)
    assert choose(LINUX_INTEL_ARC_NPU, arc, every) == Backend("openvino-gpu", None, 0.7)
    npu_only = replace(LINUX_INTEL_ARC_NPU, gpus=())
    assert choose(npu_only, arc, every).matcher == "openvino-npu"
    both = replace(LINUX_AMD_ROCM, gpus=(*LINUX_AMD_ROCM.gpus, *LINUX_NVIDIA_CDI.gpus))
    assert choose(both, budget_for("full", both), every).matcher == "cuda"


def test_a_busy_card_yields_to_the_processor() -> None:
    """The laptop on 2026-11-12: someone else's work held 6.4 of its 8 GB.

    Scenarios: S-A132-BAD-NO-GPU
    """
    busy = replace(LINUX_NVIDIA_CDI.gpus[0], others_mb=6400)
    signals = replace(LINUX_NVIDIA_CDI, gpus=(busy,))
    assert choose(signals, budget_for("full", signals)) == Backend("cpu", "gpu-busy")
    some = replace(busy, others_mb=4000)
    assert choose(replace(signals, gpus=(some,)), budget_for("full", signals)) == Backend("cuda", None, 0.51)


def test_quiet_takes_less_of_the_card_and_paused_none() -> None:
    small = Gpu("nvidia", "GTX 1650", 4096, via="cuda")
    assert not gpu_room(small, 0.4)
    assert gpu_room(small, 0.7)
    assert choose(LINUX_NVIDIA_CDI, budget_for("paused", LINUX_NVIDIA_CDI)) == Backend("off", "paused")
    assert Backend("cuda").as_record() == {"matcher": "cuda"}
