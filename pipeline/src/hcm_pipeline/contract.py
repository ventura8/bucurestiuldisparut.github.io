"""The constants the pipeline shares with `@hcm/shared` (docs/research/M3-interfaces.md §2, §4, §5).

Each one is the Python twin of a TypeScript constant; `pipeline/tests/contracts/enums.json` holds the agreed
values, `packages/shared/test/schemas/pipeline-contract.test.ts` keeps the TypeScript side equal to it and
`pipeline/tests/unit/test_contract.py` keeps this module equal to it, so a change on either side fails until
both agree. The error codes are `apiError.*` codes of `packages/shared/src/api/errors.ts`.
"""

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Final

JOB_STATUSES: Final = (
    "queued",
    "starting",
    "running",
    "waiting_usgs",
    "mts_processing",
    "awaiting_approval",
    "awaiting_gcps",
    "succeeded",
    "failed",
    "cancelled",
)
FINISHED_JOB_STATUSES: Final = frozenset({"succeeded", "failed", "cancelled"})
JOB_WAIT_REASONS: Final = (
    "usgs-preparing",
    "usgs-maintenance",
    "rate-limited",
    "capacity",
    "guard",
    "gcps",
    "approval",
    "compute-units",
    "deferred",
    "mapbox",
    "worker",
    "free-tier",
    "parts",
)
JOB_STEP_STATES: Final = ("pending", "running", "done", "failed", "skipped")
PIPELINE_STEPS: Final = (
    "fetch",
    "extract",
    "stitch",
    "inspect",
    "locate",
    "reference",
    "georef",
    "align",
    "merge",
    "warp",
    "export",
    "register",
)
# An import's download phase, which the small `fetch` job runs before the job is queued again for its processing on
# `std` or `xl` (finding 56 of 2026-11-01); the Cloud Run job sizes, smallest first.
DOWNLOAD_STEPS: Final = ("fetch", "extract")
JOB_MACHINES: Final = ("fetch", "std", "xl")
PUBLISH_STEPS: Final = ("guard", "upload", "publish", "tiles", "finalize")
JOB_STEPS: Final[Mapping[str, tuple[str, ...]]] = {
    "usgs-import": ("fetch", "extract", "stitch", "locate", "reference", "georef", "warp", "export", "register", *PUBLISH_STEPS),
    "geotiff-import": ("inspect", "reference", "georef", "warp", "export", "register", *PUBLISH_STEPS),
    "regeoref": ("georef", "warp", "export", "register", *PUBLISH_STEPS),
    "republish": PUBLISH_STEPS,
    "layer-delete": ("delete",),
    # `merge` writes the same `warped.tif` a `warp` does, so `export` and `register` run unchanged (M8).
    "layer-join": ("align", "merge", "export", "register", *PUBLISH_STEPS),
}
LAYER_VERSION_STATES: Final = (
    "processing",
    "needs_gcps",
    "awaiting_approval",
    "approved",
    "publishing",
    "published",
    "rejected",
    "superseded",
    "failed",
    "cancelled",
    "joined",
)
USGS_DATASETS: Final = ("corona2", "declassii", "declassiii")
GEOREF_TRANSFORMS: Final = ("affine", "poly2", "tps")
MIN_GCPS: Final[Mapping[str, int]] = {"affine": 3, "poly2": 6, "tps": 10}
GCP_ORIGINS: Final = ("corner", "auto", "manual")
VERSION_FILES: Final = ("scan.tif", "scan-preview.jpg", "reference-osm.png", "reference-s2.jpg", "cog.tif", "preview.png", "studio.tif")
LEASE_SECONDS: Final = 600
HEARTBEAT_SECONDS: Final = 60
USGS_BACKOFF_MINUTES: Final = (30, 60, 120, 240, 480, 720)
SCAN_PREVIEW_MAX_PX: Final = 4096
STUDIO_MAX_BYTES: Final = 300_000_000
# At most this many GCPs per georeferencing (`MAX_GCPS`), the largest scan side (`MAX_SCAN_PIXELS`), log lines per job.
MAX_GCPS: Final = 300
MAX_SCAN_PIXELS: Final = 200_000
MAX_JOB_LOGS: Final = 500
# At most this many frames of one date join into one layer (`JOIN_MAX_PARTS`, docs/research/M8-join-interfaces.md §2).
JOIN_MAX_PARTS: Final = 8
# How a job waits for the USGS download to be prepared, and how long a SIGTERM'd job waits before it runs again.
USGS_PREPARING_MINUTES: Final = 10
REQUEUE_SECONDS: Final = 60
# Every document the pipeline writes is stamped by this writer (`systemWriter('pipeline')`).
PIPELINE_WRITER: Final = "system:pipeline"


@dataclass(frozen=True)
class SearchRange:
    """How far `locate` looks for a frame around where its model puts it (the pipeline's alone, docs/research/M9-calibration.md §1):
    ground metres, the scales relative to the model, and the shears of the film's short side (`calibrate/votes.py`'s `sheared_about`).
    What each was measured on, and what still rests on one frame or none: the table of M9 §1."""

    margin_ground_m: float
    scales: tuple[float, ...]
    shears_deg: tuple[float, ...] = (0.0,)


@dataclass(frozen=True)
class SensorSpec:
    """A camera: its dataset, label name, nominal resolution, tile zooms and Cloud Run machine (`SENSOR_SPECS`).

    `half_angle_deg` is the pipeline's alone (no TypeScript twin, not in `as_contract`): the half scan angle of a panoramic
    camera whose film position follows the angle and the ground its tangent (`georef/panoramic.py`); None: the corner
    homography holds.
    """

    dataset: str
    name: str
    resolution_m: float
    minzoom: int
    maxzoom: int
    machine: str
    half_angle_deg: float | None = None
    full_aspect: float | None = None
    search: SearchRange = SearchRange(30_000.0, (1.0,))

    def as_contract(self) -> dict[str, object]:
        """The camelCase record of `enums.json` (the TypeScript `SensorSpec`)."""
        return {
            "dataset": self.dataset,
            "name": self.name,
            "resolutionM": self.resolution_m,
            "minzoom": self.minzoom,
            "maxzoom": self.maxzoom,
            "machine": self.machine,
        }


_CORONA_SEARCH: Final = SearchRange(30_000.0, (0.85, 1.0, 1.15))
# Corona is panoramic too, but **UNVERIFIED**: it keeps the corner homography until a real run measures its half angle.
SENSOR_SPECS: Final[Mapping[str, SensorSpec]] = {
    "KH-4": SensorSpec("corona2", "KH-4 Corona", 7.5, 10, 15, "std", search=_CORONA_SEARCH),
    "KH-4A": SensorSpec("corona2", "KH-4A Corona", 2.75, 10, 16, "std", search=_CORONA_SEARCH),
    "KH-4B": SensorSpec("corona2", "KH-4B Corona", 1.8, 10, 16, "std", search=_CORONA_SEARCH),
    # The Argon mapping camera: a frame 550 km across at 34 m a pixel, 140 m on the ground. DS09065A089MC039 (1964) was read as KH-4A. Its
    # true place is 20 km from its footprint's, and nothing proves it: no vote agrees, and the proof reaches 14 tiles at most (M9 §14).
    "KH-5": SensorSpec("corona2", "KH-5 Argon", 140, 8, 12, "std", search=SearchRange(30_000.0, (1.0,))),
    # Measured on one frame, DZB00403000026H017001 (1966): 22 km ground off, 8 to 13 % small, and the film a parallelogram, about 9 degrees
    # from the rectangle of its corners (M9 §14).
    "KH-7": SensorSpec("declassii", "KH-7 Gambit", 1.2, 10, 17, "std", search=SearchRange(30_000.0, (1.0, 1.1), (0.0, 7.5, -7.5))),
    # Measured on one frame, DZB1214-500086L005001 (1978): 0.1 km off, 3 % large (M9 §14).
    "KH-9-mapping": SensorSpec("declassii", "KH-9 Hexagon (mapping camera)", 7.5, 10, 15, "std", search=SearchRange(15_000.0, (1.0,))),
    # 60.5 degrees: fitted on the 1972 frame D3C1202-200149F039 (17 hand-read landmarks, 0.24 km RMS after one shift). Its full
    # sweep's film: 19.6 to 20.5 times as long as it is high on four real frames. Scale 0.94: the model is 4 to 9 % large (F006 0.92,
    # F007 0.92, F039 0.956; five more full sweeps 0.915 to 0.950), but a short film's is about right (0.998 to 1.010; A015, 1983, is found
    # only there): the model's own scale first, one warp set more for a full sweep, which agrees at either (M9 §14).
    "KH-9-pan": SensorSpec("declassiii", "KH-9 Hexagon", 1, 10, 17, "xl", 60.5, 20.2, SearchRange(30_000.0, (1.0, 0.94))),
}

# The share of a job's progress each pipeline step stands for (`usgs-import`'s weights add up to 1; other job
# types scale the weights of their own steps to 1, docs/research/M3-interfaces.md §4.4).
STEP_WEIGHTS: Final[Mapping[str, float]] = {
    "fetch": 0.25,
    "extract": 0.05,
    "stitch": 0.10,
    "inspect": 0.10,
    "locate": 0.05,
    "reference": 0.05,
    "georef": 0.20,
    "align": 0.15,
    "merge": 0.25,
    "warp": 0.15,
    "export": 0.10,
    "register": 0.05,
}


class Errors:
    """The `apiError.*` codes a pipeline step fails or waits with (`packages/shared/src/api/errors.ts`)."""

    INVALID_REQUEST: Final = "apiError.invalidRequest"
    RATE_LIMITED: Final = "apiError.rateLimited"
    NOT_FOUND: Final = "apiError.notFound"
    INTERNAL: Final = "apiError.internal"
    UNAVAILABLE: Final = "apiError.unavailable"
    USGS_NOT_CONFIGURED: Final = "apiError.usgs.notConfigured"
    USGS_CREDENTIALS: Final = "apiError.usgs.credentials"
    USGS_MAINTENANCE: Final = "apiError.usgs.maintenance"
    USGS_UNAVAILABLE: Final = "apiError.usgs.unavailable"
    NOT_SCANNED: Final = "apiError.imagery.notScanned"
    UNREADABLE_RASTER: Final = "apiError.imagery.unreadableRaster"
    PROCESSING_FAILED: Final = "apiError.imagery.processingFailed"
    ARCHIVE_CORRUPT: Final = "apiError.imagery.archiveCorrupt"
    DOWNLOAD_INCOMPLETE: Final = "apiError.imagery.downloadIncomplete"
    REFERENCE_UNAVAILABLE: Final = "apiError.imagery.referenceUnavailable"
    CITY_NOT_FOUND: Final = "apiError.imagery.cityNotFound"
    NO_MATCH: Final = "apiError.imagery.noMatch"
    NO_SPREAD: Final = "apiError.imagery.noSpread"
    TOO_FEW_GCPS: Final = "apiError.imagery.tooFewGcps"
    DEGENERATE_GCPS: Final = "apiError.imagery.degenerateGcps"
    GCP_OUTSIDE: Final = "apiError.imagery.gcpOutside"
    NO_SCAN: Final = "apiError.imagery.noScan"
    JOIN_PART_MISSING: Final = "apiError.imagery.joinPartMissing"
    JOIN_SEAM_TOO_FAR: Final = "apiError.imagery.joinSeamTooFar"
    JOIN_NO_FRAMES: Final = "apiError.imagery.joinNoFrames"
    JOIN_NO_ROOM: Final = "apiError.imagery.joinNoRoom"


def pipeline_steps_of(job_type: str) -> tuple[str, ...]:
    """The steps of `job_type` that the raster pipeline runs, in order (none for a type it does not run)."""
    return tuple(step for step in JOB_STEPS.get(job_type, ()) if step in PIPELINE_STEPS)


def step_weights(job_type: str) -> dict[str, float]:
    """Each pipeline step's share of the job's progress, scaled so the job's steps add up to 1."""
    steps = pipeline_steps_of(job_type)
    total = sum(STEP_WEIGHTS[step] for step in steps)
    return {step: STEP_WEIGHTS[step] / total for step in steps}
