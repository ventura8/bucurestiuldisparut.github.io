"""`fetch`: the USGS delivery streamed into the private bucket (docs/research/M3-interfaces.md §5.3).

`download-options` (scanned? how large?); `download-request` with the label `hcm-{job}` (a retry reuses it); still
preparing → the job waits (`usgs-preparing`, 10 minutes); `download-retrieve` → the signed address, streamed into a
Cloud Storage resumable upload in 64 MiB chunks, the checkpoint `{path, session}` in `work/{city}/{job}/
fetch.checkpoint.json` after each; a resume asks the session how much it holds and continues with an HTTP Range
(**UNVERIFIED** that USGS honours it: when it answers the whole file, the bytes already held are skipped); a 403 or
410 asks `download-retrieve` again; the delivered size must equal `download-options`; SHA-256 is computed by
reading the object back in-region; `download-order-remove` cleans up. A delivery another city already fetched
(same size) is reused. The signed address never reaches a log or a document.

USGS maintenance (an HTML 503) makes the job wait `USGS_BACKOFF_MINUTES` (30 minutes, doubling, at most 12 hours;
the count lives in the checkpoint); a rate limit waits its `Retry-After`.
"""

import hashlib
import json
import re
from collections.abc import Iterator
from dataclasses import asdict, dataclass
from http import HTTPStatus
from typing import Final, NoReturn

import httpx

from hcm_pipeline import paths
from hcm_pipeline.contract import USGS_BACKOFF_MINUTES, USGS_PREPARING_MINUTES, Errors
from hcm_pipeline.jobs import Done, JobContext, StepFailedError, StepResult, Waiting
from hcm_pipeline.m2m import AuthError, M2MClient, M2MError, MaintenanceError, RateLimitError
from hcm_pipeline.model import UsgsImportParams
from hcm_pipeline.objects import CHUNK_BYTES, READ_BYTES, ObjectInfo, SessionExpiredError
from hcm_pipeline.secrets import SecretUnavailableError
from hcm_pipeline.usgs import DownloadOption, download_option, label_for, remove_order, request_download, retrieve_download

CHECKPOINT: Final = "fetch.checkpoint.json"
DELIVERY_TYPE: Final = "application/octet-stream"
URL_ATTEMPTS: Final = 3
RATE_LIMIT_SECONDS: Final = 15 * 60
_EXPIRED: Final = frozenset({HTTPStatus.FORBIDDEN, HTTPStatus.GONE})
_FILENAME = re.compile(r"""filename\*?=(?:UTF-8'')?["']?([^"';]+)""", re.IGNORECASE)
_USGS_CODES: Final[dict[type[M2MError], str]] = {AuthError: Errors.USGS_CREDENTIALS}


@dataclass
class Checkpoint:
    """`work/{city}/{job}/fetch.checkpoint.json`: the delivery's object path, its upload session and the maintenance waits."""

    path: str | None = None
    session: str | None = None
    waits: int = 0

    @classmethod
    def load(cls, ctx: JobContext) -> Checkpoint:
        object_path = ctx.work_file(CHECKPOINT)
        if ctx.services.objects.stat(object_path) is None:
            return cls()
        local = ctx.local(CHECKPOINT)
        ctx.services.objects.download_file(object_path, local)
        record = json.loads(local.read_text(encoding="utf-8"))
        return cls(record.get("path"), record.get("session"), int(record.get("waits", 0)))

    def save(self, ctx: JobContext) -> None:
        local = ctx.local(CHECKPOINT)
        local.write_text(json.dumps(asdict(self)), encoding="utf-8")
        ctx.services.objects.upload_file(local, ctx.work_file(CHECKPOINT), "application/json")

    def clear(self, ctx: JobContext) -> None:
        self.path, self.session = None, None
        self.save(ctx)


def delivery_name(response: httpx.Response, entity_id: str) -> str:
    """The delivery's file name: from Content-Disposition, else the address's last segment, else `{entity}.tgz`."""
    found = _FILENAME.search(response.headers.get("content-disposition", ""))
    candidates = [found.group(1) if found else "", response.url.path.rsplit("/", 1)[-1], f"{entity_id}.tgz"]
    return next(name for name in candidates if paths.DELIVERY_FILE.fullmatch(name) and ".." not in name)


def _skipping(chunks: Iterator[bytes], skip: int) -> Iterator[bytes]:
    """The stream without its first `skip` bytes (a server that ignored the Range answers from the start)."""
    for piece in chunks:
        dropped = min(skip, len(piece))
        skip -= dropped
        if dropped < len(piece):
            yield piece[dropped:]


class _Download:
    """One delivery streamed into its resumable session."""

    def __init__(self, ctx: JobContext, option: DownloadOption, checkpoint: Checkpoint, chunk_bytes: int) -> None:
        self.ctx = ctx
        self.option = option
        self.checkpoint = checkpoint
        self.chunk_bytes = chunk_bytes

    def _offset(self) -> int | ObjectInfo:
        if self.checkpoint.session is None:
            return 0
        try:
            return self.ctx.services.objects.resumable_offset(self.checkpoint.session, self.option.size)
        except SessionExpiredError:
            self.checkpoint.clear(self.ctx)
            return 0

    def _ensure_session(self, response: httpx.Response, entity: UsgsImportParams) -> None:
        if self.checkpoint.session is not None and self.checkpoint.path is not None:
            return
        path = paths.usgs_raw(entity.dataset, entity.entity_id, delivery_name(response, entity.entity_id))
        self.checkpoint.path = path
        self.checkpoint.session = self.ctx.services.objects.start_resumable(path, self.option.size, DELIVERY_TYPE)
        self.checkpoint.save(self.ctx)

    def stream(self, url: str, entity: UsgsImportParams) -> ObjectInfo | None:
        """The finished object, or None when the signed address expired (ask for a fresh one)."""
        offset = self._offset()
        if isinstance(offset, ObjectInfo):
            return offset
        headers = {"Range": f"bytes={offset}-"} if offset else {}
        with self.ctx.services.downloads.stream("GET", url, headers=headers) as response:
            if response.status_code in _EXPIRED:
                return None
            _check_delivery(response)
            self._ensure_session(response, entity)
            skip = offset if response.status_code == HTTPStatus.OK else 0
            return self._copy(_skipping(response.iter_bytes(READ_BYTES), skip), offset)

    def _write(self, data: bytes, offset: int) -> int | ObjectInfo:
        session = self.checkpoint.session or ""
        if offset + len(data) > self.option.size:
            self._discard("the delivery is larger than USGS announced")
        result = self.ctx.services.objects.write_chunk(session, offset, data, self.option.size)
        self.ctx.flags.progress_within((offset + len(data)) / self.option.size)
        self.ctx.checkpoint()
        return result

    def _copy(self, chunks: Iterator[bytes], offset: int) -> ObjectInfo:
        buffer = bytearray()
        for piece in chunks:
            buffer += piece
            while len(buffer) >= self.chunk_bytes:
                result = self._write(bytes(buffer[: self.chunk_bytes]), offset)
                offset, buffer = offset + self.chunk_bytes, buffer[self.chunk_bytes :]
                if isinstance(result, ObjectInfo):
                    return self._finished(result, buffer)
        return self._finished(self._write(bytes(buffer), offset), b"")

    def _finished(self, result: int | ObjectInfo, rest: bytes | bytearray) -> ObjectInfo:
        """The object, when the delivery ended exactly at the announced size; else it is discarded."""
        if isinstance(result, ObjectInfo) and not rest:
            return result
        if isinstance(result, ObjectInfo):
            self.ctx.services.objects.delete(result.path)
        self._discard("the delivery does not have the size USGS announced")

    def _discard(self, why: str) -> NoReturn:
        self.checkpoint.clear(self.ctx)
        raise StepFailedError(Errors.DOWNLOAD_INCOMPLETE, why, {"bytes": self.option.size})


def _check_delivery(response: httpx.Response) -> None:
    if response.status_code == HTTPStatus.SERVICE_UNAVAILABLE:
        raise MaintenanceError("the USGS download host is offline")
    if not response.is_success:
        raise StepFailedError(Errors.USGS_UNAVAILABLE, f"the USGS download answered HTTP {response.status_code}")


def object_sha256(ctx: JobContext, path: str) -> str:
    """The object's SHA-256, read back in-region."""
    digest = hashlib.sha256()
    with ctx.services.objects.open_read(path) as stream:
        for block in iter(lambda: stream.read(READ_BYTES), b""):
            digest.update(block)
            ctx.checkpoint()
    return digest.hexdigest()


def _delivered(ctx: JobContext, entity: UsgsImportParams, size: int) -> ObjectInfo | None:
    """A delivery of the scene already in the bucket with the announced size (another city fetched it)."""
    prefix = paths.usgs_raw(entity.dataset, entity.entity_id, "x").rsplit("/", 1)[0] + "/"
    return next((info for info in ctx.services.objects.list(prefix) if info.size == size), None)


class FetchStep:
    name = "fetch"

    def __init__(self, chunk_bytes: int = CHUNK_BYTES) -> None:
        self._chunk_bytes = chunk_bytes

    def run(self, ctx: JobContext) -> StepResult:
        entity = UsgsImportParams.of(ctx.job.params)
        checkpoint = Checkpoint.load(ctx)
        try:
            with ctx.services.m2m() as m2m:
                return self._fetch(ctx, m2m, entity, checkpoint)
        except SecretUnavailableError as error:
            raise StepFailedError(Errors.USGS_NOT_CONFIGURED, str(error)) from error
        except M2MError as error:
            return _usgs_problem(ctx, checkpoint, error)

    def _fetch(self, ctx: JobContext, m2m: M2MClient, entity: UsgsImportParams, checkpoint: Checkpoint) -> StepResult:
        option = download_option(m2m, entity.dataset, entity.entity_id)
        if option is None:
            raise StepFailedError(Errors.NOT_SCANNED, f"USGS offers no download of {entity.entity_id} yet", {"entityId": entity.entity_id})
        info = _delivered(ctx, entity, option.size) or self._download(ctx, m2m, entity, option, checkpoint)
        if info is None:
            retry_at = ctx.now().plus(USGS_PREPARING_MINUTES * 60)
            return Waiting("waiting_usgs", "usgs-preparing", "USGS is preparing the download", retry_at)
        remove_order(m2m, label_for(ctx.job.id))
        checkpoint.clear(ctx)
        return Done(info, object_sha256(ctx, info.path))

    def _download(
        self, ctx: JobContext, m2m: M2MClient, entity: UsgsImportParams, option: DownloadOption, checkpoint: Checkpoint
    ) -> ObjectInfo | None:
        label = label_for(ctx.job.id)
        url = request_download(m2m, entity.entity_id, option.product_id, label) or retrieve_download(m2m, label)
        download = _Download(ctx, option, checkpoint, self._chunk_bytes)
        for _ in range(URL_ATTEMPTS):
            if url is None:
                return None
            finished = download.stream(url, entity)
            if finished is not None:
                return finished
            url = retrieve_download(m2m, label)
        raise StepFailedError(Errors.DOWNLOAD_INCOMPLETE, "the signed download address kept expiring", {"bytes": option.size})


def _usgs_problem(ctx: JobContext, checkpoint: Checkpoint, error: M2MError) -> StepResult:
    """Maintenance and rate limits make the job wait; every other M2M failure fails the step."""
    if isinstance(error, MaintenanceError):
        minutes = USGS_BACKOFF_MINUTES[min(checkpoint.waits, len(USGS_BACKOFF_MINUTES) - 1)]
        checkpoint.waits += 1
        checkpoint.save(ctx)
        return Waiting(
            "waiting_usgs", "usgs-maintenance", f"USGS is in maintenance; trying again in {minutes} minutes", ctx.now().plus(minutes * 60)
        )
    if isinstance(error, RateLimitError):
        seconds = error.retry_after or RATE_LIMIT_SECONDS
        return Waiting("waiting_usgs", "rate-limited", "USGS rate-limits the requests", ctx.now().plus(seconds))
    raise StepFailedError(_USGS_CODES.get(type(error), Errors.USGS_UNAVAILABLE), str(error)) from error
