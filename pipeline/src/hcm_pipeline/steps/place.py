"""`place`: an archive series placed on the map by the path of its class (docs/research/M20-import-local.md §3, §4).

Each class has its placer (`PLACERS`: the georeferenced read, the grid solve, the atlas, the pieces, the drawn-map match), which writes the
series' `warped.tif` and the version's `archive` report and answers `Done`; `export`, `pyramid` and `register` then run as for any layer.
A class with no placer yet, or a placer that cannot prove a placement, never fails the job: the version waits for a person
(`needs_gcps`) with one line saying why (`help`: the owner's standing rule of 2026-11-09, the shared "Help calibrate" queue), and the job
waits for points (`awaiting_gcps`). A low-confidence placer leaves its correspondences as suggested pairs first.
"""

from collections.abc import Mapping
from typing import Final, Protocol

from hcm_pipeline.jobs import JobContext, StepResult, Waiting
from hcm_pipeline.steps.gather import text_param

NO_PATH_NOTE: Final = "No automatic placement for this kind of series yet: add about four points, or wait for an update."


class Placer(Protocol):
    """One class's path: it places the series or parks it with `wait_for_help`."""

    def place(self, ctx: JobContext) -> StepResult: ...


# The paths of §3, by series class; each lands with its workstream (C grid, D drawn maps, E atlases and pieces, a georeferenced files).
PLACERS: dict[str, Placer] = {}


def wait_for_help(ctx: JobContext, reason: str, note: str, fields: Mapping[str, object] | None = None) -> Waiting:
    """The version waits for a person with why (`help`); the job waits for points."""
    help_item = {"reason": reason, "note": note[:200], "at": ctx.now()}
    ctx.update_version({"state": "needs_gcps", "help": help_item, **(fields or {})})
    return Waiting("awaiting_gcps", "gcps", note)


class PlaceStep:
    name = "place"

    def __init__(self, placers: Mapping[str, Placer] | None = None) -> None:
        self._placers = PLACERS if placers is None else placers

    def run(self, ctx: JobContext) -> StepResult:
        placer = self._placers.get(text_param(ctx.job.params, "class"))
        if placer is None:
            return wait_for_help(ctx, "no-path", NO_PATH_NOTE)
        return placer.place(ctx)
