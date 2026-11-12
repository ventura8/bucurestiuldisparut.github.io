"""`python -m hcm_pipeline worker --city <id> --project <id> [--pair <code>] [--supervised --image <digest>] [--port 8765]
[--work /work] [--emulators]` (M7 §1.1, §1.5).

Validates the arguments (a bad one exits with the configuration code, naming it), sets GDAL up as `run` does, then
serves the local page and runs the loop until SIGTERM or Ctrl-C (exit 0). The computer is its owner's first
(reports/resource-audit.md): the process is niced (`HCM_WORKER_NICE`, 10; 0: not at all) and GDAL takes the cores but one
unless `GDAL_NUM_THREADS` says otherwise. Finding 72: under the starter's supervisor
(`--supervised`) an image older than the installed pipeline's ends the run with `ExitCode.OUTDATED` (75).
"""

import os
from collections.abc import Callable, Mapping
from typing import Final

from hcm_pipeline.exit_codes import ExitCode
from hcm_pipeline.raster import gdal
from hcm_pipeline.rasters import ENV_THREADS, configure_gdal, spare_threads
from hcm_pipeline.steps import Outcome, StepContext, StepError
from hcm_pipeline.worker.args import WorkerArgs, parse_worker_args
from hcm_pipeline.worker.worker import Worker

ENV_NICE: Final = "HCM_WORKER_NICE"
DEFAULT_NICE: Final = "10"


def yield_processor(env: Mapping[str, str], nice: Callable[[int], object]) -> None:
    """The worker's process below everything its computer's owner runs: `HCM_WORKER_NICE` steps of niceness (0: none)."""
    text = env.get(ENV_NICE, DEFAULT_NICE)
    steps = int(text if text.isdigit() else DEFAULT_NICE)
    if steps > 0:
        nice(steps)


class WorkerCommand:
    name = "worker"
    requires_config = False

    def __init__(self, build: Callable[[WorkerArgs], Worker] = Worker.build, nice: Callable[[int], object] = os.nice) -> None:
        self._build = build
        self._nice = nice

    def run(self, ctx: StepContext) -> Outcome:
        args = parse_worker_args(ctx.options, ctx.env)
        yield_processor(ctx.env, self._nice)
        configure_gdal(os.environ.get(ENV_THREADS) or spare_threads(os.cpu_count()))
        gdal.UseExceptions()
        worker = self._build(args)
        worker.serve()
        if worker.loop.outdated_exit:
            raise StepError("the installed pipeline is newer than this image: the supervisor pulls it", ExitCode.OUTDATED)
        return Outcome.DONE
