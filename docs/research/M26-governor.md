# M26: the hardware governor

The owner's principle (2026-11-12): **the product runs on modest hardware; nobody upgrades for us.** The local worker
(M7) and its matcher sidecar (M10) run on the owner's own computer, beside whatever the person at it is doing. Before
M26 the worker's share of that computer was a set of scattered knobs (GDAL's `ALL_CPUS`, a fixed 1 GB cache, half the
cores for the processor matcher, a sidecar capped at 6 GB). M26 replaces them with one governor that decides, every
few seconds, how much of this computer the worker may use, and says so on its `/state` and in the admin.

Package: `pipeline/src/hcm_pipeline/governor/`. Every function is within complexity 5, every file at 100 % lines and
branches. Its order is Probe → Signals → Policy → Budget → Actuators.

## 1. Probe (`probe.py`, `probe_linux.py`)

`Probe` is a protocol with one method, `read() -> Signals`; tests use fakes (`pipeline/tests/fakes/machines.py`).
`LinuxProbe` reads, from the container, over a root folder (`/`, or a test's fake tree):

| Signal | Source |
| --- | --- |
| cores | `os.cpu_count()` (the host's: `--cpus` is a quota, not fewer cores) |
| CPU quota | the cgroup's `cpu.max` (`<quota> <period>`, or `max`) |
| memory | `/proc/meminfo` MemTotal and MemAvailable; the cgroup's `memory.max` (limit) and `memory.current` (ours) |
| others' load | the host's `/proc/stat` between two ticks, minus our cgroup's `cpu.stat` `usage_usec` |
| power | `/sys/class/power_supply`: a battery that discharges, its capacity; a supply at all means mains |
| heat | `/sys/class/thermal/thermal_zone*`: the hottest processor zone (`x86_pkg_temp`, `cpu*`, `k10temp`, `acpitz`, …) |

On Linux the container's `/proc/stat` is the host's. Under Docker Desktop (Windows, macOS) it is only the VM's, which is
all Docker's own work, so others' load reads near zero there and the input hints carry the decision.

What a container cannot see comes from the starter as **host hints**: `host-hints.json` in the worker's volume,
written every `GOVERN_SECONDS` (5 s) through the worker's own container (`docker exec -i hcm-worker sh -c 'cat > …'`;
the starter never mounts the volume). Hints older than 60 s are ignored (a stopped starter says nothing).

| Hint | Linux | Windows | macOS |
| --- | --- | --- | --- |
| `idleS` (seconds since input) | GNOME's `org.gnome.Mutter.IdleMonitor`, else `xprintidle`, else logind's `IdleHint` / `IdleSinceHint` | `GetLastInputInfo` | `ioreg` `HIDIdleTime` |
| `power` | (read in the container) | `Win32_Battery` | `pmset -g batt` |
| `gpus` | `nvidia-smi` (memory, use, heat; `via: cuda` when `docker info` names the NVIDIA runtime or CDI); `/sys/class/drm/card*/device/vendor` 0x8086 with `/dev/dri` (`via: openvino`), 0x1002 with `/dev/kfd` (`via: rocm`) | `nvidia-smi` (`via: cuda`: Docker Desktop's WSL2 passes it) | none |
| `npus` | `/dev/accel/accel0` (`via: openvino`) | none | none |

logind's `IdleHint` turns only after the desktop's own idle delay (GNOME: 5 minutes), so on a desktop without GNOME's
monitor or `xprintidle` the worker stays quiet longer after the person leaves; it is never less polite.

## 2. Signals (`signals.py`)

Plain frozen dataclasses: `Cpu(cores, quota, temp_c)`, `Memory(total_mb, available_mb, limit_mb)`, `Power(source,
percent)`, `Gpu(vendor, name, vram_mb, others_mb, via, why, busy_pct, temp_c)`, `Npu(vendor, name, via, why)`,
`Usage(cpu_pct, others_cpu_pct, memory_mb)` and `idle_s`. A card that shares the computer's memory (integrated) has
`vram_mb` 0.

## 3. Policy (`policy.py`)

One pure function, `decide(signals, choice, before, now) -> PolicyState`, and `effective(state) -> (profile, why)`.

- The owner's choice (`auto`, `quiet`, `full`) wins over the person's activity: Quiet is always quiet, Full is full
  while someone types.
- Auto goes **quiet within one tick** (5 s) of: input on the host in the last 10 s (`user-active`), other processes
  using more than 40 % of the machine (`others-busy`), or a switch to battery (`battery`). It returns to **full only
  after 120 s** with none of those (a calm timer), so it never flaps (a hypothesis property test drives it with any
  sequence of activity).
- On battery under 30 % it **pauses**, unless the owner allowed work on battery (`batteryAllowed` in `POST /profile`).
- Heat steps **down one level** (full to quiet, quiet to paused) at 90 °C on the processor or 83 °C on a card, and
  back up only 10 °C below both (`why: thermal`).
- A card the matcher must leave (§5) reads `why: gpu-busy` while the profile stays full for the processor.

## 4. Budget (`budget.py`) and actuators (`actuate.py`)

| Setting | Full | Quiet | Paused |
| --- | --- | --- | --- |
| Threads (reserve 1 core; 2 from 8 cores) | max(1, cores − reserve) | max(1, cores ÷ 4) | 0 |
| Memory | 60 % of what is free to us | 35 % | 0 |
| GDAL cache, warp memory | a quarter of the memory each (at least 64 MB) | the same | unchanged |
| Tile processes | min(threads, memory ÷ 512 MB) | the same | 0 |
| Matcher keypoints | 2048 | 1024 | — |
| Card's memory share (`gpuFraction`) | ≤ 0.7 | ≤ 0.4 | 0 |
| A running step | runs | runs | waits at its next checkpoint |

"Free to us" is MemAvailable plus what the worker holds already (else the budget would shrink as the worker grows),
within the container's limit. **Cores** are the host's, within the CPU quota the container **started** with (a shared
machine's slot, a `--cpus` the owner set): the governor's own `docker update` comes later and only lowers it, so the
first quota read is the cap, never one of ours.

Actuators:

- `lower_priority()` at the worker's start (`Worker.govern`): `nice 10` and `ionice -c 3` (idle I/O). The person's
  programs always go first, whatever the budget.
- `apply_gdal` on every change: `GDAL_NUM_THREADS` (also the tile step's `num-threads`) and `GDAL_CACHEMAX`.
- `Gate`: paused, `RunFlags.check()` and `RunFlags.gdal_progress()` wait (a GDAL call blocks inside its own progress
  callback: memory kept, no processor time used); the time waited moves the step's time limit, and a cancel or a
  SIGTERM still ends the wait at once.
- The matcher: each request (`matcher/box.py` `MatcherBudget`, an optional `budget` array in the request's `.npz`)
  carries the processor threads, keypoints, the card's share and whether the card must be left; the sidecar's child
  sets `torch.set_num_threads`, `torch.cuda.set_per_process_memory_fraction` and ALIKED's `max_num_keypoints`.
- The starter (`hcm-worker.sh` `run_governor`, `hcm-worker.bat` `Start-GovernorLoop`): `docker update --cpus <threads>
  hcm-worker` when the budget's threads change (never 0: a pause keeps the last quota and the gate holds the step).
  This works on Linux, WSL2 and Docker Desktop; the cgroup's `cpu.max`, which the probe reads back, is the proof it took.

## 5. Where the matcher runs (`backends.py`)

Order: CUDA, ROCm, OpenVINO on an Intel card, OpenVINO on the NPU (ALIKED's extractor only, at a fixed size: an NPU
needs static shapes; LightGlue stays on a card or the processor), then the processor with fewer keypoints.

- A runtime counts only when the release ships the sidecar image for it (`IMAGES`; today `cuda` and `cpu`, the
  `pytorch/pytorch` image of M10). A card with no image says `no-image`; one Docker cannot pass in says
  `no-passthrough` (Windows on ARM, macOS: DirectML and Core ML need a native helper Docker cannot host).
- **Yield**: when other processes leave less than the matcher's 2 GB of a card, or the budget's share of it is under
  2 GB, the next request runs on the processor with `fallback: gpu-busy` (said in the proposer's record, which the
  calibration schema now accepts), and the card says `gpu-busy`. The laptop's 3080 on 2026-11-12 (6.4 of 8 GB held by
  someone else's job) is the test's case.

## 6. Contract

`GET /state` gains `machine` (`packages/shared/src/api/worker-machine.ts`, `workerMachineSchema`):

```text
{cpu:{cores}, memory:{totalMb, availableMb, limitMb?}, power:{source:'ac'|'battery'|'unknown', percent?},
 gpus:[{vendor, name, vramMb, via:'cuda'|'rocm'|'openvino'|null, why?}], npus:[{vendor, name, via, why?}],
 backend:{matcher:'cuda'|'rocm'|'openvino-gpu'|'openvino-npu'|'cpu'|'off', why?},
 profile:{chosen:'auto'|'quiet'|'full', active:'full'|'quiet'|'paused',
          why:'idle'|'user-active'|'others-busy'|'battery'|'thermal'|'gpu-busy'|'owner'},
 budget:{threads, memoryMb, gpuFraction}, usage:{cpuPct, othersCpuPct, memoryMb, gpuPct?, vramMb?, tempC?}}
```

`machine` is `null` before the governor's first tick. `others-busy` was added to the design's list of reasons: another
program's load is not the person's input.

`POST /profile {profile, batteryAllowed?}` answers under `/pair`'s rules (a Hosting origin, a JSON body; CORS and the
Private Network Access preflight for those origins only): 200 and the state, 400 for an unknown profile, 403 for
anything else. The choice is kept in the worker's volume (`governor.json`): it stays on that computer, never in Firestore.

The admin's card, "This computer" (`packages/ui/src/admin/worker/hcm-worker-machine.ts`, its view model
`packages/admin/src/worker/machine.ts`, strings `adminWorkerLocal.machine.*` in ro and en, in the lazy `worker-local`
chunk), shows under "This computer is connected": the cores and memory, Automatic / Quiet / Full, the profile in force
with its threads and GB and why, where the local AI runs, and a line when no card can be reached. A worker older than
M26 has no `machine`: the card asks to update it. Scenarios: A132 (`S-A132-HAPPY`, `S-A132-BAD-OLD-WORKER`,
`S-A132-BAD-NO-GPU`, `S-A132-BAD-BATTERY`); tour state `worker.local-machine`.

`HCM_GOVERNOR=off` leaves a worker ungoverned: only the tests' own process uses it (a governed test would renice pytest
and set GDAL's options for every later test).

## 7. What this builds on

`track/stripfix` (another agent, 2026-11-12) adds GDAL memory sized to the machine (`rasters.py` `gdal_memory`), a cap
on tile processes (`pyramid.py` `tile_processes`), claim back-off (`worker/pace.py`) and the starter's memory cap (60 %)
with `--cpu-shares 256`. At the time of this work that branch's resource changes were **not committed** (its pushed
head was `0a74888c`), so M26 is built on `origin/track/stripfix` at `0a74888c` and leaves those functions to be read from
the governor's budget when the two meet: `Budget.gdal_cache_mb`, `warp_mb` and `tile_processes` are those numbers.

## 8. Tests and what is proved

- Unit (pytest): fake machines for Linux with NVIDIA through CDI, AMD ROCm, Intel Arc with an NPU (the NUC's shape),
  2 cores and 4 GB with no card, WSL2 with NVIDIA (Intel unreachable), Windows on ARM with Qualcomm, macOS on Apple
  silicon; a battery at 20 %, a hot processor, the person active. Property tests: threads within 1 … cores − reserve,
  memory within its share, the card's share ≤ 0.7, no flapping.
- Vitest: the schema, the starter's loop (`functions/test/worker/starter-governor.test.ts`: the quota only on a change,
  the hints through the worker's container, no mount), the card in ro and en.
- The load test (`pipeline/tests/load/governor_load.py`, run on the NUC through `nuc-test.sh`): see §9.

| Machine | Can prove |
| --- | --- |
| NUC (16 threads, 30 GB, Arc 140T, Core Ultra NPU) | the load test; the processor path; Intel GPU and NPU detection by the starter |
| Laptop (16 threads, 30 GB, RTX 3080 8 GB) | the CUDA path and NVML-style yield (seen live: 6.4 GB held by another job) |
| None of them | AMD ROCm, DirectML, Qualcomm, Core ML / ANE: fake probes only, **unproved** |

## 9. Measured

See the addendum below (filled from the NUC run).

## 10. Not done (and why)

- **ONNX Runtime and OpenVINO sidecar images** (`matcher/ort_backend.py`, `matcher/export.py`, images `openvino`,
  `cpu`): not built. ALIKED's deformable convolution must first be shown to export to ONNX (or through OpenVINO's
  `convert_model`) with the M9 proof's parity marks (same verdict, scale within 0.5 %, rotation within 0.2°, ≥ 90 % of
  the reference's inliers); that needs the pinned packages downloaded and measured, which this run did not do. Until
  then `IMAGES` is `{cuda, cpu}` and an Intel or AMD card reads `no-image`; the starter still passes only `--gpus all`
  or CDI to the sidecar.
- The sidecar's memory (`--memory 6g`) and the worker's own memory cap stay the starter's fixed numbers (stripfix's 60 %).
- The ours/others split of a card's memory counts our own sidecar as "others" while a request runs (nvidia-smi on the
  host cannot tell the container's processes apart); the yield is decided before a request starts, when ours is 0.
