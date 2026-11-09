"""`locate`: where the frame lies, and the city crop (docs/research/M3-interfaces.md §5.4, docs/research/M9-calibration.md).

The scene's corners (else its footprint's extremes) give the plausible orientations; `calibrate/` looks for the frame by the tile votes
over its preview and proves what they propose with no landmark. **Proved:** the crop is what the frame reaches of the city window, through
the proved map, on the exposure; the tiles go to `calibration.json` for `georef`, so a retry does not measure them again, and the USGS
delivery is deleted (M7 §5). **Not proved:** `bounded_crop` holds the window with a margin under the orientations that reach it, cut to
what a scan may hold; the delivery stays, the matcher still runs and the admin's points are next. A frame that does not reach the window
fails with `apiError.imagery.cityNotFound`; a panoramic camera's frame is read on its exposure alone. Finding 57 of 2026-11-01: the frame
is never read whole; the search reads `stitch`'s shrunk preview, and everything else is read window by window out of the segments, each
staged, read and let go in turn. `version.calibration` records what happened; it is what the admin shows.
"""

import math
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Final

import numpy

from hcm_pipeline.calibrate.camera import PANORAMIC_MAP_SENSORS
from hcm_pipeline.calibrate.chain import Found, FrameSearch, find_frame
from hcm_pipeline.calibrate.dense import Box
from hcm_pipeline.calibrate.poly import PlaceMap
from hcm_pipeline.calibrate.prior import MeasuredModel, pass_key
from hcm_pipeline.calibrate.proof import Proof
from hcm_pipeline.calibrate.reach import measured_pct, outline, proved_box, reach_of
from hcm_pipeline.calibrate.stored import StoredTiles
from hcm_pipeline.calibrate.strip import Windowed, best_of, searches
from hcm_pipeline.contract import MAX_SCAN_PIXELS, SENSOR_SPECS, Errors, SensorSpec
from hcm_pipeline.documents import GeorefInfo, Scene, city_bounds
from hcm_pipeline.frames import FRAME_JSON, FRAME_PREVIEW, FrameLayout, Placement, Segment
from hcm_pipeline.geo import Grid, MercatorBox, fnv1a, to_lnglat, to_mercator
from hcm_pipeline.georef.corners import (
    Assignment,
    CityNotFoundError,
    Crop,
    Frame,
    around,
    bounded_crop,
    first_guesses,
    frame_corners,
    inside_world,
    on_exposure,
    reaching,
)
from hcm_pipeline.georef.panoramic import PanoramicCamera
from hcm_pipeline.georef.transforms import Gcp
from hcm_pipeline.images import UInt8Array, as_uint8, resize, seeded
from hcm_pipeline.jobs import Done, JobContext, StepFailedError, StepResult
from hcm_pipeline.model import UsgsImportParams
from hcm_pipeline.rasters import GeoTiff, read_band, to_uint8, write_geotiff
from hcm_pipeline.steps.common import city_window, gdal_step, grey_reference, publish_scan, sentinel2

# The frame is shrunk until a pixel is about this many metres before the votes read it.
SCORING_PIXEL_M: Final = 30.0
# The step whose output is the USGS delivery, and the prefix every delivery lives under (`paths.usgs_raw`).
DELIVERY_STEP: Final = "fetch"
USGS_RAW_PREFIX: Final = "usgs-raw/"
# A film this share of the sensor's full aspect or longer swept the whole angle (four real KH-9 frames: 19.6 to 20.5 for 20.2).
FULL_SWEEP_SHARE: Final = 0.9
PERCENT: Final = 100.0


def _scene(ctx: JobContext, entity: UsgsImportParams) -> Scene:
    record = ctx.read(f"cities/{ctx.city}/usgsScenes/{entity.entity_id}")
    if record is None:
        raise StepFailedError(Errors.NOT_FOUND, f"the scene {entity.entity_id} is not harvested")
    return Scene.of(entity.entity_id, record)


def frame_pixel_m(scene: Scene, size: tuple[int, int]) -> float:
    """The frame's approximate pixel size in EPSG:3857 metres: its longer side on the ground over its longer side on film. A strip may
    run north-south and be scanned with that side as its width: its short edge over its width read ten times too fine, and the votes
    got a preview shrunk ten times too far."""
    (nw_lat, nw_lng), (ne_lat, ne_lng), (se_lat, se_lng), _ = around(scene.corner_quad(), scene.corner_quad()[0][1])
    (x0, y0), (x1, y1), (x2, y2) = to_mercator(nw_lng, nw_lat), to_mercator(ne_lng, ne_lat), to_mercator(se_lng, se_lat)
    return max(max(math.hypot(x1 - x0, y1 - y0), math.hypot(x2 - x1, y2 - y1)) / max(size), 1e-3)


def scoring_frame(preview: Path, width: int, height: int, pixel_m: float) -> Frame:
    """The frame (`width` by `height` at full resolution) from its preview, averaged to about `SCORING_PIXEL_M` per pixel. A blur
    only costs the votes (the 1982 frame: 15 tiles agree with one cell of it, 17 without). Never enlarged: it holds nothing the preview
    does not, and a side over 32 767 pixels is more than `cv2.remap` takes
    (a KH-9 frame over 2 m a pixel by its corners would be: its corners' pixel is the whole frame's mean, not the nadir's)."""
    pixels = to_uint8(read_band(preview, 1))
    factor = max(1.0, SCORING_PIXEL_M / pixel_m)
    size = (max(1, round(width / factor)), max(1, round(height / factor)))
    shrunk = resize(pixels, size) if size[0] < pixels.shape[1] else pixels
    return Frame(shrunk, width / shrunk.shape[1], width, height)


def shorter_sweep(spec: SensorSpec, layout: FrameLayout) -> float | None:
    """How far a camera swung for a film shorter than its full sweep's (the film runs at one angle a pixel); None: the full sweep."""
    aspect = layout.image_width / max(layout.height, 1)
    if spec.half_angle_deg is None or spec.full_aspect is None or aspect >= FULL_SWEEP_SHARE * spec.full_aspect:
        return None
    return 2 * spec.half_angle_deg * aspect / spec.full_aspect


def camera_of(sensor: str, layout: FrameLayout) -> PanoramicCamera | None:
    """The panoramic model's camera when the sensor has a half angle; the exposure's span from `stitch`'s `exposure_span`."""
    spec = SENSOR_SPECS[sensor]
    half_angle = spec.half_angle_deg
    return None if half_angle is None else PanoramicCamera(half_angle, layout.image_width, layout.image_start, shorter_sweep(spec, layout))


def rad_per_px(sensor: str, layout: FrameLayout) -> float | None:
    """Radians a film column of a camera `georef` fits a panoramic map for (M15 §2): its sweep over the exposure, a shorter film's at the
    full film's rate; None for any other camera."""
    spec = SENSOR_SPECS[sensor]
    half, aspect = spec.half_angle_deg, spec.full_aspect
    if sensor not in PANORAMIC_MAP_SENSORS or half is None or aspect is None:
        return None
    full = aspect * layout.height
    span = full if shorter_sweep(spec, layout) is not None else min(layout.image_width, full)
    return math.radians(2 * half) / max(span, 1.0)


def film_limits(camera: PanoramicCamera | None, layout: FrameLayout) -> tuple[int, int, int]:
    """What a crop may hold: up to this column, up to this row, from this column (a panoramic camera's frame: its exposure)."""
    return (
        (layout.width, layout.height, 0) if camera is None else (camera.image_start + camera.image_width, layout.height, camera.image_start)
    )


def crop_pixels(ctx: JobContext, layout: FrameLayout, box: Crop) -> UInt8Array:
    """The frame's pixels in `box`, read from the segments that cover it, one at a time (a later one on top)."""
    window = (box.left, box.top, box.width, box.height)
    pixels = numpy.zeros((box.height, box.width), numpy.uint8)
    for placement in layout.covering(window):
        x, y, width, height = placement.window(window) or window
        segment = Segment(ctx.stage(placement.path))
        part = segment.read(x - placement.x, y - placement.y, width, height)
        pixels[y - box.top : y - box.top + height, x - box.left : x - box.left + width] = part
        segment.close()
        ctx.unstage(placement.path)
        ctx.checkpoint()
    return as_uint8(pixels)


def delete_delivery(ctx: JobContext) -> None:
    """The job's USGS delivery deleted once the city crop and the version's scan are recorded (M7 §5): only a
    `usgs-raw/` object, a missing one is fine (a retry of `locate`, or another city's job deleted it first)."""
    delivery = ctx.job.step(DELIVERY_STEP).gcs_path
    if delivery is None or not delivery.startswith(USGS_RAW_PREFIX):
        return
    ctx.services.objects.delete(delivery)
    ctx.log.info(f"the USGS delivery {delivery} is deleted: the city crop is recorded", LocateStep.name)


class SegmentReader:
    """The film of a job's frame, read by windows out of its segments, each staged and let go in turn."""

    def __init__(self, ctx: JobContext, layout: FrameLayout) -> None:
        self._ctx, self._layout = ctx, layout

    def read(self, box: Box, factor: int) -> UInt8Array:
        """`box` (left, top, right, bottom) averaged `factor` times; a later segment on top."""
        left, top, right, bottom = box
        pixels = numpy.zeros(((bottom - top) // factor, (right - left) // factor), numpy.uint8)
        for placement in self._layout.covering((left, top, right - left, bottom - top)):
            self._onto(pixels, placement, box, factor)
        return as_uint8(pixels)

    def _onto(self, pixels: UInt8Array, placement: Placement, box: Box, factor: int) -> None:
        first_x, first_y = -((box[0] - placement.x) // factor), -((box[1] - placement.y) // factor)
        last_x = min((placement.x + placement.width - box[0]) // factor, pixels.shape[1])
        last_y = min((placement.y + placement.height - box[1]) // factor, pixels.shape[0])
        first_x, first_y = max(first_x, 0), max(first_y, 0)
        if last_x <= first_x or last_y <= first_y:
            return
        x, y = box[0] + first_x * factor - placement.x, box[1] + first_y * factor - placement.y
        size = (last_x - first_x, last_y - first_y)
        segment = Segment(self._ctx.stage(placement.path))
        pixels[first_y:last_y, first_x:last_x] = segment.averaged_window(x, y, size[0] * factor, size[1] * factor, size)
        segment.close()
        self._ctx.unstage(placement.path)
        self._ctx.checkpoint()


def proved_gcps(mapping: PlaceMap, box: Box) -> tuple[Gcp, ...]:
    """Four GCPs at the crop's corners through the proved map (`origin: 'corner'`): they stand until `georef` fits the tiles."""
    offset = numpy.array([box[0], box[1]])
    corners = inside_world(frame_corners(box[2] - box[0], box[3] - box[1]), lambda crop: mapping.to_places(crop + offset))
    places = mapping.to_places(corners + offset)
    gcps = []
    for index, (corner, place) in enumerate(zip(corners.tolist(), places.tolist(), strict=True), start=1):
        lng, lat = to_lnglat(place[0], place[1])
        gcps.append(Gcp(f"c{index}", corner[0], corner[1], lat, lng, True, "corner"))
    return tuple(gcps)


def _wide_reference(ctx: JobContext, box: MercatorBox) -> tuple[UInt8Array, Grid] | None:
    """Sentinel-2 over the wider box a matcher's proposal is proved on (M10); one that cannot be had costs the matcher, not the job."""
    try:
        source = sentinel2(ctx, box)
    except StepFailedError as error:
        ctx.log.warn(f"the wider reference is not to be had ({error}): the proposal is proved over the city's window", LocateStep.name)
        return None
    return grey_reference(source), source.grid()


def _pass_prior(ctx: JobContext, scene: Scene) -> MeasuredModel | None:
    """The last proved frame of the scene's pass, when the city has one (only a first place to look)."""
    key = pass_key(scene.entity_id, scene.acquisition_date)
    record = None if key is None else ctx.read(f"cities/{ctx.city}/imageryPasses/{key}")
    return None if record is None else MeasuredModel.of(record.get("model"))


@dataclass(frozen=True)
class Proved:
    """A proof that holds a map: its verdict, the map and the polynomial's order."""

    proof: Proof
    mapping: PlaceMap
    order: int


class LocateStep:
    name = "locate"

    def run(self, ctx: JobContext) -> StepResult:
        entity = UsgsImportParams.of(ctx.job.params)
        scene = _scene(ctx, entity)
        window = city_window(ctx)
        layout = FrameLayout.from_json(ctx.stage(ctx.work_file(FRAME_JSON), FRAME_JSON).read_text(encoding="utf-8"))
        preview = ctx.stage(ctx.work_file(FRAME_PREVIEW), FRAME_PREVIEW)
        try:
            windows = self._search(ctx, (scene, entity.sensor), window, preview, layout)
            say = self._say(ctx)
            search, found = gdal_step(
                ctx, lambda: best_of(windows, lambda each: find_frame(each, ctx.checkpoint, say), say), "search the frame"
            )
            return self._cropped(ctx, search, found, layout)
        except CityNotFoundError as error:
            raise StepFailedError(Errors.CITY_NOT_FOUND, str(error)) from error

    def _cropped(self, ctx: JobContext, search: FrameSearch, found: Found, layout: FrameLayout) -> StepResult:
        proof = found.proof
        if proof is None or proof.mapping is None or proof.forward is None:
            return self._not_proved(ctx, search, found, layout)
        return self._proved(ctx, search, found, Proved(proof, proof.mapping, proof.forward.order), layout)

    def _say(self, ctx: JobContext) -> Callable[[str], None]:
        return lambda line: ctx.log.info(line, self.name)

    def _search(self, ctx: JobContext, shot: tuple[Scene, str], window: MercatorBox, preview: Path, layout: FrameLayout) -> list[Windowed]:
        scene, sensor = shot
        source = sentinel2(ctx, window)
        grid = source.grid()
        camera = camera_of(sensor, layout)
        size = (layout.width, layout.height)
        frame = on_exposure(gdal_step(ctx, lambda: scoring_frame(preview, *size, frame_pixel_m(scene, size)), "read the frame"), camera)
        firsts = first_guesses(frame, scene.corner_quad(), grid.box(), camera)
        spec = SENSOR_SPECS[sensor]
        seed = int(fnv1a(ctx.job.id)[:7], 16)
        seeded(seed)
        whole = FrameSearch(
            frame,
            tuple(firsts),
            grey_reference(source),
            grid,
            SegmentReader(ctx, layout),
            film_limits(camera, layout),
            spec.search,
            camera,
            sensor,
            seed,
            _pass_prior(ctx, scene),
            matcher=ctx.services.proposal_matcher,
            wide=lambda box: _wide_reference(ctx, box),
        )
        reach = grid.scaled(_REACH_FACTOR)
        return searches(whole, spec.strip, lambda film, firsts: reaching(film, firsts, reach, spec.search.margin_ground_m))

    def _proved(self, ctx: JobContext, search: FrameSearch, found: Found, proved: Proved, layout: FrameLayout) -> StepResult:
        window, limits, mapping = search.window, search.limits, proved.mapping
        box = proved_box(reach_of(mapping, window, limits), limits)
        if box is None:
            raise CityNotFoundError
        located = Crop(box[0], box[1], box[2] - box[0], box[3] - box[1], proved_gcps(mapping, box))
        pixels = gdal_step(ctx, lambda: crop_pixels(ctx, layout, within_limits(located)), "crop the frame")
        camera = rad_per_px(search.sensor, layout)
        stored = StoredTiles(proved.proof.measured.rows, proved.order, box[0], box[1], window.bounds().middle_lat, camera)
        ctx.publish(stored.write(ctx.local(CALIBRATION_FILE)), ctx.work_file(CALIBRATION_FILE), "application/json")
        scan = publish_scan(ctx, write_geotiff(ctx.local("scan.tif"), GeoTiff([pixels])), pixels)
        record = _calibration(ctx, found, mapping, limits)
        georef = GeorefInfo("corners", "affine", located.gcps)
        ctx.update_version({"scan": scan.as_record(), "georef": georef.as_record(), "calibration": record})
        ctx.log.info(_proved_line(proved.proof, record.get("coveredPct"), located), self.name)
        delete_delivery(ctx)
        return Done(ctx.services.objects.stat(scan.path), scan.sha256)

    def _not_proved(self, ctx: JobContext, search: FrameSearch, found: Found, layout: FrameLayout) -> StepResult:
        ranked = _by_votes(search.orientations, found)
        located, cut = bounded_crop(ranked, search.window, search.limits, MAX_SCAN_PIXELS)
        pixels = gdal_step(ctx, lambda: crop_pixels(ctx, layout, within_limits(located)), "crop the frame")
        scan = publish_scan(ctx, write_geotiff(ctx.local("scan.tif"), GeoTiff([pixels])), pixels)
        georef = GeorefInfo("corners", "affine", located.gcps, weak_corners=True)
        record = _refusal_record(found, cut)
        ctx.update_version({"scan": scan.as_record(), "georef": georef.as_record(), "calibration": record})
        ctx.log.warn(_not_proved_line(found, located), self.name)
        return Done(ctx.services.objects.stat(scan.path), scan.sha256)


# The reach is measured at 60 m or so: a share, not a place.
_REACH_FACTOR: Final = 6
CALIBRATION_FILE: Final = "calibration.json"


def _by_votes(orientations: Sequence[Assignment], found: Found) -> list[Assignment]:
    """The orientations most votes named first; of equals, as `reaching` ordered them (coverage, then as given)."""

    def votes(each: Assignment) -> int:
        named = [
            p.agreed
            for p in found.tried
            if (p.hypothesis.assignment.rotation, p.hypothesis.assignment.mirrored) == (each.rotation, each.mirrored)
        ]
        return max(named, default=0)

    return sorted(orientations, key=lambda each: -votes(each))


def _calibration(ctx: JobContext, found: Found, mapping: PlaceMap, limits: tuple[int, int, int]) -> dict[str, object]:
    """`version.calibration` of a proved frame: the city's own bounds, not the window with its margin, decide what it covers."""
    record = ctx.read(f"cities/{ctx.city}") or {}
    reach = reach_of(mapping, city_bounds(record).mercator(), limits)
    fields: dict[str, object] = {
        "how": found.how,
        "votes": {"agreed": found.votes[0], "tiles": found.votes[1]},
        "coveredPct": round(reach.share * PERCENT, 1),
        **_of_the_chain(found),
    }
    edge = outline(reach)
    return {**fields, "outline": edge} if edge else fields


def _of_the_chain(found: Found) -> dict[str, object]:
    """What this proposal and proof add: only what they hold."""
    fields: dict[str, object] = {}
    if found.model is not None:
        fields["model"] = found.model.as_record()
    if found.proposer is not None:
        fields["proposer"] = found.proposer.as_record()
    proof = found.proof
    if proof is not None:
        fields["tiles"] = {"agreed": proof.inliers, "tried": proof.tried}
        fields["crossValidatedM"] = round(proof.checked.cv_m, 2)
        fields["measuredPct"] = measured_pct(proof, found.window_spread)
    return fields


def _refusal_record(found: Found, cut: int) -> dict[str, object]:
    """`version.calibration` of a frame nothing proved."""
    proof = found.refused
    fields: dict[str, object] = {"how": "none", "refusal": "no-votes" if proof is None else proof.refusal}
    if found.votes[1] > 0:
        fields["votes"] = {"agreed": found.votes[0], "tiles": found.votes[1]}
    if proof is not None:
        fields["tiles"] = {"agreed": proof.inliers, "tried": proof.tried}
    return {**fields, "cutOrientations": cut} if cut else fields


def _proved_line(proof: Proof, covered: object, located: Crop) -> str:
    return (
        f"proved: {proof.inliers} of {proof.tried} tiles agree, cross-validated {proof.checked.cv_m:.1f} m, "
        f"covers {covered} % of the city; "
        f"crop {located.width} x {located.height} px, delivery deleted"
    )


def _not_proved_line(found: Found, located: Crop) -> str:
    proof = found.refused
    why = "no-votes" if proof is None else f"{proof.refusal}: {proof.inliers} of {proof.tried}"
    return f"not proved ({why}): crop {located.width} x {located.height} px, delivery kept, the admin's points are next"


def within_limits(located: Crop) -> Crop:
    """The crop, refused before it is read when a side is over `MAX_SCAN_PIXELS`: a version's scan is never larger
    (`scanSchema`; finding 62 of 2026-11-02: a 300 000-pixel crop made the version unreadable in the admin). `bounded_crop` always
    fits and a proved crop holds only the window: a guard no input reaches."""
    if max(located.width, located.height) > MAX_SCAN_PIXELS:
        why = f"the city crop would be {located.width} x {located.height} pixels, over the {MAX_SCAN_PIXELS} a scan may have"
        raise StepFailedError(Errors.PROCESSING_FAILED, why)
    return located
