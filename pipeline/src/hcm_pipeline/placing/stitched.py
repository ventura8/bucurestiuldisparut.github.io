"""The stitched picture a waiting series leaves (docs/research/M22-help-calibrate.md §4.1): the admin works on one picture, never on
thousands of sheets.

Whatever a grid, an atlas or a pieces series could not prove on its own, its sheets were already joined into one canvas (the grid's
mosaic from its names and frames, the atlas's pages by their edges or their overlaps, the pieces by their overlaps). That canvas is
kept beside the job's files (`stitched.tif`: it stays where the job runs, as `warped.tif` does) and a preview of it (`stitched.jpg`, its
long side at most `PREVIEW_PX`, the georeferencer's own preview size) goes up with the version, which the Help calibrate wizard lays
over the map. The georeferencer gets it too, as it gets a frame's: the picture as the version's `scan` (`scan.tif`, at most
`SCAN_MAX_PX` long, and `scan-preview.jpg`) and the city window's OpenStreetMap lines as its `reference` (`reference-osm.png`), so an
archive series waiting for points opens there like any frame (never Mapbox Satellite). The version's `help.stitched` says what it
holds: its size, how many parts joined, which were left out and why, and the joins' quality (the matched overlaps' inliers and
their residual, in canvas pixels).
"""

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final

from hcm_pipeline.archive import model
from hcm_pipeline.documents import ReferenceInfo
from hcm_pipeline.geo import Grid
from hcm_pipeline.images import resize, write_jpeg, write_png
from hcm_pipeline.jobs import JobContext, Waiting
from hcm_pipeline.osm import draw
from hcm_pipeline.placing import assemble
from hcm_pipeline.placing.output import wait_for_help
from hcm_pipeline.placing.reference import city_window, osm_features_cached, window_resolution
from hcm_pipeline.placing.streets import UInt8Array
from hcm_pipeline.steps.common import publish_scan
from hcm_pipeline.steps.reference import osm_overlay

STITCHED: Final = "stitched.tif"
PREVIEW: Final = "stitched.jpg"
PREVIEW_PX: Final = 4096
PREVIEW_QUALITY: Final = 85
# The georeferencer's scan of a stitched picture: at most this long (its pairs are in these pixels).
SCAN_MAX_PX: Final = 8192
REFERENCE_PX: Final = 4096
LEFT_OUT_MAX: Final = 200
NAME_MAX: Final = 200
# Why a part is not in the stitched picture: no frame was found on it (a grid's sheet), or it shares no edge or overlap.
NO_FRAME: Final = "no-frame"
NO_JOIN: Final = "no-join"


@dataclass(frozen=True)
class JoinQuality:
    """The joins found by matching: how many, their agreeing matches on average, and the inliers' residual (canvas pixels)."""

    links: int
    mean_inliers: float
    rms_px: float

    def as_record(self) -> dict[str, object]:
        return {"links": self.links, "meanInliers": round(self.mean_inliers, 1), "rmsPx": round(self.rms_px, 2)}


@dataclass(frozen=True)
class Stitched:
    """A series' parts joined on one canvas: how (`model.STITCH_METHODS`), how many parts and which were left out."""

    canvas: UInt8Array
    method: str
    parts: int
    left_out: tuple[tuple[str, str], ...] = ()
    metres_per_px: float | None = None
    joins: JoinQuality | None = None

    @property
    def joined(self) -> int:
        return max(0, self.parts - len(self.left_out))


def _preview(canvas: UInt8Array, longest: int = PREVIEW_PX) -> tuple[UInt8Array, float]:
    height, width = canvas.shape[:2]
    scale = min(1.0, longest / max(width, height))
    if scale >= 1.0:
        return canvas, 1.0
    return resize(canvas, (max(1, round(width * scale)), max(1, round(height * scale)))), scale


def _left_out(found: Sequence[tuple[str, str]]) -> list[dict[str, str]]:
    return [{"name": name[:NAME_MAX], "reason": reason} for name, reason in found[:LEFT_OUT_MAX]]


def publish_stitched(ctx: JobContext, stitched: Stitched) -> dict[str, object]:
    """The canvas kept with the job's files, its preview with the version's; the record `help.stitched` keeps.

    A method the server's schema does not know is refused here, before any file is published: the worker's write would be refused
    after minutes of work (`overview`, harti.zip 1895, lesson 569).
    """
    if stitched.method not in model.STITCH_METHODS:
        raise ValueError(f"unknown stitch method {stitched.method!r}")
    canvas = assemble.write_canvas(ctx.local(STITCHED), stitched.canvas)
    ctx.publish(canvas, ctx.work_file(STITCHED), "image/tiff")
    small, scale = _preview(stitched.canvas)
    preview = ctx.publish(write_jpeg(ctx.local(PREVIEW), small, PREVIEW_QUALITY), ctx.version_file(PREVIEW), "image/jpeg")
    height, width = stitched.canvas.shape[:2]
    record: dict[str, object] = {
        "previewPath": preview.path,
        "previewScale": round(scale, 6),
        "width": width,
        "height": height,
        "method": stitched.method,
        "parts": stitched.parts,
        "joined": stitched.joined,
        "leftOut": _left_out(stitched.left_out),
        "leftOutCount": len(stitched.left_out),
    }
    if stitched.metres_per_px is not None:
        record["metresPerPx"] = round(stitched.metres_per_px, 4)
    if stitched.joins is not None:
        record["joins"] = stitched.joins.as_record()
    ctx.log.info(f"stitched {stitched.joined} of {stitched.parts} parts into one {width} x {height} picture for a person", ctx.step)
    _for_georeferencer(ctx, stitched.canvas)
    return record


def _for_georeferencer(ctx: JobContext, canvas: UInt8Array) -> None:
    """The picture as the version's `scan` and the city window's OpenStreetMap lines as its `reference`: what the georeferencer shows."""
    pixels, _ = _preview(canvas, SCAN_MAX_PX)
    local = assemble.write_canvas(ctx.local("scan.tif"), pixels)
    fields: dict[str, object] = {"scan": publish_scan(ctx, local, pixels).as_record()}
    window = city_window(ctx)
    features = None if window is None else osm_features_cached(ctx, window)
    if window is not None and features is not None:
        grid = Grid.over(window, window_resolution(window, REFERENCE_PX))
        image = write_png(ctx.local("reference-osm.png"), osm_overlay(draw(features, grid)))
        path = ctx.publish(image, ctx.version_file("reference-osm.png"), "image/png").path
        fields["reference"] = ReferenceInfo(window.bounds(), path).as_record()
    ctx.update_version(fields)


def wait_stitched(ctx: JobContext, stitched: Stitched, reason: str, note: str) -> Waiting:
    """The version waits for a person with its stitched picture to place."""
    return wait_for_help(ctx, reason, note, stitched=publish_stitched(ctx, stitched))
