"""The owner's layout of an atlas or pieces (docs/research/M20-import-local.md §19.8): what `imagery.saveLayout` wrote, fixed as given.

`help.layoutAnswer` (`layoutAnswerSchema` of @hcm/shared) names each sheet by its index in `layout.json` with its cell, turn and flip,
or `not-part` (the wizard's X); a sheet the answer does not name is left out too. Each seam the owner answered carries one matching
point on each side, in the two sheets' oriented pixels (`layout_files`); it becomes a fixed seam of full weight. The other seams are
measured as usual, and the bundle places everything. A `preview` answer renders the layout and waits again with `layout-check` (the
wizard's step 3, its answer kept); otherwise the layout is mosaicked and placed whatever its verdict: the owner has checked it. An
answer with no sheets (accepted as proposed) takes the automatic proposal as it is. The layout written next has the answer's revision
plus one.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

from hcm_pipeline.jobs import JobContext, StepResult
from hcm_pipeline.placing import autoplace
from hcm_pipeline.placing.autostitch import Plan, Proposal, propose, solved
from hcm_pipeline.placing.layout_files import stretch
from hcm_pipeline.placing.series import SeriesJob
from hcm_pipeline.placing.sheetnames import NameGrid
from hcm_pipeline.placing.sheetwork import allowed, cell_of, read_parts, variant_of

OWNER: str = "owner"
POINT_SIZE: int = 2


@dataclass(frozen=True)
class Answer:
    """The owner's layout as saved: the revision it was made on, its sheets and seams, whether it is a preview, the whole record."""

    revision: int
    sheets: tuple[Mapping[str, object], ...]
    seams: tuple[Mapping[str, object], ...]
    preview: bool
    record: Mapping[str, object]


def _records(value: object) -> tuple[Mapping[str, object], ...]:
    return tuple(item for item in value if isinstance(item, Mapping)) if isinstance(value, list) else ()


def answer_of(ctx: JobContext) -> Answer | None:
    """The version's `help.layoutAnswer`, or None when the owner gave none."""
    version = ctx.services.store.get(ctx.version_path()) or {}
    help_item = version.get("help")
    found = help_item.get("layoutAnswer") if isinstance(help_item, Mapping) else None
    return None if not isinstance(found, Mapping) else _answer(found)


def _answer(found: Mapping[str, object]) -> Answer:
    preview = found.get("preview") is True and found.get("accepted") is not True
    return Answer(number(found, "revision"), _records(found.get("sheets")), _records(found.get("seams")), preview, found)


def number(record: Mapping[str, object], key: str) -> int:
    value = record.get(key)
    return value if isinstance(value, int) and not isinstance(value, bool) else 0


def point(record: Mapping[str, object], key: str) -> tuple[float, float]:
    """A point `[x, y]` of a seam's points, (0, 0) when malformed."""
    found = record.get(key)
    values = found if isinstance(found, list) else []
    numbers = [float(value) for value in values if isinstance(value, int | float)]
    return (numbers[0], numbers[1]) if len(numbers) == len(values) == POINT_SIZE else (0.0, 0.0)


def place_sheet(plan: Plan, sheet: Mapping[str, object]) -> None:
    """One answered sheet: its variant, and its cell unless the owner marked it not part of the map."""
    index = number(sheet, "index")
    if index not in plan.variants:
        return
    plan.variants[index] = variant_of(number(sheet, "turn"), sheet.get("flip") is True)
    if sheet.get("out") is None:
        plan.out.pop(index, None)
        plan.cells[index] = (number(sheet, "row"), number(sheet, "col"))


def seam_offset(plan: Plan, seam: Mapping[str, object]) -> tuple[float, float]:
    """Where `b` lies from `a` (cell pixels) when the owner's two points are one place."""
    points = seam.get("points")
    found = points if isinstance(points, Mapping) else {}
    (ax, ay), (bx, by) = point(found, "a"), point(found, "b")
    (sax, say), (sbx, sby) = stretch(plan, number(seam, "a")), stretch(plan, number(seam, "b"))
    return ax * sax - bx * sbx, ay * say - by * sby


def owner_plan(named: Sequence[tuple[str, Path]], answer: Answer) -> Plan:
    """The parts with the owner's cells, turns and flips, the sheets out and the seams set; a sheet the answer does not name is out."""
    parts = read_parts(named)
    cell = cell_of(parts)
    plan = Plan(parts, {}, {part.index: allowed(part, cell)[0] for part in parts}, cell, {part.index: "not-part" for part in parts})
    for sheet in answer.sheets:
        place_sheet(plan, sheet)
    plan.fixed = _fixed(plan, answer.seams)
    return plan


def _fixed(plan: Plan, seams: Sequence[Mapping[str, object]]) -> dict[tuple[int, int], tuple[float, float]]:
    """The owner's seams between two sheets on the layout, as offsets."""
    return {(number(seam, "a"), number(seam, "b")): seam_offset(plan, seam) for seam in filter(lambda seam: _joins(plan, seam), seams)}


def _joins(plan: Plan, seam: Mapping[str, object]) -> bool:
    """True when both of the seam's sheets are on the layout."""
    return {number(seam, "a"), number(seam, "b")} <= set(plan.cells)


def owner_proposal(named: Sequence[tuple[str, Path]], answer: Answer) -> Proposal:
    if not answer.sheets:
        return propose(named)
    plan = owner_plan(named, answer)
    cells = plan.cells or {0: (0, 0)}
    rows, cols = 1 + max(row for row, _ in cells.values()), 1 + max(col for _, col in cells.values())
    return solved(plan, NameGrid(dict(plan.cells), rows, cols, OWNER))


def place(ctx: JobContext, series: SeriesJob, answer: Answer, method: str) -> StepResult:
    """The owner's layout: previewed (and its answer kept), or mosaicked and placed."""
    proposal = owner_proposal(autoplace.named_of(series.sheets), answer)
    ctx.log.info(f"the owner's layout, revision {answer.revision}: {len(proposal.solved.positions)} sheets placed", ctx.step)
    if answer.preview:
        result = autoplace.wait_layout(ctx, series, proposal, OWNER, answer.revision + 1)
        ctx.update_version({"help.layoutAnswer": dict(answer.record)})
        return result
    return autoplace.mosaicked(ctx, series, proposal, (method, OWNER), answer.revision + 1)
