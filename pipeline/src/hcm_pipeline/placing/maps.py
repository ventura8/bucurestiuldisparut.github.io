"""The placers of drawn maps (docs/research/M20-import-local.md §3 c, *Atlases and pieces*, *PDFs*): single, atlas and pieces.

A single map is placed by its streets as it is. An atlas's pages (image files, or a PDF's pages taken out with pikepdf) and overlapping
pieces are first assembled into one canvas in the job's scratch folder (`assemble`, `joins`), then placed as one map: many junctions
over the whole city are far stronger than page by page. Pieces are joined by their features at a higher resolution (`joins`); when the
archive holds a complete smaller-scale overview of the same area, pieces are laid on that overview first (`overview_find`) and that
mosaic is the series' picture. An atlas's pages join by their edges, or by their overlaps when those join more pages (M22 §4.1). A PDF
that needs a password waits for a person (`low-confidence`: the owner exports its pages). Pages or pieces that join nothing are left
out: the job's log says how many, and the version's placed count leaves them out. A map or canvas that is not placed on its own is kept
as the one stitched picture the Help calibrate wizard places (`stitched`), with the parts left out and why.
"""

import math
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Final

import numpy

from hcm_pipeline.archive.magic import sniff_file
from hcm_pipeline.jobs import JobContext, StepResult, Waiting
from hcm_pipeline.placing import assemble, joins
from hcm_pipeline.placing.output import wait_for_help
from hcm_pipeline.placing.overview import MosaicReport
from hcm_pipeline.placing.overview_find import CanvasOpts, find_overview, overview_canvas
from hcm_pipeline.placing.pdfpages import extract_pages
from hcm_pipeline.placing.raster_io import read_working
from hcm_pipeline.placing.series import SeriesJob, Sheet, series_of
from hcm_pipeline.placing.single import LARGEST_WORKING_PX, Drawn, drawn_of, place_map
from hcm_pipeline.placing.stitched import NO_JOIN, JoinQuality, Stitched, publish_stitched
from hcm_pipeline.placing.streets import UInt8Array
from hcm_pipeline.steps.gather import store_of, text_param

PDF_LOCKED: Final = "This PDF needs a password: export its pages as images from a PDF reader, then import them."
NO_PAGES: Final = "No page of this series could be laid out: add about four points on its pages, or import them as single maps."
NO_STITCH: Final = "These pieces could not be stitched into one sheet: add about four points on each piece, or import them one by one."
CANVAS: Final = "canvas.tif"


def _pdf_pages(ctx: JobContext, sheet: Sheet) -> list[Sheet] | None:
    pages = extract_pages(sheet.path, ctx.local("pages"))
    if pages is None:
        return None
    return [Sheet(path, f"{sheet.name} p{index}", str(index)) for index, path in enumerate(pages.files, start=1)]


def expanded(ctx: JobContext, sheets: Sequence[Sheet]) -> list[Sheet] | None:
    """The series' parts with each PDF replaced by its pages; None when a PDF needs a password."""
    found: list[Sheet] = []
    for sheet in sheets:
        pages = _pdf_pages(ctx, sheet) if sniff_file(sheet.path) == "pdf" else [sheet]
        if pages is None:
            return None
        found.extend(pages)
    return found


def _drawn(ctx: JobContext, canvas: UInt8Array, name: str) -> Drawn:
    path = assemble.write_canvas(ctx.local(CANVAS), canvas)
    return drawn_of(path, name, max(canvas.shape[:2]), framed=False)


@dataclass(frozen=True)
class Assembled:
    """A canvas made of a series' parts: the picture, its layout, the parts' names, how, and the joins' quality."""

    canvas: UInt8Array
    layout: assemble.Layout
    names: tuple[str, ...]
    method: str
    quality: JoinQuality | None = None

    def stitched(self) -> Stitched:
        left_out = tuple((self.names[index], NO_JOIN) for index in self.layout.left_out)
        return Stitched(self.canvas, self.method, len(self.names), left_out, joins=self.quality)


def _assembled(ctx: JobContext, series: SeriesJob, made: Assembled) -> StepResult:
    """The canvas placed as one map; when it waits for a person, its stitched picture goes with it."""
    layout = made.layout
    ctx.log.info(f"assembled {len(layout.placed)} parts, {len(layout.left_out)} left out, {layout.holes} holes", ctx.step)
    result = place_map(ctx, series, _drawn(ctx, made.canvas, made.method), made.method, len(layout.placed))
    if isinstance(result, Waiting):
        ctx.update_version({"help.stitched": publish_stitched(ctx, made.stitched())})
    return result


class SinglePlacer:
    """Class c: one map (a raster, or a one-page PDF)."""

    def place(self, ctx: JobContext) -> StepResult:
        series = series_of(ctx)
        sheets = expanded(ctx, series.sheets[:1])
        if sheets is None:
            return wait_for_help(ctx, "low-confidence", PDF_LOCKED)
        if not sheets:
            return wait_for_help(ctx, "low-confidence", NO_PAGES)
        result = place_map(ctx, series, drawn_of(sheets[0].path, sheets[0].name))
        if isinstance(result, Waiting):
            picture = read_working(sheets[0].path, LARGEST_WORKING_PX).image
            ctx.update_version({"help.stitched": publish_stitched(ctx, Stitched(picture, "single", 1))})
        return result


def page_px(count: int) -> int:
    """How large each page is read so the assembled atlas stays within `CANVAS_MAX_PX` on its long side."""
    return max(assemble.PAGE_PX, assemble.CANVAS_MAX_PX // max(1, math.ceil(math.sqrt(count)) + 1))


class AtlasPlacer:
    """An atlas: on an overview when the archive has one, else laid out by their edges or overlaps."""

    def place(self, ctx: JobContext) -> StepResult:
        series = series_of(ctx)
        overviewed = _try_overview(ctx, series)
        if overviewed is not None:
            return _assembled(ctx, series, overviewed)
        sheets = expanded(ctx, series.sheets)
        if not sheets:
            return wait_for_help(ctx, "low-confidence", PDF_LOCKED if sheets is None else NO_PAGES)
        return _atlas(ctx, series, sheets)


def _atlas(ctx: JobContext, series: SeriesJob, sheets: Sequence[Sheet]) -> StepResult:
    """The pages cropped to their frames and laid out on their median size by their edges, or by their overlaps when those join
    more pages; assembled and placed."""
    pages, cell = _pages(sheets)
    layout = assemble.atlas_layout(pages, cell)
    names = tuple(sheet.name for sheet in sheets)
    overlapping = _overlapping(sheets, len(layout.placed))
    if overlapping is not None:
        ctx.log.info(f"the pages join better by their overlaps: {len(overlapping.layout.placed)} against {len(layout.placed)}", ctx.step)
        canvas = assemble.compose_canvas(overlapping.images, overlapping.layout)
        return _assembled(ctx, series, Assembled(canvas, overlapping.layout, names, "atlas", overlapping.quality))
    return _assembled(ctx, series, Assembled(assemble.compose_canvas(pages, layout), layout, names, "atlas"))


def _pages(sheets: Sequence[Sheet]) -> tuple[list[UInt8Array], tuple[int, int]]:
    """The pages cropped to their frames, and their median size."""
    pages = [assemble.frame_crop(image) for image in assemble.read_parts([sheet.path for sheet in sheets], page_px(len(sheets)))]
    return pages, (int(numpy.median([page.shape[1] for page in pages])), int(numpy.median([page.shape[0] for page in pages])))


def _overlapping(sheets: Sequence[Sheet], by_edges: int) -> joins.Joined | None:
    """The pages joined by their overlaps when their edges left some out and the overlaps place more of them; else None."""
    if by_edges >= len(sheets):
        return None
    found = joins.joined([sheet.path for sheet in sheets])
    return found if found is not None and len(found.layout.placed) > by_edges else None


def _overview_layout(names: tuple[str, ...], report: MosaicReport, size: tuple[int, int]) -> assemble.Layout:
    """A layout that only records which parts landed on the overview (identity transforms; the canvas is already drawn)."""
    index = {name: position for position, name in enumerate(names)}
    left = tuple(index[name] for name in report.unplaced if name in index)
    kept = set(range(len(names))) - set(left)
    placed = {position: assemble.IDENTITY for position in kept}
    return assemble.Layout(placed, size, left, 0)


def _series_overview(ctx: JobContext, series: SeriesJob) -> Path | None:
    root = store_of(ctx).files(text_param(ctx.job.params, "archiveId"))
    return find_overview(root, [sheet.path for sheet in series.sheets])


def _try_overview(ctx: JobContext, series: SeriesJob) -> Assembled | None:
    """The series' mosaic on its archive overview, or None when no overview is found or too few tiles match."""
    overview = _series_overview(ctx, series)
    if overview is None:
        return None
    made = overview_canvas([(sheet.name, sheet.path) for sheet in series.sheets], overview, CanvasOpts(colour=series.colour))
    if made is None:
        return None
    canvas, report = made
    names = tuple(sheet.name for sheet in series.sheets)
    quality = JoinQuality(links=len(report.placed), mean_inliers=0.0, rms_px=report.rms_px)
    return Assembled(canvas, _overview_layout(names, report, (canvas.shape[1], canvas.shape[0])), names, "overview", quality)


def _pieces_joined(ctx: JobContext, series: SeriesJob) -> StepResult:
    found = joins.joined([sheet.path for sheet in series.sheets])
    if found is None:
        return wait_for_help(ctx, "low-confidence", NO_STITCH)
    names = tuple(sheet.name for sheet in series.sheets)
    canvas = assemble.compose_canvas(found.images, found.layout)
    return _assembled(ctx, series, Assembled(canvas, found.layout, names, "pieces", found.quality))


class PiecesPlacer:
    """Overlapping pieces of one sheet: on an overview when the archive has one, else joined on their overlaps."""

    def place(self, ctx: JobContext) -> StepResult:
        series = series_of(ctx)
        overviewed = _try_overview(ctx, series)
        if overviewed is not None:
            return _assembled(ctx, series, overviewed)
        return _pieces_joined(ctx, series)
