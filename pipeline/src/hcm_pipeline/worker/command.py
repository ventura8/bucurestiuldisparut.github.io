"""`python -m hcm_pipeline worker --city <id> --project <id> [--port 8765] [--work /work] [--emulators]` (M7 §1.1).

Validates the arguments (a bad one exits with the configuration code, naming it), sets GDAL up as `run` does, then
serves the local page and runs the loop until SIGTERM or Ctrl-C (exit 0).
"""

from collections.abc import Callable

from hcm_pipeline.raster import gdal
from hcm_pipeline.rasters import configure_gdal
from hcm_pipeline.steps import Outcome, StepContext
from hcm_pipeline.worker.args import WorkerArgs, parse_worker_args
from hcm_pipeline.worker.worker import Worker


class WorkerCommand:
    name = "worker"
    requires_config = False

    def __init__(self, build: Callable[[WorkerArgs], Worker] = Worker.build) -> None:
        self._build = build

    def run(self, ctx: StepContext) -> Outcome:
        args = parse_worker_args(ctx.options, ctx.env)
        configure_gdal()
        gdal.UseExceptions()
        self._build(args).serve()
        return Outcome.DONE
