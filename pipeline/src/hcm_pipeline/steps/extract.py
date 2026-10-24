"""`extract`: the delivery's TIFF segments, and nothing else (docs/research/M3-interfaces.md §5.3).

A `.tgz` is streamed front to back (`tarfile` `r|gz`, never extracted to paths: only the members' bytes are read);
a `.zip` is staged first (its directory is at the end). Each TIFF member (`*_a.tif` ... `*_d.tif`, or a single
TIFF) becomes `work/{city}/{job}/segments/{letter}.tif`. An unreadable archive, or one without a TIFF, fails with
`apiError.imagery.archiveCorrupt` and the delivery is deleted, so a retry fetches it again.
"""

import re
import shutil
import tarfile
import zipfile
import zlib
from collections.abc import Iterator
from contextlib import contextmanager
from typing import IO, Final

from hcm_pipeline.contract import Errors
from hcm_pipeline.jobs import Done, JobContext, StepFailedError, StepResult
from hcm_pipeline.objects import READ_BYTES, ObjectInfo

SEGMENT: Final = re.compile(r"(?:_([a-z]))?\.tiff?$", re.IGNORECASE)
MAX_SEGMENTS: Final = 8
_CORRUPT: Final = (tarfile.TarError, zipfile.BadZipFile, zlib.error, EOFError, OSError)
Member = tuple[str, IO[bytes]]


def segment_letter(name: str, seen: int) -> str | None:
    """The segment's letter (`_a` → `a`), the next free one for a TIFF without a suffix, None for anything else."""
    found = SEGMENT.search(name)
    if found is None:
        return None
    return (found.group(1) or chr(ord("a") + seen)).lower()


def _tar_members(stream: IO[bytes]) -> Iterator[Member]:
    with tarfile.open(fileobj=stream, mode="r|gz") as archive:
        for member in archive:
            data = archive.extractfile(member) if member.isfile() else None
            if data is not None:
                yield member.name, data


@contextmanager
def _zip_members(ctx: JobContext, delivery: str) -> Iterator[Iterator[Member]]:
    with zipfile.ZipFile(ctx.stage(delivery)) as archive:
        yield ((name, archive.open(name)) for name in archive.namelist() if not name.endswith("/"))


@contextmanager
def _members(ctx: JobContext, delivery: str) -> Iterator[Iterator[Member]]:
    if delivery.lower().endswith(".zip"):
        with _zip_members(ctx, delivery) as members:
            yield members
        return
    with ctx.services.objects.open_read(delivery) as stream:
        yield _tar_members(stream)


def _keep(ctx: JobContext, letter: str, data: IO[bytes]) -> ObjectInfo:
    local = ctx.local(f"segments/{letter}.tif")
    with local.open("wb") as file:
        shutil.copyfileobj(data, file, READ_BYTES)
    ctx.checkpoint()
    return ctx.publish(local, ctx.work_file(f"segments/{letter}.tif"), "image/tiff")


def _segments(ctx: JobContext, delivery: str) -> list[ObjectInfo]:
    kept: list[ObjectInfo] = []
    with _members(ctx, delivery) as members:
        for name, data in members:
            letter = segment_letter(name, len(kept))
            if letter is not None and len(kept) < MAX_SEGMENTS:
                kept.append(_keep(ctx, letter, data))
    return kept


class ExtractStep:
    name = "extract"

    def run(self, ctx: JobContext) -> StepResult:
        delivery = ctx.job.step("fetch").gcs_path
        if delivery is None:
            raise StepFailedError(Errors.ARCHIVE_CORRUPT, "the job has no fetched delivery")
        try:
            kept = _segments(ctx, delivery)
        except _CORRUPT as error:
            kept = []
            ctx.log.warn(f"the delivery is unreadable ({type(error).__name__})", self.name)
        if not kept:
            ctx.services.objects.delete(delivery)
            raise StepFailedError(Errors.ARCHIVE_CORRUPT, "the delivery holds no readable TIFF segment")
        return Done(min(kept, key=lambda info: info.path))
