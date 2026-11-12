"""`python -m hcm_pipeline worker --city <id> --project <id> [--pair <code>] [--supervised --image <digest>] [--port 8765]
[--work /work] [--emulators]` (M7 §1.1, §1.5).

Validates the arguments (a bad one exits with the configuration code, naming it), sets GDAL up as `run` does, then
serves the local page and runs the loop until SIGTERM or Ctrl-C (exit 0). Finding 72: under the starter's supervisor
(`--supervised`) an image older than the installed pipeline's ends the run with `ExitCode.OUTDATED` (75).
"""

from collections.abc import Callable
from typing import Final

from hcm_pipeline.exit_codes import ExitCode
from hcm_pipeline.raster import gdal
from hcm_pipeline.rasters import configure_gdal
from hcm_pipeline.steps import Outcome, StepContext, StepError
from hcm_pipeline.worker.args import WorkerArgs, parse_worker_args
from hcm_pipeline.worker.worker import Worker

# M26: `off` leaves the computer ungoverned (the tests' own process, never a computer of an owner).
GOVERNOR_ENV: Final = "HCM_GOVERNOR"


class WorkerCommand:
    name = "worker"
    requires_config = False

    def __init__(self, build: Callable[[WorkerArgs], Worker] = Worker.build) -> None:
        self._build = build

    def run(self, ctx: StepContext) -> Outcome:
        args = parse_worker_args(ctx.options, ctx.env)
        configure_gdal()
        gdal.UseExceptions()
        worker = self._build(args)
        if ctx.env.get(GOVERNOR_ENV) != "off":
            worker.govern()
        worker.serve()
        if worker.loop.outdated_exit:
            raise StepError("the installed pipeline is newer than this image: the supervisor pulls it", ExitCode.OUTDATED)
        return Outcome.DONE
