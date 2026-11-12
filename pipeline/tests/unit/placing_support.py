"""What the placers' tests share (docs/research/M20-import-local.md §3): an archive series' job in the fake world, its sheets on disk.

`series_context` makes the job's context with its sheets already gathered (the local `sheets.json` `gather` leaves), the files written
where the archive keeps its originals, and OpenStreetMap answering with the synthetic town's streets (`tests.synthetic.town`).
"""

import json
from collections.abc import Mapping, Sequence
from dataclasses import replace
from pathlib import Path

import cv2
import numpy
import pytest
from hcm_pipeline.archive.intake import ArchiveStore
from hcm_pipeline.archive.model import Probe
from hcm_pipeline.documents import Version
from hcm_pipeline.geo import Bounds, to_mercator, zoom_resolution
from hcm_pipeline.joblog import JobLog
from hcm_pipeline.jobs import JobContext, RunFlags
from hcm_pipeline.log import get_logger
from hcm_pipeline.model import Job
from hcm_pipeline.placing import reference
from hcm_pipeline.placing.reference import HALF_WORLD_M, TILE_PX
from hcm_pipeline.steps.gather import SHEETS
from hcm_pipeline.tiles.pack import ArchiveInfo, pack

from tests.fakes.http import Reply
from tests.fakes.world import CITY, JOB_ID, OVERPASS_PATH, PipelineWorld
from tests.synthetic.scenes import CENTRE
from tests.synthetic.town import DEFAULT_TOWN, Drawing, Line, draw_map, overpass_of, town_lines

SERIES_ID = "s-0123456789ab"


def answer_with(world: PipelineWorld, lines: Sequence[Line] | None) -> None:
    """OpenStreetMap answers with `lines` (the town's by default); None: Overpass fails."""
    if lines is None:
        world.http.route("POST", OVERPASS_PATH, lambda _request: Reply(503, b"busy"))
        return
    body = json.dumps(overpass_of(lines))
    world.http.route("POST", OVERPASS_PATH, lambda _request: Reply.json(body))


def archive_of(work: Path) -> tuple[ArchiveStore, str]:
    store = ArchiveStore(work, lambda _path: Probe("tiff", 10, 10, 1, 8, "grey"))
    return store, store.create()


def series_context(
    world: PipelineWorld, tmp_path: Path, sheets: Sequence[str], params: Mapping[str, object], lines: Sequence[Line] | None = ()
) -> JobContext:
    """The job of a series whose `sheets` (paths relative to the archive) already lie in the archive's folder under `tmp_path/work`."""
    world.seed_import()
    answer_with(world, town_lines() if lines == () else lines)
    _store, archive_id = archive_of(tmp_path / "work")
    scratch = tmp_path / "scratch"
    scratch.mkdir(parents=True, exist_ok=True)
    rows = [{"path": path, "cell": None, "bytes": 1, "sha256": "0" * 64} for path in sheets]
    (scratch / SHEETS).write_text(json.dumps({"sheets": rows}), encoding="utf-8")
    full = {"archiveId": archive_id, "seriesId": SERIES_ID, "sheets": len(sheets), "order": 0, "referenceLayerIds": [], **params}
    log = JobLog(world.store, f"{world.job_path()}/logs", world.clock, get_logger("test"))
    job = replace(Job.of(JOB_ID, world.job()), type="archive-series", params=full)
    services = replace(world.services(), archive_root=tmp_path / "work")
    return JobContext(world.config, services, job, Version.of(JOB_ID, world.version()), scratch, RunFlags(), log)


def originals(ctx: JobContext) -> Path:
    """Where the series' originals lie on this computer."""
    root = ctx.services.archive_root
    assert root is not None
    folder = ArchiveStore(root).files(str(ctx.job.params["archiveId"]))
    folder.mkdir(parents=True, exist_ok=True)
    return folder


LADDER_ZOOM = 15


def town_tiles(tree: Path, zoom: int = LADDER_ZOOM, shift_m: float = 0.0) -> Path:
    """The synthetic town drawn as a published layer's `{z}/{x}/{y}.webp` tiles at `zoom` (grey blocks, paper streets), moved `shift_m`
    east."""
    size = TILE_PX * zoom_resolution(zoom)
    cx, cy = to_mercator(*CENTRE)
    reach = DEFAULT_TOWN.half_m + 400
    first, last = int((cx - reach + HALF_WORLD_M) // size), int((cx + reach + HALF_WORLD_M) // size)
    top, bottom = int((HALF_WORLD_M - cy - reach) // size), int((HALF_WORLD_M - cy + reach) // size)
    for x in range(first, last + 1):
        for y in range(top, bottom + 1):
            left, upper = x * size - HALF_WORLD_M + shift_m, HALF_WORLD_M - y * size
            step = zoom_resolution(zoom)
            to_pixels = numpy.array([[1 / step, 0.0, -left / step], [0.0, -1 / step, upper / step]])
            image = draw_map(town_lines(), Drawing(to_pixels, (TILE_PX, TILE_PX), "grey", street_px=5, margin_px=0))
            target = tree / str(zoom) / str(x) / f"{y}.webp"
            target.parent.mkdir(parents=True, exist_ok=True)
            cv2.imwrite(str(target), image)
    return tree


def serve_public(world: PipelineWorld, monkeypatch: pytest.MonkeyPatch) -> None:
    """The public bucket's host is the fake HTTP server (the published layers' tiles)."""
    monkeypatch.setattr(reference, "PUBLIC_BASE_URL", world.http.root_url)


def publish_layer(world: PipelineWorld, tmp_path: Path, layer: str, year: int, shift_m: float = 0.0, **fields: object) -> str:
    """A published version of `layer` with the town as its public tiles (served by range), its year and its `fields`; its id."""
    version = f"v-{layer}"
    archive = tmp_path / f"{layer}.pmtiles"
    tree = town_tiles(tmp_path / f"tree-{layer}", shift_m=shift_m)
    pack(tree, archive, ArchiveInfo(layer, Bounds(26.0, 44.3, 26.2, 44.5), LADDER_ZOOM, LADDER_ZOOM))
    path = f"/{world.config.public_bucket}/tiles/{CITY}/{layer}/{version}.pmtiles"
    world.http.serve(path, archive.read_bytes(), content_type="application/octet-stream")
    outline = [{"lat": 44.3, "lng": 26.0}, {"lat": 44.5, "lng": 26.2}]
    record = {
        "state": "published",
        "layerId": layer,
        "year": year,
        "origin": "archive",
        "output": {"tiles": {"path": "x"}, "outline": outline},
    }
    world.store.seed(f"cities/{CITY}/layerVersions/{version}", {**record, **fields})
    return version
