"""A profile turned into numbers (docs/research/M26-governor.md §4). Pure: the same signals and profile give the same budget.

| | full | quiet | paused |
| --- | --- | --- | --- |
| threads | max(1, cores - reserve) | max(1, cores // 4) | 0 (the step waits) |
| memory | 60 % of what is free to us | 35 % | 0 |
| GPU fraction | 0.7 | 0.4 | 0 |

The reserve is one core, two from 8 cores on: the person at the computer always keeps one. What is free to us is the machine's
available memory plus what the worker holds already (else the budget would shrink as the worker grows, and flap), within the container's
limit. GDAL's block cache and the warper's memory are `rasters.gdal_memory` of the budget (a sixteenth and an eighth, at most 1,024 and
2,048 MB: the measured savings of reports/resource-audit.md, never more); the tile processes are `steps/pyramid.tile_processes`'s rule,
a quarter of the budget at `TILE_PROCESS_MB` each, at most the threads.
"""

from dataclasses import dataclass
from typing import Final

from hcm_pipeline.governor.signals import Gpu, Profile, Signals
from hcm_pipeline.rasters import gdal_memory

MEMORY_SHARE: Final[dict[Profile, float]] = {"full": 0.60, "quiet": 0.35, "paused": 0.0}
GPU_FRACTION: Final[dict[Profile, float]] = {"full": 0.7, "quiet": 0.4, "paused": 0.0}
KEYPOINTS: Final[dict[Profile, int]] = {"full": 2048, "quiet": 1024, "paused": 0}
BIG_MACHINE_CORES: Final = 8
QUIET_DIVISOR: Final = 4
# `steps/pyramid.py`: a tile process holds about 170 MB; a quarter of the memory at 256 MB each.
TILE_SHARE_DIVISOR: Final = 4
TILE_PROCESS_MB: Final = 256
MATCHER_NEED_MB: Final = 2048


@dataclass(frozen=True)
class Budget:
    """What the worker may use under one profile."""

    profile: Profile
    threads: int
    memory_mb: int
    gpu_fraction: float
    gdal_cache_mb: int
    warp_mb: int
    tile_processes: int
    keypoints: int

    def as_record(self) -> dict[str, object]:
        """The part `/state` says (`budget` of `WorkerMachine`)."""
        return {"threads": self.threads, "memoryMb": self.memory_mb, "gpuFraction": self.gpu_fraction}


def reserve(cores: int) -> int:
    """The cores left to the person at the computer."""
    return 2 if cores >= BIG_MACHINE_CORES else 1


def threads_for(profile: Profile, cores: int) -> int:
    if profile == "paused":
        return 0
    if profile == "quiet":
        return max(1, cores // QUIET_DIVISOR)
    return max(1, cores - reserve(cores))


def memory_for(profile: Profile, signals: Signals) -> int:
    """MiB: the profile's share of what is free to us, never above the container's limit."""
    free = signals.memory.available_mb + signals.usage.memory_mb
    share = int(free * MEMORY_SHARE[profile])
    limit = signals.memory.limit_mb
    return share if limit is None else min(share, limit)


def budget_for(profile: Profile, signals: Signals) -> Budget:
    threads = threads_for(profile, signals.cpu.cores)
    memory = memory_for(profile, signals)
    gdal = gdal_memory(memory) if memory else None
    tiles = max(1, min(threads, memory // TILE_SHARE_DIVISOR // TILE_PROCESS_MB)) if threads else 0
    cache, warp = (gdal.cache_mb, gdal.warp_mb) if gdal else (0, 0)
    return Budget(profile, threads, memory, GPU_FRACTION[profile], cache, warp, tiles, KEYPOINTS[profile])


def gpu_room(gpu: Gpu, fraction: float, need_mb: int = MATCHER_NEED_MB) -> bool:
    """Whether the matcher may use this card now: what other processes leave, and our fraction of it, both hold what it needs. A card
    that shares the computer's memory (an integrated one: `vram_mb` 0) is held by the memory budget instead."""
    if gpu.vram_mb == 0:
        return True
    free = gpu.vram_mb - gpu.others_mb
    return free >= need_mb and gpu.vram_mb * fraction >= need_mb
