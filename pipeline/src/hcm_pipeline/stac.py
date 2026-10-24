"""Sentinel-2 L2A from a public STAC API: the georeferencing reference (docs/research/M3-interfaces.md §5.5).

`POST {HCM_STAC_URL}/search` (default Element 84's Earth Search) for `sentinel-2-l2a` over the window's bbox, the
last three years, under 20 % clouds, least cloudy first; the first item that covers the window, else up to four
items of one date (mosaicked by the warp). Its `visual` asset (an 8-bit true-colour COG) is read through GDAL's
`/vsicurl/` for the window only, after the address guard (`urlguard.py`). Never Mapbox Satellite, a Mapbox raster
tileset or a resource of the old site's account: `config.py` refuses a Mapbox host as the STAC root, and the guard
refuses one as an asset.
"""

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from http import HTTPStatus
from typing import Final

import httpx

from hcm_pipeline.geo import Bounds

COLLECTION: Final = "sentinel-2-l2a"
VISUAL_ASSET: Final = "visual"
MAX_CLOUD_PERCENT: Final = 20
SEARCH_DAYS: Final = 3 * 365
SEARCH_LIMIT: Final = 50
MOSAIC_ITEMS: Final = 4
ATTEMPTS: Final = 3
RETRY_SECONDS: Final = 2.0
BBOX_VALUES: Final = 4
_RETRIED: Final = frozenset(
    {HTTPStatus.TOO_MANY_REQUESTS, HTTPStatus.BAD_GATEWAY, HTTPStatus.SERVICE_UNAVAILABLE, HTTPStatus.GATEWAY_TIMEOUT}
)


class ReferenceUnavailableError(RuntimeError):
    """The reference service did not answer, or has nothing over the window."""


@dataclass(frozen=True)
class Post:
    """One POST: a JSON body or form fields."""

    url: str
    json: object = None
    form: Mapping[str, str] | None = None


def _attempt(http: httpx.Client, post: Post) -> httpx.Response | str:
    """The answer, or why it must be tried again."""
    try:
        response = http.post(post.url, json=post.json, data=post.form)
    except httpx.TransportError as error:
        return type(error).__name__
    return f"HTTP {response.status_code}" if response.status_code in _RETRIED else response


def post_with_retries(http: httpx.Client, post: Post, sleep: Callable[[float], None]) -> httpx.Response:
    """A POST tried `ATTEMPTS` times (transport errors, 429 and gateway errors back off); ReferenceUnavailableError after."""
    problem = "no answer"
    for attempt in range(ATTEMPTS):
        answer = _attempt(http, post)
        if isinstance(answer, httpx.Response):
            return answer
        problem = answer
        sleep(RETRY_SECONDS * 2**attempt)
    raise ReferenceUnavailableError(f"{post.url.split('?', 1)[0]} failed {ATTEMPTS} times ({problem})")


@dataclass(frozen=True)
class StacItem:
    """A Sentinel-2 item: its id, date, cloud cover, `visual` asset address and footprint bbox (WGS84)."""

    id: str
    date: str
    cloud: float
    href: str
    bbox: tuple[float, float, float, float]

    def covers(self, bounds: Bounds) -> bool:
        west, south, east, north = self.bbox
        return west <= bounds.west and south <= bounds.south and east >= bounds.east and north >= bounds.north


def _field(record: object, *keys: str) -> object:
    """`record[keys[0]][keys[1]]...`, None as soon as a level is not a record."""
    value = record
    for key in keys:
        value = value.get(key) if isinstance(value, dict) else None
    return value


def _bbox(value: object) -> tuple[float, float, float, float] | None:
    numbers = [float(item) for item in value if isinstance(item, int | float)] if isinstance(value, list) else []
    return (numbers[0], numbers[1], numbers[2], numbers[3]) if len(numbers) == BBOX_VALUES else None


def item_of(feature: object) -> StacItem | None:
    """The item of a search result feature, or None when it lacks the `visual` asset, a date or a bbox."""
    href, when, bbox = (
        _field(feature, "assets", VISUAL_ASSET, "href"),
        _field(feature, "properties", "datetime"),
        _bbox(_field(feature, "bbox")),
    )
    cloud = _field(feature, "properties", "eo:cloud_cover")
    if not isinstance(href, str) or not isinstance(when, str) or bbox is None:
        return None
    return StacItem(str(_field(feature, "id")), when[:10], float(cloud) if isinstance(cloud, int | float) else 100.0, href, bbox)


def choose(items: Sequence[StacItem], bounds: Bounds) -> list[StacItem]:
    """The least cloudy item that covers the window, else up to four items of the least cloudy date."""
    covering = [item for item in items if item.covers(bounds)]
    return covering[:1] or _same_date(items)[:MOSAIC_ITEMS]


def _same_date(items: Sequence[StacItem]) -> list[StacItem]:
    return [item for item in items if item.date == items[0].date] if items else []


class StacClient:
    """`POST /search` of a STAC API."""

    def __init__(self, http: httpx.Client, base_url: str, sleep: Callable[[float], None]) -> None:
        self._http = http
        self._url = f"{base_url.rstrip('/')}/search"
        self._sleep = sleep

    def search(self, bounds: Bounds, now: float) -> list[StacItem]:
        """Items over `bounds` from the last three years under 20 % clouds, least cloudy first."""
        end = datetime.fromtimestamp(now, UTC)
        start = end - timedelta(days=SEARCH_DAYS)
        body = {
            "collections": [COLLECTION],
            "bbox": [bounds.west, bounds.south, bounds.east, bounds.north],
            "datetime": f"{start:%Y-%m-%dT00:00:00Z}/{end:%Y-%m-%dT23:59:59Z}",
            "query": {"eo:cloud_cover": {"lt": MAX_CLOUD_PERCENT}},
            "sortby": [{"field": "properties.eo:cloud_cover", "direction": "asc"}],
            "limit": SEARCH_LIMIT,
        }
        response = post_with_retries(self._http, Post(self._url, json=body), self._sleep)
        if not response.is_success:
            raise ReferenceUnavailableError(f"the STAC search answered HTTP {response.status_code}")
        features = _field(response.json(), "features")
        items = [item for item in map(item_of, features if isinstance(features, list) else []) if item is not None]
        return sorted(items, key=lambda item: (item.cloud, item.date))
