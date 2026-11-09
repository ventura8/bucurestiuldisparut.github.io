"""An archive on the owner's computer: received, scanned and recorded (docs/research/M20-import-local.md §2).

Each archive has its own folder, `<work>/import/<archiveId>/`: its files under `x/` (streamed from the worker's page, extracted from a zip,
or copied there by the owner), its scan's record `archive.json` (every file's path, size, SHA-256 and probe, and which series holds it),
which never leaves the computer. `scan` reads every file through the probe, classifies them, writes `archive.json` and answers the body of
`worker.archiveReport`. A link inside `x/` is never followed; a path is always relative to `x/`.
"""

import json
import secrets
import shutil
from collections.abc import Callable, Iterable, Iterator
from dataclasses import asdict, replace
from pathlib import Path
from typing import Final

from hcm_pipeline.archive import classify, probe, report, sidecar, zipread
from hcm_pipeline.archive.model import FileRow, Probe, Series
from hcm_pipeline.archive.safepath import UnsafePathError, inside, relative_path

ARCHIVE_PREFIX: Final = "ar-"
ID_HEX_CHARS: Final = 16
RECORD: Final = "archive.json"
FILES: Final = "x"
MAX_FILE_BYTES: Final = zipread.MAX_ENTRY_BYTES
WORLD_SUFFIXES: Final = (".tfw", ".tifw", ".jgw", ".pgw", ".wld", ".prj", ".aux.xml")

Prober = Callable[[Path], Probe]


class IntakeError(ValueError):
    """A file or an archive the intake refuses (an unknown archive, an unsafe path, a file too large, no room)."""


def new_archive_id() -> str:
    """`ar-` and 16 hex characters (`ARCHIVE_ID_PATTERN`)."""
    return ARCHIVE_PREFIX + secrets.token_hex(8)


def _valid_id(archive_id: str) -> bool:
    tail = archive_id.removeprefix(ARCHIVE_PREFIX)
    return archive_id.startswith(ARCHIVE_PREFIX) and len(tail) == ID_HEX_CHARS and all(char in "0123456789abcdef" for char in tail)


class ArchiveStore:
    """The archives under `<work>/import/`."""

    def __init__(self, work: Path, prober: Prober = probe.probe_file) -> None:
        self.root = work / "import"
        self._probe = prober

    def folder(self, archive_id: str) -> Path:
        if not _valid_id(archive_id):
            raise IntakeError(f"not an archive id: {archive_id!r}")
        return self.root / archive_id

    def files(self, archive_id: str) -> Path:
        return self.folder(archive_id) / FILES

    def create(self) -> str:
        archive_id = new_archive_id()
        self.files(archive_id).mkdir(parents=True)
        return archive_id

    def receive(self, archive_id: str, raw_path: str, chunks: Iterable[bytes], length: int) -> str:
        """One file of the page's upload, written under `x/` at its validated relative path; its relative path."""
        root = self.files(archive_id)
        if not root.is_dir() or not 0 <= length <= min(MAX_FILE_BYTES, shutil.disk_usage(root).free - zipread.FREE_MARGIN_BYTES):
            raise IntakeError("unknown archive, or no room for the file")
        try:
            relative = relative_path(raw_path)
            target = inside(root, relative)
        except UnsafePathError as error:
            raise IntakeError(str(error)) from error
        _write(target, chunks, length)
        return relative

    def extract(self, archive_id: str, zip_path: Path, limits: zipread.ZipLimits | None = None) -> zipread.ZipResult:
        """A zip the owner chose, read in place and written under `x/` (every entry checked)."""
        root = self.files(archive_id)
        return zipread.extract(zip_path, root, shutil.disk_usage(root).free, limits)

    def rows(self, archive_id: str) -> list[FileRow]:
        """Every regular file under `x/` (links are never followed), probed."""
        root = self.files(archive_id)
        return [self._row(root, path) for path in sorted(_regular_files(root))]

    def _row(self, root: Path, path: Path) -> FileRow:
        relative = path.relative_to(root).as_posix()
        sidecars = tuple(suffix for suffix in WORLD_SUFFIXES if path.with_name(path.stem + suffix).is_file())
        return FileRow(relative, path.stat().st_size, probe.sha256_file(path), self._probe(path), sidecars)

    def scan(self, archive_id: str, context: report.Context) -> report.Report:
        """The scan: rows, series and skips; `archive.json` written; the report answered."""
        rows = self.rows(archive_id)
        found = classify.classify(rows)
        context = report.Context(context.latitude, context.current_year, sidecar.read(self.files(archive_id)))
        made = report.report_of(found.series, found.skips, context)
        self.write_record(archive_id, rows, found.series)
        return replace(made, total_bytes=sum(row.size for row in rows))

    def write_record(self, archive_id: str, rows: Iterable[FileRow], series: Iterable[Series]) -> None:
        record = {
            "archiveId": archive_id,
            "files": [asdict(row) for row in rows],
            "series": {
                report.series_id(each.key): {
                    "class": each.series_class,
                    "files": [row.path for row in each.files],
                    "cells": dict(each.cells),
                }
                for each in series
            },
        }
        (self.folder(archive_id) / RECORD).write_text(json.dumps(record), encoding="utf-8")

    def record(self, archive_id: str) -> dict[str, object]:
        """`archive.json`, or `IntakeError` when this computer has none for the archive."""
        path = self.folder(archive_id) / RECORD
        if not path.is_file():
            raise IntakeError(f"no record of {archive_id} on this computer")
        loaded = json.loads(path.read_text(encoding="utf-8"))
        return loaded if isinstance(loaded, dict) else {}


def _regular_files(root: Path) -> Iterator[Path]:
    for path in root.rglob("*"):
        if path.is_file() and not path.is_symlink():
            yield path


def _write(target: Path, chunks: Iterable[bytes], length: int) -> None:
    """The file, exactly its announced length: one larger, or cut off (a dropped connection), is removed and refused."""
    target.parent.mkdir(parents=True, exist_ok=True)
    written = 0
    with target.open("wb") as sink:
        for chunk in chunks:
            written += len(chunk)
            if written > length:
                break
            sink.write(chunk)
    if written != length:
        target.unlink()
        raise IntakeError("the file is larger than it says" if written > length else "the file was cut off")
