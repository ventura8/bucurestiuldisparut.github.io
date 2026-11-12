"""An atlas's pages or overlapping pieces laid out on their own (docs/research/M20-import-local.md §19): names, seams, one bundle.

1. The sheets as bounded working copies (`sheetwork`): cropped to their content, blank pages told apart, all on one cell.
2. The grid from their names (`sheetnames`); for names in order alone, the few likeliest column counts are each tried and the one whose
   seams join best is kept.
3. Each sheet's turn and flip: every variant its shape allows is tried once against its neighbours (a strong fit that wins `ORIENT_GAIN`).
4. The seams of every pair of grid neighbours (`seams`), then every sheet's place at once (`bundle`), and the verdict (`quality`).

A `Proposal` is what the placers mosaic when it is `good` (`tiles`, through `canvas_window`), and what the owner checks otherwise
(`layout_files`). An owner's layout (`owner_layout`) fixes the grid, the variants and the sheets left out before steps 3 and 4.
"""

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Final

import numpy

from hcm_pipeline.placing import bundle, sheetnames
from hcm_pipeline.placing.canvas_window import Tile
from hcm_pipeline.placing.quality import Measures, Quality, judged
from hcm_pipeline.placing.seams import STRONG_SCORE, Seam, seam_of
from hcm_pipeline.placing.sheetwork import Part, allowed, cell_of, on_cell, read_parts
from hcm_pipeline.placing.streets import UInt8Array

ORIENT_GAIN: Final = 0.2
ORIENT_PASSES: Final = 2
CANVAS_MAX_PX: Final = 20_000
SIDES: Final = (("right", 0, 1), ("below", 1, 0))
Cell = tuple[int, int]


@dataclass
class Plan:
    """What the seams are measured on: the parts, their cells, each one's variant, the sheets kept out (with why) and the cell."""

    parts: list[Part]
    cells: dict[int, Cell]
    variants: dict[int, int]
    cell: tuple[int, int]
    out: dict[int, str] = field(default_factory=dict)
    fixed: dict[tuple[int, int], tuple[float, float]] = field(default_factory=dict)
    _images: dict[tuple[int, int], UInt8Array] = field(default_factory=dict)

    def image(self, index: int, variant: int | None = None) -> UInt8Array:
        """The sheet on the cell in `variant` (its own by default); only its own variant is kept (a trial one is made each time)."""
        chosen = self.variants[index] if variant is None else variant
        if chosen != self.variants[index]:
            return on_cell(self.parts[index], chosen, self.cell)
        key = (index, chosen)
        if key not in self._images:
            self._images[key] = on_cell(self.parts[index], chosen, self.cell)
        return self._images[key]

    def turn(self, index: int, variant: int) -> None:
        self._images.pop((index, self.variants[index]), None)
        self.variants[index] = variant

    def pairs(self) -> list[tuple[int, int, str]]:
        """Every pair of neighbouring cells, both kept: (first, second, the side the second is on)."""
        at = {cell: index for index, cell in self.cells.items() if index not in self.out}
        found: list[tuple[int, int, str]] = []
        for (row, col), index in at.items():
            found.extend(_neighbours(at, index, row, col))
        return found


def _neighbours(at: Mapping[Cell, int], index: int, row: int, col: int) -> list[tuple[int, int, str]]:
    """The sheet's neighbours to its right and below, where there is one."""
    beside = ((side, (row + dr, col + dc)) for side, dr, dc in SIDES)
    return [(index, at[cell], side) for side, cell in beside if cell in at]


def measured(plan: Plan, pair: tuple[int, int, str], variants: Mapping[int, int] | None = None) -> Seam:
    first, second, side = pair
    if (first, second) in plan.fixed:
        dx, dy = plan.fixed[(first, second)]
        return Seam(first, second, side, dx, dy, 1.0, 0.0, "owner")
    chosen = variants or {}
    return seam_of(plan.image(first, chosen.get(first)), plan.image(second, chosen.get(second)), first, second, side)


def seams_of(plan: Plan) -> list[Seam]:
    return [measured(plan, pair) for pair in plan.pairs()]


def _support(seams: Sequence[Seam]) -> float:
    return float(numpy.mean([max(0.0, seam.score) for seam in seams])) if seams else 0.0


def _sheet_score(plan: Plan, index: int, variant: int) -> float:
    pairs = [pair for pair in plan.pairs() if index in pair[:2]]
    return _support([measured(plan, pair, {index: variant}) for pair in pairs])


def _turn_of(plan: Plan, index: int) -> tuple[float, int] | None:
    """The sheet's better variant and how much it gains, when it is not strong as it is and another variant fits strongly by
    `ORIENT_GAIN` more; else None."""
    current = _sheet_score(plan, index, plan.variants[index])
    if current >= STRONG_SCORE:
        return None
    best_score, best = max((_sheet_score(plan, index, variant), variant) for variant in allowed(plan.parts[index], plan.cell))
    return (best_score - current, best) if best_score >= STRONG_SCORE and best_score > current + ORIENT_GAIN else None


def _turn_pass(plan: Plan, free: set[int]) -> bool:
    """One pass: the sheets that gain most are turned first, each checked again just before (a neighbour turned before it may have
    made it fit); True when one was turned."""
    found = ((_turn_of(plan, index), index) for index in sorted(free - set(plan.out)))
    ranked = sorted(((turn, index) for turn, index in found if turn is not None), reverse=True)
    return sum(_turned_again(plan, index) for _first, index in ranked) > 0


def _turned_again(plan: Plan, index: int) -> bool:
    """The sheet turned when it still gains (its neighbours as they are now); True when it was."""
    again = _turn_of(plan, index)
    if again is not None:
        plan.turn(index, again[1])
    return again is not None


def orient(plan: Plan, free: set[int]) -> None:
    """Each free sheet turned to the variant its neighbours agree with (strongly, and by `ORIENT_GAIN`), surest first, in at most
    `ORIENT_PASSES` passes."""
    for _ in range(ORIENT_PASSES):
        if not _turn_pass(plan, free):
            return


@dataclass(frozen=True)
class Proposal:
    """A layout: its plan, the grid it came from, its seams, the bundle's answer and the verdict."""

    plan: Plan
    grid: sheetnames.NameGrid
    seams: tuple[Seam, ...]
    solved: bundle.Solved
    quality: Quality

    @property
    def left_out(self) -> dict[int, str]:
        unseamed = {index: "no-seam" for index in self.solved.left_out}
        return {**self.plan.out, **unseamed}

    def tiles(self, longest: int = CANVAS_MAX_PX) -> tuple[list[tuple[int, Tile]], tuple[int, int]]:
        """Each placed sheet as a tile on a canvas whose long side is at most `longest`, and the canvas's size."""
        return tiles_of(self.plan, self.solved.positions, longest)


def tiles_of(plan: Plan, positions: Mapping[int, tuple[float, float]], longest: int) -> tuple[list[tuple[int, Tile]], tuple[int, int]]:
    if not positions:
        return [], (1, 1)
    places = numpy.array(list(positions.values()))
    low = places.min(axis=0)
    span = places.max(axis=0) - low + numpy.array(plan.cell)
    factor = min(_native(plan), longest / float(span.max()))
    width, height = max(1, round(plan.cell[0] * factor)), max(1, round(plan.cell[1] * factor))
    found = []
    for index, (x, y) in positions.items():
        part = plan.parts[index]
        left, top = round((x - low[0]) * factor), round((y - low[1]) * factor)
        found.append((index, Tile(part.path, part.box, plan.variants[index], left, top, width, height)))
    return found, (max(1, math.ceil(span[0] * factor)), max(1, math.ceil(span[1] * factor)))


def _native(plan: Plan) -> float:
    """Canvas pixels per cell pixel at the scans' own resolution (the median part's)."""
    return float(numpy.median([part.scale * part.image.shape[1] / plan.cell[0] for part in plan.parts]) or 1.0)


def _initial(parts: Sequence[Part], cell: tuple[int, int]) -> dict[int, int]:
    return {part.index: allowed(part, cell)[0] for part in parts}


def _best_order(plan: Plan, names: Sequence[str]) -> sheetnames.NameGrid:
    """Of the likeliest column counts for names in order, the one whose seams join best."""
    tried = []
    for cols in sheetnames.col_candidates(len(names), plan.cell[0] / plan.cell[1]):
        grid = sheetnames.ordered(names, cols)
        plan.cells = grid.cells
        tried.append((_support(seams_of(plan)), -cols, grid))
    best = max(tried, key=lambda item: (item[0], item[1]))[2]
    plan.cells = best.cells
    return best


def _counted(plan: Plan) -> int:
    """The sheets that are part of the map: all but the blank pages and those the owner marked out."""
    return len(plan.parts) - sum(reason in {"blank", "not-part"} for reason in plan.out.values())


def _measures(plan: Plan, answer: bundle.Solved) -> Measures:
    residuals = [max(residual, seam.rms) for seam, residual in zip(answer.kept, answer.residuals, strict=True)]
    moved = max(answer.moved.values(), default=0.0)
    return Measures(len(answer.positions), _counted(plan), [seam.score for seam in answer.kept], residuals, moved)


def _marked(seams: Sequence[Seam], dropped: Sequence[Seam]) -> tuple[Seam, ...]:
    """The seams with those the bundle dropped marked `weak` (they disagree with the others)."""
    pairs = {(seam.a, seam.b) for seam in dropped}
    return tuple(replace(seam, state="weak") if (seam.a, seam.b) in pairs else seam for seam in seams)


def solved(plan: Plan, grid: sheetnames.NameGrid) -> Proposal:
    """The seams measured and the bundle solved on a plan whose cells and variants are set; with its verdict."""
    seams = seams_of(plan)
    cells = {index: cell for index, cell in plan.cells.items() if index not in plan.out}
    from_order = set(cells) if grid.source == "order" else set()
    answer = bundle.solve(cells, seams, plan.cell, from_order)
    return Proposal(plan, grid, _marked(seams, answer.dropped), answer, judged(_measures(plan, answer)))


def _out(parts: Sequence[Part], grid: sheetnames.NameGrid) -> dict[int, str]:
    """The sheets kept out from the start: the blank pages, and the foreign sheets the names did not read."""
    blank = {part.index: "blank" for part in parts if part.blank}
    return blank | {index: "no-join" for index in grid.unread}


def propose(named: Sequence[tuple[str, Path]]) -> Proposal:
    """The series laid out from its names and seams (`named`: each part's name, relative to the archive, and its scan)."""
    parts = read_parts(named)
    cell = cell_of(parts)
    names = [name for name, _path in named]
    grid = sheetnames.grid_of(names, cell[0] / cell[1])
    plan = Plan(parts, dict(grid.cells), _initial(parts, cell), cell, _out(parts, grid))
    if grid.source == "order":
        grid = _best_order(plan, names)
    orient(plan, set(plan.cells))
    return solved(plan, grid)
