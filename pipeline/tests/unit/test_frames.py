"""A frame stitched and cropped window by window, never whole in memory (finding 57 of 2026-11-01)."""

import tracemalloc
from pathlib import Path
from typing import cast

import cv2
import numpy
import pytest
from hcm_pipeline.frames import FrameLayout, Placement, Segment
from hcm_pipeline.georef.corners import Crop
from hcm_pipeline.jobs import JobContext
from hcm_pipeline.objects import ObjectInfo
from hcm_pipeline.raster import gdal
from hcm_pipeline.rasters import GeoTiff, write_geotiff
from hcm_pipeline.runner import RunOutcome
from hcm_pipeline.steps import stitch
from hcm_pipeline.steps.locate import crop_pixels

from tests.fakes.world import CITY, JOB_ID, PipelineWorld

WORK = f"work/{CITY}/{JOB_ID}/"
HEIGHT, SEGMENT_WIDTH, STEP = 4000, 1000, 800
# Finding 76's copy of a strip inside the left segment: a multiple of the coarse shrink.
DECOY = 196
SEGMENTS = 6


def scan() -> numpy.ndarray:
    """A textured film frame: blurred noise, so every overlap has one best match."""
    noise = numpy.random.default_rng(57).integers(0, 256, (HEIGHT, STEP * (SEGMENTS - 1) + SEGMENT_WIDTH), dtype=numpy.uint8)
    return numpy.asarray(cv2.GaussianBlur(noise, (5, 5), 0), numpy.uint8)


def tiff(tmp_path: Path, pixels: numpy.ndarray, name: str) -> bytes:
    return write_geotiff(tmp_path / name, GeoTiff([pixels]), ("TILED=YES",)).read_bytes()


def segmented(world: PipelineWorld, tmp_path: Path, frame: numpy.ndarray) -> None:
    for index in range(SEGMENTS):
        part = frame[:, index * STEP : index * STEP + SEGMENT_WIDTH]
        world.gcs.put(f"{WORK}segments/{chr(ord('a') + index)}.tif", tiff(tmp_path, numpy.ascontiguousarray(part), f"{index}.tif"))


def test_happy_path_a_frame_larger_than_the_memory_it_uses_is_stitched_exactly(
    world: PipelineWorld, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Scenarios: S-P01-HAPPY-BOUNDED-MEMORY"""
    # The preview's cap scaled as the frame is (16384 px of a KH-9 frame's 300 000): a small share of the frame.
    monkeypatch.setattr(stitch, "PREVIEW_MAX_PX", 1024)
    frame = scan()
    segmented(world, tmp_path, frame)
    world.seed_import()

    peaks: list[int] = []
    publish = JobContext.publish

    def measured(ctx: JobContext, local: Path, object_path: str, content_type: str) -> ObjectInfo:
        # The in-process fake bucket's own upload handling is no memory of the pipeline's: measured up to it, then past it.
        peaks.append(tracemalloc.get_traced_memory()[1])
        info = publish(ctx, local, object_path, content_type)
        tracemalloc.reset_peak()
        return info

    monkeypatch.setattr(JobContext, "publish", measured)
    tracemalloc.start()
    outcome = world.runner().run("stitch")
    peak = max([*peaks, tracemalloc.get_traced_memory()[1]])
    tracemalloc.stop()

    assert outcome is RunOutcome.DONE
    layout = FrameLayout.from_json(world.gcs.objects[f"{WORK}frame.json"].data.decode())
    assert [(placement.x, placement.y) for placement in layout.placements] == [(index * STEP, 0) for index in range(SEGMENTS)]
    assert (layout.width, layout.height) == (frame.shape[1], HEIGHT)
    # The old step held every segment and the joined frame (over 2.5 times the frame); this one two segments' windows.
    assert peak < frame.nbytes / 2
    assert f"{WORK}frame-preview.tif" in world.gcs.objects


def test_bad_path_a_copy_of_the_strip_deep_inside_the_left_segment_is_not_where_the_right_one_starts(tmp_path: Path) -> None:
    """Scenarios: S-P01-BAD-STITCH-DECOY"""
    frame = scan()
    left, right = frame[:, :SEGMENT_WIDTH].copy(), frame[:, STEP : STEP + SEGMENT_WIDTH].copy()
    # The right segment's left strip again at a fifth of the left one (an overlap of 80 %), exactly and on the coarse
    # grid (7 px: 4000 rows shrunk to about 512); the true overlap grainy, as a scan's is, so a search across the whole
    # segment prefers the copy.
    left[:, DECOY : DECOY + 300] = right[:, :300]
    grain = numpy.random.default_rng(76).integers(-60, 61, left[:, STEP:].shape)
    left[:, STEP:] = numpy.clip(left[:, STEP:].astype(numpy.int16) + grain, 0, 255).astype(numpy.uint8)
    paths = [tmp_path / name for name in ("a.tif", "b.tif")]
    for path, pixels in zip(paths, (left, right), strict=True):
        path.write_bytes(tiff(tmp_path, numpy.ascontiguousarray(pixels), f"{path.stem}-src.tif"))
    segments = [Segment(path) for path in paths]

    offset = stitch.pair_offset(*segments)
    for segment in segments:
        segment.close()

    assert offset == (STEP, 0)


class Staging:
    """What `crop_pixels` asks of a run: each segment staged on demand and let go."""

    def __init__(self, files: dict[str, Path]) -> None:
        self.files = files
        self.staged: list[str] = []
        self.let_go: list[str] = []

    def stage(self, object_path: str) -> Path:
        self.staged.append(object_path)
        return self.files[object_path]

    def unstage(self, object_path: str) -> None:
        self.let_go.append(object_path)

    def checkpoint(self) -> None:
        return None


def test_bad_path_a_crop_across_two_segments_reads_both_and_one_past_them_stays_black(tmp_path: Path) -> None:
    """Scenarios: S-P01-BAD-CROP-ACROSS-SEGMENTS"""
    frame = numpy.arange(40 * 60, dtype=numpy.uint32).reshape(40, 60).astype(numpy.uint16) * 7
    left, right = frame[:, :36], frame[:, 30:]
    files = {"a": write_geotiff(tmp_path / "a.tif", GeoTiff([left.astype(numpy.uint8)])), "b": tmp_path / "b.tif"}
    # The right segment is 16-bit: read through its own linear stretch to 8 bits.
    driver = gdal.GetDriverByName("GTiff")
    assert driver is not None
    dataset = driver.Create(str(files["b"]), right.shape[1], right.shape[0], 1, gdal.GDT_UInt16)
    dataset.GetRasterBand(1).WriteArray(right)
    dataset.Close()
    layout = FrameLayout(60, 40, 1, (Placement("a", 0, 0, 36, 40), Placement("b", 30, 0, 30, 40)))
    staging = Staging(files)

    across = crop_pixels(cast(JobContext, staging), layout, Crop(20, 5, 20, 10, ()))
    beyond = crop_pixels(cast(JobContext, staging), layout, Crop(60, 0, 4, 4, ()))

    stretched = Segment(files["b"]).read(0, 5, 10, 10)
    assert numpy.array_equal(across[:, :10], left.astype(numpy.uint8)[5:15, 20:30])
    assert numpy.array_equal(across[:, 10:], stretched)
    assert staging.staged == ["a", "b"]
    assert staging.let_go == staging.staged
    assert (beyond.shape, int(beyond.max())) == ((4, 4), 0)
