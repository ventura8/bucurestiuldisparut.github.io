"""Command line of the Cloud Run Job: `python -m hcm_pipeline <step>` (or `--list`).

Configures redacted JSON logging, loads and validates the job configuration from the environment
when the step needs it, runs the step from the registry and returns an ExitCode: OK when the step
is done or WAITING on USGS or Mapbox, FAILED when it failed (Cloud Run may retry), USAGE for a bad
command line and CONFIG for an incomplete environment (a retry cannot help).
"""

import argparse
import logging
import os
from collections.abc import Mapping, Sequence
from typing import NoReturn, TextIO

from hcm_pipeline.config import ConfigError, load_config
from hcm_pipeline.exit_codes import ExitCode
from hcm_pipeline.log import configure
from hcm_pipeline.steps import Step, StepContext, StepError, StepRegistry
from hcm_pipeline.steps.doctor import DoctorStep


class UsageError(Exception):
    """The command line names no step, or one that does not exist."""


class _Parser(argparse.ArgumentParser):
    """argparse that raises UsageError instead of printing and exiting, so main() returns the exit code."""

    def error(self, message: str) -> NoReturn:
        raise UsageError(message)


def default_registry() -> StepRegistry:
    return StepRegistry((DoctorStep(),))


def parse_args(argv: Sequence[str] | None, registry: StepRegistry) -> argparse.Namespace:
    parser = _Parser(prog="python -m hcm_pipeline", description="Run one step of the Historic City Map raster pipeline.")
    parser.add_argument("step", nargs="?", choices=registry.names(), help="the step to run")
    parser.add_argument("--list", action="store_true", help="log the registered steps and exit")
    return parser.parse_args(argv)


def run_step(step: Step, env: Mapping[str, str], log: logging.Logger) -> int:
    """Runs one step with its context; every failure becomes a logged exit code, never a traceback on stderr."""
    try:
        ctx = StepContext(log=log.getChild(step.name), config=load_config(env) if step.requires_config else None)
        outcome = step.run(ctx)
    except ConfigError as error:
        log.error("step %s cannot start: %s", step.name, error)
        return ExitCode.CONFIG
    except StepError as error:
        log.error("step %s failed: %s", step.name, error)
        return error.exit_code
    except Exception:
        log.exception("step %s crashed", step.name)
        return ExitCode.FAILED
    log.info("step %s %s", step.name, outcome.value)
    return ExitCode.OK


def _dispatch(args: argparse.Namespace, registry: StepRegistry, env: Mapping[str, str], log: logging.Logger) -> int:
    if args.list:
        log.info("steps: %s", ", ".join(registry.names()))
        return ExitCode.OK
    if args.step is None:
        raise UsageError("name the step to run")
    return run_step(registry.get(args.step), env, log)


def main(
    argv: Sequence[str] | None = None,
    env: Mapping[str, str] | None = None,
    registry: StepRegistry | None = None,
    stream: TextIO | None = None,
) -> int:
    """The process entry point: arguments default to sys.argv and os.environ, logs go to stderr."""
    log = configure(stream)
    steps = registry or default_registry()
    try:
        return _dispatch(parse_args(argv, steps), steps, os.environ if env is None else env, log)
    except UsageError as error:
        log.error("usage: %s (steps: %s)", error, ", ".join(steps.names()))
        return ExitCode.USAGE
