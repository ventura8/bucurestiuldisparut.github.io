"""The search surface of `locate`: where the city's reference matches a frame (docs/research/M3-interfaces.md §5.4).

The frame warped onto the window widened around the first guess, the reference slid inside it, a normalised correlation
of their gradient magnitudes at every place, **only over the pixels the frame covers** (Padfield 2012, in the Fourier
domain). On the 1972 KH-9 frame D3C1202-200149F039 the plain `cv2.matchTemplate` over the blank area around the frame walked
27.5 km away from a start at the true place; this one stays there. The raw grey correlation cannot tell a real frame's true
place from a wrong one by a threshold (0.18 at best against 0.2), but the surface's shape can: the true place stands alone,
which the ratio to the second best peak and the z-score measure (`Surface`).
"""

from dataclasses import dataclass
from typing import Final

import cv2
import numpy
from numpy.typing import NDArray

from hcm_pipeline.geo import FloatArray
from hcm_pipeline.images import UInt8Array

# The least share of the window the frame must cover at a place for the place to count (a place barely covered correlates with
# anything). On the 1972 frame, under the landmarks' transform, the true place's second best is 0.048 at 0.2 and 0.042 at 0.35.
MIN_PLACE_COVERAGE: Final = 0.35
# The second best peak is the best place at least this far from the peak (EPSG:3857 metres).
SECOND_PEAK_DISTANCE_M: Final = 2000.0
# A search is believed when its peak is at least this many times the second best and this many standard deviations over
# the surface. The 1972 frame, under the transform 17 hand-read landmarks give: truth 0.175 against 0.042, a ratio of 4.15 and
# z 16; with the city absent (48 placements) a ratio of at most 1.63 and z at most 4.5. Under the panoramic first guess, whose scale
# is 2 to 3 % off at the city, the search's peak is at the truth but lower: 0.107 against 0.051, a ratio of 2.10 and z 8.7, with the
# city absent at most 1.40 and 4.8 (`GRADIENT_SIGMA`). **Calibrated on one frame**: no other real frame has been measured.
MIN_PEAK_RATIO: Final = 2.0
MIN_PEAK_Z: Final = 7.0
# The gradient's smoothing (cells of the scoring grid): tolerant of the first guess's scale. On the 1972 frame's panoramic first guess
# a sigma of 1 gives a ratio of 1.83 and z 7.8, 2 gives 2.10 and 8.7, 3 gives 1.93 and 7.8, the city absent never over 1.42 and 5.3.
GRADIENT_SIGMA: Final = 2.0
# How far the mask is eaten: the warped frame's edge is a false edge.
MASK_ERODE_PX: Final = 7
# Under this spread a place is flat: its correlation is 0.
FLAT_SPREAD: Final = 1e-6
# A second best at or under zero divides the peak by this: nothing else on the surface correlates at all.
LEAST_SECOND: Final = 1e-6


@dataclass(frozen=True)
class Surface:
    """The search's verdict: the peak's place in the surface (`x`, `y`: cv2.matchTemplate's layout) and its evidence."""

    x: int
    y: int
    peak: float
    second: float
    ratio: float
    z: float

    @property
    def confident(self) -> bool:
        return self.ratio >= MIN_PEAK_RATIO and self.z >= MIN_PEAK_Z


def gradient(image: UInt8Array) -> FloatArray:
    """The smoothed gradient magnitude of a grey image."""
    smooth = cv2.GaussianBlur(image.astype(numpy.float32), (0, 0), GRADIENT_SIGMA)
    return numpy.asarray(cv2.magnitude(cv2.Sobel(smooth, cv2.CV_32F, 1, 0), cv2.Sobel(smooth, cv2.CV_32F, 0, 1)), numpy.float64)


def eroded(mask: NDArray[numpy.bool_]) -> NDArray[numpy.bool_]:
    """The mask without its edge's `MASK_ERODE_PX` band (cv2's default border counts as covered, the image's edge is no frame's)."""
    return numpy.asarray(cv2.erode(mask.astype(numpy.uint8), numpy.ones((MASK_ERODE_PX, MASK_ERODE_PX), numpy.uint8)), bool)


def _forward(values: FloatArray, size: tuple[int, int]) -> NDArray[numpy.complex128]:
    return numpy.fft.rfft2(values, size)


def _flipped(values: FloatArray, size: tuple[int, int]) -> NDArray[numpy.complex128]:
    return numpy.fft.rfft2(values[::-1, ::-1], size)


def masked_correlation(image: FloatArray, mask: NDArray[numpy.bool_], template: FloatArray) -> tuple[FloatArray, FloatArray]:
    """The normalised correlation of `template` with `image` at each place `template` fits whole inside it, over the pixels
    `mask` holds, and the share of `template` the mask covers there (`cv2.matchTemplate`'s result layout)."""
    height, width = template.shape
    size = (image.shape[0] + height, image.shape[1] + width)
    masked = image * mask
    in_mask, in_image, in_square = _forward(mask.astype(numpy.float64), size), _forward(masked, size), _forward(masked * masked, size)
    box, flipped = _flipped(numpy.ones_like(template), size), _flipped(template, size)

    def inverse(spectrum: NDArray[numpy.complex128]) -> FloatArray:
        return numpy.asarray(numpy.fft.irfft2(spectrum, size)[height - 1 : image.shape[0], width - 1 : image.shape[1]], numpy.float64)

    overlap = numpy.rint(inverse(in_mask * box))
    counted = numpy.maximum(overlap, 1.0)
    image_sum, template_sum = inverse(in_image * box), inverse(in_mask * flipped)
    image_spread = numpy.maximum(inverse(in_square * box) - image_sum**2 / counted, 0.0)
    template_spread = numpy.maximum(inverse(in_mask * _flipped(template * template, size)) - template_sum**2 / counted, 0.0)
    spread = numpy.sqrt(image_spread * template_spread)
    covariance = inverse(in_image * flipped) - image_sum * template_sum / counted
    return numpy.where(spread > FLAT_SPREAD, covariance / numpy.maximum(spread, FLAT_SPREAD), 0.0), overlap / (height * width)


def _second(values: FloatArray, valid: NDArray[numpy.bool_], place: tuple[int, int], reach: int) -> float:
    """The best value of the valid places more than `reach` cells from `place`, the peak's own value when none is."""
    y, x = place
    far = valid.copy()
    far[max(0, y - reach) : y + reach + 1, max(0, x - reach) : x + reach + 1] = False
    return float(values[far].max()) if far.any() else float(values[y, x])


def surface_of(correlations: FloatArray, shares: FloatArray, resolution: float) -> Surface | None:
    """The surface's peak and its evidence over the places covered at least `MIN_PLACE_COVERAGE`; None without any such place."""
    valid = shares >= MIN_PLACE_COVERAGE
    if not valid.any():
        return None
    values = correlations[valid]
    place = numpy.unravel_index(int(numpy.where(valid, correlations, -numpy.inf).argmax()), correlations.shape)
    y, x = int(place[0]), int(place[1])
    peak = float(correlations[y, x])
    second = _second(correlations, valid, (y, x), round(SECOND_PEAK_DISTANCE_M / resolution))
    spread = float(values.std())
    z = (peak - float(values.mean())) / spread if spread > 0 else 0.0
    return Surface(x, y, peak, second, peak / max(second, LEAST_SECOND), z)


def search_surface(warped: UInt8Array, inside: NDArray[numpy.bool_], reference: UInt8Array, resolution: float) -> Surface | None:
    """Where `reference` matches `warped` (a larger image), over its gradient and where the frame lies (`inside`)."""
    correlations, shares = masked_correlation(gradient(warped), eroded(inside), gradient(reference))
    return surface_of(correlations, shares, resolution)
