"""The placers of drawn maps (docs/research/M20-import-local.md §3 c, *Atlases and pieces*, *PDFs*): single, atlas and pieces.

A single map is placed by its streets as it is. An atlas's pages (image files, or a PDF's pages taken out with pikepdf) and overlapping
pieces are first assembled into one canvas in the job's scratch folder (`assemble`), then placed as one map: many junctions over the
whole city are far stronger than page by page. A PDF that needs a password waits for a person (`low-confidence`: the owner exports its
pages). Pages or pieces that join nothing are left out: the job's log says how many, and the version's placed count leaves them out.
"""

import math
from collections.abc import Sequence
from typing import Final

import numpy

from hcm_pipeline.archive.magic import sniff_file
from hcm_pipeline.jobs import JobContext, StepResult
from hcm_pipeline.placing import assemble
from hcm_pipeline.placing.output import wait_for_help
from hcm_pipeline.placing.pdfpages import extract_pages
from hcm_pipeline.placing.series import SeriesJob, Sheet, series_of
from hcm_pipeline.placing.single import Drawn, drawn_of, place_map
from hcm_pipeline.placing.streets import UInt8Array

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


def _assembled(ctx: JobContext, series: SeriesJob, canvas: UInt8Array, layout: assemble.Layout, method: str) -> StepResult:
    left_out = len(layout.left_out)
    ctx.log.info(f"assembled {len(layout.placed)} parts, {left_out} left out, {layout.holes} holes", ctx.step)
    return place_map(ctx, series, _drawn(ctx, canvas, method), method, len(layout.placed))


class SinglePlacer:
    """Class c: one map (a raster, or a one-page PDF)."""

    def place(self, ctx: JobContext) -> StepResult:
        series = series_of(ctx)
        sheets = expanded(ctx, series.sheets[:1])
        if sheets is None:
            return wait_for_help(ctx, "low-confidence", PDF_LOCKED)
        if not sheets:
            return wait_for_help(ctx, "low-confidence", NO_PAGES)
        return place_map(ctx, series, drawn_of(sheets[0].path, sheets[0].name))


def page_px(count: int) -> int:
    """How large each page is read so the assembled atlas stays within `CANVAS_MAX_PX` on its long side."""
    return max(assemble.PAGE_PX, assemble.CANVAS_MAX_PX // max(1, math.ceil(math.sqrt(count)) + 1))


class AtlasPlacer:
    """An atlas: its pages laid out by their edges and assembled, then placed as one map."""

    def place(self, ctx: JobContext) -> StepResult:
        series = series_of(ctx)
        sheets = expanded(ctx, series.sheets)
        if not sheets:
            return wait_for_help(ctx, "low-confidence", PDF_LOCKED if sheets is None else NO_PAGES)
        return _atlas(ctx, series, sheets)


def _atlas(ctx: JobContext, series: SeriesJob, sheets: Sequence[Sheet]) -> StepResult:
    """The pages cropped to their frames, laid out on their median size, assembled and placed."""
    pages = [assemble.frame_crop(image) for image in assemble.read_parts([sheet.path for sheet in sheets], page_px(len(sheets)))]
    cell = (int(numpy.median([page.shape[1] for page in pages])), int(numpy.median([page.shape[0] for page in pages])))
    layout = assemble.atlas_layout(pages, cell)
    return _assembled(ctx, series, assemble.compose_canvas(pages, layout), layout, "atlas")


class PiecesPlacer:
    """Overlapping pieces of one sheet: stitched on their overlaps, then placed as one map."""

    def place(self, ctx: JobContext) -> StepResult:
        series = series_of(ctx)
        images = assemble.read_parts([sheet.path for sheet in series.sheets], assemble.MATCH_PX)
        layout = assemble.pieces_layout(images)
        if layout is None:
            return wait_for_help(ctx, "low-confidence", NO_STITCH)
        return _assembled(ctx, series, assemble.compose_canvas(images, layout), layout, "pieces")
